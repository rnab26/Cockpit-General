#!/usr/bin/env bash
# Présence d'une session SANS hooks (20 oct. 2026). Raphaël : « j'ai une session FacePro qui tourne depuis ce matin et aucune
# visibilité sur le cockpit… je veux ça peu importe le dépôt ». Une session ouverte sur plusieurs dépôts ne charge aucun hook
# (voir connecter.sh) : elle se déclarait une fois, puis redevenait « absente » après le délai. Ce petit processus DÉTACHÉ, lancé par
# connecter.sh, refait le signe de vie (le même appel `suivre … Vie` que le hook) tant que le processus Claude de la session existe,
# puis s'arrête seul. Sans jetons. Il dit « cette session est ouverte », pas « elle travaille » : le travail réel reste mesuré par
# les hooks (tour en cours) ou le battement machine ; sans hook, la session est « en veille » tant qu'elle est ouverte.
#
# Usage : presence.sh --projet SLUG --session ID --claude-pid N [--branche B] [--pas SECONDES]     (lancé par connecter.sh)
set -uo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJET=""; SID=""; CPID=""; BRANCHE=""; PAS="${COCKPIT_PRESENCE_PAS:-120}"
while [ $# -gt 0 ]; do
  case "$1" in
    --projet) PROJET="${2:-}"; shift 2 ;;
    --session) SID="${2:-}"; shift 2 ;;
    --claude-pid) CPID="${2:-}"; shift 2 ;;
    --branche) BRANCHE="${2:-}"; shift 2 ;;
    --pas) PAS="${2:-120}"; shift 2 ;;
    *) exit 0 ;;
  esac
done
[ -n "$PROJET" ] && [ -n "$SID" ] && [ -n "$CPID" ] || exit 0
command -v jq >/dev/null || exit 0
SQL="${COCKPIT_SQL:-$ICI/scripts/sql.sh}"
# Une seule présence par session : un 2e lancement laisse la première faire.
PIDF="${TMPDIR:-/tmp}/cockpit-presence-$SID.pid"
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null && [ "$(cat "$PIDF")" != "$$" ]; then exit 0; fi
printf '%s\n' "$$" >"$PIDF"
trap 'rm -f "$PIDF"' EXIT
esc() { printf '%s' "$1" | sed "s/'/''/g"; }
while [ -d "/proc/$CPID" ]; do
  charge=$(jq -cn --arg s "$SID" --arg b "$BRANCHE" '{session_id: $s, hook_event_name: "Vie", branche: $b}')
  "$SQL" "select suivre('$(esc "$PROJET")', '$(esc "$charge")'::jsonb)" >/dev/null 2>&1 || true
  sleep "$PAS"
done
exit 0
