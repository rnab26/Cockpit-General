// Interrupteur « Branché / En pause » d'un projet, sur écran de téléphone (16 oct. 2026, migration 0093, chantier 975118ca).
// Prouve, projet jetable `test-pauseecran-…` (390 px) :
//   1. Réglages du projet : « Branché » + interrupteur ; un toucher ouvre la CONFIRMATION qui dit ce qui s'arrête, ce que devient le
//      travail en cours et que rien n'est supprimé ; « Annuler » n'écrit rien ;
//   2. « Mettre en pause » : appel de regler_pause_projet (p_pause vrai), toast de succès avec « Annuler », bloc « En pause » (phrase),
//      voyant « pause » en tête du projet, projet rangé sous « En pause » dans le menu des projets ;
//   3. « Annuler » du toast rallume d'un toucher ; rallumer au bouton aussi (toast « Remettre en pause ») ;
//   4. échec du serveur : message d'erreur visible, l'interrupteur ne ment pas (reste « Branché ») ;
//   5. « Tout » › Réglages des projets : la liste branchés / en pause d'un coup d'œil ;
//   6. aucun défilement horizontal, aucune erreur JavaScript.
// La colonne `en_pause` n'existe pas encore sur la vraie base (migration en attente d'accord) : l'état est fabriqué en interceptant la
// RÉPONSE de projets_visibles et l'appel de regler_pause_projet. La règle SQL est prouvée à part (scripts/verifier-pause.mjs, transaction annulée).
// Usage : node app/scripts/verifier-pause-ecran.mjs   (build d'abord : cd app && npm run build)
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const racine = path.resolve(racineApp, '..')
const sqlSh = path.join(racine, 'scripts', 'sql.sh')
const CAPTURES = process.env.CAPTURES ?? '/tmp'
mkdirSync(CAPTURES, { recursive: true })
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4178)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-pauseecran-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const NOM = 'Test pause (s’efface seul)'
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

// L'état du projet jetable, tel que la base le rendrait après la migration 0093.
let etat = { en_pause: false, pause_at: null, pause_par: null, pause_raison: null }
let refus = false
const appels = []

const P = randomUUID()
let navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, depot) values (${q(P)}, ${q(SLUG)}, ${q(NOM)}, '#64748B', true, 'rnab26/Cockpit-General')`)

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
    const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    if (r.method() === 'POST' && r.url().includes('/rest/v1/rpc/regler_pause_projet')) {
      const corps = JSON.parse(r.postData() ?? '{}')
      appels.push(corps)
      if (refus) { await route.fulfill({ status: 400, headers: cors, body: JSON.stringify({ message: 'Serveur indisponible (essai)' }) }); return }
      etat = corps.p_pause ? { en_pause: true, pause_at: new Date().toISOString(), pause_par: EMAIL, pause_raison: null } : { en_pause: false, pause_at: null, pause_par: null, pause_raison: null }
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ projet: corps.p_projet, en_pause: corps.p_pause, avant: !corps.p_pause }) })
      return
    }
    try {
      const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
      const headers = Object.fromEntries(res.headers); delete headers['content-encoding']; delete headers['content-length']
      let corps = Buffer.from(await res.arrayBuffer())
      if (r.method() === 'POST' && r.url().includes('/rest/v1/rpc/projets_visibles') && res.status === 200) {
        const lignes = JSON.parse(corps.toString('utf8'))
        corps = Buffer.from(JSON.stringify(lignes.map((p) => (p.slug === SLUG ? { ...p, ...etat } : p))))
      }
      await route.fulfill({ status: res.status, headers, body: corps })
    } catch { await route.abort('failed') }
  })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('tuiles').waitFor({ timeout: 40000 })
  await page.getByTestId('onglet-vue-reglages').click()
  const bloc = page.getByTestId('pause-projet')
  await bloc.waitFor({ timeout: 20000 })
  const interrupteur = bloc.getByTestId('pause-interrupteur')
  const toast = (re) => page.getByRole('status').filter({ hasText: re })

  // --- 1. branché, confirmation, annuler
  verifie('le bloc dit « Branché » et l’interrupteur est allumé', (await bloc.getAttribute('data-pause')) === 'non' && (await bloc.getByTestId('pause-etat').textContent()).trim() === 'Branché' && (await interrupteur.getAttribute('aria-checked')) === 'true')
  verifie('aucune icône « pause » en tête du projet tant qu’il est branché', (await page.getByTestId('icone-pause').count()) === 0)
  await interrupteur.click()
  const conf = page.getByTestId('pause-confirmation')
  await conf.waitFor({ timeout: 8000 })
  const texteConf = await conf.innerText()
  verifie('la confirmation dit ce qui s’arrête (chef, agents, renforts, réveils, prise de chantier)', /Ce qui s’arrête/.test(texteConf) && /renfort/.test(texteConf) && /réveil automatique/.test(texteConf) && /chantier n’est pris tout seul/.test(texteConf), texteConf)
  verifie('… ce que devient le travail en cours et que rien n’est supprimé', /(Aucun travail en cours|va au bout, rien de nouveau ne démarre)/.test(texteConf) && /Rien n’est supprimé/.test(texteConf), texteConf)
  await page.screenshot({ path: `${CAPTURES}/pause-confirmation.png` })
  await page.getByRole('button', { name: 'Annuler' }).click()
  await page.waitForTimeout(400)
  verifie('« Annuler » : aucun appel, toujours branché', appels.length === 0 && (await bloc.getAttribute('data-pause')) === 'non', appels)

  // --- 2. mettre en pause
  await interrupteur.click()
  await conf.waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click()
  await toast(/est en pause : Claude ne travaille plus dessus/).first().waitFor({ timeout: 10000 }).catch(() => {})
  verifie('un appel regler_pause_projet (projet, pause vraie)', appels.length === 1 && appels[0].p_projet === SLUG && appels[0].p_pause === true, appels)
  verifie('toast de succès avec « Annuler »', (await toast(/est en pause/).count()) > 0 && (await toast(/est en pause/).getByRole('button', { name: 'Annuler' }).count()) > 0, await page.getByRole('status').allTextContents())
  await page.getByTestId('pause-projet').and(page.locator('[data-pause="oui"]')).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('le bloc passe « En pause », avec sa phrase (depuis quand, rien supprimé)', (await bloc.getAttribute('data-pause')) === 'oui' && /^En pause depuis .+ : Claude ne travaille pas dessus\. Rien n’est supprimé\.$/.test((await bloc.getByTestId('pause-phrase').textContent()).trim()), await bloc.getByTestId('pause-phrase').textContent())
  verifie('l’interrupteur est éteint', (await interrupteur.getAttribute('aria-checked')) === 'false')
  verifie('voyant « pause » en tête du projet', (await page.getByTestId('choix-projet-bouton').getByTestId('icone-pause').count()) === 1)
  await page.screenshot({ path: `${CAPTURES}/pause-projet.png` })
  await page.getByTestId('choix-projet-bouton').click()
  await page.getByTestId('liste-projets').waitFor()
  const ligne = page.getByTestId(`onglet-${SLUG}`)
  verifie('menu des projets : le projet est rangé sous « En pause », avec son voyant', (await page.getByTestId('titre-en-pause').count()) === 1 && (await ligne.getAttribute('data-pause')) === 'oui' && (await ligne.getByTestId('icone-pause').count()) === 1)
  verifie('menu des projets : « Branchés (n) » et « En pause (n) » sont nommés', /^Branchés \(\d+\)$/.test((await page.getByTestId('titre-branches').textContent()).trim()) && /^En pause \(\d+\)$/.test((await page.getByTestId('titre-en-pause').textContent()).trim()), [await page.getByTestId('titre-branches').textContent(), await page.getByTestId('titre-en-pause').textContent()])
  await page.screenshot({ path: `${CAPTURES}/pause-menu.png` })
  await page.keyboard.press('Escape')
  await page.getByTestId('liste-projets').waitFor({ state: 'hidden', timeout: 4000 }).catch(async () => { await page.getByTestId('choix-projet-bouton').click() })

  // --- 3. annuler depuis le toast, puis rallumer au bouton
  await toast(/est en pause/).getByRole('button', { name: 'Annuler' }).first().click().catch(() => {})
  await toast(/est de nouveau branché\.$/).first().waitFor({ timeout: 10000 }).catch(() => {})
  await page.getByTestId('pause-projet').and(page.locator('[data-pause="non"]')).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('« Annuler » du toast : rallumé d’un toucher (appel pause faux)', appels.length === 2 && appels[1].p_pause === false && (await bloc.getAttribute('data-pause')) === 'non', appels)
  await interrupteur.click(); await conf.waitFor({ timeout: 8000 }); await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click()
  await page.getByTestId('pause-projet').and(page.locator('[data-pause="oui"]')).waitFor({ timeout: 10000 })
  await interrupteur.click()
  await toast(/de nouveau branché : Claude reprend/).first().waitFor({ timeout: 10000 }).catch(() => {})
  verifie('rallumer au bouton : direct, sans confirmation, toast « Claude reprend » avec « Remettre en pause »', (await bloc.getAttribute('data-pause')) === 'non' && (await toast(/Claude reprend/).getByRole('button', { name: 'Remettre en pause' }).count()) > 0 && (await page.getByTestId('pause-confirmation').count()) === 0, await page.getByRole('status').allTextContents())

  // --- 4. échec du serveur : visible, l'interrupteur ne ment pas
  refus = true
  await interrupteur.click(); await conf.waitFor({ timeout: 8000 }); await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click()
  await toast(/non enregistré/).first().waitFor({ timeout: 10000 }).catch(() => {})
  verifie('échec : message d’erreur visible, avec la cause', (await toast(/Mise en pause de .* non enregistré : .*Serveur indisponible/).count()) > 0, await page.getByRole('status').allTextContents())
  verifie('échec : l’interrupteur reste « Branché » (aucun faux état)', (await bloc.getAttribute('data-pause')) === 'non' && (await interrupteur.getAttribute('aria-checked')) === 'true')
  refus = false

  // --- 5. « Tout » : la liste d'un coup d'œil
  await interrupteur.click(); await conf.waitFor({ timeout: 8000 }); await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click()
  await page.getByTestId('pause-projet').and(page.locator('[data-pause="oui"]')).waitFor({ timeout: 10000 })
  await page.getByTestId('choix-projet-bouton').click()
  await page.getByTestId('onglet-tout').click()
  await page.getByTestId('reglages-projets').waitFor({ timeout: 20000 })
  await page.getByTestId('reglages-projets').getByRole('button').first().click()
  const liste = page.getByTestId('liste-pauses')
  await liste.waitFor({ timeout: 10000 })
  verifie('« Tout » › Réglages des projets : « n branchés · 1 en pause »', /^\d+ branchés? · \d+ en pause$/.test((await liste.getByTestId('pauses-resume').textContent()).trim()), await liste.getByTestId('pauses-resume').textContent())
  const lp = liste.locator(`[data-projet="${SLUG}"]`)
  verifie('… ce projet y est « en pause »', (await lp.getAttribute('data-pause')) === 'oui' && /en pause/.test(await lp.innerText()), await lp.innerText())
  await liste.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${CAPTURES}/pause-liste.png` })

  verifie('dans l’écran du téléphone (390 px), sans défilement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  verifie('aucune erreur JavaScript pendant tout le parcours', erreurs.length === 0, erreurs)
} catch (e) {
  total++; echecs++
  console.log(`  ✗ exception : ${e.stack ?? e.message}`)
} finally {
  try { await navigateur?.close() } catch {}
  try {
    await purgerProjetsDeTest(sql, [P], PREFIXE)
    verifie('nettoyage : le projet jetable est supprimé', sql(`select count(*)::int as n from projets where slug like ${q(PREFIXE + '%')}`)[0].n === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  arreter()
  console.log(`\nverifier-pause-ecran : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
