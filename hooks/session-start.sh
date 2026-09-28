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
RACINE="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SQL="$RACINE/scripts/sql.sh"
PROJET="${COCKPIT_PROJET:-}"
# Noms des scripts tels qu'installés dans le projet (brancher.sh les réécrit).
SQL_CMD="scripts/sql.sh"; PROG_CMD="scripts/progression.sh"; DEM_CMD="scripts/demander.sh"

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

test=$(un "select nom from projets where slug = $P")
if [ -z "$test" ]; then
  emettre "Cockpit non chargé : le projet « $PROJET » est inconnu en base, ou la clé Supabase manque (SUPABASE_SERVICE_ROLE_KEY). Signale-le à Raphaël, n'invente pas l'état du projet."; exit 0
fi

chantiers=$(un "select coalesce(string_agg(bloc, chr(10)||chr(10) order by pos, sec), '(aucun chantier ouvert)') from (select coalesce(s.position, 999) as pos, coalesce(s.nom, 'Sans section') as sec, '### ' || coalesce(s.nom, 'Sans section') || ' (' || count(*) || ')' || chr(10) || string_agg(format('- %s | %s | %s | %s%s%s', c.id, c.titre, c.etat, c.priorite, case when c.pris_par is not null and c.pris_jusqu_a > now() then ' | PRIS PAR ' || c.pris_par else '' end, case when coalesce(c.demande,'') <> '' then chr(10) || '    ' || left(replace(c.demande, chr(10), ' '), 200) else '' end), chr(10) order by case c.etat when 'en_cours' then 0 when 'a_verifier' then 1 when 'libre' then 2 when 'a_trier' then 3 when 'bloque' then 4 when 'a_cadrer' then 5 else 6 end, c.priorite = 'haute' desc, c.created_at) as bloc from chantiers c join projets p on p.id = c.projet_id left join sections s on s.id = c.section_id where p.slug = $P and c.archived_at is null group by s.position, s.nom) g")

attente=$(un "select coalesce(string_agg(format('- [%s] %s%s — %s (posée par %s, %s)%s', m.id, case m.kind when 'action' then 'IL DOIT LE FAIRE : ' else 'IL DOIT DÉCIDER : ' end, m.corps, coalesce(c.titre, 'général'), m.auteur, to_char(m.created_at, 'DD/MM HH24:MI'), case when m.options is not null then chr(10) || '    options : ' || (select string_agg(o->>'libelle', ' / ') from jsonb_array_elements(m.options) o) else '' end), chr(10) order by m.created_at), '(rien)') from messages m join projets p on p.id = m.projet_id left join chantiers c on c.id = m.chantier_id where p.slug = $P and m.kind in ('question','action') and m.answered_at is null")

reponses=$(un "select coalesce(string_agg(format('- %s | %s → « %s »%s (%s)', to_char(m.answered_at, 'DD/MM HH24:MI'), left(m.corps, 90), coalesce(m.reponse, m.etat, ''), case when coalesce(m.precision,'') <> '' then ' — précision : ' || m.precision else '' end, coalesce(c.titre, 'général')), chr(10) order by m.answered_at desc), '(aucune)') from (select * from messages where answered_at is not null order by answered_at desc limit 10) m join projets p on p.id = m.projet_id left join chantiers c on c.id = m.chantier_id where p.slug = $P")

constats=$(un "select coalesce(string_agg(format('- %s | %s | %s', to_char(m.created_at, 'DD/MM HH24:MI'), coalesce(c.titre,''), left(m.corps, 160)), chr(10) order by m.created_at desc), '(aucun)') from (select * from messages where kind = 'constat' order by created_at desc limit 8) m join projets p on p.id = m.projet_id left join chantiers c on c.id = m.chantier_id where p.slug = $P")

utilisateurs=$(un "select coalesce(string_agg(format('- %s | %s | %s%s', c.id, c.titre, c.etat, case when coalesce(c.demande,'') <> '' then chr(10) || '    ' || left(replace(c.demande, chr(10), ' '), 240) else '' end), chr(10) order by c.created_at), '(aucune)') from chantiers c join projets p on p.id = c.projet_id where p.slug = $P and c.origine = 'utilisateur' and c.archived_at is null and c.etat in ('a_trier','a_cadrer','libre')")

livres=$(un "select coalesce(string_agg(format('- %s | %s | %s', to_char(coalesce(c.valide_at, c.livre_at), 'DD/MM'), c.titre, case when c.etat = 'valide' then 'certifié' else 'à vérifier' end), chr(10) order by coalesce(c.valide_at, c.livre_at) desc), '(aucun)') from (select * from chantiers where etat in ('valide','a_verifier') order by coalesce(valide_at, livre_at) desc nulls last limit 8) c join projets p on p.id = c.projet_id where p.slug = $P")

activite=$(un "select coalesce(string_agg(format('- %s | %s | %s %% | %s | %s', a.session, coalesce(c.titre,''), a.pourcentage, a.etape, to_char(a.updated_at, 'DD/MM HH24:MI')), chr(10) order by a.updated_at desc), '(aucune)') from activite a join projets p on p.id = a.projet_id left join chantiers c on c.id = a.chantier_id where p.slug = $P and a.statut = 'en_cours' and a.updated_at > now() - interval '12 hours'")

emettre "$(cat <<FIN
# Cockpit — projet « $test » ($PROJET), état au démarrage de cette session

Lu dans la base centrale à l'instant. Avant toute proposition : réserve un chantier avec
\`$SQL_CMD "select reserver_chantier('<id>', '<ta branche>', 120)"\` (false = une autre
session l'a), signale ta progression avec \`$PROG_CMD\` à chaque étape et en
terminant (--termine → le chantier passe « à vérifier », seul un humain certifie), pose
une question avec \`$DEM_CMD\` (jamais dans un artefact), et écris où tu en es
dans le fil du chantier avant de t'arrêter.

## Chantiers ouverts, par section
$chantiers

## Ce qui attend une RÉPONSE humaine (ne repose pas ces questions, ne code pas ce qui en dépend)
$attente

## Dernières réponses humaines (à appliquer avec jugement)
$reponses

## Demandes des UTILISATEURS pas encore prises
$utilisateurs

## Constats récents (« ça marche » / « ça ne marche pas ») — ne casse pas ce qui marche
$constats

## Sessions actives (progression en direct)
$activite

## Derniers livrés
$livres
FIN
)"
