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
COCKPIT_FICHIERS=(scripts/sql.sh scripts/demander.sh scripts/progression.sh scripts/progression_tableau.py hooks/session-start.sh)

# Noms des commandes tels qu'on les tape DANS le projet (affichés par le hook).
export COCKPIT_SQL_CMD="scripts/cockpit-sql.sh" COCKPIT_PROG_CMD="scripts/cockpit-progression.sh" COCKPIT_DEM_CMD="scripts/cockpit-demander.sh"
export COCKPIT_SQL="$COCKPIT_CACHE/scripts/sql.sh"

cockpit_a_jour() {
  local repere="$COCKPIT_CACHE/.maj" age
  if [ -f "$repere" ]; then
    age=$(( $(date +%s) - $(stat -c %Y "$repere" 2>/dev/null || echo 0) ))
    [ "$age" -lt "${COCKPIT_TTL:-600}" ] && return 0
  fi
  local tmp f; tmp=$(mktemp -d)
  for f in "${COCKPIT_FICHIERS[@]}"; do
    mkdir -p "$tmp/$(dirname "$f")"
    if ! curl -fsS --max-time 8 "$COCKPIT_SOURCE/$f" -o "$tmp/$f"; then
      rm -rf "$tmp"
      if [ -x "$COCKPIT_CACHE/scripts/sql.sh" ]; then
        echo "(cockpit : Cockpit-General injoignable, dernière version en cache utilisée)" >&2; return 0
      fi
      echo "Cockpit : impossible de récupérer $f depuis $COCKPIT_SOURCE, et aucune version en cache." >&2; return 1
    fi
  done
  chmod +x "$tmp"/scripts/*.sh "$tmp"/hooks/*.sh
  # Remplacement d'un bloc : jamais un mélange d'ancienne et de nouvelle version.
  mkdir -p "$COCKPIT_CACHE"; cp -r "$tmp"/. "$COCKPIT_CACHE"/; touch "$repere"; rm -rf "$tmp"
}
