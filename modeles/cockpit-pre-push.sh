#!/usr/bin/env bash
# cockpit-pre-push — garde du cockpit central (rnab26/Cockpit-General), VOIE 2.
# Posé par brancher.sh --voie branches dans .git/hooks/pre-push (jamais versionné :
# il ne se voit pas dans le dépôt). NE PAS MODIFIER ICI.
#
# Voie 2 (30 sept. 2026, chantier f31ae3ec) : dans un dépôt qui n'est pas à
# Raphaël, les fichiers du cockpit ne vivent que sur SES branches (motifs de
# `git config cockpit.branches`, défaut « claude/* »). Ce garde refuse de
# pousser vers toute autre branche (ou étiquette) un commit qui les contient,
# et refuse partout un commit qui contiendrait la clé service_role.
# Pour une PR vers leur branche : scripts/cockpit-greffe.sh --branche-propre <nom>.
#
#   cockpit-pre-push.sh --traces <rev>   liste les traces du cockpit dans <rev>
#                                        (LA règle, reprise par greffe.sh)

# Les traces du cockpit dans un commit : une ligne par trace, rien s'il est propre.
traces() {
  local rev="$1"
  git ls-tree -r --name-only "$rev" 2>/dev/null | grep -E '^(scripts/cockpit-[^/]*|\.claude/hooks/cockpit-[^/]*)$'
  git show "$rev:CLAUDE.md" 2>/dev/null | grep -q '^## Cockpit (rnab26/Cockpit-General)' && echo "CLAUDE.md (bloc « Cockpit »)"
  git show "$rev:.claude/settings.json" 2>/dev/null | grep -qE 'COCKPIT_|cockpit-(session-start|prompt-rappel|suivi|autonome)' && echo ".claude/settings.json (réglages du cockpit)"
  return 0
}
if [ "${1:-}" = "--traces" ]; then traces "${2:-HEAD}"; exit 0; fi

zero=0000000000000000000000000000000000000000
motifs=$(git config --get cockpit.branches 2>/dev/null || echo "claude/*")
cle="${SUPABASE_SERVICE_ROLE_KEY:-}"
refus=0
entree=$(cat)
while read -r lref lsha rref rsha; do
  [ -n "${lsha:-}" ] && [ "$lsha" != "$zero" ] || continue
  # La clé de la base centrale ne part JAMAIS, sur aucune branche.
  if [ "${#cle}" -ge 20 ] && git grep -qF -e "$cle" "$lsha" -- 2>/dev/null; then
    echo "REFUS (cockpit) : $rref contient la clé service_role de la base centrale. Retire-la de l'historique avant de pousser." >&2
    refus=1; continue
  fi
  cible="${rref#refs/heads/}"
  a_raphael=0
  if [ "$cible" != "$rref" ]; then
    set -f
    for m in $motifs; do
      # shellcheck disable=SC2254
      case "$cible" in $m) a_raphael=1 ;; esac
    done
    set +f
  fi
  [ "$a_raphael" = 1 ] && continue
  t=$(traces "$lsha")
  if [ -n "$t" ]; then
    {
      echo "REFUS (cockpit) : « $cible » n'est pas une branche de Raphaël (motifs : $motifs) et ce commit porte les fichiers du cockpit :"
      printf '%s\n' "$t" | sed 's/^/  - /'
      echo "Fais une branche propre : scripts/cockpit-greffe.sh --branche-propre <nom>, puis pousse <nom> et ouvre la PR depuis elle."
    } >&2
    refus=1
  fi
done <<<"$entree"
[ "$refus" = 0 ] || exit 1
# Le garde du propriétaire du dépôt, s'il en avait un avant nous : toujours joué.
suite="$(dirname "$0")/pre-push.avant-cockpit"
if [ -x "$suite" ]; then printf '%s\n' "$entree" | "$suite" "$@" || exit $?; fi
exit 0
