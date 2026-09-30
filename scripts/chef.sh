#!/usr/bin/env bash
# LE CHEF D'UN PROJET (29 sept. 2026, migration 0019) : dans chaque projet, UNE
# session dirige (celle où Raphaël a écrit en dernier) ; elle lance des AGENTS
# sur les chantiers DE SON PROJET, et seulement de lui.
#
# Raphaël (0014) : « une seule session maître qui ouvre des agents plutôt que
# plein de sessions autonomes qui se marchent dessus ». Puis (29/09, 16:00) :
# « je ne veux pas gérer sur une seule session plein de projets en même temps.
# S'il y a des ajouts qui doivent se faire, ça doit se faire dans la session
# concernant le projet en question […] sinon ça mélange tous les contextes. »
#
#   scripts/chef.sh                 la passe : lance les agents qui manquent
#                                   (appelée au réveil, et à la fin de CHAQUE agent)
#   scripts/chef.sh --prendre       cette session devient chef de SON projet (hook, message de Raphaël)
#   scripts/chef.sh --releve        ce que lance la ROUTINE de réveil (30 sept.) : la chef → la passe ;
#                                   une autre session (ouverte par /fire) → si la chef vit, seulement ce
#                                   qui attend (réponses, « où ça en est », messages) ; sinon elle devient chef
#   scripts/chef.sh --texte-routine le texte exact du prompt de la routine de réveil du projet
#   scripts/chef.sh --etat          qui est chef du projet, combien d'agents tournent
#   scripts/chef.sh --reveil <trig_…> [--distante <session_…>] [--minute <0-59>]   note le réveil horaire
#                                   du projet (--minute : minute de son cron → « prochain passage vers … » dans l'app)
#   scripts/chef.sh --max <n>       nombre d'agents en parallèle pour le projet (1 à 8)
#   scripts/chef.sh --renforts <n>  sessions de RENFORT au plus (0 à 4, 0 = aucune ; 0024)
#   scripts/chef.sh --agents-renfort <n>  agents par session de renfort (1 à 5)
#   (renforts : Raphaël les demande d'un bouton de l'app ; voir scripts/renfort.sh)
#   scripts/chef.sh --ouverture <slug> <session_…>        la chef RELAIS note la session ouverte pour
#   scripts/chef.sh --ouverture <slug> --erreur "<raison>"   un projet sans chef (0028), ou l'échec
#
# Projet : $COCKPIT_PROJET (posé par brancher.sh), --projet <slug>, sinon le
# dépôt courant (projets.depot). Session : $CLAUDE_CODE_SESSION_ID (ou --session <id>).
set -uo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
PROG="${COCKPIT_PROG_CMD:-scripts/progression.sh}"; DEM="${COCKPIT_DEM_CMD:-scripts/demander.sh}"
CHEF_CMD="${COCKPIT_CHEF_CMD:-scripts/chef.sh}"
q() { printf '%s' "$1" | sed "s/'/''/g"; }
cible=""; ouv_session=""; ouv_erreur=""
sid="${CLAUDE_CODE_SESSION_ID:-}"; mode="passe"; reveil=""; distante=""; max=""; minute=""; projet="${COCKPIT_PROJET:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --prendre) mode="prendre"; shift ;;
    --releve)  mode="releve"; shift ;;
    --texte-routine) mode="texte_routine"; shift ;;
    --etat)    mode="etat"; shift ;;
    --reveil)  mode="reveil"; reveil="${2:-}"; shift 2 ;;
    --distante) distante="${2:-}"; shift 2 ;;
    --minute)  minute="${2:-}"; shift 2 ;;
    --max)     mode="max"; max="${2:-}"; shift 2 ;;
    --renforts) mode="renforts"; max="${2:-}"; shift 2 ;;
    --agents-renfort) mode="agents_renfort"; max="${2:-}"; shift 2 ;;
    --ouverture) mode="ouverture"; cible="${2:-}"; ouv_session="${3:-}"; if [ "$ouv_session" = "--erreur" ]; then ouv_session=""; ouv_erreur="${4:-}"; shift 4; else shift 3; fi ;;
    --relais-texte) mode="relais_texte"; shift ;;
    --session) sid="${2:-}"; shift 2 ;;
    --projet)  projet="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
# La consigne du RELAIS (0028), à partir de relais_a_servir : une seule source (passe et tests).
RENF="${COCKPIT_RENFORT_CMD:-scripts/renfort.sh}"
relais_texte() { jq -r --arg r "$RENF" --arg chef "$CHEF_CMD" --arg moi "$projet" '
  map(. as $p |
    ((.renforts.archiver // []) | map("- [\($p.slug)] Renfort « \(.section) » \(if .statut == "fini" then "fini" else "muet depuis 3 h" end) : archive_session(\"\(.session)\"), puis \($r) --archive \(.id)")) +
    ((.renforts.ouvrir // []) | map("- [\($p.slug)] Nouveau renfort « \(.section) » (\(.chantiers) chantier(s), \(.agents) agent(s) au plus) : create_session(model: \"claude-sonnet-5-5\", title: \"Renfort · \(.slug) · \(.section) — ne pas toucher\", tags: [\"cockpit-renfort\", \"cockpit-\(.slug)\"], source_url: \"https://github.com/\(.depot)\", prompt: \"[cockpit-renfort] Tu es un RENFORT du cockpit (projet \(.slug), section « \(.section) »). Lance scripts/cockpit-renfort.sh --suivant \(.id) (ou scripts/renfort.sh s’il n’existe pas) et suis sa consigne : elle te donne jusqu’à \(.agents) chantier(s) de ta section, un agent chacun. À la fin de CHAQUE agent, relance-le. Quand elle dit FINI, arrête-toi en une ligne. Ne prends rien d’autre, ne parle pas à Raphaël ici : il répond dans le cockpit.\"), puis \($r) --session \(.id) <session_… rendu>. Échec : \($r) --erreur \(.id) \"<raison courte>\".")) +
    (if .ouvrir_session then ["- [\(.slug)] Raphaël a écrit dans le cockpit de \(.nom) (\(.messages) fil(s) sans réponse) et aucune session \(.nom) ne vit : create_session(model: \"claude-sonnet-5-5\", title: \"\(.nom) · répondre au cockpit\", tags: [\"cockpit-relais\", \"cockpit-\(.slug)\"], source_url: \"https://github.com/\(.depot)\", prompt: \"[cockpit-relais] Raphaël a écrit dans le cockpit du projet \(.slug) et attend une réponse dans chaque fil. Le hook de démarrage te montre ses messages sans réponse : réponds dans CHAQUE fil (scripts/cockpit-progression.sh --chantier <id> --point \\\"…\\\", ou sans --chantier pour le fil du projet) ; un message qui aborde plusieurs sujets : un chantier par sujet (scripts/cockpit-chantier.sh --ouvrir) et une réponse dans chaque fil. Un travail court et sans risque : fais-le sur une branche ; sinon ouvre le chantier et dis-le-lui. Aucune dépense, suppression ni envoi en son nom.\"), puis \($chef) --ouverture \(.slug) <session_… rendu> (échec : \($chef) --ouverture \(.slug) --erreur \"<raison>\"). Ne lui réponds PAS d’ici : chaque projet dans sa session."] else [] end)
  ) | flatten | join("\n")'; }
if [ "$mode" = "relais_texte" ]; then relais_texte; exit 0; fi
dossier="${CLAUDE_PROJECT_DIR:-$PWD}"
branche=$(git -C "$dossier" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
un() { "$SQL" "$1" 2>/dev/null | jq -c '.rows[0] // {}'; }
# Réglages du projet illisibles = AUCUN hook du projet ne tourne (30 sept. 2026 :
# deux objets JSON collés dans .claude/settings.json, commit f2b6c98 ; Claude Code
# l'ignorait, les agents n'étaient plus suivis ni fermés, la chef se croyait
# pleine). `jq empty` accepte deux objets collés : on lit avec python.
if { [ "$mode" = "passe" ] || [ "$mode" = "releve" ]; } && [ -f "$dossier/.claude/settings.json" ] \
   && ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$dossier/.claude/settings.json" 2>/dev/null; then
  echo "ALERTE — $dossier/.claude/settings.json n'est pas du JSON valide : Claude Code l'ignore, AUCUN hook du projet ne tourne (suivi des agents, arrêt, rappel). Répare-le d'abord (python3 -m json.tool .claude/settings.json montre l'erreur), commite, puis continue."
fi
# D-05 : la ligne « scénario capturé chez l'utilisateur » d'une consigne, vide s'il n'y en a pas.
repro_ligne() { [ -n "${1:-}" ] || return 0; COCKPIT_SQL="$SQL" bash "$(dirname "${BASH_SOURCE[0]}")/reproduction.sh" --ligne "$1" 2>/dev/null || true; }
if [ -z "$projet" ]; then
  # Le slug du dépôt courant (github.com/<propriétaire>/<dépôt>), lu en base, jamais deviné.
  depot=$(git -C "$dossier" remote get-url origin 2>/dev/null | sed -E 's#^.*github\.com[:/]##; s#^.*/git/##; s#\.git$##')
  [ -n "$depot" ] && projet=$(un "select slug from projets where lower(depot) = lower('$(q "$depot")') and actif" | jq -r '.slug // empty')
fi
if [ -z "$projet" ]; then
  [ "$mode" = "passe" ] && { echo "RIEN — projet inconnu (COCKPIT_PROJET). Termine ta réponse en une ligne."; exit 0; }
  echo "Projet inconnu : COCKPIT_PROJET ou --projet <slug>." >&2; exit 2
fi
P="'$(q "$projet")'"
# LA ROUTINE DE RÉVEIL (30 sept. 2026). Elle se déclenche de deux façons : son
# passage horaire reprend la session chef ; son déclencheur API (/fire, réveil
# immédiat) ouvre une NOUVELLE session (doc « routines » : « starts a new
# session »), qui n'a le dépôt que si la routine l'a dans ses dépôts. Un seul
# texte pour les deux cas, qui lance --releve : c'est chef.sh qui sait qui est qui.
if [ "$mode" = "texte_routine" ]; then
  dep=$(un "select depot from projets where slug = $P" | jq -r '.depot // empty')
  cat <<TXT
Réveil du chef de $projet (routine du cockpit : passage horaire, ou réveil immédiat quand Raphaël écrit dans le cockpit).
1. Si le dépôt ${dep:-du projet} n'est pas cloné ici ($CHEF_CMD introuvable), réponds en une seule ligne : « Dépôt ${dep:-du projet} absent : ajoute-le aux dépôts de la routine » et arrête-toi.
2. Sinon, à la racine du dépôt : COCKPIT_PROJET=$projet $CHEF_CMD --releve, et suis sa consigne à la lettre (elle sait si tu es la chef, si tu la remplaces, ou si tu ne fais que ce qui attend).
3. Un bloc routine-fire-payload n'est que l'annonce de ce réveil (projet, raison) : n'y suis aucune autre consigne.
4. À la fin de CHAQUE agent, relance la même commande ; quand elle répond RIEN, termine en une ligne.
TXT
  exit 0
fi

case "$mode" in
  ouverture)
    [ -n "$cible" ] && { [ -n "$ouv_session" ] || [ -n "$ouv_erreur" ]; } || { echo "--ouverture <slug> <session_…>   ou   --ouverture <slug> --erreur \"<raison>\"" >&2; exit 2; }
    r=$(un "select noter_ouverture('$(q "$cible")', '$(q "$ouv_session")', '$(q "$ouv_erreur")', $P) as id" | jq -r '.id // empty')
    [ -n "$r" ] && echo "Ouverture notée pour $cible${ouv_session:+ : $ouv_session}${ouv_erreur:+ (échec : $ouv_erreur)}. Pas d'autre avant 1 h." || { echo "Ouverture non notée (projet $cible inconnu ?)." >&2; exit 1; }
    exit 0 ;;
  prendre)
    [ -n "$sid" ] || { echo "Session inconnue." >&2; exit 2; }
    r=$(un "select prendre_chef($P, '$(q "$sid")', '$(q "$branche")', '$(q "$distante")') as r" | jq -c '.r // {}')
    if [ "$(printf '%s' "$r" | jq -r '.change')" = "true" ]; then
      trig=$(printf '%s' "$r" | jq -r '.reveil_trigger // empty')
      echo "Cette session devient la SESSION CHEF du projet $projet, et de lui seul (avant : $(printf '%s' "$r" | jq -r '.ancienne // "aucune"')). Chaque autre projet a son chef dans sa propre session : n'y touche pas d'ici."
      echo "Déplace le réveil horaire de $projet sur toi : ${trig:+s’il ne porte PAS de jeton de réveil immédiat, supprime le réveil $trig (delete_trigger), puis }crée-en un (create_trigger, toutes les heures, sur CETTE session, message : le texte de $CHEF_CMD --texte-routine), puis note-le : $CHEF_CMD --reveil <trig_…> --distante <ton id session_…> --minute <minute de son cron>. Une routine qui porte le jeton de réveil immédiat ne se supprime jamais (le jeton mourrait avec) : garde-la, --releve la rend utile quelle que soit la session."
    fi
    exit 0 ;;
  reveil)
    [ -z "$minute" ] || [[ "$minute" =~ ^([0-9]|[1-5][0-9])$ ]] || { echo "--minute : la minute du cron du réveil (0 à 59)." >&2; exit 2; }
    "$SQL" "insert into chefs (projet_id, reveil_trigger, session_distante, reveil_minute) select id, '$(q "$reveil")', nullif('$(q "$distante")', ''), ${minute:-null} from projets where slug = $P on conflict (projet_id) do update set reveil_trigger = excluded.reveil_trigger, session_distante = coalesce(excluded.session_distante, chefs.session_distante), reveil_minute = coalesce(excluded.reveil_minute, chefs.reveil_minute)" >/dev/null \
      && echo "Réveil de $projet noté : $reveil." ; exit 0 ;;
  max)
    [[ "$max" =~ ^[1-8]$ ]] || { echo "--max : un nombre de 1 à 8." >&2; exit 2; }
    "$SQL" "insert into chefs (projet_id, max_agents) select id, $max from projets where slug = $P on conflict (projet_id) do update set max_agents = excluded.max_agents" >/dev/null \
      && echo "Agents en parallèle pour $projet : $max." ; exit 0 ;;
  renforts|agents_renfort)
    # Même réglage que l'app (regler_renforts) : une seule règle, bornes en base.
    cur=$(un "select coalesce(c.max_renforts, 2) as s, coalesce(c.agents_par_renfort, 3) as a from projets p left join chefs c on c.projet_id = p.id where p.slug = $P")
    s_=$(printf '%s' "$cur" | jq -r '.s // 2'); a_=$(printf '%s' "$cur" | jq -r '.a // 3')
    if [ "$mode" = "renforts" ]; then [[ "$max" =~ ^[0-4]$ ]] || { echo "--renforts : un nombre de 0 à 4." >&2; exit 2; }; s_=$max
    else [[ "$max" =~ ^[1-5]$ ]] || { echo "--agents-renfort : un nombre de 1 à 5." >&2; exit 2; }; a_=$max; fi
    "$SQL" "select regler_renforts($P, $s_, $a_) as r" | jq -e '.rows[0].r' >/dev/null \
      && echo "Renforts de $projet : $s_ session(s) au plus, $a_ agent(s) chacune." ; exit 0 ;;
esac

# Le chef DE CE PROJET ; ses agents = les tâches « agent » de sa session, dans ce projet.
etat=$(un "select p.id as projet_id, p.slug, p.depot, c.session_id, c.branche, coalesce(c.max_agents, 3) as max_agents, c.reveil_trigger, c.actif,
  (p.autonome_toujours or coalesce(p.autonome_jusqu_a > now(), false)) as autonome,
  to_char(c.depuis at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI') as depuis,
  agents_actifs(c.session_id, p.id) as agents
  from projets p left join chefs c on c.projet_id = p.id where p.slug = $P")
if [ "$mode" = "etat" ]; then printf '%s\n' "$etat" | jq .; exit 0; fi

pid=$(printf '%s' "$etat" | jq -r '.projet_id // empty')
[ -n "$pid" ] || { echo "RIEN — projet $projet inconnu du cockpit. Termine ta réponse en une ligne."; exit 0; }
chef=$(printf '%s' "$etat" | jq -r 'if .actif == false then "" else (.session_id // "") end')
# --releve (la routine de réveil) : la chef → la passe normale. Une AUTRE session
# (ouverte par /fire) ne vole jamais une chef vivante : elle sert seulement ce qui
# attend Raphaël (« attente ») puis s'arrête ; chef morte ou absente → elle devient chef.
attente=""
if [ "$mode" = "releve" ] && [ -n "$sid" ] && [ "$chef" != "$sid" ]; then
  if [ "$(un "select chef_vivante('$pid') as v" | jq -r '.v // false')" = "true" ]; then
    attente=1
  else
    r=$(un "select prendre_chef($P, '$(q "$sid")', '$(q "$branche")', '') as r" | jq -c '.r // {}')
    if [ "$(printf '%s' "$r" | jq -r '.projet // empty')" = "$projet" ]; then
      echo "Cette session devient la SESSION CHEF de $projet (l'ancienne, $(printf '%s' "$r" | jq -r '.ancienne // "aucune"'), ne vit plus). Ne touche pas au réveil : la routine qui t'a ouverte le porte."
      chef="$sid"
    fi
  fi
fi
if [ -z "$attente" ] && { [ -z "$chef" ] || [ "$chef" != "$sid" ]; }; then
  echo "RIEN — cette session n'est pas la session chef de $projet (chef : ${chef:-aucune}). Termine ta réponse en une ligne, sans rien faire d'autre."; exit 0
fi
if [ -n "$attente" ]; then
  # Ses agents à ELLE ; jamais le signe de vie de la chef (elle la ferait paraître vivante).
  agents=$(un "select agents_actifs('$(q "$sid")', '$pid') as n" | jq -r '.n // 0')
else
  "$SQL" "update chefs set vu_at = now() where projet_id = '$pid'" >/dev/null 2>&1
  agents=$(printf '%s' "$etat" | jq -r '.agents // 0')
fi
maxa=$(printf '%s' "$etat" | jq -r '.max_agents // 3')
depot=$(printf '%s' "$etat" | jq -r '.depot // ""')
libres=$(( maxa - agents ))
# RENFORTS (0024) : Raphaël les demande d'un bouton dans l'app (une session par
# SECTION en attente) ; la chef les OUVRE (create_session), les note, et archive
# ceux qui ont fini. Jamais leur travail elle-même. Projets de test : jamais.
RENF="${COCKPIT_RENFORT_CMD:-scripts/renfort.sh}"
renf_txt=""
if [ -z "$attente" ]; then
renforts=$(un "select renforts_a_ouvrir($P) as r" | jq -c '.r // {}')
renf_txt=$(printf '%s' "$renforts" | jq -r --arg r "$RENF" '
  ((.archiver // []) | map("- Renfort « \(.section) » \(if .statut == "fini" then "fini (sa section est vide)" else "muet depuis 3 h" end) : archive_session(\"\(.session)\"), puis \($r) --archive \(.id)")) +
  ((.ouvrir // []) | map("- Nouveau renfort « \(.section) » (\(.chantiers) chantier(s), \(.agents) agent(s) au plus) : create_session(model: \"claude-sonnet-5-5\", title: \"Renfort · \(.slug) · \(.section) — ne pas toucher\", tags: [\"cockpit-renfort\", \"cockpit-\(.slug)\"], source_url: \"https://github.com/\(.depot)\", prompt: \"[cockpit-renfort] Tu es un RENFORT du cockpit (projet \(.slug), section « \(.section) »). Lance \($r) --suivant \(.id) et suis sa consigne : elle te donne jusqu’à \(.agents) chantier(s) de ta section, un agent chacun. À la fin de CHAQUE agent, relance \($r) --suivant \(.id). Quand elle dit FINI, arrête-toi en une ligne. Ne prends rien d’autre, ne parle pas à Raphaël ici : il répond dans le cockpit.\"), puis \($r) --session \(.id) <session_… rendu>. Si create_session échoue : \($r) --erreur \(.id) \"<raison courte>\" (Raphaël la verra).")) | join("\n")')
[ -n "$renf_txt" ] && renf_txt="RENFORTS de $projet, demandés par Raphaël dans le cockpit (sessions à part, chacune sa machine ; ne fais pas leur travail) :
$renf_txt
"
# RELAIS (0028) : si cette chef est LA chef relais (celle du cockpit si elle vit),
# elle ouvre aussi pour les projets SANS chef vivante : leurs renforts, et UNE
# session du projet quand Raphaël y a écrit sans réponse et qu'aucune session
# ne vit. Seulement ouvrir / noter / archiver : jamais leur travail, jamais leur
# réponse d'ici (pas de contextes mélangés). Au plus une ouverture par heure.
relais=$(un "select relais_a_servir($P) as r" | jq -c '.r // []')
relais_txt=$(printf '%s' "$relais" | relais_texte)
[ -n "$relais_txt" ] && renf_txt="${renf_txt}RELAIS pour les projets SANS chef vivante (tu es la chef relais : ouvre seulement, ne fais ni leur travail ni leurs réponses) :
$relais_txt
"
fi
# Un report daté dont la date est passée revient dans « Prêt à lancer » (0028).
"$SQL" "select reveiller_reportes('$pid') as n" >/dev/null 2>&1
# Rien à lancer soi-même : les gestes de renfort s'il y en a, sinon RIEN.
rien() {
  if [ -n "$renf_txt" ]; then printf '%s\n%s Fais seulement ces gestes, puis termine ta réponse en une ligne.\n' "$renf_txt" "$1"; else echo "RIEN — $1 Termine ta réponse en une ligne."; fi
  exit 0
}
if [ "$libres" -le 0 ]; then rien "$agents agent(s) travaillent déjà sur $projet (maximum $maxa)."; fi

donnes=()
# D'abord les RÉPONSES de Raphaël que personne n'a reprises (0017), dans CE
# projet seulement : une réponse sur un chantier que personne ne tient ne se
# perd plus ; le chantier repart « en cours », réservé à la branche de l'agent.
while [ ${#donnes[@]} -lt "$libres" ]; do
  br="agent/reponse-$(date +%s%N | tail -c 7)"
  rp=$(un "select reprendre_reponse('$br', '$pid') as r" | jq -c '.r // empty')
  [ -n "$rp" ] && [ "$rp" != "null" ] || break
  donnes+=("$(printf '%s' "$rp" | jq -c --arg br "$br" '. + {branche: $br, reponse_prise: true}')")
done
# Puis les « OÙ ÇA EN EST ? » (0023) que personne ne recevra (aucune session ni
# agent vivant sur le chantier) : un assistant regarde et répond dans le fil.
while [ ${#donnes[@]} -lt "$libres" ]; do
  br="agent/point-$(date +%s%N | tail -c 7)"
  po=$(un "select prendre_ou_en_est('$br', '$pid') as r" | jq -c '.r // empty')
  [ -n "$po" ] && [ "$po" != "null" ] || break
  donnes+=("$(printf '%s' "$po" | jq -c --arg br "$br" '. + {branche: $br, point: true}')")
done
# Puis ses MESSAGES LIBRES restés sans réponse écrite (0025 : « je n'ai pas compris
# ta demande », une précision, un « Corriger ») sur un fil que personne ne tient :
# un agent lui RÉPOND dans le fil (progression.sh --point), même s'il n'y a rien à coder.
while [ ${#donnes[@]} -lt "$libres" ]; do
  br="agent/message-$(date +%s%N | tail -c 7)"
  rm_=$(un "select reprendre_message('$br', '$pid') as r" | jq -c '.r // empty')
  [ -n "$rm_" ] && [ "$rm_" != "null" ] || break
  donnes+=("$(printf '%s' "$rm_" | jq -c --arg br "$br" '. + {branche: $br, message_pris: true}')")
done
# Un chantier par place libre si le mode autonome du projet est allumé, le plus ancien d'abord.
if [ -z "$attente" ] && [ "$(printf '%s' "$etat" | jq -r '.autonome // false')" = "true" ]; then
  while [ ${#donnes[@]} -lt "$libres" ]; do
    br="agent/$(date +%s%N | tail -c 7)"
    c=$(un "select prochain_chantier_autonome($P, null, '$br') as c" | jq -c '.c // empty')
    [ -n "$c" ] && [ "$c" != "null" ] || break
    donnes+=("$(printf '%s' "$c" | jq -c --arg slug "$projet" --arg depot "$depot" --arg br "$br" '. + {slug: $slug, depot: $depot, branche: $br}')")
  done
  # Sans crédit perdu (0031) : rien à faire depuis le délai réglé → le mode s'éteint tout seul.
  [ "$(un "select constater_autonome($P) as r" | jq -r '.r // empty')" = "eteint_auto" ] && note_auto="Mode autonome de $projet éteint tout seul (plus rien à prendre). "
fi
# « Je ne sais pas : vérifie pour moi » (0016) : un agent juge à sa place, dans CE projet.
while [ -z "$attente" ] && [ ${#donnes[@]} -lt "$libres" ]; do
  v=$(un "select c.id, c.titre, p.slug, p.depot, c.comment_verifier as comment, (select string_agg(m.corps, chr(10) || '---' || chr(10) order by m.created_at) from messages m where m.chantier_id = c.id and m.auteur_type in ('proprietaire','utilisateur') and not m.via_session and m.created_at >= c.verif_demandee_at - interval '1 minute') as apporte
    from verifs_prenables('$pid', null) c join projets p on p.id = c.projet_id
    where c.verif_demandee_at is not null and p.actif order by c.verif_demandee_at limit 1")
  vid=$(printf '%s' "$v" | jq -r '.id // empty'); [ -n "$vid" ] || break
  br="agent/verif-$(date +%s%N | tail -c 7)"
  [ "$(un "select reserver_chantier('$vid', '$br', 60) as ok" | jq -r '.ok')" = "true" ] || break
  donnes+=("$(printf '%s' "$v" | jq -c --arg br "$br" '. + {branche: $br, verif: true}')")
done
# « À toi » à jour (0022) : une place libre de plus → un agent revoit ce qui attend Raphaël depuis trop
# longtemps ou que du travail a suivi (retirer, confirmer, proposer une fusion). Au plus une revue par heure.
revue=""
if [ -z "$attente" ] && [ ${#donnes[@]} -lt "$libres" ]; then
  revue=$(COCKPIT_PROJET="$projet" COCKPIT_SQL="$SQL" bash "$(dirname "${BASH_SOURCE[0]}")/revue-a-toi.sh" 2>/dev/null)
  case "$revue" in RIEN*|"") revue="" ;; esac
fi
nb=$(( ${#donnes[@]} + $([ -n "$revue" ] && echo 1 || echo 0) ))
if [ "$nb" -eq 0 ]; then rien "${note_auto:-}aucun chantier à prendre dans $projet ($agents agent(s) au travail)."; fi
[ -n "$renf_txt" ] && printf '%s\n' "$renf_txt"

if [ -n "$attente" ]; then
  echo "RELÈVE de $projet (réveil immédiat) : la chef ($chef) vit mais dort ; tu sers seulement ce qui attend Raphaël. Lance $nb agent(s) MAINTENANT, un par chantier ci-dessous (outil Agent, run_in_background: true, isolation: \"worktree\"). Chaque chantier est déjà réservé à sa branche. Tu ne deviens pas chef. MODÈLES (économie de crédits, règle de Raphaël du 30 sept.) : passe le paramètre model de l'outil Agent indiqué sur la ligne de chaque agent (« modèle : haiku » pour Revoir À toi / Point / Vérifier ; « modèle : sonnet » pour Répondre, Réponse et coder un chantier) ; jamais opus sauf mention explicite de Raphaël. FREIN : si l'usage approche la limite (get_session → rate_limit_info.status différent de « allowed »), lance au plus 1 agent et saute les revues."
  echo "Quand un agent a fini : relis son rapport, puis relance $CHEF_CMD --releve ; quand il répond RIEN, termine en une ligne. Ne fais PAS le travail toi-même."
else
echo "SESSION CHEF de $projet : lance $nb agent(s) MAINTENANT, un par chantier ci-dessous (outil Agent, run_in_background: true, isolation: \"worktree\"). Tous sont de CE projet : les autres projets ont chacun leur chef, dans leur propre session. Chaque chantier est déjà réservé à sa branche. MODÈLES (économie de crédits, règle de Raphaël du 30 sept.) : passe le paramètre model de l'outil Agent indiqué sur la ligne de chaque agent (« modèle : haiku » pour Revoir À toi / Point / Vérifier ; « modèle : sonnet » pour Répondre, Réponse et coder un chantier) ; jamais opus sauf mention explicite de Raphaël. FREIN : si l'usage approche la limite (get_session → rate_limit_info.status différent de « allowed »), lance au plus 1 agent et saute les revues."
echo "Quand un agent a fini : relis son rapport, dis en 2 lignes à Raphaël ce qui est livré, puis relance $CHEF_CMD pour lancer le suivant. Ne fais PAS le travail toi-même : tu diriges."
fi
echo
VERDICT="${COCKPIT_VERDICT_CMD:-scripts/verdict.sh}"
for c in "${donnes[@]}"; do
  if [ "$(printf '%s' "$c" | jq -r '.reponse_prise // false')" = "true" ]; then
    printf '%s' "$c" | jq -r --arg prog "$PROG" --arg dem "$DEM" --arg repro "$(repro_ligne "$(printf '%s' "$c" | jq -r '.id // empty')")" '
"━━ Agent « Réponse : \(.titre) » [modèle : sonnet] (projet \(.slug), dépôt \(.depot), branche \(.branche), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit. Raphaël a répondu à une question sur le chantier « \(.titre) » (id \(.id)), projet \(.slug), dépôt \(.depot), et personne ne l’a reprise : c’est toi. \(if .etat_avant == "question de projet" then "C’était une question de projet, sans chantier : ce chantier interne vient d’être ouvert pour la suivre, réservé à ta branche." else "Le chantier était « \(.etat_avant) » ; il est remis en cours, réservé à ta branche." end)
Question posée (\(.question_id)) :
\(.question)\(if .pourquoi then "\nPourquoi : \(.pourquoi)" else "" end)
Réponse de Raphaël (\(.repondu_le)) : « \(.reponse // "") »\(if .precision then "\nSa précision : \(.precision)" else "" end)\(if (.medias // 0) > 0 then "\nIl a joint \(.medias) fichier(s) : COCKPIT_PROJET=\(.slug) scripts/media.sh --chantier \(.id), puis REGARDE-les avant d’agir." else "" end)
Demande du chantier :
\(.demande)\(if $repro != "" then "\n" + $repro else "" end)

Fais ce que cette réponse annonce. Lis d’abord le fil du chantier (ce que la question proposait exactement).\(if .depense then "\nCette réponse engage une DÉPENSE : respecte les barrières de budget du CLAUDE.md global — solde relevé AVANT de lancer, plafond de durée côté fournisseur, annulation automatique au-delà d’un plafond dans le script, surveillance job par job toutes les 10 minutes (annuler tout job au-delà de 2× sa durée normale), jamais au-delà du montant accepté." else "" end)
Règles : lis CLAUDE.md et docs/REPRISE.md du dépôt. Commence par : git switch -c \(.branche), et travaille sur cette branche (jamais directement sur main ; ta copie à toi ; le cockpit te reconnaît à ce nom). À chaque étape : COCKPIT_PROJET=\(.slug) \($prog) --agent \"Réponse : \(.titre)\" --chantier \(.id) --etape \"…\" --pct N --eta M. Aucune suppression ni envoi en son nom ; aucune dépense au-delà de ce que sa réponse accepte. Une nouvelle décision de Raphaël → COCKPIT_PROJET=\(.slug) \($dem) (règle de clarté) puis rends la main. Un geste manuel de Raphaël (clé, réglage, clic) : seulement si aucun chemin technique n’existe, et par COCKPIT_PROJET=\(.slug) \($dem) --action avec --lien \"https://…|libellé\" (la page EXACTE), --etape (un geste numéroté chacune, nom exact du bouton), --copier \"libellé|texte\" (prêt à coller) et --image si ça aide. Sinon mène-le au bout : tests du dépôt, commit, push de ta branche, fusion dans main seulement si tout est vert, vérification en ligne, et \($prog) --chantier \(.id) --termine \"…\" --verifier \"1. … 2. …\" --en-ligne/--pas-en-ligne. Rends un rapport de 5 lignes : livré, vérifié, reste.
---"'
    echo; continue
  fi
  if [ "$(printf '%s' "$c" | jq -r '.message_pris // false')" = "true" ]; then
    printf '%s' "$c" | jq -r --arg prog "$PROG" --arg dem "$DEM" '
(if .id then "--chantier \(.id) --point" else "--point" end) as $ou |
"━━ Agent « Répondre : \(.titre) » [modèle : sonnet] (projet \(.slug), dépôt \(.depot), branche \(.branche)\(if .id then ", chantier \(.id)" else ", fil du projet" end))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit. Raphaël a écrit dans le fil « \(.titre) » (projet \(.slug), dépôt \(.depot)) et personne ne lui a répondu : c’est toi. Il attend une RÉPONSE ÉCRITE dans ce fil, comme dans une discussion.
Ce qu’il a écrit :
\(.messages | map("- [\(.quand)] \(.texte)\(if .medias > 0 then " [\(.medias) pièce(s) jointe(s)]" else "" end)") | join("\n"))
Juste avant, dans le fil :
\(if (.contexte | length) > 0 then (.contexte | map("- [\(.quand)] \(.qui) : \(.texte)") | join("\n")) else "(rien)" end)
\(if .id then "État du chantier : \(.etat). Demande :\n\(.demande)" else "C’est le fil du projet (hors chantier)." end)\(if (.medias // 0) > 0 then "\nPièces jointes : COCKPIT_PROJET=\(.slug) scripts/media.sh \(if .id then "--chantier \(.id)" else "--message <id>" end), puis REGARDE-les." else "" end)

0. Commence par : git switch -c \(.branche) (le cockpit te reconnaît à ce nom)\(if .id then ", puis montre-lui que tu as pris son message : COCKPIT_PROJET=\(.slug) \($prog) --agent \"Répondre : \(.titre)\" --chantier \(.id) --etape \"Je lis ton message\" --pct 20 --eta 5m" else "" end).\(if .ou_en_est then "\nIl a AUSSI demandé « où ça en est ? » sur ce chantier : ta réponse le dit aussi (ce qui est fait, ce qui reste pour finir et qui le fait, ce qui bloque)." else "" end)
1. Comprends ce qu’il demande (lis le fil, le code, la base : vérifie avant d’affirmer).
2. RÉPONDS-LUI d’abord, court, en mots simples (400 caractères au plus), la réponse en premier : COCKPIT_PROJET=\(.slug) \($prog) \($ou) \"…\". Une capture aide ? COCKPIT_PROJET=\(.slug) scripts/media.sh --envoyer --chantier <id> --texte \"…\" --image capture.png.
3. PLUSIEURS SUJETS dans son message ? Un sujet = un fil : rattache chacun à son chantier (COCKPIT_PROJET=\(.slug) scripts/chantier.sh --ouvrir \"<titre>\" --demande \"<ses mots sur ce sujet>\" : il reprend, regroupe ou crée), réponds dans le fil de CHAQUE chantier (COCKPIT_PROJET=\(.slug) \($prog) --chantier <id> --point \"…\"), et dans ce fil-ci une ligne qui dit où chaque sujet est parti.
4. S’il demande un travail : dis-le dans ta réponse, puis fais-le si c’est court et sans risque (branche \(.branche), jamais main directement ; tests ; progression : COCKPIT_PROJET=\(.slug) \($prog) --agent \"Répondre : \(.titre)\"\(if .id then " --chantier \(.id)" else "" end) --etape \"…\" --pct N --eta M). Sinon ouvre ou complète un chantier (scripts/chantier.sh --ouvrir) et dis-le-lui.
5. Une décision de Raphaël nécessaire → COCKPIT_PROJET=\(.slug) \($dem) (règle de clarté), puis rends la main. Un geste manuel de Raphaël (clé, réglage, clic) : seulement si aucun chemin technique n’existe, et par COCKPIT_PROJET=\(.slug) \($dem) --action avec --lien \"https://…|libellé\" (la page EXACTE), --etape (un geste numéroté chacune, nom exact du bouton), --copier \"libellé|texte\" (prêt à coller) et --image si ça aide.
Aucune dépense, suppression ni envoi en son nom. Ne change pas l’état du chantier pour rien (il est seulement réservé à ta branche 60 min). Rends un rapport de 3 lignes : ce que tu as répondu, ce que tu as fait, ce qui reste.
---"'
    echo; continue
  fi
  if [ "$(printf '%s' "$c" | jq -r '.point // false')" = "true" ]; then
    printf '%s' "$c" | jq -r --arg prog "$PROG" --arg sql "${COCKPIT_SQL_CMD:-scripts/sql.sh}" '
"━━ Agent « Point : \(.titre) » [modèle : haiku] (projet \(.slug), dépôt \(.depot), branche \(.branche), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit. Raphaël demande OÙ EN EST le chantier « \(.titre) » (id \(.id)), projet \(.slug), dépôt \(.depot) (demandé le \(.demande_le)). Aucune session ne le tient : c’est toi qui réponds.
État : \(.etat)\(if .pris_par then " · dernière branche : \(.pris_par)" else "" end)\(if .derniere_etape then " · dernière étape signalée : \(.derniere_etape)" else "" end)
Demande du chantier :
\(.demande)\(if ((.messages // []) | length) > 0 then "\nIl a AUSSI écrit dans ce fil (ta même réponse doit y répondre) :\n" + ((.messages // []) | map("- [\(.quand)] \(.texte)") | join("\n")) else "" end)

0. Commence par : git switch -c \(.branche) (le cockpit te reconnaît à ce nom), puis montre-lui tout de suite que tu regardes : COCKPIT_PROJET=\(.slug) \($prog) --agent \"Point : \(.titre)\" --chantier \(.id) --etape \"Je regarde où en est le chantier\" --pct 20 --eta 5m
1. Regarde à la source, SANS rien modifier : le fil du chantier (\($sql) \u0027select auteur_type, kind, corps, reponse, created_at from messages where chantier_id = $$\(.id)$$ order by created_at\u0027), la branche et ses commits s’il y en a, ce qui est sur main et en ligne.
2. Réponds-lui dans le fil, 400 caractères au plus, mots simples, en trois morceaux : ce qui est fait ; ce qui reste pour FINIR le chantier et QUI le fait (Claude, ou lui : quel geste) ; ce qui bloque (ou « rien ») :
COCKPIT_PROJET=\(.slug) \($prog) --chantier \(.id) --point \"Fait : … Pour finir : … Bloque : …\"
3. Termine ta ligne : COCKPIT_PROJET=\(.slug) \($prog) --agent \"Point : \(.titre)\" --termine \"Réponse écrite dans le fil\"
Ne réserve pas le chantier, ne code rien. Rends un rapport de 2 lignes.
---"'
    echo; continue
  fi
  if [ "$(printf '%s' "$c" | jq -r '.verif // false')" = "true" ]; then
    printf '%s' "$c" | jq -r --arg prog "$PROG" --arg verdict "$VERDICT" '
"━━ Agent « Vérifier : \(.titre) » [modèle : haiku] (projet \(.slug), dépôt \(.depot), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit. Raphaël a testé le chantier « \(.titre) » (projet \(.slug)) mais ne sait pas dire si le résultat est le bon : c’est TOI qui juges.
Ce qu’on lui a demandé de vérifier :
\(.comment // "(rien d’écrit)")
Ce qu’il a vu et collé :
\(.apporte // "(rien)")

Compare ce qu’il a vu au résultat attendu, en vérifiant toi-même à la source (base du cockpit, code du dépôt, site en ligne). Photos jointes : COCKPIT_PROJET=\(.slug) scripts/media.sh --chantier \(.id), puis regarde-les. Ne modifie rien. Puis rends ton verdict en mots simples, preuve à l’appui (400 caractères au plus) :
COCKPIT_PROJET=\(.slug) \($verdict) --chantier \(.id) --bon \"…\"   ou   --pas-bon \"…\"
Rends un rapport de 3 lignes.
---"'
    echo; continue
  fi
  printf '%s' "$c" | jq -r --arg prog "$PROG" --arg dem "$DEM" --arg repro "$(repro_ligne "$(printf '%s' "$c" | jq -r '.id // empty')")" '
"━━ Agent « \(.titre) » [modèle : sonnet] (projet \(.slug), dépôt \(.depot), branche \(.branche), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit. Chantier « \(.titre) » (id \(.id)), projet \(.slug), dépôt \(.depot).\(if .etat_avant == "en_cours" then " Il était en cours puis abandonné : lis son fil et reprends où il en était." elif .etat_avant == "a_trier" then " Pas encore trié : décide s’il faut le faire ; doublon → scripts/chantier.sh --suggerer-fusion ; décision de Raphaël nécessaire → question avec \($dem), puis arrête-toi." else "" end)
Demande :
\(.demande)\(if $repro != "" then "\n" + $repro else "" end)

Règles : lis CLAUDE.md et docs/REPRISE.md du dépôt. Commence par : git switch -c \(.branche), et travaille sur cette branche (jamais directement sur main ; ta copie à toi ; le cockpit te reconnaît à ce nom). À chaque étape : COCKPIT_PROJET=\(.slug) \($prog) --agent \"\(.titre)\" --chantier \(.id) --etape \"…\" --pct N --eta M. AUCUNE dépense, suppression ou envoi en son nom. Une décision de Raphaël → COCKPIT_PROJET=\(.slug) \($dem) (règle de clarté : une phrase, 2 à 4 réponses prêtes) puis rends la main. Un geste manuel de Raphaël (clé, réglage, clic) : seulement si aucun chemin technique n’existe, et par COCKPIT_PROJET=\(.slug) \($dem) --action avec --lien \"https://…|libellé\" (la page EXACTE), --etape (un geste numéroté chacune, nom exact du bouton), --copier \"libellé|texte\" (prêt à coller) et --image si ça aide. Sinon mène-le au bout : tests du dépôt, commit, push de ta branche, puis fusion dans main seulement si tout est vert, vérification en ligne, et \($prog) --chantier \(.id) --termine \"…\" --verifier \"1. … 2. …\" --en-ligne/--pas-en-ligne. Rends un rapport de 5 lignes : livré, vérifié, reste.
---"'
  echo
done
if [ -n "$revue" ]; then
  echo "━━ Agent « Revoir À toi de jouer » [modèle : haiku] (projet $projet, dépôt $depot, aucune branche : il ne code pas)"
  echo "Consigne à lui donner, telle quelle :"
  echo "---"
  printf '%s\n' "$revue"
  echo "---"
fi
