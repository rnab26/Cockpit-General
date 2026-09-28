#!/usr/bin/env bash
# Hook Stop : le MODE AUTONOME. Quand la session a fini sa tâche et que le
# projet est en mode autonome (allumé jusqu'à une heure donnée, depuis le
# cockpit), elle ne s'arrête pas : le cockpit lui donne le chantier LIBRE
# suivant, déjà réservé pour elle. Sinon, ce hook ne dit rien.
#
# Pourquoi (Raphaël, 29 sept. 2026) : « si elle n'a rien à reprendre, qu'elle
# poursuive sur les chantiers disponibles […] je pars dormir à 4 h, je me
# réveille à 9 h : ce sont 4 h gagnées ». La REPRISE après une limite d'usage
# est native (réglage autoContinueAtUsageLimit) ; ceci est l'ENCHAÎNEMENT.
#
# Garde-fous (dans la consigne donnée à la session, et côté base) : jamais un
# chantier « à cadrer » (seulement « libre ») ; plafond de chantiers par
# session (projets.autonome_max) ; arrêt à l'heure dite ; aucune dépense, aucune
# suppression, aucun envoi externe. Au moindre souci : silence (la session
# s'arrête normalement), jamais un blocage.
set -uo pipefail
entree=$(cat 2>/dev/null || true)
PROJET="${COCKPIT_PROJET:-}"
[ -n "$PROJET" ] && [ -n "$entree" ] && command -v jq >/dev/null || exit 0
RACINE="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
[ "$(printf '%s' "$entree" | jq -r '.hook_event_name // empty')" = "Stop" ] || exit 0
sid=$(printf '%s' "$entree" | jq -r '.session_id // empty'); [ -n "$sid" ] || exit 0
branche=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
q() { printf '%s' "$1" | sed "s/'/''/g"; }
r=$(timeout 8 "$SQL" "select prochain_chantier_autonome('$(q "$PROJET")', '$(q "$sid")', '$(q "$branche")') as c" 2>/dev/null | jq -c '.rows[0].c // empty' 2>/dev/null)
[ -n "$r" ] && [ "$r" != "null" ] || exit 0
PROG="${COCKPIT_PROG_CMD:-scripts/progression.sh}"; DEM="${COCKPIT_DEM_CMD:-scripts/demander.sh}"
raison=$(printf '%s' "$r" | jq -r --arg prog "$PROG" --arg dem "$DEM" '
"MODE AUTONOME du cockpit (Raphaël est absent jusqu’à \(.jusqu_a)) : ne t’arrête pas, prends le chantier suivant, déjà réservé pour toi.\n\nChantier « \(.titre) » (id \(.id)).\nSa demande :\n\(.demande)\n\nRègles, sans exception :\n- AUCUNE dépense (GPU, API payante, ressource facturée), AUCUNE suppression de données ou de ressource, AUCUN envoi en son nom (message, e-mail, publication).\n- Si une décision ou une action de Raphaël est nécessaire : pose-la avec \($dem) (--pourquoi, options, ta recommandation), écris où tu en es dans le fil, libère le chantier et termine ta réponse ; le cockpit te donnera le suivant.\n- Sinon, mène-le au bout comme d’habitude : \($prog) à chaque étape, jalons, puis --termine avec --verifier et --en-ligne / --pas-en-ligne.\n- Tu peux encore enchaîner \(.reste) chantier(s) après celui-ci."')
jq -n --arg r "$raison" '{decision: "block", reason: $r}'
