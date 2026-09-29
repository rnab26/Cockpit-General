#!/usr/bin/env bash
# Revoir « À toi de jouer » d'un projet : ce qui attend Raphaël depuis trop
# longtemps, ou que du travail a suivi depuis (migration 0022).
#
#   COCKPIT_PROJET=facepro scripts/revue-a-toi.sh             consigne de revue, ou « RIEN »
#   COCKPIT_PROJET=facepro scripts/revue-a-toi.sh --liste     la liste seule (JSON), sans rien marquer
#   COCKPIT_PROJET=facepro scripts/revue-a-toi.sh --apercu    la consigne, sans rien marquer (tests)
#   COCKPIT_PROJET=facepro scripts/revue-a-toi.sh --forcer    même si une revue a eu lieu il y a moins d'une heure
#
# POURQUOI (Raphaël, 29 sept. 2026) : « dans tout ce qui est à toi de jouer il
# n'y a pas d'actualisation ; j'ai des requêtes d'il y a plus de 12 h qui ont
# déjà été répondues dans la session par d'autres requêtes, donc ça se marche
# dessus ; si entre-temps il y a de nouvelles informations la requête n'est pas
# mise à jour, ou fusionnée si nécessaire ». La session qui a posé un élément
# a souvent disparu : c'est donc la chef du projet (scripts/chef.sh) qui fait
# revoir la liste par un agent, ou la session autonome (scripts/passe.sh) quand
# elle n'a rien d'autre à faire. Au plus une revue par heure et par projet.
# Seuil : COCKPIT_A_TOI_HEURES (12 par défaut). La règle est a_toi_a_revoir
# (la même que l'app, lib/entonnoir.ts) : jamais réécrite ici.
set -uo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
DEM="${COCKPIT_DEM_CMD:-scripts/demander.sh}"
CHT="${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh}"
PROJET="${COCKPIT_PROJET:-}"; mode="consigne"; forcer=false; apercu=false
while [ $# -gt 0 ]; do
  case "$1" in
    --liste)  mode="liste"; shift ;;
    --forcer) forcer=true; shift ;;
    --apercu) apercu=true; forcer=true; shift ;;
    --projet) PROJET="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$PROJET" ] || { echo "RIEN — projet inconnu (COCKPIT_PROJET)."; exit 0; }
heures="${COCKPIT_A_TOI_HEURES:-12}"; [[ "$heures" =~ ^[0-9]+$ ]] || heures=12
q() { printf '%s' "$1" | sed "s/'/''/g"; }
un() { "$SQL" "$1" | jq -c '.rows[0] // empty'; }

p=$(un "select id, depot, coalesce(revue_a_toi_at > now() - interval '1 hour', false) as recente from projets where slug = '$(q "$PROJET")'")
pid=$(printf '%s' "$p" | jq -r '.id // empty')
[ -n "$pid" ] || { echo "RIEN — projet $PROJET inconnu du cockpit."; exit 0; }
liste=$(un "select a_toi_a_revoir('$pid', $heures) as l" | jq -c '.l // []')
if [ "$mode" = "liste" ]; then printf '%s\n' "$liste" | jq .; exit 0; fi
n=$(printf '%s' "$liste" | jq 'length')
if [ "${n:-0}" -eq 0 ]; then echo "RIEN — « À toi » de $PROJET est à jour."; exit 0; fi
if [ "$(printf '%s' "$p" | jq -r '.recente')" = "true" ] && ! $forcer; then
  echo "RIEN — « À toi » de $PROJET a déjà été revu il y a moins d'une heure."; exit 0
fi
$apercu || "$SQL" "update projets set revue_a_toi_at = now() where id = '$pid'" >/dev/null

printf '%s' "$liste" | jq -r --arg slug "$PROJET" --arg depot "$(printf '%s' "$p" | jq -r '.depot // ""')" --arg dem "$DEM" --arg cht "$CHT" --arg h "$heures" '
"Tu es un agent du cockpit. Revue de « À toi de jouer » du projet \($slug) (dépôt \($depot)) : \(length) élément(s) attendent Raphaël depuis plus de \($h) h, ou Claude a travaillé dessus depuis. Raphaël (29 sept.) : « des requêtes déjà répondues dans la session par d’autres, ça se marche dessus ». Pour CHAQUE élément, lis son fil (scripts/sql.sh : messages du chantier, du plus récent au plus ancien) et le travail fait depuis, puis UN seul geste :
- déjà répondu, déjà fait ou dépassé (question) → COCKPIT_PROJET=\($slug) \($dem) --retirer <id> \"pourquoi, en une phrase\"
- toujours utile mais la situation a changé (question) → retire-la, puis repose-la à jour avec \($dem) (règle de clarté)
- toujours utile tel quel (question OU chantier) → COCKPIT_PROJET=\($slug) \($dem) --confirmer <id>
- bloqué qui ne l’est plus (travail regroupé ailleurs → plutôt la fusion) → COCKPIT_PROJET=\($slug) \($dem) --debloquer <id du chantier> \"pourquoi\"
- même sujet qu’un autre chantier (voir « proche ») → COCKPIT_PROJET=\($slug) \($cht) --suggerer-fusion <id absorbé> --dans <id qui reste> --pourquoi \"…\" (Raphaël accepte d’un toucher)
Ne certifie rien, ne change jamais un « à vérifier » ou « à cadrer » toi-même, aucune suppression, aucune dépense, aucun code. Rends un rapport de 3 lignes : combien retirés, confirmés, fusions proposées.

Éléments (id à utiliser, le plus ancien d’abord) :
" + ([.[] | "- [\(.type)] id \(.id) — « \(.titre) » — attend depuis \(.heures) h\(if .avance_depuis then " — Claude a avancé depuis le \(.avance_depuis[0:16] | sub("T"; " ")) UTC" else "" end)\(if .chantier_id and .type == "question" then " — chantier \(.chantier_id)" else "" end)\n    \(.texte | gsub("\\s+"; " ") | .[0:220])\(if .proche then "\n    proche : « \(.proche.titre) » (\(.proche.id), ressemblance \(.proche.score))" else "" end)"] | join("\n"))'
