// Voyant des sessions + « Activer une session » sous « Tout lancer », sur écran de téléphone (19 oct. 2026, migration 0102, chantier cb3d17df).
// Projet jetable `test-voyantecran-…` (390 px), VRAIE base (etat_sessions, etat_renforts, demander_renforts réels). Prouve :
//   1. un message de Raphaël attend, aucune session : voyant gris « aucune session · 1 message attend » + bouton « Activer une session »
//      (alors qu'aucun chantier n'est à lancer : pas de bouton « Tout lancer ») ;
//   2. un toucher : bouton en cours (désactivé), UN seul appel, retour visible « session demandée à HH:MM » ;
//   3. échec du serveur : message d'erreur visible avec la cause + « Réessayer » qui marche ;
//   4. session vivante en base : voyant vert « session ouverte », plus de bouton ;
//   5. un chantier attend, aucune session : « Tout lancer » demande les renforts ET active une session (un seul appel activer_session) ;
//   6. projet en pause : voyant « en pause », ni « Activer » ni « Tout lancer » ;
//   7. aucun défilement horizontal, aucune erreur JavaScript.
// Seul activer_session est intercepté (il tirerait la vraie routine de réveil, ce qui coûte ~290 000 jetons) : sa règle côté base est prouvée à
// part par scripts/verifier-voyant.mjs. Le réveil du projet jetable est configuré avec un secret inexistant : même un appel réel ne tirerait rien.
// Usage : node app/scripts/verifier-voyant-ecran.mjs   (build d'abord : cd app && npm run build)
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
const PORT = Number(process.env.PORT ?? 4179)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-voyantecran-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const NOM = 'Test voyant (s’efface seul)'
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

let refus = false
let lenteur = 0
const appels = []
const P = randomUUID()
let navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, depot) values (${q(P)}, ${q(SLUG)}, ${q(NOM)}, '#64748B', true, 'rnab26/Cockpit-General')`)
  // Réveil configuré (sinon le bouton n'est pas proposé) mais SANS secret : aucun tir réel possible. Dernier réveil : il y a 2 h.
  sql(`insert into reveils_immediats (projet_id, trigger_id, secret_id, actif, dernier_at) values (${q(P)}, 'trig_bancvoyant', ${q(randomUUID())}, true, now() - interval '2 hours')`)
  sql(`insert into messages (projet_id, auteur, auteur_type, kind, corps) values (${q(P)}, 'Raphaël', 'proprietaire', 'info', 'Une question qui attend une réponse')`)

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
    if (r.method() === 'POST' && r.url().includes('/rest/v1/rpc/activer_session')) {
      appels.push(JSON.parse(r.postData() ?? '{}'))
      if (lenteur) await new Promise((ok) => setTimeout(ok, lenteur))
      if (refus) { await route.fulfill({ status: 400, headers: cors, body: JSON.stringify({ message: 'Serveur indisponible (essai)' }) }); return }
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ resultat: 'envoye', reveil_at: new Date().toISOString() }) })
      return
    }
    try {
      const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
      const headers = Object.fromEntries(res.headers); delete headers['content-encoding']; delete headers['content-length']
      await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
    } catch { await route.abort('failed') }
  })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const ouvrir = async () => {
    await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('voyants-sessions').waitFor({ timeout: 40000 })
    // attendre que la lecture de etat_sessions soit arrivée (le voyant n'est plus « lecture en cours »)
    await page.waitForFunction(() => document.querySelector('[data-testid="voyant-session"]')?.getAttribute('data-etat') !== 'inconnu', null, { timeout: 20000 }).catch(() => {})
  }
  const voyant = () => page.getByTestId('voyant-session').first()
  const toast = (re) => page.getByRole('status').filter({ hasText: re })

  // --- 1. un message attend, aucune session, aucun chantier
  await ouvrir()
  verifie('voyant gris « aucune session » avec ce qui attend (1 message)', (await voyant().getAttribute('data-etat')) === 'aucune' && /aucune session/.test(await voyant().innerText()) && /1 message attend/.test(await voyant().innerText()), await voyant().innerText())
  verifie('le bouton « Activer une session » est là alors qu’aucun chantier n’est à lancer', await page.getByTestId('activer-session').count() === 1 && /Activer une session/.test(await page.getByTestId('activer-session').innerText()))
  verifie('pas de bouton « Tout lancer » (rien à lancer), seulement le voyant', await page.getByTestId('tout-lancer-bouton').count() === 0)
  await page.screenshot({ path: `${CAPTURES}/voyant-aucune-session.png` })

  // --- 2. un toucher : en cours, un seul appel, retour visible
  lenteur = 1200
  await page.getByTestId('activer-session').tap()
  await page.waitForTimeout(300)
  verifie('pendant la demande : le bouton est en cours (désactivé), pas de second appel possible', await page.getByTestId('activer-session').isDisabled())
  await page.getByTestId('activer-session').tap({ force: true, timeout: 800 }).catch(() => {})
  await page.getByTestId('activer-resultat').waitFor({ timeout: 10000 })
  lenteur = 0
  verifie('UN seul appel activer_session, pour ce projet', appels.length === 1 && appels[0].p_projet === SLUG, appels)
  verifie('retour visible : « session demandée à HH:MM »', /[Ss]ession demandée à \d\d:\d\d/.test(await page.getByTestId('activer-resultat').innerText()), await page.getByTestId('activer-resultat').innerText())
  await page.screenshot({ path: `${CAPTURES}/voyant-activee.png` })

  // --- 3. échec visible, puis « Réessayer »
  refus = true
  await page.getByTestId('activer-session').tap()
  await page.getByTestId('activer-reessayer').waitFor({ timeout: 10000 })
  verifie('échec : message d’erreur visible avec la cause', /Pas activée : .*Serveur indisponible/.test(await page.getByTestId('activer-resultat').innerText()), await page.getByTestId('activer-resultat').innerText())
  refus = false
  await page.getByTestId('activer-reessayer').tap()
  await page.waitForFunction(() => /[Ss]ession demandée à/.test(document.querySelector('[data-testid="activer-resultat"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
  verifie('« Réessayer » marche : session demandée', /[Ss]ession demandée à \d\d:\d\d/.test(await page.getByTestId('activer-resultat').innerText()) && appels.length === 3, appels.length)

  // --- 4. une session vivante en base : voyant vert, plus de bouton (0104 : trois états lisibles)
  sql(`insert into sessions (id, projet_id, vu_at) values (${q('banc-voyant-' + randomUUID().slice(0, 6))}, ${q(P)}, now())`)
  await ouvrir()
  verifie('session ouverte à l’instant : voyant vert « session au travail » (elle arrive)', (await voyant().getAttribute('data-etat')) === 'vivante' && (await voyant().getAttribute('data-signe')) === 'travail' && /session au travail/.test(await voyant().innerText()), await voyant().innerText())
  verifie('session vivante : plus de bouton « Activer »', await page.getByTestId('activer-session').count() === 0)
  await page.screenshot({ path: `${CAPTURES}/voyant-vivante.png` })
  // en veille : ouverte depuis longtemps, un signe récent, aucun tour ni tâche
  sql(`update sessions set demarre_at = now() - interval '100 minutes', vu_at = now() - interval '10 minutes' where projet_id = ${q(P)}`)
  await ouvrir()
  verifie('session ouverte qui attend : voyant « en veille : rien ne tourne », verte pâle, pas de bouton', (await voyant().getAttribute('data-signe')) === 'veille' && /en veille/.test(await voyant().innerText()) && await page.getByTestId('activer-session').count() === 0, await voyant().innerText())
  await page.screenshot({ path: `${CAPTURES}/voyant-veille.png` })
  // au travail par un agent en arrière-plan : session muette depuis 30 min, une tâche en cours vue il y a 5 min
  sql(`insert into taches (session_id, projet_id, tache_id, type, statut, vu_at) select id, projet_id, 'banc-agent', 'agent', 'en_cours', now() - interval '5 minutes' from sessions where projet_id = ${q(P)}`)
  sql(`update sessions set vu_at = now() - interval '30 minutes' where projet_id = ${q(P)}`)
  await ouvrir()
  verifie('agent en arrière-plan avec preuve : « session au travail » alors que la session est muette depuis 30 min', (await voyant().getAttribute('data-signe')) === 'travail' && /session au travail/.test(await voyant().innerText()), await voyant().innerText())
  sql(`delete from taches where projet_id = ${q(P)}`)
  // sans nouvelles : ouverte il y a 40 min, jamais un signe depuis, rien n'attend d'autre : gris attention, le bouton « Activer » reste
  sql(`update sessions set demarre_at = now() - interval '40 minutes', vu_at = now() - interval '40 minutes' where projet_id = ${q(P)}`)
  sql(`insert into messages (projet_id, auteur, auteur_type, kind, corps) values (${q(P)}, 'Raphaël', 'proprietaire', 'info', 'une question sans réponse')`)
  await ouvrir()
  verifie('session sans nouvelles : voyant « sans nouvelles », le bouton « Activer une session » revient', (await voyant().getAttribute('data-signe')) === 'sans_nouvelles' && /sans nouvelles/.test(await voyant().innerText()) && await page.getByTestId('activer-session').count() === 1, await voyant().innerText())
  await page.screenshot({ path: `${CAPTURES}/voyant-sans-nouvelles.png` })

  // --- 5. un chantier attend, session finie : « Tout lancer » active lui-même une session
  sql(`update sessions set fin_at = now() where projet_id = ${q(P)}`)
  sql(`delete from messages where projet_id = ${q(P)}`)
  sql(`insert into chantiers (projet_id, titre, demande, etat) values (${q(P)}, 'Un chantier qui attend', 'Test.', 'libre')`)
  const avant = appels.length
  await ouvrir()
  await page.waitForFunction(() => /chantiers? attend/.test(document.querySelector('[data-testid="tout-lancer-ligne"]')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {})
  verifie('un chantier attend : « Tout lancer » actif, voyant gris', await page.getByTestId('tout-lancer-bouton').isEnabled() && (await voyant().getAttribute('data-etat')) === 'aucune', await page.getByTestId('tout-lancer-ligne').innerText().catch(() => ''))
  await page.screenshot({ path: `${CAPTURES}/voyant-tout-lancer.png` })
  await page.getByTestId('tout-lancer-bouton').tap()
  await page.getByTestId('tout-lancer-resultat').waitFor({ timeout: 20000 })
  const rTL = await page.getByTestId('tout-lancer-resultat').innerText()
  verifie('« Tout lancer » : renforts demandés ET une session activée (un appel activer_session)', /Demandé à \d\d:\d\d/.test(rTL) && /[Ss]ession demandée à/.test(rTL) && appels.length === avant + 1 && appels[appels.length - 1].p_projet === SLUG, { rTL, n: appels.length - avant })
  verifie('… sans la phrase contradictoire « Aucune session n’est ouverte »', !/Aucune session n’est ouverte/.test(rTL), rTL)
  await page.waitForFunction(() => /renforts? demandés?/.test(document.querySelector('[data-testid="voyant-session"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {})
  verifie('le voyant dit que le renfort demandé attend (jamais « rien n’attend »)', /1 renfort demandé attend/.test(await voyant().innerText()), await voyant().innerText())
  const [rf] = sql(`select count(*)::int as n from renforts where projet_id = ${q(P)}`)
  verifie('… et la demande de renforts est bien en base', rf.n >= 1, rf)
  await page.screenshot({ path: `${CAPTURES}/voyant-tout-lancer-fait.png` })

  // --- 6. en pause
  sql(`update projets set en_pause = true, pause_at = now() where id = ${q(P)}`)
  await ouvrir()
  verifie('en pause : voyant « en pause », ni « Activer » ni « Tout lancer »', (await voyant().getAttribute('data-etat')) === 'pause' && /en pause/.test(await voyant().innerText()) && await page.getByTestId('activer-session').count() === 0 && await page.getByTestId('tout-lancer-bouton').count() === 0, await voyant().innerText())

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
  console.log(`\nverifier-voyant-ecran : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
