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

# RÉPONSES EN DIRECT (Raphaël, 29 sept. : « quand je réponds dans le cockpit,
# la session doit le prendre en compte tout de suite, sinon elle avance sans
# mes informations et on refait le travail deux fois »). Toutes les 20 s au
# plus, pendant que la session (ou un de ses agents) travaille, on regarde si
# Raphaël a répondu ou écrit sur un chantier qu'elle tient ; si oui, on le lui
# met sous les yeux AVANT son prochain pas (additionalContext). 3 s au plus.
reponses_fraiches() {
  local rep="${TMPDIR:-/tmp}/cockpit-rep-$sid" depuis texte sortie=""
  if [ -f "$rep" ] && [ $(( $(date +%s) - $(stat -c %Y "$rep" 2>/dev/null || echo 0) )) -lt 20 ]; then return; fi
  depuis=$(cat "$rep" 2>/dev/null); date -u +%Y-%m-%dT%H:%M:%SZ > "$rep" 2>/dev/null
  [ -n "$depuis" ] || depuis=$(date -u +%Y-%m-%dT%H:%M:%SZ)   # premier passage : pas d'historique
  local qs qb; qs=$(printf '%s' "$sid" | sed "s/'/''/g"); qb=$(printf '%s' "$branche" | sed "s/'/''/g")
  texte=$(timeout 3 "$SQL" "with mes as (
      select id from chantiers where pris_par = '$qb' and '$qb' <> ''
      union select chantier_id from taches where session_id = '$qs' and statut = 'en_cours' and chantier_id is not null
      union select chantier_id from activite where session = '$qb' and '$qb' <> '' and updated_at > now() - interval '3 hours' and chantier_id is not null)
    select string_agg(format('- « %s » : %s%s', c.titre,
        case when m.kind in ('question','action') then format('il a répondu à « %s » → %s%s', left(m.corps, 90), m.reponse, coalesce(' — ' || m.precision, ''))
             else left(m.corps, 400) end,
        case when jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0 then format(' [📎 %s pièce(s) : media.sh --message %s]', jsonb_array_length(m.medias), m.id) else '' end), chr(10) order by coalesce(m.answered_at, m.created_at)) as nouvelles
    from messages m join chantiers c on c.id = m.chantier_id
    where m.chantier_id in (select id from mes)
      and ((m.auteur_type in ('proprietaire','utilisateur') and m.kind in ('info','reponse','constat') and m.created_at > '$depuis'::timestamptz)
        or (m.kind in ('question','action') and m.answered_at > '$depuis'::timestamptz))" 2>/dev/null | jq -r '.rows[0].nouvelles // empty' 2>/dev/null)
  [ -n "$texte" ] && sortie="RÉPONSE DE RAPHAËL dans le cockpit, à l'instant — prends-la en compte MAINTENANT, avant ton prochain pas (et adapte ce que tu fais) :
$texte"
  # Tes questions encore ouvertes sur ces chantiers, alors que tu as avancé depuis
  # (0015) : toutes les 15 min au plus, on te demande de les tenir à jour.
  local rq="${TMPDIR:-/tmp}/cockpit-qst-$sid" qst
  if [ ! -f "$rq" ] || [ $(( $(date +%s) - $(stat -c %Y "$rq" 2>/dev/null || echo 0) )) -ge 900 ]; then
    touch "$rq" 2>/dev/null
    qst=$(timeout 3 "$SQL" "with mes as (
        select id from chantiers where pris_par = '$qb' and '$qb' <> ''
        union select chantier_id from taches where session_id = '$qs' and statut = 'en_cours' and chantier_id is not null)
      select string_agg(format('- %s (posée %s) « %s »', m.id, to_char(m.created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), left(m.corps, 100)), chr(10)) as questions
      from messages m where m.chantier_id in (select id from mes) and m.kind in ('question','action') and m.answered_at is null
        and greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) < now() - interval '15 minutes'" 2>/dev/null | jq -r '.rows[0].questions // empty' 2>/dev/null)
    [ -n "$qst" ] && sortie="${sortie:+$sortie

}Tes questions encore ouvertes pour Raphaël sur tes chantiers — tu as avancé depuis : sont-elles TOUJOURS utiles ? Tiens-les à jour pour qu'il ne réponde pas pour rien : ${COCKPIT_DEM_CMD:-scripts/demander.sh} --confirmer <id> (toujours utile) ou --retirer <id> \"pourquoi\" (dépassée, déjà faite).
$qst"
  fi
  [ -n "$sortie" ] || return
  jq -n --arg t "$sortie" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $t}}'
}

case "$ev" in
  PostToolUse)
    reponses_fraiches
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
