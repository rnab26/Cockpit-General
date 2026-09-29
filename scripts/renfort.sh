#!/usr/bin/env bash
# SESSIONS DE RENFORT (29 sept. 2026, migration 0020 — brouillon, attend Raphaël).
# Une session cloud à part, ouverte par la chef d'un projet, qui ne traite QUE
# les chantiers d'une section, puis s'arrête.
#
#   scripts/renfort.sh --suivant <id>          (le renfort) chantier suivant de sa section, ou FINI
#   scripts/renfort.sh --session <id> <sess>   (la chef) note la session créée par create_session
#   scripts/renfort.sh --archive <id>          (la chef) note l'archivage (archive_session fait)
set -uo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
PROG="${COCKPIT_PROG_CMD:-scripts/progression.sh}"; DEM="${COCKPIT_DEM_CMD:-scripts/demander.sh}"
q() { printf '%s' "$1" | sed "s/'/''/g"; }
uuid='^[0-9a-f-]{36}$'
case "${1:-}" in
  --session)
    [[ "${2:-}" =~ $uuid ]] && [ -n "${3:-}" ] || { echo "--session <id renfort> <session_…>" >&2; exit 2; }
    "$SQL" "select renfort_session('$2', '$(q "$3")') as ok" | jq -e '.rows[0].ok == true' >/dev/null \
      && echo "Renfort $2 noté : $3." || { echo "Renfort $2 introuvable ou déjà noté." >&2; exit 1; } ;;
  --archive)
    [[ "${2:-}" =~ $uuid ]] || { echo "--archive <id renfort>" >&2; exit 2; }
    "$SQL" "select renfort_archive('$2') as ok" | jq -e '.rows[0].ok == true' >/dev/null \
      && echo "Renfort $2 archivé." || { echo "Renfort $2 introuvable ou déjà archivé." >&2; exit 1; } ;;
  --suivant)
    [[ "${2:-}" =~ $uuid ]] || { echo "--suivant <id renfort>" >&2; exit 2; }
    c=$("$SQL" "select prochain_chantier_renfort('$2') as c" 2>/dev/null | jq -c '.rows[0].c // empty')
    if [ -z "$c" ] || [ "$c" = "null" ]; then
      echo "FINI — plus aucun chantier dans ta section. Arrête-toi en une ligne : la chef archivera cette session."; exit 0
    fi
    printf '%s' "$c" | jq -r --arg prog "$PROG" --arg dem "$DEM" --arg rid "$2" '
"Chantier « \(.titre) » (id \(.id)), projet \(.slug), dépôt \(.depot), branche \(.branche) (réservée à toi).\(if .etat_avant == "en_cours" then " Il était abandonné : lis son fil et reprends où il en était." else "" end)
Demande :
\(.demande)

Règles : lis CLAUDE.md et docs/REPRISE.md. Crée la branche \(.branche) (jamais main). À chaque étape : COCKPIT_PROJET=\(.slug) \($prog) --agent \"Renfort : \(.titre)\" --chantier \(.id) --etape \"…\" --pct N --eta M. AUCUNE dépense, suppression ou envoi en son nom. Décision de Raphaël → COCKPIT_PROJET=\(.slug) \($dem) (règle de clarté), puis passe au suivant. Sinon mène-le au bout (tests, commit, push, fusion dans main si tout est vert, vérification en ligne, \($prog) --chantier \(.id) --termine … --verifier …). Puis relance scripts/renfort.sh --suivant \($rid)."' ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
