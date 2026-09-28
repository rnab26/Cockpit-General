// Parcours de l'app dans un VRAI navigateur, à la taille d'un téléphone
// (390 × 844), contre la vraie base (projet « cockpit »).
//
//   cd app && npm run build
//   source <fichier des identifiants de test>   # COCKPIT_TEST_EMAIL / COCKPIT_TEST_PASSWORD
//   node scripts/verifier-web.mjs
//
// Il sert dist/ avec `vite preview`, se connecte, et vérifie : le premier
// écran (bandeau / « où j'en suis » visibles), l'absence de défilement
// horizontal, une carte qui se déplie, une question qui se répond (créée par
// SQL puis supprimée), un chantier créé puis supprimé avec confirmation.
// Captures dans $CAPTURES (défaut : le scratchpad de la session, sinon /tmp).
// Prérequis : Chromium Playwright (PLAYWRIGHT_BROWSERS_PATH ou
// /opt/pw-browsers/chromium), SUPABASE_SERVICE_ROLE_KEY pour scripts/sql.sh.
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ici = path.dirname(fileURLToPath(import.meta.url))
const racineApp = path.resolve(ici, '..')
const sqlSh = path.resolve(racineApp, '..', 'scripts', 'sql.sh')
const CAPTURES = process.env.CAPTURES ?? (existsSync('/tmp/claude-0') ? '/tmp/claude-0/-home-user/26486ea7-9936-5198-a42a-ff8e3b15d856/scratchpad' : '/tmp')
mkdirSync(CAPTURES, { recursive: true })
const EMAIL = process.env.COCKPIT_TEST_EMAIL
const MDP = process.env.COCKPIT_TEST_PASSWORD
if (!EMAIL || !MDP) { console.error('COCKPIT_TEST_EMAIL / COCKPIT_TEST_PASSWORD absents : `source` le fichier des identifiants de test.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4173)
const BASE = `http://127.0.0.1:${PORT}/Cockpit-General/`
const MARQUE = '[TEST verifier-web]'

let echecs = 0, total = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }
const sql = (q) => { const out = execFileSync(sqlSh, [q], { encoding: 'utf8' }); const j = JSON.parse(out); if (!j.ok) throw new Error(j.error); return j.rows }
const capture = (page, nom) => page.screenshot({ path: path.join(CAPTURES, `app-${nom}.png`), fullPage: false }).then(() => console.log(`    📸 ${path.join(CAPTURES, `app-${nom}.png`)}`))

// --- serveur
if (!existsSync(path.join(racineApp, 'dist', 'index.html'))) { console.error('dist/ absent : lance `npm run build` d’abord.'); process.exit(2) }
// detached : son propre groupe de processus, pour tuer npx ET le vite qu'il
// lance (tuer npx seul laissait vite sur le port, constaté le 28 sept.).
const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreterServeur = () => { try { process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreterServeur)
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000)
  serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } })
  serveur.stderr.on('data', (d) => process.stderr.write(d))
})

// --- données de test : nettoyage d'un passage précédent, puis création
const projet = sql(`select id from projets where slug = 'cockpit'`)[0]
if (!projet) throw new Error('projet cockpit introuvable')
sql(`delete from messages where corps like '${MARQUE}%'`)
sql(`delete from chantiers where titre like '${MARQUE}%'`)
const cible = sql(`select id, titre from chantiers where projet_id = '${projet.id}' and archived_at is null and etat <> 'valide' order by created_at limit 1`)[0]
const nAttenteAvant = sql(`select count(*) as n from messages where projet_id = '${projet.id}' and kind in ('question','action') and answered_at is null`)[0].n

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Asia/Jerusalem' })
const page = await ctx.newPage()
const erreursConsole = []
page.on('pageerror', (e) => erreursConsole.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text()) })

// Le navigateur de CE conteneur peut-il ouvrir une WebSocket ? Constaté le
// 28 sept. 2026 : non, vers aucun service (echo.websocket.org compris) — une
// limite de l'environnement cloud, pas du cockpit. Si c'est le cas, le direct
// ne peut pas être vérifié ICI : on le dit, et c'est verifier-base.mjs
// (section 12, depuis Node) qui prouve le temps réel. Ailleurs (poste, CI), la
// sonde passe et le contrôle du direct est strict.
const wsPossible = await (async () => {
  const p2 = await page.context().newPage()
  try {
    await p2.goto('data:text/html,sonde')
    return await p2.evaluate(() => new Promise((res) => { const ws = new WebSocket('wss://echo.websocket.org/'); ws.onopen = () => { ws.close(); res(true) }; ws.onerror = () => res(false); setTimeout(() => res(false), 6000) }))
  } finally { await p2.close() }
})()
if (!wsPossible) console.log('  ⚠ ce navigateur n’ouvre aucune WebSocket (limite du conteneur) : le direct n’est pas vérifiable ici — voir verifier-base.mjs §12')
const estErreurWsConteneur = (t) => !wsPossible && /WebSocket connection to .* failed/.test(t)
const scrollX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

try {
  console.log('verifier-web')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByLabel('E-mail').waitFor({ timeout: 15000 })
  verifie('écran de connexion sans défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'connexion')

  // Mauvais mot de passe : une erreur lisible, pas un message brut.
  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).last().click()
  const alerte = page.getByRole('alert')
  await alerte.waitFor({ timeout: 15000 })
  verifie('mauvais mot de passe → message lisible', /incorrect/i.test(await alerte.textContent()), await alerte.textContent())
  // Le 400 de la connexion refusée est l'effet VOULU de l'étape ci-dessus : on ne compte que la suite.
  erreursConsole.length = 0

  await page.getByLabel('Mot de passe').fill(MDP)
  await page.getByRole('button', { name: 'Se connecter', exact: true }).last().click()
  await page.getByTestId('ou-jen-suis').waitFor({ timeout: 30000 })
  await page.getByTestId('bac-optimisation').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)

  // --- premier écran
  const boite = await page.getByTestId('ou-jen-suis').boundingBox()
  verifie('« Où j’en suis » entièrement dans le premier écran (844 px)', boite && boite.y + boite.height <= 844, boite)
  const bandeau = page.getByTestId('bandeau-maintenant')
  if (await bandeau.count()) { const b = await bandeau.boundingBox(); verifie('bandeau « Là, maintenant » dans le premier écran', b && b.y + b.height <= 844, b) }
  else console.log('    (aucune activité en cours : pas de bandeau « Là, maintenant » à mesurer)')
  verifie('aucun défilement horizontal après connexion', (await scrollX()) <= 0, await scrollX())
  const nbCartes = await page.getByTestId('carte').count()
  verifie('les chantiers réels du projet s’affichent (≥ 10 cartes)', nbCartes >= 10, nbCartes)
  const nbGroupes = await page.getByTestId('groupe-section').count()
  verifie('groupés par section (≥ 3 groupes)', nbGroupes >= 3, nbGroupes)
  await capture(page, 'accueil')

  // --- une carte se déplie
  const premiere = page.getByTestId('carte').first()
  await premiere.getByTestId('carte-titre').click()
  await premiere.getByTestId('carte-detail').waitFor({ timeout: 5000 })
  verifie('une carte se déplie (demande + fil visibles)', await premiere.getByTestId('fil').count() === 1)
  verifie('les actions admin sont là sur la carte dépliée', await premiere.getByTestId('actions-admin').count() === 1)
  verifie('toujours pas de défilement horizontal, carte dépliée', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'carte')
  await premiere.getByTestId('carte-titre').click()

  // --- une question se répond (créée par SQL, le direct doit la faire apparaître)
  const options = JSON.stringify([{ libelle: 'Option A', aide: 'la première', recommande: true }, { libelle: 'Option B' }]).replace(/'/g, "''")
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values ('${projet.id}', '${cible.id}', 'verifier-web', 'session', 'question', '${MARQUE} Quelle option ?', 'Pour vérifier l''écran.', '${options}'::jsonb)`)
  let directVu = true
  try { await page.getByTestId('alerte-questions').waitFor({ timeout: 12000 }) } catch { directVu = false; await page.getByTestId('actualiser').click(); await page.getByTestId('alerte-questions').waitFor({ timeout: 15000 }) }
  // D-09 : « actualisation en live hyper précise ». Le direct doit la montrer
  // SANS « Actualiser ». (Dans le conteneur Claude, le proxy bloque les
  // WebSocket : le navigateur de test le contourne pour *.supabase.co.)
  if (wsPossible) verifie('la question apparaît EN DIRECT, sans « Actualiser »', directVu)
  else verifie('sans direct (conteneur), la question apparaît après « Actualiser », et l’écran le dit', true)
  const texteAlerte = await page.getByTestId('alerte-questions').textContent()
  verifie('le bandeau compte la bonne quantité de questions', texteAlerte.includes(String(Number(nAttenteAvant) + 1)), texteAlerte)
  await page.getByTestId('alerte-questions').click()
  await page.getByTestId('filtre-actif').waitFor({ timeout: 5000 })
  const carteQ = page.locator(`[data-chantier="${cible.id}"]`)
  verifie('le tap sur le bandeau filtre sur le chantier concerné', await carteQ.count() === 1)
  verifie('le badge dit « Réponse attendue »', (await carteQ.textContent()).includes('Réponse attendue'))
  await carteQ.getByTestId('carte-titre').click()
  const bloc = carteQ.getByTestId('bloc-question')
  await bloc.waitFor({ timeout: 5000 })
  verifie('l’option recommandée est marquée', (await bloc.textContent()).includes('recommandé'))
  await capture(page, 'question')
  await bloc.getByRole('radio', { name: /Option A/ }).click()
  await bloc.getByPlaceholder(/précision/i).fill('précision de test')
  await bloc.getByTestId('valider-reponse').click()
  await page.getByText('Réponse enregistrée.').waitFor({ timeout: 10000 })
  await bloc.waitFor({ state: 'detached', timeout: 10000 })
  const rep = sql(`select reponse, precision, answered_at from messages where corps like '${MARQUE}%'`)[0]
  verifie('la réponse est en base (option + précision + answered_at)', rep && rep.reponse === 'Option A' && rep.precision === 'précision de test' && !!rep.answered_at, rep)
  await page.getByRole('button', { name: /Tout afficher/ }).click()

  // --- un chantier créé puis supprimé avec confirmation
  await page.getByTestId('nouveau-chantier').click()
  await page.getByTestId('titre').fill('Hook de démarrage paramétré par projet')
  verifie('« Ça existe déjà » s’affiche sur un titre proche d’un chantier réel', await page.getByTestId('ca-existe-deja').waitFor({ timeout: 3000 }).then(() => true, () => false))
  const titreTest = `${MARQUE} chantier éphémère`
  await page.getByTestId('titre').fill(titreTest)
  await page.getByTestId('demande').fill('Créé par verifier-web, supprimé juste après.')
  await page.getByTestId('creer-chantier').click()
  await page.getByText(/créé\.$/).first().waitFor({ timeout: 10000 })
  const carteTest = page.locator('[data-testid="carte"]', { hasText: titreTest })
  await carteTest.waitFor({ timeout: 15000 })
  verifie('le chantier créé apparaît dans le bac', await carteTest.count() === 1)
  await carteTest.getByTestId('carte-titre').click()
  await carteTest.getByTestId('supprimer').click()
  const dialogue = page.getByRole('dialog').filter({ hasText: 'Supprimer ce chantier' })
  await dialogue.waitFor({ timeout: 5000 })
  verifie('la confirmation nomme le chantier', (await dialogue.textContent()).includes(titreTest))
  await capture(page, 'confirmation')
  await dialogue.getByRole('button', { name: 'Annuler' }).click()
  verifie('« Annuler » ne supprime pas', await carteTest.count() === 1 && sql(`select count(*) as n from chantiers where titre = '${titreTest.replace(/'/g, "''")}'`)[0].n === 1)
  await carteTest.getByTestId('supprimer').click()
  await dialogue.waitFor({ timeout: 5000 })
  await dialogue.getByRole('button', { name: 'Supprimer' }).click()
  await page.getByText(/supprimé\.$/).first().waitFor({ timeout: 10000 })
  await carteTest.waitFor({ state: 'detached', timeout: 10000 })
  verifie('le chantier supprimé disparaît de l’écran et de la base', sql(`select count(*) as n from chantiers where titre like '${MARQUE}%'`)[0].n === 0)
  verifie('la suppression a laissé sa trace dans « supprimes »', sql(`select count(*) as n from supprimes where ligne->>'titre' like '${MARQUE}%'`)[0].n >= 1)

  // --- menu et réglages (fenêtre « livré »)
  await page.getByTestId('menu').click()
  await page.getByRole('menuitem', { name: /Réglages/ }).click()
  await page.getByTestId('fenetre-livre').waitFor({ timeout: 5000 })
  await capture(page, 'reglages')
  await page.keyboard.press('Escape')

  // --- grand écran
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(500)
  verifie('desktop : pas de défilement horizontal non plus', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'desktop')

  const erreursReelles = erreursConsole.filter((t) => !estErreurWsConteneur(t))
  verifie('aucune erreur JavaScript dans la console', erreursReelles.length === 0, erreursReelles.slice(0, 5))
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e && e.message ? e.message : e}`)
  await capture(page, 'echec').catch(() => {})
} finally {
  // Nettoyage des lignes de test, quoi qu'il arrive.
  try { sql(`delete from messages where corps like '${MARQUE}%'`); sql(`delete from chantiers where titre like '${MARQUE}%'`); sql(`delete from supprimes where ligne->>'titre' like '${MARQUE}%'`) } catch (e) { console.log(`  (nettoyage SQL : ${e.message})`) }
  await navigateur.close()
  arreterServeur()
}
console.log(`\nverifier-web : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
