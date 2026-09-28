#!/usr/bin/env bash
# Exécute du SQL sur le projet Supabase CENTRAL du cockpit, sans pop-up.
#
# Le schéma est `cockpit` (jamais `public`) : le search_path est posé pour
# écrire `select * from chantiers` sans préfixe. Le projet Supabase est
# partagé avec Jarvis et le Trieur : ne touche à rien hors de ce schéma.
#
#   scripts/sql.sh "select slug, nom from projets;"
#   scripts/sql.sh < supabase/migrations/0001_cockpit_base.sql
#
# Prérequis : SUPABASE_SERVICE_ROLE_KEY dans l'environnement cloud (jamais
# dans le dépôt). Cette clé donne un accès total : on demande à Raphaël avant
# tout drop, delete massif ou truncate.
#
# Une seule instruction par appel quand tu attends des lignes (exec_sql
# enveloppe la requête) ; plusieurs `;` s'exécutent mais ne renvoient rien.
# N'alias jamais une colonne `as t` (alias interne du wrapper).
set -euo pipefail
URL="${SUPABASE_URL:-https://bexiyvmdbxcwxasgslxp.supabase.co}"
entetes=(-H "Content-Type: application/json" -H "Content-Profile: cockpit")
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  entetes+=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
fi
if [ $# -gt 0 ]; then requete="$1"; else requete="$(cat)"; fi
if [ -z "${requete//[[:space:]]/}" ]; then echo "Erreur : aucune requête fournie." >&2; exit 2; fi
# Le profil `cockpit` vise cockpit.exec_sql (migration 0002), dont le
# search_path est déjà sur le schéma : pas de préfixe à écrire.
corps="$(jq -n --arg q "$requete" '{query: $q}')"
reponse="$(curl -sS --max-time 120 -X POST "$URL/rest/v1/rpc/exec_sql" "${entetes[@]}" -d "$corps")"
if ! echo "$reponse" | jq -e 'type == "object" and has("ok")' >/dev/null 2>&1; then
  echo "Réponse inattendue de Supabase :" >&2; echo "$reponse" >&2
  [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && echo "SUPABASE_SERVICE_ROLE_KEY absente de l'environnement : signale-le à Raphaël." >&2
  exit 1
fi
echo "$reponse" | jq .
[ "$(echo "$reponse" | jq -r '.ok')" = "true" ] || exit 1
