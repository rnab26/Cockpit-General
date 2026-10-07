import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlSh = path.resolve(racineApp, '..', 'scripts', 'sql.sh')
const CAPTURES = process.env.CAPTURES ?? '/tmp'
mkdirSync(CAPTURES, { recursive: true })
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4174)
const BASE = `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-vitesse-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const BUDGET = { chargementKo: Number(process.env.BUDGET_CHARGEMENT_KO ?? 4096), reposKo: Number(process.env.BUDGET_REPOS_KO ?? 200) }
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }

const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

let projetId = null, moiId = null, navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  projetId = randomUUID()
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test vitesse (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-vitesse.mjs')`)
  moiId = sql(`select id from auth.users where email = '${esc(EMAIL)}'`)[0]?.id ?? null

  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
  const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const ses = await (await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json()
  if (!ses.access_token) throw new Error('connexion impossible')
  navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(ses)])
  // Le Chromium du conteneur ne fait pas confiance au proxy : les requêtes https passent par Node (certificat vérifié).
  const trafic = []   // { url, octets (décodés), reseau (content-length reçu), t }
  await ctx.route(/^https:\/\//, async (route) => {
    const r = route.request()
    try {
      const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
      const headers = Object.fromEntries(res.headers); const reseau = Number(headers['content-length'] ?? 0); delete headers['content-encoding']; delete headers['content-length']
      const corps = Buffer.from(await res.arrayBuffer())
      trafic.push({ url: r.url(), methode: r.method(), octets: corps.length, reseau, t: Date.now() })
      await route.fulfill({ status: res.status, headers, body: corps })
    } catch { await route.abort('failed') }
  })
  await ctx.addInitScript(() => {
    window.__lt = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ entryTypes: ['longtask'] }) } catch {}
  })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const panneau = page.getByTestId('bulle-aide-panneau')

  // La bulle flottante n'existe plus quand la barre du bas est là (chantier 6bb045e0) : les chats vivent dans l'onglet « Discussions ».
  const ongletDisc = page.getByTestId('onglet-barre-discussions')
  const ligneChat = page.locator(`[data-testid="discussion-ligne"][data-projet="${SLUG}"]`)
  const ouvrirChat = async () => {
    if (!(await page.getByTestId('discussions-liste').isVisible().catch(() => false))) await ongletDisc.click()
    await ligneChat.click()
  }


  // ---- outils de mesure
  const REST = (u) => /\/rest\/v1\//.test(u)
  const nomRequete = (u) => { const m = /\/rest\/v1\/(rpc\/)?([a-z_]+)/.exec(u); return m ? (m[1] ? 'rpc:' : '') + m[2] : new URL(u).pathname.split('/').slice(0, 3).join('/') }
  const bilan = (depuis) => {
    const l = trafic.slice(depuis).filter((x) => REST(x.url))
    const par = {}
    for (const x of l) { const k = nomRequete(x.url); par[k] = par[k] ?? { n: 0, octets: 0 }; par[k].n++; par[k].octets += x.octets }
    return { n: l.length, octets: l.reduce((s, x) => s + x.octets, 0), reseau: l.reduce((s, x) => s + x.reseau, 0), par }
  }
  const tachesLongues = async () => page.evaluate(() => { const a = window.__lt ?? []; return { n: a.length, ms: Math.round(a.reduce((s, x) => s + x, 0)), max: Math.round(Math.max(0, ...a)) } })
  const sortie = (nom, o) => console.log(`  · ${nom} : ${o.n} requêtes, ${(o.octets / 1024).toFixed(0)} Ko décodés (${(o.reseau / 1024).toFixed(0)} Ko sur le réseau)`)
  const detail = (o) => Object.entries(o.par).sort((a, b) => b[1].octets - a[1].octets).slice(0, 6).map(([k, v]) => `${k} ×${v.n} ${(v.octets / 1024).toFixed(0)} Ko`).join(' | ')

  // --- 1. chargement complet de l'écran d'accueil (compte de test admin = les VRAIS volumes de données, en lecture)
  const t0 = Date.now(); const i0 = trafic.length
  await page.goto(BASE + '#tout', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-tout').waitFor({ timeout: 40000 })
  const tAffiche = Date.now() - t0
  await page.waitForTimeout(1500)
  const charge = bilan(i0), lt1 = await tachesLongues()
  sortie('chargement complet', charge); console.log(`    ${detail(charge)}`)
  console.log(`    écran « Tout » affiché en ${tAffiche} ms ; tâches longues : ${lt1.n} (${lt1.ms} ms, la pire ${lt1.max} ms)`)
  verifie(`chargement complet : moins de ${BUDGET.chargementKo} Ko décodés`, charge.octets / 1024 < BUDGET.chargementKo, Math.round(charge.octets / 1024))

  // --- 2. clics : onglet projet, discussions, retour, ouvrir un chantier
  const clic = async (nom, fn) => {
    const i = trafic.length; await page.evaluate(() => { window.__lt = [] }); const t = Date.now()
    await fn(); await page.waitForTimeout(500)
    const b = bilan(i), l = await tachesLongues()
    console.log(`    (${detail(b)})`)
    console.log(`  · clic « ${nom} » : ${b.n} requêtes, ${(b.octets / 1024).toFixed(0)} Ko, ${Date.now() - t - 500} ms, tâches longues ${l.n} (${l.ms} ms, pire ${l.max} ms)`)
    return { b, l }
  }
  const ouvrirListe = async () => { if (!(await page.getByTestId('liste-projets').count())) await page.getByTestId('choix-projet-bouton').click(); await page.getByTestId('liste-projets').waitFor({ timeout: 10000 }) }
  const clics = []
  clics.push(await clic('onglet du projet jetable', async () => { await ouvrirListe(); await page.getByTestId(`onglet-${SLUG}`).click(); await page.getByTestId('vue-projet').waitFor({ timeout: 10000 }) }))
  clics.push(await clic('Discussions (barre du bas)', async () => { await page.getByTestId('onglet-barre-discussions').click(); await page.getByTestId('discussions-liste').waitFor({ timeout: 10000 }) }))
  await page.keyboard.press('Escape')
  clics.push(await clic('retour à « Tout »', async () => { await ouvrirListe(); await page.getByTestId('onglet-tout').click(); await page.getByTestId('vue-tout').waitFor({ timeout: 10000 }) }))
  const deplier = page.getByTestId('tout-deplier')
  if (await deplier.count()) await deplier.click().catch(() => {})
  const ouvrir = page.getByTestId('ouvrir-chantier').first()
  if (await ouvrir.count()) {
    clics.push(await clic('ouvrir un chantier', async () => { await ouvrir.click(); await page.waitForTimeout(400) }))
    await page.keyboard.press('Escape')
  } else console.log('  (aucune ligne de chantier à ouvrir dans « Tout »)')
  verifie('un clic ne relit pas les tables entières (messages / chantiers / tâches)', clics.every((c) => Object.keys(c.b.par).every((k) => !['messages', 'chantiers', 'taches'].includes(k) || c.b.par[k].octets < 60 * 1024)), clics.map((c) => detail(c.b)))

  // --- 3. une session écrit pendant que l'écran est ouvert : la nouvelle ligne arrive
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 40000 })
  await page.waitForTimeout(1500)
  sql(`select repondre_dans_fil('${SLUG}', null, 'claude/test-vitesse', 'Réponse de test vitesse') as id`)
  const iDelta = trafic.length, tDelta = Date.now()
  await page.getByTestId('onglet-barre-discussions').click()
  const vu = await ligneChat.filter({ hasText: 'Réponse de test vitesse' }).waitFor({ timeout: 80000 }).then(() => true, () => false)
  console.log(`  · la réponse écrite par une session apparaît en ${Math.round((Date.now() - tDelta) / 1000)} s`)
  verifie('la réponse d’une session apparaît à l’écran sans recharger la page', vu)
  const d = bilan(iDelta)
  sortie('depuis l’écriture jusqu’à l’affichage', d); console.log(`    ${detail(d)}`)
  await page.keyboard.press('Escape')

  // --- 4. repos : 70 s, 7 écritures d'agents = sondage / direct seulement
  const iRepos = trafic.length; await page.evaluate(() => { window.__lt = [] })
  for (let k = 0; k < 7; k++) { sql(`select repondre_dans_fil('${SLUG}', null, 'claude/test-vitesse', 'bruit ${k}') as id`); await page.waitForTimeout(10000) }
  const repos = bilan(iRepos), lt4 = await tachesLongues()
  sortie('70 s de repos avec 7 écritures d’agents', repos); console.log(`    ${detail(repos)} ; tâches longues ${lt4.n} (${lt4.ms} ms)`)
  verifie(`repos : moins de ${BUDGET.reposKo} Ko lus en 70 s`, repos.octets / 1024 < BUDGET.reposKo, Math.round(repos.octets / 1024))
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    if (projetId) await purgerProjetsDeTest(sql, [projetId], PREFIXE)
    const reste = sql(`select count(*)::int as n from projets where slug = '${SLUG}'`)[0].n
    verifie('nettoyage : le projet jetable est supprimé', reste === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-vitesse : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
