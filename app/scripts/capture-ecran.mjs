// Capture de l'écran réel sur un téléphone, connecté avec le compte de test
// par un lien magique (clé service_role de l'environnement, aucun mot de passe).
// Usage : node scripts/capture-ecran.mjs <url> <dossier> [prefixe]
import { chromium } from 'playwright'
const [url, dossier, prefixe = 'ecran'] = process.argv.slice(2)
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
const th = lien.hashed_token ?? lien.properties?.hashed_token
const ses = await (await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: th }) })).json()
if (!ses.access_token) { console.error('connexion impossible', ses); process.exit(1) }
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: process.env.SCHEMA ?? 'light' })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(ses)])
// Le Chromium de l'environnement cloud ne fait pas confiance au proxy : les
// requêtes externes passent par Node, qui vérifie le certificat (bundle du proxy).
await ctx.route(/^https:\/\//, async (route) => {
  const r = route.request()
  const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
  const headers = Object.fromEntries(res.headers)
  delete headers['content-encoding']; delete headers['content-length']
  await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
})
const p = await ctx.newPage()
await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(4000)
await p.screenshot({ path: `${dossier}/${prefixe}-haut.png` })
await p.screenshot({ path: `${dossier}/${prefixe}-page.png`, fullPage: true })
console.log(await p.evaluate(() => document.body.innerText.slice(0, 3000)))
await b.close()
