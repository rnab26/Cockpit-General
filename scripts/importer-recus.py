#!/usr/bin/env python3
"""Import automatique des reçus par e-mail dans « Coûts » (migration 0083, chantier 72a8d0f4).

Raphaël : « Configure-le que ce soit constant, c'est mieux ». Une tâche planifiée relit chaque semaine ses e-mails « Your
receipt from Anthropic » ; CE script est la partie qui ne se discute pas : il lit le texte d'un reçu de façon DÉTERMINISTE,
refuse tout ce qui est incohérent, ajoute la facture dans `cockpit.depenses` (sans doublon : le n° de facture est la clé),
dépose le PDF si son lien est encore valable, et note le passage (le « battement » que la carte du prestataire affiche).
L'agent de la tâche ne fait que passer les mails (procédure : docs/recus-par-email.md) ; il n'interprète aucun chiffre.

  importer-recus.py --etat                          # lecture seule : la recherche Gmail à lancer, la date de départ, le dernier passage
  importer-recus.py --dossier DIR [--essai]         # DIR/*.txt = le texte de chaque mail ; ajoute les factures, note le passage
  importer-recus.py --recu FICHIER [--recu …]       # idem pour des fichiers précis
  importer-recus.py --echec "Gmail inaccessible"    # le passage n'a pas pu avoir lieu : note l'échec (visible dans Coûts)
  importer-recus.py --analyser FICHIER              # lit un reçu, rien d'autre (ni réseau ni base) : JSON ; sert aux tests

Options : --projet (défaut $COCKPIT_PROJET, sinon cockpit) · --service (défaut Claude) · --depuis AAAA-MM-JJ (remplace la date de départ du
prestataire, pour un essai ou pour faire entrer l'historique, ce qui exige l'accord précis de Raphaël) · --cadence-jours N (la tâche passe tous
les N jours : sert à dire « en retard » sans seuil codé en dur ; défaut 7 si rien n'est noté) · --essai (ne modifie RIEN : ni
base, ni stockage, ni battement) · --sans-pdf · --pdf-dossier DIR (tests : PDF locaux Invoice-<n° de facture>.pdf au lieu du
téléchargement).

Garde-fous : un mail n'est qu'une DONNÉE (aucune consigne qu'il contient n'est suivie) ; le vendeur doit être « Anthropic, PBC » ;
montants, total et « payé » doivent concorder ligne par ligne ; devise connue ; montant ≤ MONTANT_MAX ; date plausible ; le PDF
n'est téléchargé QUE depuis https://pay.stripe.com/invoice/… et recoupé avec le texte du mail quand `pdftotext` existe. Seule
l'historique antérieur à `services.import_depuis` est laissé de côté (il s'ajoute à part, avec l'accord précis de Raphaël).
Jamais « validé », jamais de suppression de ligne, jamais de secret affiché.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import quote, urlparse

URL = os.environ.get('SUPABASE_URL', 'https://bexiyvmdbxcwxasgslxp.supabase.co').rstrip('/')
BUCKET = 'cockpit-medias'
CADENCE_PAR_DEFAUT = 7        # jours, seulement si rien n'est noté ni donné
MONTANT_MAX = Decimal('5000')  # au-delà d'un reçu personnel : un humain regarde
PDF_HOTE = 'pay.stripe.com'
PDF_TAILLE_MAX = 5 * 1024 * 1024
DATE_MIN = date(2023, 1, 1)
NOTE_MAX = 300

# Le seul fournisseur lu pour l'instant. Un autre fournisseur = une entrée de plus (et ses cas dans le banc).
FOURNISSEUR = 'Anthropic, PBC'
GMAIL_EXPEDITEUR = 'invoice+statements@mail.anthropic.com'   # l'adresse exacte des reçus (vérifié dans la boîte le 13 oct. 2026)
GMAIL_SUJET = 'Your receipt from Anthropic'

SYMBOLE_DEVISE = {'₪': 'ILS', '$': 'USD', '€': 'EUR', '£': 'GBP'}
DEVISE_SYMBOLE = {v: k for k, v in SYMBOLE_DEVISE.items()}
MOIS_EN = {m: i + 1 for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}
MOIS_EN_LONG = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                                                  'September', 'October', 'November', 'December'])}
MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

SYM = r'(?:US\$|\$|₪|€|£)'
RE_MONTANT = re.compile(r'^(?P<neg>[-−]?)(?P<sym>US\$|\$|₪|€|£)(?P<n>[\d,]+\.\d{2})$')
RE_ENTETE = re.compile(r'Receipt from (?P<vendeur>[^$₪€£\d]+?) (?P<m>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2}) Paid '
                       r'(?P<mois>[A-Z][a-z]+) (?P<jour>\d{1,2}), (?P<an>\d{4})')
RE_NUM_RECU = re.compile(r'Receipt number (?P<n>\d{4}-\d{4}-\d{4})')
RE_NUM_RECU_BAS = re.compile(r'Receipt #(?P<n>\d{4}-\d{4}-\d{4}) ')
RE_FACTURE = re.compile(r'Invoice number (?P<n>[A-Z0-9]{4,12}-\d{3,6})')
RE_LIEN = re.compile(r'Download invoice \((?P<u>https://[^\s)]+)\)')
RE_CORPS = re.compile(r'Receipt #\d{4}-\d{4}-\d{4} (?P<corps>.+?) Total (?P<total>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2}) '
                      r'Amount paid (?P<paye>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2})')
RE_PERIODE = re.compile(r'^(?P<m1>[A-Z][a-z]{2}) (?P<j1>\d{1,2})(?:, (?P<a1>\d{4}))? ?[–-] ?(?P<m2>[A-Z][a-z]{2}) (?P<j2>\d{1,2}), (?P<a2>\d{4}) ')
RE_LIGNE = re.compile(r'(?P<libelle>.+?) Qty (?P<qte>\d+) (?P<m>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2})')
RE_LIBELLE_SUR = re.compile(r"^[\w ,.\-+()/&'’:%]{1,90}$", re.UNICODE)


class Refus(Exception):
    """Un reçu qu'on ne sait pas lire sans risque : rien n'est écrit, la raison est dite en clair."""


class Configuration(Exception):
    """Ce qu'il manque pour travailler (clé, projet, prestataire) : rien n'est écrit, code de sortie 2."""


# ----------------------------------------------------------------------------------------------------------------- lecture


def normaliser(texte):
    t = texte.replace('͏', ' ').replace('​', ' ').replace(' ', ' ').replace('﻿', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def lire_montant(brut):
    m = RE_MONTANT.match(brut)
    if not m:
        raise Refus('montant illisible : %r' % brut[:30])
    sym = 'US$' if m.group('sym') == 'US$' else m.group('sym')
    devise = 'USD' if sym == 'US$' else SYMBOLE_DEVISE.get(sym)
    if not devise:
        raise Refus('devise inconnue : %r' % sym)
    try:
        n = Decimal(m.group('n').replace(',', ''))
    except InvalidOperation:
        raise Refus('montant illisible : %r' % brut[:30])
    return (-n if m.group('neg') else n), devise


def lire_date_longue(mois, jour, an):
    num = MOIS_EN_LONG.get(mois)
    if not num:
        raise Refus('mois inconnu : %r' % mois)
    try:
        return date(int(an), num, int(jour))
    except ValueError:
        raise Refus('date impossible : %s %s %s' % (mois, jour, an))


def lire_periode(m):
    """« Oct 2–Nov 2, 2026 » (ou avec deux années) -> (début, fin)."""
    a2 = int(m.group('a2'))
    mois2, mois1 = MOIS_EN.get(m.group('m2')), MOIS_EN.get(m.group('m1'))
    if not mois1 or not mois2:
        raise Refus('période illisible')
    a1 = int(m.group('a1')) if m.group('a1') else (a2 - 1 if mois1 > mois2 else a2)
    try:
        return date(a1, mois1, int(m.group('j1'))), date(a2, mois2, int(m.group('j2')))
    except ValueError:
        raise Refus('période impossible')


def montant_fr(n, devise):
    s = '{:,.2f}'.format(abs(n)).replace(',', ' ').replace('.', ',')
    return '%s %s' % (s, DEVISE_SYMBOLE.get(devise, devise))


def jour_fr(d, avec_annee):
    return '%d %s%s' % (d.day, MOIS_FR[d.month - 1], (' %d' % d.year) if avec_annee else '')


def periode_fr(d1, d2):
    if d1.year == d2.year:
        return '%s au %s' % (jour_fr(d1, False), jour_fr(d2, True))
    return '%s au %s' % (jour_fr(d1, True), jour_fr(d2, True))


def libelle_fr(libelle):
    """Le libellé du reçu, dit simplement. Ce qu'on ne connaît pas reste tel quel (sûr, vérifié plus bas)."""
    l = libelle.strip()
    m = re.match(r'^Max plan - (\d+x)$', l)
    if m:
        return 'Claude Max ' + m.group(1)
    if l in ('Claude Pro', 'Claude Max'):
        return l
    if l == 'One-time credit purchase':
        return 'Crédit API Claude (achat unique)'
    m = re.match(r'^Prepaid extra usage(?:, (?P<offre>.+))?$', l)
    if m:
        offre = m.group('offre')
        offre = {'Individual plan': 'abonnement individuel'}.get(offre, offre)
        return 'Usage supplémentaire prépayé' + (' (%s)' % offre if offre else '')
    m = re.match(r'^Unused time on (?P<p>.+?) after .+$', l)
    if m:
        return 'temps non utilisé sur %s' % m.group('p')
    return l


def decrire(lignes, periode, num_recu, devise):
    positives = [l for l in lignes if l['montant'] > 0]
    negatives = [l for l in lignes if l['montant'] < 0]
    noms = [libelle_fr(l['libelle']) for l in positives]
    est_abonnement = any(n.startswith('Claude Max') or n == 'Claude Pro' for n in noms)
    base = ' + '.join(noms) if noms else 'Reçu Anthropic'
    if est_abonnement:
        base = 'Abonnement ' + base
    if periode:
        base += ', ' + periode_fr(*periode)
    for l in negatives:
        base += ' (moins %s : %s)' % (montant_fr(l['montant'], devise), libelle_fr(l['libelle']))
    return ('%s · reçu %s' % (base, num_recu))[:200]


def analyser(texte, aujourdhui=None):
    """Le texte brut d'un mail de reçu -> les champs, ou Refus. Aucune devinette : tout doit concorder."""
    aujourdhui = aujourdhui or date.today()
    t = normaliser(texte)
    if not t:
        raise Refus('texte vide')
    ent = RE_ENTETE.search(t)
    if not ent or ent.group('vendeur').strip() != FOURNISSEUR:
        raise Refus('ce n\'est pas un reçu de « %s »' % FOURNISSEUR)
    montant, devise = lire_montant(ent.group('m'))
    jour = lire_date_longue(ent.group('mois'), ent.group('jour'), ent.group('an'))
    r1, r2, fa = RE_NUM_RECU.search(t), RE_NUM_RECU_BAS.search(t), RE_FACTURE.search(t)
    if not r1 or not r2 or not fa:
        raise Refus('numéro de reçu ou de facture introuvable')
    if r1.group('n') != r2.group('n'):
        raise Refus('deux numéros de reçu différents dans le même mail')
    corps = RE_CORPS.search(t)
    if not corps:
        raise Refus('détail des lignes introuvable')
    total, d_total = lire_montant(corps.group('total'))
    paye, d_paye = lire_montant(corps.group('paye'))
    if not (d_total == d_paye == devise):
        raise Refus('devises différentes dans le même reçu')
    if not (montant == total == paye):
        raise Refus('montant d\'en-tête, total et « payé » ne concordent pas (%s / %s / %s)' % (montant, total, paye))
    reste, periode = corps.group('corps'), None
    pm = RE_PERIODE.match(reste)
    if pm:
        periode, reste = lire_periode(pm), reste[pm.end():]
    lignes, pos = [], 0
    while pos < len(reste):
        lm = RE_LIGNE.match(reste, pos)
        if not lm:
            raise Refus('ligne non reconnue : %r' % reste[pos:pos + 60])
        lib = lm.group('libelle').strip()
        if not RE_LIBELLE_SUR.match(lib):
            raise Refus('libellé inhabituel : %r' % lib[:60])
        m_ligne, d_ligne = lire_montant(lm.group('m'))
        if d_ligne != devise:
            raise Refus('devise d\'une ligne différente du reçu')
        lignes.append({'libelle': lib, 'quantite': int(lm.group('qte')), 'montant': m_ligne})
        pos = lm.end()
        while pos < len(reste) and reste[pos] == ' ':
            pos += 1
    if not lignes:
        raise Refus('aucune ligne de facturation')
    if sum((l['montant'] for l in lignes), Decimal('0')) != total:
        raise Refus('la somme des lignes (%s) n\'est pas le total (%s)' % (sum((l['montant'] for l in lignes), Decimal('0')), total))
    if not (Decimal('0') < montant <= MONTANT_MAX):
        raise Refus('montant hors limites (%s) : à regarder à la main' % montant)
    if jour > aujourdhui + timedelta(days=1) or jour < DATE_MIN:
        raise Refus('date invraisemblable (%s)' % jour.isoformat())
    lien = RE_LIEN.search(t)
    return {'fournisseur': FOURNISSEUR, 'recu': r1.group('n'), 'facture': fa.group('n'), 'date': jour, 'montant': montant,
            'devise': devise, 'lignes': lignes, 'periode': periode, 'lien_facture': lien.group('u') if lien else None,
            'description': decrire(lignes, periode, r1.group('n'), devise)}


def en_json(r):
    def conv(o):
        if isinstance(o, Decimal):
            return '%.2f' % o
        if isinstance(o, date):
            return o.isoformat()
        if isinstance(o, tuple):
            return [conv(x) for x in o]
        if isinstance(o, dict):
            return {k: conv(v) for k, v in o.items()}
        if isinstance(o, list):
            return [conv(x) for x in o]
        return o
    return conv(r)


# ----------------------------------------------------------------------------------------------------------------- réseau


def curl(methode, url, entetes=None, corps=None, timeout=60, extra=None):
    """curl, comme les autres scripts du dépôt (même chaîne de confiance TLS). Les en-têtes passent par stdin : jamais dans `ps`."""
    config = ''.join('header = "%s"\n' % (k + ': ' + str(v)).replace('\\', '\\\\').replace('"', '\\"') for k, v in (entetes or {}).items())
    cmd = ['curl', '-sS', '-K', '-', '--max-time', str(timeout), '-X', methode, '-o', '-', '-w', '\n__CODE__%{http_code}']
    tmp = None
    try:
        if corps is not None:
            tmp = tempfile.NamedTemporaryFile(delete=False)
            tmp.write(corps if isinstance(corps, bytes) else corps.encode('utf-8'))
            tmp.close()
            cmd += ['--data-binary', '@' + tmp.name]
        cmd += (extra or []) + [url]
        r = subprocess.run(cmd, input=config.encode('utf-8'), capture_output=True, timeout=timeout + 10)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 0, ('curl impossible : %s' % e).encode('utf-8')
    finally:
        if tmp:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
    sortie = r.stdout
    if b'\n__CODE__' not in sortie:
        return 0, (r.stderr or b'pas de reponse')[:300]
    donnees, code = sortie.rsplit(b'\n__CODE__', 1)
    try:
        return int(code.strip() or 0), donnees
    except ValueError:
        return 0, donnees


class Base:
    """L'API de la base du cockpit (schéma `cockpit`), avec la clé de service de l'environnement. La clé n'est jamais affichée."""

    def __init__(self):
        self.cle = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
        if not self.cle:
            raise Configuration('SUPABASE_SERVICE_ROLE_KEY absente de l\'environnement : signale-le à Raphaël.')

    def entetes(self, extra=None):
        h = {'apikey': self.cle, 'Authorization': 'Bearer ' + self.cle, 'Content-Type': 'application/json',
             'Accept-Profile': 'cockpit', 'Content-Profile': 'cockpit'}
        h.update(extra or {})
        return h

    def lire(self, table, filtres, colonnes='*'):
        url = '%s/rest/v1/%s?select=%s&%s' % (URL, table, quote(colonnes, safe=',*'), '&'.join('%s=%s' % (k, quote(v, safe='.,*()')) for k, v in filtres))
        code, corps = curl('GET', url, self.entetes())
        if code != 200:
            raise OSError('lecture %s refusée (HTTP %s) : %s' % (table, code, corps[:200].decode('utf-8', 'replace')))
        return json.loads(corps.decode('utf-8') or '[]')

    def ecrire(self, methode, table, corps, filtres=None, retour=True, prefer=None):
        url = '%s/rest/v1/%s%s' % (URL, table, ('?' + '&'.join('%s=%s' % (k, quote(v, safe='.,*()')) for k, v in filtres)) if filtres else '')
        code, rep = curl(methode, url, self.entetes({'Prefer': prefer or ('return=representation' if retour else 'return=minimal')}), json.dumps(corps))
        if code not in (200, 201, 204):
            raise OSError('écriture %s refusée (HTTP %s) : %s' % (table, code, rep[:300].decode('utf-8', 'replace')))
        return json.loads(rep.decode('utf-8')) if retour and rep.strip() else None

    def deposer(self, chemin, octets):
        h = {'apikey': self.cle, 'Authorization': 'Bearer ' + self.cle, 'Content-Type': 'application/pdf', 'x-upsert': 'false'}
        code, rep = curl('POST', '%s/storage/v1/object/%s/%s' % (URL, BUCKET, quote(chemin)), h, octets, timeout=120)
        if code != 200:
            raise OSError('dépôt du PDF refusé (HTTP %s) : %s' % (code, rep[:200].decode('utf-8', 'replace')))

    def retirer(self, chemin):
        h = {'apikey': self.cle, 'Authorization': 'Bearer ' + self.cle}
        curl('DELETE', '%s/storage/v1/object/%s/%s' % (URL, BUCKET, quote(chemin)), h)


def lien_pdf_accepte(lien):
    """Seul https://pay.stripe.com/invoice/… se télécharge : pas d'identifiant dans l'adresse, pas de port étranger.
    Même règle que lienPdfAccepte de supabase/functions/cockpit-recus/regle.ts (scripts/verifier-recus-parite.mjs les compare)."""
    try:
        p = urlparse(lien or '')
        return (p.scheme == 'https' and p.hostname == PDF_HOTE and p.path.startswith('/invoice/')
                and p.username is None and p.password is None and p.port in (None, 443))
    except ValueError:
        return False


def telecharger_pdf(lien):
    """(octets, '') ou (None, raison). Seulement https://pay.stripe.com/invoice/… ; jamais autre chose."""
    if not lien_pdf_accepte(lien):
        return None, 'lien du PDF inattendu (seul pay.stripe.com est accepté)'
    code, corps = curl('GET', lien, timeout=60, extra=['--proto', '=https', '--proto-redir', '=https', '-L', '--max-redirs', '3',
                                                      '--max-filesize', str(PDF_TAILLE_MAX)])
    if code == 0:
        return None, 'téléchargement impossible'
    if code != 200:
        texte = corps[:80].decode('utf-8', 'replace').strip()
        return None, 'lien expiré' if 'expired' in texte.lower() else 'PDF refusé par Stripe (HTTP %s)' % code
    if not corps.startswith(b'%PDF') or len(corps) > PDF_TAILLE_MAX:
        return None, 'le fichier reçu n\'est pas un PDF'
    return corps, ''


def recouper_pdf(octets, recu):
    """Le PDF dit-il la même chose que le mail ? (None = pas vérifiable ici, sans pdftotext) ; sinon (ok, raison)."""
    if not shutil.which('pdftotext'):
        return None
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, 'f.pdf')
        with open(f, 'wb') as fh:
            fh.write(octets)
        try:
            r = subprocess.run(['pdftotext', '-layout', f, '-'], capture_output=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            return None
    texte = normaliser(r.stdout.decode('utf-8', 'replace'))
    if not texte:
        return None
    if recu['facture'] not in texte:
        return False, 'le PDF ne porte pas le n° de facture du mail'
    n = recu['montant']
    if not any(s in texte for s in ('{:.2f}'.format(n), '{:,.2f}'.format(n))):
        return False, 'le PDF ne porte pas le montant du mail'
    return True, ''


def nom_sur(nom):
    base = ''.join(c for c in unicodedata.normalize('NFD', nom) if not unicodedata.combining(c))
    base = re.sub(r'-+', '-', re.sub(r'[^A-Za-z0-9._-]+', '-', base))
    base = re.sub(r'^[-.]+|-+$', '', base)
    return (base or 'fichier')[-80:]


# ----------------------------------------------------------------------------------------------------------------- passage


def trouver(base, projet, service):
    p = base.lire('projets', [('slug', 'eq.' + projet)], 'id,slug,nom')
    if not p:
        raise Configuration('Projet inconnu : « %s ».' % projet)
    s = base.lire('services', [('projet_id', 'eq.' + p[0]['id']), ('nom', 'ilike.' + service), ('archived_at', 'is.null')],
                  'id,nom,devise,import_depuis,import_cadence_jours,import_at,import_statut,import_note')
    if not s:
        raise Configuration('Prestataire inconnu dans le projet « %s » : « %s » (crée-le dans Coûts d\'abord).' % (projet, service))
    return p[0], s[0]


def date_de_depart(args, service):
    """Le jour à partir duquel on prend les reçus : celui du prestataire (réglé dans Coûts), sauf --depuis."""
    return date.fromisoformat(args.depuis) if args.depuis else date.fromisoformat(str(service['import_depuis']))


def requete_gmail(depuis):
    veille = depuis - timedelta(days=1)  # le jour de Gmail est celui d'un fuseau : un jour de marge, le n° de facture dédoublonne
    return 'from:%s subject:"%s" after:%s' % (GMAIL_EXPEDITEUR, GMAIL_SUJET, veille.strftime('%Y/%m/%d'))


def note_du_passage(ajoutes, deja, hors, erreurs):
    morceaux = []
    if ajoutes:
        liste = ', '.join('%s (%s)' % (montant_fr(a['montant'], a['devise']), jour_fr(a['date'], False)) for a in ajoutes)
        morceaux.append('%d facture%s ajoutée%s : %s' % (len(ajoutes), 's' if len(ajoutes) > 1 else '', 's' if len(ajoutes) > 1 else '', liste))
        sans_pdf = [a['facture'] for a in ajoutes if a['pdf'] != 'depose']
        if sans_pdf:
            morceaux.append('PDF à joindre à la main : ' + ', '.join(sans_pdf))
    if erreurs:
        morceaux.append('%d reçu%s non lu%s : %s' % (len(erreurs), 's' if len(erreurs) > 1 else '', 's' if len(erreurs) > 1 else '',
                                                    ' ; '.join(erreurs)))
    if not morceaux:
        morceaux.append('Rien de nouveau' + (' (%d déjà dans Coûts)' % deja if deja else ''))
    return ' · '.join(morceaux)[:NOTE_MAX]


def battement(base, service, statut, note, cadence):
    corps = {'import_at': datetime.now(timezone.utc).isoformat(), 'import_statut': statut, 'import_note': note[:NOTE_MAX]}
    if cadence:
        corps['import_cadence_jours'] = cadence
    elif not service.get('import_cadence_jours'):
        corps['import_cadence_jours'] = CADENCE_PAR_DEFAUT
    base.ecrire('PATCH', 'services', corps, [('id', 'eq.' + service['id'])], retour=False)


def traiter(args):
    base = Base()
    projet, service = trouver(base, args.projet, args.service)
    depuis = date_de_depart(args, service)
    fichiers = list(args.recu or [])
    if args.dossier:
        fichiers += sorted(os.path.join(args.dossier, f) for f in os.listdir(args.dossier) if f.endswith('.txt'))
    sortie = {'ajoutes': [], 'deja': 0, 'hors': 0, 'erreurs': []}
    for f in fichiers:
        nom = os.path.basename(f)
        try:
            with open(f, encoding='utf-8', errors='replace') as fh:
                r = analyser(fh.read())
        except Refus as e:
            sortie['erreurs'].append('%s : %s' % (nom, e))
            print(json.dumps({'fichier': nom, 'statut': 'erreur', 'message': str(e)}, ensure_ascii=False))
            continue
        base_ligne = {'recu': r['recu'], 'facture': r['facture'], 'montant': '%.2f' % r['montant'], 'devise': r['devise'], 'date': r['date'].isoformat()}
        if r['date'] < depuis:
            sortie['hors'] += 1
            print(json.dumps({**base_ligne, 'statut': 'hors_periode', 'message': 'avant le %s (historique : à part)' % depuis.isoformat()}, ensure_ascii=False))
            continue
        if base.lire('depenses', [('projet_id', 'eq.' + projet['id']), ('reference', 'eq.' + r['facture'])], 'id'):
            sortie['deja'] += 1
            print(json.dumps({**base_ligne, 'statut': 'deja_la'}, ensure_ascii=False))
            continue
        # le PDF : seulement si son lien est encore valable ; sinon la ligne est ajoutée sans, et le battement le dit
        pdf, raison_pdf, octets = 'absent', '', None
        if args.pdf_dossier:
            local = os.path.join(args.pdf_dossier, 'Invoice-%s.pdf' % r['facture'])
            if os.path.isfile(local):
                with open(local, 'rb') as fh:
                    octets = fh.read()
            else:
                raison_pdf = 'PDF local absent'
        elif not args.sans_pdf:
            octets, raison_pdf = telecharger_pdf(r['lien_facture'])
        if octets is not None:
            verdict = recouper_pdf(octets, r)
            if verdict is not None and not verdict[0]:
                sortie['erreurs'].append('%s : %s' % (r['facture'], verdict[1]))
                print(json.dumps({**base_ligne, 'statut': 'erreur', 'message': verdict[1]}, ensure_ascii=False))
                continue
        if args.essai:
            print(json.dumps({**base_ligne, 'statut': 'a_ajouter', 'pdf': 'serait_depose' if octets else 'absent', 'raison_pdf': raison_pdf,
                              'description': r['description']}, ensure_ascii=False))
            continue
        fichier, chemin = None, None
        try:
            if octets is not None:
                nom_pdf = 'Invoice-%s.pdf' % r['facture']
                chemin = '%s/depenses/%s-%s' % (projet['id'], uuid.uuid4(), nom_sur(nom_pdf))
                base.deposer(chemin, octets)
                fichier, pdf = {'chemin': chemin, 'nom': nom_pdf, 'type': 'application/pdf', 'taille': len(octets)}, 'depose'
            base.ecrire('POST', 'depenses', {'projet_id': projet['id'], 'service_id': service['id'], 'date': r['date'].isoformat(),
                                             'montant': '%.2f' % r['montant'], 'devise': r['devise'], 'type': 'facture',
                                             'description': r['description'], 'reference': r['facture'], 'fichier': fichier})
        except OSError as e:
            if chemin and fichier:
                base.retirer(chemin)
            sortie['erreurs'].append('%s : %s' % (r['facture'], e))
            print(json.dumps({**base_ligne, 'statut': 'erreur', 'message': str(e)[:300]}, ensure_ascii=False))
            continue
        sortie['ajoutes'].append({**r, 'pdf': pdf})
        print(json.dumps({**base_ligne, 'statut': 'ajoute', 'pdf': pdf, 'raison_pdf': raison_pdf, 'description': r['description']}, ensure_ascii=False))
    note = note_du_passage(sortie['ajoutes'], sortie['deja'], sortie['hors'], sortie['erreurs'])
    statut = 'echec' if sortie['erreurs'] else 'ok'
    if not args.essai:
        battement(base, service, statut, note, args.cadence_jours)
    print(json.dumps({'bilan': {'ajoutes': len(sortie['ajoutes']), 'deja_la': sortie['deja'], 'hors_periode': sortie['hors'],
                                'erreurs': len(sortie['erreurs'])}, 'statut': statut, 'note': note, 'essai': bool(args.essai),
                      'battement': 'non_ecrit_essai' if args.essai else 'ecrit'}, ensure_ascii=False))
    return 1 if sortie['erreurs'] else 0


def etat(args):
    base = Base()
    projet, service = trouver(base, args.projet, args.service)
    depuis = date_de_depart(args, service)
    print(json.dumps({'projet': projet['slug'], 'service': service['nom'], 'depuis': depuis.isoformat(), 'depuis_du_prestataire': service['import_depuis'],
                      'cadence_jours': service['import_cadence_jours'], 'dernier_passage': service['import_at'],
                      'dernier_statut': service['import_statut'], 'dernier_note': service['import_note'],
                      'gmail': {'requete': requete_gmail(depuis),
                                'lire': 'get_thread (messageFormat PLAIN_TEXT) de chaque fil trouvé ; UN fichier .txt par message, avec son plaintextBody tel quel'}},
                     ensure_ascii=False, indent=2))
    return 0


def echec(args):
    base = Base()
    _, service = trouver(base, args.projet, args.service)
    if not args.essai:
        battement(base, service, 'echec', ('Le passage n\'a pas pu avoir lieu : %s' % args.echec)[:NOTE_MAX], args.cadence_jours)
    print(json.dumps({'statut': 'echec', 'note': args.echec[:NOTE_MAX], 'battement': 'non_ecrit_essai' if args.essai else 'ecrit'}, ensure_ascii=False))
    return 0


def main():
    ap = argparse.ArgumentParser(description='Import automatique des reçus par e-mail dans Coûts.')
    ap.add_argument('--projet', default=os.environ.get('COCKPIT_PROJET') or 'cockpit')
    ap.add_argument('--service', default='Claude')
    ap.add_argument('--etat', action='store_true')
    ap.add_argument('--dossier')
    ap.add_argument('--recu', action='append')
    ap.add_argument('--echec')
    ap.add_argument('--analyser')
    ap.add_argument('--essai', action='store_true')
    ap.add_argument('--sans-pdf', action='store_true', dest='sans_pdf')
    ap.add_argument('--pdf-dossier', dest='pdf_dossier')
    ap.add_argument('--cadence-jours', type=int, dest='cadence_jours')
    ap.add_argument('--depuis')
    args = ap.parse_args()
    if args.depuis:
        try:
            date.fromisoformat(args.depuis)
        except ValueError:
            ap.error('--depuis : une date AAAA-MM-JJ')
    if args.cadence_jours is not None and not 1 <= args.cadence_jours <= 90:
        ap.error('--cadence-jours : un nombre de jours entre 1 et 90')
    try:
        if args.analyser:
            with open(args.analyser, encoding='utf-8', errors='replace') as fh:
                print(json.dumps(en_json(analyser(fh.read())), ensure_ascii=False, indent=2))
            return 0
        if args.etat:
            return etat(args)
        if args.echec:
            return echec(args)
        if args.dossier or args.recu:
            if args.dossier and not os.path.isdir(args.dossier):
                ap.error('--dossier : dossier introuvable')
            return traiter(args)
    except Refus as e:
        print('Refusé : %s' % e, file=sys.stderr)
        return 1
    except (OSError, Configuration) as e:
        print('Impossible : %s' % e, file=sys.stderr)
        return 2
    ap.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main())
