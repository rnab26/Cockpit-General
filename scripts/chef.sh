#!/usr/bin/env bash
# LA SESSION CHEF (29 sept. 2026) : une seule session dirige tous les projets ;
# elle lance des AGENTS sur les chantiers au lieu d'avoir plusieurs sessions
# autonomes qui se marchent dessus.
#
# Raphaël : « une seule session maître, dessus tu me réponds, je réponds aussi
# dans le cockpit ; elle ouvre des agents plutôt que plein de sessions
# autonomes ; les agents travaillent en permanence ; si j'ouvre une nouvelle
# session et laisse celle-là de côté, elle doit faire le même travail. »
#
#   scripts/chef.sh                 la passe : lance les agents qui manquent
#                                   (appelée au réveil, et à la fin de CHAQUE agent)
#   scripts/chef.sh --prendre       cette session devient chef (hook, message de Raphaël)
#   scripts/chef.sh --etat          qui est chef, combien d'agents tournent
#   scripts/chef.sh --reveil <trig_…> [--distante <session_…>]   note le réveil horaire
#   scripts/chef.sh --max <n>       nombre d'agents en parallèle (1 à 8)
#
# Session courante : $CLAUDE_CODE_SESSION_ID (ou --session <id>).
set -uo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
PROG="${COCKPIT_PROG_CMD:-scripts/progression.sh}"; DEM="${COCKPIT_DEM_CMD:-scripts/demander.sh}"
q() { printf '%s' "$1" | sed "s/'/''/g"; }
sid="${CLAUDE_CODE_SESSION_ID:-}"; mode="passe"; reveil=""; distante=""; max=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prendre) mode="prendre"; shift ;;
    --etat)    mode="etat"; shift ;;
    --reveil)  mode="reveil"; reveil="${2:-}"; shift 2 ;;
    --distante) distante="${2:-}"; shift 2 ;;
    --max)     mode="max"; max="${2:-}"; shift 2 ;;
    --session) sid="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
branche=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
un() { "$SQL" "$1" 2>/dev/null | jq -c '.rows[0] // {}'; }

case "$mode" in
  prendre)
    [ -n "$sid" ] || { echo "Session inconnue." >&2; exit 2; }
    r=$(un "select prendre_chef('$(q "$sid")', '$(q "$branche")', '$(q "$distante")') as r" | jq -c '.r')
    if [ "$(printf '%s' "$r" | jq -r '.change')" = "true" ]; then
      trig=$(printf '%s' "$r" | jq -r '.reveil_trigger // empty')
      echo "Cette session devient la SESSION CHEF du cockpit (avant : $(printf '%s' "$r" | jq -r '.ancienne // "aucune"'))."
      echo "Déplace le réveil horaire sur toi : ${trig:+supprime le réveil $trig (delete_trigger), puis }crée-en un (create_trigger, toutes les heures, sur CETTE session, message « Réveil du chef : lance scripts/chef.sh et suis sa consigne »), puis note-le : scripts/chef.sh --reveil <trig_…> --distante <ton id session_…>."
    fi
    exit 0 ;;
  reveil)
    "$SQL" "update chef set reveil_trigger = '$(q "$reveil")', session_distante = coalesce(nullif('$(q "$distante")', ''), session_distante) where id = 1" >/dev/null && echo "Réveil noté : $reveil." ; exit 0 ;;
  max)
    [[ "$max" =~ ^[1-8]$ ]] || { echo "--max : un nombre de 1 à 8." >&2; exit 2; }
    "$SQL" "update chef set max_agents = $max where id = 1" >/dev/null && echo "Agents en parallèle : $max." ; exit 0 ;;
esac

etat=$(un "select c.session_id, c.branche, c.max_agents, c.reveil_trigger, c.actif, to_char(c.depuis at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI') as depuis,
  (select count(*) from taches t where t.session_id = c.session_id and t.type = 'agent' and t.statut = 'en_cours' and t.vu_at > now() - interval '3 hours')::int as agents
  from chef c where c.id = 1")
if [ "$mode" = "etat" ]; then printf '%s\n' "$etat" | jq .; exit 0; fi

chef=$(printf '%s' "$etat" | jq -r '.session_id // empty')
if [ -z "$chef" ] || [ "$chef" != "$sid" ]; then
  echo "RIEN — cette session n'est pas la session chef (chef : ${chef:-aucune}). Termine ta réponse en une ligne, sans rien faire d'autre."; exit 0
fi
"$SQL" "update chef set vu_at = now() where id = 1" >/dev/null 2>&1
agents=$(printf '%s' "$etat" | jq -r '.agents // 0'); maxa=$(printf '%s' "$etat" | jq -r '.max_agents // 3')
libres=$(( maxa - agents ))
if [ "$libres" -le 0 ]; then echo "RIEN — $agents agent(s) travaillent déjà (maximum $maxa). Termine ta réponse en une ligne."; exit 0; fi

donnes=()
# D'abord les RÉPONSES de Raphaël que personne n'a reprises (0017) : une réponse
# sur un chantier que personne ne tient (à vérifier, bloqué, réservation
# expirée) ne se perd plus. Tous projets actifs, la plus ancienne d'abord ;
# le chantier repart « en cours », réservé à la branche de l'agent.
while [ ${#donnes[@]} -lt "$libres" ]; do
  br="agent/reponse-$(date +%s%N | tail -c 7)"
  rp=$(un "select reprendre_reponse('$br') as r" | jq -c '.r // empty')
  [ -n "$rp" ] && [ "$rp" != "null" ] || break
  donnes+=("$(printf '%s' "$rp" | jq -c --arg br "$br" '. + {branche: $br, reponse_prise: true}')")
done
# Un chantier par place libre, tous projets (ceux dont le mode autonome est allumé), le plus ancien d'abord.
# Jamais un projet de TEST (slug « test-… », créés et supprimés par verifier-base/web) : projet_de_test() (0017).
for slug in $("$SQL" "select slug from projets where actif and not projet_de_test(slug) and (autonome_toujours or coalesce(autonome_jusqu_a > now(), false)) order by slug" | jq -r '.rows[].slug'); do
  while [ ${#donnes[@]} -lt "$libres" ]; do
    br="agent/$(date +%s%N | tail -c 7)"
    c=$(un "select prochain_chantier_autonome('$(q "$slug")', null, '$br') as c" | jq -c '.c // empty')
    [ -n "$c" ] && [ "$c" != "null" ] || break
    depot=$("$SQL" "select depot from projets where slug = '$(q "$slug")'" | jq -r '.rows[0].depot // ""')
    donnes+=("$(printf '%s' "$c" | jq -c --arg slug "$slug" --arg depot "$depot" --arg br "$br" '. + {slug: $slug, depot: $depot, branche: $br}')")
  done
done
# « Je ne sais pas : vérifie pour moi » (0016) : un agent juge à sa place, tous projets.
while [ ${#donnes[@]} -lt "$libres" ]; do
  v=$(un "select c.id, c.titre, p.slug, p.depot, c.comment_verifier as comment, (select string_agg(m.corps, chr(10) || '---' || chr(10) order by m.created_at) from messages m where m.chantier_id = c.id and m.auteur_type in ('proprietaire','utilisateur') and m.created_at >= c.verif_demandee_at - interval '1 minute') as apporte
    from chantiers c join projets p on p.id = c.projet_id
    where c.verif_demandee_at is not null and c.archived_at is null and p.actif and not projet_de_test(p.slug)
      and (c.pris_par is null or c.pris_jusqu_a < now()) order by c.verif_demandee_at limit 1")
  vid=$(printf '%s' "$v" | jq -r '.id // empty'); [ -n "$vid" ] || break
  br="agent/verif-$(date +%s%N | tail -c 7)"
  [ "$(un "select reserver_chantier('$vid', '$br', 60) as ok" | jq -r '.ok')" = "true" ] || break
  donnes+=("$(printf '%s' "$v" | jq -c --arg br "$br" '. + {branche: $br, verif: true}')")
done
if [ ${#donnes[@]} -eq 0 ]; then echo "RIEN — aucun chantier à prendre ($agents agent(s) au travail). Termine ta réponse en une ligne."; exit 0; fi

echo "SESSION CHEF : lance ${#donnes[@]} agent(s) MAINTENANT, un par chantier ci-dessous (outil Agent, run_in_background: true, isolation: \"worktree\" pour le cockpit ; pour un autre dépôt, l'agent travaille dans son propre clone). Chaque chantier est déjà réservé à sa branche."
echo "Quand un agent a fini : relis son rapport, dis en 2 lignes à Raphaël ce qui est livré, puis relance scripts/chef.sh pour lancer le suivant. Ne fais PAS le travail toi-même : tu diriges."
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
