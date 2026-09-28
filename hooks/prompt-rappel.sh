#!/usr/bin/env bash
# Hook UserPromptSubmit : à CHAQUE message de Raphaël dans une session, rappelle
# à Claude d'enregistrer le travail dans le cockpit (et lui dit quel chantier sa
# session tient déjà). Court, exprès : il part avec chaque message.
#
# Pourquoi (Raphaël, 29 sept. 2026) : « je lance quasiment jamais de chantier
# dans le cockpit […] ce que je lance dans des sessions doit s'intégrer
# automatiquement ». Une consigne lue une fois au démarrage s'oublie au bout de
# trois demandes ; ce rappel ne s'oublie pas. Ne fait jamais échouer un message.
set -uo pipefail
RACINE="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
PROJET="${COCKPIT_PROJET:-}"
CHANTIER_CMD="${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh}"; PROG_CMD="${COCKPIT_PROG_CMD:-scripts/progression.sh}"
[ -n "$PROJET" ] || exit 0
branche=$(git -C "$RACINE" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
tenus=""
if [ -n "$branche" ] && [ -x "$SQL" ]; then
  tenus=$("$SQL" "select coalesce(string_agg(format('« %s » (%s, %s)', c.titre, c.id, c.etat), ' ; '), '') as t from chantiers c join projets p on p.id = c.projet_id where p.slug = '$PROJET' and c.pris_par = '$branche' and c.pris_jusqu_a > now()" 2>/dev/null | jq -r '.rows[0].t // ""' 2>/dev/null || echo "")
fi
texte="Cockpit (projet $PROJET) — si ce message demande du TRAVAIL (fonctionnalité, correctif, reprise d'un sujet), enregistre-le AVANT de coder : $CHANTIER_CMD --ouvrir \"<titre court, lisible par Raphaël>\" --demande \"<ses mots>\" (il reprend ou rouvre le chantier existant au lieu d'en créer un doublon ; s'il répond « ambigu », choisis avec --id ou demande). Puis $PROG_CMD à chaque étape, les jalons pousse / ci-ok / en-ligne, et --termine avec --verifier et --en-ligne. Une simple question ou discussion : rien à enregistrer."
[ -n "$tenus" ] && texte="$texte Ta session tient déjà : $tenus."
jq -n --arg c "$texte" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}'
