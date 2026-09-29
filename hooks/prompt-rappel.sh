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
entree=$(cat 2>/dev/null || true)
sid=$(printf '%s' "$entree" | jq -r '.session_id // empty' 2>/dev/null)
# Chef du projet (0014, 0019) : là où Raphaël écrit, là est le chef DE CE PROJET
# (et de lui seul : chaque projet a le sien, dans sa propre session). Une
# notification ou un réveil programmé n'est pas un message de lui : on ne prend
# la main que sur un vrai message (pas de balise système en tête).
chef_txt=""
invite=$(printf '%s' "$entree" | jq -r '.prompt // ""' 2>/dev/null)
# Une session de RENFORT (0021) ne dirige jamais : sa consigne commence par
# « [cockpit-renfort] », puis renfort.sh pose sa marque dans le .git de sa copie.
renfort_marque=$(git -C "$RACINE" rev-parse --absolute-git-dir 2>/dev/null)/cockpit-renfort
if [ -n "$sid" ] && [ -x "$SQL" ] && [ ! -s "$renfort_marque" ] && ! printf '%s' "$invite" | grep -qE '^[[:space:]]*(<(task-notification|system-reminder|wake)|\[cockpit-renfort\])|Réveil (horaire|du chef)'; then
  CHEF="${COCKPIT_CHEF_CMD:-scripts/chef.sh}"
  chef_txt=$(COCKPIT_PROJET="$PROJET" CLAUDE_CODE_SESSION_ID="$sid" timeout 8 bash "$RACINE/$CHEF" --prendre 2>/dev/null || true)
fi
branche=$(git -C "$RACINE" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
tenus=""
if [ -n "$branche" ] && [ -x "$SQL" ]; then
  tenus=$("$SQL" "select coalesce(string_agg(format('« %s » (%s, %s)', c.titre, c.id, c.etat), ' ; '), '') as t from chantiers c join projets p on p.id = c.projet_id where p.slug = '$PROJET' and c.pris_par = '$branche' and c.pris_jusqu_a > now()" 2>/dev/null | jq -r '.rows[0].t // ""' 2>/dev/null || echo "")
fi
texte="Cockpit (projet $PROJET) — si ce message demande du TRAVAIL (fonctionnalité, correctif, reprise d'un sujet), enregistre-le AVANT de coder : $CHANTIER_CMD --ouvrir \"<titre court, lisible par Raphaël>\" --demande \"<ses mots>\" --section \"<rubrique>\" (il reprend ou rouvre le chantier existant au lieu d'en créer un doublon). Doublons et rangement, c'est TOI qui tranches, jamais Raphaël : sur « ambigu », lis les extraits et relance avec --id ou --nouveau ; deux chantiers existants identiques → --suggerer-fusion (il accepte d'un toucher). Puis $PROG_CMD à chaque étape, les jalons pousse / ci-ok / en-ligne, et --termine avec --verifier et --en-ligne. Chaque agent que tu lances : écris dans sa consigne d'appeler $PROG_CMD --agent \"<sa description exacte>\" --etape … --pct … --eta … à chaque étape. Une simple question ou discussion : rien à enregistrer."
[ -n "$tenus" ] && texte="$texte Ta session tient déjà : $tenus."
[ -n "$chef_txt" ] && texte="$texte $chef_txt"
jq -n --arg c "$texte" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}'
