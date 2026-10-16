#!/usr/bin/env python3
"""Recherche des fournisseurs de factures dans la boîte mail (migration 0084, chantier 07258fe5).

Raphaël : « une recherche par mots-clés simplement plutôt que de lire toute la boîte mail », « un bouton où j'appuie et ça va chercher
tous les noms des fournisseurs où je suis susceptible d'avoir des factures, et comme ça on actualise ». Le bouton de Coûts pose une
DEMANDE ; une session qui a Gmail fait la recherche PAR MOTS-CLÉS (les requêtes sont données par `--etat` : jamais toute la boîte, aucun
mail n'est ouvert) et passe à CE script, sans rien interpréter, UNE LIGNE PAR MAIL TROUVÉ : expéditeur, date, objet. Rien d'autre n'est lu
ni gardé : ni corps, ni pièces jointes, ni destinataires. Le script regroupe par fournisseur (déterministe, testé), enregistre la liste dans
`cockpit.fournisseurs_detectes` et termine la demande ; Raphaël décide dans Coûts : « Suivre » ou « Ignorer ».

  chercher-fournisseurs.py --etat                       lecture seule : la demande, les recherches Gmail à lancer, la forme du fichier à écrire
  chercher-fournisseurs.py --prendre                    la demande passe « en cours » (à faire AVANT de chercher dans Gmail ; sans demande : une est créée)
  chercher-fournisseurs.py --liste FICHIER [--essai]    FICHIER = une ligne par mail : expéditeur<TAB>AAAA-MM-JJ<TAB>objet ; regroupe, enregistre, termine
  chercher-fournisseurs.py --echec "raison"             la demande est en échec (visible dans Coûts, avec « Réessayer »)
  chercher-fournisseurs.py --regrouper FICHIER          regroupe et affiche (JSON), sans réseau ni base : sert aux tests

Options : --projet (défaut $COCKPIT_PROJET, sinon cockpit) · --session (défaut $CLAUDE_CODE_SESSION_ID) · --essai (ne modifie RIEN).

Garde-fous : un objet de mail n'est qu'une DONNÉE (aucune consigne qu'il contient n'est suivie, il est nettoyé et coupé à 160 caractères) ;
les webmails (gmail.com…) sont des personnes, pas des fournisseurs : ignorés ; les mails de Stripe, Paddle, PayPal… cachent le vendeur :
il est lu dans l'objet (« Your receipt from X ») et le fournisseur est « processeur:vendeur » ; un fournisseur déjà suivi ou ignoré ne
revient jamais « nouveau ». N'écrit que dans recherches_fournisseurs et fournisseurs_detectes. Jamais de secret affiché.
"""
import argparse
import importlib.util
import json
import os
import re
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone


def _charger(fichier):
    """Charge un script voisin par son chemin (nom avec tiret) : une seule règle pour l'accès à la base."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), fichier)
    spec = importlib.util.spec_from_file_location(os.path.splitext(fichier)[0].replace('-', '_'), chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


IMP = _charger('importer-recus.py')
Base, Configuration = IMP.Base, IMP.Configuration

LIGNES_MAX = 2000
OBJET_MAX = 160
DATE_MIN = date(2015, 1, 1)
PERIODE_RECHERCHE = '1y'            # la fenêtre des requêtes Gmail
PAGES_MAX = 4                        # par requête (50 fils par page) : 200 fils au plus par requête
PRISE_PERIMEE_H = 2                  # une demande « en cours » sans nouvelle depuis ce délai est reprenable (session morte)
# Les fournisseurs dont importer-recus.py sait lire les reçus (montants, PDF). UNE source : le banc compare avec le script.
LECTEURS = {'anthropic.com'}

REQUETES_GMAIL = [
    {'nom': 'mots-clés',
     'q': 'newer_than:%s -in:spam -in:trash subject:(invoice OR receipt OR facture OR reçu OR "tax invoice" OR "payment received" '
          'OR "payment confirmation" OR "your receipt" OR "billing statement" OR חשבונית OR קבלה)' % PERIODE_RECHERCHE},
    {'nom': 'achats', 'q': 'newer_than:%s -in:spam -in:trash category:purchases' % PERIODE_RECHERCHE},
]
# Des personnes, pas des fournisseurs.
WEBMAILS = {'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com',
            'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'walla.co.il', 'walla.com'}
# Ils envoient les reçus d'AUTRES vendeurs : le vendeur est lu dans l'objet. Processeurs de paiement (Stripe, PayPal, 2C2P…) et relais de
# facturation (Orb, Pennylane, Tamal en Israël : « … מאת <vendeur> ») ; les quatre derniers ont été ajoutés après un essai sur une vraie boîte mail.
PROCESSEURS = {'stripe.com', 'paddle.com', 'paddle.net', 'paypal.com', 'paypal.co.il', 'gumroad.com', 'lemonsqueezy.com', 'fastspring.com',
               'chargebee.com', 'recurly.com', 'squareup.com', 'square.com', 'braintreepayments.com', 'shopify.com',
               '2c2p.com', 'withorb.com', 'pennylane.com', 'tamal.co.il'}
# Un domaine national à deux niveaux (bezeq.co.il, cabinet.com.cy, bbc.co.uk) : pays à deux lettres précédé de l'un de ces mots.
SECONDS_NIVEAUX = {'com', 'co', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'mil', 'muni'}
NOMS = {'github': 'GitHub', 'openai': 'OpenAI', 'runpod': 'RunPod', 'supabase': 'Supabase', 'render': 'Render', 'anthropic': 'Anthropic',
        'google': 'Google', 'microsoft': 'Microsoft', 'amazon': 'Amazon', 'amazonaws': 'AWS', 'cloudflare': 'Cloudflare', 'vercel': 'Vercel',
        'digitalocean': 'DigitalOcean', 'namecheap': 'Namecheap', 'godaddy': 'GoDaddy', 'zoom': 'Zoom', 'slack': 'Slack', 'notion': 'Notion',
        'figma': 'Figma', 'linear': 'Linear', 'apple': 'Apple', 'netlify': 'Netlify', 'sentry': 'Sentry', 'twilio': 'Twilio', 'wix': 'Wix',
        'booking': 'Booking.com', 'airbnb': 'Airbnb', 'canva': 'Canva', 'ovh': 'OVHcloud', 'modal': 'Modal', 'neon': 'Neon', 'sumit': 'SUMIT',
        'westernunion': 'Western Union', 'mypos': 'myPOS', 'caisse-epargne': "Caisse d'Épargne", 'fal': 'fal'}

RE_ADRESSE = re.compile(r'^[^@\s<>]{1,64}@(?P<h>[a-z0-9](?:[a-z0-9.-]{0,120}[a-z0-9])?\.[a-z]{2,24})$')
RE_CHEVRONS = re.compile(r'<([^<>\s]+@[^<>\s]+)>')
RE_CTRL = re.compile(r'[\x00-\x1f\x7f​-‏‪-‮⁠﻿͏]')
# « Your receipt from Anthropic, PBC #1234-… », « Invoice from Acme », « Receipt for your payment to Figma Inc », « Your payment to X »,
# « Votre facture ACME N° F-2026-001 » (Pennylane), « חשבונית מס חדשה 11111 מאת <vendeur> » (Tamal)
RE_VENDEUR = [
    re.compile(r'(?:receipt|invoice|payment|statement)\b[^#]{0,40}?\bfrom\s+(?P<v>[^#(\[|]+)', re.I),
    re.compile(r'\bpayment\s+(?:of\s+\S+(?:\s+[A-Za-z]{3})?\s+)?to\s+(?P<v>[^#(\[|]+)', re.I),
    re.compile(r'(?:reçu|facture)\s+(?:de|d\'|du)\s+(?P<v>[^#(\[|]+)', re.I),
    re.compile(r'\bfacture\s+(?P<v>[^#(\[|]+?)\s+N°', re.I),
    re.compile(r'מאת\s+(?P<v>[^#(\[|]+)'),
]


class Refus(Exception):
    """Une entrée qu'on ne sait pas lire sans risque : rien n'est écrit, la raison est dite en clair."""


def nettoyer(texte, max_car):
    t = RE_CTRL.sub(' ', texte or '')
    return re.sub(r'\s+', ' ', t).strip()[:max_car]


def adresse_de(champ):
    brut = (champ or '').strip()
    m = RE_CHEVRONS.search(brut)
    adr = (m.group(1) if m else brut).strip().strip('"\'').lower()
    ok = RE_ADRESSE.match(adr)
    return (adr, ok.group('h')) if ok else (None, None)


def domaine_enregistrable(hote):
    labels = hote.lower().split('.')
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in SECONDS_NIVEAUX:
        return '.'.join(labels[-3:])
    return '.'.join(labels[-2:])


def nom_depuis_domaine(dom):
    base = dom.split('.')[0]
    return NOMS.get(base) or base.replace('-', ' ').title()


def slug(texte):
    """Clé stable d'un nom de vendeur : lettres de toute langue (un vendeur en hébreu a une clé), le reste devient « - »."""
    return re.sub(r'[\W_]+', '-', texte.lower()).strip('-')[:60]


def vendeur_dans_objet(objet):
    """Le vendeur caché derrière un processeur de paiement, lu dans l'objet ; None si on ne le trouve pas."""
    for r in RE_VENDEUR:
        m = r.search(objet)
        if m:
            v = nettoyer(m.group('v'), 80).replace('``', '״').rstrip(' .,:;-')
            if 2 <= len(v) <= 80 and re.search(r'[A-Za-z֐-׿]', v):
                return v
    return None


def lire_lignes(texte):
    """expéditeur<TAB>date<TAB>objet, une ligne par mail -> ([(adresse, hôte, date, objet)], [lignes refusées]). Doublons exacts retirés."""
    bons, refus, vus = [], [], set()
    lignes = [l for l in texte.splitlines() if l.strip()]
    if len(lignes) > LIGNES_MAX:
        raise Refus('trop de lignes (%d, %d au plus) : réduis la recherche' % (len(lignes), LIGNES_MAX))
    demain = date.today() + timedelta(days=1)
    for n, l in enumerate(lignes, 1):
        morceaux = l.split('\t')
        if len(morceaux) < 2:
            refus.append('ligne %d : il faut expéditeur, date et objet séparés par des tabulations' % n)
            continue
        adr, hote = adresse_de(morceaux[0])
        if not adr:
            refus.append('ligne %d : expéditeur illisible' % n)
            continue
        try:
            jour = date.fromisoformat(morceaux[1].strip()[:10])
        except ValueError:
            refus.append('ligne %d : date illisible' % n)
            continue
        if jour < DATE_MIN or jour > demain:
            refus.append('ligne %d : date invraisemblable (%s)' % (n, jour.isoformat()))
            continue
        objet = nettoyer(' '.join(morceaux[2:]), OBJET_MAX)
        cle_vue = (adr, jour, objet)
        if cle_vue in vus:
            continue
        vus.add(cle_vue)
        bons.append((adr, hote, jour, objet))
    return bons, refus


def regrouper(bons):
    """[(adresse, hôte, date, objet)] -> (fournisseurs triés, nombre de mails de webmails ignorés, mails de processeurs sans vendeur lisible)."""
    groupes, webmails, sans_vendeur = {}, 0, 0
    for adr, hote, jour, objet in bons:
        dom = domaine_enregistrable(hote)
        if dom in WEBMAILS:
            webmails += 1
            continue
        if dom in PROCESSEURS:
            v = vendeur_dans_objet(objet)
            if not v:
                sans_vendeur += 1
                continue
            cle, nom = '%s:%s' % (dom, slug(v)), v
            if len(cle) < 3 or not slug(v):
                sans_vendeur += 1
                continue
        else:
            cle, nom = dom, nom_depuis_domaine(dom)
        g = groupes.setdefault(cle, {'cle': cle, 'nom': nom[:80], 'domaine': dom, 'adresses': Counter(), 'mails': 0, 'premier_mail': jour,
                                     'dernier_mail': jour, 'exemple_objet': objet, '_dernier': jour})
        g['mails'] += 1
        g['adresses'][adr] += 1
        if jour < g['premier_mail']:
            g['premier_mail'] = jour
        if jour >= g['_dernier']:
            g['_dernier'], g['dernier_mail'], g['exemple_objet'] = jour, jour, objet
    sortie = []
    for g in groupes.values():
        sortie.append({'cle': g['cle'], 'nom': g['nom'], 'domaine': g['domaine'], 'expediteur': g['adresses'].most_common(1)[0][0],
                       'mails': g['mails'], 'premier_mail': g['premier_mail'], 'dernier_mail': g['dernier_mail'],
                       'exemple_objet': g['exemple_objet'], 'lecteur': g['domaine'] in LECTEURS and g['domaine'] not in PROCESSEURS})
    sortie.sort(key=lambda f: (-f['mails'], f['nom'].lower()))
    return sortie, webmails, sans_vendeur


def en_json(o):
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, list):
        return [en_json(x) for x in o]
    if isinstance(o, dict):
        return {k: en_json(v) for k, v in o.items()}
    return o


# ----------------------------------------------------------------------------------------------------------------- base


def trouver_projet(base, slug_projet):
    p = base.lire('projets', [('slug', 'eq.' + slug_projet)], 'id,slug,nom')
    if not p:
        raise Configuration('Projet inconnu : « %s ».' % slug_projet)
    return p[0]


def demande_ouverte(base, projet):
    r = base.lire('recherches_fournisseurs', [('projet_id', 'eq.' + projet['id']), ('statut', 'in.(en_attente,en_cours)')],
                  'id,statut,demandee_at,demandee_par,pris_par,pris_at')
    return r[0] if r else None


def maintenant():
    return datetime.now(timezone.utc).isoformat()


def etat(args):
    base = Base()
    projet = trouver_projet(base, args.projet)
    d = demande_ouverte(base, projet)
    connus = base.lire('fournisseurs_detectes', [('projet_id', 'eq.' + projet['id'])], 'cle,statut')
    print(json.dumps({
        'projet': projet['slug'], 'demande': d,
        'fournisseurs_connus': {s: sum(1 for c in connus if c['statut'] == s) for s in ('nouveau', 'suivi', 'ignore')},
        'gmail': {'requetes': REQUETES_GMAIL, 'pages_max': PAGES_MAX, 'par_page': 50, 'vue': 'THREAD_VIEW_MINIMAL',
                  'regle': "search_threads SEULEMENT (pas de get_thread : aucun mail n'est ouvert). Pour chaque fil, UNE ligne dans /tmp/fournisseurs.tsv : "
                           "sender<TAB>AAAA-MM-JJ (date du premier message du fil)<TAB>subject. Ne copie PAS le snippet. Les deux requêtes dans le même fichier."},
    }, ensure_ascii=False, indent=2))
    return 0


def prendre(args):
    base = Base()
    projet = trouver_projet(base, args.projet)
    d = demande_ouverte(base, projet)
    session = (args.session or 'session')[:80]
    if d is None:
        if args.essai:
            print(json.dumps({'statut': 'creerait_une_demande', 'essai': True}))
            return 0
        crees = base.ecrire('POST', 'recherches_fournisseurs', {'projet_id': projet['id'], 'statut': 'en_cours', 'demandee_par': 'session',
                                                                'pris_par': session, 'pris_at': maintenant()})
        print(json.dumps({'statut': 'en_cours', 'demande': crees[0]['id'], 'creee_par_la_session': True}))
        return 0
    perimee = False
    if d['statut'] == 'en_cours' and d.get('pris_at'):
        try:
            perimee = datetime.now(timezone.utc) - IMP.datetime.fromisoformat(str(d['pris_at']).replace('Z', '+00:00')) > timedelta(hours=PRISE_PERIMEE_H)
        except ValueError:
            perimee = True
    if d['statut'] == 'en_cours' and not perimee:
        print(json.dumps({'statut': 'en_cours', 'demande': d['id'], 'deja_prise_par': d.get('pris_par')}))
        return 0
    if not args.essai:
        base.ecrire('PATCH', 'recherches_fournisseurs', {'statut': 'en_cours', 'pris_par': session, 'pris_at': maintenant()}, [('id', 'eq.' + d['id'])], retour=False)
    print(json.dumps({'statut': 'en_cours', 'demande': d['id'], 'essai': bool(args.essai)}))
    return 0


def liste(args):
    with open(args.liste, encoding='utf-8', errors='replace') as fh:
        bons, refus = lire_lignes(fh.read())
    fournisseurs, webmails, sans_vendeur = regrouper(bons)
    if not bons:
        raise Refus('aucune ligne exploitable dans %s%s' % (args.liste, (' (' + refus[0] + ')') if refus else ''))
    base = Base()
    projet = trouver_projet(base, args.projet)
    d = demande_ouverte(base, projet)
    existants = {c['cle']: c['statut'] for c in base.lire('fournisseurs_detectes', [('projet_id', 'eq.' + projet['id'])], 'cle,statut')}
    nouveaux = [f for f in fournisseurs if f['cle'] not in existants]
    resume = {'mails_lus': len(bons), 'fournisseurs': len(fournisseurs), 'nouveaux': len(nouveaux), 'webmails_ignores': webmails,
              'processeurs_sans_vendeur': sans_vendeur, 'lignes_refusees': len(refus), 'exemples_refus': refus[:5], 'demande': d['id'] if d else None}
    if args.essai:
        print(json.dumps({**resume, 'essai': True, 'fournisseurs_liste': en_json(fournisseurs)}, ensure_ascii=False))
        return 0
    if d is None:
        crees = base.ecrire('POST', 'recherches_fournisseurs', {'projet_id': projet['id'], 'statut': 'en_cours', 'demandee_par': 'session',
                                                                'pris_par': (args.session or 'session')[:80], 'pris_at': maintenant()})
        d = {'id': crees[0]['id']}
        resume['demande'] = d['id']
    lot = [{'projet_id': projet['id'], 'cle': f['cle'], 'nom': f['nom'], 'domaine': f['domaine'], 'expediteur': f['expediteur'], 'mails': f['mails'],
            'premier_mail': f['premier_mail'].isoformat(), 'dernier_mail': f['dernier_mail'].isoformat(), 'exemple_objet': f['exemple_objet'] or None,
            'lecteur': f['lecteur'], 'recherche_id': d['id']} for f in fournisseurs]
    # `statut` et `service_id` ne sont PAS dans le lot : un fournisseur déjà suivi ou ignoré le reste (la fusion ne touche que ces colonnes).
    for i in range(0, len(lot), 100):
        base.ecrire('POST', 'fournisseurs_detectes', lot[i:i + 100], [('on_conflict', 'projet_id,cle')], retour=False, prefer='resolution=merge-duplicates,return=minimal')
    note = '%d fournisseur%s trouvé%s dont %d nouveau%s (%d mails vus' % (len(fournisseurs), 's' if len(fournisseurs) > 1 else '', 's' if len(fournisseurs) > 1 else '',
                                                                       len(nouveaux), 'x' if len(nouveaux) > 1 else '', len(bons))
    if webmails:
        note += ', %d de particuliers écartés' % webmails
    if sans_vendeur:
        note += ', %d reçus sans nom de vendeur' % sans_vendeur
    note += ')'
    base.ecrire('PATCH', 'recherches_fournisseurs', {'statut': 'terminee', 'fini_at': maintenant(), 'trouves': len(fournisseurs), 'nouveaux': len(nouveaux), 'note': note[:300]},
                [('id', 'eq.' + d['id'])], retour=False)
    print(json.dumps({**resume, 'statut': 'terminee', 'note': note[:300]}, ensure_ascii=False))
    return 0


def echec(args):
    base = Base()
    projet = trouver_projet(base, args.projet)
    d = demande_ouverte(base, projet)
    if d is None:
        raise Refus("aucune demande ouverte : rien à déclarer en échec (Raphaël n'a pas touché le bouton, ou une autre session l'a traitée)")
    if not args.essai:
        base.ecrire('PATCH', 'recherches_fournisseurs', {'statut': 'echec', 'fini_at': maintenant(), 'note': nettoyer(args.echec, 300)}, [('id', 'eq.' + d['id'])], retour=False)
    print(json.dumps({'statut': 'echec', 'demande': d['id'], 'note': nettoyer(args.echec, 300), 'essai': bool(args.essai)}, ensure_ascii=False))
    return 0


def main():
    ap = argparse.ArgumentParser(description='Recherche des fournisseurs de factures (bouton de Coûts).')
    ap.add_argument('--projet', default=os.environ.get('COCKPIT_PROJET') or 'cockpit')
    ap.add_argument('--session', default=os.environ.get('CLAUDE_CODE_SESSION_ID', ''))
    ap.add_argument('--etat', action='store_true')
    ap.add_argument('--prendre', action='store_true')
    ap.add_argument('--liste')
    ap.add_argument('--echec')
    ap.add_argument('--regrouper')
    ap.add_argument('--essai', action='store_true')
    args = ap.parse_args()
    try:
        if args.regrouper:
            with open(args.regrouper, encoding='utf-8', errors='replace') as fh:
                bons, refus = lire_lignes(fh.read())
            fournisseurs, webmails, sans_vendeur = regrouper(bons)
            print(json.dumps(en_json({'fournisseurs': fournisseurs, 'mails_lus': len(bons), 'webmails_ignores': webmails, 'processeurs_sans_vendeur': sans_vendeur,
                                      'lignes_refusees': refus}), ensure_ascii=False, indent=2))
            return 0
        if args.etat:
            return etat(args)
        if args.prendre:
            return prendre(args)
        if args.liste:
            return liste(args)
        if args.echec:
            return echec(args)
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
