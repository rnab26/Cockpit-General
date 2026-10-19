// L'autocontrôle (19 oct. 2026, migration 0105, chantier 7cecd1f3) : « le cockpit repère seul ce qui ne marche pas et te le dit ».
//   node scripts/verifier-incidents.mjs
// La base, dans une transaction ANNULÉE (la migration y est rejouée ; projet jetable `test-autoc-…` : rien n'est écrit sur un vrai projet,
// et la passe ne regarde un projet de test que si on le lui demande). Une table de cas, un cas par incident :
//   (1) rien n'attend : aucun incident ; (2) du travail attend sans routine de réveil, puis routine configurée sans réveil parti, puis réveil
//   automatique éteint = « à savoir » (jamais une panne) et geste « activer_session » ; (3) réveil REFUSÉ (réponse 401 gardée par pg_net) ;
//   (4) réveil parti et accepté mais personne n'a rien pris (le cas du 19 oct.) avec le lien de la session lancée, et un réveil tout récent
//   qu'on laisse arriver ; (5) la session qui devait travailler et se tait (voyant trompeur) ; (6) une session au travail : plus d'attente ;
//   (7) la résolution SEULE (une réponse arrive, l'incident se ferme sans clic) ; (8) la pause ; (9) une session lancée qui s'arrête en
//   erreur avec sa vraie raison ; (10) le nettoyage d'une demande restée sans suite (réglable, jamais de réveil, rien si 0 ou si une session
//   travaille) ; (11) cartes périmées non retirées ; (12) le délai se règle par projet ; (13) essai sans écriture ; (14) interrupteur
//   général ; (15) droits et rejeu de la migration.
import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTOCONTROLE_DEFAUT } from '../app/src/lib/incidents.ts'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
let ok = 0, ko = 0
const verifie = (nom, cond, detail = '') => { if (cond) { ok++; console.log('  ✓ ' + nom) } else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }
const mig = readFileSync(join(RACINE, 'supabase/migrations/0105_autocontrole.sql'), 'utf8')
if (mig.includes('$mig$') || mig.includes('$t$')) throw new Error('la migration contient un délimiteur du banc')

// Un état → la liste des incidents ouverts du projet, après une passe (p_test = vrai : c'est un projet de test).
const passe = (cle) => `
  perform cockpit.autocontrole_passe(slug, false, true);
  r := r || jsonb_build_object('${cle}', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'gravite', gravite, 'cause', cause, 'detail', detail, 'depuis', depuis) order by code)
                                                     from cockpit.incidents where projet_id = pid and etat = 'ouvert'), '[]'::jsonb));`
const msg = (min) => `insert into cockpit.messages (projet_id, auteur, auteur_type, kind, corps, created_at) values (pid, 'banc', 'proprietaire', 'info', 'Vas-y fais ça', now() - interval '${min} minutes');`

const essai = `
do $t$
declare pid uuid; slug text; r jsonb := '{}'::jsonb; cid uuid; e jsonb; n int; n0 int;
begin
  execute $mig$${mig}$mig$;
  slug := 'test-autoc-' || substr(md5(random()::text), 1, 6);
  insert into cockpit.projets (slug, nom, depot) values (slug, 'Banc', 'rnab26/test-autoc') returning id into pid;
  -- le réveil automatique est ALLUMÉ pour ce banc (en vrai, Raphaël l'a coupé le 19 oct. : c'est le cas « éteint » plus bas)
  update cockpit.filet_reglage set actif = true where id = 1;
  -- 1. rien n'attend
  ${passe('rien')}
  -- 2. du travail attend depuis 60 min, personne ne travaille, aucune routine de réveil
  ${msg(60)}
  ${passe('sans_routine')}
  insert into cockpit.reveils_immediats (projet_id, trigger_id, secret_id, actif) values (pid, 'trig_banc', gen_random_uuid(), true);
  ${passe('sans_reveil')}
  update cockpit.filet_reglage set actif = false where id = 1;
  ${passe('eteint')}
  update cockpit.filet_reglage set actif = true where id = 1;
  -- 3. un réveil est parti il y a 30 min et le service l'a REFUSÉ (réponse 401 gardée par pg_net)
  insert into net._http_response (id, status_code, content, created) values (9000001, 401, '{"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."}}', now() - interval '30 minutes');
  update cockpit.reveils_immediats set dernier_at = now() - interval '30 minutes', dernier_request = 9000001 where projet_id = pid;
  ${passe('refuse')}
  insert into net._http_response (id, status_code, content, created) values (9000004, 404, '{}', now());
  update cockpit.reveils_immediats set dernier_request = 9000004 where projet_id = pid;
  ${passe('refuse404')}
  -- 4. le réveil est accepté (200, session créée) mais personne n'a rien pris depuis 30 min
  insert into net._http_response (id, status_code, content, created) values (9000002, 200, '{"claude_code_session_id":"cse_banc","claude_code_session_url":"https://claude.ai/code/cse_banc","type":"routine_fire"}', now() - interval '30 minutes');
  update cockpit.reveils_immediats set dernier_request = 9000002 where projet_id = pid;
  ${passe('sans_effet')}
  -- … et un réveil tout récent (3 min) : on lui laisse sa chance
  update cockpit.reveils_immediats set dernier_at = now() - interval '3 minutes' where projet_id = pid;
  ${passe('recent')}
  update cockpit.reveils_immediats set dernier_at = now() - interval '30 minutes' where projet_id = pid;
  -- 5. une session ouverte qui devait travailler (tour en cours) mais se tait depuis 30 min : « sans nouvelles », pas « au travail »
  insert into cockpit.sessions (id, projet_id, demarre_at, vu_at, tour_en_cours) values ('banc-muette', pid, now() - interval '3 hours', now() - interval '30 minutes', true);
  r := r || jsonb_build_object('etat_muette', (select cockpit.etat_session(s) from cockpit.sessions s where id = 'banc-muette'));
  ${passe('muette')}
  -- 6. elle redonne signe : au travail → plus aucune attente, plus de « sans nouvelles »
  update cockpit.sessions set vu_at = now() - interval '1 minute' where id = 'banc-muette';
  ${passe('au_travail')}
  update cockpit.sessions set vu_at = now() - interval '30 minutes', fin_at = now() where id = 'banc-muette';
  -- 7. une réponse de Claude arrive : l'incident se résout SEUL
  ${passe('avant_reponse')}
  insert into cockpit.messages (projet_id, auteur, auteur_type, kind, corps) values (pid, 'claude', 'session', 'info', 'Fait.');
  ${passe('apres_reponse')}
  r := r || jsonb_build_object('resolus', (select jsonb_agg(code order by code) from cockpit.incidents where projet_id = pid and etat = 'resolu' and resolu_at is not null));
  -- 8. la pause : rien à signaler sur un projet en pause, ce qui était ouvert se ferme
  delete from cockpit.messages where projet_id = pid;
  ${msg(60)}
  ${passe('avant_pause')}
  update cockpit.projets set en_pause = true where id = pid;
  ${passe('en_pause')}
  update cockpit.projets set en_pause = false where id = pid;
  -- 9. une session lancée s'est arrêtée avec une erreur et du travail reste (une session « pris » sur un chantier)
  insert into cockpit.chantiers (projet_id, titre, etat, pris_par, pris_jusqu_a) values (pid, 'Banc', 'en_cours', 'banc-r/1', now() + interval '1 hour') returning id into cid;
  insert into cockpit.renforts (projet_id, prefixe, statut, erreur, erreur_at, created_at) values (pid, 'banc-r', 'erreur', 'Session arrêtée sans avoir fini : il reste 1 chantier(s) dans la section, à reprendre.', now() - interval '20 minutes', now() - interval '2 hours');
  ${passe('renfort_erreur')}
  update cockpit.renforts set erreur_at = now() - interval '7 hours' where projet_id = pid;
  ${passe('renfort_erreur_vieux')}
  delete from cockpit.renforts where projet_id = pid;
  -- 10. le nettoyage : une demande restée « demande » depuis 2 h, aucune session, du travail qui reste → erreur lisible ; jamais de réveil
  update cockpit.reveils_immediats set dernier_at = now() - interval '30 minutes' where projet_id = pid;
  insert into cockpit.renforts (projet_id, prefixe, statut, created_at) values (pid, 'banc-r', 'demande', now() - interval '2 hours');
  update cockpit.projets set autocontrole_nettoyage_min = 0 where id = pid;
  perform cockpit.autocontrole_passe(slug, false, true);
  r := r || jsonb_build_object('net_zero', (select statut from cockpit.renforts where projet_id = pid));
  update cockpit.projets set autocontrole_nettoyage_min = 180 where id = pid;
  perform cockpit.autocontrole_passe(slug, false, true);
  r := r || jsonb_build_object('net_180', (select statut from cockpit.renforts where projet_id = pid));
  update cockpit.projets set autocontrole_nettoyage_min = 60 where id = pid;
  e := cockpit.autocontrole_passe(slug, true, true);
  r := r || jsonb_build_object('net_essai', (select statut from cockpit.renforts where projet_id = pid), 'net_essai_n', e #>> '{projets,0,nettoyes}');
  insert into cockpit.sessions (id, projet_id, demarre_at, vu_at) values ('banc-vive', pid, now() - interval '1 minute', now());
  perform cockpit.autocontrole_passe(slug, false, true);
  r := r || jsonb_build_object('net_session', (select statut from cockpit.renforts where projet_id = pid));
  delete from cockpit.sessions where id = 'banc-vive';
  n0 := (select count(*) from net.http_request_queue);
  perform cockpit.autocontrole_passe(slug, false, true);
  r := r || jsonb_build_object('net_statut', (select statut from cockpit.renforts where projet_id = pid), 'net_erreur', (select erreur from cockpit.renforts where projet_id = pid),
                               'aucun_reveil', (select count(*) from net.http_request_queue) = n0 and (select dernier_at from cockpit.reveils_immediats where projet_id = pid) < now() - interval '20 minutes');
  ${passe('apres_net')}
  delete from cockpit.renforts where projet_id = pid; delete from cockpit.chantiers where id = cid;
  -- sans travail restant, la même demande se ferme « fini » (pas une erreur)
  insert into cockpit.renforts (projet_id, prefixe, statut, created_at) values (pid, 'banc-s', 'demande', now() - interval '2 hours');
  perform cockpit.autocontrole_passe(slug, false, true);
  r := r || jsonb_build_object('net_fini', (select statut from cockpit.renforts where projet_id = pid));
  delete from cockpit.renforts where projet_id = pid;
  -- 11. une carte périmée que la passe d'épuration n'a pas retirée (l'état est fabriqué : sa dernière passe est « en panne »)
  delete from cockpit.messages where projet_id = pid;
  insert into cockpit.messages (projet_id, auteur, auteur_type, kind, corps, created_at) values (pid, 'claude', 'session', 'question', 'Tu veux A ou B ?', now() - interval '5 days');
  insert into cockpit.activite (projet_id, session, etape, statut, updated_at) values (pid, 'banc', 'livré', 'termine', now() - interval '1 day');
  insert into cockpit.messages (projet_id, auteur, auteur_type, kind, corps, created_at) values (pid, 'raphael', 'proprietaire', 'info', 'Vas-y', now() - interval '2 days');
  r := r || jsonb_build_object('carte_depassee', (select cockpit.carte_depassee(m) from cockpit.messages m where m.projet_id = pid and m.kind = 'question'));
  ${passe('cartes')}
  update cockpit.projets set epuration_delai_h = 0 where id = pid;
  ${passe('cartes_eteint')}
  update cockpit.projets set epuration_delai_h = 24 where id = pid;
  -- 12. le délai se règle par projet : du travail qui attend depuis 60 min, alerte à 20 min (défaut) mais pas à 90
  delete from cockpit.messages where projet_id = pid; delete from cockpit.activite where projet_id = pid;
  ${msg(60)}
  update cockpit.reveils_immediats set dernier_at = null where projet_id = pid;
  ${passe('delai20')}
  perform cockpit.regler_autocontrole(slug, 90, 60, 6);
  ${passe('delai90')}
  perform cockpit.regler_autocontrole(slug, 20, 60, 6);
  begin perform cockpit.regler_autocontrole(slug, 2, 60, 6); r := r || jsonb_build_object('borne_delai', 'accepté'); exception when others then r := r || jsonb_build_object('borne_delai', 'refusé'); end;
  begin perform cockpit.regler_autocontrole(slug, 20, 5, 6); r := r || jsonb_build_object('borne_nettoyage', 'accepté'); exception when others then r := r || jsonb_build_object('borne_nettoyage', 'refusé'); end;
  begin perform cockpit.regler_autocontrole(slug, 20, 60, 0); r := r || jsonb_build_object('borne_garde', 'accepté'); exception when others then r := r || jsonb_build_object('borne_garde', 'refusé'); end;
  begin perform cockpit.regler_autocontrole('projet-inconnu-banc', 20, 60, 6); r := r || jsonb_build_object('projet_inconnu', 'accepté'); exception when others then r := r || jsonb_build_object('projet_inconnu', 'refusé'); end;
  -- 13. essai : dit ce qu'il ferait, n'écrit rien
  update cockpit.incidents set etat = 'resolu', resolu_at = now() where projet_id = pid;
  e := cockpit.autocontrole_passe(slug, true, true);
  r := r || jsonb_build_object('essai_dit', e #>> '{projets,0,incidents,0,code}', 'essai_ecrit', (select count(*) from cockpit.incidents where projet_id = pid and etat = 'ouvert'));
  -- et sans p_test, un projet de test n'est jamais regardé
  e := cockpit.autocontrole_passe(slug);
  r := r || jsonb_build_object('test_ignore', jsonb_array_length(e -> 'projets') = 0);
  -- 14. interrupteur général : éteint, la passe ne fait rien et ne rend aucun incident
  perform cockpit.regler_autocontrole(null, null, null, null, false);
  r := r || jsonb_build_object('general_eteint', cockpit.autocontrole_passe(slug, false, true) -> 'global', 'job_eteint', (select active from cron.job where jobname = 'cockpit-autocontrole'));
  perform cockpit.regler_autocontrole(null, null, null, null, true);
  r := r || jsonb_build_object('general_allume', cockpit.autocontrole_passe(slug, true, true) -> 'global', 'job_allume', (select active from cron.job where jobname = 'cockpit-autocontrole'),
                               'job_cadence', (select schedule from cron.job where jobname = 'cockpit-autocontrole'));
  -- 15. droits, défauts, temps réel, politique
  r := r || jsonb_build_object('droits', jsonb_build_object(
    'passe_public', has_function_privilege('public', 'cockpit.autocontrole_passe(text,boolean,boolean)', 'execute'),
    'passe_anon', has_function_privilege('anon', 'cockpit.autocontrole_passe(text,boolean,boolean)', 'execute'),
    'passe_auth', has_function_privilege('authenticated', 'cockpit.autocontrole_passe(text,boolean,boolean)', 'execute'),
    'passe_service', has_function_privilege('service_role', 'cockpit.autocontrole_passe(text,boolean,boolean)', 'execute'),
    'regler_public', has_function_privilege('public', 'cockpit.regler_autocontrole(text,integer,integer,integer,boolean)', 'execute'),
    'regler_anon', has_function_privilege('anon', 'cockpit.regler_autocontrole(text,integer,integer,integer,boolean)', 'execute'),
    'regler_auth', has_function_privilege('authenticated', 'cockpit.regler_autocontrole(text,integer,integer,integer,boolean)', 'execute'),
    'table_anon', has_table_privilege('anon', 'cockpit.incidents', 'select'),
    'table_auth_ecrire', has_table_privilege('authenticated', 'cockpit.incidents', 'insert')));
  r := r || jsonb_build_object('structure', jsonb_build_object(
    'rls', (select relrowsecurity from pg_class where oid = 'cockpit.incidents'::regclass),
    'replica_full', (select relreplident = 'f' from pg_class where oid = 'cockpit.incidents'::regclass),
    'temps_reel', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cockpit' and tablename = 'incidents'),
    'politique', exists (select 1 from pg_policies where schemaname = 'cockpit' and tablename = 'incidents' and policyname = 'admin_tout'),
    'defauts', (select jsonb_object_agg(column_name, column_default) from information_schema.columns where table_schema = 'cockpit' and table_name = 'projets' and column_name like 'autocontrole_%')));
  begin insert into cockpit.incidents (projet_id, code, cause) values (pid, 'code_invente', 'x'); r := r || jsonb_build_object('liste_fermee', 'acceptée'); exception when others then r := r || jsonb_build_object('liste_fermee', 'refusée'); end;
  -- 16. rejeu de la migration : rien ne casse, rien ne se duplique
  execute $mig$${mig}$mig$;
  r := r || jsonb_build_object('rejeu_jobs', (select count(*) from cron.job where jobname = 'cockpit-autocontrole'));
  raise exception 'RESULTAT %', r::text;
end $t$;`

const env = { ...process.env, COCKPIT_PROJET: process.env.COCKPIT_PROJET || 'cockpit' }
const sortie = spawnSync(join(RACINE, 'scripts/sql.sh'), [], { input: essai, encoding: 'utf8', env })
let res = null
try { const j = JSON.parse(sortie.stdout); const m = /RESULTAT (\{.*\})/s.exec(j.error || ''); if (m) res = JSON.parse(m[1]); else console.log('  réponse inattendue :', (j.error || JSON.stringify(j)).slice(0, 900)) } catch { console.log('  sortie illisible :', (sortie.stdout || sortie.stderr || '').slice(0, 600)) }
if (!res) verifie('la partie base a rendu un résultat', false)
else {
  const codes = (k) => (res[k] ?? []).map((x) => x.code)
  const un = (k, code) => (res[k] ?? []).find((x) => x.code === code)
  console.log('1. rien n’attend')
  verifie('aucun incident quand rien n’attend', codes('rien').length === 0, JSON.stringify(res.rien))
  console.log('2. du travail attend sans que personne ne travaille (demandes qui attendent)')
  verifie('aucune routine de réveil : « attente_sans_reveil », sans geste (rien à activer)', codes('sans_routine').join() === 'attente_sans_reveil' && un('sans_routine', 'attente_sans_reveil').detail.geste === null, JSON.stringify(res.sans_routine))
  verifie('routine configurée, aucun réveil parti : « attente_sans_reveil » avec le geste « activer_session »', codes('sans_reveil').join() === 'attente_sans_reveil' && un('sans_reveil', 'attente_sans_reveil').detail.geste === 'activer_session', JSON.stringify(res.sans_reveil))
  verifie('le projet est dit « attend depuis » : depuis = l’ancienneté du travail qui attend (~60 min), pas l’heure de la passe', Math.abs(Date.now() - Date.parse(un('sans_reveil', 'attente_sans_reveil').depuis) - 60 * 60_000) < 5 * 60_000)
  verifie('réveil automatique ÉTEINT : « attente_reveil_eteint », gravité « info » (ton choix, jamais une panne)', codes('eteint').join() === 'attente_reveil_eteint' && un('eteint', 'attente_reveil_eteint').gravite === 'info' && /ton choix/.test(un('eteint', 'attente_reveil_eteint').cause), JSON.stringify(res.eteint))
  verifie('…et le code « attente_sans_reveil » s’est RÉSOLU seul quand la cause a changé (jamais deux à la fois)', codes('eteint').length === 1)
  console.log('3. un réveil refusé par le service')
  verifie('réponse 401 (« OAuth access token is invalid ») : « reveil_refuse », la clé est dite refusée', codes('refuse').join() === 'reveil_refuse' && /clé du réveil est refusée/.test(un('refuse', 'reveil_refuse').cause) && un('refuse', 'reveil_refuse').detail.code_http === 401, JSON.stringify(res.refuse))
  verifie('réponse 404 : « la routine du réveil n’existe plus »', codes('refuse404').join() === 'reveil_refuse' && /n’existe plus|n'existe plus/.test(un('refuse404', 'reveil_refuse').cause), JSON.stringify(res.refuse404))
  console.log('4. un réveil accepté mais personne n’a rien pris (le cas du 19 oct.)')
  verifie('réveil parti il y a 30 min (200), personne au travail : « reveil_sans_effet » avec le lien de la session lancée', codes('sans_effet').join() === 'reveil_sans_effet' && un('sans_effet', 'reveil_sans_effet').detail.session_url === 'https://claude.ai/code/cse_banc', JSON.stringify(res.sans_effet))
  verifie('un réveil de 3 min : on lui laisse sa chance (aucun incident)', codes('recent').length === 0, JSON.stringify(res.recent))
  console.log('5. le voyant « session ouverte » trompeur : une session qui devait travailler et se tait')
  verifie('session au tour en cours mais muette depuis 30 min : l’état est « sans_nouvelles » (jamais « au travail »)', res.etat_muette === 'sans_nouvelles', res.etat_muette)
  verifie('…l’incident « session_sans_nouvelles » est ouvert, et l’attente reste signalée', codes('muette').includes('session_sans_nouvelles') && codes('muette').includes('reveil_sans_effet'), JSON.stringify(codes('muette')))
  console.log('6. une session au travail')
  verifie('elle redonne signe : plus aucune attente ni « sans nouvelles » (quelqu’un travaille)', codes('au_travail').length === 0, JSON.stringify(res.au_travail))
  console.log('7. résolution SEULE (aucun clic)')
  verifie('avant la réponse : l’attente est signalée', codes('avant_reponse').length >= 1)
  verifie('Claude répond : l’incident se ferme tout seul', codes('apres_reponse').length === 0, JSON.stringify(res.apres_reponse))
  verifie('…il est gardé « résolu » avec son heure (historique), pas supprimé', (res.resolus ?? []).length >= 1)
  console.log('8. un projet en pause n’a aucun incident')
  verifie('du travail attend : signalé', codes('avant_pause').length >= 1, JSON.stringify(res.avant_pause))
  verifie('projet en pause : plus rien (et ce qui était ouvert se ferme)', codes('en_pause').length === 0, JSON.stringify(res.en_pause))
  console.log('9. une session lancée s’est arrêtée avec une erreur')
  verifie('la vraie raison est dite : « renfort_en_erreur »', codes('renfort_erreur').includes('renfort_en_erreur') && /Session arrêtée sans avoir fini/.test(un('renfort_erreur', 'renfort_en_erreur').cause), JSON.stringify(res.renfort_erreur))
  verifie('une erreur plus vieille que la durée gardée (6 h) n’est plus signalée', !codes('renfort_erreur_vieux').includes('renfort_en_erreur'), JSON.stringify(codes('renfort_erreur_vieux')))
  console.log('10. nettoyage sans risque (jamais de réveil)')
  verifie('réglé à 0 : une demande sans suite n’est jamais fermée', res.net_zero === 'demande', res.net_zero)
  verifie('réglé à 180 min : une demande de 2 h reste (rien en dur)', res.net_180 === 'demande', res.net_180)
  verifie('essai : dit qu’il en fermerait 1 mais n’écrit rien', res.net_essai === 'demande' && String(res.net_essai_n) === '1', JSON.stringify([res.net_essai, res.net_essai_n]))
  verifie('une session au travail : on ne ferme rien', res.net_session === 'demande', res.net_session)
  verifie('à 60 min, aucune session, du travail qui reste : « erreur » avec sa raison en mots simples', res.net_statut === 'erreur' && /Aucune session ne l’a prise en 60 min|Aucune session ne l'a prise en 60 min/.test(res.net_erreur || ''), JSON.stringify([res.net_statut, res.net_erreur]))
  verifie('…et AUCUN réveil n’est parti (dernier réveil inchangé, file d’envoi pg_net intacte)', res.aucun_reveil === true)
  verifie('sans travail restant, la même demande se ferme « fini » (pas une erreur)', res.net_fini === 'fini', res.net_fini)
  console.log('11. cartes périmées')
  verifie('la règle carte_depassee juge la carte dépassée (preuve du banc)', typeof res.carte_depassee === 'string' && res.carte_depassee.length > 0, JSON.stringify(res.carte_depassee))
  verifie('la passe d’épuration ne l’a pas retirée : « cartes_non_retirees »', codes('cartes').includes('cartes_non_retirees'), JSON.stringify(res.cartes))
  verifie('retrait automatique éteint pour ce projet (délai 0) : choix, pas une panne', !codes('cartes_eteint').includes('cartes_non_retirees'))
  console.log('12. réglages par projet')
  verifie('délai par défaut (20 min) : le travail qui attend depuis 60 min est signalé', codes('delai20').length === 1, JSON.stringify(res.delai20))
  verifie('délai réglé à 90 min : pas encore signalé (rien en dur)', codes('delai90').length === 0, JSON.stringify(res.delai90))
  verifie('bornes refusées par la base (délai 2, nettoyage 5, garde 0, projet inconnu)', res.borne_delai === 'refusé' && res.borne_nettoyage === 'refusé' && res.borne_garde === 'refusé' && res.projet_inconnu === 'refusé', JSON.stringify([res.borne_delai, res.borne_nettoyage, res.borne_garde, res.projet_inconnu]))
  console.log('13. essai et projets de test')
  verifie('essai : dit ce qu’il ferait, n’écrit rien', !!res.essai_dit && res.essai_ecrit === 0, JSON.stringify([res.essai_dit, res.essai_ecrit]))
  verifie('sans le drapeau « test », un projet jetable n’est jamais regardé', res.test_ignore === true)
  console.log('14. interrupteur général')
  verifie('éteint : la passe répond « global = faux » et le job pg_cron est coupé', res.general_eteint === false && res.job_eteint === false, JSON.stringify([res.general_eteint, res.job_eteint]))
  verifie('rallumé : la passe tourne, le job est actif, toutes les 5 min', res.general_allume === true && res.job_allume === true && res.job_cadence === '*/5 * * * *', JSON.stringify([res.general_allume, res.job_allume, res.job_cadence]))
  console.log('15. droits, structure, rejeu')
  const d = res.droits
  verifie('la passe est réservée au service (ni public, ni anon, ni connecté)', d.passe_service === true && !d.passe_public && !d.passe_anon && !d.passe_auth, JSON.stringify(d))
  verifie('régler : ni public ni anon ; l’admin connecté oui (la base revérifie qu’il est admin)', d.regler_auth === true && !d.regler_public && !d.regler_anon)
  verifie('la table : lisible seulement par un connecté (RLS admin), jamais écrite par l’écran, jamais lue en anonyme', d.table_anon === false && d.table_auth_ecrire === false)
  const s = res.structure
  verifie('RLS activée, politique admin_tout, replica identity full, temps réel', s.rls === true && s.politique === true && s.replica_full === true && s.temps_reel === true, JSON.stringify(s))
  verifie('défauts de la base = défauts de l’écran (20 / 60 / 6)', s.defauts.autocontrole_delai_min === String(AUTOCONTROLE_DEFAUT.delaiMin) && s.defauts.autocontrole_nettoyage_min === String(AUTOCONTROLE_DEFAUT.nettoyageMin) && s.defauts.autocontrole_garde_h === String(AUTOCONTROLE_DEFAUT.gardeH), JSON.stringify(s.defauts))
  verifie('liste de codes FERMÉE : un code inventé est refusé', res.liste_fermee === 'refusée')
  verifie('rejeu de la migration : un seul job pg_cron', res.rejeu_jobs === 1, res.rejeu_jobs)
}
verifie('rien n’a été écrit : aucun projet « test-autoc-… » ne reste', JSON.parse(execFileSync(join(RACINE, 'scripts/sql.sh'), ["select count(*) as n from projets where slug like 'test-autoc-%'"], { encoding: 'utf8', env })).rows[0].n === 0)
console.log(`\nverifier-incidents : ${ok}/${ok + ko}`)
process.exit(ko ? 1 : 0)
