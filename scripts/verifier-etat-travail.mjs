// « Travail réel » (19 oct. 2026, migration 0104, chantier a33cf882) : la règle UNIQUE `cockpit.etat_session` et le battement machine.
//   node --experimental-strip-types scripts/verifier-etat-travail.mjs
// La base, dans une transaction ANNULÉE (la migration y est rejouée ; projet jetable `test-travail-…` : rien n'est écrit sur un vrai projet).
// Prouve : (1) la table de cas partagée (app/scripts/cas-etat-travail.json) donne la MÊME réponse dans la base et dans l'écran (sessions.ts) ;
// (2) les défauts de l'écran sont ceux des colonnes ; (3) les seuils se règlent par projet (rien en dur) ; (4) signaler_machine : éteint par
// défaut, allumé il prouve un calcul au-delà du seuil seulement, session inconnue refusée ; (5) le voyant : ouvertes = au travail + en veille,
// activer_session ne réveille pas une session en veille mais remplace une session sans nouvelles ; (6) droits ; (7) rejeu de la migration.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGLAGES_TRAVAIL_DEFAUT } from '../app/src/lib/sessions.ts'
import { MACHINE_DEFAUT, erreurTravailReel } from '../app/src/lib/silence.ts'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
let ok = 0, ko = 0
const verifie = (nom, cond, detail = '') => { if (cond) { ok++; console.log('  ✓ ' + nom) } else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

const lire = (f) => readFileSync(join(RACINE, 'supabase/migrations', f), 'utf8')
const migs = [lire('0102_voyant_activer_session.sql'), lire('0103_sessions_au_travail.sql'), lire('0104_travail_reel.sql')]
if (migs.some((m) => m.includes('$mig$') || m.includes('$t$') || m.includes('$cas$'))) throw new Error('une migration contient un délimiteur du banc')
const table = JSON.parse(readFileSync(join(RACINE, 'app/scripts/cas-etat-travail.json'), 'utf8'))

const essai = `
do $t$
declare pid uuid; slug text; r jsonb := '{}'::jsonb; c jsonb; i int := 0; res jsonb := '[]'::jsonb; sid text; etat text; e jsonb; d jsonb;
begin
  ${migs.map((m) => `execute $mig$${m}$mig$;`).join('\n  ')}
  slug := 'test-travail-' || substr(md5(random()::text), 1, 6);
  insert into cockpit.projets (slug, nom, depot) values (slug, 'T', 'rnab26/test-travail') returning id into pid;
  -- 1. la table de cas, avec les réglages de la table posés sur le projet (ce sont aussi les défauts)
  update cockpit.projets set delai_sans_signe_min = ${table.reglages.repliMin}, tour_silence_min = ${table.reglages.tourMin}, fond_plafond_min = ${table.reglages.fondMin},
         reveil_ecart_min = ${table.reglages.ouvertureMin}, machine_fraicheur_min = ${table.reglages.machineMin} where id = pid;
  insert into cockpit.sessions (id, projet_id, demarre_at, vu_at, fin_at) values ('banc-autre', pid, now() - interval '9 hours', now() - interval '9 hours', now());
  for c in select * from jsonb_array_elements($cas$${JSON.stringify(table.cas)}$cas$::jsonb) loop
    i := i + 1; sid := 'banc-c' || i;
    insert into cockpit.sessions (id, projet_id, demarre_at, vu_at, tour_en_cours, fin_at, machine_actif_at)
    values (sid, pid, now() - make_interval(mins => (c->'s'->>'demarre')::int), now() - make_interval(mins => (c->'s'->>'vu')::int),
            coalesce((c->'s'->>'tour')::boolean, false),
            case when c->'s' ? 'fin' then now() - make_interval(mins => (c->'s'->>'fin')::int) end,
            case when c->'s' ? 'machine' then now() - make_interval(mins => (c->'s'->>'machine')::int) end);
    declare t jsonb; j int := 0; begin
      for t in select * from jsonb_array_elements(coalesce(c->'taches', '[]'::jsonb)) loop
        j := j + 1;
        insert into cockpit.taches (session_id, projet_id, tache_id, type, statut, vu_at, progres_at)
        values (case when t ? 'autre' then 'banc-autre' else sid end, pid, 'bt' || i || '-' || j, 'agent', coalesce(t->>'statut', 'en_cours'),
                now() - make_interval(mins => (t->>'vu')::int), case when t ? 'progres' then now() - make_interval(mins => (t->>'progres')::int) end);
      end loop;
    end;
    select cockpit.etat_session(s) into etat from cockpit.sessions s where s.id = sid;
    res := res || jsonb_build_array(etat);
  end loop;
  r := r || jsonb_build_object('cas', res);
  -- 2. les défauts des colonnes
  select jsonb_object_agg(column_name, column_default) into d from information_schema.columns
   where table_schema = 'cockpit' and table_name = 'projets' and column_name in ('delai_sans_signe_min','tour_silence_min','fond_plafond_min','reveil_ecart_min','machine_fraicheur_min','machine_seuil_pct','machine_pas_s','machine_actif');
  r := r || jsonb_build_object('defauts', d);
  -- 3. les seuils se règlent par projet : un tour de 20 min de battement est sans nouvelles à 12 min, au travail à 30
  delete from cockpit.taches where projet_id = pid; delete from cockpit.sessions where projet_id = pid;
  insert into cockpit.sessions (id, projet_id, demarre_at, vu_at, tour_en_cours) values ('banc-r', pid, now() - interval '5 hours', now() - interval '20 minutes', true);
  r := r || jsonb_build_object('tour12', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-r'));
  perform cockpit.regler_travail_reel(slug, 30, 120, false, 6, 5, 120);
  r := r || jsonb_build_object('tour30', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-r'));
  perform cockpit.regler_travail_reel(slug, 12, 120, false, 6, 5, 120);
  -- bornes refusées
  begin perform cockpit.regler_travail_reel(slug, 0, 120, false, 6, 5, 120); r := r || jsonb_build_object('borne_tour', 'accepté'); exception when others then r := r || jsonb_build_object('borne_tour', 'refusé'); end;
  begin perform cockpit.regler_travail_reel(slug, 12, 120, true, 2, 5, 120); r := r || jsonb_build_object('borne_machine', 'accepté'); exception when others then r := r || jsonb_build_object('borne_machine', 'refusé'); end;
  -- 4. signaler_machine : éteint par défaut
  r := r || jsonb_build_object('machine_eteint', cockpit.signaler_machine(slug, 'banc-r', 90, 2));
  r := r || jsonb_build_object('machine_eteint_rien', (select machine_vu_at is null and machine_actif_at is null from cockpit.sessions where id = 'banc-r'));
  perform cockpit.regler_travail_reel(slug, 12, 120, true, 6, 5, 120);
  delete from cockpit.sessions where id = 'banc-r';
  insert into cockpit.sessions (id, projet_id, demarre_at, vu_at) values ('banc-m', pid, now() - interval '5 hours', now() - interval '90 minutes');
  r := r || jsonb_build_object('m_avant', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-m'));
  e := cockpit.signaler_machine(slug, 'banc-m', 2, 3);
  r := r || jsonb_build_object('m_faible', e, 'm_faible_etat', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-m'));
  e := cockpit.signaler_machine(slug, 'banc-m', 80, 0);
  r := r || jsonb_build_object('m_sans_proc', e, 'm_sans_proc_etat', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-m'));
  e := cockpit.signaler_machine(slug, 'banc-m', 97, 2);
  r := r || jsonb_build_object('m_calcul', e, 'm_calcul_etat', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-m'),
                               'm_pct', (select machine_cpu_pct from cockpit.sessions where id = 'banc-m'), 'm_procs', (select machine_procs from cockpit.sessions where id = 'banc-m'));
  update cockpit.sessions set machine_actif_at = now() - interval '7 minutes' where id = 'banc-m';
  r := r || jsonb_build_object('m_perime', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-m'));
  r := r || jsonb_build_object('m_inconnue', cockpit.signaler_machine(slug, 'banc-nexiste-pas', 90, 2), 'm_projet_inconnu', cockpit.signaler_machine('projet-qui-n-existe-pas', 'banc-m', 90, 2));
  -- 5. le voyant : ouvertes = au travail + en veille ; activer_session
  update cockpit.sessions set machine_actif_at = null, vu_at = now() - interval '10 minutes' where id = 'banc-m';
  e := cockpit.etat_sessions(slug);
  r := r || jsonb_build_object('voyant_veille', e->'etats', 'voyant_vivantes', e->'vivantes', 'activer_veille', cockpit.activer_session(slug)->>'resultat');
  update cockpit.sessions set vu_at = now() - interval '40 minutes', demarre_at = now() - interval '40 minutes' where id = 'banc-m';
  e := cockpit.etat_sessions(slug);
  r := r || jsonb_build_object('voyant_muette', e->'etats', 'voyant_muette_vivantes', e->'vivantes', 'activer_muette', cockpit.activer_session(slug)->>'resultat');
  update cockpit.sessions set tour_en_cours = true, vu_at = now() - interval '1 minute' where id = 'banc-m';
  e := cockpit.etat_sessions(slug);
  r := r || jsonb_build_object('voyant_travail', e->'etats', 'activer_travail', cockpit.activer_session(slug)->>'resultat', 'au_travail_n', cockpit.sessions_au_travail(pid), 'ouvertes_n', cockpit.sessions_ouvertes(pid));
  -- 6. droits
  r := r || jsonb_build_object('droits', jsonb_build_object(
    'etat_session_public', has_function_privilege('public', 'cockpit.etat_session(cockpit.sessions)', 'execute'),
    'etat_session_anon', has_function_privilege('anon', 'cockpit.etat_session(cockpit.sessions)', 'execute'),
    'machine_public', has_function_privilege('public', 'cockpit.signaler_machine(text,text,integer,integer)', 'execute'),
    'machine_anon', has_function_privilege('anon', 'cockpit.signaler_machine(text,text,integer,integer)', 'execute'),
    'machine_auth', has_function_privilege('authenticated', 'cockpit.signaler_machine(text,text,integer,integer)', 'execute'),
    'machine_service', has_function_privilege('service_role', 'cockpit.signaler_machine(text,text,integer,integer)', 'execute'),
    'regler_public', has_function_privilege('public', 'cockpit.regler_travail_reel(text,integer,integer,boolean,integer,integer,integer)', 'execute'),
    'regler_anon', has_function_privilege('anon', 'cockpit.regler_travail_reel(text,integer,integer,boolean,integer,integer,integer)', 'execute'),
    'regler_auth', has_function_privilege('authenticated', 'cockpit.regler_travail_reel(text,integer,integer,boolean,integer,integer,integer)', 'execute')));
  -- 7. rejeu des migrations
  ${migs.slice(2).map((m) => `execute $mig$${m}$mig$;`).join('\n  ')}
  r := r || jsonb_build_object('rejeu_vivantes', (select count(*) from regexp_matches(pg_get_functiondef('cockpit.etat_sessions(text)'::regprocedure), 'sessions_ouvertes', 'g')),
    'rejeu_activer', (select count(*) from regexp_matches(pg_get_functiondef('cockpit.activer_session(text)'::regprocedure), 'sessions_ouvertes', 'g')));
  raise exception 'RESULTAT %', r::text;
end $t$;`
const sortie = spawnSync(join(RACINE, 'scripts/sql.sh'), [], { input: essai, encoding: 'utf8', env: { ...process.env, COCKPIT_PROJET: process.env.COCKPIT_PROJET || 'cockpit' } })
let res = null
try { const j = JSON.parse(sortie.stdout); const m = /RESULTAT (\{.*\})/s.exec(j.error || ''); if (m) res = JSON.parse(m[1]); else console.log('  réponse inattendue :', (j.error || '').slice(0, 600)) } catch { console.log('  sortie illisible :', (sortie.stdout || '').slice(0, 300), (sortie.stderr || '').slice(0, 200)) }
if (!res) verifie('la partie base a rendu un résultat', false)
else {
  // 1
  table.cas.forEach((c, i) => verifie(`base : ${c.nom} → ${c.attendu}`, res.cas[i] === c.attendu, res.cas[i]))
  // 2
  verifie('les défauts de l’écran sont ceux des colonnes de la base',
    res.defauts.delai_sans_signe_min === String(REGLAGES_TRAVAIL_DEFAUT.repliMin) && res.defauts.tour_silence_min === String(REGLAGES_TRAVAIL_DEFAUT.tourMin)
    && res.defauts.fond_plafond_min === String(REGLAGES_TRAVAIL_DEFAUT.fondMin) && res.defauts.reveil_ecart_min === String(REGLAGES_TRAVAIL_DEFAUT.ouvertureMin)
    && res.defauts.machine_fraicheur_min === String(REGLAGES_TRAVAIL_DEFAUT.machineMin) && res.defauts.machine_seuil_pct === String(MACHINE_DEFAUT.seuilPct)
    && res.defauts.machine_pas_s === String(MACHINE_DEFAUT.pasS) && res.defauts.machine_actif === 'false', JSON.stringify(res.defauts))
  // 3
  verifie('réglage : un tour de 20 min de battement est « sans nouvelles » à 12 min', res.tour12 === 'sans_nouvelles', res.tour12)
  verifie('…et « au travail » quand le projet règle 30 min (rien n’est en dur)', res.tour30 === 'au_travail', res.tour30)
  verifie('bornes refusées par la base (tour 0, calcul récent plus court que deux mesures)', res.borne_tour === 'refusé' && res.borne_machine === 'refusé', JSON.stringify([res.borne_tour, res.borne_machine]))
  verifie('l’écran refuse les mêmes valeurs (même règle des deux côtés)', erreurTravailReel({ tourMin: 0, fondMin: 120, machineMin: 6, seuilPct: 5, pasS: 120 }) !== null && erreurTravailReel({ tourMin: 12, fondMin: 120, machineMin: 2, seuilPct: 5, pasS: 120 }) !== null
    && erreurTravailReel({ tourMin: 12, fondMin: 120, machineMin: 6, seuilPct: 5, pasS: 120 }) === null)
  // 4
  verifie('battement machine ÉTEINT par défaut : la base répond « eteint » et n’écrit rien', res.machine_eteint?.etat === 'eteint' && res.machine_eteint_rien === true, JSON.stringify(res.machine_eteint))
  verifie('allumé : une session muette depuis 90 min est « absente » tant qu’aucun calcul n’est mesuré', res.m_avant === 'absente', res.m_avant)
  verifie('…un calcul sous le seuil (2 %) ne prouve rien', res.m_faible?.etat === 'ok' && res.m_faible?.pas_s === MACHINE_DEFAUT.pasS && res.m_faible_etat === 'absente', JSON.stringify([res.m_faible, res.m_faible_etat]))
  verifie('…ni un taux élevé sans aucun processus (0 processus)', res.m_sans_proc_etat === 'absente', res.m_sans_proc_etat)
  verifie('…un calcul réel (97 %, 2 processus) la rend « au travail » alors qu’elle est muette', res.m_calcul?.etat === 'ok' && res.m_calcul_etat === 'au_travail' && res.m_pct === 97 && res.m_procs === 2, JSON.stringify([res.m_calcul, res.m_calcul_etat, res.m_pct, res.m_procs]))
  verifie('…et la preuve expire (mesure d’il y a 7 min, limite 6) : elle redevient « absente »', res.m_perime === 'absente', res.m_perime)
  verifie('session ou projet inconnus : refusés sans erreur', res.m_inconnue?.etat === 'session_inconnue' && res.m_projet_inconnu?.etat === 'inconnu', JSON.stringify([res.m_inconnue, res.m_projet_inconnu]))
  // 5
  verifie('voyant : une session ouverte qui attend est « en veille », comptée ouverte, et activer ne réveille pas',
    res.voyant_veille?.en_veille === 1 && res.voyant_veille?.au_travail === 0 && res.voyant_vivantes === 1 && res.activer_veille === 'session_vivante', JSON.stringify([res.voyant_veille, res.voyant_vivantes, res.activer_veille]))
  verifie('voyant : une session ouverte il y a 40 min qui n’a jamais donné de signe est « sans nouvelles », pas ouverte, et activer la remplace',
    res.voyant_muette?.sans_nouvelles === 1 && res.voyant_muette_vivantes === 0 && res.activer_muette !== 'session_vivante', JSON.stringify([res.voyant_muette, res.voyant_muette_vivantes, res.activer_muette]))
  verifie('voyant : un tour en cours = « au travail » ; sessions_au_travail compte le travail, sessions_ouvertes compte les ouvertes',
    res.voyant_travail?.au_travail === 1 && res.activer_travail === 'session_vivante' && res.au_travail_n === 1 && res.ouvertes_n === 1, JSON.stringify([res.voyant_travail, res.activer_travail, res.au_travail_n, res.ouvertes_n]))
  // 6
  const d = res.droits
  verifie('droits : etat_session et regler_travail_reel ni public ni anon', d.etat_session_public === false && d.etat_session_anon === false && d.regler_public === false && d.regler_anon === false, JSON.stringify(d))
  verifie('droits : signaler_machine réservé aux sessions (service), ni public, ni anon, ni connecté', d.machine_service === true && d.machine_public === false && d.machine_anon === false && d.machine_auth === false, JSON.stringify(d))
  verifie('droits : l’admin connecté règle les seuils (la fonction vérifie elle-même)', d.regler_auth === true)
  // 7
  verifie('rejeu de 0104 : les deux lecteurs ne sont remplacés qu’une fois', res.rejeu_vivantes === 1 && res.rejeu_activer === 1, JSON.stringify([res.rejeu_vivantes, res.rejeu_activer]))
}
verifie('rien n’a été écrit : aucun projet « test-travail-… » ne reste', JSON.parse(execFileSync(join(RACINE, 'scripts/sql.sh'), ["select count(*) as n from projets where slug like 'test-travail-%'"], { encoding: 'utf8', env: { ...process.env, COCKPIT_PROJET: process.env.COCKPIT_PROJET || 'cockpit' } })).rows[0].n === 0)
console.log(`\nverifier-etat-travail : ${ok}/${ok + ko}`)
process.exit(ko ? 1 : 0)
