// Mise à jour de l'appli, dans un vrai navigateur (chantier c4de4baa). Sans base, sans réseau :
// la construction réelle (dist/, commit gravé) est servie par un petit serveur local dont version.json
// change à la demande. Prouve : bannière → « Plus tard » → elle REVIENT après le délai ; « Mettre à jour »
// désinscrit le service worker, vide les caches et recharge en contournant le cache HTTP ; la mise à jour
// automatique recharge, sauf si un texte est en cours de saisie.
//   cd app && GITHUB_SHA=aaaaaaaaaaaaffff npm run build && node scripts/verifier-version.mjs
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const BUILD = JSON.parse(readFileSync(path.join(dist, 'version.json'), 'utf8'))
if (BUILD.version === 'dev') { console.log('Construis avec GITHUB_SHA=… (la version « dev » ne suit rien).'); process.exit(2) }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }
let enLigne = BUILD.version
let coupe = false
const requetes = []
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x')
  let p = decodeURIComponent(u.pathname).replace(/^\/Cockpit-General\/?/, '')
  if (p === 'version.json') {
    if (coupe) { r.writeHead(503); r.end(); return }
    r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=600' })
    r.end(JSON.stringify({ version: enLigne, date: '2026-10-05T12:00:00.000Z' })); return
  }
  if (p === '' || !existsSync(path.join(dist, p)) || statSync(path.join(dist, p)).isDirectory()) p = 'index.html'
  if (p === 'index.html') requetes.push({ cc: q.headers['cache-control'] ?? null, at: Date.now() })
  r.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' })
  r.end(readFileSync(path.join(dist, p)))
})
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
const URL_APP = `http://127.0.0.1:${srv.address().port}/Cockpit-General/`

let echecs = 0, total = 0
const verifie = (nom, ok, d) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${d !== undefined ? ' — ' + JSON.stringify(d) : ''}`) } }
const attend = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise((o) => setTimeout(o, 100)) } return false }

console.log('verifier-version (navigateur)')
const nav = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
try {
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  const page = await ctx.newPage()
  await page.route(/supabase\.co/, (r) => r.abort())
  // Trace des gestes de « Mettre à jour », gardée d'une page à l'autre.
  await page.addInitScript(() => {
    const note = (k) => { try { sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) ?? 0) + 1)) } catch { /* ignoré */ } }
    const un = ServiceWorkerRegistration.prototype.unregister
    ServiceWorkerRegistration.prototype.unregister = function () { note('t_unregister'); return un.call(this) }
    if (window.caches) { const del = caches.delete.bind(caches); caches.delete = (k) => { note('t_cachedelete'); return del(k) } }
  })
  await page.clock.install()
  await page.goto(URL_APP)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => navigator.serviceWorker.ready)
  const banniere = () => page.getByTestId('nouvelle-version').isVisible().catch(() => false)
  const retour = async () => { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(400) }

  await retour()
  verifie('même version en ligne : pas de bannière', !(await banniere()))

  enLigne = 'bbbbbbbbbbbb'
  await retour()
  verifie('version différente en ligne : la bannière apparaît', await attend(banniere))

  await page.getByRole('button', { name: 'Plus tard' }).click()
  verifie('« Plus tard » : la bannière se cache', !(await banniere()))
  await page.clock.fastForward('30:00')
  await page.waitForTimeout(300)
  verifie('30 min plus tard (délai 1 h) : toujours cachée', !(await banniere()))
  await page.clock.fastForward('31:00')
  verifie('1 h plus tard : la bannière REVIENT', await attend(banniere))

  // Délai réglable : 15 min (réglage retenu sur l'appareil)
  await page.evaluate(() => localStorage.setItem('cockpit_maj', JSON.stringify({ rappelMin: 15, auto: false })))
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  verifie('nouveau lancement : la bannière est de nouveau là (écartement non retenu)', await attend(banniere))

  // « Mettre à jour » : désinscrit, vide, recharge en contournant le cache HTTP
  const avant = requetes.length
  await page.evaluate(() => { sessionStorage.clear() })
  const nav1 = page.waitForNavigation({ timeout: 10000 }).catch(() => null)
  await page.getByTestId('mettre-a-jour').click()
  await nav1
  await page.waitForLoadState('networkidle')
  const traces = await page.evaluate(() => ({ un: Number(sessionStorage.getItem('t_unregister') ?? 0), del: Number(sessionStorage.getItem('t_cachedelete') ?? 0) }))
  verifie('« Mettre à jour » : service worker désinscrit', traces.un >= 1, traces)
  verifie('« Mettre à jour » : caches supprimés', traces.del >= 1, traces)
  const apres = requetes.slice(avant)
  verifie('« Mettre à jour » : la page est redemandée au serveur en contournant le cache HTTP (cache-control: no-cache)', apres.some((r) => r.cc === 'no-cache' || r.cc === 'max-age=0'), apres)

  // Hors ligne : la lecture échoue → pas de fausse « nouvelle version », pas de plantage
  enLigne = BUILD.version
  coupe = true
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(500)
  verifie('serveur injoignable : pas de bannière, l’app reste là', !(await banniere()) && (await page.locator('body').innerText()).length > 20)
  coupe = false

  // Mise à jour automatique : bloquée par un texte en cours de saisie
  await page.evaluate(() => localStorage.setItem('cockpit_maj', JSON.stringify({ rappelMin: 60, auto: true })))
  await page.reload()
  await page.waitForLoadState('networkidle')
  const champ = page.locator('input[type="email"], input[type="text"], input:not([type])').first()
  const aChamp = (await champ.count()) > 0
  verifie('écran de départ : un champ de saisie existe (pour le test du brouillon)', aChamp)
  if (aChamp) {
    await champ.fill('brouillon@exemple.fr')
    await page.evaluate(() => { window.__marque = 'meme-page' })
    enLigne = 'cccccccccccc'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(500)
    await page.clock.fastForward('00:40')
    await page.waitForTimeout(600)
    verifie('auto + un texte en cours : la page ne se recharge PAS', (await page.evaluate(() => window.__marque)) === 'meme-page')
    verifie('… et la bannière reste là pour un choix manuel', await banniere())
    // Le texte est effacé : la mise à jour automatique part.
    const rechargee = page.waitForNavigation({ timeout: 10000 }).then(() => true).catch(() => false)
    await champ.fill('')
    await page.clock.fastForward('00:40')
    verifie('auto + plus rien en saisie : la page se recharge toute seule', await rechargee)
  }
} finally {
  await nav.close()
  srv.close()
}
console.log(`\nverifier-version (navigateur) : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
