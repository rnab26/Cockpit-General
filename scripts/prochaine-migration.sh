#!/usr/bin/env bash
# Le numéro de migration LIBRE, à appeler AU MOMENT d'écrire le fichier (pas au début du travail).
#
#   scripts/prochaine-migration.sh              affiche 0044 (par exemple)
#   scripts/prochaine-migration.sh --nom <slug> affiche le chemin complet : supabase/migrations/0044_<slug>.sql
#
# Pourquoi (30 sept. 2026, chantier 6ef35b6e) : plusieurs agents en parallèle partaient du même main et
# prenaient tous « le suivant » : trois migrations 0041. Le numéro suivant = 1 + le plus grand numéro vu
# (1) dans supabase/migrations de la copie, (2) sur origin/main, (3) sur TOUTES les branches distantes
# (la migration d'un agent pas encore fusionnée compte). La base ne tient pas de journal des migrations du
# schéma cockpit (supabase_migrations est celui de Jarvis) : les branches distantes en tiennent lieu.
# Rappelle-le juste avant d'écrire le fichier ; si tu attends longtemps, refais-le après le merge de main.
set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="supabase/migrations"
nom=""
while [ $# -gt 0 ]; do
  case "$1" in
    --nom) nom="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
cd "$RACINE"
git fetch -q origin 2>/dev/null || echo "prochaine-migration : fetch impossible, seuls les fichiers déjà connus comptent." >&2
max=0
vu() {   # lit des noms de fichiers sur l'entrée, garde le plus grand numéro à 4 chiffres
  local f n
  while IFS= read -r f; do
    n=$(printf '%s' "$f" | sed -n 's|.*/\{0,1\}\([0-9]\{4\}\)_[^/]*\.sql$|\1|p')
    if [ -n "$n" ] && [ $((10#$n)) -gt "$max" ]; then max=$((10#$n)); fi
  done
}
vu < <(ls "$DIR" 2>/dev/null || true)
while IFS= read -r ref; do
  vu < <(git ls-tree --name-only "$ref" "$DIR/" 2>/dev/null || true)
done < <(git for-each-ref --format='%(refname)' refs/remotes/origin 2>/dev/null)
n=$(printf '%04d' $((max + 1)))
if [ -n "$nom" ]; then echo "$DIR/${n}_${nom}.sql"; else echo "$n"; fi
