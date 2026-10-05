#!/usr/bin/env bash
# Déploie une Edge Function sans repasser par l'outil MCP.
#
#   scripts/deployer-fonction.sh voice-command
#
# POURQUOI CE SCRIPT EXISTE
#
# Le code poussé dans le dépôt ne se déploie pas tout seul : une Edge Function
# doit être renvoyée explicitement à Supabase. Le seul chemin disponible
# jusqu'ici était l'outil MCP deploy_edge_function, qui n'accepte le contenu
# des fichiers qu'EN CLAIR, recopié à la main dans l'appel. Pour
# voice-command, cela veut dire retranscrire 35 Ko de code écrit par d'autres
# sessions, à la virgule près, à chaque déploiement. Une seule erreur de
# recopie casse l'assistant en production, et la corriger demande de tout
# retranscrire une seconde fois.
#
# Ce script fait la même chose que sql.sh a fait pour le SQL : il passe par
# l'API HTTPS, en lisant les fichiers sur le disque. Plus rien à recopier,
# donc plus rien à casser par recopie.
#
# PRÉREQUIS : SUPABASE_ACCESS_TOKEN, un jeton personnel Supabase
# (https://supabase.com/dashboard/account/tokens), à enregistrer dans les
# variables d'environnement de l'environnement cloud — jamais dans le dépôt.
# Tant qu'il manque, le script le dit et s'arrête.

set -euo pipefail

FONCTION="${1:-cockpit-embed}"
PROJET="${SUPABASE_PROJECT_REF:-bexiyvmdbxcwxasgslxp}"
DOSSIER="supabase/functions/$FONCTION"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  cat >&2 <<'MSG'
SUPABASE_ACCESS_TOKEN manquante : impossible de déployer depuis ici.

C'est un jeton personnel Supabase, à créer une seule fois sur
https://supabase.com/dashboard/account/tokens puis à ajouter aux variables
d'environnement de l'environnement Claude Code.

Sans lui, il faut repasser par l'outil MCP deploy_edge_function, qui impose
de recopier tout le code à la main dans l'appel.
MSG
  exit 2
fi

if [ ! -d "$DOSSIER" ]; then
  echo "Dossier introuvable : $DOSSIER" >&2
  exit 1
fi

# verify_jwt est RELU sur la fonction déjà en place, jamais imposé. L'imposer
# à true refermerait google-oauth, qui doit rester ouvert pour recevoir la
# redirection de Google — celle-ci ne porte aucun jeton. Une fonction encore
# inexistante est créée fermée, le choix sûr.
# Le jeton ne passe JAMAIS en argument de curl (lisible dans `ps` par tout
# processus du conteneur) : il est écrit dans un fichier à 600, effacé à la
# sortie. Un `-H @<(printf …)` ne marche pas dans un tableau bash (le
# descripteur est fermé avant que curl ne tourne — constaté le 28 sept.).
entete_auth=$(mktemp)
chmod 600 "$entete_auth"
trap 'rm -f "$entete_auth"' EXIT
printf 'Authorization: Bearer %s' "$SUPABASE_ACCESS_TOKEN" > "$entete_auth"

actuel=$(curl -sS -H @"$entete_auth" \
  "https://api.supabase.com/v1/projects/$PROJET/functions/$FONCTION" 2>/dev/null || echo '{}')
verify_jwt=$(printf '%s' "$actuel" | python3 -c "
import sys, json
try: print('false' if json.load(sys.stdin).get('verify_jwt') is False else 'true')
except Exception: print('true')
")
# Première création d'une fonction publique par clé propre (cockpit-embed) :
# VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-embed. Une fonction
# déjà en place garde son réglage, ce drapeau ne sert qu'à la naissance.
if [ -n "${VERIFY_JWT:-}" ]; then verify_jwt="$VERIFY_JWT"; fi

# Les fichiers partent avec leur chemin RELATIF à supabase/functions/, pas
# seulement leur nom : une fonction importe ses voisins (memoire.ts) mais
# aussi le dossier partagé (../_shared/google.ts). Aplatir les noms ferait
# échouer ces imports au démarrage, sans un mot au déploiement.
BASE="supabase/functions"
chemins=()
for fichier in "$DOSSIER"/*.ts; do chemins+=("${fichier#$BASE/}"); done
if grep -rqs '\.\./_shared/' "$DOSSIER"; then
  for fichier in "$BASE"/_shared/*.ts; do chemins+=("${fichier#$BASE/}"); done
fi

# L'API attend un multipart : un manifeste JSON, puis chaque fichier.
metadata=$(python3 - "$FONCTION" "$verify_jwt" <<'PY'
import json, sys
print(json.dumps({
    "name": sys.argv[1],
    "entrypoint_path": f"{sys.argv[1]}/index.ts",
    "verify_jwt": sys.argv[2] == "true",
    "static_patterns": [],
}))
PY
)

# Déploiement par lot : une fonction dont les fichiers n'ont pas changé depuis
# le dernier déploiement RÉUSSI depuis cette machine n'est pas renvoyée
# (--force pour passer outre). L'empreinte (sha256 des fichiers + verify_jwt)
# est tenue dans ~/.cache/cockpit-deploiements : elle ne remplace pas la
# vérité du serveur (une autre machine ou l'outil MCP peut avoir déployé),
# d'où --force quand on doute.
empreinte=$( { printf 'jwt=%s\n' "$verify_jwt"; for c in "${chemins[@]}"; do printf '%s ' "$c"; sha256sum < "$BASE/$c"; done; } | sha256sum | cut -d' ' -f1)
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/cockpit-deploiements"
cache="$cache_dir/$PROJET.$FONCTION"
if [ "${2:-}" != "--force" ] && [ -f "$cache" ] && [ "$(cat "$cache")" = "$empreinte" ]; then
  echo "$FONCTION inchangée depuis le dernier déploiement : rien envoyé (déploiement évité). --force pour forcer."
  exit 0
fi

echo "Déploiement de $FONCTION (verify_jwt=$verify_jwt) :"
printf '  %s\n' "${chemins[@]}"

args=(-X POST
  "https://api.supabase.com/v1/projects/$PROJET/functions/deploy?slug=$FONCTION"
  -H @"$entete_auth"
  -F "metadata=$metadata;type=application/json")

for chemin in "${chemins[@]}"; do
  args+=(-F "file=@$BASE/$chemin;filename=$chemin;type=application/typescript")
done

reponse=$(curl -sS -w $'\n%{http_code}' "${args[@]}")
code=$(printf '%s' "$reponse" | tail -n1)
corps=$(printf '%s' "$reponse" | sed '$d')

if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
  version=$(printf '%s' "$corps" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")
  mkdir -p "$cache_dir" && printf '%s' "$empreinte" > "$cache" || true
  echo "$FONCTION déployée (version $version)."
  echo "Vérifie maintenant le comportement réel : node scripts/verifier-embed.mjs"
else
  echo "Échec du déploiement (HTTP $code) :" >&2
  printf '%s\n' "$corps" >&2
  exit 1
fi
