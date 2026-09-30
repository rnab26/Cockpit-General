#!/usr/bin/env node
// Met en place les notifications push (migration 0037), UNE fois, sans rien
// afficher de secret :
//   1. génère la paire de clés VAPID (la privée ne quitte jamais ce script) ;
//   2. pose les secrets de la fonction cockpit-push (API de gestion Supabase) ;
//   3. range le secret trigger → fonction dans le coffre (vault) ;
//   4. écrit la clé PUBLIQUE et l'adresse de la fonction dans cockpit.push_config.
// Idempotent : déjà installé = rien ne change (régénérer les clés désabonnerait
// tous les appareils ; `--regenerer` le fait exprès).
// Prérequis : SUPABASE_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY (environnement cloud).
//   node scripts/installer-push.mjs [--regenerer]
// Puis : VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-push
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ici = dirname(fileURLToPath(import.meta.url))
const REF = process.env.SUPABASE_PROJECT_REF ?? 'bexiyvmdbxcwxasgslxp'
const jeton = process.env.SUPABASE_ACCESS_TOKEN
if (!jeton) { console.error('SUPABASE_ACCESS_TOKEN manquante.'); process.exit(2) }

const sql = (requete) => {
  const r = spawnSync(join(ici, 'sql.sh'), [], { input: requete, encoding: 'utf8', env: { ...process.env, COCKPIT_PROJET: process.env.COCKPIT_PROJET ?? 'cockpit' } })
  let j = {}
  try { j = JSON.parse(r.stdout) } catch { /* sortie illisible */ }
  if (r.status !== 0 || j.ok === false) throw new Error(`SQL refusé : ${j.error ?? r.stderr ?? r.stdout}`.slice(0, 300))
  return j.rows ?? []
}

const dejaConfigure = sql(`select 1 as ok from push_config where id = 1`).length > 0
  && sql(`select 1 as ok from vault.decrypted_secrets where name = 'cockpit_push_secret'`).length > 0
if (dejaConfigure && !process.argv.includes('--regenerer')) {
  console.log('Déjà installé (clé publique en base, secret dans le coffre). Rien à faire. --regenerer désabonne tous les appareils.')
  process.exit(0)
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = privateKey.export({ format: 'jwk' })
const b64u = (b) => Buffer.from(b).toString('base64url')
const vapidPublic = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]))
void publicKey
const vapidPrive = jwk.d
const pushSecret = randomBytes(32).toString('hex')

const rep = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'VAPID_PUBLIC_KEY', value: vapidPublic },
    { name: 'VAPID_PRIVATE_KEY', value: vapidPrive },
    { name: 'VAPID_SUBJECT', value: 'mailto:r.nabet26@gmail.com' },
    { name: 'PUSH_SECRET', value: pushSecret },
  ]),
})
if (!rep.ok) { console.error(`Secrets de la fonction refusés (HTTP ${rep.status}) : ${(await rep.text()).slice(0, 200)}`); process.exit(1) }

sql(`delete from vault.secrets where name = 'cockpit_push_secret';
select vault.create_secret('${pushSecret}', 'cockpit_push_secret', 'Secret partagé trigger → fonction cockpit-push (notifications push)');
insert into cockpit.push_config (id, vapid_public, url_fonction) values (1, '${vapidPublic}', 'https://${REF}.supabase.co/functions/v1/cockpit-push')
  on conflict (id) do update set vapid_public = excluded.vapid_public, url_fonction = excluded.url_fonction, updated_at = now();
${process.argv.includes('--regenerer') ? 'delete from cockpit.push_abonnements;' : ''}`)
console.log('Push installé : secrets de la fonction posés, coffre et push_config à jour. Reste : VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-push')
