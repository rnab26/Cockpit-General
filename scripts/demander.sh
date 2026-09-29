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

#   scripts/demander.sh --confirmer <id>             la question reste utile (après avoir avancé)
#   scripts/demander.sh --retirer <id> "pourquoi"    elle ne l'est plus : elle quitte « À toi »
#
# RÈGLE DE CLARTÉ (Raphaël, 29 sept. 2026) : « toutes les questions, les
# constats, tout ce qui demande une interaction et de la lecture de ma part,
# donc tout le cockpit, synthétisé le plus simple possible : qu'on comprenne le
# sujet, ce qu'il y a à faire, et qu'on puisse donner des réponses claires ».
# Ce script REFUSE donc un texte trop long ou une question sans réponses
# toutes prêtes : le détail technique va dans le fil, pas dans la question.
#   --question : une phrase, 140 caractères max (le sujet + ce qu'il faut décider/faire).
#   --pourquoi : 250 max, en mots de tous les jours (ce qui dépend de la réponse).
#   --option   : 2 à 4 pour une question ; libellé 45 max ; une aide OBLIGATOIRE
#                (140 max) qui dit ce qui se passe si on choisit ça.
#
# IMAGES (0019, Raphaël : « montre-moi des images pour que je comprenne mieux
# de quoi il s'agit ») : une question qui porte sur quelque chose de VISIBLE
# (un écran, un rendu, un avant/après) joint sa capture :
#   --image capture.png   (répétable, 4 au plus ; png, jpg, webp, gif, mp4, webm ; 10 Mo)
# Elle s'affiche en miniature sous la question ; un toucher l'ouvre en grand.
# Capture d'un écran web : node app/scripts/capture-ecran.mjs <url> <dossier>.

set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"

projet="${COCKPIT_PROJET:-}"; question=""; pourquoi=""; chantier=""; kind="question"; options=(); images=(); mode="poser"; cible=""; raison=
auteur="${COCKPIT_SESSION:-$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || git -C "$PWD" symbolic-ref --short -q HEAD 2>/dev/null || echo "session-${CLAUDE_CODE_SESSION_ID:0:8}")}"

while [ $# -gt 0 ]; do
  case "$1" in
    --projet)    projet="${2:-}"; shift 2 ;;
    --question)  question="${2:-}"; shift 2 ;;
    --pourquoi)  pourquoi="${2:-}"; shift 2 ;;
    --chantier)  chantier="${2:-}"; shift 2 ;;
    --auteur)    auteur="${2:-}"; shift 2 ;;
    --option)    options+=("${2:-}"); shift 2 ;;
    --image)     images+=("${2:-}"); shift 2 ;;
    --action)    kind="action"; shift ;;
    --retirer)   mode="retirer"; cible="${2:-}"; raison="${3:-}"; shift 3 ;;
    --confirmer) mode="confirmer"; cible="${2:-}"; shift 2 ;;
    -h|--help)   sed -n '2,42p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$projet" ]   || { echo "Projet inconnu : COCKPIT_PROJET ou --projet <slug>." >&2; exit 2; }
# Une question déjà posée se tient À JOUR (0015, Raphaël : « je ne veux pas
# répondre à des choses déjà faites ») : après avoir avancé, la session la
# confirme (--confirmer <id>) ou la retire (--retirer <id> "pourquoi").
if [ "$mode" != "poser" ]; then
  [[ "$cible" =~ ^[0-9a-f-]{36}$ ]] || { echo "Donne l'identifiant de la question après --$mode." >&2; exit 2; }
  qc=$(printf '%s' "$cible" | sed "s/'/''/g")
  if [ "$mode" = "retirer" ]; then
    [ -n "${raison// /}" ] || { echo "--retirer <id> \"pourquoi\" : dis en une phrase pourquoi elle n'est plus utile." >&2; exit 2; }
    ok=$("$SQL" "select count(*) as n from messages where id = '$qc' and answered_at is null and kind in ('question','action')" | jq -r '.rows[0].n // 0')
    [ "$ok" = "1" ] || { echo "Rien retiré : question introuvable ou déjà répondue." >&2; exit 1; }
    "$SQL" "update messages set answered_at = now(), reponse = 'Retirée par Claude ($(printf '%s' "$auteur" | sed "s/'/''/g")) : $(printf '%s' "$raison" | sed "s/'/''/g")' where id = '$qc' and answered_at is null" >/dev/null || { echo "La base a refusé le retrait." >&2; exit 1; }
    n=1
    [ "$n" = "1" ] && echo "Question retirée : elle quitte « À toi »." || { echo "Rien retiré : question introuvable ou déjà répondue." >&2; exit 1; }
  else
    ok=$("$SQL" "select count(*) as n from messages where id = '$qc' and answered_at is null" | jq -r '.rows[0].n // 0')
    [ "$ok" = "1" ] || { echo "Rien confirmé : question introuvable ou déjà répondue." >&2; exit 1; }
    "$SQL" "update messages set confirmee_at = now() where id = '$qc'" >/dev/null || { echo "La base a refusé la confirmation." >&2; exit 1; }
    n=1
    [ "$n" = "1" ] && echo "Question confirmée : toujours d'actualité." || { echo "Rien confirmé : question introuvable ou déjà répondue." >&2; exit 1; }
  fi
  exit 0
fi
[ -n "$question" ] || { echo "--question manque." >&2; exit 2; }
[ -n "$pourquoi" ] || { echo "--pourquoi manque, et il est obligatoire : dis ce qui dépend de la réponse." >&2; exit 2; }

# Règle de clarté : on refuse AVANT d'écrire quoi que ce soit en base.
CONSEIL="Écris pour quelqu'un qui ne code pas : le sujet, ce qu'il doit décider ou faire, sans jargon ni chiffres techniques ; le détail va dans le fil du chantier."
trop_long() { # $1 = nom, $2 = texte, $3 = max
  local n; n=$(printf '%s' "$2" | python3 -c 'import sys; print(len(sys.stdin.read()))')
  if [ "$n" -gt "$3" ]; then echo "Refusé (règle de clarté) : $1 fait $n caractères, $3 au plus. $CONSEIL" >&2; exit 2; fi
}
trop_long "--question" "$question" 140
trop_long "--pourquoi" "$pourquoi" 250
if [ "$kind" = "question" ]; then
  if [ ${#options[@]} -lt 2 ] || [ ${#options[@]} -gt 4 ]; then
    echo "Refusé (règle de clarté) : une question propose 2 à 4 réponses toutes prêtes (--option \"libellé|ce qui se passe|recommande\"), pour que Raphaël réponde d'un toucher. $CONSEIL" >&2; exit 2
  fi
  for o in "${options[@]}"; do
    lib="${o%%|*}"; reste="${o#*|}"; [ "$reste" = "$o" ] && reste=""; aide="${reste%%|*}"
    trop_long "le libellé « $lib »" "$lib" 45
    [ -n "${aide// /}" ] || { echo "Refusé (règle de clarté) : l'option « $lib » n'a pas d'aide. Dis en une phrase ce qui se passe si on la choisit : --option \"$lib|ce qui se passe|recommande\"." >&2; exit 2; }
    trop_long "l'aide de « $lib »" "$aide" 140
  done
fi

# Les images se contrôlent aussi AVANT d'écrire (fichier absent, type, taille, nombre).
if [ ${#images[@]} -gt 0 ]; then "$RACINE/scripts/media.sh" --verifier-images "${images[@]}"; fi

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

# L'id est généré ICI : exec_sql enveloppe la requête dans un select, et un
# `insert … returning` n'y renvoie rien (exécuté, mais sans ligne). On relit
# ensuite par l'id pour prouver que la question est bien en base.
# Les images d'abord : si le dépôt échoue, aucune question à moitié posée.
medias_sql="'[]'::jsonb"
if [ ${#images[@]} -gt 0 ]; then
  dossier=projet; [ "$cid" != "null" ] && dossier=$(printf '%s' "$cid" | tr -d "'")
  medias=$("$RACINE/scripts/media.sh" --deposer "$pid" "$dossier" "${images[@]}")
  medias_sql="'$(q "$medias")'::jsonb"
fi
id=$(python3 -c 'import uuid; print(uuid.uuid4())')
"$SQL" "insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options, medias) values ('$id', '$pid', $cid, '$(q "$auteur")', 'session', '$kind', '$(q "$question")', '$(q "$pourquoi")', $opts_json, $medias_sql)" >/dev/null
relu=$("$SQL" "select id from messages where id = '$id'" | jq -r '.rows[0].id // empty')
[ "$relu" = "$id" ] || { echo "La question n'a pas été enregistrée (relecture vide pour $id)." >&2; exit 1; }
echo "Question posée (message $id)${images[0]:+, avec ${#images[@]} image(s)}. Elle s'affiche dans le cockpit ; la réponse reviendra au démarrage des sessions suivantes."
