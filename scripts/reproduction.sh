#!/usr/bin/env bash
# Ce qu'il faut pour REJOUER la demande d'un utilisateur (D-05) : ce que le
# module embarqué a capturé quand il a envoyé sa demande ou sa correction
# (page, appareil, version servie, ses 20 dernières actions, les erreurs
# JavaScript de la page), lu en clair pour une session.
#
#   scripts/reproduction.sh --chantier <id>   # affiche la reproduction
#   scripts/reproduction.sh --ligne <id>      # une ligne pour la consigne d'un agent (rien s'il n'y en a pas)
#
# Rejouer : ouvre l'adresse (déjà nettoyée de ses jetons) et refais les étapes.
# Les clics ne se rejouent PAS tout seuls (v1). Colonne chantiers.reproduction,
# écrite par la fonction serveur cockpit-embed (supabase/functions/cockpit-embed/reproduction.ts).
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${COCKPIT_SQL:-$ICI/sql.sh}"
uuid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
mode="${1:-}"; id="${2:-}"
case "$mode" in
  --chantier|--ligne) [[ "$id" =~ $uuid ]] || { echo "$mode <id du chantier>" >&2; exit 2; } ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac

if [ "$mode" = "--ligne" ]; then
  # Jamais bloquant pour la consigne : au moindre souci, rien.
  a=$("$SQL" "select (reproduction is not null) as a from chantiers where id = '$id'" 2>/dev/null | jq -r '.rows[0].a // false' 2>/dev/null || echo false)
  [ "$a" = "true" ] && printf 'Scénario capturé chez l’utilisateur (page, appareil, version, ses dernières actions, erreurs) : %s --chantier %s — lis-le et REJOUE-le avant de corriger.\n' "${COCKPIT_REPRO_CMD:-scripts/reproduction.sh}" "$id"
  exit 0
fi

sortie=$("$SQL" "select c.titre, c.reproduction from chantiers c where c.id = '$id'")
REPRO_JSON="$sortie" python3 - <<'PY'
import json, os, sys
from datetime import datetime
from urllib.parse import urlsplit
j = json.loads(os.environ["REPRO_JSON"])
if not j.get("ok"):
    sys.exit("Erreur de la base : " + str(j.get("error")))
rows = j.get("rows") or []
if not rows:
    sys.exit("Chantier introuvable.")
titre, r = rows[0].get("titre"), rows[0].get("reproduction")
if not isinstance(r, dict):
    print("« %s » : aucune reproduction capturée (demande faite hors du module embarqué, ou capture désactivée)." % titre)
    sys.exit(0)
def s(v):
    return v.strip() if isinstance(v, str) else ""
def heure(v):
    try:
        return datetime.fromisoformat(s(v).replace("Z", "+00:00")).astimezone().strftime("%d/%m %H:%M:%S")
    except Exception:
        return ""
page, ecran, app = r.get("page") or {}, r.get("ecran") or {}, r.get("appareil") or {}
url = s(page.get("url"))
origine = "{0.scheme}://{0.netloc}".format(urlsplit(url)) if url.startswith(("http://", "https://")) else ""
moment = "lors de la correction" if r.get("contexte") == "correction" else "lors de la demande"
print("Pour reproduire « %s » (%s, %s)" % (titre, moment, heure(r.get("heure") or r.get("recu_at")) or "heure inconnue"))
print("  Page      : %s — %s" % (s(page.get("titre")) or "(sans titre)", url or "(adresse inconnue)"))
if ecran.get("largeur") and ecran.get("hauteur"):
    taille = "%s × %s (×%s)" % (ecran.get("largeur"), ecran.get("hauteur"), ecran.get("ratio") or 1)
else:
    taille = "inconnu"
print("  Appareil  : %s — écran %s%s" % (s(app.get("resume")) or "inconnu", taille, " — tactile" if app.get("tactile") else ""))
print("  Navigateur: %s" % (s(app.get("ua")) or "inconnu"))
print("  Langue    : %s — fuseau %s" % (s(r.get("langue")) or "?", s(r.get("fuseau")) or "?"))
print("  Version   : %s" % (s(r.get("version")) or "inconnue (pas de /health ni de data-version)"))
actions = [a for a in (r.get("actions") or []) if isinstance(a, dict)]
print("  Étapes (les plus anciennes d’abord) :" if actions else "  Étapes    : aucune action notée.")
VERBES = {"lien": "Touche le lien", "case": "Coche ou décoche", "champ": "Touche le champ", "onglet": "Ouvre l’onglet"}
for i, a in enumerate(actions, 1):
    lib, quoi, t = s(a.get("libelle")), s(a.get("quoi")), a.get("type")
    if t == "page":
        texte = "Ouvre la page " + ((lib[len(origine):] or "/") if origine and lib.startswith(origine) else lib)
    elif t == "saisie":
        texte = "Remplit le champ « %s » (valeur jamais capturée)" % lib
    else:
        texte = VERBES.get(quoi, "Touche le bouton") + (" « %s »" % lib if lib else "")
    print("    %2d. [%s] %s" % (i, heure(a.get("t")) or "?", texte))
erreurs = [e for e in (r.get("erreurs") or []) if isinstance(e, dict)]
if erreurs:
    print("  Erreurs JavaScript de la page (%d) :" % len(erreurs))
    for e in erreurs:
        src = s(e.get("source"))
        print("    - [%s] %s%s" % (heure(e.get("t")) or "?", s(e.get("message")), " (%s)" % src if src else ""))
else:
    print("  Erreurs   : aucune erreur JavaScript notée.")
print("Rejouer : ouvre l’adresse ci-dessus sur un écran de même taille, refais les étapes, compare. Les clics ne se rejouent pas tout seuls.")
if not url:
    print("Pas d’adresse à rouvrir : prends les étapes ci-dessus comme TEST SYNTHÉTIQUE (même scénario écrit que « Copier le test synthétique » dans l’app).")
PY
