#!/usr/bin/env bash
# RÉPONDRE À RAPHAËL DANS LE FIL (29 sept. 2026, migration 0024).
#
# Raphaël : « Tout endroit où il y a un fil de discussion possible, il faut que
# je puisse obtenir une réponse de la session directement dedans pour pouvoir
# poursuivre. » Règle : un message de Raphaël dans un fil = une réponse de
# Claude DANS ce fil, courte, avant de continuer (une étape ne suffit pas).
#
#   scripts/repondre.sh --chantier <id> "Oui : je parlais du bouton Envoyer, en bas."
#   scripts/repondre.sh --projet "…"          # fil du projet (« Écrire à Claude » hors chantier)
#   scripts/repondre.sh --chantier <id> "Voici l'écran" --image capture.png   # → media.sh --envoyer
#
# Règle de clarté : 600 caractères au plus, mots simples ; le détail va ailleurs.
# Projet : $COCKPIT_PROJET (pour --projet). Auteur : ta branche.
set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
chantier=""; projet_fil=""; texte=""; images=()
auteur="${COCKPIT_SESSION:-$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo session)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --chantier) chantier="${2:-}"; shift 2 ;;
    --projet)   projet_fil=1; shift ;;
    --image)    images+=("${2:-}"); shift 2 ;;
    -h|--help)  sed -n 2,15p "$0"; exit 0 ;;
    --*) echo "Argument inconnu : $1" >&2; exit 2 ;;
    *) texte="$1"; shift ;;
  esac
done
[ -n "$chantier" ] || [ -n "$projet_fil" ] || { echo "Dis où répondre : --chantier <id> ou --projet." >&2; exit 2; }
[ -z "$chantier" ] || [[ "$chantier" =~ ^[0-9a-f-]{36}$ ]] || { echo "--chantier : l'id du chantier (uuid)." >&2; exit 2; }
[ -n "${texte//[[:space:]]/}" ] || { echo "La réponse est vide : écris-la entre guillemets." >&2; exit 2; }
n=$(printf '%s' "$texte" | python3 -c 'import sys; print(len(sys.stdin.read()))')
[ "$n" -le 600 ] || { echo "Refusé (règle de clarté) : réponse de $n caractères, 600 au plus. La réponse d'abord, en mots simples." >&2; exit 2; }
if [ ${#images[@]} -gt 0 ]; then
  [ -n "$chantier" ] || { echo "Une image se joint à un chantier : --chantier <id>." >&2; exit 2; }
  args=(); for i in "${images[@]}"; do args+=(--image "$i"); done
  exec bash "$RACINE/scripts/media.sh" --envoyer --chantier "$chantier" --texte "$texte" "${args[@]}"
fi
projet="${COCKPIT_PROJET:-}"
[ -n "$chantier" ] || [ -n "$projet" ] || { echo "COCKPIT_PROJET manque (fil du projet)." >&2; exit 2; }
q() { printf '%s' "$1" | sed "s/'/''/g"; }
ch="null"; [ -n "$chantier" ] && ch="'$chantier'::uuid"
id=$("$SQL" "select repondre_dans_fil('$(q "$projet")', $ch, '$(q "$auteur")', '$(q "$texte")') as id" | jq -r '.rows[0].id // empty')
[ -n "$id" ] || { echo "La base a refusé la réponse (chantier introuvable ?)." >&2; exit 1; }
echo "Réponse écrite dans le fil${chantier:+ du chantier $chantier} : Raphaël la voit dans l'app."
