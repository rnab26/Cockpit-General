#!/usr/bin/env python3
"""Fusion automatique des PR sûres : UNE règle d'éligibilité, UNE source (19 oct. 2026, chantier f4a4e3f3).

Raphaël : « concernant les PR on ne peut pas les automatiser ? ça me soûle à chaque fois de cliquer ».
Son choix : « Auto sauf PR sensibles ». Cette règle est lue par DEUX appelants, jamais recopiée :
  - .github/workflows/fusion-auto.yml (GitHub fusionne seul quand les contrôles sont verts) ;
  - scripts/pr-a-fusionner.sh (pas de carte « Fusionne » pour une PR qui se fusionne seule).

Entrée : les fichiers modifiés de la PR, un par ligne, sur stdin (renommage : l'ancien ET le nouveau nom).
Options : --branche <nom de la branche de la PR>  --meme-depot oui|non  (la PR vient-elle du MÊME dépôt ?)
Sortie (stdout, JSON) : {"decision": "auto"|"carte", "raison": "<mots simples>", "fichier": "<1er fichier hors liste>", "deploiement": bool, "delai_repli_min": n}
Code 0 toujours (sauf usage faux : 2). Dans le doute : « carte ».

Règle : LISTE BLANCHE. Un seul fichier hors liste blanche, ou sur la liste SENSIBLE, rend la PR sensible.
"""
import json
import re
import sys

# Branches éligibles : tête de PR dans le MÊME dépôt (jamais un fork) ET nom de cette forme.
BRANCHES_AUTO = [r"agent/.+", r"renfort/.+", r"claude/.+", r"worktree-.+"]

# Passé ce délai (minutes), une PR « auto » restée ouverte et propre redevient une carte « Fusionne » :
# l'interrupteur est éteint, ou la fusion automatique n'a pas pu se faire. Rien ne reste coincé en silence.
DELAI_REPLI_MIN = 20

# SENSIBLE : toujours une carte (testé AVANT la liste blanche). (motif complet du chemin, ce que Raphaël lit)
SENSIBLE = [
    (r"supabase/.*", "touche la base de données"),
    (r"hooks/.*", "touche les réglages automatiques des sessions"),
    (r"\.claude/.*", "touche les réglages de Claude"),
    (r"\.github/.*", "touche la mise en ligne et les contrôles automatiques"),
    (r"scripts/[^/]+\.(sh|py)", "touche les outils du cockpit"),
    (r"modeles/.*", "touche ce que les autres projets reçoivent"),
    (r"CLAUDE\.md|docs/bloc-CLAUDE\.md", "touche les règles du projet"),
    (r"embed/.*", "touche le module posé sur les sites"),
    (r"app/package(-lock)?\.json", "change les outils installés"),
]

# BLANCHE : seuls ces fichiers peuvent se fusionner seuls.
BLANCHE = [
    r"app/.*",
    r"docs/.*",
    r"scripts/verifier-[^/]+\.mjs",
]

# Ce que la mise en ligne (deploy.yml, bloc « paths ») sert : une fusion qui y touche relance le déploiement,
# car un push fait par GITHUB_TOKEN ne déclenche aucun autre workflow. verifier-fusion-auto.mjs compare cette liste à deploy.yml.
DEPLOIEMENT = [r"app/.*", r"embed/.*", r"\.github/workflows/deploy\.yml"]


def _ok(motifs, chemin):
    return any(re.fullmatch(m, chemin) for m in motifs)


def propre(chemin):
    """Chemin normal ? Refuse vide, absolu, « .. », caractères de contrôle."""
    return bool(chemin) and not chemin.startswith("/") and ".." not in chemin.split("/") and not re.search(r"[\x00-\x1f]", chemin)


def decider(fichiers, branche="", meme_depot=False):
    fichiers = [f.strip("\r") for f in fichiers if f.strip("\r") != ""]
    deploiement = any(_ok(DEPLOIEMENT, f) for f in fichiers)

    def r(decision, raison, fichier=""):
        return {"decision": decision, "raison": raison, "fichier": fichier, "deploiement": deploiement, "delai_repli_min": DELAI_REPLI_MIN}

    if not fichiers:
        return r("carte", "la liste des fichiers est vide ou illisible")
    if not meme_depot:
        return r("carte", "elle vient d'un autre dépôt")
    if not _ok(BRANCHES_AUTO, branche):
        return r("carte", "elle ne vient pas d'une session du cockpit")
    for f in fichiers:
        if not propre(f):
            return r("carte", "un nom de fichier est anormal")
    raisons = []
    for f in fichiers:
        for motif, quoi in SENSIBLE:
            if re.fullmatch(motif, f) and quoi not in raisons:
                raisons.append(quoi)
    if raisons:
        return r("carte", " ; ".join(raisons))
    hors = [f for f in fichiers if not _ok(BLANCHE, f)]
    if hors:
        return r("carte", "elle touche un fichier que le cockpit ne classe pas comme sûr", hors[0])
    return r("auto", "seulement l'écran, la documentation et les contrôles : sûr")


def main(argv):
    branche, meme = "", False
    i = 0
    while i < len(argv):
        if argv[i] == "--branche" and i + 1 < len(argv):
            branche = argv[i + 1]
            i += 2
        elif argv[i] == "--meme-depot" and i + 1 < len(argv) and argv[i + 1] in ("oui", "non"):
            meme = argv[i + 1] == "oui"
            i += 2
        else:
            print("Usage : fusion_auto.py --branche <nom> --meme-depot oui|non < liste-de-fichiers", file=sys.stderr)
            return 2
    print(json.dumps(decider(sys.stdin.read().split("\n"), branche, meme), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
