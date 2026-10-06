#!/usr/bin/env bash
# Hook SessionStart : injecte l'état vivant du cockpit du projet courant.
#
# Installé par scripts/brancher.sh dans <projet>/.claude/hooks/session-start.sh
# et déclaré dans <projet>/.claude/settings.json, avec la variable d'env
# COCKPIT_PROJET=<slug>. Il lit la BASE centrale (schéma cockpit) : le contenu
# est à jour même si le dépôt n'a pas bougé. Court, exprès (décision D-08) :
# chantiers ouverts par section, ce qui attend une réponse, les réponses
# récentes de l'humain, les demandes des utilisateurs, ce qui a été livré.
# Il ne fait JAMAIS échouer le démarrage : toute erreur devient une note.

set -uo pipefail
# L'entrée du hook (session_id) : sert à poser le curseur des réponses en direct.
entree=""; [ -t 0 ] || entree=$(timeout 2 cat 2>/dev/null || true)
RACINE="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# COCKPIT_SQL est posé par le lanceur (scripts/cockpit-lanceur.sh) dans un
# projet branché : le sql.sh du projet peut viser une AUTRE base (FacePro/Neon).
SQL="${COCKPIT_SQL:-$RACINE/scripts/sql.sh}"
PROJET="${COCKPIT_PROJET:-}"
# Noms des scripts tels qu'installés dans le projet (brancher.sh les réécrit).
SQL_CMD="${COCKPIT_SQL_CMD:-scripts/sql.sh}"; PROG_CMD="${COCKPIT_PROG_CMD:-scripts/progression.sh}"; DEM_CMD="${COCKPIT_DEM_CMD:-scripts/demander.sh}"; CHANTIER_CMD="${COCKPIT_CHANTIER_CMD:-scripts/chantier.sh}"; MEDIA_CMD="${COCKPIT_MEDIA_CMD:-scripts/media.sh}"

emettre() { jq -n --arg c "$1" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'; }

if [ -z "$PROJET" ]; then
  emettre "Cockpit non chargé : COCKPIT_PROJET n'est pas défini (voir .claude/settings.json, posé par brancher.sh)."; exit 0
fi
if [ ! -x "$SQL" ]; then
  emettre "Cockpit non chargé : $SQL introuvable ou non exécutable."; exit 0
fi
if ! command -v jq >/dev/null; then
  emettre "Cockpit non chargé : jq manque dans cet environnement."; exit 0
fi

un() { "$SQL" "$1" 2>/dev/null | jq -r 'if (.rows|type)!="array" or (.rows|length)==0 then "" else (.rows[0] | if type=="object" then (to_entries[0].value // "") else (. // "") end) end' 2>/dev/null || echo ""; }
P="'$PROJET'"
# Heure de la BASE avant de lire l'état : tout ce qui arrive ensuite sera remis
# en direct par hooks/suivi.sh (curseur de cette session), rien n'est remis deux fois.
debut_lecture=$(un "select now()")

test=$(un "select nom from projets where slug = $P")
if [ -z "$test" ]; then
  emettre "Cockpit non chargé : le projet « $PROJET » est inconnu en base, ou la clé Supabase manque (SUPABASE_SERVICE_ROLE_KEY). Signale-le à Raphaël, n'invente pas l'état du projet."; exit 0
fi

# MISE À JOUR AUTOMATIQUE du projet (29 sept. 2026, Raphaël : « les améliorations
# du cockpit doivent être partout ») : réglages des hooks, lanceurs, bloc du
# CLAUDE.md. Seulement via un lanceur (cache) dans un projet branché — jamais
# dans le dépôt du cockpit lui-même. Ce qui a changé est dit à la session, qui
# le commite ; la base garde la preuve que le projet est branché et à jour.
maj=""; commit_maj=""
# DÉPÔT QUI N'EST PAS À RAPHAËL (30 sept. 2026, chantier f31ae3ec) :
# - voie 1, greffe invisible (COCKPIT_SANS_TRACE, posé par le lanceur de
#   ~/.cockpit) : AUCUNE mise à jour ni aucun commit dans le dépôt, les
#   consignes arrivent ici ;
# - voie 2, branches de Raphaël (COCKPIT_VOIE=branches) : mise à jour et commit
#   SEULEMENT sur une de ses branches ; ailleurs, la garde pre-push seulement.
ICI_HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
voie="${COCKPIT_VOIE:-normale}"; [ "${COCKPIT_SANS_TRACE:-}" = 1 ] && voie=invisible
br_courante=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
branche_ok=1; bloc_voie=""
if [ "$voie" = branches ]; then
  motifs="${COCKPIT_BRANCHES:-$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" config --get cockpit.branches 2>/dev/null || echo 'claude/*')}"
  branche_ok=0; set -f
  for m in $motifs; do case "$br_courante" in $m) branche_ok=1 ;; esac; done
  set +f
  if [ "$branche_ok" = 0 ] && [ -n "${COCKPIT_CACHE:-}" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$COCKPIT_CACHE/scripts/brancher.sh" ]; then
    timeout 10 bash "$COCKPIT_CACHE/scripts/brancher.sh" --garde-seulement --projet "$PROJET" --dossier "$CLAUDE_PROJECT_DIR" >/dev/null 2>&1 || true
  fi
  bloc_voie="## DÉPÔT D'AUTRUI (voie 2) : le cockpit ne vit que sur les branches de Raphaël ($motifs)
Branche courante : ${br_courante:-aucune} — $([ "$branche_ok" = 1 ] && echo "à Raphaël." || echo "PAS à Raphaël : les fichiers du cockpit n'y sont ni mis à jour ni commités ; ne les y ajoute pas.")
Une garde (.git/hooks/pre-push) refuse de pousser les fichiers du cockpit vers une autre branche. Pour une PR vers LEUR branche : ${COCKPIT_GREFFE_CMD:-scripts/greffe.sh} --branche-propre <nom> (un seul commit, sans le cockpit), pousse <nom> et ouvre la PR depuis elle. Ne fusionne jamais toi-même dans leur branche principale. La clé service_role ne va jamais dans ce dépôt.
"
elif [ "$voie" = invisible ]; then
  bin="${COCKPIT_HOME:-$HOME/.cockpit}/bin"
  bloc_voie="## GREFFE INVISIBLE : ce dépôt n'est PAS à Raphaël
Rien du cockpit ne doit y apparaître : aucun fichier, aucun commit, aucune PR, aucun commentaire ni message de commit qui le mentionne ; la clé service_role n'y va jamais. Les commandes du cockpit sont HORS du dépôt, dans $bin : tape-les avec ce chemin complet. Ce dépôt n'a pas de bloc « Cockpit » dans son CLAUDE.md : ces consignes-ci font foi.
$(sed -e "s/{{SLUG}}/$PROJET/g" -e "s#{{SQL}}#scripts/cockpit-sql.sh#g" "$ICI_HOOK/docs/bloc-CLAUDE.md" 2>/dev/null | grep -v '^<!--' | sed -e "s#\.claude/hooks/cockpit-session-start\.sh#$bin/cockpit-greffe-hook.sh#g" -e "s#scripts/cockpit-#$bin/cockpit-#g")
"
fi
if [ "$voie" != invisible ] && [ "$branche_ok" = 1 ] && [ -n "${COCKPIT_CACHE:-}" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$COCKPIT_CACHE/scripts/brancher.sh" ]; then
  # Les fichiers du cockpit dans le projet, et ceux qui étaient PROPRES avant la
  # mise à jour : seuls ceux-là seront commités (jamais un travail en cours de
  # Raphaël ou d'une session, mélangé à la mise à jour).
  cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
    propres=()
    for f in CLAUDE.md .claude/settings.json scripts/cockpit-*.sh .claude/hooks/cockpit-*.sh; do
      [ -e "$f" ] || continue
      git diff --quiet HEAD -- "$f" 2>/dev/null && propres+=("$f")
    done
  }
  maj=$(timeout 30 bash "$COCKPIT_CACHE/scripts/brancher.sh" --maj --projet "$PROJET" --dossier "$CLAUDE_PROJECT_DIR" 2>/dev/null | sed 's/^ *//' | head -20)
  # 29 sept. : FacePro n'avait JAMAIS gardé une mise à jour — la consigne « commite »
  # était ignorée, et chaque nouvelle session repartait des anciennes règles. Le
  # cockpit commite donc lui-même ses fichiers, sur la branche courante (ils
  # partent avec le prochain push de la session), sans rien pousser d'autre.
  if [ -n "$maj" ] && git -C "$CLAUDE_PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    a_commiter=()
    for f in "${propres[@]}" scripts/cockpit-*.sh .claude/hooks/cockpit-*.sh; do
      [ -e "$CLAUDE_PROJECT_DIR/$f" ] || continue
      git -C "$CLAUDE_PROJECT_DIR" ls-files --error-unmatch -- "$f" >/dev/null 2>&1 || { git -C "$CLAUDE_PROJECT_DIR" add -- "$f" 2>/dev/null; }
      git -C "$CLAUDE_PROJECT_DIR" diff --quiet HEAD -- "$f" 2>/dev/null || a_commiter+=("$f")
    done
    if [ ${#a_commiter[@]} -gt 0 ] && git -C "$CLAUDE_PROJECT_DIR" -c user.name="${GIT_AUTHOR_NAME:-Cockpit}" -c user.email="${GIT_AUTHOR_EMAIL:-cockpit@noreply}" \
         commit -q --only -m "Cockpit : mise à jour automatique (consignes et commandes du cockpit central)" -- "${a_commiter[@]}" >/dev/null 2>&1; then
      commit_maj="Déjà commité sur ta branche ($(git -C "$CLAUDE_PROJECT_DIR" rev-parse --short HEAD)) : il part avec ton prochain push. Pousse-le au plus tôt."
    fi
  fi
fi
majsql="null"; [ -n "$maj" ] && majsql="'$(printf '%s' "$maj" | sed "s/'/''/g")'"
un "update projets set branchement_vu_at = now(), branchement_maj = coalesce($majsql, branchement_maj), branchement_maj_at = case when $majsql is not null then now() else branchement_maj_at end where slug = $P" >/dev/null 2>&1 || true
bloc_maj=""
if [ -n "$maj" ]; then
  bloc_maj="## ⚠️ Le cockpit vient de METTRE À JOUR ce projet (nouvelle version du cockpit)
$maj

${commit_maj:-Commite ces fichiers TOUT DE SUITE, seuls, dans un commit « Cockpit : mise à jour automatique », et pousse-le.} Ne les modifie pas. Les nouveaux hooks s'appliquent aux PROCHAINES sessions.

Les consignes du cockpit ont changé et ton CLAUDE.md était chargé AVANT cette mise à jour : voici la version à jour, qui fait foi pour cette session :
$(sed "s/{{SLUG}}/$PROJET/g" "$COCKPIT_CACHE/docs/bloc-CLAUDE.md" 2>/dev/null | grep -v '^<!--')
"
fi

chantiers=$(un "select coalesce(string_agg(bloc, chr(10)||chr(10) order by pos, sec), '(aucun chantier ouvert)') from (select coalesce(s.position, 999) as pos, coalesce(s.nom, 'Sans section') as sec, '### ' || coalesce(s.nom, 'Sans section') || ' (' || count(*) || ')' || chr(10) || string_agg(format('- %s | %s | %s | %s%s%s', c.id, c.titre, c.etat, c.priorite, case when c.pris_par is not null and c.pris_jusqu_a > now() then ' | PRIS PAR ' || c.pris_par else '' end, case when coalesce(c.demande,'') <> '' then chr(10) || '    ' || left(replace(c.demande, chr(10), ' '), 200) else '' end), chr(10) order by case c.etat when 'en_cours' then 0 when 'a_verifier' then 1 when 'libre' then 2 when 'a_trier' then 3 when 'bloque' then 4 when 'a_cadrer' then 5 else 6 end, c.priorite = 'haute' desc, c.created_at) as bloc from chantiers c join projets p on p.id = c.projet_id left join sections s on s.id = c.section_id where p.slug = $P and c.archived_at is null group by s.position, s.nom) g")

attente=$(un "select coalesce(string_agg(format('- [%s] %s%s — %s (posée par %s, %s)%s', m.id, case m.kind when 'action' then 'IL DOIT LE FAIRE : ' else 'IL DOIT DÉCIDER : ' end, m.corps, coalesce(c.titre, 'général'), m.auteur, to_char(m.created_at, 'DD/MM HH24:MI'), case when cockpit.est_retour_carte(m) then chr(10) || '    IL A RÉPONDU « ' || coalesce(m.reponse,'') || ' »' || coalesce(' — ' || nullif(m.precision,''), '') || ' (' || to_char(m.retour_at, 'DD/MM HH24:MI') || ') : carte restée ouverte, à traiter puis fermer' else '' end || case when m.options is not null then chr(10) || '    options : ' || (select string_agg(o->>'libelle', ' / ') from jsonb_array_elements(m.options) o) else '' end), chr(10) order by m.created_at), '(rien)') from messages m join projets p on p.id = m.projet_id left join chantiers c on c.id = m.chantier_id where p.slug = $P and m.kind in ('question','action') and m.answered_at is null")

reponses=$(un "select coalesce(string_agg(format('- %s | %s → « %s »%s (%s)', to_char(m.answered_at, 'DD/MM HH24:MI'), left(m.corps, 90), coalesce(m.reponse, m.etat, ''), case when coalesce(m.precision,'') <> '' then ' — précision : ' || m.precision else '' end, coalesce(c.titre, 'général')), chr(10) order by m.answered_at desc), '(aucune)') from (select m.* from messages m join projets p on p.id = m.projet_id where p.slug = $P and m.answered_at is not null order by m.answered_at desc limit 10) m left join chantiers c on c.id = m.chantier_id")

# Ses RÉPONSES que personne n'a encore prises (29 sept. 2026 : sur ses réponses du
# jour, plusieurs sont restées sans suite). UNE seule règle, celle de la chef :
# reponses_sans_suite() (0017, 0018) — SES réponses depuis l'app, que rien n'a
# suivies (message de session, étape, étape d'agent), sur un chantier ouvert que
# personne d'AUTRE ne tient (réservé à notre branche = le nôtre). Ne pas réécrire
# la règle ici : la changer dans la fonction, par une nouvelle migration.
branche=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" symbolic-ref --short -q HEAD 2>/dev/null || echo "")
brsql="null"; [ -n "$branche" ] && brsql="'$(printf '%s' "$branche" | sed "s/'/''/g")'"
non_prises=$(un "select coalesce(string_agg(format('- [%s] %s | %s « %s » → il a répondu « %s »%s%s', to_char(coalesce(m.answered_at, m.retour_at), 'DD/MM HH24:MI'), coalesce(c.titre || ' (' || c.id || ')', 'général'), case when m.kind = 'action' then 'carte d''action' else 'question' end, left(replace(m.corps, chr(10), ' '), 120), m.reponse, case when coalesce(m.precision,'') <> '' then ' — précision : ' || left(m.precision, 200) else '' end, case when m.answered_at is null then ' — LA CARTE EST RESTÉE OUVERTE : traite son retour, puis FERME-la (scripts/demander.sh --retirer ' || m.id || ' \"pourquoi\" si elle n''a plus lieu d''être, ou corrige puis reviens la lui reposer)' else '' end), chr(10) order by coalesce(m.answered_at, m.retour_at)), '(aucune)') from reponses_sans_suite((select id from projets where slug = $P), $brsql) r join messages m on m.id = r.message_id left join chantiers c on c.id = m.chantier_id")

constats=$(un "select coalesce(string_agg(format('- %s | %s | %s', to_char(m.created_at, 'DD/MM HH24:MI'), coalesce(c.titre,''), left(m.corps, 160)), chr(10) order by m.created_at desc), '(aucun)') from (select * from messages where kind = 'constat' order by created_at desc limit 8) m join projets p on p.id = m.projet_id left join chantiers c on c.id = m.chantier_id where p.slug = $P")

# Ce que Raphaël (ou un utilisateur) a écrit dans un fil et qu'AUCUNE réponse
# écrite de Claude n'a suivi (une étape ne suffit pas, 0025) : « je n'ai pas
# compris », une précision, un « Corriger »… UNE seule règle, celle de la chef :
# messages_sans_reponse(projet, sa branche). Ne pas la réécrire ici.
sans_suite=$(un "select coalesce(string_agg(format('- [%s] %s | %s : %s%s%s', to_char(m.created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), coalesce(c.titre || ' (' || c.id || ')', 'fil du projet'), m.auteur, left(replace(m.corps, chr(10), ' '), 240), case when r.nombre > 1 then format(' (+%s autre(s) message(s) dans ce fil)', r.nombre - 1) else '' end, case when jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0 then format(' [📎 %s pièce(s) jointe(s) — REGARDE-LES : $MEDIA_CMD --message %s]', jsonb_array_length(m.medias), m.id) else '' end), chr(10) order by m.created_at), '(rien)') from messages_sans_reponse((select id from projets where slug = $P), $brsql) r join messages m on m.id = r.message_id left join chantiers c on c.id = r.chantier_id")

utilisateurs=$(un "select coalesce(string_agg(format('- %s | %s | %s%s', c.id, c.titre, c.etat, case when coalesce(c.demande,'') <> '' then chr(10) || '    ' || left(replace(c.demande, chr(10), ' '), 240) else '' end), chr(10) order by c.created_at), '(aucune)') from chantiers c join projets p on p.id = c.projet_id where p.slug = $P and c.origine = 'utilisateur' and c.archived_at is null and c.etat in ('a_trier','a_cadrer','libre')")

livres=$(un "select coalesce(string_agg(format('- %s | %s | %s', to_char(coalesce(c.valide_at, c.livre_at), 'DD/MM'), c.titre, case when c.etat = 'valide' then 'certifié' else 'à vérifier' end), chr(10) order by coalesce(c.valide_at, c.livre_at) desc), '(aucun)') from (select * from chantiers where etat in ('valide','a_verifier') order by coalesce(valide_at, livre_at) desc nulls last limit 8) c join projets p on p.id = c.projet_id where p.slug = $P")

activite=$(un "select coalesce(string_agg(format('- %s | %s | %s %s %% | %s | %s', a.session, coalesce(c.titre,''), repeat('█', a.pourcentage / 5) || repeat('░', 20 - a.pourcentage / 5), a.pourcentage, a.etape, to_char(a.updated_at, 'DD/MM HH24:MI')), chr(10) order by a.updated_at desc), '(aucune)') from activite a join projets p on p.id = a.projet_id left join chantiers c on c.id = a.chantier_id where p.slug = $P and a.statut = 'en_cours' and a.updated_at > now() - interval '12 hours'")

# Les agents et commandes lancés en arrière-plan, suivis tout seuls par le hook
# de suivi (29 sept. 2026) : ne relance pas ce qu'un agent fait déjà.
taches=$(un "select coalesce(string_agg(format('- %s | %s « %s »%s | depuis %s%s', coalesce(se.sujet, se.branche, left(se.id, 8)), case t.type when 'agent' then 'agent' when 'commande' then 'commande' else 'tâche' end, coalesce(t.description, t.sorte, t.tache_id), case when c.titre is not null then ' → ' || c.titre else '' end, to_char(t.demarre_at, 'DD/MM HH24:MI'), case when t.progres_at is not null then ' | ' || coalesce(t.etape, '') || coalesce(' ' || t.pourcentage || ' %', '') else '' end), chr(10) order by t.demarre_at), '(aucun)') from taches t join sessions se on se.id = t.session_id join projets p on p.id = t.projet_id left join chantiers c on c.id = t.chantier_id where p.slug = $P and t.statut = 'en_cours' and t.vu_at > now() - interval '12 hours'")

fusions=$(un "select coalesce(string_agg(format('- %s (suggérée le %s)', m.corps, to_char(m.created_at, 'DD/MM HH24:MI')), chr(10) order by m.created_at), '(aucune)') from messages m join projets p on p.id = m.projet_id where p.slug = $P and m.kind = 'fusion' and m.answered_at is null")

a_ranger=$(un "select coalesce(string_agg(format('- %s | %s', c.id, c.titre), chr(10) order by c.created_at), '(aucun)') from chantiers c join projets p on p.id = c.projet_id where p.slug = $P and c.archived_at is null and c.section_id is null")

sid=$(printf '%s' "$entree" | jq -r '.session_id // empty' 2>/dev/null)
[ -n "$sid" ] && [ -n "$debut_lecture" ] && printf '%s\n' "$debut_lecture" > "${TMPDIR:-/tmp}/cockpit-rep-$sid" 2>/dev/null

emettre "$(cat <<FIN
# Cockpit — projet « $test » ($PROJET), état au démarrage de cette session

RÉPONSES COURTES : à Raphaël, réponds simple, court, net et précis (la réponse d'abord, pas de pavé).

RÈGLE DE CLARTÉ : tout ce que Raphaël lit ici (questions, constats, « comment vérifier ») se
comprend d'un coup d'œil par quelqu'un qui ne code pas : le sujet, ce qu'il y a à faire, des
réponses toutes prêtes. Pas de jargon ; le détail va dans le fil.

Lu dans la base centrale à l'instant. Avant toute proposition : réserve un chantier avec
\`$SQL_CMD "select reserver_chantier('<id>', '<ta branche>', 120)"\` (false = une autre
session l'a), signale ta progression avec \`$PROG_CMD\` à chaque étape et en
terminant (--termine → le chantier passe « à vérifier », seul un humain certifie), pose
une question avec \`$DEM_CMD\` (jamais dans un artefact), et écris où tu en es
dans le fil du chantier avant de t'arrêter.

$bloc_voie$bloc_maj
## Chantiers ouverts, par section
$chantiers

## Ce qui attend une RÉPONSE humaine (ne repose pas ces questions, ne code pas ce qui en dépend)
$attente

## Ses RÉPONSES que personne n'a encore prises — applique-les (sur le chantier concerné), puis écris dans son fil ce que tu en fais
$non_prises

## Dernières réponses humaines (à appliquer avec jugement)
$reponses

## Ce que Raphaël (ou un utilisateur) a écrit SANS RÉPONSE — réponds-lui DANS le fil, court, avant de continuer : \`$PROG_CMD --chantier <id> --point "…"\` (fil du projet : sans --chantier). Un AUTRE sujet (« il faudrait aussi… ») : crée-le et range-le toi-même, ta réponse porte le lien : \`$CHANTIER_CMD --ouvrir "<titre>" --demande "<ses mots>" --depuis <id du fil | projet> --reponse "…"\`
$sans_suite

## Demandes des UTILISATEURS pas encore prises
$utilisateurs

## Constats récents (« ça marche » / « ça ne marche pas ») — ne casse pas ce qui marche
$constats

## Sessions actives (progression en direct)
$activite

## Agents et commandes en arrière-plan en ce moment (toutes sessions du projet)
$taches

## Fusions suggérées, en attente de Raphaël (ne les re-suggère pas)
$fusions

## Chantiers SANS section — c'est à TOI de les ranger (Raphaël ne trie pas) : \`$CHANTIER_CMD --ranger <id> --section "<rubrique>"\`
$a_ranger

## Derniers livrés
$livres
FIN
)"
