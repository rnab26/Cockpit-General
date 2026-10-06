#!/usr/bin/env python3
"""Règle de clarté, partie vocabulaire (Raphaël, 6 oct. 2026, chantier ca171345).

Raphaël : « du jargon, du charabia, des phrases répétitives : écris des phrases
simples qu'un jeune de 15 ans comprend, pour avancer, traiter ou tester ».
Les longueurs sont déjà limitées par les scripts ; ceci refuse le vocabulaire de
développeur dans ce qu'il LIT (questions, actions, étapes, « comment vérifier »,
résumés, réponses). UNE liste, ici ; les scripts l'appellent avant d'écrire.

Entrée (stdin) : des paires  nom NUL texte NUL …   Sortie : rien (code 0), ou un
message avec les mots à remplacer (code 2).
Ne sont PAS contrôlés : ce qui est entre « » (nom exact d'un bouton ou d'un
champ), les adresses https://, le code entre `…`. Détail technique : va dans le fil.
"""
import re
import sys

# mot (regex, insensible à la casse) -> ce qu'on écrit à la place
JARGON = [
    (r"endpoints?", "le service"),
    (r"payloads?", "les données envoyées"),
    (r"hooks?", "le réglage automatique"),
    (r"migrations?", "la mise à jour de la base"),
    (r"rpc", "la fonction de la base"),
    (r"triggers?|déclencheurs?", "la règle automatique"),
    (r"commits?", "la sauvegarde du travail"),
    (r"push(?:e[rz]?|é)?", "envoyer"),
    (r"merge[rz]?|mergé", "fusionner"),
    (r"rebase[rz]?", "remettre à jour"),
    (r"worktrees?", "la copie de travail"),
    (r"branches?", "la copie de travail"),
    (r"déploie[rz]?|déploy\w*|déploiements?", "mettre en ligne"),
    (r"ci|pipeline", "les contrôles automatiques"),
    (r"sql|schéma", "la base"),
    (r"api|http|json|jwt|rls|cors|tls|ssl|cdn|cron|webhook", "le service / la page"),
    (r"cache", "la mémoire du navigateur"),
    (r"refactor(?:iser|ing)?", "réorganiser"),
    (r"idempotent[es]?", "rejouable sans risque"),
    (r"stderr|stdout|exit code|timeout", "le message d'erreur / le délai"),
    (r"fix(?:er|é)?|bug", "le défaut"),
    (r"flag|env(?:ironnement)? vars?|variables? d'environnement", "le réglage"),
    (r"security definer|replica identity|backend|frontend|front|runtime", "le détail technique"),
    (r"scripts?", "l'outil"),
]
RE = [(re.compile(r"(?<![\w-])(?:" + m + r")(?![\w-])", re.I), r) for m, r in JARGON]
EFFACE = re.compile(r"«[^»]*»|https?://\S+|`[^`]*`|\"[^\"]*\"")

champs = sys.stdin.buffer.read().decode("utf-8").split("\0")
if champs and champs[-1] == "":
    champs.pop()
trouves = []
for i in range(0, len(champs) - 1, 2):
    nom, texte = champs[i], champs[i + 1]
    nu = EFFACE.sub(" ", texte)
    for rx, remplace in RE:
        m = rx.search(nu)
        if m:
            trouves.append((nom, m.group(0), remplace))
if trouves:
    vus, lignes = set(), []
    for nom, mot, rem in trouves:
        if (nom, mot.lower()) in vus:
            continue
        vus.add((nom, mot.lower()))
        lignes.append(f"  - {nom} : « {mot} » -> dis plutôt « {rem} »")
    print("Refusé (règle de clarté, vocabulaire) : Raphaël ne code pas. Réécris avec des mots qu'un jeune de 15 ans comprend, une idée par phrase, sans répéter la même formule d'une carte à l'autre :\n"
          + "\n".join(lignes[:6])
          + "\nLe nom exact d'un bouton se met entre « ». Le détail technique va dans le fil du chantier (--point), pas ici.", file=sys.stderr)
    sys.exit(2)
