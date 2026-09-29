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
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${COCKPIT_SQL:-$ICI/sql.sh}"
URL="${SUPABASE_URL:-https://bexiyvmdbxcwxasgslxp.supabase.co}"
DEST="${COCKPIT_MEDIAS_DIR:-/tmp/cockpit-medias}"
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || { echo "SUPABASE_SERVICE_ROLE_KEY absente de l'environnement : signale-le à Raphaël." >&2; exit 1; }
uuid='^[0-9a-fA-F-]{36}$'

case "${1:-}" in
  --chantier|--message)
    id="${2:-}"; [[ "$id" =~ $uuid ]] || { echo "Donne un identifiant valide après $1." >&2; exit 2; }
    col=$([ "$1" = "--chantier" ] && echo chantier_id || echo id)
    chemins=$("$SQL" "select coalesce(jsonb_agg(md->>'chemin' order by m.created_at), '[]'::jsonb) as chemins from messages m, jsonb_array_elements(m.medias) md where m.$col = '$id'" | jq -r '.rows[0].chemins[]') ;;
  ""|-h|--help) sed -n 2,11p "$0"; exit 0 ;;
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
