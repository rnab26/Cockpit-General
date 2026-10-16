#!/usr/bin/env bash
# Hook de SUIVI : dit au cockpit, tout seul, quelle session travaille et
# quelles tâches elle a lancées en arrière-plan (agents, commandes longues).
# Déclaré par brancher.sh sur UserPromptSubmit, Stop, SubagentStart,
# SubagentStop, PreToolUse, PostToolUse, StopFailure et SessionEnd.
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
# Tout ce qu'on dit à la session sur cet événement (réponses, chantier ouvert tout seul, ce que
# personne ne tenait) part dans UN SEUL additionalContext, en fin de traitement (emettre).
SORTIE=""
emettre() {
  [ -n "$SORTIE" ] || return 0
  jq -n --arg t "$SORTIE" --arg e "$ev" '{hookSpecificOutput: {hookEventName: $e, additionalContext: $t}}'
  SORTIE=""
}
# Sans file d'attente locale : ces appels CLAIMENT ou OUVRENT quelque chose, les rejouer plus tard
# (hors contexte) ferait réclamer un message à une session qui ne l'a jamais lu.
SANS_FILE=/proc/cockpit-sans-file
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
# Une session de RENFORT ne reçoit rien de ce que personne ne tient : elle a SA section (renfort.sh).
est_renfort() { [ -s "$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --absolute-git-dir 2>/dev/null)/cockpit-renfort" ]; }
qsql() { printf '%s' "$1" | sed "s/'/''/g"; }

orphelins() {
  [ -z "$agent" ] && [ -n "$branche" ] || return 0
  est_renfort && return 0
  local brut
  brut=$(COCKPIT_FILE_ATTENTE=$SANS_FILE timeout 3 "$SQL" "select remettre_orphelins('$(qsql "$PROJET")', '$(qsql "$sid")', '$(qsql "$branche")') as r" 2>/dev/null | jq -c '.rows[0].r // []' 2>/dev/null)
  [ -n "$brut" ] && [ "$brut" != "[]" ] || return 0
  printf '%s' "$brut" | jq -r --arg prog "${COCKPIT_PROG_CMD:-scripts/progression.sh}" --arg dem "${COCKPIT_DEM_CMD:-scripts/demander.sh}" --arg ch "${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh}" '
    "RAPHAËL A ÉCRIT / RÉPONDU DANS LE COCKPIT à l’instant, et PERSONNE ne tenait cela : le cockpit te le remet (il te l’a réservé, nul autre n’y répondra). Réponds-lui TOUT DE SUITE, court, dans son fil — et si le sujet n’est pas le tien, dis-le-lui en une ligne et crée-en le chantier pour un autre :\n"
    + (map(
        (if .titre then "« " + .titre + " » : " else "(fil du projet) " end)
        + (if .type == "carte" then
             "il a répondu « " + (.reponse // "") + " » à la carte « " + .corps + " »" + (if .precision then " — " + .precision else "" end)
             + (if .retour then " [carte restée ouverte : traite-le puis ferme-la : " + $dem + " --retirer " + .id + " \"pourquoi\"]" else "" end)
           elif .type == "ou_en_est" then
             "il demande OÙ ÇA EN EST → " + $prog + (if .chantier_id then " --chantier " + .chantier_id else "" end) + " --point \"fait / reste / ce qui bloque\""
           else
             "il t’écrit : « " + .corps + " » → réponds : " + $prog + (if .chantier_id then " --chantier " + .chantier_id else "" end) + " --point \"…\" (autre sujet ? " + $ch + " --ouvrir \"<titre>\" --demande \"<ses mots>\" --depuis " + (.chantier_id // "projet") + " --reponse \"…\")"
           end)) | join("\n"))'
}

# UN MESSAGE N'EST PAS UN CHANTIER (0091 ; Raphaël, 16 oct. : « chaque message que je crée en discussion est
# transcrit comme un chantier avec une progression […] il vaut mieux une petite pastille de notification et la
# discussion concernant le chantier en question »). Avant (0087), la BASE ouvrait un chantier pour tout message de
# travail : FacePro en a eu 14 au titre copié de ses mots, alors que le vrai chantier du sujet existait. Maintenant
# le message est rangé tout de suite dans UN fil (le chantier que la session tient, sinon la discussion du projet)
# et la session y répond ; elle le déplace en répondant dans un autre fil. Un chantier n'est ouvert que par elle,
# pour un vrai sujet de travail (ou par le filet d'arrêt, hooks/autonome.sh, quand elle a travaillé sans aucun chantier).
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
    cond="coalesce(m.answered_at, m.retour_at, m.created_at) > '$depuis'::timestamptz"
  else
    cond="coalesce(m.answered_at, m.retour_at, m.created_at) > now() - interval '24 hours'
      and not exists (select 1 from messages s where s.chantier_id = m.chantier_id and s.auteur_type = 'session' and s.created_at > coalesce(m.answered_at, m.retour_at, m.created_at))"
  fi
  brut=$(timeout 3 "$SQL" "with mes as ($mes)
    select now() as maintenant, string_agg(format('- « %s » : %s%s', c.titre,
        case when cockpit.est_retour_carte(m) then format('CARTE RESTÉE OUVERTE, il a répondu « %s » à « %s »%s → traite-le, puis FERME la carte (elle ne se ferme pas seule) : %s --retirer %s \"pourquoi\" si elle n''a plus lieu d''être, sinon corrige et reviens la lui reposer', m.reponse, left(m.corps, 90), coalesce(' — ' || m.precision, ''), '${COCKPIT_DEM_CMD:-scripts/demander.sh}', m.id)
             when m.kind in ('question','action') then format('il a répondu à « %s » → %s%s', left(m.corps, 90), m.reponse, coalesce(' — ' || m.precision, ''))
             when m.ou_en_est then format('il demande OÙ ÇA EN EST. Réponds-lui tout de suite dans le fil, en 3 lignes au plus (fait / reste / ce qui bloque) : %s --chantier %s --point \"…\"', '${COCKPIT_PROG_CMD:-scripts/progression.sh}', c.id)
             when cockpit.est_message_libre(m) then format('il t''écrit : « %s » → RÉPONDS-LUI dans ce fil, court, avant de continuer : %s --chantier %s --point \"…\" (un AUTRE sujet, « il faudrait aussi… » ? crée-le et range-le, ta réponse porte le lien : %s --ouvrir \"<titre>\" --demande \"<ses mots>\" --depuis %s --reponse \"…\")', left(m.corps, 400), '${COCKPIT_PROG_CMD:-scripts/progression.sh}', c.id, '${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh}', c.id)
             else left(m.corps, 400) end,
        case when jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0 then format(' [📎 %s pièce(s) : media.sh --message %s]', jsonb_array_length(m.medias), m.id) else '' end), chr(10) order by coalesce(m.answered_at, m.retour_at, m.created_at)) as nouvelles,
      string_agg(m.id::text, ',') filter (where m.recu_at is null and (m.ou_en_est or cockpit.est_message_libre(m))) as a_marquer
    from messages m join chantiers c on c.id = m.chantier_id
    where m.chantier_id in (select id from mes)
      and ((m.auteur_type in ('proprietaire','utilisateur') and m.kind in ('info','reponse','constat') and not m.via_session)
        or (m.kind in ('question','action') and (m.answered_at is not null or cockpit.est_retour_carte(m)) and coalesce(m.reponse, '') not like 'Retirée par %' and m.retiree_seule_at is null))
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
  if [ "$evn" = UserPromptSubmit ] || [ ! -f "$rq" ] || [ $(( $(date +%s) - $(stat -c %Y "$rq" 2>/dev/null || echo 0) )) -ge 900 ]; then
    touch "$rq" 2>/dev/null
    qst=$(timeout 3 "$SQL" "with mes as ($mes)
      select string_agg(format('- %s (posée %s) « %s »', m.id, to_char(m.created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), left(m.corps, 100)), chr(10)) as questions
      from messages m where m.chantier_id in (select id from mes) and m.kind in ('question','action') and m.answered_at is null
        and greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) < now() - interval '15 minutes'" 2>/dev/null | jq -r '.rows[0].questions // empty' 2>/dev/null)
    [ -n "$qst" ] && sortie="${sortie:+$sortie

}Tes questions encore ouvertes pour Raphaël sur tes chantiers — tu as avancé depuis : sont-elles TOUJOURS utiles ? Tiens-les à jour pour qu'il ne réponde pas pour rien : ${COCKPIT_DEM_CMD:-scripts/demander.sh} --confirmer <id> (toujours utile) ou --retirer <id> \"pourquoi\" (dépassée, déjà faite) ; et si son message d'à l'instant RÉPOND à l'une d'elles dans la session : ${COCKPIT_DEM_CMD:-scripts/demander.sh} --repondu <id> \"ses mots\" (elle se ferme, il ne répond pas deux fois).
$qst"
  fi
  # CE QUE PERSONNE NE TIENT (0087 ; Raphaël, 14 oct. : « cela doit être de l'instantané »). Un message
  # écrit dans le cockpit au niveau du projet, ou sur un chantier sans preneur, une carte répondue que
  # rien n'a suivie : ils attendaient la chef (médiane 2 h 11 mesurée sur FacePro). La session
  # ouverte les reçoit à son prochain pas ; la base les lui RÉCLAME (un seul preneur).
  local orph; orph=$(orphelins)
  [ -n "$orph" ] && sortie="${sortie:+$sortie

}$orph"
  [ -n "$sortie" ] || return
  SORTIE="${SORTIE:+$SORTIE

}$sortie"
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
  : > "${TMPDIR:-/tmp}/cockpit-travail-$sid" 2>/dev/null   # un nouveau tour : on recompte le travail réel (filet d'arrêt, autonome.sh)
  local qp qs qb qt r action cid titre
  qp=$(qsql "$PROJET"); qs=$(qsql "$sid"); qb=$(qsql "$branche"); qt=$(printf '%s' "$invite" | head -c 16000 | sed "s/'/''/g")
  r=$(COCKPIT_FILE_ATTENTE=$SANS_FILE timeout 6 "$SQL" "select chantier_auto_depuis_message('$qp', '$qs', '$qb', '$qt') as r" 2>/dev/null | jq -c '.rows[0].r // empty' 2>/dev/null)
  if [ -z "$r" ]; then
    # Base injoignable ou fonction absente (projet pas encore à jour) : l'ancien chemin, en arrière-plan.
    ( setsid "$SQL" "select consigner_message_session('$qp', '$qs', '$qb', '$qt')" >/dev/null 2>&1 & ) >/dev/null 2>&1
    return 0
  fi
  action=$(printf '%s' "$r" | jq -r '.action // empty'); cid=$(printf '%s' "$r" | jq -r '.id // empty'); titre=$(printf '%s' "$r" | jq -r '.titre // empty')
  local ouvrir="${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh}" prog="${COCKPIT_PROG_CMD:-scripts/progression.sh}"
  # Le même rappel dans les deux cas : un message n'est pas un chantier, la session répond dans le bon fil et le déplace
  # en répondant ailleurs (rattacher_messages_session : la première réponse explicite corrige, les suivantes copient).
  local regle="Un message n'est PAS un chantier : une question, un point d'avancement, un retour, un ajustement ou la suite d'un sujet existant = une réponse dans un fil, jamais un nouveau chantier. Il parle d'un AUTRE chantier existant ($ouvrir --chercher \"<mots>\") : réponds dans le sien ($prog --chantier <id> --point \"…\"), le message y est déplacé. Un vrai AUTRE sujet de travail (distinct, plusieurs étapes, un résultat à vérifier) : $ouvrir --ouvrir \"<titre court>\" --demande \"<ses mots>\"."
  case "$action" in
    tenu) SORTIE="${SORTIE:+$SORTIE

}COCKPIT : le message de Raphaël est rangé dans le fil de « $titre » ($cid), le chantier que ta session tient : il le voit là, avec une pastille quand tu réponds. Réponds-y, court : $prog --chantier $cid --point \"…\". $regle" ;;
    projet) SORTIE="${SORTIE:+$SORTIE

}COCKPIT : le message de Raphaël est rangé dans la discussion du projet (aucun chantier que ta session tient ne le porte) : il le voit là, avec une pastille quand tu réponds. Réponds-y, court : $prog --point \"…\" (sans --chantier). $regle" ;;
  esac
  return 0
}

# CE QUE LA SESSION FAIT MAINTENANT (0087) : la barre du chantier qu'elle tient montre l'action en cours,
# sans que le modèle ait rien à signaler. Au plus une fois toutes les 15 s, détaché, jamais bloquant.
action_live() {
  [ -z "$agent" ] && [ -n "$branche" ] || return 0
  est_renfort && return 0
  local rep="${TMPDIR:-/tmp}/cockpit-live-$sid" desc
  if [ -f "$rep" ] && [ $(( $(date +%s) - $(stat -c %Y "$rep" 2>/dev/null || echo 0) )) -lt "${COCKPIT_LIVE_INTERVALLE:-15}" ]; then return 0; fi
  touch "$rep" 2>/dev/null
  desc=$(printf '%s' "$entree" | jq -r '
    (.tool_input // {}) as $in | (.tool_name // "") as $t
    | def base: (($in.file_path // $in.notebook_path // $in.path // "") | split("/") | last);
      if   ($t == "Edit" or $t == "Write" or $t == "MultiEdit" or $t == "NotebookEdit") then "Modifie " + base
      elif $t == "Read" then "Lit " + base
      elif ($t == "Grep" or $t == "Glob") then "Cherche dans le code"
      elif $t == "Bash" then "Lance : " + (($in.description // $in.command // "une commande") | tostring | gsub("\\s+"; " ") | .[0:90])
      elif ($t == "Agent" or $t == "Task") then "Délègue : " + (($in.description // "une tâche") | tostring | .[0:90])
      elif ($t == "WebFetch" or $t == "WebSearch") then "Cherche sur le web"
      elif ($t | startswith("mcp__")) then "Utilise " + ($t | split("__") | last)
      else "Travaille" end' 2>/dev/null)
  [ -n "$desc" ] || return 0
  ( setsid "$SQL" "select signaler_action_live('$(qsql "$PROJET")', '$(qsql "$branche")', '$(qsql "$desc")')" >/dev/null 2>&1 & ) >/dev/null 2>&1
}

# TRAVAIL RÉEL DU TOUR (0091) : une ligne par modification de fichier faite par la session elle-même (pas par ses agents).
# Le hook d'arrêt (autonome.sh) la lit : du travail sans AUCUN chantier tenu → une relance, une seule par tour. C'est le filet
# qui remplace l'ouverture automatique par message : un chantier naît d'un travail, pas d'une phrase.
travail_signal() {
  [ -z "$agent" ] && [ -n "$branche" ] || return 0
  est_renfort && return 0
  case "$(printf '%s' "$entree" | jq -r '.tool_name // empty' 2>/dev/null)" in
    Edit|Write|MultiEdit|NotebookEdit) printf '1\n' >> "${TMPDIR:-/tmp}/cockpit-travail-$sid" 2>/dev/null ;;
  esac
  return 0
}

fin_de_tour() {
  [ -z "$agent" ] && [ -n "$branche" ] || return 0
  ( setsid "$SQL" "select signaler_fin_tour('$(qsql "$PROJET")', '$(qsql "$branche")')" >/dev/null 2>&1 & ) >/dev/null 2>&1
}

# BATTEMENT PENDANT TOUT LE TOUR (0087). L'ancien battement dépendait de PreToolUse, absent du
# .claude/settings.json de certains projets (FacePro : 97 sessions, jamais le hook) : leurs sessions
# semblaient mortes pendant chaque outil long et leurs chantiers étaient repris en doublon. Il part
# maintenant au message de Raphaël ET à chaque retour d'outil (événements que TOUS les projets
# déclarent), bat toutes les 45 s, et s'arrête à la fin du tour (Stop) ou après 11 min sans nouvelle.
# 16 oct. (chantier c33c0db9, « arrêt brutal des chantiers en cours ») : un AGENT ne battait pas du tout
# (ni son outil long, ni ses retours d'outil ne touchaient SA tâche), donc un chantier tenu par un agent
# qui codait plus de 20 min sans signaler d'étape était libéré et repris en doublon (mesuré : 20 des 40
# dernières libérations, 20 à 31 min, toutes sur des agent/… et renfort/…). Maintenant l'agent bat
# comme la session, avec son identifiant : la base rafraîchit SA ligne (suivre, événement « Vie »).
battement_tour() {
  local cle="$sid${agent:+-$agent}"
  local marq="${TMPDIR:-/tmp}/cockpit-tour-vie-$cle" pidf="${TMPDIR:-/tmp}/cockpit-tour-pid-$cle" pas="${COCKPIT_BATTEMENT_PAS:-45}" plafond="${COCKPIT_BATTEMENT_MAX:-660}" charge req
  echo $(( $(date +%s) + plafond )) > "$marq" 2>/dev/null || return 0
  if [ -s "$pidf" ] && kill -0 "$(cat "$pidf" 2>/dev/null)" 2>/dev/null; then return 0; fi
  charge=$(jq -cn --arg s "$sid" --arg b "$branche" --arg a "$agent" '{session_id: $s, hook_event_name: "Vie", branche: $b} + (if $a != "" then {agent_id: $a} else {} end)') || return 0
  req="select suivre('$(qsql "$PROJET")', '$(qsql "$charge")'::jsonb)"
  ( setsid bash -c '
      while :; do
        sleep "$2"
        fin=$(cat "$1" 2>/dev/null) || break
        [ "$(date +%s)" -lt "${fin:-0}" ] || break
        "$3" "$4" >/dev/null 2>&1
      done
      rm -f "$1" "$5"' _ "$marq" "$pas" "$SQL" "$req" "$pidf" >/dev/null 2>&1 & echo $! > "$pidf" ) >/dev/null 2>&1
}
fin_battement() { rm -f "${TMPDIR:-/tmp}/cockpit-tour-vie-$sid" 2>/dev/null; }

# BATTEMENT d'un outil long (0046, Raphaël 30 sept. : « ZÉRO chantier tenu pour
# rien », délai « sans signe de vie » de 3 min). Mesuré : le signe de vie d'une
# session ne part qu'AU RETOUR d'un outil (PostToolUse, au plus 1 fois/minute) ; or
# un outil peut durer jusqu'à 10 min (plafond de l'outil Bash) sans qu'aucun hook
# ne parle : un agent VIVANT qui lance une suite de tests semblerait mort. Avant
# chaque outil (PreToolUse), un petit processus détaché envoie un signe toutes les
# 45 s tant que CET outil tourne (il s'arrête à son retour, ou après 11 min). Un
# outil court ne coûte rien : le premier signe part après 45 s.
outil_id=$(printf '%s' "$entree" | jq -r '.tool_use_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
repere_outil="${TMPDIR:-/tmp}/cockpit-outil-$sid-${outil_id:-sans-id}"
battement() {
  local plafond="${COCKPIT_BATTEMENT_MAX:-660}" pas="${COCKPIT_BATTEMENT_PAS:-45}" charge req
  charge=$(jq -cn --arg s "$sid" --arg b "$branche" '{session_id: $s, hook_event_name: "Vie", branche: $b}') || return 0
  req="select suivre('$(printf '%s' "$PROJET" | sed "s/'/''/g")', '$(printf '%s' "$charge" | sed "s/'/''/g")'::jsonb)"
  : > "$repere_outil" 2>/dev/null || return 0
  ( setsid bash -c '
      fin=$(( SECONDS + $1 ))
      while [ -e "$2" ] && [ "$SECONDS" -lt "$fin" ]; do
        sleep "$3"
        [ -e "$2" ] || break
        "$4" "$5" >/dev/null 2>&1
      done
      rm -f "$2"' _ "$plafond" "$repere_outil" "$pas" "$SQL" "$req" >/dev/null 2>&1 & ) >/dev/null 2>&1
}

# JETONS DU CONTEXTE (0068, Raphaël : « renouveler la session chef à 500 000 jetons »).
# Mesure = ce que la session porte dans son contexte au dernier tour de la conversation
# PRINCIPALE : input + cache lu + cache créé, lus dans le transcript (`transcript_path`,
# entrées « assistant » avec message.usage, hors sous-agents). Jamais la somme de tout
# ce qui a été relu (le cache relu à chaque tour gonflerait le total sans raison).
# Au plus 1 fois/minute (toujours à l'arrêt d'un tour), détaché, jamais bloquant.
jetons_du_transcript() {
  local f="$1"
  [ -r "$f" ] || return 0
  tail -c "${COCKPIT_JETONS_OCTETS:-600000}" "$f" 2>/dev/null | jq -R -r '
    fromjson? | select(.type == "assistant" and (.isSidechain // false) == false)
    | .message.usage // empty
    | ((.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0))
    | select(. > 0)' 2>/dev/null | tail -1
}
signaler_jetons() {
  [ -z "$agent" ] || return 0
  local tp n rep="${TMPDIR:-/tmp}/cockpit-jet-$sid"
  if [ "$ev" != "Stop" ] && [ -f "$rep" ] && [ $(( $(date +%s) - $(stat -c %Y "$rep" 2>/dev/null || echo 0) )) -lt "${COCKPIT_JETONS_INTERVALLE:-60}" ]; then return 0; fi
  tp=$(printf '%s' "$entree" | jq -r '.transcript_path // empty' 2>/dev/null)
  [ -n "$tp" ] || return 0
  touch "$rep" 2>/dev/null
  n=$(jetons_du_transcript "$tp")
  [[ "$n" =~ ^[0-9]+$ ]] || return 0
  ( setsid "$SQL" "select signaler_jetons('$(printf '%s' "$PROJET" | sed "s/'/''/g")', '$(printf '%s' "$sid" | sed "s/'/''/g")', $n)" >/dev/null 2>&1 & ) >/dev/null 2>&1
}

case "$ev" in
  PreToolUse) exit 0 ;;   # remplacé par battement_tour (0087) : un projet qui le déclare encore n'est pas doublé
  PostToolUse)
    rm -f "$repere_outil" 2>/dev/null
    signaler_jetons
    reponses_fraiches PostToolUse
    action_live
    travail_signal
    battement_tour
    emettre
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
      repere="${TMPDIR:-/tmp}/cockpit-vie-$sid${agent:+-$agent}"
      if [ -f "$repere" ] && [ $(( $(date +%s) - $(stat -c %Y "$repere" 2>/dev/null || echo 0) )) -lt 60 ]; then exit 0; fi
      touch "$repere" 2>/dev/null
      charge=$(jq -cn --arg s "$sid" --arg b "$branche" --arg a "$agent" '{session_id: $s, hook_event_name: "Vie", branche: $b} + (if $a != "" then {agent_id: $a} else {} end)')
    fi ;;
  UserPromptSubmit)
    # Le RÉVEIL d'une session (message de Raphaël, réveil horaire de la chef) :
    # ce qu'il a répondu pendant qu'elle était à l'arrêt lui est remis tout de
    # suite, avant son premier pas — sans attendre le rythme de 20 s.
    reponses_fraiches UserPromptSubmit maintenant
    consigner_message
    battement_tour
    emettre
    charge=$(printf '%s' "$entree" | jq -c --arg b "$branche" '{session_id, hook_event_name, branche: $b, prompt: ((.prompt // "") | .[0:200])}') ;;
  StopFailure)
    # Une réponse arrêtée par une erreur : limite d'usage (rate_limit), facturation,
    # surcharge… Le cockpit affiche « En pause » jusqu'au prochain signe de vie.
    charge=$(printf '%s' "$entree" | jq -c --arg b "$branche" '{session_id, hook_event_name, branche: $b, error, error_details: ((.error_details // "") | tostring | .[0:400])}') ;;
  Stop|SubagentStop|SubagentStart|SessionEnd)
    [ "$ev" = "Stop" ] && signaler_jetons
    if [ "$ev" = "Stop" ] || [ "$ev" = "SessionEnd" ]; then fin_battement; fi
    if [ "$ev" = "SubagentStop" ] && [ -n "$agent" ]; then rm -f "${TMPDIR:-/tmp}/cockpit-tour-vie-$sid-$agent" "${TMPDIR:-/tmp}/cockpit-vie-$sid-$agent" 2>/dev/null; fi
    [ "$ev" = "Stop" ] && fin_de_tour
    charge=$(printf '%s' "$entree" | jq -c --arg b "$branche" '{session_id, hook_event_name, branche: $b, agent_id, agent_type, background_tasks}') ;;
  *) exit 0 ;;
esac

[ -n "$charge" ] || exit 0
q=$(printf '%s' "$charge" | sed "s/'/''/g")
# En arrière-plan et détaché : la session n'attend jamais le réseau.
( setsid "$SQL" "select suivre('$(printf '%s' "$PROJET" | sed "s/'/''/g")', '$q'::jsonb)" >/dev/null 2>&1 & ) >/dev/null 2>&1
exit 0
