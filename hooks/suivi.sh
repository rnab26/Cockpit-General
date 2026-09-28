#!/usr/bin/env bash
# Hook de SUIVI : dit au cockpit, tout seul, quelle session travaille et
# quelles tâches elle a lancées en arrière-plan (agents, commandes longues).
# Déclaré par brancher.sh sur UserPromptSubmit, Stop, SubagentStart,
# SubagentStop, PostToolUse, StopFailure et SessionEnd.
#
# Pourquoi (Raphaël, 29 sept. 2026, capture du panneau « Tâches en
# arrière-plan » de FacePro) : « j'ai cinq agents […] c'est illisible,
# impossible de savoir ce qu'ils font, pas possible de voir leur progression ».
# La liste vient de Claude Code (entrée `background_tasks` du hook Stop), pas
# de la bonne volonté de la session. Étape, % et temps restant : c'est l'agent
# qui les signale (progression.sh --agent).
#
# Deux règles : ne JAMAIS ralentir ni faire échouer la session (tout part en
# arrière-plan, sortie 0 toujours), et ne pas bombarder la base (le simple
# « je suis vivante » d'un appel d'outil part au plus une fois par minute).
set -uo pipefail
entree=$(cat 2>/dev/null || true)
PROJET="${COCKPIT_PROJET:-}"
[ -n "$PROJET" ] && [ -n "$entree" ] || exit 0
RACINE="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
command -v jq >/dev/null || exit 0

ev=$(printf '%s' "$entree" | jq -r '.hook_event_name // empty' 2>/dev/null)
sid=$(printf '%s' "$entree" | jq -r '.session_id // empty' 2>/dev/null)
[ -n "$ev" ] && [ -n "$sid" ] || exit 0
branche=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "")

case "$ev" in
  PostToolUse)
    # Un lancement en arrière-plan (agent, commande) : on le dit tout de suite,
    # avec sa description. Sinon, un simple signe de vie, au plus 1 fois/minute.
    charge=$(printf '%s' "$entree" | jq -c --arg b "$branche" '
      def cle_id: [.. | objects | to_entries[] | select(.key | test("^(agentId|agent_id|taskId|task_id|backgroundTaskId|shellId|bash_id)$")) | .value | select(type == "string")][0];
      (.tool_input // {}) as $in
      | (if (.tool_name == "Agent" or .tool_name == "Task") then "agent"
         elif (.tool_name == "Bash" and ($in.run_in_background == true)) then "commande" else null end) as $type
      | if $type == null then null
        else {session_id, hook_event_name, branche: $b,
              tache_id: ((.tool_response // {}) | cle_id),
              tache_type: $type,
              tache_description: ($in.description // null),
              tache_sorte: (if $type == "agent" then ($in.subagent_type // null) else (($in.command // "") | .[0:200]) end)}
        end' 2>/dev/null)
    if [ -z "$charge" ] || [ "$charge" = "null" ] || [ "$(printf '%s' "$charge" | jq -r '.tache_id // empty')" = "" ]; then
      repere="${TMPDIR:-/tmp}/cockpit-vie-$sid"
      if [ -f "$repere" ] && [ $(( $(date +%s) - $(stat -c %Y "$repere" 2>/dev/null || echo 0) )) -lt 60 ]; then exit 0; fi
      touch "$repere" 2>/dev/null
      charge=$(jq -cn --arg s "$sid" --arg b "$branche" '{session_id: $s, hook_event_name: "Vie", branche: $b}')
    fi ;;
  UserPromptSubmit)
    charge=$(printf '%s' "$entree" | jq -c --arg b "$branche" '{session_id, hook_event_name, branche: $b, prompt: ((.prompt // "") | .[0:200])}') ;;
  StopFailure)
    # Une réponse arrêtée par une erreur : limite d'usage (rate_limit), facturation,
    # surcharge… Le cockpit affiche « En pause » jusqu'au prochain signe de vie.
    charge=$(printf '%s' "$entree" | jq -c --arg b "$branche" '{session_id, hook_event_name, branche: $b, error, error_details: ((.error_details // "") | tostring | .[0:400])}') ;;
  Stop|SubagentStop|SubagentStart|SessionEnd)
    charge=$(printf '%s' "$entree" | jq -c --arg b "$branche" '{session_id, hook_event_name, branche: $b, agent_id, agent_type, background_tasks}') ;;
  *) exit 0 ;;
esac

[ -n "$charge" ] || exit 0
q=$(printf '%s' "$charge" | sed "s/'/''/g")
# En arrière-plan et détaché : la session n'attend jamais le réseau.
( setsid "$SQL" "select suivre('$(printf '%s' "$PROJET" | sed "s/'/''/g")', '$q'::jsonb)" >/dev/null 2>&1 & ) >/dev/null 2>&1
exit 0
