#!/usr/bin/env bash
# Enregistrer dans le cockpit le travail qu'on commence dans une session —
# AVANT de coder, à chaque nouvelle demande de Raphaël (fonctionnalité,
# correctif, reprise d'un sujet).
#
#   scripts/chantier.sh --ouvrir "Bouche hybride sans objet" --demande "<ses mots>"
#   scripts/chantier.sh --ouvrir "…" --demande "…" --id <uuid>     # c'est CE chantier-là
#   scripts/chantier.sh --ouvrir "…" --demande "…" --nouveau       # vraiment un sujet neuf
#   scripts/chantier.sh --chercher "bouche hybride"                # voir les proches, sans rien écrire
#
# POURQUOI (Raphaël, 29 sept. 2026) : « je lance quasiment jamais de chantier
# dans le cockpit […] ce que je lance dans des sessions doit s'intégrer
# automatiquement dans le cockpit ; s'il détecte que c'est un cas qu'on reprend,
# qu'il rouvre le chantier au lieu d'en ouvrir 200 les mêmes ». Mesuré ce jour :
# 0 chantier sur 26 venait d'une session.
#
# Ce que fait --ouvrir (fonction SQL cockpit.ouvrir_ou_reprendre) :
#   - un chantier du projet ressemble nettement → il est REPRIS : la demande est
#     ajoutée à la suite (« --- Nouvelle demande du … »), il est réservé pour ta
#     session, et ROUVERT s'il était certifié, livré ou archivé ;
#   - rien ne ressemble → un chantier est CRÉÉ (origine « session », en cours,
#     réservé pour toi) ;
#   - deux chantiers ressemblent autant → rien n'est écrit : la liste s'affiche,
#     relance avec --id <le bon> ou --nouveau. Ne devine pas.
# Le titre : court, lisible par Raphaël (le sujet, pas la technique). La
# demande : SES mots, pas ta reformulation.

set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"
projet="${COCKPIT_PROJET:-}"; titre=""; demande=""; id=""; nouveau=false; chercher=""; section=""
session="${COCKPIT_SESSION:-$(git -C "$PWD" symbolic-ref --short -q HEAD 2>/dev/null || echo session)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --projet)   projet="${2:-}"; shift 2 ;;
    --ouvrir)   titre="${2:-}"; shift 2 ;;
    --demande)  demande="${2:-}"; shift 2 ;;
    --section)  section="${2:-}"; shift 2 ;;
    --id)       id="${2:-}"; shift 2 ;;
    --nouveau)  nouveau=true; shift ;;
    --chercher) chercher="${2:-}"; shift 2 ;;
    --session)  session="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$projet" ] || { echo "Projet inconnu : COCKPIT_PROJET ou --projet <slug>." >&2; exit 2; }
q() { printf '%s' "$1" | sed "s/'/''/g"; }

if [ -n "$chercher" ]; then
  "$SQL" "select id, titre, etat, archive, round(score::numeric, 2) as score from chantiers_proches('$(q "$projet")', '$(q "$chercher")', 6)" \
    | jq -r '.rows[] | "\(.score)  \(.id)  \(.titre)  [\(.etat)\(if .archive then ", archivé" else "" end)]"'
  exit 0
fi
[ -n "$titre" ] || { echo "--ouvrir \"<titre court>\" manque." >&2; exit 2; }
[ -n "$demande" ] || { echo "--demande manque : recopie la demande de Raphaël, avec ses mots." >&2; exit 2; }

idsql="null"; [ -n "$id" ] && idsql="'$(q "$id")'::uuid"
secsql="null"; [ -n "$section" ] && secsql="'$(q "$section")'"
r=$("$SQL" "select ouvrir_ou_reprendre('$(q "$projet")', '$(q "$titre")', '$(q "$demande")', '$(q "$session")', $idsql, $nouveau, $secsql) as r" | jq -c '.rows[0].r')
case "$(printf '%s' "$r" | jq -r .action)" in
  cree)    printf 'Nouveau chantier créé dans le cockpit : « %s » (%s). Il est réservé pour ta session.\n' "$(jq -r .titre <<<"$r")" "$(jq -r .id <<<"$r")" ;;
  repris)  printf 'Chantier existant REPRIS : « %s » (%s). Ta demande est ajoutée à sa suite ; il est réservé pour ta session.\n' "$(jq -r .titre <<<"$r")" "$(jq -r .id <<<"$r")" ;;
  rouvert) printf 'Chantier ROUVERT : « %s » (%s). Il était terminé ; la nouvelle demande est ajoutée à sa suite.\n' "$(jq -r .titre <<<"$r")" "$(jq -r .id <<<"$r")" ;;
  ambigu)  echo "Plusieurs chantiers ressemblent à cette demande — rien n'a été écrit. Choisis :"
           printf '%s' "$r" | jq -r '.candidats[] | "  \(.score)  \(.id)  \(.titre)  [\(.etat)]"'
           echo "Relance avec --id <le bon>, ou --nouveau si c'est un autre sujet. En cas de doute, demande à Raphaël."
           exit 3 ;;
  *)       echo "Réponse inattendue : $r" >&2; exit 1 ;;
esac
echo "Ensuite : scripts/progression.sh --chantier <id> --etape … à chaque étape ; jalons « pousse », « ci-ok », « en-ligne » ; puis --termine avec --verifier."
