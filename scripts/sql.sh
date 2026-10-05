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
# FILE D'ATTENTE LOCALE (5 oct. 2026, chantier 5b68a493). Raphaël : « même sans wifi
# […] toutes les données sont enregistrées et récupérées à la prochaine connexion ».
# Quand la base est INJOIGNABLE (curl 6 = DNS, 7 = connexion refusée, 35 = TLS : la
# requête n'est certainement pas partie), une ÉCRITURE (insert/update/delete, ou
# `select fonction(…)` sans `from`, comme poser_jalon / repondre_dans_fil) est gardée
# dans ~/.cockpit/file-attente/ et rejouée dans l'ordre dès qu'un appel réussit (ou
# `sql.sh --rejouer`). Une lecture échoue comme avant. Réponse de l'écriture gardée :
# {"ok":true,"rows":[],"en_attente":true} + un message sur stderr — les scripts qui
# attendent une valeur en retour (un identifiant) n'en reçoivent pas : relance-les en
# ligne. Un SQL REFUSÉ au rejeu va dans refuses/ (jamais jeté). Limite : le dossier vit
# sur la machine de la session ; un conteneur recyclé avant le retour du réseau le perd.
FILE="${COCKPIT_FILE_ATTENTE:-${HOME:-/tmp}/.cockpit/file-attente}"

appeler() { # $1 = requête ; pose REPONSE et CODE
  local corps; corps="$(jq -n --arg q "$1" '{query: $q}')"
  set +e
  REPONSE="$(curl -sS --max-time 120 -X POST "$URL/rest/v1/rpc/exec_sql" "${entetes[@]}" -d "$corps" 2>/dev/null)"
  CODE=$?
  set -e
}

est_ecriture() { # $1 = requête
  local m; m="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e "s/'[^']*'//g" | tr '\n' ' ')"
  case "$m" in
    *[[:space:]]from[[:space:]]*) return 1 ;;
  esac
  case "$m" in
    *"insert "*|*"update "*|*"delete "*|*"select "*"("*) return 0 ;;
  esac
  return 1
}

garder_en_attente() { # $1 = requête
  mkdir -p "$FILE/refuses" 2>/dev/null || return 1
  local f="$FILE/$(date +%s%N)-$$.sql"
  printf '%s' "$1" > "$f.tmp" && mv "$f.tmp" "$f"
}

rejouer() {
  [ -d "$FILE" ] || return 0
  local f n=0
  for f in $(ls "$FILE"/*.sql 2>/dev/null | sort); do
    appeler "$(cat "$f")"
    if [ "$CODE" -ne 0 ]; then
      echo "File d'attente : base injoignable, des écritures restent sur cette machine ($FILE)." >&2
      return 0
    fi
    if echo "$REPONSE" | jq -e 'type == "object" and .ok == true' >/dev/null 2>&1; then
      rm -f "$f"; n=$((n+1))
    else
      mv "$f" "$FILE/refuses/$(basename "$f")"
      echo "File d'attente : une écriture a été REFUSÉE par la base, gardée dans $FILE/refuses/ ($(basename "$f"))." >&2
    fi
  done
  if [ "$n" -gt 0 ]; then echo "File d'attente : $n écriture(s) gardée(s) hors ligne envoyée(s) à la base." >&2; fi
  return 0
}

if [ "${1:-}" = "--rejouer" ]; then rejouer; exit 0; fi
if [ $# -gt 0 ]; then requete="$1"; else requete="$(cat)"; fi
if [ -z "${requete//[[:space:]]/}" ]; then echo "Erreur : aucune requête fournie." >&2; exit 2; fi
# Le profil `cockpit` vise cockpit.exec_sql (migration 0002), dont le
# search_path est déjà sur le schéma : pas de préfixe à écrire.
appeler "$requete"
if [ "$CODE" -eq 6 ] || [ "$CODE" -eq 7 ] || [ "$CODE" -eq 35 ]; then
  if est_ecriture "$requete" && garder_en_attente "$requete"; then
    echo "Pas de réseau vers la base : écriture GARDÉE sur cette machine ($FILE), envoyée au prochain appel qui passe." >&2
    echo '{"ok":true,"rows":[],"en_attente":true}'
    exit 0
  fi
  echo "Pas de réseau vers la base (curl $CODE) : requête non exécutée." >&2; exit 1
fi
reponse="$REPONSE"
if ! echo "$reponse" | jq -e 'type == "object" and has("ok")' >/dev/null 2>&1; then
  echo "Réponse inattendue de Supabase :" >&2; echo "$reponse" >&2
  [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && echo "SUPABASE_SERVICE_ROLE_KEY absente de l'environnement : signale-le à Raphaël." >&2
  exit 1
fi
# La base répond : on vide d'abord ce qui attendait (dans l'ordre), sans boucler.
if [ -z "${COCKPIT_REJEU:-}" ] && ls "$FILE"/*.sql >/dev/null 2>&1; then COCKPIT_REJEU=1 rejouer; fi
echo "$reponse" | jq .
[ "$(echo "$reponse" | jq -r '.ok')" = "true" ] || exit 1
