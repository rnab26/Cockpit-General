#!/usr/bin/env python3
"""Marche à suivre d'une action manuelle (0033) — contrôle et mise en forme.

Appelé par scripts/demander.sh. Entrée (stdin) : des champs séparés par NUL,
  <n liens> <lien>… <n étapes> <étape>… <n copier> <copier>…
Sortie : le JSON {liens:[{url,libelle}], etapes:[…], copier:[{libelle,texte}]}
à écrire dans messages.marche ; code 2 et un message clair s'il est refusé.

Raphaël (30 sept. 2026) : « des liens précis et les démarches précises pour
faire simplement des copier-coller ». D'où : une adresse https EXACTE (jamais
la page d'accueil du service), un geste par étape, un libellé pour chaque
texte à coller, et JAMAIS un secret (CLAUDE.md global : aucun secret en base).
"""
import json
import re
import sys

champs = sys.stdin.buffer.read().decode("utf-8").split("\0")[:-1]


def prendre():
    n = int(champs.pop(0))
    r = champs[:n]
    del champs[:n]
    return r


def refus(m):
    print("Refusé (marche à suivre) : " + m, file=sys.stderr)
    sys.exit(2)


# Motifs de jetons connus (OpenAI/Anthropic, Stripe, GitHub, JWT, AWS, Slack,
# Google, clé privée). Mieux vaut un faux refus qu'un secret dans la base.
SECRET = re.compile(
    r"(sk-[A-Za-z0-9_-]{16,}|[sr]k_(live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}"
    r"|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."
    r"|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY)"
)

liens, etapes, copier = prendre(), prendre(), prendre()
out = {"liens": [], "etapes": [], "copier": []}

for l in liens:
    url, _, lib = l.partition("|")
    url, lib = url.strip(), lib.strip()
    if not re.match(r"^https://[^\s/]+\.[^\s/]+(/\S*)?$", url):
        refus(f"« {url} » n'est pas une adresse https complète. Donne la page EXACTE où il agit.")
    if re.match(r"^https://[^/]+/?$", url):
        refus(f"« {url} » est la page d'accueil du service : donne la page EXACTE où il agit (réglages, formulaire…).")
    if len(url) > 500:
        refus("adresse de plus de 500 caractères.")
    if SECRET.search(url):
        refus("l'adresse contient un secret : jamais de clé dans le cockpit.")
    if len(lib) > 45:
        refus(f"le libellé du lien « {lib} » fait {len(lib)} caractères, 45 au plus.")
    out["liens"].append({"url": url, "libelle": lib or "Ouvrir la page"})

for e in etapes:
    e = re.sub(r"^\s*\d+\s*[.)-]\s*", "", e).strip()  # l'app numérote elle-même
    if not e:
        refus("une --etape est vide.")
    if len(e) > 160:
        refus(f"une étape fait {len(e)} caractères, 160 au plus : un geste par étape.")
    if SECRET.search(e):
        refus("une étape contient un secret : jamais de clé dans le cockpit.")
    out["etapes"].append(e)

for c in copier:
    lib, sep, txt = c.partition("|")
    if not sep:
        refus(f"--copier \"libellé|texte\" : il manque le « | » dans « {c[:40]} » (le libellé dit à quoi sert le texte).")
    lib = lib.strip()
    if not lib or len(lib) > 45:
        refus(f"le libellé « {lib} » d'un --copier fait 1 à 45 caractères.")
    if not txt.strip():
        refus(f"le texte à copier « {lib} » est vide.")
    if len(txt) > 4000:
        refus(f"le texte à copier « {lib} » fait {len(txt)} caractères, 4000 au plus.")
    if SECRET.search(txt):
        refus(f"« {lib} » ressemble à un secret (clé, jeton) : jamais dans le cockpit. Dis-lui où le trouver (--lien) et où le coller (--etape).")
    out["copier"].append({"libelle": lib, "texte": txt})

print(json.dumps(out, ensure_ascii=False))
