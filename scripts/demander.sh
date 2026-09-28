#!/usr/bin/env bash
# Poser une question à un humain — dans le cockpit, jamais dans un artefact.
#
#   scripts/demander.sh --chantier "Écran central" \
#     --question "On garde les archives combien de temps ?" \
#     --pourquoi "Supprimer est irréversible, garder ne l'est pas." \
#     --option "Sans limite|Rien n'est jamais supprimé.|recommande" \
#     --option "30 jours|Un mois glissant, puis on efface."
#
#   scripts/demander.sh --action --chantier "Déploiement" \
#     --question "Crée le dépôt rnab26/Cockpit-General sur GitHub" \
#     --pourquoi "La plateforme interdit à une session de créer un dépôt."
#
# Deux familles : --question (il DÉCIDE, options cliquables) ; --action (il FAIT
# quelque chose et dit où il en est : fait / pas encore / ça bloque).
# --pourquoi est OBLIGATOIRE : c'est ce qui distingue une vraie demande du
# compte rendu d'une session (leçon Jarvis du 7 sept. 2026).
# La question s'affiche en rouge sur la carte du chantier, dans l'app ET dans
# le module embarqué du site ; la réponse revient dans le hook de démarrage de
# chaque session suivante. Avant de poser une question : relis le fil du
# chantier, une question déjà répondue qu'on repose est ce qui l'épuise.

set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"

projet="${COCKPIT_PROJET:-}"; question=""; pourquoi=""; chantier=""; kind="question"; options=()
auteur="${COCKPIT_SESSION:-$(git -C "$PWD" symbolic-ref --short -q HEAD 2>/dev/null || echo session)}"

while [ $# -gt 0 ]; do
  case "$1" in
    --projet)    projet="${2:-}"; shift 2 ;;
    --question)  question="${2:-}"; shift 2 ;;
    --pourquoi)  pourquoi="${2:-}"; shift 2 ;;
    --chantier)  chantier="${2:-}"; shift 2 ;;
    --auteur)    auteur="${2:-}"; shift 2 ;;
    --option)    options+=("${2:-}"); shift 2 ;;
    --action)    kind="action"; shift ;;
    -h|--help)   sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$projet" ]   || { echo "Projet inconnu : COCKPIT_PROJET ou --projet <slug>." >&2; exit 2; }
[ -n "$question" ] || { echo "--question manque." >&2; exit 2; }
[ -n "$pourquoi" ] || { echo "--pourquoi manque, et il est obligatoire : dis ce qui dépend de la réponse." >&2; exit 2; }

q() { printf '%s' "$1" | sed "s/'/''/g"; }

pid=$("$SQL" "select id from projets where slug = '$(q "$projet")'" | jq -r '.rows[0].id // empty')
[ -n "$pid" ] || { echo "Projet « $projet » inconnu en base." >&2; exit 1; }

cid="null"
if [ -n "$chantier" ]; then
  resol=$("$SQL" "select id, titre from chantiers where projet_id = '$pid' and archived_at is null and (id::text = '$(q "$chantier")' or titre ilike '%' || '$(q "$chantier")' || '%') order by (id::text = '$(q "$chantier")') desc limit 3" | jq -c '.rows // []')
  n=$(printf '%s' "$resol" | jq 'length')
  [ "$n" -ge 1 ] || { echo "Aucun chantier ne correspond à « $chantier »." >&2; exit 1; }
  if [ "$n" -gt 1 ] && [ "$(printf '%s' "$resol" | jq -r '.[0].id')" != "$chantier" ]; then
    echo "Plusieurs chantiers correspondent :" >&2; printf '%s' "$resol" | jq -r '.[] | "  \(.id)  \(.titre)"' >&2; exit 1
  fi
  cid="'$(printf '%s' "$resol" | jq -r '.[0].id')'"
fi

# Options « libellé|aide|recommande » → JSON.
opts_json="null"
if [ ${#options[@]} -gt 0 ]; then
  opts_json="'$(printf '%s\n' "${options[@]}" | python3 -c '
import json, sys
out = []
for l in sys.stdin.read().splitlines():
    if not l.strip(): continue
    parts = l.split("|")
    out.append({"libelle": parts[0].strip(), "aide": (parts[1].strip() if len(parts) > 1 else ""),
                "recommande": len(parts) > 2 and parts[2].strip().lower().startswith("recomm")})
print(json.dumps(out, ensure_ascii=False).replace("\x27", "\x27\x27"))
')'::jsonb"
fi

res=$("$SQL" "insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values ('$pid', $cid, '$(q "$auteur")', 'session', '$kind', '$(q "$question")', '$(q "$pourquoi")', $opts_json) returning id")
id=$(printf '%s' "$res" | jq -r '.rows[0].id // empty')
[ -n "$id" ] || { echo "Insertion sans id : $res" >&2; exit 1; }
echo "Question posée (message $id). Elle s'affiche dans le cockpit ; la réponse reviendra au démarrage des sessions suivantes."
