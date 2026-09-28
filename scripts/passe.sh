#!/usr/bin/env bash
# Une PASSE AUTONOME : appelée par le réveil programmé (Routine Claude, une fois
# par heure et par projet) dans la session autonome du projet. Donne le chantier
# suivant (réservé pour cette session) avec ses règles, ou dit qu'il n'y a rien
# à faire — alors la session s'arrête en une ligne, sans rien lire d'autre.
#
# Pourquoi (Raphaël, 29 sept. 2026) : « je veux le mode autonome tout le temps
# […] quoi qu'il arrive, je ne veux pas perdre une seconde de ce que je peux
# faire avec Claude ». Le hook Stop (autonome.sh) enchaîne tant qu'une session
# vit ; ce réveil en relance une quand il n'y en a plus (session fermée,
# conteneur recyclé, limite d'usage levée entre-temps).
set -uo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
PROJET="${COCKPIT_PROJET:-${1:-}}"
[ -n "$PROJET" ] || { echo "RIEN — projet inconnu (COCKPIT_PROJET)."; exit 0; }
q() { printf '%s' "$1" | sed "s/'/''/g"; }
branche=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "session-${CLAUDE_CODE_SESSION_ID:0:8}")
actif=$("$SQL" "select cockpit_actif from (select (autonome_toujours or coalesce(autonome_jusqu_a > now(), false)) as cockpit_actif from projets where slug = '$(q "$PROJET")') x" | jq -r '.rows[0].cockpit_actif // "false"')
if [ "$actif" != "true" ]; then echo "RIEN — le mode autonome du projet $PROJET est éteint. Termine ta réponse en une ligne, sans rien faire d'autre."; exit 0; fi
# Pas de travail en double, pas de crédits gaspillés : si une AUTRE session du
# projet est vivante (signe de vie depuis moins de 10 min), c'est elle qui
# enchaîne les chantiers (hook Stop) ; ce réveil ne fait rien.
autre=$("$SQL" "select count(*) as n from sessions s join projets p on p.id = s.projet_id where p.slug = '$(q "$PROJET")' and s.fin_at is null and s.vu_at > now() - interval '10 minutes' and s.id <> '$(q "${CLAUDE_CODE_SESSION_ID:-}")'" | jq -r '.rows[0].n // 0')
if [ "${autre:-0}" -gt 0 ]; then echo "RIEN — une autre session travaille déjà sur $PROJET (elle enchaîne elle-même les chantiers). Termine ta réponse en une ligne, sans rien faire d'autre."; exit 0; fi
r=$("$SQL" "select prochain_chantier_autonome('$(q "$PROJET")', $( [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && echo "'$(q "$CLAUDE_CODE_SESSION_ID")'" || echo null ), '$(q "$branche")') as c" | jq -c '.rows[0].c // empty')
if [ -z "$r" ] || [ "$r" = "null" ]; then echo "RIEN — aucun chantier à prendre dans $PROJET (tout est à cadrer, à vérifier, réservé ou fini). Termine ta réponse en une ligne, sans rien faire d'autre."; exit 0; fi
# Même consigne que le hook Stop : une seule source (hooks/autonome.sh --texte).
printf '%s' "$r" | COCKPIT_PROJET="$PROJET" bash "$RACINE/hooks/autonome.sh" --texte
