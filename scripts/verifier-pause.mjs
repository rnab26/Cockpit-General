// Interrupteur « Branché / En pause » (16 oct. 2026, migration 0093, chantier 975118ca).
//   node scripts/verifier-pause.mjs
// Deux parties :
//  A. LA BASE, dans une transaction ANNULÉE (la migration y est rejouée, les essais se font sur un projet jetable `test-pause-…` qui
//     disparaît avec l'annulation : rien n'est écrit sur un vrai projet, rien n'est appliqué ; marche avant ET après l'application
//     de la migration, qui est idempotente). Prouve : la garde est posée sur les six fonctions, la pause vide « prenables », « vérifs »,
//     le filet, le réveil, l'ouverture de renforts (automatique ET au bouton), rallumer remet tout, rejouer la migration ne change rien,
//     les droits (ni public ni anon ; admin ET session peuvent régler).
//  B. LES SCRIPTS (chef.sh, passe.sh) sur une base simulée : en pause ils répondent « RIEN … EN PAUSE » (prendre, passe, relève),
//     sinon ils continuent ; `chef.sh --pause oui|non` écrit par la fonction de la base.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
let ok = 0, ko = 0
const verifie = (nom, cond, detail = '') => { if (cond) { ok++; console.log('  ✓ ' + nom) } else { ko++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

console.log('A. la base (transaction annulée)')
const mig = readFileSync(join(RACINE, 'supabase/migrations/0093_projet_en_pause.sql'), 'utf8')
if (mig.includes('$mig$') || mig.includes('$t$')) throw new Error('la migration contient un délimiteur du banc')
const essai = `
do $t$
declare pid uuid; r jsonb := '{}'::jsonb; n int; v text; t0 timestamptz;
begin
  execute $mig$${mig}$mig$;
  insert into cockpit.projets (slug, nom, depot) values ('test-pause-' || substr(md5(random()::text), 1, 6), 'T', 'rnab26/test-pause') returning id into pid;
  insert into cockpit.chantiers (projet_id, titre, etat) values (pid, 'à faire', 'libre');
  insert into cockpit.chantiers (projet_id, titre, etat, verif_demandee_at) values (pid, 'à vérifier', 'a_verifier', now());
  -- les six fonctions portent la garde
  r := r || jsonb_build_object('gardees', (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'cockpit' and p.proname in ('chantiers_prenables','verifs_prenables','filet_attente','reveiller_chef','renforts_auto','demander_renforts')
          and pg_get_functiondef(p.oid) like '%garde pause 0093%'));
  select count(*) into n from cockpit.chantiers_prenables(pid);   r := r || jsonb_build_object('prenables_avant', n);
  select count(*) into n from cockpit.verifs_prenables(pid);       r := r || jsonb_build_object('verifs_avant', n);
  -- on met en pause par la fonction des réglages (le chemin réel de l'écran)
  r := r || jsonb_build_object('regler', cockpit.regler_pause_projet((select slug from cockpit.projets where id = pid), true, 'banc'));
  r := r || jsonb_build_object('colonnes', (select jsonb_build_object('en_pause', en_pause, 'raison', pause_raison, 'date', pause_at is not null) from cockpit.projets where id = pid));
  select count(*) into n from cockpit.chantiers_prenables(pid);   r := r || jsonb_build_object('prenables_pause', n);
  select count(*) into n from cockpit.verifs_prenables(pid);       r := r || jsonb_build_object('verifs_pause', n);
  r := r || jsonb_build_object('regle_pause', cockpit.projet_en_pause(pid), 'filet_pause', (cockpit.filet_attente(pid)->>'n')::int, 'reveil_pause', cockpit.reveiller_chef(pid));
  r := r || jsonb_build_object('renforts_auto_pause', cockpit.renforts_auto(pid)->>'raison');
  begin perform cockpit.demander_renforts((select slug from cockpit.projets where id = pid)); r := r || jsonb_build_object('demander_renforts_pause', 'accepté (anormal)');
  exception when others then r := r || jsonb_build_object('demander_renforts_pause', sqlerrm); end;
  -- les chantiers eux-mêmes ne sont ni supprimés ni modifiés
  r := r || jsonb_build_object('chantiers_intacts', (select count(*) from cockpit.chantiers where projet_id = pid and archived_at is null and etat in ('libre','a_verifier')));
  -- rallumer remet tout comme avant
  r := r || jsonb_build_object('rallume', cockpit.regler_pause_projet((select slug from cockpit.projets where id = pid), false, null));
  r := r || jsonb_build_object('colonnes_rallume', (select jsonb_build_object('en_pause', en_pause, 'raison', pause_raison, 'date', pause_at is not null) from cockpit.projets where id = pid));
  select count(*) into n from cockpit.chantiers_prenables(pid);   r := r || jsonb_build_object('prenables_rallume', n);
  select count(*) into n from cockpit.verifs_prenables(pid);       r := r || jsonb_build_object('verifs_rallume', n);
  r := r || jsonb_build_object('regle_rallume', cockpit.projet_en_pause(pid));
  begin perform cockpit.regler_pause_projet('projet-qui-n-existe-pas', true, null); exception when others then r := r || jsonb_build_object('inconnu', sqlerrm); end;
  -- droits
  r := r || jsonb_build_object('droits', jsonb_build_object(
    'regler_public', has_function_privilege('public', 'cockpit.regler_pause_projet(text,boolean,text)', 'execute'),
    'regler_anon', has_function_privilege('anon', 'cockpit.regler_pause_projet(text,boolean,text)', 'execute'),
    'regler_authenticated', has_function_privilege('authenticated', 'cockpit.regler_pause_projet(text,boolean,text)', 'execute'),
    'regler_service', has_function_privilege('service_role', 'cockpit.regler_pause_projet(text,boolean,text)', 'execute'),
    'regle_anon', has_function_privilege('anon', 'cockpit.projet_en_pause(uuid)', 'execute'),
    'regle_authenticated', has_function_privilege('authenticated', 'cockpit.projet_en_pause(uuid)', 'execute'),
    'garde_restee', exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'cockpit' and p.proname = '_garde_pause')));
  -- la migration rejouée ne change rien et n'échoue pas
  execute $mig$${mig}$mig$;
  r := r || jsonb_build_object('rejeu_gardees', (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'cockpit' and p.proname in ('chantiers_prenables','verifs_prenables','filet_attente','reveiller_chef','renforts_auto','demander_renforts')
          and pg_get_functiondef(p.oid) like '%garde pause 0093%'));
  raise exception 'RESULTAT %', r::text;
end $t$;`
const sortie = spawnSync(join(RACINE, 'scripts/sql.sh'), [], { input: essai, encoding: 'utf8' })
let res = null
try { const j = JSON.parse(sortie.stdout); const m = /RESULTAT (\{.*\})/s.exec(j.error || ''); if (m) res = JSON.parse(m[1]); else console.log('  réponse inattendue :', (j.error || '').slice(0, 300)) } catch { console.log('  sortie illisible :', (sortie.stdout + sortie.stderr).slice(0, 300)) }
if (!res) verifie('la partie base a rendu un résultat', false)
if (res) {
  verifie('la garde est posée sur les six fonctions', res.gardees === 6, res.gardees)
  verifie('avant la pause : 1 chantier prenable, 1 vérification prenable', res.prenables_avant === 1 && res.verifs_avant === 1, JSON.stringify([res.prenables_avant, res.verifs_avant]))
  verifie('regler_pause_projet pose la pause, sa date et sa raison', res.regler?.en_pause === true && res.regler?.avant === false && res.colonnes?.en_pause === true && res.colonnes?.raison === 'banc' && res.colonnes?.date === true, JSON.stringify(res.colonnes))
  verifie('en pause : plus aucun chantier prenable', res.prenables_pause === 0, res.prenables_pause)
  verifie('en pause : plus aucune vérification prenable', res.verifs_pause === 0, res.verifs_pause)
  verifie('en pause : la règle le dit', res.regle_pause === true)
  verifie('en pause : le filet ne voit rien qui attende (donc ne réveille personne)', res.filet_pause === 0, res.filet_pause)
  verifie('en pause : aucun réveil immédiat', res.reveil_pause === 'projet_en_pause', res.reveil_pause)
  verifie('en pause : aucun renfort ouvert tout seul', res.renforts_auto_pause === 'projet_en_pause', res.renforts_auto_pause)
  verifie('en pause : le bouton « Lancer des renforts » refuse, avec une phrase claire', /Projet en pause : rallume-le/.test(res.demander_renforts_pause || ''), res.demander_renforts_pause)
  verifie('rien n’est supprimé ni modifié par la pause', res.chantiers_intacts === 2, res.chantiers_intacts)
  verifie('rallumer : la pause, sa date et sa raison s’effacent', res.rallume?.en_pause === false && res.rallume?.avant === true && res.colonnes_rallume?.en_pause === false && res.colonnes_rallume?.raison === null && res.colonnes_rallume?.date === false, JSON.stringify(res.colonnes_rallume))
  verifie('rallumer : tout redevient prenable comme avant', res.prenables_rallume === 1 && res.verifs_rallume === 1 && res.regle_rallume === false, JSON.stringify([res.prenables_rallume, res.verifs_rallume]))
  verifie('un projet inconnu est refusé, nommé', /projet inconnu/.test(res.inconnu || ''), res.inconnu)
  verifie('droits : ni public ni anon ne règlent la pause', res.droits?.regler_public === false && res.droits?.regler_anon === false, JSON.stringify(res.droits))
  verifie('droits : l’admin connecté et les sessions la règlent', res.droits?.regler_authenticated === true && res.droits?.regler_service === true)
  verifie('droits : la règle brute n’est lisible ni par anon ni par un connecté (elle passe par les fonctions)', res.droits?.regle_anon === false && res.droits?.regle_authenticated === false)
  verifie('l’outil de pose de garde ne reste pas dans le schéma', res.droits?.garde_restee === false)
  verifie('rejouer la migration : toujours six gardes, aucune erreur', res.rejeu_gardees === 6, res.rejeu_gardees)
}
verifie('rien n’a été écrit : aucun projet « test-pause-… » ne reste', (() => {
  const r = execFileSync(join(RACINE, 'scripts/sql.sh'), ["select count(*) as n from projets where slug like 'test-pause-%'"], { encoding: 'utf8' })
  return JSON.parse(r).rows[0].n === 0
})())

console.log('B. les scripts, sur une base simulée')
const dossier = mkdtempSync(join(tmpdir(), 'verifier-pause-'))
try {
  const faux = join(dossier, 'sql.sh')
  // Base simulée : « en_pause » renvoie la valeur du fichier ; regler_pause_projet est notée ; tout le reste = aucune ligne.
  writeFileSync(faux, `#!/usr/bin/env bash
q="$1"
case "$q" in
  *"select en_pause as p"*) printf '{"ok":true,"rows":[{"p":%s}]}' "$(cat "${dossier}/pause" 2>/dev/null || echo false)" ;;
  *"regler_pause_projet"*) printf '%s\\n' "$q" >> "${dossier}/appels"; printf '{"ok":true,"rows":[{"r":{"en_pause":true}}]}' ;;
  *) printf '{"ok":true,"rows":[]}' ;;
esac
`)
  chmodSync(faux, 0o755)
  const lance = (script, args, pause) => {
    writeFileSync(join(dossier, 'pause'), pause ? 'true' : 'false')
    return spawnSync('bash', [join(RACINE, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, COCKPIT_SQL: faux, COCKPIT_PROJET: 'banc-pause', CLAUDE_CODE_SESSION_ID: 'session_banc', PATH: process.env.PATH } })
  }
  for (const [nom, args] of [['la passe (par défaut)', []], ['la prise de chef', ['--prendre']], ['la relève du réveil', ['--releve']], ['les consignes gardées', ['--consignes']]]) {
    const r = lance('chef.sh', args, true)
    verifie(`chef.sh, ${nom} : « RIEN — … EN PAUSE », aucun agent`, r.status === 0 && /^RIEN — le projet banc-pause est EN PAUSE/.test(r.stdout) && /ne lance aucun agent/.test(r.stdout), r.stdout.slice(0, 200) + r.stderr.slice(0, 200))
  }
  const hors = lance('chef.sh', [], false)
  verifie('chef.sh, projet branché : la phrase de pause n’apparaît pas', !/EN PAUSE/.test(hors.stdout), hors.stdout.slice(0, 200))
  const pa = lance('passe.sh', [], true)
  verifie('passe.sh, projet en pause : « RIEN — … EN PAUSE »', /^RIEN — le projet banc-pause est EN PAUSE/.test(pa.stdout), pa.stdout.slice(0, 200) + pa.stderr.slice(0, 200))
  const pb = lance('passe.sh', [], false)
  verifie('passe.sh, projet branché : la phrase de pause n’apparaît pas', !/EN PAUSE/.test(pb.stdout), pb.stdout.slice(0, 200))
  const on = lance('chef.sh', ['--pause', 'oui', 'le temps de la démo'], false)
  verifie('chef.sh --pause oui : écrit par la fonction de la base, avec la raison, et dit comment rallumer', on.status === 0 && /est EN PAUSE/.test(on.stdout) && /--pause non/.test(on.stdout) && /regler_pause_projet\('banc-pause', true, 'le temps de la démo'\)/.test(readFileSync(join(dossier, 'appels'), 'utf8')), on.stdout + on.stderr)
  const off = lance('chef.sh', ['--pause', 'non'], true)
  verifie('chef.sh --pause non : rallume', off.status === 0 && /de nouveau BRANCHÉ/.test(off.stdout), off.stdout + off.stderr)
  const mauvais = lance('chef.sh', ['--pause', 'peut-etre'], false)
  verifie('chef.sh --pause <autre chose> : refusé, aide donnée', mauvais.status === 2 && /--pause <oui\|non>/.test(mauvais.stderr), mauvais.stderr)
} finally { rmSync(dossier, { recursive: true, force: true }) }

console.log(`\nverifier-pause : ${ok}/${ok + ko}`)
process.exit(ko ? 1 : 0)
