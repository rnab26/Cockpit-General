#!/usr/bin/env node
// Notifications push (migration 0039) : la fonction déployée refuse sans secret,
// lit une vraie réponse de Claude, et — avec un faux abonnement (endpoint bidon
// chez FCM, clés valides) — chiffre et tente l'envoi puis retire l'abonnement mort.
// N'envoie JAMAIS de notification à un vrai appareil : l'essai d'envoi ne tourne
// que s'il n'existe aucun autre abonnement. Le faux abonnement est supprimé à la fin.
//   node scripts/verifier-push.mjs
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ici = dirname(fileURLToPath(import.meta.url))
const REF = process.env.SUPABASE_PROJECT_REF ?? 'bexiyvmdbxcwxasgslxp'
const URL_FN = `https://${REF}.supabase.co/functions/v1/cockpit-push`
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`) } }
const sql = (q) => {
  const r = spawnSync(join(ici, 'sql.sh'), [], { input: q, encoding: 'utf8', env: { ...process.env, COCKPIT_PROJET: process.env.COCKPIT_PROJET ?? 'cockpit' } })
  const j = JSON.parse(r.stdout || '{}')
  if (j.ok === false) throw new Error(j.error)
  return j.rows ?? []
}
const appeler = async (secret, corps) => {
  const r = await fetch(URL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-push-secret': secret } : {}) }, body: JSON.stringify(corps) })
  let j = {}
  try { j = await r.json() } catch { /* pas du JSON */ }
  return { status: r.status, j }
}

console.log('notifications push')
const cfg = sql('select vapid_public, url_fonction from push_config where id = 1')[0]
verifie('push_config posée (clé publique VAPID de 87 caractères)', cfg?.vapid_public?.length === 87 && cfg.url_fonction === URL_FN, cfg)
const secret = sql(`select decrypted_secret as s from vault.decrypted_secrets where name = 'cockpit_push_secret'`)[0]?.s
verifie('secret trigger → fonction dans le coffre', !!secret)
verifie('trigger posé sur messages', sql(`select 1 as ok from pg_trigger where tgname = 'push_sur_reponse' and not tgisinternal`).length === 1)
verifie('la fonction du trigger n\'est pas appelable par un connecté (revoke)', sql(`select has_function_privilege('authenticated', 'cockpit.push_sur_reponse()', 'execute') as p`)[0]?.p === false)

verifie('fonction : refuse sans secret (401)', (await appeler(null, { message_id: '00000000-0000-0000-0000-000000000000' })).status === 401)
verifie('fonction : refuse un mauvais secret (401)', (await appeler('faux', { message_id: '00000000-0000-0000-0000-000000000000' })).status === 401)
verifie('fonction : message_id absent → 400', (await appeler(secret, {})).status === 400)
verifie('fonction : message inconnu → rien envoyé', (await appeler(secret, { message_id: '00000000-0000-0000-0000-000000000000' })).j.envoye === 0)

const reel = sql(`select m.id from messages m join projets p on p.id = m.projet_id where m.auteur_type = 'session' and m.kind = 'info' and m.repond_a is not null and p.slug not like 'test-%' order by m.created_at desc limit 1`)[0]
const autres = sql('select count(*) as n from push_abonnements')[0].n
const testeur = sql(`select u.id from auth.users u join cockpit.admins a on a.user_id = u.id where u.email = 'test-cockpit@cockpit.local'`)[0]
if (!reel || Number(autres) > 0 || !testeur) {
  console.log(`  - essai d'envoi ignoré (${!reel ? 'aucune réponse réelle' : !testeur ? 'compte de test absent' : 'des appareils réels sont abonnés : on ne leur envoie rien'})`)
} else {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const p256dh = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url')
  const auth = randomBytes(16).toString('base64url')
  const endpoint = `https://fcm.googleapis.com/fcm/send/test-cockpit-${randomBytes(6).toString('hex')}`
  try {
    sql(`insert into push_abonnements (user_id, endpoint, p256dh, auth, appareil) values ('${testeur.id}', '${endpoint}', '${p256dh}', '${auth}', 'test verifier-push')`)
    const r = await appeler(secret, { message_id: reel.id })
    verifie('fonction : chiffre et tente l\'envoi, rien de livré à un faux appareil', r.status === 200 && r.j.envoye === 0 && (r.j.retires === 1 || r.j.erreurs === 1), r)
  } finally {
    sql(`delete from push_abonnements where endpoint = '${endpoint}'`)
  }
  verifie('aucun faux abonnement ne reste', Number(sql('select count(*) as n from push_abonnements')[0].n) === 0)
}
console.log(`\nverifier-push : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
