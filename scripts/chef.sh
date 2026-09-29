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
#   scripts/chef.sh --etat          qui est chef du projet, combien d'agents tournent
#   scripts/chef.sh --reveil <trig_…> [--distante <session_…>]   note le réveil horaire du projet
#   scripts/chef.sh --max <n>       nombre d'agents en parallèle pour le projet (1 à 8)
#   scripts/chef.sh --renforts <n>  sessions de RENFORT au plus (0 à 4, 0 = aucune ; 0022)
#   scripts/chef.sh --agents-renfort <n>  agents par session de renfort (1 à 5)
#   (renforts : Raphaël les demande d'un bouton de l'app ; voir scripts/renfort.sh)
#
# Projet : $COCKPIT_PROJET (posé par brancher.sh), --projet <slug>, sinon le
# dépôt courant (projets.depot). Session : $CLAUDE_CODE_SESSION_ID (ou --session <id>).
set -uo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
PROG="${COCKPIT_PROG_CMD:-scripts/progression.sh}"; DEM="${COCKPIT_DEM_CMD:-scripts/demander.sh}"
CHEF_CMD="${COCKPIT_CHEF_CMD:-scripts/chef.sh}"
q() { printf '%s' "$1" | sed "s/'/''/g"; }
sid="${CLAUDE_CODE_SESSION_ID:-}"; mode="passe"; reveil=""; distante=""; max=""; projet="${COCKPIT_PROJET:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --prendre) mode="prendre"; shift ;;
    --etat)    mode="etat"; shift ;;
    --reveil)  mode="reveil"; reveil="${2:-}"; shift 2 ;;
    --distante) distante="${2:-}"; shift 2 ;;
    --max)     mode="max"; max="${2:-}"; shift 2 ;;
    --renforts) mode="renforts"; max="${2:-}"; shift 2 ;;
    --agents-renfort) mode="agents_renfort"; max="${2:-}"; shift 2 ;;
    --session) sid="${2:-}"; shift 2 ;;
    --projet)  projet="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
dossier="${CLAUDE_PROJECT_DIR:-$PWD}"
branche=$(git -C "$dossier" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
un() { "$SQL" "$1" 2>/dev/null | jq -c '.rows[0] // {}'; }
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

case "$mode" in
  prendre)
    [ -n "$sid" ] || { echo "Session inconnue." >&2; exit 2; }
    r=$(un "select prendre_chef($P, '$(q "$sid")', '$(q "$branche")', '$(q "$distante")') as r" | jq -c '.r // {}')
    if [ "$(printf '%s' "$r" | jq -r '.change')" = "true" ]; then
      trig=$(printf '%s' "$r" | jq -r '.reveil_trigger // empty')
      echo "Cette session devient la SESSION CHEF du projet $projet, et de lui seul (avant : $(printf '%s' "$r" | jq -r '.ancienne // "aucune"')). Chaque autre projet a son chef dans sa propre session : n'y touche pas d'ici."
      echo "Déplace le réveil horaire de $projet sur toi : ${trig:+supprime le réveil $trig (delete_trigger), puis }crée-en un (create_trigger, toutes les heures, sur CETTE session, message « Réveil du chef de $projet : lance $CHEF_CMD et suis sa consigne »), puis note-le : $CHEF_CMD --reveil <trig_…> --distante <ton id session_…>."
    fi
    exit 0 ;;
  reveil)
    "$SQL" "insert into chefs (projet_id, reveil_trigger, session_distante) select id, '$(q "$reveil")', nullif('$(q "$distante")', '') from projets where slug = $P on conflict (projet_id) do update set reveil_trigger = excluded.reveil_trigger, session_distante = coalesce(excluded.session_distante, chefs.session_distante)" >/dev/null \
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
  (select count(*) from taches t where t.session_id = c.session_id and t.projet_id = p.id and t.type = 'agent' and t.statut = 'en_cours' and t.vu_at > now() - interval '3 hours')::int as agents
  from projets p left join chefs c on c.projet_id = p.id where p.slug = $P")
if [ "$mode" = "etat" ]; then printf '%s\n' "$etat" | jq .; exit 0; fi

pid=$(printf '%s' "$etat" | jq -r '.projet_id // empty')
[ -n "$pid" ] || { echo "RIEN — projet $projet inconnu du cockpit. Termine ta réponse en une ligne."; exit 0; }
chef=$(printf '%s' "$etat" | jq -r 'if .actif == false then "" else (.session_id // "") end')
if [ -z "$chef" ] || [ "$chef" != "$sid" ]; then
  echo "RIEN — cette session n'est pas la session chef de $projet (chef : ${chef:-aucune}). Termine ta réponse en une ligne, sans rien faire d'autre."; exit 0
fi
"$SQL" "update chefs set vu_at = now() where projet_id = '$pid'" >/dev/null 2>&1
agents=$(printf '%s' "$etat" | jq -r '.agents // 0'); maxa=$(printf '%s' "$etat" | jq -r '.max_agents // 3')
depot=$(printf '%s' "$etat" | jq -r '.depot // ""')
libres=$(( maxa - agents ))
# RENFORTS (0022) : Raphaël les demande d'un bouton dans l'app (une session par
# SECTION en attente) ; la chef les OUVRE (create_session), les note, et archive
# ceux qui ont fini. Jamais leur travail elle-même. Projets de test : jamais.
RENF="${COCKPIT_RENFORT_CMD:-scripts/renfort.sh}"
renforts=$(un "select renforts_a_ouvrir($P) as r" | jq -c '.r // {}')
renf_txt=$(printf '%s' "$renforts" | jq -r --arg r "$RENF" '
  ((.archiver // []) | map("- Renfort « \(.section) » \(if .statut == "fini" then "fini (sa section est vide)" else "muet depuis 3 h" end) : archive_session(\"\(.session)\"), puis \($r) --archive \(.id)")) +
  ((.ouvrir // []) | map("- Nouveau renfort « \(.section) » (\(.chantiers) chantier(s), \(.agents) agent(s) au plus) : create_session(title: \"Renfort · \(.slug) · \(.section) — ne pas toucher\", tags: [\"cockpit-renfort\", \"cockpit-\(.slug)\"], source_url: \"https://github.com/\(.depot)\", prompt: \"[cockpit-renfort] Tu es un RENFORT du cockpit (projet \(.slug), section « \(.section) »). Lance \($r) --suivant \(.id) et suis sa consigne : elle te donne jusqu’à \(.agents) chantier(s) de ta section, un agent chacun. À la fin de CHAQUE agent, relance \($r) --suivant \(.id). Quand elle dit FINI, arrête-toi en une ligne. Ne prends rien d’autre, ne parle pas à Raphaël ici : il répond dans le cockpit.\"), puis \($r) --session \(.id) <session_… rendu>. Si create_session échoue : \($r) --erreur \(.id) \"<raison courte>\" (Raphaël la verra).")) | join("\n")')
[ -n "$renf_txt" ] && renf_txt="RENFORTS de $projet, demandés par Raphaël dans le cockpit (sessions à part, chacune sa machine ; ne fais pas leur travail) :
$renf_txt
"
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
# Un chantier par place libre si le mode autonome du projet est allumé, le plus ancien d'abord.
if [ "$(printf '%s' "$etat" | jq -r '.autonome // false')" = "true" ]; then
  while [ ${#donnes[@]} -lt "$libres" ]; do
    br="agent/$(date +%s%N | tail -c 7)"
    c=$(un "select prochain_chantier_autonome($P, null, '$br') as c" | jq -c '.c // empty')
    [ -n "$c" ] && [ "$c" != "null" ] || break
    donnes+=("$(printf '%s' "$c" | jq -c --arg slug "$projet" --arg depot "$depot" --arg br "$br" '. + {slug: $slug, depot: $depot, branche: $br}')")
  done
fi
# « Je ne sais pas : vérifie pour moi » (0016) : un agent juge à sa place, dans CE projet.
while [ ${#donnes[@]} -lt "$libres" ]; do
  v=$(un "select c.id, c.titre, p.slug, p.depot, c.comment_verifier as comment, (select string_agg(m.corps, chr(10) || '---' || chr(10) order by m.created_at) from messages m where m.chantier_id = c.id and m.auteur_type in ('proprietaire','utilisateur') and m.created_at >= c.verif_demandee_at - interval '1 minute') as apporte
    from verifs_prenables('$pid', null) c join projets p on p.id = c.projet_id
    where c.verif_demandee_at is not null and p.actif order by c.verif_demandee_at limit 1")
  vid=$(printf '%s' "$v" | jq -r '.id // empty'); [ -n "$vid" ] || break
  br="agent/verif-$(date +%s%N | tail -c 7)"
  [ "$(un "select reserver_chantier('$vid', '$br', 60) as ok" | jq -r '.ok')" = "true" ] || break
  donnes+=("$(printf '%s' "$v" | jq -c --arg br "$br" '. + {branche: $br, verif: true}')")
done
if [ ${#donnes[@]} -eq 0 ]; then rien "aucun chantier à prendre dans $projet ($agents agent(s) au travail)."; fi
[ -n "$renf_txt" ] && printf '%s\n' "$renf_txt"

echo "SESSION CHEF de $projet : lance ${#donnes[@]} agent(s) MAINTENANT, un par chantier ci-dessous (outil Agent, run_in_background: true, isolation: \"worktree\"). Tous sont de CE projet : les autres projets ont chacun leur chef, dans leur propre session. Chaque chantier est déjà réservé à sa branche."
echo "Quand un agent a fini : relis son rapport, dis en 2 lignes à Raphaël ce qui est livré, puis relance $CHEF_CMD pour lancer le suivant. Ne fais PAS le travail toi-même : tu diriges."
echo
VERDICT="${COCKPIT_VERDICT_CMD:-scripts/verdict.sh}"
for c in "${donnes[@]}"; do
  if [ "$(printf '%s' "$c" | jq -r '.reponse_prise // false')" = "true" ]; then
    printf '%s' "$c" | jq -r --arg prog "$PROG" --arg dem "$DEM" '
"━━ Agent « Réponse : \(.titre) » (projet \(.slug), dépôt \(.depot), branche \(.branche), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit. Raphaël a répondu à une question sur le chantier « \(.titre) » (id \(.id)), projet \(.slug), dépôt \(.depot), et personne ne l’a reprise : c’est toi. \(if .etat_avant == "question de projet" then "C’était une question de projet, sans chantier : ce chantier interne vient d’être ouvert pour la suivre, réservé à ta branche." else "Le chantier était « \(.etat_avant) » ; il est remis en cours, réservé à ta branche." end)
Question posée (\(.question_id)) :
\(.question)\(if .pourquoi then "\nPourquoi : \(.pourquoi)" else "" end)
Réponse de Raphaël (\(.repondu_le)) : « \(.reponse // "") »\(if .precision then "\nSa précision : \(.precision)" else "" end)\(if (.medias // 0) > 0 then "\nIl a joint \(.medias) fichier(s) : COCKPIT_PROJET=\(.slug) scripts/media.sh --chantier \(.id), puis REGARDE-les avant d’agir." else "" end)
Demande du chantier :
\(.demande)

Fais ce que cette réponse annonce. Lis d’abord le fil du chantier (ce que la question proposait exactement).\(if .depense then "\nCette réponse engage une DÉPENSE : respecte les barrières de budget du CLAUDE.md global — solde relevé AVANT de lancer, plafond de durée côté fournisseur, annulation automatique au-delà d’un plafond dans le script, surveillance job par job toutes les 10 minutes (annuler tout job au-delà de 2× sa durée normale), jamais au-delà du montant accepté." else "" end)
Règles : lis CLAUDE.md et docs/REPRISE.md du dépôt. Travaille sur la branche \(.branche) (jamais directement sur main ; ta copie à toi). À chaque étape : COCKPIT_PROJET=\(.slug) \($prog) --agent \"Réponse : \(.titre)\" --chantier \(.id) --etape \"…\" --pct N --eta M. Aucune suppression ni envoi en son nom ; aucune dépense au-delà de ce que sa réponse accepte. Une nouvelle décision de Raphaël → COCKPIT_PROJET=\(.slug) \($dem) (règle de clarté) puis rends la main. Sinon mène-le au bout : tests du dépôt, commit, push de ta branche, fusion dans main seulement si tout est vert, vérification en ligne, et \($prog) --chantier \(.id) --termine \"…\" --verifier \"1. … 2. …\" --en-ligne/--pas-en-ligne. Rends un rapport de 5 lignes : livré, vérifié, reste.
---"'
    echo; continue
  fi
  if [ "$(printf '%s' "$c" | jq -r '.verif // false')" = "true" ]; then
    printf '%s' "$c" | jq -r --arg prog "$PROG" --arg verdict "$VERDICT" '
"━━ Agent « Vérifier : \(.titre) » (projet \(.slug), dépôt \(.depot), chantier \(.id))
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
  printf '%s' "$c" | jq -r --arg prog "$PROG" --arg dem "$DEM" '
"━━ Agent « \(.titre) » (projet \(.slug), dépôt \(.depot), branche \(.branche), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit. Chantier « \(.titre) » (id \(.id)), projet \(.slug), dépôt \(.depot).\(if .etat_avant == "en_cours" then " Il était en cours puis abandonné : lis son fil et reprends où il en était." elif .etat_avant == "a_trier" then " Pas encore trié : décide s’il faut le faire ; doublon → scripts/chantier.sh --suggerer-fusion ; décision de Raphaël nécessaire → question avec \($dem), puis arrête-toi." else "" end)
Demande :
\(.demande)

Règles : lis CLAUDE.md et docs/REPRISE.md du dépôt. Travaille sur la branche \(.branche) (jamais directement sur main ; ta copie à toi). À chaque étape : COCKPIT_PROJET=\(.slug) \($prog) --agent \"\(.titre)\" --chantier \(.id) --etape \"…\" --pct N --eta M. AUCUNE dépense, suppression ou envoi en son nom. Une décision de Raphaël → COCKPIT_PROJET=\(.slug) \($dem) (règle de clarté : une phrase, 2 à 4 réponses prêtes) puis rends la main. Sinon mène-le au bout : tests du dépôt, commit, push de ta branche, puis fusion dans main seulement si tout est vert, vérification en ligne, et \($prog) --chantier \(.id) --termine \"…\" --verifier \"1. … 2. …\" --en-ligne/--pas-en-ligne. Rends un rapport de 5 lignes : livré, vérifié, reste.
---"'
  echo
done
