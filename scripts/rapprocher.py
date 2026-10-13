#!/usr/bin/env python3
"""Rapprochement GitHub -> chantiers (migration 0080, chantier 6f112d51).

Raphaël : « les chantiers doivent être créés, fusionnés et mis à jour automatiquement […] mes chantiers ne sont pas à
jour ». Le cockpit croyait ce que les sessions DÉCLARENT ; ce script lit ce qu'elles ONT FAIT dans git, et la règle SQL
(`cockpit.rapprocher_depot`, UNE seule) passe « livré, à vérifier » les chantiers ouverts, que plus personne ne tient, dont le
travail est PROUVÉ dans main.

  rapprocher.py --projet facepro                 # dépôt = $CLAUDE_PROJECT_DIR (ou le dossier courant), écrit pour de bon
  rapprocher.py --projet facepro --essai         # ne touche à rien : dit ce qui serait fait
  rapprocher.py --projet facepro --si-ancien 20  # (hooks) sort sans rien faire si le dernier passage est trop récent : 20 min par défaut,
                                                 # ou le délai du PROJET (`rapprochement_passage_min`, noté dans le repère après chaque passage) ;
                                                 # sort aussi si le rapprochement est éteint pour ce projet ou pour TOUS (interrupteur général)

Rien n'est lu ni modifié dans la copie de travail de la session : un petit clone SANS fichiers (commits et arbres seulement)
est gardé à part dans ~/.cache/cockpit-general/depots/<projet>. Jamais « validé » (seul Raphaël). Ne fait jamais échouer un hook.
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOURS_MAX = 60          # on ne remonte jamais plus loin dans l'historique
DUREE_MAX_S = 150       # budget total d'un passage : au-delà, on garde ce qu'on a et on s'arrête
DEBUT = time.time()
CONTEXTE = {'projet': None, 'ecrire': False}   # rempli quand le projet est connu : un échec réel est alors noté en base
BRANCHE_REELLE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]*$')


def delai_du_repere(repere, defaut):
    """Le délai du projet (minutes) que le passage précédent a noté dans le repère ; à défaut ou illisible, celui des hooks (aucun appel à la base)."""
    try:
        n = int(open(repere, encoding='utf-8').read().strip())
        return n if 5 <= n <= 1440 else defaut
    except (OSError, ValueError):
        return defaut


def parse_iso(s):
    """Date ISO de Postgres ou de git -> datetime avec fuseau (les fractions à 1-5 chiffres ne passent pas fromisoformat avant 3.11)."""
    s = (s or '').strip().replace(' ', 'T')
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    m = re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:?\d{2})?$', s)
    if not m:
        raise ValueError('date illisible : %r' % s)
    base, frac, tz = m.group(1), m.group(2) or '', m.group(3) or '+00:00'
    frac = (frac + '000000')[:7] if frac else ''
    if re.match(r'^[+-]\d{4}$', tz):
        tz = tz[:3] + ':' + tz[3:]
    return datetime.fromisoformat(base + frac + tz)


def iso(d):
    return d.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def sh(args, cwd=None, timeout=60, entree=None):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, input=entree,
                           env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, '', 'délai dépassé : ' + ' '.join(args[:4])
    except OSError as e:
        return 127, '', str(e)


def git(depot, *args, timeout=60):
    return sh(['git', '-C', depot] + list(args), timeout=timeout)


def a_du_temps():
    return time.time() - DEBUT < DUREE_MAX_S


def sql(requete):
    """Une requête sur la base du cockpit, par scripts/sql.sh ; rend les lignes (liste de dicts)."""
    chemin = os.environ.get('COCKPIT_SQL') or os.path.join(RACINE, 'scripts', 'sql.sh')
    rc, out, err = sh(['bash', chemin], timeout=120, entree=requete)
    if rc != 0:
        raise RuntimeError('sql.sh a échoué (%s) : %s' % (rc, (err or out).strip()[:300]))
    try:
        d = json.loads(out)
    except ValueError:
        raise RuntimeError('réponse de la base illisible : ' + out[:200])
    if not d.get('ok', False):
        raise RuntimeError('la base refuse : %s' % d.get('error', out[:200]))
    return d.get('rows') or []


def sans_nul(o):
    """Un caractère NUL (impossible dans un jsonb) retiré de tout texte venu de git, pour qu'un seul commit étrange ne fasse pas échouer le passage."""
    if isinstance(o, str):
        return o.replace('\x00', '')
    if isinstance(o, list):
        return [sans_nul(x) for x in o]
    if isinstance(o, dict):
        return {sans_nul(k): sans_nul(v) for k, v in o.items()}
    return o


def masquer(texte):
    """Rien de secret dans un message d'erreur qui part en base, à l'écran ou dans un journal : identifiants d'adresse, jetons GitHub, clés Supabase."""
    t = str(texte)
    t = re.sub(r'(?i)([a-z][a-z0-9+.-]*://)[^/@\s]+@', r'\1***@', t)
    t = re.sub(r'\bgh[pousr]_[A-Za-z0-9]{16,}', '***', t)
    t = re.sub(r'\bgithub_pat_[A-Za-z0-9_]{16,}', '***', t)
    t = re.sub(r'\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}', '***', t)
    t = re.sub(r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', '***', t)
    t = re.sub(r'(?i)\bauthorization\s*[:=]\s*(?:(?:bearer|basic|token)\s+)?\S+', 'Authorization: ***', t)
    t = re.sub(r'(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}', r'\1 ***', t)
    return t


def noter_echec(message):
    """Écrit POURQUOI le passage a échoué (l'écran « Chantiers et GitHub » l'affiche) ; sans effet pour un essai ou si la base est injoignable."""
    if not CONTEXTE.get('projet') or not CONTEXTE.get('ecrire'):
        return
    try:
        sql('select j from (select cockpit.noter_echec_rapprochement(%s, %s) as j) q' % (guillemets(CONTEXTE['projet']), guillemets(sans_nul(masquer(message))[:300])))
    except Exception:
        pass


def guillemets(s):
    return "'" + str(s).replace("'", "''") + "'"


def depot_github(url):
    """owner/repo d'une adresse GitHub ou d'un proxy de session (…/git/owner/repo) ; None sinon."""
    m = re.search(r'github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$', url or '')
    if m:
        return m.group(1) + '/' + m.group(2)
    m = re.search(r'/git/([^/\s]+)/([^/\s]+?)(?:\.git)?/?$', url or '')
    return (m.group(1) + '/' + m.group(2)) if m else None


def branche_par_defaut(url):
    rc, out, _ = sh(['git', 'ls-remote', '--symref', url, 'HEAD'], timeout=40)
    m = re.search(r'ref: refs/heads/(\S+)\s+HEAD', out or '')
    return m.group(1) if m else 'main'


def recuperer(cache, branche, depuis, timeout=60):
    """Met à jour origin/<branche> (commits et arbres, sans fichiers). Une histoire trop calme pour --shallow-since : 200 commits."""
    refspec = '+refs/heads/%s:refs/remotes/origin/%s' % (branche, branche)
    base = ['fetch', '--quiet', '--no-tags', '--filter=blob:none']
    rc, _, err = git(cache, *(base + ['--shallow-since=' + iso(depuis), 'origin', refspec]), timeout=timeout)
    if rc != 0:
        rc, _, err = git(cache, *(base + ['--depth=200', 'origin', refspec]), timeout=timeout)
    return rc == 0, err.strip()[:300]


def preparer_cache(cache, url, principale, depuis):
    """Un clone sans fichiers, isolé de la copie de travail ; mis à jour à chaque passage."""
    if not os.path.isdir(os.path.join(cache, '.git')):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        base = ['git', 'clone', '--quiet', '--filter=blob:none', '--no-checkout', '--no-tags', '--single-branch', '--branch', principale]
        rc, _, err = sh(base + ['--shallow-since=' + iso(depuis), url, cache], timeout=240)
        if rc != 0:
            sh(['rm', '-rf', cache])
            rc, _, err = sh(base + ['--depth=200', url, cache], timeout=240)
        if rc != 0:
            raise RuntimeError('clone impossible : ' + err.strip()[:300])
        return
    git(cache, 'remote', 'set-url', 'origin', url)
    ok, err = recuperer(cache, principale, depuis, timeout=240)
    if not ok:
        raise RuntimeError('mise à jour impossible : ' + err)


def moment_dans_main(cache, principale, t, premiere_ligne):
    """Quand main a-t-il reçu le commit t ? Lui-même s'il a été poussé tout droit sur main, sinon la première fusion qui le contient."""
    rc, _, _ = git(cache, 'merge-base', '--is-ancestor', t, 'origin/' + principale)
    if rc != 0:
        return None
    premier = t
    if t not in premiere_ligne:
        rc, out, _ = git(cache, 'rev-list', '--first-parent', '--reverse', '--ancestry-path', '%s..origin/%s' % (t, principale))
        premier = (out.split() or [t])[0]
    rc, out, _ = git(cache, 'log', '-1', '--format=%cI%x1f%s', premier)
    date, _, sujet = out.strip().partition('\x1f')
    return date, sujet


DOC = re.compile(r'(\.(md|txt|rst|adoc)$)|(^docs?/)|((^|/)(PROJECT_LOG|CHANGELOG|README|LICENSE)[^/]*$)', re.I)


def commit_de_code(cache, sha):
    """Un commit qui touche autre chose que du texte (journal, notes, docs) : seul du code prouve qu'on a TRAVAILLÉ sur le chantier."""
    rc, out, _ = git(cache, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha)
    fichiers = [f for f in out.splitlines() if f.strip()]
    return rc == 0 and any(not DOC.search(f) for f in fichiers)


def preuve_jalon(cache, principale, question, depot, premiere_ligne):
    """Preuve 0 : le commit que la session avait elle-même signalé « envoyé » (jalon pousse) est dans main."""
    m = re.search(r'\b[0-9a-f]{7,40}\b', question.get('pousse') or '')
    if not m:
        return None
    rc, out, _ = git(cache, 'rev-parse', '--verify', '--quiet', m.group(0) + '^{commit}')
    if rc != 0 or not out.strip():
        return None
    t = out.strip()
    quand = moment_dans_main(cache, principale, t, premiere_ligne)
    if not quand:
        return None
    return {'regle': 'jalon', 'n': 1, 'sha': t, 'date': quand[0], 'sujet': quand[1], 'url': 'https://github.com/%s/commit/%s' % (depot, t)}


def travail_de_branche(cache, principale, question, depot, depuis, premiere_ligne, fetchees):
    """Preuve 1 : le travail de CODE fait sur la branche du chantier (depuis sa création, jusqu'à sa dernière trace) est dans main."""
    b = question.get('pris_par') or ''
    if not BRANCHE_REELLE.match(b) or b.startswith(('session-', 'worktree-agent-')) or b == principale:
        return None
    if b not in fetchees:
        fetchees[b] = recuperer(cache, b, depuis)[0] if a_du_temps() else False
    if not fetchees[b]:
        return None  # branche supprimée ou jamais poussée : pas de preuve par cette voie
    cree = parse_iso(question['created_at'])
    trace = parse_iso(question['derniere_trace'])
    rc, out, _ = git(cache, 'rev-list', '--max-count=200', 'origin/' + b, '--since=' + iso(cree - timedelta(minutes=5)),
                     '--until=' + iso(trace + timedelta(minutes=10)))
    commits = [c for c in out.split() if commit_de_code(cache, c)] if rc == 0 else []
    if not commits:
        return None  # aucun commit de code depuis la création du chantier : rien n'a été fait pour lui
    t = commits[0]  # le plus récent
    quand = moment_dans_main(cache, principale, t, premiere_ligne)
    if not quand:
        return None  # son travail n'est pas dans main (PR ouverte, branche pas fusionnée)
    return {'regle': 'branche', 'n': len(commits), 'sha': t, 'date': quand[0], 'sujet': quand[1],
            'url': 'https://github.com/%s/commit/%s' % (depot, t)}


def analyser_historique(texte, depot):
    """Les fusions de main (PR GitHub, fusions à la main, squash) lues dans `git log` ; format : sha US date US sujet US corps RS."""
    fusions = []
    for bloc in texte.split('\x1e'):
        if not bloc.strip():
            continue
        champs = bloc.strip('\n').split('\x1f')
        if len(champs) < 4:
            continue
        sha, date, sujet, corps = champs[0].strip(), champs[1].strip(), champs[2].strip(), champs[3].strip()
        numero, branche, titre = None, None, None
        m = re.match(r'^Merge pull request #(\d+) from (\S+)', sujet)
        if m:
            numero = int(m.group(1))
            branche = m.group(2).split('/', 1)[1] if '/' in m.group(2) else m.group(2)
            titre = next((l.strip() for l in corps.splitlines() if l.strip()), None)
        else:
            m = re.search(r'\(#(\d+)\)\s*$', sujet)
            if m:
                numero = int(m.group(1))
                titre = sujet[:m.start()].strip()
            else:
                m = re.match(r"^Merge (?:remote-tracking )?(?:branch )?'?(?:origin/)?([A-Za-z0-9][A-Za-z0-9._/-]*)'?", sujet)
                if m:
                    branche = m.group(1)
        url = ('https://github.com/%s/pull/%d' % (depot, numero)) if numero else ('https://github.com/%s/commit/%s' % (depot, sha))
        fusions.append({'sha': sha, 'date': date, 'sujet': sujet[:300], 'corps': corps[:400], 'titre': (titre or '')[:300] or None,
                        'numero': numero, 'branche': branche, 'url': url})
    return fusions


def lire_fusions(cache, principale, depuis, depot):
    """Les PR fusionnées (et les fusions nommant une branche) de main : ce sont elles qui peuvent prouver un achèvement."""
    fmt = '%H%x1f%cI%x1f%s%x1f%b%x1e'
    rc, out, _ = git(cache, 'log', 'origin/' + principale, '--first-parent', '--since=' + iso(depuis), '--format=' + fmt, timeout=90)
    return [f for f in analyser_historique(out if rc == 0 else '', depot) if f['numero'] or f['branche']]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--projet', default=os.environ.get('COCKPIT_PROJET', ''))
    ap.add_argument('--depot-dir', default=os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd())
    ap.add_argument('--essai', action='store_true', help='ne rien écrire : dire ce qui serait fait')
    ap.add_argument('--json', action='store_true', help='rendre le résultat brut')
    ap.add_argument('--si-ancien', type=int, default=0, metavar='MIN', help='ne rien faire si le dernier passage date de moins de MIN minutes')
    ap.add_argument('--silencieux', action='store_true', help='rien à l\'écran, sauf ce qui a été fait')
    a = ap.parse_args()
    if not a.projet:
        print('Projet inconnu : --projet <slug> (ou COCKPIT_PROJET).', file=sys.stderr)
        return 2
    cache_racine = os.environ.get('COCKPIT_CACHE') or os.path.join(os.path.expanduser('~'), '.cache', 'cockpit-general')
    slug_sur = re.sub(r'[^A-Za-z0-9_.-]', '_', a.projet)
    repere = os.path.join(cache_racine, 'rapproche-%s.t' % slug_sur)
    if a.si_ancien and os.path.exists(repere) and time.time() - os.path.getmtime(repere) < delai_du_repere(repere, a.si_ancien) * 60:
        return 0
    os.makedirs(cache_racine, exist_ok=True)
    open(repere, 'a').close()
    os.utime(repere, None)  # posé AVANT : deux sessions qui démarrent ensemble ne le font pas deux fois

    ligne = sql('select slug, depot, rapprochement_auto, rapprochement_passage_min, (select rapprochement_actif from filet_reglage where id = 1) as global_actif '
               'from projets where slug = %s' % guillemets(a.projet))
    if not ligne:
        print('Projet inconnu dans le cockpit : %s' % a.projet, file=sys.stderr)
        return 2
    CONTEXTE['projet'], CONTEXTE['ecrire'] = a.projet, not a.essai
    if a.si_ancien and (ligne[0].get('rapprochement_auto') is False or ligne[0].get('global_actif') is False):
        return 0  # éteint sur ce projet (écran « Chantiers et GitHub ») ou pour TOUS (interrupteur général) : les hooks ne passent plus, un passage demandé à la main écrit toujours
    delai = ligne[0].get('rapprochement_passage_min')
    if isinstance(delai, int):
        try:
            with open(repere, 'w', encoding='utf-8') as f:
                f.write(str(delai))   # le prochain hook lit le délai de CE projet sans appeler la base
        except OSError:
            pass
    questions = sql('select j from (select cockpit.chantiers_a_rapprocher(%s) as j) q' % guillemets(a.projet))
    questions = (questions[0]['j'] if questions else None) or []
    depot = ligne[0].get('depot') or ''
    rc, url, _ = git(a.depot_dir, 'remote', 'get-url', 'origin')
    url = url.strip()
    if rc != 0 or not url:
        url = ('https://github.com/%s.git' % depot) if depot else ''
    if not url:
        print("Aucun dépôt git (pas d'« origin », pas de dépôt réglé dans le cockpit) : rien à rapprocher.", file=sys.stderr)
        return 0
    depot = depot or depot_github(url) or ''

    if not questions:
        if not a.essai:  # rien à prouver : on note quand même que le passage a eu lieu
            sql('select j from (select cockpit.rapprocher_depot(%s, %s::jsonb, true) as j) q' % (guillemets(a.projet), guillemets(json.dumps({'depot': depot}))))
        if not a.silencieux:
            print('Rapprochement GitHub (%s) : aucun chantier ouvert sans session à vérifier.' % a.projet)
        return 0

    plus_ancien = min(parse_iso(q['created_at']) for q in questions)
    depuis = max(plus_ancien - timedelta(days=2), datetime.now(timezone.utc) - timedelta(days=JOURS_MAX))
    cache = os.path.join(cache_racine, 'depots', slug_sur)
    principale = branche_par_defaut(url)
    preparer_cache(cache, url, principale, depuis)
    rc, out, _ = git(cache, 'rev-list', '--first-parent', 'origin/' + principale, '--since=' + iso(depuis), timeout=90)
    premiere_ligne = set(out.split()) if rc == 0 else set()

    par_chantier, fetchees = {}, {}
    for q in questions:
        r = preuve_jalon(cache, principale, q, depot, premiere_ligne) or travail_de_branche(cache, principale, q, depot, depuis, premiere_ligne, fetchees)
        if r:
            par_chantier[q['id']] = r
    fusions = lire_fusions(cache, principale, depuis, depot)
    faits = {'depot': depot, 'par_chantier': par_chantier, 'fusions': fusions}
    # Le texte des commits vient de git (donc parfois d'autrui) : il ne doit JAMAIS pouvoir fermer le guillemetage. Un délimiteur
    # aléatoire, vérifié absent de la charge, ne peut pas être deviné ni fabriqué (retirer « $faits$ » du texte en fabriquait un autre).
    charge = json.dumps(sans_nul(faits), ensure_ascii=False)
    balise = '$f' + secrets.token_hex(8) + '$'
    while balise in charge:
        balise = '$f' + secrets.token_hex(8) + '$'
    res = sql('select j from (select cockpit.rapprocher_depot(%s, %s%s%s::jsonb, %s) as j) q'
              % (guillemets(a.projet), balise, charge, balise, 'false' if a.essai else 'true'))[0]['j']
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return 0
    n = res.get('a_livrer', 0)
    if n or not a.silencieux:
        verbe = 'seraient livrés' if a.essai else 'livrés'
        print('Rapprochement GitHub (%s) : %d chantier(s) ouvert(s) sans session examiné(s), %d tenu(s) par une session vivante (laissés), %d %s.'
              % (a.projet, res.get('examines', 0), res.get('tenus_vivants', 0), n, verbe))
        for x in res.get('actions', []):
            print('  - « %s » : %s' % (x['titre'][:80], x['preuve']))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:  # jamais une panne de plus pour une session
        print('Rapprochement GitHub : %s' % masquer(e), file=sys.stderr)
        noter_echec(e)
        sys.exit(1)
