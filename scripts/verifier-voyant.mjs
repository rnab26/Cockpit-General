// Voyant des sessions + « Activer une session » (19 oct. 2026, migration 0102, chantier cb3d17df).
//   node scripts/verifier-voyant.mjs
// La base, dans une transaction ANNULÉE (la migration y est rejouée ; projet jetable `test-voyant-…` qui disparaît avec
// l'annulation : rien n'est écrit sur un vrai projet, aucun vrai réveil n'est tiré). Prouve : etat_sessions compte les sessions
// vivantes avec la règle delai_signe et les messages qui attendent ; activer_session ne réveille pas quand une session vit, réveille
// (ou dit pourquoi) même SANS chantier prenable, refuse en pause, ne tire pas deux fois (réveil récent) ; droits ; rejeu.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
let ok = 0, ko = 0
const verifie = (nom, cond, detail = '') => { if (cond) { ok++; console.log('  ✓ ' + nom) } else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

const mig = readFileSync(join(RACINE, 'supabase/migrations/0102_voyant_activer_session.sql'), 'utf8')
if (mig.includes('$mig$') || mig.includes('$t$')) throw new Error('la migration contient un délimiteur du banc')
const essai = `
do $t$
declare pid uuid; slug text; r jsonb := '{}'::jsonb; e jsonb;
begin
  execute $mig$${mig}$mig$;
  slug := 'test-voyant-' || substr(md5(random()::text), 1, 6);
  insert into cockpit.projets (slug, nom, depot) values (slug, 'T', 'rnab26/test-voyant') returning id into pid;
  -- 1. projet vide : aucune session, rien n'attend
  e := cockpit.etat_sessions(slug);
  r := r || jsonb_build_object('vide', e);
  r := r || jsonb_build_object('inconnu_etat', cockpit.etat_sessions('projet-qui-n-existe-pas'));
  -- 2. activer sans RIEN à servir : la raison 'activer' n'est jamais « rien à servir » ; ici la routine n'est pas configurée
  r := r || jsonb_build_object('rien_a_servir', cockpit.rien_a_servir(pid, 'activer'), 'sans_rien', cockpit.activer_session(slug));
  -- 3. un message de Raphaël attend une réponse
  insert into cockpit.messages (projet_id, auteur, auteur_type, kind, corps) values (pid, 'Raphaël', 'proprietaire', 'info', 'une question sans réponse');
  r := r || jsonb_build_object('avec_message', cockpit.etat_sessions(slug)->'messages', 'avec_message_activer', cockpit.activer_session(slug)->>'resultat');
  -- 4. un réveil vient de partir : on ne tire pas deux fois
  insert into cockpit.reveils_immediats (projet_id, trigger_id, secret_id, actif, dernier_at) values (pid, 'trig_banc', gen_random_uuid(), true, now());
  r := r || jsonb_build_object('trop_tot', cockpit.activer_session(slug)->>'resultat', 'etat_reveil', cockpit.etat_sessions(slug)->'reveil_possible');
  -- 5. une session vivante : le voyant la compte, on ne réveille pas
  insert into cockpit.sessions (id, projet_id, vu_at) values ('banc-vivante', pid, now());
  insert into cockpit.sessions (id, projet_id, vu_at) values ('banc-ancienne', pid, now() - interval '90 minutes');
  insert into cockpit.sessions (id, projet_id, vu_at, fin_at) values ('banc-finie', pid, now(), now());
  r := r || jsonb_build_object('vivantes', cockpit.etat_sessions(slug)->'vivantes', 'avec_session', cockpit.activer_session(slug)->>'resultat');
  -- 6. la règle suit delai_signe (réglage du projet)
  update cockpit.projets set delai_sans_signe_min = 120 where id = pid;
  r := r || jsonb_build_object('vivantes_120', cockpit.etat_sessions(slug)->'vivantes');
  update cockpit.projets set delai_sans_signe_min = 60 where id = pid;
  -- 7. pause : voyant « en pause », aucun réveil
  perform cockpit.regler_pause_projet(slug, true, 'banc');
  update cockpit.sessions set fin_at = now() where projet_id = pid;
  r := r || jsonb_build_object('pause_etat', cockpit.etat_sessions(slug)->'en_pause', 'pause_activer', cockpit.activer_session(slug)->>'resultat');
  perform cockpit.regler_pause_projet(slug, false, null);
  -- 8. le texte du réveil et les droits
  r := r || jsonb_build_object('texte', pg_get_functiondef('cockpit.reveiller_chef(uuid,uuid,text)'::regprocedure) like '%p_raison = ''activer''%',
    'droits', jsonb_build_object(
      'etat_public', has_function_privilege('public', 'cockpit.etat_sessions(text)', 'execute'),
      'etat_anon', has_function_privilege('anon', 'cockpit.etat_sessions(text)', 'execute'),
      'etat_auth', has_function_privilege('authenticated', 'cockpit.etat_sessions(text)', 'execute'),
      'activer_public', has_function_privilege('public', 'cockpit.activer_session(text)', 'execute'),
      'activer_anon', has_function_privilege('anon', 'cockpit.activer_session(text)', 'execute'),
      'activer_auth', has_function_privilege('authenticated', 'cockpit.activer_session(text)', 'execute')));
  execute $mig$${mig}$mig$;   -- rejeu
  r := r || jsonb_build_object('rejeu_texte', (select count(*) from regexp_matches(pg_get_functiondef('cockpit.reveiller_chef(uuid,uuid,text)'::regprocedure), 'p_raison = ''activer''', 'g')));
  raise exception 'RESULTAT %', r::text;
end $t$;`
const sortie = spawnSync(join(RACINE, 'scripts/sql.sh'), [], { input: essai, encoding: 'utf8' })
let res = null
try { const j = JSON.parse(sortie.stdout); const m = /RESULTAT (\{.*\})/s.exec(j.error || ''); if (m) res = JSON.parse(m[1]); else console.log('  réponse inattendue :', (j.error || '').slice(0, 400)) } catch { console.log('  sortie illisible :', (sortie.stdout || '').slice(0, 300), (sortie.stderr || '').slice(0, 200)) }
if (!res) verifie('la partie base a rendu un résultat', false)
else {
  verifie('projet vide : 0 session vivante, 0 message, pas en pause', res.vide?.vivantes === 0 && res.vide?.messages === 0 && res.vide?.en_pause === false && res.vide?.chef === false, JSON.stringify(res.vide))
  verifie('projet inconnu : null (l’écran ne le compte pas)', res.inconnu_etat === null)
  verifie('« activer » n’est jamais « rien à servir » (même sans chantier prenable)', res.rien_a_servir === false)
  verifie('activer sans rien en attente : pas de refus « rien à servir » (ici : routine non configurée, dit)', res.sans_rien?.resultat === 'pas_configure', JSON.stringify(res.sans_rien))
  verifie('un message de Raphaël sans réponse est compté', res.avec_message === 1, res.avec_message)
  verifie('activer avec un message en attente et sans chantier : la demande va jusqu’à la routine', res.avec_message_activer === 'pas_configure', res.avec_message_activer)
  verifie('réveil parti il y a moins de 5 min : « déjà demandé », aucun second tir', res.trop_tot === 'deja_demande', res.trop_tot)
  verifie('etat_sessions dit que le réveil est possible', res.etat_reveil === true)
  verifie('le voyant compte seulement les sessions vues récemment et non finies', res.vivantes === 1, res.vivantes)
  verifie('session vivante : activer ne réveille pas', res.avec_session === 'session_vivante', res.avec_session)
  verifie('la règle suit delai_signe : à 120 min la session de 90 min est vivante', res.vivantes_120 === 2, res.vivantes_120)
  verifie('en pause : voyant « en pause » et aucun réveil', res.pause_etat === true && res.pause_activer === 'projet_en_pause', JSON.stringify([res.pause_etat, res.pause_activer]))
  verifie('le texte du réveil « activer » est posé', res.texte === true)
  verifie('droits : ni public ni anon', res.droits?.etat_public === false && res.droits?.etat_anon === false && res.droits?.activer_public === false && res.droits?.activer_anon === false, JSON.stringify(res.droits))
  verifie('droits : l’admin connecté les appelle (la fonction vérifie elle-même est_admin)', res.droits?.etat_auth === true && res.droits?.activer_auth === true)
  verifie('rejeu de la migration : le texte n’est posé qu’une fois', res.rejeu_texte === 1, res.rejeu_texte)
}
verifie('rien n’a été écrit : aucun projet « test-voyant-… » ne reste', JSON.parse(execFileSync(join(RACINE, 'scripts/sql.sh'), ["select count(*) as n from projets where slug like 'test-voyant-%'"], { encoding: 'utf8' })).rows[0].n === 0)
console.log(`\nverifier-voyant : ${ok}/${ok + ko}`)
process.exit(ko ? 1 : 0)
