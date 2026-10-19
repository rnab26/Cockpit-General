#!/usr/bin/env python3
"""Battement machine (0104, chantier a33cf882) : un calcul tourne-t-il VRAIMENT pour cette session ?

Pourquoi (Raphaël, 19 oct. 2026) : « sur FacePro, des choses progressent par des agents ou des calculs en arrière-plan (CPU) : la
session n'est pas en mode actif mais le travail avance. » Entre deux appels d'outils, une session qui attend un calcul ne déclenche
AUCUN hook : le cockpit la croyait muette. Ce petit processus, lancé détaché par hooks/suivi.sh, mesure le temps CPU des processus
de la session (lus dans /proc, aucun jeton) et le remonte à la base (`signaler_machine`) tant qu'il y en a ; la règle `etat_session`
fait le reste. ÉTEINT par défaut : la base répond « eteint » à la première mesure et le processus s'arrête (réglage du projet).

Quels processus : ceux dont l'environnement porte CLAUDE_CODE_SESSION_ID=<la session> (ils le gardent même après setsid / nohup /
reparentage : un calcul lancé détaché reste le sien), plus les descendants du processus Claude. Sont exclus : le processus Claude
lui-même, ce battement, ses ancêtres, et les enfants directs de Claude qui ne sont pas des shells (serveurs MCP) avec leurs descendants.
Limite : un processus lancé hors de la session (autre conteneur, service externe, GPU distant) ne se voit pas ; un conteneur récupéré
efface tout (la session n'existe plus). Une session sans hook ne lance jamais ce battement.

  machine.py --projet SLUG --session ID --sql CHEMIN_SQL.SH [--claude-pid N] [--pas S]    # battement (détaché par le hook)
  machine.py --mesurer [--session ID] [--claude-pid N] [--pas S]                             # une mesure, sans base (essai)
Sortie 0 toujours en mode battement : il ne doit JAMAIS gêner une session.
"""
import argparse, json, os, subprocess, sys, time

CLK = os.sysconf('SC_CLK_TCK')
SHELLS = {'bash', 'sh', 'dash', 'zsh', 'fish'}


def lire_stat(pid):
    """(ppid, ticks utime+stime, starttime, comm) ou None. Le nom peut contenir espaces et parenthèses : on coupe au DERNIER ')'."""
    try:
        with open(f'/proc/{pid}/stat', 'rb') as f:
            brut = f.read().decode('utf-8', 'replace')
    except OSError:
        return None
    a, z = brut.find('('), brut.rfind(')')
    if a < 0 or z < 0:
        return None
    champs = brut[z + 2:].split()
    try:
        return int(champs[1]), int(champs[11]) + int(champs[12]), int(champs[19]), brut[a + 1:z]
    except (IndexError, ValueError):
        return None


def porte_la_session(pid, sid):
    try:
        with open(f'/proc/{pid}/environ', 'rb') as f:
            return f'CLAUDE_CODE_SESSION_ID={sid}'.encode() in f.read().split(b'\0')
    except OSError:
        return False


def processus():
    """pid -> (ppid, ticks, start, comm) pour tous les processus lisibles."""
    out = {}
    for nom in os.listdir('/proc'):
        if nom.isdigit():
            s = lire_stat(int(nom))
            if s:
                out[int(nom)] = s
    return out


def ancetres(pid, table):
    vus = set()
    while pid and pid not in vus and pid in table:
        vus.add(pid)
        pid = table[pid][0]
    return vus


def descendants(racine, table):
    enfants = {}
    for p, (pp, *_r) in table.items():
        enfants.setdefault(pp, []).append(p)
    out, pile = set(), list(enfants.get(racine, []))
    while pile:
        p = pile.pop()
        if p not in out:
            out.add(p)
            pile.extend(enfants.get(p, []))
    return out


def retenus(table, sid, claude_pid):
    """Les processus qui comptent comme « le travail de la session » (cf. l'en-tête)."""
    moi = ancetres(os.getpid(), table)
    exclus = set(moi)
    if claude_pid:
        exclus.add(claude_pid)
        for p, (pp, _t, _s, comm) in table.items():
            if pp == claude_pid and comm not in SHELLS:      # serveurs MCP et autres outils de Claude : pas du calcul
                exclus.add(p)
                exclus |= descendants(p, table)
    choix = set()
    if sid:
        choix |= {p for p in table if p not in exclus and porte_la_session(p, sid)}
    if claude_pid:
        choix |= {p for p in descendants(claude_pid, table) if p not in exclus}
    return {p: table[p] for p in choix - exclus}


def ticks_depuis(avant, apres):
    """Temps CPU (ticks) consommé entre deux mesures ; un pid réutilisé (autre starttime) repart de zéro."""
    total = 0
    for p, (_pp, t, st, _c) in apres.items():
        if p in avant and avant[p][2] == st:
            total += max(t - avant[p][1], 0)
        elif p not in avant:
            total += t        # lancé depuis la mesure précédente : tout son temps CPU est de l'intervalle
    return total


def mesure(sid, claude_pid, avant, t_avant):
    table = processus()
    ret = retenus(table, sid, claude_pid)
    t = time.time()
    pct = 0
    if avant is not None and t > t_avant:
        pct = int(round(100.0 * ticks_depuis(avant, ret) / CLK / (t - t_avant)))
    return ret, t, pct


def trouver_claude(pid, table):
    """Le processus « claude » : l'ancêtre le plus proche nommé ainsi ; sinon le pid donné (le hook l'a reçu de son parent)."""
    for p in ancetres(pid, table):
        if table[p][3] == 'claude':
            return p
    return pid


def appeler(sql, projet, sid, pct, procs):
    req = "select cockpit.signaler_machine('%s', '%s', %d, %d) as r" % (projet.replace("'", "''"), sid.replace("'", "''"), pct, procs)
    env = dict(os.environ, COCKPIT_FILE_ATTENTE='/proc/cockpit-sans-file', COCKPIT_PROJET=projet)   # jamais rejoué plus tard : une mesure périmée ne prouve rien
    try:
        r = subprocess.run([sql, req], capture_output=True, text=True, timeout=20, env=env)
        return (json.loads(r.stdout).get('rows') or [{}])[0].get('r') or {}
    except Exception:
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--projet'); ap.add_argument('--session'); ap.add_argument('--sql'); ap.add_argument('--claude-pid', type=int, default=0)
    ap.add_argument('--pas', type=int, default=120); ap.add_argument('--mesurer', action='store_true'); ap.add_argument('--marque-eteint')

    a = ap.parse_args()
    if a.mesurer:
        r1, t1, _ = mesure(a.session, a.claude_pid, None, 0)
        time.sleep(a.pas)
        r2, t2, pct = mesure(a.session, a.claude_pid, r1, t1)
        print(json.dumps({'processus': len(r2), 'cpu_pct': pct, 'liste': sorted(f'{p}:{v[3]}' for p, v in r2.items())}, ensure_ascii=False))
        return 0
    if not (a.projet and a.session and a.sql):
        return 0
    if a.claude_pid:
        a.claude_pid = trouver_claude(a.claude_pid, processus())
    pas, avant, t_avant = a.pas, None, 0.0
    while True:
        if a.claude_pid and not os.path.exists(f'/proc/{a.claude_pid}'):
            return 0                                              # la session n'existe plus
        ret, t, pct = mesure(a.session, a.claude_pid, avant, t_avant)
        rep = appeler(a.sql, a.projet, a.session, pct, len(ret))
        if rep.get('etat') == 'eteint' and a.marque_eteint:
            try:
                open(a.marque_eteint, 'a').close(); os.utime(a.marque_eteint)    # le hook ne me relance pas avant un bon moment
            except OSError:
                pass
        if rep.get('etat') != 'ok':
            return 0                                              # éteint, projet ou session inconnus, base injoignable : on s'arrête, sans bruit
        pas = int(rep.get('pas_s') or pas)
        if not ret:
            return 0                                              # rien ne tourne pour cette session (la base l'a su par cette dernière mesure) : le prochain hook me relancera au besoin
        avant, t_avant = ret, t
        time.sleep(pas)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
