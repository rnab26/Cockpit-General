// « Copier le code » de Projets & membres suit l'emplacement choisi (chantier 949ed6d7), écran de téléphone :
// vide = bouton grisé + consigne, menu = balise en mode bouton, page = mode page, appli = rien à coller (lien de l'app).
// Le texte copié est comparé à scripts/balise.mjs (UNE règle, aussi lue par emplacement.sh --balise).
// Projet jetable `test-balise-…`, supprimé à la fin.
// Usage : node app/scripts/verifier-balise.mjs   (build d'abord : cd app && npm run build)
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlSh = path.resolve(racineApp, '..', 'scripts', 'sql.sh')
const baliseMjs = path.resolve(racineApp, '..', 'scripts', 'balise.mjs')
const CAPTURES = process.env.CAPTURES ?? '/tmp'
mkdirSync(CAPTURES, { recursive: true })
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4176)
const BASE = `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-balise-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }

const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

let projetId = null, navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  projetId = randomUUID()
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test balise (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-balise.mjs')`)

  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
  const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const ses = await (await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json()
  if (!ses.access_token) throw new Error('connexion impossible')
  navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(ses)])
  // Le Chromium du conteneur ne fait pas confiance au proxy : les requêtes https passent par Node (certificat vérifié).
  await ctx.route(/^https:\/\//, async (route) => {
    const r = route.request()
    try {
      const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
      const headers = Object.fromEntries(res.headers); delete headers['content-encoding']; delete headers['content-length']
      await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
    } catch { await route.abort('failed') }
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${PORT}` }).catch(() => {})
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))

  const toast = (re) => page.getByRole('status').getByText(re).first().waitFor({ timeout: 8000 }).then(() => true, () => false)
  const regler = (e) => sql(e === null ? `update projets set emplacement = null where id = '${projetId}'` : `update projets set emplacement = '${JSON.stringify(e)}'::jsonb where id = '${projetId}'`)
  const cleP = sql(`select cle_embed from projets where id = '${projetId}'`)[0].cle_embed
  const ouvrirFiche = async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('menu').or(page.getByRole('button', { name: /Test balise/ })).first().waitFor({ timeout: 30000 })
    // L'écran reprend son état à la réouverture : la fiche peut déjà être ouverte.
    if (!await page.getByRole('button', { name: /Test balise/ }).isVisible().catch(() => false)) {
      if (!await page.getByTestId('embed-emplacement').isVisible().catch(() => false)) {
        await page.getByTestId('menu').click()
        await page.getByRole('menuitem', { name: /Projets & membres/ }).click()
      }
    }
    if (await page.getByRole('button', { name: /Test balise/ }).isVisible().catch(() => false)) await page.getByRole('button', { name: /Test balise/ }).click()
    await page.getByTestId('embed-emplacement').waitFor({ timeout: 10000 })
  }
  const coller = () => page.evaluate(() => navigator.clipboard.readText())
  const regle = (mode, acces, decl = '') => JSON.parse(execFileSync('node', [baliseMjs, cleP, mode, acces, decl], { encoding: 'utf8' }))
  const copier = page.getByRole('button', { name: 'Copier le code' })

  // 1. Questionnaire pas répondu : état vide, rien à copier.
  regler(null)
  await ouvrirFiche()
  verifie('vide : « pas encore choisi » affiché', /pas encore choisi/.test(await page.getByTestId('embed-emplacement').innerText()))
  verifie('vide : « Copier le code » grisé', await copier.isDisabled())
  await page.screenshot({ path: `${CAPTURES}/balise-vide.png` })

  // 2. Bouton dans le menu, sans lien précis.
  regler({ mode: 'menu', acces: 'equipe' })
  await ouvrirFiche()
  const t2 = await page.getByTestId('embed-emplacement').innerText()
  verifie('menu : emplacement et accès affichés', /Bouton dans le menu/.test(t2) && /L'équipe du projet/.test(t2), t2)
  await copier.click()
  verifie('menu : toast « Code copié »', await toast(/Code copié/))
  const c2 = await coller()
  verifie('menu : balise en mode bouton, identique à la règle commune', c2.includes('data-mode="bouton"') && c2 === regle('menu', 'equipe').code, c2)
  verifie('menu : consigne du lien du menu à compléter', /data-declencheur/.test(await page.locator('ol').first().innerText()))
  await page.screenshot({ path: `${CAPTURES}/balise-menu.png` })

  // 3. Bouton dans le menu avec le lien du menu connu.
  regler({ mode: 'menu', acces: 'moi', menu: '#lien-cockpit' })
  await ouvrirFiche()
  await copier.click(); await toast(/Code copié/)
  const c3 = await coller()
  verifie('menu + lien : data-declencheur posé', c3.includes('data-declencheur="#lien-cockpit"') && !c3.includes('data-libelle'), c3)

  // 4. Page à part.
  regler({ mode: 'page', acces: 'utilisateurs' })
  await ouvrirFiche()
  await copier.click(); await toast(/Code copié/)
  const c4 = await coller()
  verifie('page : data-mode="page", identique à la règle commune', c4.includes('data-mode="page"') && c4 === regle('page', 'utilisateurs').code, c4)

  // 5. Appli : rien à coller, le dire.
  regler({ mode: 'appli', acces: 'moi' })
  await ouvrirFiche()
  verifie('appli : « rien à coller » affiché', await page.getByTestId('embed-appli').isVisible())
  verifie('appli : pas de bouton « Copier le code »', await copier.count() === 0)
  await page.getByRole('button', { name: /Copier le lien de l.app/ }).click()
  verifie('appli : le lien de l’app se copie', await toast(/Lien de l’app copié/) && (await coller()).startsWith('https://rnab26.github.io/Cockpit-General/'))
  await page.screenshot({ path: `${CAPTURES}/balise-appli.png` })

  // 6. Copie impossible : échec visible.
  regler({ mode: 'page', acces: 'moi' })
  await ouvrirFiche()
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refus')) }, configurable: true }) })
  await copier.click()
  verifie('copie refusée : message d’échec visible', await toast(/Copie impossible/))
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
  console.log(`\nverifier-balise : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
