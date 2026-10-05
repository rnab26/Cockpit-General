#!/usr/bin/env bash
# SESSIONS DE RENFORT (29 sept. 2026, migration 0024). Raphaël les demande d'un
# bouton dans l'app (« Lancer des renforts ») : une session cloud par SECTION
# en attente, ouverte par la chef du projet, qui ne traite QUE les chantiers de
# sa section, avec plusieurs agents à la fois (5 au plus), puis s'arrête.
# « Ne jamais se marcher dessus » : chaque chantier est réservé en base à UNE
# branche du renfort, et personne d'autre ne prend dans sa section tant qu'il vit.
#
#   scripts/renfort.sh --suivant <id>            (le renfort) ses chantiers suivants, ATTENDS, ou FINI
#   scripts/renfort.sh --session <id> <session_…>  (la chef) note la session créée par create_session
#   scripts/renfort.sh --erreur <id> "<raison>"    (la chef) l'ouverture a échoué : Raphaël le voit
#   scripts/renfort.sh --archive <id>            (la chef) note l'archivage (archive_session fait)
#   scripts/renfort.sh --est-renfort             code 0 si CETTE copie du dépôt est une session renfort
set -uo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
# Commande soeur : celle du dépôt courant si elle y est, sinon celle qui est à côté de CE script (renfort lancé
# depuis le cache du cockpit dans une copie qui n'a pas les scripts : chantier 60317482).
soeur() { if [ -x "scripts/$1" ]; then printf 'scripts/%s' "$1"; else printf '%s/scripts/%s' "$RACINE" "$1"; fi; }
PRFUS="${COCKPIT_PRFUS_CMD:-$(soeur pr-a-fusionner.sh)}"; PROG="${COCKPIT_PROG_CMD:-$(soeur progression.sh)}"; DEM="${COCKPIT_DEM_CMD:-$(soeur demander.sh)}"
VERDICT="${COCKPIT_VERDICT_CMD:-$(soeur verdict.sh)}"; RENF="${COCKPIT_RENFORT_CMD:-$(soeur renfort.sh)}"
# D-05 : la ligne « scénario capturé chez l'utilisateur » d'une consigne, vide s'il n'y en a pas.
repro_ligne() { [ -n "${1:-}" ] || return 0; COCKPIT_SQL="$SQL" bash "$(dirname "${BASH_SOURCE[0]}")/reproduction.sh" --ligne "$1" 2>/dev/null || true; }
q() { printf '%s' "$1" | sed "s/'/''/g"; }
uuid='^[0-9a-f-]{36}$'
# La marque « cette session est un renfort » : dans le dossier .git de la copie
# (jamais commitée, propre à cette copie : un worktree a le sien). Les hooks la lisent : un renfort ne
# devient jamais chef du projet et n'enchaîne rien d'autre que sa section.
marque() {
  local d
  d=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --absolute-git-dir 2>/dev/null) || return 1
  printf '%s/cockpit-renfort' "$d"
}
case "${1:-}" in
  --est-renfort)
    m=$(marque) && [ -s "$m" ] && exit 0; exit 1 ;;
  --session)
    [[ "${2:-}" =~ $uuid ]] && [ -n "${3:-}" ] || { echo "--session <id renfort> <session_…>" >&2; exit 2; }
    "$SQL" "select renfort_session('$2', '$(q "$3")') as ok" | jq -e '.rows[0].ok == true' >/dev/null \
      && echo "Renfort $2 noté : $3." || { echo "Renfort $2 introuvable ou déjà noté." >&2; exit 1; } ;;
  --erreur)
    [[ "${2:-}" =~ $uuid ]] && [ -n "${3:-}" ] || { echo "--erreur <id renfort> \"<raison>\"" >&2; exit 2; }
    "$SQL" "select renfort_erreur('$2', '$(q "$3")') as ok" | jq -e '.rows[0].ok == true' >/dev/null \
      && echo "Renfort $2 : erreur notée (visible dans le cockpit)." || { echo "Renfort $2 introuvable ou déjà fermé." >&2; exit 1; } ;;
  --archive)
    [[ "${2:-}" =~ $uuid ]] || { echo "--archive <id renfort>" >&2; exit 2; }
    "$SQL" "select renfort_archive('$2') as ok" | jq -e '.rows[0].ok == true' >/dev/null \
      && echo "Renfort $2 archivé." || { echo "Renfort $2 introuvable ou déjà archivé." >&2; exit 1; } ;;
  --suivant)
    [[ "${2:-}" =~ $uuid ]] || { echo "--suivant <id renfort>" >&2; exit 2; }
    m=$(marque) && printf '%s\n' "$2" > "$m" 2>/dev/null
    # Lie la session des hooks (CLAUDE_CODE_SESSION_ID) au renfort : son signe de vie compte (migration 0057).
    [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && "$SQL" "select renfort_lier('$2', '$(q "$CLAUDE_CODE_SESSION_ID")')" >/dev/null 2>&1
    r=$("$SQL" "select prochain_renfort('$2') as r" 2>/dev/null | jq -c '.rows[0].r // empty')
    [ -n "$r" ] && [ "$r" != "null" ] || { echo "ERREUR — le cockpit ne répond pas (prochain_renfort). Réessaie dans une minute ; si ça persiste, arrête-toi en une ligne."; exit 1; }
    etat=$(printf '%s' "$r" | jq -r '.etat')
    if [ "$etat" = "fini" ]; then
      echo "FINI — plus aucun chantier dans ta section, et aucun en cours. Arrête-toi en une ligne et FERME-TOI : si l'outil archive_session existe, archive TA session (get_session sans identifiant te donne ton id) ; sinon la chef l'archivera à sa passe suivante. Une session finie ne reste jamais ouverte."; exit 0
    fi
    if [ "$etat" = "attends" ]; then
      echo "ATTENDS — $(printf '%s' "$r" | jq -r '.en_cours') chantier(s) de ta section avancent encore avec tes agents, rien de nouveau à prendre. Ne prends rien d'autre : à la fin de chaque agent, relance $RENF --suivant $2. Termine ta réponse en une ligne."; exit 0
    fi
    # ÉCONOMIE DES MODÈLES (0035) : les modèles et l'effort du projet, réglés dans le cockpit (chefs), et le frein.
    slug=$(printf '%s' "$r" | jq -r '.slug')
    cfg=$("$SQL" "select modele_code, modele_leger, effort, frein, palier from (select p.id, modeles_effectifs(p.id) ->> 'modele_code' as modele_code, modeles_effectifs(p.id) ->> 'modele_leger' as modele_leger, modeles_effectifs(p.id) ->> 'effort' as effort, palier_actif(p.id) as palier, frein_actif(p.id) as frein from projets p left join chefs c on c.projet_id = p.id where p.slug = '$(q "$slug")') x" 2>/dev/null | jq -c '.rows[0] // {}')
    export MODELE_CODE=$(printf '%s' "$cfg" | jq -r '.modele_code // "sonnet"') MODELE_LEGER=$(printf '%s' "$cfg" | jq -r '.modele_leger // "sonnet"')
    export EFFORT_TXT=$(printf '%s' "$cfg" | jq -r '(.effort // "moyen") | if . == "bas" then "bas : va droit au but" elif . == "eleve" then "élevé : réfléchis à fond si le sujet le demande" else "moyen : réfléchis juste ce qu’il faut" end')
    if [ "$(printf '%s' "$cfg" | jq -r '.frein.actif // false')" = "true" ]; then
      echo "FREIN d'usage ($(printf '%s' "$cfg" | jq -r '.frein.raison')) : ne lance qu'UN seul agent à la fois, quel que soit le maximum ci-dessous."
    fi
    printf '%s' "$r" | jq -r --arg rid "$2" --arg r "$RENF" '"RENFORT : lance \(.chantiers | length) agent(s) MAINTENANT, un par chantier ci-dessous (outil Agent, run_in_background: true, isolation: \"worktree\"). Chacun est déjà réservé à SA branche : aucun autre agent ni aucune session ne le touche. Ne fais pas le travail toi-même. Économie des modèles : lance CHAQUE agent avec le paramètre model indiqué sur sa ligne « [model: X] » ; effort de raisonnement — \($ENV.EFFORT_TXT). Bascule d’usage : avant de lancer, note get_session → rate_limit_info avec scripts/chef.sh --usage <status> [pct] et prends les modèles qu’il donne (jamais moins d’agents à cause de l’usage). Au plus \(.max_agents) à la fois ; à la fin de CHAQUE agent : relis son rapport en une ligne, puis relance \($r) --suivant \($rid)."'
    echo
    printf '%s' "$r" | jq -c '.slug as $s | .depot as $d | .chantiers[] | . + {slug: $s, depot: $d}' | while IFS= read -r c; do
      if [ "$(printf '%s' "$c" | jq -r '.verif')" = "true" ]; then
        printf '%s' "$c" | jq -r --arg verdict "$VERDICT" '
"━━ Agent « Vérifier : \(.titre) » [model: \($ENV.MODELE_LEGER)] (projet \(.slug), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit (renfort). Raphaël a testé le chantier « \(.titre) » (projet \(.slug)) mais ne sait pas dire si le résultat est le bon : c’est TOI qui juges.
Ce qu’on lui a demandé de vérifier :
\(.comment // "(rien d’écrit)")
Ce qu’il a vu et collé :
\(.apporte // "(rien)")

Compare à la source (base du cockpit, code du dépôt \(.depot), site en ligne). Photos jointes : COCKPIT_PROJET=\(.slug) scripts/media.sh --chantier \(.id), puis regarde-les. Ne modifie rien. Verdict en mots simples, preuve à l’appui (400 caractères au plus) :
COCKPIT_PROJET=\(.slug) \($verdict) --chantier \(.id) --bon \"…\"   ou   --pas-bon \"…\"
Rends un rapport de 3 lignes.
---"'
      else
        printf '%s' "$c" | jq -r --arg prog "$PROG" --arg dem "$DEM" --arg prfus "$PRFUS" --arg repro "$(repro_ligne "$(printf '%s' "$c" | jq -r '.id // empty')")" '
"━━ Agent « \(.titre) » [model: \($ENV.MODELE_CODE)] (projet \(.slug), dépôt \(.depot), branche \(.branche), chantier \(.id))
Consigne à lui donner, telle quelle :
---
Tu es un agent du cockpit (renfort). Chantier « \(.titre) » (id \(.id)), projet \(.slug), dépôt \(.depot).\(if .etat_avant == "en_cours" then " Il était en cours puis abandonné : lis son fil et reprends où il en était." elif .etat_avant == "a_trier" then " Pas encore trié : décide s’il faut le faire ; doublon → scripts/chantier.sh --suggerer-fusion ; décision de Raphaël nécessaire → question avec \($dem), puis arrête-toi." else "" end)
Demande :
\(.demande)\(if $repro != "" then "\n" + $repro else "" end)

Règles : lis CLAUDE.md et docs/REPRISE.md du dépôt. Travaille sur la branche \(.branche) (jamais directement sur main ; ta copie à toi). À chaque étape : COCKPIT_PROJET=\(.slug) \($prog) --agent \"\(.titre)\" --chantier \(.id) --etape \"…\" --pct N --eta M. AUCUNE dépense, suppression ou envoi en son nom. Une décision de Raphaël → COCKPIT_PROJET=\(.slug) \($dem) (règle de clarté : une phrase, 2 à 4 réponses prêtes) puis rends la main. Un geste manuel de Raphaël (clé, réglage, clic) : seulement si aucun chemin technique n’existe, et par COCKPIT_PROJET=\(.slug) \($dem) --action avec --lien \"https://…|libellé\" (la page EXACTE), --etape (un geste numéroté chacune, nom exact du bouton), --copier \"libellé|texte\" (prêt à coller) et --image si ça aide. Sinon mène-le au bout : tests du dépôt, commit, push de ta branche, puis fusion dans main seulement si tout est vert (si la plateforme refuse la fusion, « merge without review » : n’insiste pas et ne cherche aucun détour ; SANS CONFLIT : JUSTE avant d’ouvrir la PR, git fetch origin puis git merge origin/main dans ta branche (garde les DEUX côtés ; une migration dont le numéro est déjà pris : renumérote-la avec scripts/prochaine-migration.sh, appelé au moment d’écrire le fichier, jamais « le suivant » deviné) et relance les tests rapides ; pousse ta branche, ouvre la PR, puis IMMÉDIATEMENT COCKPIT_PROJET=\(.slug) \($prfus) <N> (la carte « À toi » avec le lien et les 2 gestes ; elle n’est posée QUE si la PR est propre : le script répond « PAS PRÊTE : … » sinon, et la chef s’en occupe ; sans doublon, retirée seule à la fusion ; ne pose jamais cette action à la main) ; ne termine jamais en laissant une branche finie sans PR ni carte ; DÉPLOIEMENT PAR LOT : une PR = toute la vague de correctifs du même sujet, jamais une PR ou un redéploiement par correctif ; une fonction Supabase se déploie une fois en fin de lot avec scripts/deployer-fonction.sh, qui ne renvoie rien si elle est inchangée) (fusionne origin/main d’abord ; jamais git add -A), vérification en ligne, et \($prog) --chantier \(.id) --termine \"…\" --verifier \"1. Ouvre https://… (le lien EXACT) 2. …\" --en-ligne/--pas-en-ligne. Rends un rapport de 5 lignes : livré, vérifié, reste.
---"'
      fi
      echo
    done ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
