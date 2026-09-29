#!/usr/bin/env bash
# Lanceur du cockpit central — installé par brancher.sh de rnab26/Cockpit-General.
# NE PAS MODIFIER ICI : toute évolution se fait dans Cockpit-General.
#
# Pourquoi (Raphaël, 29 sept. 2026) : « améliorer constamment le cockpit, et que
# les autres cockpits récupèrent ces évolutions en simultané ». Les scripts des
# sessions ne sont donc plus copiés dans le projet : chaque commande
# scripts/cockpit-*.sh et le hook de démarrage prennent la DERNIÈRE version sur
# Cockpit-General (branche main), gardée en cache hors du dépôt (10 min par
# défaut), et retombent sur le dernier cache si GitHub ne répond pas.
#
# Réglages (variables d'environnement, facultatives) : COCKPIT_SOURCE (URL
# brute du dépôt), COCKPIT_CACHE (dossier), COCKPIT_TTL (secondes).
COCKPIT_SOURCE="${COCKPIT_SOURCE:-https://raw.githubusercontent.com/rnab26/Cockpit-General/main}"
COCKPIT_CACHE="${COCKPIT_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/cockpit-general}"
COCKPIT_FICHIERS=(scripts/sql.sh scripts/demander.sh scripts/progression.sh scripts/progression_tableau.py scripts/chantier.sh hooks/session-start.sh hooks/prompt-rappel.sh hooks/suivi.sh hooks/autonome.sh scripts/passe.sh scripts/media.sh)

# Noms des commandes tels qu'on les tape DANS le projet (affichés par le hook).
export COCKPIT_SQL_CMD="scripts/cockpit-sql.sh" COCKPIT_PROG_CMD="scripts/cockpit-progression.sh" COCKPIT_DEM_CMD="scripts/cockpit-demander.sh" COCKPIT_CHANTIER_CMD="scripts/cockpit-chantier.sh" COCKPIT_MEDIA_CMD="scripts/cockpit-media.sh"
export COCKPIT_SQL="$COCKPIT_CACHE/scripts/sql.sh"

cockpit_a_jour() {
  local repere="$COCKPIT_CACHE/.maj" age
  if [ -f "$repere" ]; then
    age=$(( $(date +%s) - $(stat -c %Y "$repere" 2>/dev/null || echo 0) ))
    [ "$age" -lt "${COCKPIT_TTL:-600}" ] && return 0
  fi
  local tmp f; tmp=$(mktemp -d)
  # La liste des fichiers vient du cockpit lui-même (modeles/fichiers.txt) :
  # un fichier ajouté au cockpit arrive partout sans retoucher ce lanceur.
  # La liste écrite ci-dessus ne sert que si elle est injoignable.
  local liste=("${COCKPIT_FICHIERS[@]}")
  if curl -fsS --max-time 8 "$COCKPIT_SOURCE/modeles/fichiers.txt" -o "$tmp/.liste" 2>/dev/null && [ -s "$tmp/.liste" ]; then
    mapfile -t liste < <(grep -E '^[a-zA-Z0-9_./-]+$' "$tmp/.liste")
  fi
  for f in "${liste[@]}"; do
    mkdir -p "$tmp/$(dirname "$f")"
    if ! curl -fsS --max-time 8 "$COCKPIT_SOURCE/$f" -o "$tmp/$f"; then
      rm -rf "$tmp"
      if [ -x "$COCKPIT_CACHE/scripts/sql.sh" ]; then
        echo "(cockpit : Cockpit-General injoignable, dernière version en cache utilisée)" >&2; return 0
      fi
      echo "Cockpit : impossible de récupérer $f depuis $COCKPIT_SOURCE, et aucune version en cache." >&2; return 1
    fi
  done
  rm -f "$tmp/.liste"
  chmod +x "$tmp"/scripts/*.sh "$tmp"/hooks/*.sh "$tmp"/modeles/*.sh 2>/dev/null
  # Remplacement d'un bloc : jamais un mélange d'ancienne et de nouvelle version.
  mkdir -p "$COCKPIT_CACHE"; cp -r "$tmp"/. "$COCKPIT_CACHE"/; touch "$repere"; rm -rf "$tmp"
}
