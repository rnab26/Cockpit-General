#!/usr/bin/env bash
# Récupère les photos, vidéos et fichiers que Raphaël a joints à ses réponses
# (migration 0013, stockage privé `cockpit-medias`), pour qu'une session les
# REGARDE (outil Read sur une image) au lieu de deviner.
#
#   scripts/media.sh --chantier <id>     # tous les médias du fil d'un chantier
#   scripts/media.sh --message <id>      # ceux d'un message
#   scripts/media.sh <chemin>            # un fichier précis
#
# Les fichiers arrivent dans ${COCKPIT_MEDIAS_DIR:-/tmp/cockpit-medias}/ ; le
# script affiche leur chemin local. Prérequis : SUPABASE_SERVICE_ROLE_KEY.
#
# SENS INVERSE (0020, Raphaël : « montre-moi des images pour que je comprenne
# mieux, ou ce que je suis censé voir ») : une session MONTRE une image dans
# le fil d'un chantier (capture : node app/scripts/capture-ecran.mjs <url> <dossier>).
#   scripts/media.sh --envoyer --chantier <id|titre> --texte "Voici l'écran actuel" \
#       --image capture.png [--image autre.png]
# Pour une question : demander.sh --image ; pour « Comment vérifier » :
# progression.sh --termine … --image. Images (png, jpg, webp, gif) ou courtes
# vidéos (mp4, webm), 4 au plus, 10 Mo chacune.
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${COCKPIT_SQL:-$ICI/sql.sh}"
URL="${SUPABASE_URL:-https://bexiyvmdbxcwxasgslxp.supabase.co}"
DEST="${COCKPIT_MEDIAS_DIR:-/tmp/cockpit-medias}"
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || { echo "SUPABASE_SERVICE_ROLE_KEY absente de l'environnement : signale-le à Raphaël." >&2; exit 1; }
uuid='^[0-9a-fA-F-]{36}$'

# Types acceptés d'une session, et plafonds (une image se regarde sur un téléphone).
IMAGES_MAX=4
TAILLE_MAX=$((10 * 1024 * 1024))
type_de() { # $1 = fichier → type MIME, vide si refusé
  case "$(printf '%s' "${1##*.}" | tr 'A-Z' 'a-z')" in
    png) echo image/png ;; jpg|jpeg) echo image/jpeg ;; webp) echo image/webp ;; gif) echo image/gif ;;
    mp4) echo video/mp4 ;; webm) echo video/webm ;; *) echo "" ;;
  esac
}
nom_sur() { # même règle que app/src/lib/medias.ts (nomSur)
  printf '%s' "$1" | python3 -c '
import re, sys, unicodedata
n = unicodedata.normalize("NFD", sys.stdin.read())
n = "".join(c for c in n if not unicodedata.combining(c))
n = re.sub(r"[^A-Za-z0-9._-]+", "-", n); n = re.sub(r"-+", "-", n); n = re.sub(r"^[-.]+|-+$", "", n)
print((n or "fichier")[-80:], end="")'
}

# --verifier-images f1 f2… : refuse AVANT toute écriture (fichier absent, type, taille, nombre).
# --deposer <projet_id> <chantier_id|projet> f1 f2… : dépose et imprime la liste JSON des médias.
case "${1:-}" in
  --verifier-images|--deposer)
    mode="$1"; shift
    if [ "$mode" = "--deposer" ]; then
      pid="${1:-}"; cid="${2:-}"; [ $# -ge 2 ] && shift 2
      { [[ "$pid" =~ $uuid ]] && { [[ "$cid" =~ $uuid ]] || [ "$cid" = "projet" ]; }; } || { echo "--deposer <projet_id> <chantier_id|projet> <fichiers…>" >&2; exit 2; }
    fi
    [ $# -le "$IMAGES_MAX" ] || { echo "Refusé : $IMAGES_MAX images au plus (tu en donnes $#). Garde celles qui montrent l'essentiel." >&2; exit 2; }
    for f in "$@"; do
      [ -f "$f" ] || { echo "Image introuvable : $f" >&2; exit 2; }
      [ -n "$(type_de "$f")" ] || { echo "Refusé : « $f » n'est pas une image (png, jpg, webp, gif) ni une vidéo (mp4, webm)." >&2; exit 2; }
      t=$(stat -c %s "$f"); [ "$t" -gt 0 ] || { echo "Refusé : « $f » est vide." >&2; exit 2; }
      [ "$t" -le "$TAILLE_MAX" ] || { echo "Refusé : « $f » fait $((t / 1024 / 1024)) Mo, 10 Mo au plus (réduis la capture)." >&2; exit 2; }
    done
    [ "$mode" = "--verifier-images" ] && exit 0
    json='[]'
    for f in "$@"; do
      nom=$(basename "$f"); type=$(type_de "$f"); t=$(stat -c %s "$f")
      chemin="$pid/$cid/$(python3 -c 'import uuid; print(uuid.uuid4())')-$(nom_sur "$nom")"
      code=$(curl -sS --max-time 300 -o /dev/null -w '%{http_code}' -X POST "$URL/storage/v1/object/cockpit-medias/$chemin" \
        -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Content-Type: $type" -H "x-upsert: false" --data-binary "@$f")
      [ "$code" = "200" ] || { echo "Dépôt de « $nom » refusé par le stockage (code $code) : rien n'a été écrit." >&2; exit 1; }
      json=$(jq -c --arg c "$chemin" --arg n "$nom" --arg ty "$type" --argjson ta "$t" '. + [{chemin: $c, nom: $n, type: $ty, taille: $ta}]' <<< "$json")
    done
    printf '%s\n' "$json"; exit 0 ;;
  --envoyer)
    shift; projet="${COCKPIT_PROJET:-}"; chantier=""; texte=""; images=()
    auteur="${COCKPIT_SESSION:-$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "session-${CLAUDE_CODE_SESSION_ID:0:8}")}"
    while [ $# -gt 0 ]; do
      [ $# -ge 2 ] || { echo "$1 attend une valeur." >&2; exit 2; }
      case "$1" in
        --projet) projet="$2" ;; --chantier) chantier="$2" ;; --texte) texte="$2" ;; --image) images+=("$2") ;; --auteur) auteur="$2" ;;
        *) echo "Argument inconnu : $1" >&2; exit 2 ;;
      esac; shift 2
    done
    [ -n "$projet" ] || { echo "Projet inconnu : COCKPIT_PROJET ou --projet <slug>." >&2; exit 2; }
    [ -n "$chantier" ] || { echo "--chantier <id|titre> manque." >&2; exit 2; }
    [ ${#images[@]} -ge 1 ] || { echo "--image <fichier> manque." >&2; exit 2; }
    nt=$(printf '%s' "$texte" | python3 -c 'import sys; print(len(sys.stdin.read()))')
    [ "$nt" -le 280 ] || { echo "Refusé (règle de clarté) : --texte fait $nt caractères, 280 au plus : dis ce que montre l'image, en une ou deux phrases." >&2; exit 2; }
    "$ICI/media.sh" --verifier-images "${images[@]}"
    q() { printf '%s' "$1" | sed "s/'/''/g"; }
    resol=$("$SQL" "select c.id, c.projet_id, c.titre from chantiers c join projets p on p.id = c.projet_id where p.slug = '$(q "$projet")' and c.archived_at is null and (c.id::text = '$(q "$chantier")' or c.titre ilike '%' || '$(q "$chantier")' || '%') order by (c.id::text = '$(q "$chantier")') desc limit 3" | jq -c '.rows // []')
    n=$(jq 'length' <<< "$resol")
    [ "$n" -ge 1 ] || { echo "Aucun chantier ne correspond à « $chantier » dans le projet $projet." >&2; exit 1; }
    if [ "$n" -gt 1 ] && [ "$(jq -r '.[0].id' <<< "$resol")" != "$chantier" ]; then
      echo "Plusieurs chantiers correspondent :" >&2; jq -r '.[] | "  \(.id)  \(.titre)"' <<< "$resol" >&2; exit 1
    fi
    cid=$(jq -r '.[0].id' <<< "$resol"); pid=$(jq -r '.[0].projet_id' <<< "$resol")
    medias=$("$ICI/media.sh" --deposer "$pid" "$cid" "${images[@]}")
    [ -n "$texte" ] || texte="Image jointe par Claude"
    id=$(python3 -c 'import uuid; print(uuid.uuid4())')
    "$SQL" "insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, medias) values ('$id', '$pid', '$cid', '$(q "$auteur")', 'session', 'info', '$(q "$texte")', '$(q "$medias")'::jsonb)" >/dev/null
    relu=$("$SQL" "select jsonb_array_length(medias) as n from messages where id = '$id'" | jq -r '.rows[0].n // empty')
    [ "$relu" = "${#images[@]}" ] || { echo "Le message n'a pas été enregistré (relecture : ${relu:-rien})." >&2; exit 1; }
    echo "Image(s) envoyée(s) dans le fil (message $id) : Raphaël les voit en miniature, un toucher les ouvre en grand."
    exit 0 ;;
  --chantier|--message)
    id="${2:-}"; [[ "$id" =~ $uuid ]] || { echo "Donne un identifiant valide après $1." >&2; exit 2; }
    col=$([ "$1" = "--chantier" ] && echo chantier_id || echo id)
    chemins=$("$SQL" "select coalesce(jsonb_agg(md->>'chemin' order by m.created_at), '[]'::jsonb) as chemins from messages m, jsonb_array_elements(m.medias) md where m.$col = '$id'" | jq -r '.rows[0].chemins[]') ;;
  ""|-h|--help) sed -n 2,20p "$0"; exit 0 ;;
  *) chemins="$1" ;;
esac

[ -n "$chemins" ] || { echo "Aucun média joint."; exit 0; }
mkdir -p "$DEST"
while IFS= read -r chemin; do
  [ -n "$chemin" ] || continue
  local_="$DEST/$(echo "$chemin" | tr '/' '_')"
  code=$(curl -sS --max-time 300 -o "$local_" -w '%{http_code}' "$URL/storage/v1/object/cockpit-medias/$chemin" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  if [ "$code" = "200" ]; then echo "$local_"; else echo "échec ($code) : $chemin" >&2; rm -f "$local_"; fi
done <<< "$chemins"
