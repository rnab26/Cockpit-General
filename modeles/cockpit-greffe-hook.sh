#!/usr/bin/env bash
# Hooks du cockpit central pour la GREFFE INVISIBLE (voie 1) — posé par
# brancher.sh --voie invisible dans $COCKPIT_HOME/bin et déclaré dans les
# réglages UTILISATEUR de Claude Code (~/.claude/settings.json), jamais dans le
# dépôt du projet. Il tourne donc pour TOUT dépôt ouvert dans l'environnement
# de Raphaël, et se tait sauf pour un dépôt listé dans $COCKPIT_HOME/greffes.
#
#   cockpit-greffe-hook.sh <session-start|prompt-rappel|suivi|autonome>
#
# Ne fait JAMAIS échouer ni ralentir une session.
nom="${1:-}"
case "$nom" in session-start|prompt-rappel|suivi|autonome) ;; *) exit 0 ;; esac
# Un projet branché normalement (voies 2 et 3) a ses propres hooks : COCKPIT_PROJET
# vient de son .claude/settings.json. On ne double rien.
[ -n "${COCKPIT_PROJET:-}" ] && exit 0
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ICI/cockpit-lanceur.sh" 2>/dev/null || exit 0
# Pas un dépôt greffé : silence.
[ "${COCKPIT_SANS_TRACE:-}" = 1 ] && [ -n "${COCKPIT_PROJET:-}" ] || exit 0
if ! cockpit_a_jour 2>"${TMPDIR:-/tmp}/cockpit-maj.err"; then
  if [ "$nom" = session-start ]; then
    jq -n --arg c "Cockpit non chargé (greffe invisible) : les scripts du cockpit central sont injoignables. Signale-le à Raphaël, n'invente pas l'état du projet." \
      '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
  fi
  exit 0
fi
[ -f "$COCKPIT_CACHE/hooks/$nom.sh" ] || exit 0
exec bash "$COCKPIT_CACHE/hooks/$nom.sh"
