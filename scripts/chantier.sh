#!/usr/bin/env bash
# Enregistrer dans le cockpit le travail qu'on commence dans une session —
# AVANT de coder, à chaque nouvelle demande de Raphaël (fonctionnalité,
# correctif, reprise d'un sujet).
#
#   scripts/chantier.sh --ouvrir "Bouche hybride sans objet" --demande "<ses mots>"
#   scripts/chantier.sh --ouvrir "…" --demande "…" --id <uuid>     # c'est CE chantier-là
#   scripts/chantier.sh --ouvrir "…" --demande "…" --nouveau       # vraiment un sujet neuf
#   scripts/chantier.sh --chercher "bouche hybride"                # voir les proches, sans rien écrire
#   scripts/chantier.sh --ranger <id> --section "Tête entière"     # le ranger (section créée si besoin)
#   scripts/chantier.sh --suggerer-fusion <id à absorber> --dans <id qui reste> --pourquoi "…"
#
# C'EST TOI QUI TRANCHES (Raphaël, 29 sept. 2026) : « personne mieux que
# Claude sait si c'est un chantier doublon […] ce n'est pas à moi de trier,
# catégoriser à chaque fois, sinon c'est un enfer ; il peut me suggérer de
# fusionner, ça j'accepte ». Donc : sur « ambigu », tu lis les extraits et tu
# choisis ; tu ranges toujours dans une section ; et si deux chantiers
# EXISTANTS sont le même sujet, tu SUGGÈRES la fusion (il accepte d'un toucher).
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
#   - deux chantiers ressemblent autant → rien n'est écrit : la liste s'affiche
#     avec un extrait de chaque demande ; TU choisis et relances avec
#     --id <le bon> ou --nouveau (sans demander à Raphaël).
# Le titre : court, lisible par Raphaël (le sujet, pas la technique). La
# demande : SES mots, pas ta reformulation.

set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"
projet="${COCKPIT_PROJET:-}"; titre=""; demande=""; id=""; nouveau=false; chercher=""; section=""; ranger=""; fusion=""; dans=""; pourquoi=""
session="${COCKPIT_SESSION:-$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || git -C "$PWD" symbolic-ref --short -q HEAD 2>/dev/null || echo "session-${CLAUDE_CODE_SESSION_ID:0:8}")}"
while [ $# -gt 0 ]; do
  case "$1" in
    --projet)   projet="${2:-}"; shift 2 ;;
    --ouvrir)   titre="${2:-}"; shift 2 ;;
    --demande)  demande="${2:-}"; shift 2 ;;
    --section)  section="${2:-}"; shift 2 ;;
    --id)       id="${2:-}"; shift 2 ;;
    --nouveau)  nouveau=true; shift ;;
    --chercher) chercher="${2:-}"; shift 2 ;;
    --ranger)   ranger="${2:-}"; shift 2 ;;
    --suggerer-fusion) fusion="${2:-}"; shift 2 ;;
    --dans)     dans="${2:-}"; shift 2 ;;
    --pourquoi) pourquoi="${2:-}"; shift 2 ;;
    --session)  session="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$projet" ] || { echo "Projet inconnu : COCKPIT_PROJET ou --projet <slug>." >&2; exit 2; }
q() { printf '%s' "$1" | sed "s/'/''/g"; }

sections() { "$SQL" "select coalesce(string_agg(s.nom, ' · ' order by s.position, s.nom), '(aucune)') as l from sections s join projets p on p.id = s.projet_id where p.slug = '$(q "$projet")'" | jq -r '.rows[0].l'; }
ranger_dans() { # id, section
  "$SQL" "select ranger_chantier('$(q "$1")'::uuid, '$(q "$2")', '$(q "$session")') as s" | jq -e '.rows[0].s' >/dev/null \
    && echo "Rangé dans la section « $2 »." || { echo "Échec du rangement dans « $2 »." >&2; return 1; }
}

if [ -n "$chercher" ]; then
  "$SQL" "select id, titre, etat, archive, round(score::numeric, 2) as score, extrait from chantiers_proches_detail('$(q "$projet")', '$(q "$chercher")', 6)" \
    | jq -r '.rows[] | "\(.score)  \(.id)  \(.titre)  [\(.etat)\(if .archive then ", archivé" else "" end)]\n        « \(.extrait) »"'
  exit 0
fi
if [ -n "$ranger" ]; then
  [ -n "$section" ] || { echo "--section \"<nom>\" manque. Sections existantes : $(sections)" >&2; exit 2; }
  ranger_dans "$ranger" "$section"; exit $?
fi
if [ -n "$fusion" ]; then
  [ -n "$dans" ] || { echo "--dans <id du chantier qui reste> manque." >&2; exit 2; }
  [ -n "$pourquoi" ] || { echo "--pourquoi manque : dis en une phrase simple pourquoi c'est le même sujet." >&2; exit 2; }
  r=$("$SQL" "select suggerer_fusion('$(q "$fusion")'::uuid, '$(q "$dans")'::uuid, '$(q "$pourquoi")', '$(q "$session")') as m")
  if [ "$(printf '%s' "$r" | jq -r '.ok')" != "true" ]; then echo "Échec : $(printf '%s' "$r" | jq -r '.error // .message // .')" >&2; exit 1; fi
  if [ "$(printf '%s' "$r" | jq -r '.rows[0].m')" = "null" ]; then echo "Cette fusion est déjà suggérée et attend Raphaël."; else
    echo "Fusion suggérée à Raphaël : il l'accepte ou la refuse d'un toucher dans le cockpit. Rien n'est fusionné tant qu'il n'a pas accepté."; fi
  exit 0
fi
[ -n "$titre" ] || { echo "--ouvrir \"<titre court>\" manque." >&2; exit 2; }
[ -n "$demande" ] || { echo "--demande manque : recopie la demande de Raphaël, avec ses mots." >&2; exit 2; }

idsql="null"; [ -n "$id" ] && idsql="'$(q "$id")'::uuid"
secsql="null"  # la section est posée juste après par ranger_chantier (qui la crée si besoin)
r=$("$SQL" "select ouvrir_ou_reprendre('$(q "$projet")', '$(q "$titre")', '$(q "$demande")', '$(q "$session")', $idsql, $nouveau, $secsql) as r" | jq -c '.rows[0].r')
case "$(printf '%s' "$r" | jq -r .action)" in
  cree)    printf 'Nouveau chantier créé dans le cockpit : « %s » (%s). Il est réservé pour ta session.\n' "$(jq -r .titre <<<"$r")" "$(jq -r .id <<<"$r")" ;;
  repris)  printf 'Chantier existant REPRIS : « %s » (%s). Ta demande est ajoutée à sa suite ; il est réservé pour ta session.\n' "$(jq -r .titre <<<"$r")" "$(jq -r .id <<<"$r")" ;;
  rouvert) printf 'Chantier ROUVERT : « %s » (%s). Il était terminé ; la nouvelle demande est ajoutée à sa suite.\n' "$(jq -r .titre <<<"$r")" "$(jq -r .id <<<"$r")" ;;
  ambigu)  echo "Plusieurs chantiers ressemblent à cette demande — rien n'a été écrit. C'EST À TOI DE TRANCHER (pas à Raphaël) :"
           "$SQL" "select id, titre, etat, round(score::numeric, 2) as score, extrait from chantiers_proches_detail('$(q "$projet")', '$(q "$titre")', 5) where score >= 0.45" \
             | jq -r '.rows[] | "  \(.score)  \(.id)  \(.titre)  [\(.etat)]\n        « \(.extrait) »"'
           echo "Relance avec --id <le bon> si c'est la suite de l'un d'eux, ou --nouveau si c'est un autre sujet."
           echo "Si deux de ces chantiers sont en fait le même sujet : --suggerer-fusion <id> --dans <id> --pourquoi \"…\"."
           exit 3 ;;
  *)       echo "Réponse inattendue : $r" >&2; exit 1 ;;
esac
cid=$(jq -r .id <<<"$r")
if [ -n "$section" ]; then ranger_dans "$cid" "$section" || true
elif [ "$("$SQL" "select section_id is null as n from chantiers where id = '$cid'" | jq -r '.rows[0].n')" = "true" ]; then
  echo "À RANGER par toi (Raphaël ne trie pas) : ${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh} --ranger $cid --section \"<rubrique>\". Sections existantes : $(sections). Une nouvelle est créée si besoin."
fi
echo "Ensuite : scripts/progression.sh --chantier <id> --etape … à chaque étape ; jalons « pousse », « ci-ok », « en-ligne » ; puis --termine avec --verifier."
