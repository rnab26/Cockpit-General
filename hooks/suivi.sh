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
# Un appel venu d'un AGENT (agent_id présent, Claude Code 2.1.284) : ce qu'on lui
# remet, ce sont SES chantiers (sa tâche, la branche de son dossier de travail),
# avec son propre curseur — sinon l'agent A « consomme » la réponse destinée à B.
agent=$(printf '%s' "$entree" | jq -r '.agent_id // empty' 2>/dev/null)
branche_rep="$branche"
if [ -n "$agent" ]; then
  cwd=$(printf '%s' "$entree" | jq -r '.cwd // empty' 2>/dev/null)
  [ -n "$cwd" ] && branche_rep=$(git -C "$cwd" symbolic-ref --short -q HEAD 2>/dev/null || echo "$branche")
fi

# RÉPONSES EN DIRECT (Raphaël, 29 sept. : « quand je réponds dans le cockpit,
# la session doit le prendre en compte tout de suite, sinon elle avance sans
# mes informations et on refait le travail deux fois »). Pendant que la session
# (ou un de ses agents) travaille, toutes les 20 s au plus, et À CHAQUE réveil
# (UserPromptSubmit : message de Raphaël, réveil horaire), on regarde si Raphaël
# a répondu ou écrit sur un chantier qu'elle tient ; si oui, on le lui met sous
# les yeux AVANT son prochain pas (additionalContext). 3 s au plus.
# Curseur = l'heure de la BASE au dernier passage RÉUSSI (une requête en échec
# ne fait rien perdre). Sans curseur (conteneur recyclé), on remet ce qui n'a
# été suivi d'aucun message de session depuis 24 h. Le hook de démarrage pose
# le curseur après avoir montré l'état : rien n'est remis deux fois.
reponses_fraiches() {
  local evn="$1" force="${2:-}" cle="$sid${agent:+-$agent}"
  local cur="${TMPDIR:-/tmp}/cockpit-rep-$cle" rythme="${TMPDIR:-/tmp}/cockpit-repv-$cle" depuis cond brut texte sortie=""
  if [ -z "$force" ] && [ -f "$rythme" ] && [ $(( $(date +%s) - $(stat -c %Y "$rythme" 2>/dev/null || echo 0) )) -lt "${COCKPIT_REP_INTERVALLE:-20}" ]; then return; fi
  touch "$rythme" 2>/dev/null
  depuis=$(grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.+Z-]+$' "$cur" 2>/dev/null | head -1)
  local qs qb qa; qs=$(printf '%s' "$sid" | sed "s/'/''/g"); qb=$(printf '%s' "$branche_rep" | sed "s/'/''/g"); qa=$(printf '%s' "$agent" | sed "s/'/''/g")
  local mes
  if [ -n "$agent" ]; then
    mes="select id from chantiers where pris_par = '$qb' and '$qb' <> ''
      union select chantier_id from taches where session_id = '$qs' and tache_id = '$qa' and chantier_id is not null"
  else
    mes="select id from chantiers where pris_par = '$qb' and '$qb' <> ''
      union select chantier_id from taches where session_id = '$qs' and statut = 'en_cours' and chantier_id is not null
      union select chantier_id from activite where session = '$qb' and '$qb' <> '' and updated_at > now() - interval '3 hours' and chantier_id is not null"
  fi
  if [ -n "$depuis" ]; then
    cond="coalesce(m.answered_at, m.created_at) > '$depuis'::timestamptz"
  else
    cond="coalesce(m.answered_at, m.created_at) > now() - interval '24 hours'
      and not exists (select 1 from messages s where s.chantier_id = m.chantier_id and s.auteur_type = 'session' and s.created_at > coalesce(m.answered_at, m.created_at))"
  fi
  brut=$(timeout 3 "$SQL" "with mes as ($mes)
    select now() as maintenant, string_agg(format('- « %s » : %s%s', c.titre,
        case when m.kind in ('question','action') then format('il a répondu à « %s » → %s%s', left(m.corps, 90), m.reponse, coalesce(' — ' || m.precision, ''))
             when m.ou_en_est then format('il demande OÙ ÇA EN EST. Réponds-lui tout de suite dans le fil, en 3 lignes au plus (fait / reste / ce qui bloque) : %s --chantier %s --point \"…\"', '${COCKPIT_PROG_CMD:-scripts/progression.sh}', c.id)
             when cockpit.est_message_libre(m) then format('il t''écrit : « %s » → RÉPONDS-LUI dans ce fil, court, avant de continuer : %s --chantier %s --point \"…\"', left(m.corps, 400), '${COCKPIT_PROG_CMD:-scripts/progression.sh}', c.id)
             else left(m.corps, 400) end,
        case when jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0 then format(' [📎 %s pièce(s) : media.sh --message %s]', jsonb_array_length(m.medias), m.id) else '' end), chr(10) order by coalesce(m.answered_at, m.created_at)) as nouvelles,
      string_agg(m.id::text, ',') filter (where m.recu_at is null and (m.ou_en_est or cockpit.est_message_libre(m))) as a_marquer
    from messages m join chantiers c on c.id = m.chantier_id
    where m.chantier_id in (select id from mes)
      and ((m.auteur_type in ('proprietaire','utilisateur') and m.kind in ('info','reponse','constat') and not m.via_session)
        or (m.kind in ('question','action') and m.answered_at is not null and coalesce(m.reponse, '') not like 'Retirée par Claude%'))
      and $cond" 2>/dev/null)
  local maintenant; maintenant=$(printf '%s' "$brut" | jq -r '.rows[0].maintenant // empty' 2>/dev/null)
  [ -n "$maintenant" ] && printf '%s\n' "$maintenant" > "$cur" 2>/dev/null   # seulement si la base a répondu
  texte=$(printf '%s' "$brut" | jq -r '.rows[0].nouvelles // empty' 2>/dev/null)
  # « Où ça en est ? » (0023) et ses messages libres (0025) remis à une session
  # VIVANTE sont « reçus » : l'app passe de « envoyé » à « reçu par Claude ».
  # En arrière-plan, sans attendre.
  local ou; ou=$(printf '%s' "$brut" | jq -r '.rows[0].a_marquer // empty' 2>/dev/null)
  if [[ "$ou" =~ ^[0-9a-f,-]+$ ]]; then
    ( setsid "$SQL" "select marquer_messages_recus('{$ou}'::uuid[], '$(printf '%s' "${branche_rep:-$sid}" | sed "s/'/''/g")')" >/dev/null 2>&1 & ) >/dev/null 2>&1
  fi
  [ -n "$texte" ] && sortie="RÉPONSE DE RAPHAËL dans le cockpit, à l'instant — prends-la en compte MAINTENANT, avant ton prochain pas (et adapte ce que tu fais) :
$texte"
  # Tes questions encore ouvertes sur ces chantiers, alors que tu as avancé depuis
  # (0015) : toutes les 15 min au plus, on te demande de les tenir à jour.
  local rq="${TMPDIR:-/tmp}/cockpit-qst-$cle" qst
  if [ ! -f "$rq" ] || [ $(( $(date +%s) - $(stat -c %Y "$rq" 2>/dev/null || echo 0) )) -ge 900 ]; then
    touch "$rq" 2>/dev/null
    qst=$(timeout 3 "$SQL" "with mes as ($mes)
      select string_agg(format('- %s (posée %s) « %s »', m.id, to_char(m.created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), left(m.corps, 100)), chr(10)) as questions
      from messages m where m.chantier_id in (select id from mes) and m.kind in ('question','action') and m.answered_at is null
        and greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) < now() - interval '15 minutes'" 2>/dev/null | jq -r '.rows[0].questions // empty' 2>/dev/null)
    [ -n "$qst" ] && sortie="${sortie:+$sortie

}Tes questions encore ouvertes pour Raphaël sur tes chantiers — tu as avancé depuis : sont-elles TOUJOURS utiles ? Tiens-les à jour pour qu'il ne réponde pas pour rien : ${COCKPIT_DEM_CMD:-scripts/demander.sh} --confirmer <id> (toujours utile) ou --retirer <id> \"pourquoi\" (dépassée, déjà faite).
$qst"
  fi
  [ -n "$sortie" ] || return
  jq -n --arg t "$sortie" --arg e "$evn" '{hookSpecificOutput: {hookEventName: $e, additionalContext: $t}}'
}

# SES MESSAGES DANS LA SESSION → LE FIL DU CHANTIER (0027 ; Raphaël, 29 sept. :
# « les messages que j'envoie dans une session pour des chantiers que j'ouvre ne
# sont pas importés dans le chat du chantier, on s'y perd sur le contexte »).
# Un VRAI message de lui seulement : jamais une notification, un réveil, une
# consigne de renfort ni une commande seule (même filtre que prompt-rappel.sh
# pour « c'est un message de Raphaël »), jamais dans une session de renfort.
# La base le dépose dans les chantiers que la session tient, et dans celui
# qu'elle prendra dans les 15 min (trigger). En arrière-plan, sans attendre.
consigner_message() {
  [ -z "$agent" ] && [ -n "$branche" ] || return 0
  local invite marque
  invite=$(printf '%s' "$entree" | jq -r '.prompt // ""' 2>/dev/null)
  [ -n "${invite//[[:space:]]/}" ] || return 0
  marque="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --absolute-git-dir 2>/dev/null)/cockpit-renfort"
  [ -s "$marque" ] && return 0
  printf '%s' "$invite" | grep -qE '^[[:space:]]*(<(task-notification|system-reminder|wake|command-|local-command|webhook-payload|child-session-event|agent-message|teammate-message)|\[cockpit-(renfort|relais)\])|Réveil (horaire|du chef)' && return 0
  printf '%s' "$invite" | grep -qxE '[[:space:]]*/[A-Za-z0-9:_-]+[[:space:]]*' && return 0
  local qp qs qb qt
  qp=$(printf '%s' "$PROJET" | sed "s/'/''/g"); qs=$(printf '%s' "$sid" | sed "s/'/''/g")
  qb=$(printf '%s' "$branche" | sed "s/'/''/g"); qt=$(printf '%s' "$invite" | head -c 16000 | sed "s/'/''/g")
  ( setsid "$SQL" "select consigner_message_session('$qp', '$qs', '$qb', '$qt')" >/dev/null 2>&1 & ) >/dev/null 2>&1
}

case "$ev" in
  PostToolUse)
    reponses_fraiches PostToolUse
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
    # Le RÉVEIL d'une session (message de Raphaël, réveil horaire de la chef) :
    # ce qu'il a répondu pendant qu'elle était à l'arrêt lui est remis tout de
    # suite, avant son premier pas — sans attendre le rythme de 20 s.
    reponses_fraiches UserPromptSubmit maintenant
    consigner_message
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
