// « Réveil automatique » : la VRAIE raison quand rien ne peut être réveillé (13 oct. 2026, migration 0082, chantier 6f112d51).
// Le cas de Raphaël, sur le projet moteur : l'écran disait « Il manque le jeton du réveil » + « Coller le jeton » alors que le jeton existait ;
// la vraie cause était qu'aucune session chef n'était ouverte. Prouve, sur écran de téléphone (390 px), projet jetable `test-filetecran-…` :
//   1. « aucune session chef » + du travail qui attend : « Bloqué : aucune session chef n'est ouverte », jamais le mot « jeton », bouton
//      « Lancer une session autonome » (et non « Coller le jeton ») ;
//   2. le bouton copie la phrase « Traite le projet … en lot » et ouvre claude.ai/code (le même geste que dans Renforts), et le dit ;
//   3. « aucune session chef » mais rien n'attend : pas d'alarme, pas de bouton ; « sans jeton » reste « Coller le jeton » (non-régression) ;
//   4. dans l'écran du téléphone, sans défilement horizontal, sans erreur JavaScript.
// L'état est fabriqué en interceptant la RÉPONSE de etat_filet (un projet de test est toujours « test » côté base) : la règle SQL, elle, est
// contrôlée sur le vrai projet moteur par verifier-base §38 (lecture seule). Aucune écriture dans un vrai projet.
// Usage : node app/scripts/verifier-filet-ecran.mjs   (build d'abord : cd app && npm run build)
//   BASE_URL=https://rnab26.github.io/Cockpit-General/ node app/scripts/verifier-filet-ecran.mjs   (le même parcours sur le site en ligne)
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
const PORT = Number(process.env.PORT ?? 4177)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-filetecran-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const NOM = 'Test réveil (s’efface seul)'
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

// L'état que la base rendrait, tel quel (mêmes champs que etat_filet), hormis le statut et ce qui attend.
const etatFabrique = (statut, n) => ({
  statut, projet_actif: true, global_actif: true, cron: { existe: true, actif: true, planning: '* * * * *' }, plafond: 12, delai_min: 3,
  aujourdhui: 0, reveils_total: 0, jeton: statut !== 'sans_jeton', dernier_at: null, prochain_at: null, ecart_min: 5, dernier_pourquoi: null,
  attente: { n, raisons: n ? ['2 renfort(s) demandé(s)'] : [] }, vivant: false, cadence_min: 1, reveil_ecart_min: 5, chef_reactif_min: 5,
  chef: { repond: false, raison: 'sans_passe' },
})
let fabrique = etatFabrique('sans_chef', 2)

const P = randomUUID()
let navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, depot) values (${q(P)}, ${q(SLUG)}, ${q(NOM)}, '#64748B', true, 'rnab26/Cockpit-General')`)

  // --- connexion (lien magique) et écran de téléphone
  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
  const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const ses = await (await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json()
  if (!ses.access_token) throw new Error('connexion impossible')
  navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin }).catch(() => {})
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v) } catch {}
    window.__ouverts = []   // window.open est remplacé : on note ce que l'écran voulait ouvrir, sans ouvrir d'onglet
    window.open = (...a) => { window.__ouverts.push(a); return null }
  }, [`sb-${REF}-auth-token`, JSON.stringify(ses)])
  // Le Chromium du conteneur ne fait pas confiance au proxy : les requêtes https passent par Node (certificat vérifié). Seule la réponse de etat_filet est fabriquée.
  await ctx.route(/^https:\/\//, async (route) => {
    const r = route.request()
    if (r.method() === 'POST' && r.url().includes('/rest/v1/rpc/etat_filet')) {
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(fabrique) })
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
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('tuiles').waitFor({ timeout: 40000 })
  const ouvrirBloc = async () => {
    await page.getByTestId('onglet-vue-reglages').click()
    const b = page.getByTestId('filet-securite')
    await b.waitFor({ timeout: 20000 })
    return b
  }
  const rechargerAvec = async (etat) => {
    fabrique = etat
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('tuiles').waitFor({ timeout: 40000 })
    return ouvrirBloc()
  }

  // --- 1. aucune session chef, du travail attend
  let bloc = await ouvrirBloc()
  verifie('l’écran reçoit le statut « sans_chef »', (await bloc.getAttribute('data-statut')) === 'sans_chef', await bloc.getAttribute('data-statut'))
  verifie('il dit la vraie raison : « Bloqué : aucune session chef n’est ouverte »', /^Bloqué : aucune session chef n’est ouverte$/.test((await bloc.getByTestId('filet-titre').textContent()).trim()), await bloc.getByTestId('filet-titre').textContent())
  verifie('… ce qui attend, et que rien ne se lance tout seul', /^En attente : 2 renfort\(s\) demandé\(s\)\. Rien ne se lance tout seul tant qu’aucune session n’est ouverte\.$/.test(await bloc.getByTestId('filet-detail').textContent()), await bloc.getByTestId('filet-detail').textContent())
  verifie('jamais le mot « jeton » dans le bloc (le jeton existe, le dire manquant était faux)', !/jeton/i.test(await bloc.innerText()), await bloc.innerText())
  const bouton = bloc.getByTestId('filet-action')
  verifie('le geste proposé est « Lancer une session autonome » (plus « Coller le jeton »)', (await bouton.textContent()).trim() === 'Lancer une session autonome', await bouton.textContent())
  const box = await bloc.boundingBox()
  verifie('dans l’écran du téléphone (390 px), sans défilement horizontal', !!box && box.x >= 0 && box.x + box.width <= 390 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), box)
  await bloc.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${CAPTURES}/filet-sans-chef.png` })

  // --- 2. le geste : la phrase est copiée, la page des sessions est ouverte, et l'écran le dit
  await bouton.click()
  const toast = page.getByRole('status').filter({ hasText: 'Phrase copiée' })
  await toast.first().waitFor({ timeout: 8000 }).catch(() => {})
  verifie('l’écran dit « Phrase copiée : colle-la dans la nouvelle session. »', await toast.count() > 0, await page.getByRole('status').allTextContents())
  const presse = await page.evaluate(() => navigator.clipboard.readText().catch(() => null))
  verifie('le presse-papier contient la phrase « Traite le projet … en lot : … » (la même que dans Renforts)', presse === `Traite le projet ${NOM} en lot : prends tous les chantiers qui attendent, lance des agents, et réponds dans le cockpit.`, presse)
  const ouverts = await page.evaluate(() => window.__ouverts)
  verifie('la page des sessions s’ouvre dans un nouvel onglet (https://claude.ai/code)', ouverts.length === 1 && ouverts[0][0] === 'https://claude.ai/code' && ouverts[0][1] === '_blank', ouverts)

  // --- 3. rien n'attend : pas d'alarme ; sans jeton : inchangé
  bloc = await rechargerAvec(etatFabrique('sans_chef', 0))
  verifie('aucune session chef mais rien n’attend : « Tout est en ordre », sans bouton, sans alarme', (await bloc.getByTestId('filet-titre').textContent()).trim() === 'Tout est en ordre' && /aucune session chef/.test(await bloc.getByTestId('filet-detail').textContent()) && await bloc.getByTestId('filet-action').count() === 0, await bloc.innerText())
  bloc = await rechargerAvec(etatFabrique('sans_jeton', 2))
  verifie('« sans jeton » (un vrai manque de jeton) reste « Coller le jeton »', /Il manque le jeton du réveil/.test(await bloc.getByTestId('filet-detail').textContent()) && (await bloc.getByTestId('filet-action').textContent()).trim() === 'Coller le jeton', await bloc.innerText())
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
  console.log(`\nverifier-filet-ecran : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
