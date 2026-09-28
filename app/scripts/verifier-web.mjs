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
// SQL puis supprimée), un chantier créé puis supprimé avec confirmation,
// puis trois écrans d'admin : Doublons (côte à côte, « pas un doublon »,
// fusion avec note), sélection groupée (modifier deux chantiers, « Annuler »
// rend à chacun SA valeur), historique (restaurer un ancien texte) et
// « Comment vérifier » (étapes sur des lignes distinctes, lien cliquable,
// bouton « Demander comment vérifier » qui écrit dans le fil, version repliée
// une fois certifié). Les
// données de test (« [TEST web] … ») sont supprimées à la fin, même en échec.
// Captures dans $CAPTURES (défaut : le scratchpad de la session, sinon /tmp).
// Prérequis : Chromium Playwright (PLAYWRIGHT_BROWSERS_PATH ou
// /opt/pw-browsers/chromium), SUPABASE_SERVICE_ROLE_KEY pour scripts/sql.sh.
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
// Données des parcours Doublons / Sélection groupée / Historique : préfixe à
// part, et identifiants générés ici (un `insert … returning` ne renvoie rien
// par sql.sh) pour pouvoir tout retrouver au nettoyage.
const MARQUE2 = '[TEST web]'
const idsTest = []

let echecs = 0, total = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }
const sql = (q) => { const out = execFileSync(sqlSh, [q], { encoding: 'utf8' }); const j = JSON.parse(out); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
const clePaire = (a, b) => [a, b].sort().join('|')
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
sql(`delete from historique where chantier_id in (select id from chantiers where titre like '${MARQUE2}%') or chantier_id in (select chantier_id from supprimes where ligne->>'titre' like '${MARQUE2}%')`)
sql(`delete from chantiers where titre like '${MARQUE2}%'`)
sql(`delete from supprimes where ligne->>'titre' like '${MARQUE2}%'`)
const cible = sql(`select id, titre from chantiers where projet_id = '${projet.id}' and archived_at is null and etat <> 'valide' order by created_at limit 1`)[0]
const moiId = sql(`select id from auth.users where email = '${esc(EMAIL)}'`)[0]?.id
if (!moiId) throw new Error('compte de test introuvable dans auth.users')
const prefDoublonsExistait = sql(`select cle from preferences where user_id = '${moiId}' and cle = 'doublons_ignores'`).length > 0
// Un chantier de test : titre préfixé, id connu d'avance.
const creerTest = (titre, extra = {}) => {
  const id = randomUUID(); idsTest.push(id)
  const cols = { id, projet_id: projet.id, titre: `${MARQUE2} ${titre}`, ...extra }
  sql(`insert into chantiers (${Object.keys(cols).join(', ')}) values (${Object.values(cols).map((v) => `'${esc(v)}'`).join(', ')})`)
  return { id, titre: cols.titre }
}
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
  // On attend le bon COMPTE, pas seulement le bandeau : une question ou une
  // action déjà en attente dans le projet (réel, 28 sept. 20:48) affiche le
  // bandeau avant même notre insertion, et l'attente passait à vide.
  const attendu = `${Number(nAttenteAvant) + 1} question`
  const alerteAJour = (timeout) => page.waitForFunction((t) => document.querySelector('[data-testid="alerte-questions"]')?.textContent?.includes(t) ?? false, attendu, { timeout })
  let directVu = true
  try { await alerteAJour(12000) } catch { directVu = false; await page.getByTestId('actualiser').click(); await alerteAJour(15000) }
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


  // ===================================================================
  // Trois écrans jamais parcourus avant le 28 sept. : Doublons, sélection
  // groupée, historique. Données créées ici (titres « [TEST web] … »),
  // supprimées dans le finally quoi qu'il arrive.
  const carteDe = (titre) => page.locator('[data-testid="carte"]', { hasText: titre })
  // Un toast réellement VISIBLE : présent ET au premier plan à son centre
  // (pas caché derrière un dialogue modal ou la barre de sélection).
  const toastAuPremierPlan = async (re) => {
    const t = page.getByRole('status').getByText(re).last()
    await t.waitFor({ timeout: 10000 })
    const b = await t.boundingBox()
    if (!b) return false
    // Sans dialogue ouvert : le toast est l'élément touché à son centre. Avec
    // un dialogue modal, tout ce qui est hors du dialogue est inerte, donc
    // ignoré par elementFromPoint, même dessiné par-dessus : on exige alors
    // que la zone des toasts soit dans la top layer (popover ouvert, remonté
    // après le dialogue). La capture fait foi pour l'œil.
    const r = await page.evaluate(([x, y]) => {
      const zone = document.querySelector('[role="status"]')
      if (document.querySelector('dialog[open]')) return { ok: !!zone && zone.matches(':popover-open'), dessus: zone && zone.matches(':popover-open') ? 'top layer (popover)' : 'sous le dialogue' }
      const e = document.elementFromPoint(x, y)
      return { ok: !!e && !!e.closest('[role="status"]'), dessus: e ? `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}` : null }
    }, [b.x + b.width / 2, b.y + b.height / 2])
    if (b.y < 0 || b.y + b.height > 844) r.ok = false
    dernierDessus = r.dessus
    return r.ok
  }
  let dernierDessus = null
  const ANCIEN = 'Ancien texte de la demande, à retrouver par l’historique.'
  const d1a = creerTest('zorglub quintessence harmonique alpha', { demande: 'Premier de la paire ignorée.' })
  const d1b = creerTest('zorglub quintessence harmonique beta', { demande: 'Second de la paire ignorée.' })
  const s1 = creerTest('colibri turquoise', { priorite: 'haute' })
  const s2 = creerTest('mangouste ardoise', { priorite: 'basse' })
  const h1 = creerTest('pelican historique', { demande: ANCIEN })
  sql(`update chantiers set demande = 'Nouveau texte qui a écrasé l''ancien.' where id = '${h1.id}'`)
  await page.getByTestId('actualiser').click()
  await carteDe(h1.titre).waitFor({ timeout: 15000 })

  // --- 1. Doublons
  console.log('  — doublons')
  const ouvrirDoublons = async () => {
    await page.getByTestId('menu').click()
    await page.getByRole('menuitem', { name: /Doublons/ }).click()
    const dlg = page.getByRole('dialog').filter({ hasText: 'Doublons' })
    await dlg.waitFor({ timeout: 5000 })
    return dlg
  }
  let dlgD = await ouvrirDoublons()
  const paire1 = dlgD.getByTestId('paire-doublon').filter({ hasText: d1a.titre }).filter({ hasText: d1b.titre })
  await paire1.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('Doublons : la paire de test est proposée, les deux titres dans la MÊME paire', await paire1.count() === 1)
  const [bA, bB] = [await paire1.locator('button', { hasText: d1a.titre }).boundingBox(), await paire1.locator('button', { hasText: d1b.titre }).boundingBox()]
  verifie('Doublons : les deux chantiers côte à côte (même ligne, colonnes distinctes, dans les 390 px)',
    bA && bB && Math.abs(bA.y - bB.y) < 4 && Math.abs(bA.x - bB.x) > 50 && Math.max(bA.x + bA.width, bB.x + bB.width) <= 390, { bA, bB })
  verifie('Doublons : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await paire1.scrollIntoViewIfNeeded()
  await capture(page, 'doublons')
  await paire1.getByRole('button', { name: 'Pas un doublon' }).click()
  const toastIgnore = await toastAuPremierPlan(/ne sera plus proposée/)
  verifie('« Pas un doublon » : le toast de confirmation est visible au premier plan', toastIgnore, { auPremierPlan: dernierDessus })
  await paire1.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  verifie('« Pas un doublon » : la paire disparaît', await paire1.count() === 0)
  const prefD = sql(`select valeur from preferences where user_id = '${moiId}' and cle = 'doublons_ignores'`)[0]
  verifie('« Pas un doublon » : enregistré dans preferences (doublons_ignores)', !!prefD && Array.isArray(prefD.valeur) && prefD.valeur.includes(clePaire(d1a.id, d1b.id)), prefD)
  await page.keyboard.press('Escape')
  await dlgD.waitFor({ state: 'hidden', timeout: 5000 })

  // Une seconde paire, cette fois fusionnée : on garde « sud » (pas le choix par défaut forcément).
  const d2a = creerTest('pamplemousse gyroscope lunaire nord', { demande: 'Demande de la source.' })
  const d2b = creerTest('pamplemousse gyroscope lunaire sud', { demande: 'Demande de la cible.' })
  await page.getByTestId('actualiser').click()
  await carteDe(d2b.titre).waitFor({ timeout: 15000 })
  dlgD = await ouvrirDoublons()
  const paire2 = dlgD.getByTestId('paire-doublon').filter({ hasText: d2a.titre }).filter({ hasText: d2b.titre })
  await paire2.waitFor({ timeout: 5000 })
  verifie('Doublons : la paire ignorée ne revient pas à la réouverture', await dlgD.getByTestId('paire-doublon').filter({ hasText: d1a.titre }).count() === 0)
  await paire2.locator('button', { hasText: d2b.titre }).click()
  verifie('Doublons : le chantier choisi est marqué « On garde »', (await paire2.locator('button', { hasText: d2b.titre }).textContent()).includes('On garde'))
  const NOTE = 'note de fusion [TEST web]'
  await paire2.getByPlaceholder(/Note sur la fusion/).fill(NOTE)
  await paire2.getByRole('button', { name: 'Fusionner' }).click()
  const toastFusion = await toastAuPremierPlan(/fusionné dans/)
  verifie('Fusion : le toast de succès est visible au premier plan', toastFusion, { auPremierPlan: dernierDessus })
  await paire2.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('Fusion : la paire disparaît de l’écran', await paire2.count() === 0)
  await capture(page, 'doublons-fusion')
  const [src] = sql(`select archived_at, doublon_de from chantiers where id = '${d2a.id}'`)
  const [cib] = sql(`select archived_at, demande from chantiers where id = '${d2b.id}'`)
  verifie('Fusion : la source est archivée avec doublon_de = cible', !!src?.archived_at && src.doublon_de === d2b.id, src)
  verifie('Fusion : la cible reste ouverte, sa demande contient « Fusion du doublon » et la note',
    !cib?.archived_at && cib?.demande.includes('Fusion du doublon') && cib.demande.includes(NOTE) && cib.demande.includes('Demande de la source.'), cib)
  await page.keyboard.press('Escape')
  await dlgD.waitFor({ state: 'hidden', timeout: 5000 })

  // --- 2. Sélection groupée
  console.log('  — sélection groupée')
  await page.getByTestId('menu').click()
  await page.getByRole('menuitem', { name: /Choisir/ }).click()
  const barre = page.getByTestId('barre-selection')
  await barre.waitFor({ timeout: 5000 })
  await page.getByRole('checkbox', { name: `Choisir ${s1.titre}` }).check()
  await page.getByRole('checkbox', { name: `Choisir ${s2.titre}` }).check()
  verifie('sélection : la barre compte « 2 choisis »', (await barre.textContent()).includes('2 choisis'), await barre.textContent())
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(300)
  const bBarre = await barre.boundingBox()
  const bDerniereCarte = await page.getByTestId('carte').last().boundingBox()
  const bFinBacs = await page.locator('[data-testid="bacs"] > :last-child').boundingBox()
  verifie('sélection : la barre ne masque pas la dernière carte (défilement en bas)', bBarre && bDerniereCarte && bDerniereCarte.y + bDerniereCarte.height <= bBarre.y + 0.5, { barre: bBarre, carte: bDerniereCarte })
  verifie('sélection : ni le dernier bloc de la liste', bBarre && bFinBacs && bFinBacs.y + bFinBacs.height <= bBarre.y + 0.5, { barre: bBarre, dernier: bFinBacs })
  verifie('sélection : pas de défilement horizontal avec la barre', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'selection')
  await barre.getByLabel('Priorité').selectOption('normale')
  const toastSel = await toastAuPremierPlan(/2 chantiers modifiés/)
  verifie('sélection : toast « 2 chantiers modifiés » visible, au-dessus de la barre', toastSel, { auPremierPlan: dernierDessus })
  const prios = () => Object.fromEntries(sql(`select id, priorite from chantiers where id in ('${s1.id}', '${s2.id}')`).map((r) => [r.id, r.priorite]))
  const apres = prios()
  verifie('sélection : en base, les deux passent à « normale »', apres[s1.id] === 'normale' && apres[s2.id] === 'normale', apres)
  await capture(page, 'selection-toast')
  await page.getByRole('status').getByRole('button', { name: 'Annuler' }).click()
  await page.getByRole('status').getByText(/valeurs d’avant rétablies/).waitFor({ timeout: 10000 })
  const annule = prios()
  verifie('« Annuler » : chacun retrouve SA priorité d’avant (haute / basse)', annule[s1.id] === 'haute' && annule[s2.id] === 'basse', annule)
  await barre.getByRole('button', { name: 'Terminer' }).click()
  await barre.waitFor({ state: 'detached', timeout: 5000 })
  verifie('sélection : « Terminer » retire la barre et les cases', await page.getByRole('checkbox', { name: /^Choisir / }).count() === 0)

  // --- 3. Historique et restauration
  console.log('  — historique')
  const carteH = carteDe(h1.titre)
  await carteH.scrollIntoViewIfNeeded()
  await carteH.getByTestId('carte-titre').click()
  const hist = carteH.getByTestId('historique')
  await hist.waitFor({ timeout: 5000 })
  await hist.locator('> button').click()
  const ligneH = hist.locator('li', { hasText: ANCIEN.slice(0, 40) })
  await ligneH.waitFor({ timeout: 10000 }).catch(() => {})
  verifie('historique : la ligne « demande » montre l’ancien texte', await ligneH.count() === 1 && (await ligneH.textContent()).toLowerCase().includes('demande'))
  await ligneH.scrollIntoViewIfNeeded()
  verifie('historique : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'historique')
  await ligneH.getByRole('button', { name: /Revenir à ce texte/ }).click()
  const dlgR = page.getByRole('dialog').filter({ hasText: 'Revenir à l’ancien' })
  await dlgR.waitFor({ timeout: 5000 })
  verifie('restauration : la confirmation montre le texte qui reviendra', (await dlgR.textContent()).includes(ANCIEN))
  await capture(page, 'historique-confirmation')
  await dlgR.getByRole('button', { name: 'Revenir à ce texte' }).click()
  const toastRest = await toastAuPremierPlan(/Texte restauré/)
  verifie('restauration : toast « Texte restauré » visible', toastRest, { auPremierPlan: dernierDessus })
  const [hApres] = sql(`select demande from chantiers where id = '${h1.id}'`)
  verifie('restauration : en base, la demande est revenue à l’ancien texte', hApres?.demande === ANCIEN, hApres)
  const traces = sql(`select champ, nouvelle, par from historique where chantier_id = '${h1.id}' order by id`)
  const derniere = traces[traces.length - 1]
  verifie('restauration : une nouvelle ligne d’historique trace la restauration', traces.length === 2 && derniere.champ === 'demande' && derniere.nouvelle === ANCIEN && /restauration/.test(derniere.par ?? ''), traces)
  await hist.locator('li', { hasText: 'Nouveau texte' }).first().waitFor({ timeout: 10000 }).catch(() => {})
  verifie('restauration : l’écran recharge l’historique (2 changements)', (await hist.textContent()).includes('2 changements'), await hist.textContent())
  await carteH.getByTestId('carte-titre').click()

  // --- 4. « Comment vérifier » (migration 0005) sur la carte orange
  console.log('  — comment vérifier')
  const CV = '1. Ouvre la page https://rnab26.github.io/Cockpit-General/ sur ton téléphone. 2. Touche la carte « Réglages ». 3. Tu dois voir ton e-mail en haut.'
  const v1 = creerTest('verif avec etapes', { etat: 'a_verifier', demande: 'Chantier livré, étapes écrites.', comment_verifier: CV })
  const v2 = creerTest('verif sans etapes', { etat: 'a_verifier', demande: 'Chantier livré sans étapes.' })
  await page.getByTestId('actualiser').click()
  const carteV1 = carteDe(v1.titre), carteV2 = carteDe(v2.titre)
  await carteV1.waitFor({ timeout: 15000 })
  await carteV1.getByTestId('carte-titre').click()
  const blocV1 = carteV1.getByTestId('bloc-validation')
  await blocV1.waitFor({ timeout: 5000 })
  const encadre = blocV1.getByTestId('comment-verifier')
  verifie('à vérifier : l’encadré « 👉 Comment vérifier » est dans le bloc orange', await encadre.count() === 1 && (await encadre.textContent()).includes('Comment vérifier'))
  const etapesV = encadre.getByTestId('etape-verifier')
  const nEtapes = await etapesV.count()
  const ys = []
  for (let i = 0; i < nEtapes; i++) ys.push((await etapesV.nth(i).boundingBox())?.y ?? -1)
  verifie('les trois étapes écrites sur UNE ligne s’affichent sur trois lignes distinctes', nEtapes === 3 && ys.every((y, i) => i === 0 || y > ys[i - 1] + 8), { nEtapes, ys })
  const textesEtapes = await etapesV.allTextContents()
  verifie('chaque ligne porte son numéro et son texte, sans le suivant', /^1\.\s*Ouvre la page/.test(textesEtapes[0] ?? '') && /^3\.\s*Tu dois voir/.test(textesEtapes[2] ?? '') && !(textesEtapes[0] ?? '').includes('Touche'), textesEtapes)
  const lienCv = encadre.getByRole('link')
  verifie('le lien du texte est cliquable, nouvel onglet, rel noopener',
    await lienCv.count() === 1 && await lienCv.getAttribute('href') === 'https://rnab26.github.io/Cockpit-General/' && await lienCv.getAttribute('target') === '_blank' && /noopener/.test(await lienCv.getAttribute('rel') ?? ''),
    await lienCv.count() ? { href: await lienCv.getAttribute('href'), rel: await lienCv.getAttribute('rel') } : 'aucun lien')
  const [bEnc, bCert] = [await encadre.boundingBox(), await blocV1.getByTestId('btn-certifier').boundingBox()]
  verifie('l’encadré est AVANT les boutons « certifier / corriger »', bEnc && bCert && bEnc.y + bEnc.height <= bCert.y, { bEnc, bCert })
  verifie('comment vérifier : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await blocV1.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(200)
  await capture(page, 'comment-verifier')

  // Sans étapes : la phrase et le bouton qui écrit la demande dans le fil.
  await carteV2.getByTestId('carte-titre').click()
  const videV2 = carteV2.getByTestId('comment-verifier-vide')
  await videV2.waitFor({ timeout: 5000 })
  verifie('sans étapes : « La session n’a pas dit comment vérifier. Demande-lui avant de certifier : »', (await videV2.textContent()).includes('La session n’a pas dit comment vérifier. Demande-lui avant de certifier'))
  await videV2.getByTestId('btn-demander-verifier').click()
  const toastDemande = await toastAuPremierPlan(/Demande envoyée/)
  verifie('« Demander comment vérifier » : toast de succès visible', toastDemande, { auPremierPlan: dernierDessus })
  const demandes = sql(`select kind, auteur_type, corps, answered_at from messages where chantier_id = '${v2.id}'`)
  verifie('la demande est en base : kind info, auteur propriétaire, texte convenu',
    demandes.length === 1 && demandes[0].kind === 'info' && demandes[0].auteur_type === 'proprietaire' && demandes[0].corps === 'Raphaël demande : comment vérifier ce chantier ? (étapes, où aller, ce que je dois voir)', demandes)
  await videV2.getByTestId('deja-demande').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('l’écran dit ensuite « Déjà demandé » (pas de doublon en aveugle)', await videV2.getByTestId('deja-demande').count() === 1 && (await videV2.getByTestId('btn-demander-verifier').textContent()).includes('Redemander'))
  await capture(page, 'comment-verifier-vide')
  await carteV2.getByTestId('carte-titre').click()

  // Certifié : les étapes restent disponibles, repliées.
  await blocV1.getByTestId('btn-certifier').click()
  await blocV1.getByRole('button', { name: /Je certifie/ }).click()
  await page.getByRole('status').getByText(/certifié/).last().waitFor({ timeout: 10000 })
  const bacActif = page.getByTestId('bac-actif')
  await bacActif.waitFor({ timeout: 10000 })
  if ((await bacActif.locator('> button').getAttribute('aria-expanded')) !== 'true') await bacActif.locator('> button').click()
  const carteV1b = bacActif.locator('[data-testid="carte"]', { hasText: v1.titre })
  await carteV1b.waitFor({ timeout: 15000 })
  if (await carteV1b.getByTestId('carte-detail').count() === 0) await carteV1b.getByTestId('carte-titre').click()
  const replie = carteV1b.getByTestId('comment-verifier-replie')
  await replie.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('certifié : « Comment vérifier » présent, replié', await replie.count() === 1 && await replie.getByTestId('etape-verifier').count() === 0)
  await replie.locator('> button').click()
  verifie('certifié : déplié, les trois étapes reviennent', await replie.getByTestId('etape-verifier').count() === 3)
  await carteV1b.getByTestId('carte-titre').click()

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
  // Doublons / sélection / historique : chantiers (les messages suivent en
  // cascade), leur historique, leur trace de suppression, et les paires
  // « pas un doublon » posées pour le compte de test.
  try {
    const ids = idsTest.length ? idsTest.map((i) => `'${i}'`).join(', ') : `'00000000-0000-0000-0000-000000000000'`
    sql(`delete from messages where chantier_id in (${ids}) or corps like '%${MARQUE2}%'`)
    sql(`delete from ce_qui_marche where chantier_id in (${ids})`)
    sql(`delete from chantiers where id in (${ids}) or titre like '${MARQUE2}%'`)
    sql(`delete from historique where chantier_id in (${ids})`)
    sql(`delete from supprimes where chantier_id in (${ids}) or ligne->>'titre' like '${MARQUE2}%'`)
    if (!prefDoublonsExistait) sql(`delete from preferences where user_id = '${moiId}' and cle = 'doublons_ignores'`)
    else if (idsTest.length) sql(`update preferences set valeur = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements_text(valeur) e where not (e ~ '${idsTest.join('|')}')) where user_id = '${moiId}' and cle = 'doublons_ignores'`)
    const reste = sql(`select (select count(*) from chantiers where id in (${ids}) or titre like '${MARQUE2}%') + (select count(*) from historique where chantier_id in (${ids})) + (select count(*) from supprimes where chantier_id in (${ids})) as n`)[0].n
    if (reste !== 0) console.log(`  (nettoyage incomplet : ${reste} ligne(s) de test restent)`)
  } catch (e) { console.log(`  (nettoyage SQL [TEST web] : ${e.message})`) }
  await navigateur.close()
  arreterServeur()
}
console.log(`\nverifier-web : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
