#!/usr/bin/env bash
# Notifier dans le cockpit quand une PR est prête à fusionner.
#
# Idempotent : pose une carte « À toi » si la PR est ouverte et prête à fusionner,
# la retire si elle est fusionnée ou fermée. Clé = numéro de PR (pas de doublon).
#
#   scripts/pr-a-fusionner.sh 42
#   scripts/pr-a-fusionner.sh 42 --fermee
#
# Appelé par : chef.sh/renfort.sh quand un agent ouvre une PR.
# Appelé aussi par la passe de chef.sh pour réconcilier avec la réalité GitHub.
#
# Raphaël (30/09) : « je n'ai aucune notification dans le cockpit pour savoir
# quand merger quelque chose ». Besoin : (1) une carte « À toi » avec le lien
# exact de la PR et les 2 gestes (Merge + Confirm) ; (2) pas de doublon si
# posée deux fois (clé = numéro de PR) ; (3) disparaît toute seule quand
# fusionnée/fermée ; (4) valable pour TOUS les projets branchés.

set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"
DEM="$RACINE/scripts/demander.sh"

projet="${COCKPIT_PROJET:-}"; pr_num=""; fermee=0

while [ $# -gt 0 ]; do
  case "$1" in
    --projet)  projet="${2:-}"; shift 2 ;;
    --fermee)  fermee=1; shift ;;
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)         pr_num="${1:-}"; shift ;;
  esac
done

[ -n "$pr_num" ] || { echo "Usage : $0 <numéro de PR> [--fermee]" >&2; exit 2; }
[[ "$pr_num" =~ ^[0-9]+$ ]] || { echo "Le numéro de PR doit être un entier." >&2; exit 2; }

# Le projet cockpit doit être injecté par l'appelant (agent dans chef.sh, renfort.sh).
# Si aucun projet, on cherche le projet du dépôt courant (clé : owner/repo).
if [ -z "$projet" ]; then
  origin=$(git config --get remote.origin.url || echo "")
  [[ "$origin" =~ github.com[:\/]([^\/]+)\/([^\/]+)(\.git)?$ ]] && {
    owner="${BASH_REMATCH[1]}"
    repo="${BASH_REMATCH[2]}"
    # Chercher le projet dans la base qui correspond à ce dépôt
    projet=$("$SQL" "select slug from cockpit.projets where depot = '$owner/$repo' limit 1" 2>/dev/null | jq -r '.rows[0].slug // ""' || echo "")
  }
  [ -n "$projet" ] || { echo "Aucun projet défini : COCKPIT_PROJET ou detected from origin URL." >&2; exit 2; }
fi

# Déterminer l'URL du dépôt pour construire le lien de la PR.
depot=$("$SQL" "select depot from cockpit.projets where slug = '$projet'" 2>/dev/null | jq -r '.rows[0].depot // ""')
[ -n "$depot" ] || { echo "Projet non trouvé : $projet" >&2; exit 2; }

pr_url="https://github.com/$depot/pull/$pr_num"
cle_action="pr-$pr_num"  # Clé unique basée sur le numéro de PR

# Si --fermee ou fermée/fusionnée : retirer l'action.
if [ "$fermee" = "1" ]; then
  msg_id=$("$SQL" "select id from cockpit.messages where projet_id = (select id from cockpit.projets where slug = '$projet') and corps like '%pr-$pr_num%' and kind = 'action' and answered_at is null limit 1" 2>/dev/null | jq -r '.rows[0].id // ""')
  if [ -n "$msg_id" ]; then
    "$SQL" "update cockpit.messages set answered_at = now(), reponse = 'PR fusionnée ou fermée, action retirée.' where id = '$msg_id'" >/dev/null || true
    echo "Action PR #$pr_num retirée."
  fi
  exit 0
fi

# Vérifier l'état de la PR sur GitHub (sans authentification pour les dépôts publics).
# On cherche juste à savoir si elle est fusionnée ou fermée.
pr_info=$(curl -s -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/$depot/pulls/$pr_num" 2>/dev/null || echo "{}")
pr_state=$(echo "$pr_info" | jq -r '.state // ""')
pr_merged=$(echo "$pr_info" | jq -r '.merged // false')

# Si la PR n'existe pas ou est fermée/fusionnée, retirer l'action.
if [ -z "$pr_state" ] || [ "$pr_state" = "closed" ] || [ "$pr_merged" = "true" ]; then
  msg_id=$("$SQL" "select id from cockpit.messages where projet_id = (select id from cockpit.projets where slug = '$projet') and corps like '%$cle_action%' and kind = 'action' and answered_at is null limit 1" 2>/dev/null | jq -r '.rows[0].id // ""')
  if [ -n "$msg_id" ]; then
    "$SQL" "update cockpit.messages set answered_at = now(), reponse = 'PR fusionnée ou fermée, action retirée.' where id = '$msg_id'" >/dev/null || true
    echo "Action PR #$pr_num retirée (état : $pr_state, merged : $pr_merged)."
  fi
  exit 0
fi

# PR est ouverte et prête à fusionner : poser/mettre à jour l'action.
# Chercher si une action existe déjà pour cette PR.
msg_id=$("$SQL" "select id from cockpit.messages where projet_id = (select id from cockpit.projets where slug = '$projet') and corps like '%$cle_action%' and kind = 'action' and answered_at is null limit 1" 2>/dev/null | jq -r '.rows[0].id // ""')

if [ -n "$msg_id" ]; then
  # Mettre à jour l'action existante
  echo "Action PR #$pr_num déjà posée (id : $msg_id), pas de changement."
  exit 0
fi

# Poser une nouvelle action
COCKPIT_PROJET="$projet" "$DEM" --action \
  --question "Fusionne cette PR et valide la livraison" \
  --pourquoi "La PR est prête, la plateforme GitHub exige une relecture manuelle avant la fusion." \
  --lien "$pr_url|Ouvrir la PR #$pr_num" \
  --etape "Sur la page GitHub, touche le bouton « Merge pull request »" \
  --etape "Confirme en touchant « Confirm merge »" \
  2>/dev/null || {
    echo "Erreur en posant l'action PR #$pr_num dans le cockpit." >&2
    exit 1
  }

# Marquer la question posée avec la clé pour la retrouver ensuite
msg_id=$("$SQL" "select id from cockpit.messages where projet_id = (select id from cockpit.projets where slug = '$projet') and kind = 'action' and answered_at is null order by created_at desc limit 1" 2>/dev/null | jq -r '.rows[0].id // ""')
if [ -n "$msg_id" ]; then
  # Ajouter la clé au corps du message pour retrouvabilité
  "$SQL" "update cockpit.messages set corps = concat(corps, ' ($cle_action)') where id = '$msg_id'" >/dev/null || true
fi

echo "Action PR #$pr_num posée dans le cockpit."
exit 0
