#!/usr/bin/env bash
# Rendre un VERDICT quand Raphaël a demandé « Je ne sais pas : vérifie pour moi »
# (migration 0016). Tu compares toi-même ce qu'il a collé (et ce que tu vois
# en vrai) au résultat attendu, et tu réponds en mots simples, preuve à l'appui.
#
#   scripts/verdict.sh --chantier <id> --bon "13 chantiers en 4 sections, 1 question : exactement la base."
#   scripts/verdict.sh --chantier <id> --pas-bon "Il manque la section Infra : le hook ne lit pas …"
#
# Bon → le chantier revient à Raphaël pour UN toucher (« Ça marche ») ;
# pas bon → il repart en correction (demande complétée, état libre).
set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
chantier=""; ok=""; texte=""
auteur="${COCKPIT_SESSION:-$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo session)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --chantier) chantier="${2:-}"; shift 2 ;;
    --bon)      ok=true; texte="${2:-}"; shift 2 ;;
    --pas-bon)  ok=false; texte="${2:-}"; shift 2 ;;
    -h|--help)  sed -n 2,11p "$0"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[[ "$chantier" =~ ^[0-9a-f-]{36}$ ]] || { echo "--chantier <id> manque." >&2; exit 2; }
[ -n "$ok" ] && [ -n "${texte// /}" ] || { echo "Donne --bon \"…\" ou --pas-bon \"…\" : ce que tu as constaté, en mots simples." >&2; exit 2; }
n=$(printf '%s' "$texte" | python3 -c 'import sys; print(len(sys.stdin.read()))')
[ "$n" -le 400 ] || { echo "Refusé (règle de clarté) : verdict de $n caractères, 400 au plus. Le constat, en mots simples ; le détail va dans le fil." >&2; exit 2; }
printf '%s\0' "le verdict" "$texte" | python3 "$(dirname "$0")/clarte.py" || exit 2
q() { printf '%s' "$1" | sed "s/'/''/g"; }
r=$("$SQL" "select rendre_verdict('$chantier'::uuid, '$(q "$auteur")', $ok, '$(q "$texte")') as r" | jq -r '.rows[0].r // empty')
[ -n "$r" ] || { echo "La base a refusé le verdict." >&2; exit 1; }
echo "Verdict enregistré : $r."
