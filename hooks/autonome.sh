#!/usr/bin/env bash
# Hook Stop : le MODE AUTONOME. Quand la session a fini sa tâche et que le
# projet est en mode autonome (allumé jusqu'à une heure donnée, depuis le
# cockpit), elle ne s'arrête pas : le cockpit lui donne le chantier LIBRE
# suivant, déjà réservé pour elle. Sinon, ce hook ne dit rien.
#
# Pourquoi (Raphaël, 29 sept. 2026) : « si elle n'a rien à reprendre, qu'elle
# poursuive sur les chantiers disponibles […] je pars dormir à 4 h, je me
# réveille à 9 h : ce sont 4 h gagnées ». La REPRISE après une limite d'usage
# est native (réglage autoContinueAtUsageLimit) ; ceci est l'ENCHAÎNEMENT.
#
# Garde-fous (dans la consigne donnée à la session, et côté base) : jamais un
# chantier « à cadrer » (seulement « libre ») ; plafond de chantiers par
# session (projets.autonome_max) ; arrêt à l'heure dite ; aucune dépense, aucune
# suppression, aucun envoi externe. Au moindre souci : silence (la session
# s'arrête normalement), jamais un blocage.
set -uo pipefail
entree=$(cat 2>/dev/null || true)
FILTRE='
"MODE AUTONOME du cockpit (\(if .jusqu_a == "tout le temps" then "allumé en permanence par Raphaël" else "Raphaël est absent jusqu’à \(.jusqu_a)" end)) : ne t’arrête pas, prends le chantier suivant, déjà réservé pour toi.\n\nChantier « \(.titre) » (id \(.id))\(if .etat_avant == "en_cours" then " — il était EN COURS mais abandonné par une session : lis son fil et sa progression, reprends où elle en était" elif .etat_avant == "a_trier" then " — PAS ENCORE TRIÉ : décide toi-même ; si c’est un doublon, --suggerer-fusion ; s’il faut une décision de Raphaël, pose-la avec \($dem) et passe-le « à cadrer »" else "" end).\nSa demande :\n\(.demande)\(if $repro != "" then "\n" + $repro else "" end)\n\nRègles, sans exception :\n- AUCUNE dépense (GPU, API payante, ressource facturée), AUCUNE suppression de données ou de ressource, AUCUN envoi en son nom (message, e-mail, publication).\n- Si une décision ou une action de Raphaël est nécessaire : pose-la avec \($dem) (--pourquoi, options, ta recommandation), écris où tu en es dans le fil, libère le chantier et termine ta réponse ; le cockpit te donnera le suivant.\n- Sinon, mène-le au bout comme d’habitude : \($prog) à chaque étape, jalons, puis --termine avec --verifier et --en-ligne / --pas-en-ligne.\n- Tu peux encore enchaîner \(.reste) chantier(s) après celui-ci."'
PROG="${COCKPIT_PROG_CMD:-scripts/progression.sh}"; DEM="${COCKPIT_DEM_CMD:-scripts/demander.sh}"
consigne() { # JSON du chantier → texte de la consigne (une seule source, pour le hook ET la passe)
  # D-05 : « scénario capturé chez l'utilisateur » quand la demande vient du site (vide sinon).
  local id repro=""; id=$(printf '%s' "$1" | jq -r '.id // empty' 2>/dev/null)
  [ -n "$id" ] && repro=$(timeout 10 bash "$(dirname "${BASH_SOURCE[0]}")/../scripts/reproduction.sh" --ligne "$id" 2>/dev/null || true)
  printf '%s' "$1" | jq -r --arg prog "$PROG" --arg dem "$DEM" --arg repro "$repro" "$FILTRE"
}
if [ "${1:-}" = "--texte" ]; then consigne "$entree"; exit 0; fi
PROJET="${COCKPIT_PROJET:-}"
[ -n "$PROJET" ] && [ -n "$entree" ] && command -v jq >/dev/null || exit 0
RACINE="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
[ "$(printf '%s' "$entree" | jq -r '.hook_event_name // empty')" = "Stop" ] || exit 0
sid=$(printf '%s' "$entree" | jq -r '.session_id // empty'); [ -n "$sid" ] || exit 0
branche=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
q() { printf '%s' "$1" | sed "s/'/''/g"; }
# UN SUJET = UN FIL (0028, 0091) : chaque fil où ses mots ont été rangés pendant ce tour — chantier ouvert ou repris
# (chantier.sh --ouvrir, noté dans le tour) OU fil où le hook de suivi a rangé son message (le chantier que la session
# tient, sinon la discussion du projet : fils_du_tour_sans_reponse) — doit avoir reçu une réponse ÉCRITE de session
# depuis son message (progression.sh --point ; les lignes « Chantier ouvert/repris… » ne comptent pas). Sinon l'arrêt
# est refusé UNE fois, avec la liste ; jamais de boucle (« relance »).
tour="${COCKPIT_TOUR:-$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --absolute-git-dir 2>/dev/null)/cockpit-tour}"
renfort_marque=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --absolute-git-dir 2>/dev/null)/cockpit-renfort
if [ -s "$tour" ] && grep -qxF "session $sid" "$tour" && ! grep -qxE 'relance|ok' "$tour"; then
  ids=$(grep -E '^chantier [0-9a-f-]{36}' "$tour" | awk '{print $2}' | sort -u | tr '\n' ' ')
  debut=$(sed -n 's/^debut //p' "$tour" | head -1 | tr -cd '0-9TZ:-')
  if [ -n "$debut" ]; then
    manque=""
    if [ -n "${ids// /}" ]; then
      liste=$(printf "'%s'," $ids); liste="${liste%,}"
    manque=$(timeout 8 "$SQL" "select coalesce(string_agg(format('- « %s » : %s --chantier %s --point \"…\"', c.titre, '${COCKPIT_PROG_CMD:-scripts/progression.sh}', c.id), chr(10) order by c.titre), '') as m from chantiers c where c.id::text in ($liste) and not exists (select 1 from messages m where m.chantier_id = c.id and m.auteur_type = 'session' and m.created_at >= '$debut'::timestamptz and m.corps not like 'Chantier ouvert depuis une session : %' and m.corps not like 'Chantier ROUVERT %' and m.corps not like 'Chantier repris pour une nouvelle demande : %')" 2>/dev/null | jq -r '.rows[0].m // empty' 2>/dev/null)
    fi
    fils=$(timeout 8 "$SQL" "select coalesce(string_agg(case when f.chantier_id is null then format('- la discussion du projet : %s --point \"…\"', '$PROG') else format('- « %s » : %s --chantier %s --point \"…\"', f.titre, '$PROG', f.chantier_id) end, chr(10) order by f.titre nulls first), '') as m from fils_du_tour_sans_reponse('$(q "$PROJET")', '$(q "$branche")', '$debut'::timestamptz) f" 2>/dev/null | jq -r '.rows[0].m // empty' 2>/dev/null)
    manque=$(printf '%s\n%s\n' "$manque" "$fils" | grep -v '^$' | sort -u)
    if [ -n "$manque" ]; then
      echo relance >> "$tour"
      jq -n --arg r "UN SUJET = UN FIL : Raphaël suit aussi ces sujets dans le cockpit, et leur fil n'a pas encore ta réponse. Pour chacun, écris-y ce que tu viens de lui répondre sur CE sujet (400 caractères au plus, la réponse d'abord), puis termine. Si son message ne concerne PAS ce fil, réponds dans le bon (progression.sh --chantier <autre id> --point, ou --point seul pour la discussion du projet) : le message s'y déplace :
$manque" '{decision: "block", reason: $r}'
      exit 0
    fi
    echo ok >> "$tour"
  fi
fi
# TRAVAIL SANS CHANTIER (0091) : le filet qui remplace l'ouverture d'un chantier par message. Si la session a modifié des
# fichiers pendant ce tour (hooks/suivi.sh les compte) et ne tient AUCUN chantier, Raphaël ne voit ni ce qu'elle fait ni
# où elle en est : une relance, une seule par tour, qui lui laisse chercher le chantier existant ou en ouvrir un.
trav="${TMPDIR:-/tmp}/cockpit-travail-$sid"
if [ -n "$branche" ] && [ -s "$tour" ] && grep -qxF "session $sid" "$tour" && ! grep -qx 'travail-relance' "$tour" && [ ! -s "$renfort_marque" ] && [ -s "$trav" ]; then
  nb=$(wc -l < "$trav" 2>/dev/null | tr -d ' ')
  if [ "${nb:-0}" -ge "${COCKPIT_TRAVAIL_MIN:-3}" ] 2>/dev/null; then
    tient=$(timeout 8 "$SQL" "select count(*)::int as n from chantiers_de_la_session((select id from projets where slug = '$(q "$PROJET")'), '$(q "$branche")', 3)" 2>/dev/null | jq -r '.rows[0].n // empty' 2>/dev/null)
    if [ "$tient" = "0" ]; then
      echo travail-relance >> "$tour"
      CH="${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh}"
      jq -n --arg r "TRAVAIL SANS CHANTIER : tu as modifié $nb fichiers dans ce tour et ta session ne tient aucun chantier : Raphaël ne voit ni ce que tu fais, ni où tu en es. Cherche d'abord le sujet s'il existe : $CH --chercher \"<mots>\". Il existe : reprends-le ($CH --ouvrir \"<titre>\" --demande \"<ce que tu as fait>\" --id <id>). Il n'existe pas : ouvre-le ($CH --ouvrir \"<titre court>\" --demande \"<ses mots>\"). Puis signale ton étape : $PROG --chantier <id> --etape \"…\" --pct N. Une simple retouche sans suite à suivre : termine sans rien faire de plus (cette relance n'a lieu qu'une fois par tour)." '{decision: "block", reason: $r}'
      exit 0
    fi
  fi
fi
# Une session de RENFORT (0024) ne prend que SA section : son hook Stop lui
# redonne ses chantiers suivants s'il y en a (jamais ceux d'une autre section).
renfort_marque=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --absolute-git-dir 2>/dev/null)/cockpit-renfort
if [ -s "$renfort_marque" ]; then
  rid=$(head -1 "$renfort_marque" | tr -cd '0-9a-f-')
  RENF="${COCKPIT_RENFORT_CMD:-scripts/renfort.sh}"
  # Greffe invisible : la commande est hors du dépôt (chemin complet).
  case "$RENF" in /*) ;; *) RENF="${CLAUDE_PROJECT_DIR:-$PWD}/$RENF" ;; esac
  suite=$(timeout 20 bash "$RENF" --suivant "$rid" 2>/dev/null || true)
  case "$suite" in "RENFORT :"*) jq -n --arg r "$suite" '{decision: "block", reason: $r}' ;; esac
  exit 0
fi
# Chef du projet (0014, 0019) : si CE projet a une chef, seule elle fait avancer
# son travail, par des agents ; les autres sessions du projet n'enchaînent rien
# (« elles se marchent dessus »). La chef d'un AUTRE projet ne compte pas ici.
chef=$(timeout 8 "$SQL" "select chef_existe('$(q "$PROJET")') as e, est_chef('$(q "$PROJET")', '$(q "$sid")') as c" 2>/dev/null | jq -c '.rows[0] // {}' 2>/dev/null)
if [ "$(printf '%s' "$chef" | jq -r '.e // false')" = "true" ]; then
  [ "$(printf '%s' "$chef" | jq -r '.c // false')" = "true" ] || exit 0
  CHEF="${COCKPIT_CHEF_CMD:-scripts/chef.sh}"
  case "$CHEF" in /*) ;; *) CHEF="$RACINE/$CHEF" ;; esac # greffe invisible : chemin complet
  passe=$(COCKPIT_PROJET="$PROJET" CLAUDE_CODE_SESSION_ID="$sid" timeout 20 bash "$CHEF" 2>/dev/null || true)
  case "$passe" in ""|RIEN*) exit 0 ;; esac
  jq -n --arg r "$passe" '{decision: "block", reason: $r}'; exit 0
fi
timeout 5 "$SQL" "select liberer_silencieux('$(q "$PROJET")')" >/dev/null 2>&1 || true   # 0041
r=$(timeout 8 "$SQL" "select prochain_chantier_autonome('$(q "$PROJET")', '$(q "$sid")', '$(q "$branche")') as c" 2>/dev/null | jq -c '.rows[0].c // empty' 2>/dev/null)
# Sans crédit perdu (0031) : le constat du passage (rien à faire depuis le délai réglé → éteint tout seul).
timeout 5 "$SQL" "select constater_autonome('$(q "$PROJET")') as r" >/dev/null 2>&1 || true
[ -n "$r" ] && [ "$r" != "null" ] || exit 0
raison=$(consigne "$r")
jq -n --arg r "$raison" '{decision: "block", reason: $r}'
