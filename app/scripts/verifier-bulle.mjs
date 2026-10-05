// Bulle flottante d'aide, parcours COMPLET sur écran de téléphone (chantier 851282af) :
// visible sans réglage (vue projet ET vue « Tout »), un message tapé arrive dans le fil
// du projet comme message libre, la réponse d'une session (repondre_dans_fil, ce que fait
// `progression.sh --point`) s'affiche dans la bulle ouverte, l'extinction se règle dans
// « Réglages du projet ». Projet jetable `test-bulle-…`, supprimé à la fin. Court (~1 min).
// Usage : node app/scripts/verifier-bulle.mjs   (build d'abord : cd app && npm run build)
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
const PREFIXE = 'test-bulle-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
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
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test bulle (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-bulle.mjs')`)
  moiId = sql(`select id from auth.users where email = '${esc(EMAIL)}'`)[0]?.id ?? null

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
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const panneau = page.getByTestId('bulle-aide-panneau')

  // --- 1. vue « Tout » : la bulle est là sans réglage
  await page.goto(BASE + '#tout', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('bulle-aide-bouton').waitFor({ timeout: 20000 }).catch(() => {})
  verifie('vue « Tout » : la bulle est visible sans aucun réglage', await page.getByTestId('bulle-aide-bouton').isVisible().catch(() => false))
  await page.screenshot({ path: `${CAPTURES}/bulle-tout.png` })

  // --- 2. vue du projet jetable
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 20000 })
  const bulle = page.getByTestId('bulle-aide-bouton')
  await bulle.waitFor({ timeout: 10000 }).catch(() => {})
  verifie('vue projet : la bulle est visible sans réglage (l’app ne plante pas)', await bulle.isVisible().catch(() => false))
  const b = await bulle.boundingBox()
  const vp = page.viewportSize()
  verifie('téléphone : à droite, dans l’écran, au-dessus du bas de page (≥ 60 px du bord bas)', !!b && b.x >= 0 && b.x + b.width <= vp.width - 8 && b.y + b.height <= vp.height - 60, b)
  const sansDefilement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  verifie('aucun défilement horizontal', sansDefilement <= 0, sansDefilement)
  await page.screenshot({ path: `${CAPTURES}/bulle-projet.png` })

  // --- 3. un message tapé dans la bulle = message libre du fil du projet
  await bulle.click()
  await panneau.waitFor({ timeout: 5000 })
  verifie('fil vide : le message d’aide s’affiche', await page.getByTestId('bulle-aide-vide').isVisible())
  const question = 'Comment ranger un chantier dans une section ?'
  await page.getByTestId('bulle-aide-saisie').fill(question)
  await page.getByTestId('bulle-aide-envoyer').click()
  await panneau.getByText(question).waitFor({ timeout: 15000 }).catch(() => {})
  verifie('sa question s’affiche dans la bulle (à droite)', await panneau.getByText(question).count() === 1)
  const m = sql(`select id, chantier_id, auteur_type, kind, corps, cockpit.est_message_libre(messages) as libre from messages where projet_id = '${projetId}'`)
  verifie('en base : message du propriétaire, sans chantier (fil du projet), reconnu comme message LIBRE', m.length === 1 && m[0].chantier_id === null && m[0].auteur_type === 'proprietaire' && m[0].kind === 'info' && m[0].libre === true, m)
  const sans = sql(`select count(*)::int as n from messages_sans_reponse('${projetId}'::uuid, null)`)
  verifie('la chef / la session le voient comme « sans réponse » (messages_sans_reponse)', sans[0].n >= 1, sans)

  // --- 4. une session répond comme `progression.sh --point` : la réponse arrive dans la bulle ouverte
  verifie('avant la réponse : « Claude n’a pas encore répondu » est dit', await page.getByTestId('bulle-aide-attente').count() === 1)
  const t0 = Date.now()
  sql(`select repondre_dans_fil('${SLUG}', null, 'claude/test-bulle', 'Glisse-le sur une section, ou menu ⋯ › Ranger.') as id`)
  await panneau.getByText('Glisse-le sur une section', { exact: false }).waitFor({ timeout: 90000 }).catch(() => {})
  const dt = Math.round((Date.now() - t0) / 1000)
  verifie(`la réponse de la session apparaît dans la bulle ouverte, sans recharger (${dt} s)`, await panneau.getByText('Glisse-le sur une section', { exact: false }).count() === 1)
  verifie('la bulle n’attend plus : plus de « sans réponse » pour ce message', sql(`select count(*)::int as n from messages_sans_reponse('${projetId}'::uuid, null)`)[0].n === 0)
  verifie('après la réponse : plus de ligne d’attente', await page.getByTestId('bulle-aide-attente').count() === 0)
  await page.screenshot({ path: `${CAPTURES}/bulle-ouverte.png` })
  await page.keyboard.press('Escape')
  await page.getByTestId('bulle-aide-bouton').waitFor({ timeout: 5000 })

  // --- 5. le réglage d'extinction reste dans « Réglages du projet »
  await page.getByTestId('onglet-vue-reglages').click()
  await page.getByTestId('reglages-projet').getByRole('button').first().click()
  const caseBulle = page.getByLabel('Bulle d\'aide sur ce projet')
  await caseBulle.waitFor({ timeout: 5000 })
  verifie('Réglages du projet : « Bulle d’aide » cochée par défaut', await caseBulle.isChecked())
  await caseBulle.uncheck()
  await page.getByTestId('bulle-aide-bouton').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  verifie('décochée : la bulle disparaît', await page.getByTestId('bulle-aide-bouton').count() === 0)
  await caseBulle.check()
  await page.getByTestId('bulle-aide-bouton').waitFor({ timeout: 8000 }).catch(() => {})
  verifie('recochée : la bulle revient', await page.getByTestId('bulle-aide-bouton').count() === 1)
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    if (projetId) await purgerProjetsDeTest(sql, [projetId], PREFIXE)
    if (moiId) sql(`delete from preferences where user_id = '${moiId}' and cle = 'bulle_flottante_aide_${projetId}'`)
    const reste = sql(`select count(*)::int as n from projets where slug = '${SLUG}'`)[0].n
    verifie('nettoyage : le projet jetable est supprimé', reste === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-bulle : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
