#!/usr/bin/env bash
# Branche CETTE session au cockpit, à la main (13 oct. 2026).
#
# Raphaël : « le projet Cockpit n'est pas branché, je ne sais pas pourquoi il s'est débranché ».
# Cause PROUVÉE le 13 oct. : les hooks du projet (.claude/settings.json) ne se chargent que si la session démarre DANS le
# dépôt. Une session ouverte sur PLUSIEURS dépôts (ici Cockpit-General + dotfiles) démarre dans /home/user : aucun hook ne
# tourne, donc ni l'état du cockpit dans le contexte, ni la session visible dans l'app (le projet paraît « débranché »), ni
# les rappels « un sujet = un fil », ni les réponses en direct.
#
# Cette commande fait à la main ce que fait le hook de démarrage : elle montre l'état du projet et déclare la session au
# cockpit. Elle ne remplace pas les hooks (pas de réponses en direct tant qu'elle n'est pas relancée) : elle évite surtout
# de travailler « à l'aveugle ». À lancer en PREMIER dans une session dont le contexte n'a reçu aucun bloc « Cockpit ».
#
# Usage : bash scripts/connecter.sh [--projet <slug>]      (depuis n'importe quel dossier : le dépôt est celui du script)
set -uo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJET=""
DEPOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --projet) PROJET="${2:-}"; shift 2 ;;
    --depot) DEPOT="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,16p "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Argument inconnu : $1 (usage : connecter.sh [--projet <slug>])" >&2; exit 2 ;;
  esac
done
[ -n "$DEPOT" ] || DEPOT="$ICI"   # le dépôt du PROJET (hooks, réglages) ; $ICI reste celui du cockpit (sql.sh central)
command -v jq >/dev/null || { echo "jq manque dans cet environnement : impossible de brancher la session." >&2; exit 1; }
[ -n "$PROJET" ] || PROJET="${COCKPIT_PROJET:-}"
[ -n "$PROJET" ] || PROJET=$(jq -r '.env.COCKPIT_PROJET // empty' "$DEPOT/.claude/settings.json" 2>/dev/null)
[ -n "$PROJET" ] || { echo "Projet inconnu : donne-le (--projet <slug>) ou lance ce script depuis le dépôt d'un projet branché." >&2; exit 2; }
HOOK="$DEPOT/hooks/session-start.sh"
[ -f "$HOOK" ] || HOOK="$DEPOT/.claude/hooks/cockpit-session-start.sh"
[ -f "$HOOK" ] || { echo "Hook de démarrage introuvable dans $DEPOT : le projet n'est pas branché (scripts/brancher.sh)." >&2; exit 1; }

SID="${CLAUDE_CODE_SESSION_ID:-}"
BRANCHE=$(git -C "$DEPOT" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
entree=$(jq -cn --arg s "${SID:-manuel}" --arg c "$PWD" '{session_id: $s, hook_event_name: "SessionStart", cwd: $c, source: "connecter.sh"}')

# 1. L'état du projet : le MÊME texte que le hook de démarrage (et la preuve « branché » en base : branchement_vu_at).
contexte=$(printf '%s' "$entree" | CLAUDE_PROJECT_DIR="$DEPOT" COCKPIT_PROJET="$PROJET" bash "$HOOK" 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
if [ -z "$contexte" ]; then
  echo "Le hook de démarrage n'a rien rendu : base injoignable ou clé SUPABASE_SERVICE_ROLE_KEY absente. Rien n'est branché." >&2; exit 1
fi
# Le hook ne « plante » jamais : quand il ne peut pas charger le cockpit, il le dit dans son texte. Ce n'est PAS un branchement.
case "$contexte" in
  "Cockpit non chargé"*) printf '%s\nRien n'\''est branché.\n' "$contexte" >&2; exit 1 ;;
esac

# 2. La session visible dans l'app (comme le fait le hook de suivi à chaque appel d'outil).
declaree="non (CLAUDE_CODE_SESSION_ID absent : la session ne sera pas listée)"
if [ -n "$SID" ]; then
  charge=$(jq -cn --arg s "$SID" --arg b "$BRANCHE" '{session_id: $s, hook_event_name: "Vie", branche: $b, rattacher: "1"}')
  if "$ICI/scripts/sql.sh" "select suivre('$(printf '%s' "$PROJET" | sed "s/'/''/g")', '$(printf '%s' "$charge" | sed "s/'/''/g")'::jsonb)" 2>/dev/null | jq -e '.ok == true' >/dev/null 2>&1; then
    declaree="oui (session ${SID:0:8}, branche ${BRANCHE:-inconnue})"
  else
    declaree="non (la base n'a pas répondu)"
  fi
fi

# 2 bis. Présence : sans hook, le signe de vie ne se refait pas. Un petit processus détaché le refait tant que la session existe.
if [ -n "$SID" ] && [ -n "${CLAUDE_PID:-}" ] && [ -d "/proc/$CLAUDE_PID" ] && [ "${COCKPIT_PRESENCE:-on}" != "off" ]; then
  nohup setsid "$ICI/scripts/presence.sh" --projet "$PROJET" --session "$SID" --claude-pid "$CLAUDE_PID" --branche "$BRANCHE" >/dev/null 2>&1 </dev/null &
  declaree="$declaree ; présence suivie toutes les 2 min tant que la session est ouverte"
fi

# 3. Les hooks utilisateur (hooks/utilisateur.sh) retiennent ce choix pour toute la session : suivi, rappels, réponses en direct.
if [ -n "$SID" ]; then
  mkdir -p "${COCKPIT_HOME:-$HOME/.cockpit}/sessions" 2>/dev/null && printf '%s\n' "$DEPOT" >"${COCKPIT_HOME:-$HOME/.cockpit}/sessions/$SID.depot" 2>/dev/null
fi

printf '=== Session branchée au cockpit : projet « %s » — déclarée dans l'\''app : %s ===\n\n%s\n' "$PROJET" "$declaree" "$contexte"
