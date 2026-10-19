#!/usr/bin/env bash
# Retire les cartes « Fusionne la PR #n » dont la PR est déjà fusionnée ou fermée (19 oct. 2026, Raphaël : « les cartes ne sont pas du
# tout d'actualité […] faut que ce soit coordonné en instantané »). Une ligne par carte ouverte : pr-a-fusionner.sh <n> lit l'état RÉEL
# sur GitHub et retire la carte caduque (réponse automatique, jamais answered_by). Appelé en tâche de fond par les hooks, au plus
# une fois toutes les 3 min par projet ; la base fait la même chose seule pour les dépôts publics (0099).
# Usage : COCKPIT_PROJET=<slug> scripts/pr-cartes.sh
set -uo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${COCKPIT_SQL:-$D/sql.sh}"; PRFUS="$D/pr-a-fusionner.sh"
projet="${COCKPIT_PROJET:-}"; [ -n "$projet" ] && [[ "$projet" != test-* ]] || exit 0
[ -x "$PRFUS" ] || [ -f "$PRFUS" ] || exit 0
marque="${TMPDIR:-/tmp}/cockpit-pr-cartes-$projet"
[ -z "$(find "$marque" -mmin -3 2>/dev/null)" ] || exit 0
: > "$marque" 2>/dev/null
nums=$("$SQL" "select coalesce(string_agg(substring(m.corps from '#([0-9]+) '), ' '), '') as l from messages m join projets p on p.id = m.projet_id where p.slug = '$projet' and m.kind = 'action' and m.answered_at is null and m.corps like 'Fusionne la PR #%'" 2>/dev/null | jq -r '.rows[0].l // ""')
for n in $nums; do COCKPIT_PROJET="$projet" bash "$PRFUS" "$n" >/dev/null 2>&1 || true; done
