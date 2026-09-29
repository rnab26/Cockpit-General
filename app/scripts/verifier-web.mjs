// Parcours de l'app dans un VRAI navigateur, à la taille d'un téléphone
// (390 × 844), contre la vraie base (projets « cockpit » et « facepro »).
//
//   cd app && npm run build
//   source <fichier des identifiants de test>   # COCKPIT_TEST_EMAIL / COCKPIT_TEST_PASSWORD
//   node scripts/verifier-web.mjs
//
// Il sert dist/ avec `vite preview`, se connecte, et vérifie l'écran A + D
// (29 sept. 2026, « vas-y fais A + D ») :
//  - l'ACCUEIL = l'onglet « Tout », modèle A : quatre tuiles (pour toi · ça
//    avance · en pause · fini) = les longueurs des trois listes, le détail par
//    projet/section replié qui compte les mêmes chantiers ; « À toi de jouer »
//    (une ligne, le sujet, ce qu'on attend en mots simples, UN verbe) ;
//  - la PRÉSENCE honnête dans « Ça avance tout seul » (une ligne par CHANTIER) :
//    barre vive seulement avec une preuve de vie, « Plus de nouvelles » /
//    « Personne dessus » + Relancer sinon ; le travail hors chantier en une
//    ligne ; le détail des sessions et agents replié ;
//  - chaque chantier s'ouvre en CONVERSATION (modèle D), positionnée sur ce
//    qu'il faut faire : répondre à une question (option + précision + photo),
//    trancher une fusion, tester (frise, comment vérifier, Ça marche / Corriger
//    avec photo), décider (à cadrer), débloquer, relancer un reporté, écrire à
//    Claude avec une photo, menu ⋯ (modifier, historique, doublon, archiver,
//    supprimer confirmé), « retour » du téléphone qui la ferme ;
//  - « Prêt à lancer » : « Lancer » copie la consigne du bon chantier ;
//  - et tout ce qui existait : réglages du projet (mise en ligne GitHub
//    simulée, mode autonome), création, réglages (délai de silence), Doublons,
//    sélection groupée avec « Annuler », historique et restauration, toasts
//    visibles au premier plan, aucun défilement horizontal, grand écran.
// Données de test : TOUTES dans un PROJET DE TEST dédié (« test-web-<aléatoire> »),
// créé au début par service_role et supprimé EN ENTIER dans le finally, même en
// échec — jamais dans « cockpit » ni « facepro » (29 sept. 2026 : Raphaël a vu
// « [TEST web] pres vivant » dans son vrai cockpit et l'a pris pour du vrai
// travail). Les projets réels ne sont que LUS (premier écran, FacePro). Captures dans $CAPTURES (défaut : le scratchpad de la session).
// Prérequis : Chromium Playwright (CHROMIUM ou /opt/pw-browsers/chromium),
// SUPABASE_SERVICE_ROLE_KEY pour scripts/sql.sh.
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { deflateSync, crc32 } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ici = path.dirname(fileURLToPath(import.meta.url))
const racineApp = path.resolve(ici, '..')
const sqlSh = path.resolve(racineApp, '..', 'scripts', 'sql.sh')
const CAPTURES = process.env.CAPTURES ?? (existsSync('/tmp/claude-0') ? '/tmp/claude-0/-home-user/26486ea7-9936-5198-a42a-ff8e3b15d856/scratchpad' : '/tmp')
mkdirSync(CAPTURES, { recursive: true })
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
// Sans mot de passe dans l'environnement (il vivait dans celui de la session
// qui a créé le compte), la connexion passe par un lien magique généré avec la
// clé service_role : le parcours reste le même, seule l'étape « mauvais mot de
// passe » est sautée (et dite sautée).
const MDP = process.env.COCKPIT_TEST_PASSWORD ?? null
if (!MDP && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Ni COCKPIT_TEST_PASSWORD ni SUPABASE_SERVICE_ROLE_KEY : impossible de se connecter.'); process.exit(2) }
const REF_SUPABASE = 'bexiyvmdbxcwxasgslxp'
const API_SUPABASE = `https://${REF_SUPABASE}.supabase.co`
const CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const sessionParLienMagique = async () => {
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY
  const lien = await (await fetch(`${API_SUPABASE}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: sr, Authorization: `Bearer ${sr}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const ses = await (await fetch(`${API_SUPABASE}/auth/v1/verify`, { method: 'POST', headers: { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json()
  if (!ses.access_token) throw new Error(`lien magique refusé : ${JSON.stringify(ses).slice(0, 200)}`)
  return ses
}
const PORT = Number(process.env.PORT ?? 4173)
const ORIGINE = `http://127.0.0.1:${PORT}`
const BASE = `${ORIGINE}/Cockpit-General/`
const MARQUE = '[TEST verifier-web]'
// Une image PNG réelle (1×1), pour les médias joints (0013).
const PNG_TEST = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
// Une vraie photo (gris uni 240 × 180) pour le crayon : on doit pouvoir dessiner dessus.
function pngUni(l, h, gris) {
  const bloc = (type, data) => { const t = Buffer.from(type); const n = Buffer.alloc(4); n.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(l * 3, gris)])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(Buffer.concat(Array(h).fill(ligne)))), bloc('IEND', Buffer.alloc(0))])
}
const PNG_PHOTO = pngUni(240, 180, 200)
// Un trait au doigt (souris : mêmes « pointer events ») en travers de la toile du crayon.
async function tracer(page) {
  const b = await page.getByTestId('annoter-toile').boundingBox()
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.3)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width * (0.2 + 0.07 * i), b.y + b.height * (0.3 + 0.05 * i))
  await page.mouse.up()
}
// Préfixe des chantiers de test, identifiants générés ici (un `insert …
// returning` ne renvoie rien par sql.sh) pour tout retrouver au nettoyage.
const MARQUE2 = '[TEST web]'
const SESSION_TEST = 'test-web/'
const idsTest = []
// Le texte exact de « Demander où ça en est » (src/lib/presence.ts).
const MESSAGE_OU_CA_EN_EST = 'Raphaël demande : où en est ce chantier ? Qu’est-ce qui est fait, qu’est-ce qui reste, qu’est-ce qui bloque ?'

let echecs = 0, total = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }
const sql = (q) => { const out = execFileSync(sqlSh, [q], { encoding: 'utf8' }); const j = JSON.parse(out); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
const clePaire = (a, b) => [a, b].sort().join('|')
const capture = (page, nom) => page.screenshot({ path: path.join(CAPTURES, `app-${nom}.png`), fullPage: false }).then(() => console.log(`    📸 ${path.join(CAPTURES, `app-${nom}.png`)}`))
const captureUx = (page, nom) => page.screenshot({ path: path.join(CAPTURES, `${nom}.png`), fullPage: false }).then(() => console.log(`    📸 ${path.join(CAPTURES, `${nom}.png`)}`))

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

// --- données de test : nettoyage d'un passage précédent
// Le projet de test : créé plus bas (après les captures de l'accueil réel), purgé à la fin.
const SLUG = `test-web-${randomUUID().slice(0, 8)}`
// GitHub est SIMULÉ (route Playwright) : pas de dépendance au réseau ni à la limite de 60 requêtes/h.
const DEPOT_TEST = 'rnab26/test-web-depot'
let githubMode = 'ok'
const runGitHub = (name, status, conclusion, minAgo) => ({ name, status, conclusion, head_branch: 'main', head_sha: 'abcdef1234567',
  created_at: new Date(Date.now() - (minAgo + 2) * 60_000).toISOString(), updated_at: new Date(Date.now() - minAgo * 60_000).toISOString(),
  run_started_at: new Date(Date.now() - (minAgo + 2) * 60_000).toISOString(), html_url: `https://github.com/${DEPOT_TEST}/actions/runs/1`, display_title: 'Un commit' })
let projet = null
// Ne supprime QUE des projets « test-web-… » : refuse tout le reste.
const purgerProjetsDeTest = (ids) => {
  if (!ids.length) return
  const liste = ids.map((i) => `'${esc(i)}'`).join(', ')
  const reels = sql(`select slug from projets where id in (${liste}) and slug not like 'test-web-%'`)
  if (reels.length) throw new Error(`REFUS : un id à purger n'est pas un projet de test : ${JSON.stringify(reels)}`)
  sql(`delete from projets where id in (${liste}) and slug like 'test-web-%'`)   // cascade : sections, chantiers, messages, activite, sessions, taches
  // Les médias du projet de test (le stockage n'est pas en cascade).
  const noms = sql(`select name from storage.objects where bucket_id = 'cockpit-medias' and split_part(name, '/', 1) in (${liste})`).map((r) => r.name)
  if (noms.length) execFileSync('curl', ['-sS', '-X', 'DELETE', `https://bexiyvmdbxcwxasgslxp.supabase.co/storage/v1/object/cockpit-medias`, '-H', `apikey: ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, '-H', `Authorization: Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, '-H', 'Content-Type: application/json', '-d', JSON.stringify({ prefixes: noms })])
  sql(`delete from historique where chantier_id in (select chantier_id from supprimes where projet_id in (${liste}))`)
  sql(`delete from supprimes where projet_id in (${liste})`)
}
const vieux = sql(`select id, slug from projets where slug like 'test-web-%'`)
if (vieux.length) { console.log(`  (purge de ${vieux.length} projet(s) de test d’une passe précédente : ${vieux.map((v) => v.slug).join(', ')})`); purgerProjetsDeTest(vieux.map((v) => v.id)) }
// Les restes des anciennes versions de ce script (qui écrivaient dans « cockpit ») :
sql(`delete from messages where corps like '${MARQUE}%'`)
sql(`delete from chantiers where titre like '${MARQUE}%'`)
sql(`delete from historique where chantier_id in (select id from chantiers where titre like '${MARQUE2}%') or chantier_id in (select chantier_id from supprimes where ligne->>'titre' like '${MARQUE2}%')`)
sql(`delete from chantiers where titre like '${MARQUE2}%'`)
sql(`delete from supprimes where ligne->>'titre' like '${MARQUE2}%'`)
sql(`delete from activite where session like '${SESSION_TEST}%'`)
sql(`delete from sessions where id like '${SESSION_TEST}%'`)
const moiId = sql(`select id from auth.users where email = '${esc(EMAIL)}'`)[0]?.id
if (!moiId) throw new Error('compte de test introuvable dans auth.users')
const prefDoublonsExistait = sql(`select cle from preferences where user_id = '${moiId}' and cle = 'doublons_ignores'`).length > 0
const prefSilenceAvant = sql(`select valeur from preferences where user_id = '${moiId}' and cle = 'silence_minutes'`)[0]
const silenceMin = [5, 10, 15, 30, 60].includes(Number(prefSilenceAvant?.valeur)) ? Number(prefSilenceAvant.valeur) : 15
// Un chantier de test : titre préfixé, id connu d'avance.
const creerTest = (titre, extra = {}) => {
  const id = randomUUID(); idsTest.push(id)
  const cols = { id, projet_id: projet.id, titre: `${MARQUE2} ${titre}`, ...extra }
  sql(`insert into chantiers (${Object.keys(cols).join(', ')}) values (${Object.values(cols).map((v) => `'${esc(v)}'`).join(', ')})`)
  return { id, titre: cols.titre }
}
const activiteTest = (chantierId, session, pct, ilYaMin) =>
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, updated_at) values ('${projet.id}', '${chantierId}', '${SESSION_TEST}${session}', '${esc(`${MARQUE2} étape ${session}`)}', ${pct}, 'en_cours', now() - interval '${ilYaMin} minutes')`)
const creerProjetTest = () => {
  const id = randomUUID()
  sql(`insert into projets (id, slug, nom, couleur, actif, description, depot) values ('${id}', '${SLUG}', 'Test auto (s’efface seul)', '#64748B', true, 'Projet créé et supprimé par app/scripts/verifier-web.mjs', '${DEPOT_TEST}')`)
  projet = { id }
  // Trois sections et de quoi remplir la liste (≥ 10 cartes, « Ça existe déjà »).
  const sections = ['Base', 'Écran', 'Module'].map((nom, i) => { const sid = randomUUID(); sql(`insert into sections (id, projet_id, nom, position) values ('${sid}', '${id}', '${nom}', ${i})`); return sid })
  const remplir = ['Hook de démarrage paramétré par projet', 'Scripts des sessions', 'Écran central', 'Doublons côte à côte', 'Fonction serveur', 'Script embarquable', 'Déploiement Pages', 'Skill dotfiles', 'Notifications v2']
  remplir.forEach((t, i) => creerTest(t, { section_id: sections[i % 3], etat: ['libre', 'a_trier', 'a_cadrer', 'reporte'][i % 4] }))
}
// Les questions ouvertes du projet de test (vide à sa création).
const nAttenteAvant = 0
// Qui travaille, tous projets, selon la même règle que l'écran (src/lib/sessions.ts, presence.ts).
const compterVivants = (slug = null) => {
  const f = slug ? ` and projet_id = (select id from projets where slug = '${slug}')` : ''
  return {
    barres: Number(sql(`select count(*) as n from (select distinct projet_id, session from activite where statut = 'en_cours' and updated_at > now() - interval '${silenceMin} minutes'${f}) x`)[0].n),
    sessions: Number(sql(`select count(*) as n from sessions s where s.fin_at is null and ((s.tour_en_cours and s.vu_at > now() - interval '30 minutes') or s.vu_at > now() - interval '${silenceMin} minutes' or exists (select 1 from taches t where t.session_id = s.id and t.statut = 'en_cours' and t.vu_at > now() - interval '2 hours'))${f.replace('projet_id', 's.projet_id')}`)[0].n),
  }
}

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Asia/Jerusalem' })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGINE })
// Le Chromium de l'environnement cloud Claude ne fait pas confiance au proxy
// TLS (ERR_CERT_AUTHORITY_INVALID, constaté le 29 sept.) : les appels HTTP à
// Supabase (et au site d'un projet, lu pour sa version en ligne) passent par
// Node, qui vérifie le certificat avec le bundle du proxy. Rien n'est désactivé ;
// le temps réel (WebSocket) reste hors d'atteinte, comme avant. GitHub, simulé
// plus bas, garde la priorité (la dernière route déclarée passe en premier).
await ctx.route(/^https:\/\//, async (route) => {
  const r = route.request()
  try {
    const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
    const headers = Object.fromEntries(res.headers)
    delete headers['content-encoding']; delete headers['content-length']
    await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
  } catch { await route.abort('failed') }
})
await ctx.route('https://api.github.com/**', (route) => {
  if (githubMode === 'limite') return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'API rate limit exceeded' }) })
  const test = route.request().url().includes(DEPOT_TEST)
  const workflow_runs = test
    ? [runGitHub('Déployer sur GitHub Pages', 'in_progress', null, 1), runGitHub('Vérifications', 'completed', 'success', 3)]
    : [runGitHub('Déployer sur GitHub Pages', 'completed', 'success', 30)]
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ total_count: workflow_runs.length, workflow_runs }) })
})
const page = await ctx.newPage()
const erreursConsole = []
page.on('pageerror', (e) => erreursConsole.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text() + (m.location()?.url ? ` [${m.location().url}]` : '')) })

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

// --- navigation
const allerTout = async () => { await page.getByTestId('onglet-tout').click(); await page.getByTestId('vue-tout').waitFor({ timeout: 10000 }) }
const ongletTest = () => page.getByTestId(`onglet-${SLUG}`)
const allerCockpit = async () => { await ongletTest().click(); await page.getByTestId('vue-projet').waitFor({ timeout: 10000 }) }
// Les sections de « Tous les chantiers » sont repliées par défaut : on les ouvre (et on rouvre si une section est apparue).
const deplierTout = async () => {
  const b = page.getByTestId('tout-deplier')
  if (await b.count() && (await b.textContent()).includes('Tout déplier')) { await b.click(); await page.waitForTimeout(150) }
}
const ligneId = (id) => page.locator(`[data-testid="tous-les-chantiers"] [data-testid="ligne-chantier"][data-chantier="${id}"]`)
const ligneDe = (titre) => page.locator('[data-testid="tous-les-chantiers"] [data-testid="ligne-chantier"]', { hasText: titre })
const actualiser = async () => { await page.getByTestId('actualiser').click(); await page.waitForTimeout(700) }
// La conversation ouverte (modèle D) et sa fermeture.
const conv = () => page.getByTestId('conversation')
const attendreConv = async (titre) => {
  await conv().waitFor({ timeout: 10000 })
  if (titre) await conv().getByTestId('titre-conversation').filter({ hasText: titre }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(250)
  return conv()
}
const fermerConv = async () => { await conv().getByTestId('fermer-conversation').click(); await conv().waitFor({ state: 'detached', timeout: 10000 }) }
// Une ligne « À toi de jouer » d'un chantier, en dépliant « Voir les N autres » s'il le faut.
const elementAToi = async (chantierId, type) => {
  const el = page.locator(`[data-testid="element-a-toi"][data-type="${type}"][data-element-chantier="${chantierId}"]`)
  if (!(await el.count())) { const plus = page.getByTestId('voir-a-toi'); if (await plus.count()) await plus.click() }
  await el.waitFor({ timeout: 10000 })
  return el
}
const ligneAvance = async (chantierId) => {
  const l = page.locator(`[data-testid="en-ce-moment"] [data-testid="ligne-en-ce-moment"][data-chantier-ligne="${chantierId}"]`)
  if (!(await l.count())) { const plus = page.getByTestId('voir-ca-avance'); if (await plus.count()) await plus.click() }
  await l.waitFor({ timeout: 15000 }).catch(() => {})
  return l
}
const ligneALancer = async (chantierId) => {
  const l = page.locator(`[data-testid="ligne-a-lancer"][data-ligne-chantier="${chantierId}"]`)
  if (!(await l.count())) { const plus = page.getByTestId('voir-a-lancer'); if (await plus.count()) await plus.click() }
  await l.waitFor({ timeout: 10000 })
  return l
}
// Un bloc visible dans la zone qui défile de la conversation (on y arrive « positionné sur ce qu'il faut faire »).
const dansLaVue = async (loc) => {
  const [b, z] = [await loc.boundingBox(), await conv().getByTestId('fil-conversation').boundingBox()]
  return !!b && !!z && b.y >= z.y - 2 && b.y < z.y + z.height
}

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

  if (MDP) {
    await page.getByLabel('Mot de passe').fill(MDP)
    await page.getByRole('button', { name: 'Se connecter', exact: true }).last().click()
  } else {
    console.log('  (connexion par lien magique : pas de mot de passe de test dans cet environnement)')
    const ses = await sessionParLienMagique()
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`sb-${REF_SUPABASE}-auth-token`, JSON.stringify(ses)])
    await page.reload({ waitUntil: 'networkidle' })
  }
  await page.getByTestId('vue-tout').waitFor({ timeout: 30000 })
  await page.getByTestId('a-toi').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)

  // ===================================================================
  // 1. L'accueil : l'onglet « Tout », modèle A (tuiles puis trois listes)
  console.log('  — accueil « Tout » (tableau de bord)')
  verifie('l’onglet « Tout » est l’accueil (sélectionné par défaut)', (await page.getByTestId('onglet-tout').getAttribute('aria-selected')) === 'true')
  const bTuiles = await page.getByTestId('tuiles').boundingBox()
  verifie('les quatre tuiles sont en haut de l’écran', bTuiles && bTuiles.y < 220 && await page.locator('[data-testid^="tuile-"]').count() === 4, bTuiles)
  const nTuile = async (cle) => Number(await page.getByTestId(`tuile-${cle}`).getByTestId('nombre-tuile').textContent())
  verifie('tuile « pour toi » = le nombre de « À toi de jouer » (une seule règle)', await nTuile('pourToi') === Number(await page.getByTestId('a-toi-total').textContent()))
  verifie('tuile « ça avance » = le nombre de « Ça avance tout seul »', await nTuile('caAvance') === Number(await page.getByTestId('ca-avance-total').textContent()))
  verifie('tuile « en pause » = le nombre de « Prêt à lancer »', await nTuile('enPause') === Number(await page.getByTestId('a-lancer-total').textContent()))
  await page.getByTestId('detail-ou-jen-suis').click()
  const lignesEnsemble = await page.getByTestId('ligne-ou-jen-suis').count()
  const nProjetsActifs = Number(sql(`select count(*) as n from projets where actif`)[0].n)
  verifie('« Détail par projet » (replié sous les tuiles) : une ligne par projet actif', lignesEnsemble === nProjetsActifs, { lignesEnsemble, nProjetsActifs })
  const sommeColonne = async (col) => (await page.locator(`[data-testid="ligne-ou-jen-suis"] [data-colonne="${col}"]`).allTextContents()).reduce((n, t) => n + Number(t), 0)
  verifie('le détail compte les mêmes chantiers que les tuiles (pour toi, ça avance, en pause)',
    await sommeColonne('pourToi') === await nTuile('pourToi') && await sommeColonne('bouge') === await nTuile('caAvance') && await sommeColonne('dort') === await nTuile('enPause'),
    { pourToi: [await sommeColonne('pourToi'), await nTuile('pourToi')], bouge: [await sommeColonne('bouge'), await nTuile('caAvance')], dort: [await sommeColonne('dort'), await nTuile('enPause')] })
  await capture(page, 'ou-jen-suis')
  await page.getByTestId('detail-ou-jen-suis').click()
  // Toucher une tuile ouvre sa liste ; une ligne de la liste ouvre la conversation.
  if (await nTuile('pourToi')) {
    await page.getByTestId('tuile-pourToi').click()
    const dlgT = page.getByRole('dialog').filter({ hasText: 'Pour toi' })
    await dlgT.waitFor({ timeout: 5000 })
    verifie('tuile « pour toi » → la liste de ses chantiers', await dlgT.getByTestId('ligne-liste-ou-jen-suis').count() >= 1)
    await page.keyboard.press('Escape')
    await dlgT.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
  const bToi = await page.getByTestId('a-toi').boundingBox()
  verifie('« À toi de jouer » commence dans le premier écran (844 px)', bToi && bToi.y + 60 <= 844, bToi)
  const bOrdre = [await page.getByTestId('a-toi').boundingBox(), await page.getByTestId('en-ce-moment').boundingBox(), await page.getByTestId('a-lancer').boundingBox()]
  verifie('ordre : À toi de jouer, puis Ça avance tout seul, puis Prêt à lancer', bOrdre.every(Boolean) && bOrdre[0].y < bOrdre[1].y && bOrdre[1].y < bOrdre[2].y)
  verifie('« À toi de jouer » : 4 lignes au plus avant « Voir les N autres »', await page.getByTestId('element-a-toi').count() <= 4)
  const ligne1 = page.getByTestId('element-a-toi').first()
  if (await ligne1.count()) {
    verifie('une ligne « À toi » : le sujet, ce qu’on attend en mots simples, UN bouton-verbe',
      (await ligne1.getByTestId('titre-a-toi').textContent()).length > 0 && (await ligne1.getByTestId('attente-a-toi').textContent()).length > 0
      && ['Répondre', 'Tester', 'Décider', 'Débloquer', 'Trancher'].includes((await ligne1.getByTestId('verbe-a-toi').textContent()).trim()))
  }
  // Ce que la base dit à l'instant, comparé à l'écran (d'autres sessions peuvent travailler en même temps).
  await actualiser()
  const vivants = compterVivants()
  if (vivants.barres + vivants.sessions === 0) {
    verifie('aucune preuve de vie → « Personne ne travaille en ce moment » + comment lancer',
      await page.getByTestId('personne-ne-travaille').count() === 1 && /Personne ne travaille/.test(await page.getByTestId('personne-ne-travaille').textContent()) && /Lancer/.test(await page.getByTestId('personne-ne-travaille').textContent()))
  } else {
    console.log(`    (${vivants.sessions} session(s) suivie(s) et ${vivants.barres} barre(s) vivante(s) en base à l’instant)`)
    await page.getByTestId('detail-sessions').click()
    verifie('détail « Qui travaille » : autant de conversations actives qu’en base', await page.getByTestId('session-active').count() === vivants.sessions, { ecran: await page.getByTestId('session-active').count(), base: vivants.sessions })
    await page.getByTestId('detail-sessions').click()
  }
  verifie('« Tout » : aucune barre VIVE hors de « Ça avance tout seul »', await page.locator('[data-testid="vue-tout"] [data-vive="oui"]').count() === await page.locator('[data-testid="en-ce-moment"] [data-vive="oui"]').count())
  verifie('aucune ligne vivante sans preuve : chaque barre vive est sur une ligne « vivant »', await page.locator('[data-testid="ligne-en-ce-moment"][data-vivant="non"] [data-vive="oui"]').count() === 0)
  verifie('aucun défilement horizontal après connexion', (await scrollX()) <= 0, await scrollX())
  // Des icônes, pas d'emoji : dans ce que l'ÉCRAN écrit (titres de blocs, tuiles, boutons) — pas dans les textes des sessions.
  const emojisEcran = await page.evaluate(() => [...document.querySelectorAll('[data-testid="vue-tout"] h2, [data-testid="tuiles"], [data-testid="verbe-a-toi"], [data-testid="ouvrir-relance"], [data-testid="lancer"], [data-testid="detail-sessions"], [data-testid="reglages-projets"] > button, header [role="tab"]')]
    .map((e) => e.textContent).join(' ').match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? [])
  verifie('des icônes, pas d’emoji : aucun dans les titres de blocs, tuiles, boutons et onglets', emojisEcran.length === 0, emojisEcran)
  await captureUx(page, 'ux-tout')
  await capture(page, 'accueil')

  // Vue projet FacePro : le même tableau de bord, premier écran.
  await page.getByTestId('onglet-facepro').click()
  await page.getByTestId('vue-projet').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  verifie('FacePro : tuiles, « À toi de jouer », « Ça avance tout seul » et « Prêt à lancer » en tête de la vue projet',
    await page.getByTestId('tuiles').count() === 1 && await page.getByTestId('en-ce-moment').count() === 1 && await page.getByTestId('a-toi').count() === 1 && await page.getByTestId('a-lancer').count() === 1)
  verifie('FacePro : aucune barre colorée sans preuve de vie (la capture du 29/09)',
    await page.locator('[data-testid="vue-projet"] [data-vive="oui"]').count() === await page.locator('[data-testid="en-ce-moment"] [data-vivant="oui"] [data-vive="oui"]').count())
  verifie('FacePro : « Tous les chantiers » en lignes compactes, sections repliées', await page.getByTestId('groupe-section').count() >= 1 && await page.locator('[data-testid="groupe-section"] [data-testid="ligne-chantier"]').count() === 0)
  verifie('FacePro : « Réglages du projet » replié en bas', await page.getByTestId('reglages-projet').count() === 1 && await page.getByTestId('reglages-projet').getByTestId('barre-projet').count() === 0)
  const vivantsFp = compterVivants('facepro')
  if (vivantsFp.barres + vivantsFp.sessions === 0)
    verifie('FacePro sans session → « Personne ne travaille sur ce projet en ce moment »', /Personne ne travaille sur ce projet/.test(await page.getByTestId('en-ce-moment').textContent()))
  verifie('FacePro : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await captureUx(page, 'ux-projet')

  // Le projet de test n'existe qu'à partir d'ici : l'accueil réel a été capturé sans lui.
  creerProjetTest()
  await page.goto(`${BASE}?recharge=${Date.now()}`, { waitUntil: 'networkidle' })  // sans #projet= : l'accueil « Tout »
  await page.getByTestId('vue-tout').waitFor({ timeout: 30000 })
  await ongletTest().waitFor({ timeout: 15000 })
  verifie('le projet de test a son onglet (le compte de test est admin)', await ongletTest().count() === 1)

  // ===================================================================
  // 2. La présence : une session vivante, une vieille, une silencieuse
  console.log('  — présence')
  const dans1h = new Date(Date.now() + 3600_000).toISOString()
  const P1 = creerTest('pres vivant', { etat: 'en_cours', pris_par: `${SESSION_TEST}vivant`, pris_jusqu_a: dans1h })
  const P2 = creerTest('pres personne', { etat: 'en_cours', priorite: 'haute', demande: 'Chantier de test sans session.' })
  const P3 = creerTest('pres silencieux', { etat: 'en_cours', priorite: 'haute', pris_par: `${SESSION_TEST}silencieux`, pris_jusqu_a: dans1h })
  activiteTest(P1.id, 'vivant', 45, 0)
  activiteTest(P2.id, 'vieux', 70, 120)
  activiteTest(P3.id, 'silencieux', 30, 120)
  await allerTout()
  await actualiser()
  const ligneP1 = await ligneAvance(P1.id)
  verifie('une activité mise à jour à l’instant : une ligne PAR CHANTIER dans « Ça avance tout seul »', await ligneP1.count() === 1 && (await ligneP1.getAttribute('data-vivant')) === 'oui')
  verifie('…avec une barre VIVE et le pourcentage', await ligneP1.locator('[data-vive="oui"]').count() === 1 && (await ligneP1.textContent()).includes('45 %'))
  verifie('…le titre du CHANTIER en titre, puis « Claude (conversation …) · étape » en petit', (await ligneP1.textContent()).includes(P1.titre) && /Claude \(conversation « .+ »\) · « \[TEST web\] étape vivant »/.test(await ligneP1.textContent()), await ligneP1.textContent())
  const snP2 = await ligneAvance(P2.id), snP3 = await ligneAvance(P3.id)
  verifie('« Ça avance » montre AUSSI les en cours sans nouvelles, au même endroit, avec « Relancer »',
    (await snP2.getAttribute('data-vivant')) === 'non' && (await snP3.getAttribute('data-vivant')) === 'non' && await snP2.getByTestId('ouvrir-relance').count() === 1)
  verifie('…en mots simples : « Plus de nouvelles » / « Personne dessus », et le dernier signe',
    /Plus de nouvelles · dernier signe il y a/.test(await snP3.getByTestId('sans-nouvelles').textContent()) && /Personne dessus/.test(await snP2.getByTestId('sans-nouvelles').textContent()), [await snP3.textContent(), await snP2.textContent()])
  verifie('une ligne vivante n’a pas de bouton « Relancer »', await ligneP1.getByTestId('ouvrir-relance').count() === 0)
  // Raphaël répond sur un chantier « à vérifier » que personne ne tient (0017) : sa réponse se VOIT dans « Ça avance ».
  // Répondue DEPUIS L'APP = answered_by posé (0018 : sans lui, la réponse compte comme notée par une session).
  const RP1 = creerTest('réponse sans session', { etat: 'a_verifier' })
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, reponse, answered_at, answered_by, created_at) values ('${projet.id}', '${RP1.id}', 'verifier-web', 'session', 'question', '${esc(`${MARQUE2} On continue ?`)}', 'Oui', now(), gen_random_uuid(), now() - interval '5 minutes')`)
  await actualiser()
  const lRP1 = await ligneAvance(RP1.id)
  verifie('réponse sur un chantier sans session : « Ta réponse est reçue : Claude va la reprendre » dans « Ça avance », sans « Relancer »',
    await lRP1.count() === 1 && (await lRP1.getByTestId('reprise-reponse').getAttribute('data-reprise')) === 'attend'
      && /Ta réponse est reçue : Claude va la reprendre/.test(await lRP1.textContent()) && await lRP1.getByTestId('ouvrir-relance').count() === 0, await lRP1.textContent().catch(() => null))
  // La chef la reprend (ce que fait reprendre_reponse) : réservée, « Claude reprend ta réponse ».
  sql(`update chantiers set etat = 'en_cours', pris_par = 'agent/reponse-test', pris_jusqu_a = now() + interval '1 hour' where id = '${RP1.id}'`)
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values ('${projet.id}', '${RP1.id}', 'agent/reponse-test', 'session', 'info', 'Claude reprend ta réponse « Oui » : un assistant s''en occupe.')`)
  await actualiser()
  verifie('…reprise par la chef : « Claude reprend ta réponse », toujours visible, jamais « sans nouvelles »',
    (await lRP1.getByTestId('reprise-reponse').getAttribute('data-reprise').catch(() => null)) === 'reprise' && await lRP1.getByTestId('sans-nouvelles').count() === 0, await lRP1.textContent().catch(() => null))
  // Ce qui travaille scintille, rien d'autre.
  verifie('la ligne vivante scintille : point qui pulse + reflet sur la barre',
    await ligneP1.locator('.point-vivant').count() === 1 && await ligneP1.locator('.barre-vive').count() === 1)
  verifie('les lignes sans nouvelles, elles, n’animent rien (ni point, ni reflet), barre grise',
    await snP3.locator('.point-vivant, .barre-vive').count() === 0 && await snP2.locator('.point-vivant, .barre-vive').count() === 0 && await snP2.locator('[data-vive="non"]').count() === 1)
  const anim = await ligneP1.locator('.barre-vive').evaluate((e) => getComputedStyle(e).animationName)
  verifie('le reflet est réellement animé (animation CSS en cours)', anim && anim !== 'none', anim)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const animReduite = await ligneP1.locator('.point-vivant').evaluate((e) => ({ nom: getComputedStyle(e).animationName, visible: e.getBoundingClientRect().width > 0 }))
  verifie('« réduire les animations » : le point reste, fixe (aucune animation)', animReduite.nom === 'none' && animReduite.visible, animReduite)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Une nouvelle étape arrive : la ligne clignote une fois.
  sql(`update activite set etape = '${esc(`${MARQUE2} nouvelle étape`)}', pourcentage = 60, eta_secondes = 1500, updated_at = now() where chantier_id = '${P1.id}'`)
  await page.getByTestId('actualiser').click()
  const flashVu = await page.waitForSelector(`[data-testid="ligne-en-ce-moment"][data-chantier-ligne="${P1.id}"][data-flash="oui"]`, { timeout: 8000 }).then(() => true, () => false)
  verifie('nouvelle étape : bref flash de la ligne vivante', flashVu)
  verifie('…la barre suit (60 %), et « reste ~X » seulement quand il est signalé', /60 % · reste ~2\d min/.test(await ligneP1.textContent()) && !/reste/.test(await snP2.textContent()), await ligneP1.textContent())
  await page.getByTestId('en-ce-moment').evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -64))
  await captureUx(page, 'ux-en-ce-moment')
  verifie('l’onglet du projet porte la pastille verte (quelqu’un y travaille)', (await ongletTest().getByTestId('pastille-travaillent').count()) === 1, await ongletTest().textContent())
  // Toucher la ligne : la CONVERSATION du chantier s'ouvre par-dessus, sans changer d'onglet.
  await ligneP1.locator('button').first().click()
  await attendreConv(P1.titre)
  verifie('toucher une ligne → la conversation du chantier, par-dessus « Tout » (onglet inchangé)', (await page.getByTestId('onglet-tout').getAttribute('aria-selected')) === 'true')
  verifie('en-tête de conversation : « Claude y travaille — 60 % », avec le point qui pulse',
    /Claude y travaille — 60 %/.test(await conv().getByTestId('presence-conversation').textContent()) && await conv().getByTestId('presence-conversation').locator('.point-vivant').count() === 1)
  verifie('…et une bulle « En ce moment » avec la barre vive', await conv().getByTestId('bulle-travail').locator('[data-vive="oui"]').count() === 1)
  verifie('la demande est la première bulle', (await conv().locator('[data-testid="fil-conversation"] > *').first().getAttribute('data-testid')) === 'bulle-demande')
  verifie('conversation : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await captureUx(page, 'ux-conversation-vivante')
  // Le geste « retour » du téléphone ferme la conversation (et ne quitte pas le cockpit).
  await page.goBack()
  await conv().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('« retour » du téléphone : la conversation se ferme, on reste sur l’accueil', await conv().count() === 0 && await page.getByTestId('vue-tout').count() === 1)
  // Quitter plus facilement (chantier 4e280265, 29 sept.) : toucher HORS de la carte ferme, toucher DEDANS
  // non ; une zone libre du fil ferme ; Échap ferme ; un menu se ferme seul ; un brouillon n'est jamais perdu sans prévenir.
  console.log('  — quitter une carte : fond, zones libres, Échap, retour, brouillon')
  const rouvrirP1 = async () => { await ligneP1.locator('button').first().click(); await attendreConv(P1.titre) }
  const fermee = async () => { await conv().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); return await conv().count() === 0 }
  const marqueRetour = () => page.evaluate(() => history.state?.conversation === true)
  await rouvrirP1()
  const bFeuille = await conv().boundingBox()
  verifie('téléphone : une bande du fond reste visible au-dessus de la carte ouverte', bFeuille && bFeuille.y >= 30 && bFeuille.y <= 60 && Math.abs(bFeuille.y + bFeuille.height - 844) < 2, bFeuille)
  await captureUx(page, 'ux-carte-ouverte-bande')
  await conv().getByTestId('titre-conversation').click()
  await conv().getByTestId('presence-conversation').click()
  const bulleDem = await conv().getByTestId('bulle-demande').locator(':scope > div').boundingBox()
  await page.mouse.click(bulleDem.x + bulleDem.width / 2, bulleDem.y + bulleDem.height / 2)
  await conv().getByTestId('ecrire-a-claude').click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(300)
  verifie('toucher DANS la carte (titre, présence, bulle, barre du bas) ne la ferme pas', await conv().count() === 1)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('actions-admin').waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  verifie('menu ⋯ : Échap ferme le menu, pas la carte', await conv().getByTestId('actions-admin').count() === 0 && await conv().count() === 1)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('titre-conversation').click()
  await page.waitForTimeout(300)
  verifie('menu ⋯ : toucher ailleurs le ferme, la carte reste', await conv().getByTestId('actions-admin').count() === 0 && await conv().count() === 1)
  await page.mouse.click(195, 16)
  verifie('toucher le fond, au-dessus de la carte, la ferme', await fermee())
  verifie('…et le « retour » posé à l’ouverture est retiré (pas de retour fantôme)', !(await marqueRetour()))
  await rouvrirP1()
  const rangee = conv().getByTestId('bulle-demande')
  const [bR, cote] = [await rangee.boundingBox(), await rangee.getAttribute('data-cote')]
  const bBul = await rangee.locator(':scope > div').boundingBox()
  const libreX = cote === 'droite' ? bR.x + 4 : bR.x + bR.width - 4
  verifie('la bulle de la demande laisse une zone libre à côté d’elle', cote === "droite" ? bBul.x - bR.x > 12 : bR.x + bR.width - (bBul.x + bBul.width) > 12, { bR, bBul })
  await page.mouse.click(libreX, bBul.y + bBul.height / 2)
  verifie('toucher une zone libre du fil (à côté d’une bulle) ferme la carte', await fermee())
  await rouvrirP1()
  await page.keyboard.press('Escape')
  verifie('Échap ferme la carte', await fermee())
  // Brouillon : texte tapé, pas envoyé.
  await rouvrirP1()
  const zoneTexte = conv().getByTestId('ecrire-a-claude').locator('textarea')
  await zoneTexte.fill('brouillon pas encore envoyé')
  const confirmerAbandon = page.locator('dialog[open]', { hasText: 'Quitter sans envoyer ?' })
  await page.mouse.click(195, 16)
  await confirmerAbandon.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('brouillon : toucher le fond DEMANDE « Quitter sans envoyer ? » au lieu de fermer', await confirmerAbandon.count() === 1 && await conv().count() === 1)
  await captureUx(page, 'ux-brouillon-protege')
  await confirmerAbandon.getByRole('button', { name: 'Rester' }).click()
  await page.waitForTimeout(300)
  verifie('« Rester » : la carte reste ouverte et le texte est intact', await conv().count() === 1 && await zoneTexte.inputValue() === 'brouillon pas encore envoyé')
  await page.goBack()
  await confirmerAbandon.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('brouillon : le « retour » du téléphone demande aussi', await confirmerAbandon.count() === 1 && await conv().count() === 1)
  await confirmerAbandon.getByRole('button', { name: 'Rester' }).click()
  await page.waitForTimeout(300)
  verifie('…« Rester » : carte ouverte, texte intact, « retour » toujours prêt', await conv().count() === 1 && await zoneTexte.inputValue() === 'brouillon pas encore envoyé' && await marqueRetour())
  await zoneTexte.press('Escape')
  await confirmerAbandon.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('brouillon : Échap demande aussi', await confirmerAbandon.count() === 1 && await conv().count() === 1)
  await confirmerAbandon.getByRole('button', { name: 'Quitter sans envoyer' }).click()
  verifie('« Quitter sans envoyer » : la carte se ferme, sans « retour » fantôme', await fermee() && !(await marqueRetour()))
  verifie('rien n’a été envoyé', sql(`select count(*)::int n from messages where chantier_id = '${P1.id}' and corps like 'brouillon%'`)[0].n === 0)
  await (await ligneAvance(P2.id)).locator('button').first().click()
  await attendreConv(P2.titre)
  verifie('vieille de 2 h, sans réservation → « personne dessus » en tête', /personne dessus/.test(await conv().getByTestId('presence-conversation').textContent()))
  const relP2 = conv().getByTestId('bulle-relance')
  verifie('…et la bulle à faire : le dernier avancement connu (70 %), barre grise, Copier la consigne / Demander où ça en est',
    /dernier avancement connu : 70 %/.test(await relP2.getByTestId('detail-presence').textContent()) && await relP2.locator('[data-vive="non"]').count() === 1
    && await relP2.getByTestId('copier-consigne').count() === 1 && await relP2.getByTestId('demander-ou-ca-en-est').count() === 1)
  verifie('…positionnée sur ce qu’il faut faire', await dansLaVue(relP2))
  verifie('l’état technique reste lisible, en petit', /État : En cours/.test(await conv().getByTestId('etat-technique').textContent()))
  await fermerConv()
  await (await ligneAvance(P3.id)).locator('button').first().click()
  await attendreConv(P3.titre)
  verifie('réservée mais muette depuis 2 h → « pris, silencieux »', /pris, silencieux/.test(await conv().getByTestId('presence-conversation').textContent()))
  await fermerConv()

  // ===================================================================
  // 3. « Prêt à lancer » : Lancer = copier la consigne ; relancer un « sans nouvelles »
  console.log('  — prêt à lancer')
  const P5 = creerTest('pres libre', { etat: 'libre', priorite: 'haute' })
  activiteTest(P5.id, 'ancien', 20, 300)
  await actualiser()
  const lP5 = await ligneALancer(P5.id)
  verifie('« Prêt à lancer » : ce qui n’a pas commencé, avec son dernier avancement en GRIS', /arrêté à 20 %/.test(await lP5.textContent()) && await lP5.locator('[data-vive="non"]').count() === 1 && await lP5.locator('[data-vive="oui"]').count() === 0)
  verifie('« Prêt à lancer » ne répète ni le vivant ni les en cours sans nouvelles (déjà dans « Ça avance »)',
    await page.locator(`[data-testid="ligne-a-lancer"][data-ligne-chantier="${P1.id}"], [data-testid="ligne-a-lancer"][data-ligne-chantier="${P2.id}"], [data-testid="ligne-a-lancer"][data-ligne-chantier="${P3.id}"]`).count() === 0)
  await lP5.getByTestId('lancer').click()
  verifie('« Lancer » : les deux gestes (Copier la consigne, Demander où ça en est) et comment faire', await lP5.getByTestId('copier-consigne').count() === 1 && /colle-la dans Claude Code/.test(await lP5.textContent()))
  await page.evaluate(() => navigator.clipboard.writeText('vide'))
  await lP5.getByTestId('copier-consigne').click()
  verifie('« Copier la consigne » (Lancer) : toast visible', await toastAuPremierPlan(/Consigne copiée/), { auPremierPlan: dernierDessus })
  const ppP5 = await page.evaluate(() => navigator.clipboard.readText())
  verifie('« Copier la consigne » : le presse-papiers contient la consigne du BON chantier',
    ppP5.includes(`« ${P5.titre} »`) && ppP5.includes(`id ${P5.id}`) && ppP5.includes(`projet ${SLUG}`) && ppP5.includes('progression'), ppP5)
  await lP5.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(200)
  await captureUx(page, 'ux-a-lancer')
  const lP2 = await ligneAvance(P2.id)
  await lP2.getByTestId('ouvrir-relance').click()
  await lP2.getByTestId('demander-ou-ca-en-est').click()
  verifie('« Relancer » → « Demander où ça en est » : toast visible', await toastAuPremierPlan(/Question posée dans le fil/), { auPremierPlan: dernierDessus })
  const demandesOu = sql(`select kind, auteur_type, corps from messages where chantier_id = '${P2.id}'`)
  verifie('« Demander où ça en est » : le message est en base (info, propriétaire, texte convenu)',
    demandesOu.length === 1 && demandesOu[0].kind === 'info' && demandesOu[0].auteur_type === 'proprietaire' && demandesOu[0].corps === MESSAGE_OU_CA_EN_EST, demandesOu)
  await lP2.getByTestId('deja-demande-ou').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('la ligne dit ensuite « Demandé … »', await lP2.getByTestId('deja-demande-ou').count() === 1)

  // ===================================================================
  // 3 bis. Qui travaille : une session factice, un agent qui parle, une commande muette
  console.log('  — sessions et agents')
  const SID = `${SESSION_TEST}session-${randomUUID().slice(0, 8)}`
  const P4 = creerTest('pres agent', { etat: 'en_cours', demande: 'Un agent y travaille.' })
  sql(`insert into sessions (id, projet_id, branche, sujet, tour_en_cours, vu_at) values ('${SID}', '${projet.id}', 'test-web/branche', '${esc(`${MARQUE2} session factice`)}', true, now())`)
  sql(`insert into taches (session_id, projet_id, tache_id, type, description, statut, chantier_id, etape, pourcentage, eta_secondes, progres_at, demarre_at, vu_at) values ('${SID}', '${projet.id}', 'agent-1', 'agent', '${esc(`${MARQUE2} agent qui parle`)}', 'en_cours', '${P4.id}', 'Étape de test', 40, 600, now(), now() - interval '12 minutes', now())`)
  sql(`insert into taches (session_id, projet_id, tache_id, type, description, statut, demarre_at, vu_at) values ('${SID}', '${projet.id}', 'cmd-1', 'commande', '${esc(`${MARQUE2} commande muette`)}', 'en_cours', now() - interval '3 minutes', now())`)
  sql(`insert into taches (session_id, projet_id, tache_id, type, description, statut, demarre_at, vu_at, fini_at) values ('${SID}', '${projet.id}', 'fini-1', 'agent', '${esc(`${MARQUE2} agent fini`)}', 'termine', now() - interval '20 minutes', now(), now() - interval '2 minutes')`)
  // Une conversation qui répond sans chantier : une ligne discrète « hors chantier ».
  const SIDH = `${SESSION_TEST}hors-${randomUUID().slice(0, 8)}`
  sql(`insert into sessions (id, projet_id, sujet, tour_en_cours, vu_at) values ('${SIDH}', '${projet.id}', '${esc(`${MARQUE2} ranger la doc`)}', true, now())`)
  await actualiser()
  const lP4 = await ligneAvance(P4.id)
  verifie('un agent qui a signalé : la ligne du CHANTIER dit « 1 assistant de Claude · « Étape de test » »', (await lP4.getAttribute('data-vivant')) === 'oui' && /1 assistant de Claude · « Étape de test »/.test(await lP4.textContent()), await lP4.textContent())
  verifie('…sa barre vive, 40 %, et le temps restant signalé', await lP4.locator('[data-vive="oui"]').count() === 1 && /40 % · reste ~\d+ min/.test(await lP4.textContent()), await lP4.textContent())
  const hors = page.getByTestId('hors-chantier').filter({ hasText: 'ranger la doc' })
  verifie('le travail hors chantier : une ligne discrète « Claude travaille sur autre chose (« … ») »', await hors.count() === 1 && /Claude travaille sur autre chose \(« \[TEST web\] ranger la doc »\)/.test(await hors.textContent()), await hors.textContent().catch(() => null))
  verifie('résumé en mots simples (conversations · assistants · commandes), replié', /Qui travaille : \d+ conversations? · \d+ assistants? · \d+ commandes?/.test(await page.getByTestId('resume-travail').textContent()) && (await page.getByTestId('detail-sessions').getAttribute('aria-expanded')) === 'false', await page.getByTestId('resume-travail').textContent())
  await page.getByTestId('detail-sessions').click()
  const blocSession = page.locator(`[data-testid="session-active"][data-session="${SID}"]`)
  await blocSession.waitFor({ timeout: 15000 }).catch(() => {})
  verifie('le détail montre la session factice, avec son sujet', await blocSession.count() === 1 && (await blocSession.textContent()).includes('Session [TEST web] session factice'))
  verifie('…et son état : « répond en ce moment »', (await blocSession.getByTestId('etat-session').textContent()).includes('répond en ce moment'))
  const tAgent = blocSession.locator('[data-testid="tache"]', { hasText: 'agent qui parle' })
  const tCmd = blocSession.locator('[data-testid="tache"]', { hasText: 'commande muette' })
  verifie('agent qui a signalé : « Agent : … », barre vive, temps restant', (await tAgent.textContent()).includes('Agent :') && await tAgent.locator('[data-vive="oui"]').count() === 1 && /reste ~\d+ min/.test(await tAgent.textContent()), await tAgent.textContent())
  verifie('commande muette : « Commande : … », « avancement non signalé », AUCUNE barre', (await tCmd.textContent()).includes('Commande :') && await tCmd.getByTestId('non-signale').count() === 1 && await tCmd.getByRole('progressbar').count() === 0)
  verifie('chaque tâche dit depuis quand elle tourne', /depuis 12 min/.test(await tAgent.textContent()) && /depuis 3 min/.test(await tCmd.textContent()))
  verifie('la tâche liée à un chantier le nomme', (await tAgent.textContent()).includes(P4.titre))
  verifie('les tâches finies depuis peu sont repliées sous la session', (await blocSession.getByTestId('taches-finies').textContent()).includes('1 fini'))
  verifie('l’aide « c’est quoi ? » est là, repliée, et s’ouvre', await page.getByTestId('vocabulaire').count() === 1 && (await page.getByTestId('vocabulaire').getAttribute('aria-expanded')) === 'false')
  await page.getByTestId('vocabulaire').click()
  verifie('…elle explique en mots simples « conversation (ou session) » et « assistant (ou agent) »', /Une conversation \(ou session\)[\s\S]*Un assistant \(ou agent\)/.test(await page.getByTestId('vocabulaire-texte').textContent()))
  await page.getByTestId('vocabulaire').click()
  await blocSession.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await capture(page, 'sessions-agents')
  await tAgent.getByRole('button', { name: new RegExp(P4.titre.replace(/[[\]]/g, '\\$&')) }).click()
  await attendreConv(P4.titre)
  verifie('un agent vivant lié au chantier → sa conversation dit « Un agent y travaille — 40 % »', /Un agent y travaille — 40 %/.test(await conv().getByTestId('presence-conversation').textContent()), await conv().getByTestId('presence-conversation').textContent())
  verifie('…et montre l’agent qui y travaille', await conv().getByTestId('taches-du-chantier').count() === 1)
  await fermerConv()

  // Une session arrêtée sur une limite (0010) : « En pause », rien ne s'anime.
  const SIDP = `${SESSION_TEST}pause-${randomUUID().slice(0, 8)}`
  sql(`insert into sessions (id, projet_id, sujet, tour_en_cours, vu_at, pause_raison, pause_at, pause_detail) values ('${SIDP}', '${projet.id}', '${esc(`${MARQUE2} session en pause`)}', false, now() - interval '90 minutes', 'rate_limit', now() - interval '80 minutes', 'Limite atteinte, reprise à 4 h')`)
  sql(`insert into taches (session_id, projet_id, tache_id, type, description, statut, etape, pourcentage, progres_at, vu_at) values ('${SIDP}', '${projet.id}', 'agent-p', 'agent', '${esc(`${MARQUE2} agent arrêté`)}', 'en_cours', 'Étape', 30, now(), now())`)
  await actualiser()
  const horsPause = page.getByTestId('hors-chantier').filter({ hasText: 'session en pause' })
  await horsPause.waitFor({ timeout: 15000 }).catch(() => {})
  verifie('session en pause : une ligne « … en pause — limite d’usage atteinte (reprend toute seule quand la limite se lève) »',
    await horsPause.count() === 1 && (await horsPause.textContent()).includes('en pause — limite d’usage atteinte (reprend toute seule quand la limite se lève)'), await horsPause.textContent().catch(() => null))
  verifie('…et rien ne s’anime sur cette ligne', await horsPause.locator('.point-vivant, .barre-vive').count() === 0)
  if ((await page.getByTestId('detail-sessions').getAttribute('aria-expanded')) !== 'true') await page.getByTestId('detail-sessions').click()
  const blocPause = page.locator(`[data-testid="session-active"][data-session="${SIDP}"]`)
  await blocPause.waitFor({ timeout: 10000 }).catch(() => {})
  verifie('dans le détail : « En pause — … » avec le détail en petit, rien d’animé', await blocPause.getByTestId('session-en-pause').count() === 1 && (await blocPause.textContent()).includes('reprise à 4 h') && await blocPause.locator('.point-vivant, .barre-vive, [data-testid="point-travaille"]').count() === 0)
  await horsPause.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await capture(page, 'session-pause')
  await page.getByTestId('detail-sessions').click()

  // Une fusion proposée par Claude : « Trancher » ouvre la conversation ; « Garder séparés » la fait disparaître.
  console.log('  — fusion proposée')
  const F1 = creerTest('fusion source', { etat: 'libre' })
  const F2 = creerTest('fusion cible', { etat: 'libre' })
  const optionsF = JSON.stringify([{ libelle: 'Fusionner', recommande: true, source: F1.id, cible: F2.id, aide: 'Tout passe dans la cible.' }, { libelle: 'Garder séparés' }]).replace(/'/g, "''")
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values ('${projet.id}', '${F2.id}', 'verifier-web', 'session', 'fusion', '${esc(`${MARQUE2} Ces deux chantiers semblent le même sujet. Les fusionner ?`)}', 'Même demande, mots différents.', '${optionsF}'::jsonb)`)
  await actualiser()
  const elF = await elementAToi(F2.id, 'fusion')
  verifie('« À toi de jouer » : la fusion, « Claude propose de fusionner deux chantiers », bouton « Trancher »',
    /Claude propose de fusionner deux chantiers/.test(await elF.getByTestId('attente-a-toi').textContent()) && (await elF.getByTestId('verbe-a-toi').textContent()).trim() === 'Trancher')
  await elF.getByTestId('verbe-a-toi').click()
  await attendreConv(F2.titre)
  const blocF = conv().getByTestId('bloc-fusion')
  verifie('conversation : la bulle de fusion, avec le pourquoi et deux réponses toutes prêtes',
    await blocF.count() === 1 && (await blocF.textContent()).includes('Même demande') && await blocF.getByTestId('fusionner').count() === 1 && await blocF.getByTestId('garder-separes').count() === 1)
  verifie('…positionnée dessus à l’ouverture', await dansLaVue(blocF))
  await capture(page, 'fusion')
  await blocF.getByTestId('garder-separes').click()
  verifie('« Garder séparés » : toast visible (au-dessus de la conversation)', await toastAuPremierPlan(/Gardés séparés/), { auPremierPlan: dernierDessus })
  await blocF.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('« Garder séparés » : la bulle devient « Tranché : Garder séparés »', await blocF.count() === 0 && /Tranché : Garder séparés/.test(await conv().textContent()))
  const fBase = sql(`select reponse, answered_at from messages where chantier_id = '${F2.id}' and kind = 'fusion'`)[0]
  const f1Base = sql(`select archived_at from chantiers where id = '${F1.id}'`)[0]
  verifie('« Garder séparés » : en base, tranchée sans fusionner', fBase?.reponse === 'Garder séparés' && !!fBase.answered_at && !f1Base?.archived_at, { fBase, f1Base })
  await fermerConv()
  verifie('…et la fusion quitte « À toi de jouer »', await page.locator(`[data-testid="element-a-toi"][data-type="fusion"][data-element-chantier="${F2.id}"]`).count() === 0)

  // ===================================================================
  // 4. « À toi de jouer » : une question → « Répondre » → la conversation, positionnée sur la question
  console.log('  — à toi : question')
  const Q1 = creerTest('question', { etat: 'libre' })
  await allerCockpit()
  await actualiser()
  const options = JSON.stringify([{ libelle: 'Option A', aide: 'la première', recommande: true }, { libelle: 'Option B' }]).replace(/'/g, "''")
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values ('${projet.id}', '${Q1.id}', 'verifier-web', 'session', 'question', '${MARQUE} Quelle option ?', 'Pour vérifier l''écran.', '${options}'::jsonb)`)
  const elQsel = `[data-testid="element-a-toi"][data-type="question"][data-element-chantier="${Q1.id}"]`
  let directVu = true
  try { await page.locator(elQsel).waitFor({ timeout: 12000 }) } catch { directVu = false; await actualiser() }
  // D-09 : « actualisation en live hyper précise ». Le direct doit la montrer SANS « Actualiser ».
  if (wsPossible) verifie('la question apparaît EN DIRECT, sans « Actualiser »', directVu)
  else verifie('sans direct (conteneur), la question apparaît après « Actualiser », et l’écran le dit', await page.getByTestId('direct-coupe').count() === 1)
  const elQ = await elementAToi(Q1.id, 'question')
  verifie('« À toi de jouer » compte la question du projet (tuile « pour toi » comprise)', await page.locator('[data-testid="element-a-toi"][data-type="question"]').count() >= nAttenteAvant + 1 && Number(await page.getByTestId('tuile-pourToi').getByTestId('nombre-tuile').textContent()) === Number(await page.getByTestId('a-toi-total').textContent()))
  verifie('la ligne : le titre du chantier d’abord, « Claude te pose une question », bouton « Répondre »',
    (await elQ.getByTestId('titre-a-toi').textContent()).includes(Q1.titre) && /Claude te pose une question/.test(await elQ.getByTestId('attente-a-toi').textContent()) && (await elQ.getByTestId('verbe-a-toi').textContent()).trim() === 'Répondre')
  await deplierTout()
  verifie('dans « Tous les chantiers », sa ligne dit « Attend ta réponse »', (await ligneId(Q1.id).getByTestId('badge-presence').textContent()).includes('Attend ta réponse'))
  await elQ.getByTestId('verbe-a-toi').click()
  await attendreConv(Q1.titre)
  const blocQ = conv().getByTestId('bloc-question')
  verifie('« Répondre » → la conversation, positionnée sur la question', await blocQ.count() === 1 && await dansLaVue(blocQ))
  const taillesQ = await blocQ.evaluate((b) => [...b.querySelectorAll('p')].map((p) => ({ t: p.textContent, px: parseFloat(getComputedStyle(p).fontSize) })))
  const pxQ = taillesQ.find((x) => x.t.includes('Quelle option'))?.px ?? 0, pxP = taillesQ.find((x) => x.t.includes('Pour vérifier'))?.px ?? 99
  verifie('la question en gros, le pourquoi en petit dessous, les réponses toutes prêtes, la recommandée marquée',
    pxQ > pxP && (await blocQ.textContent()).includes('recommandé') && await blocQ.getByRole('radio').count() === 2, { pxQ, pxP })
  await capture(page, 'question')
  await blocQ.getByRole('radio', { name: /Option A/ }).click()
  await blocQ.getByPlaceholder(/précision/i).fill('précision de test')
  // Une capture jointe à la réponse (0013) : la vignette, puis le fichier dans le fil.
  await blocQ.getByTestId('entree-medias').setInputFiles({ name: 'capture écran.png', mimeType: 'image/png', buffer: PNG_TEST })
  await blocQ.locator('[data-testid="piece-jointe"][data-etat="ok"]').waitFor({ timeout: 20000 })
  verifie('réponse : la photo jointe s’affiche en vignette, envoyée', await blocQ.locator('[data-testid="piece-jointe"][data-etat="ok"] img').count() === 1)
  await capture(page, 'question-avec-photo')
  await blocQ.getByTestId('valider-reponse').click()
  verifie('réponse : toast visible (au-dessus de la conversation)', await toastAuPremierPlan(/Réponse enregistrée/), { auPremierPlan: dernierDessus })
  await blocQ.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('la question répondue devient une bulle « Réponse : Option A — précision de test »', await blocQ.count() === 0 && /Réponse : Option A — précision de test/.test(await conv().textContent()))
  const rep = sql(`select reponse, precision, answered_at from messages where corps like '${MARQUE}%'`)[0]
  verifie('la réponse est en base (option + précision + answered_at)', rep && rep.reponse === 'Option A' && rep.precision === 'précision de test' && !!rep.answered_at, rep)
  const pjQ = sql(`select corps, medias from messages where chantier_id = '${Q1.id}' and kind = 'info' and jsonb_array_length(medias) > 0`)
  verifie('la photo de la réponse est dans le fil du chantier (message info + medias)', pjQ.length === 1 && pjQ[0].medias[0].type === 'image/png' && pjQ[0].medias[0].chemin.startsWith(`${projet.id}/${Q1.id}/`) && /Option A/.test(pjQ[0].corps), pjQ)
  const objQ = sql(`select count(*) as n from storage.objects where bucket_id = 'cockpit-medias' and name = '${esc(pjQ[0]?.medias?.[0]?.chemin ?? '')}'`)[0]
  verifie('le fichier est bien dans le stockage privé', Number(objQ.n) === 1, objQ)
  const vignetteQ = conv().locator('[data-testid="bulle"] [data-testid="media"] img').first()
  await vignetteQ.waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  verifie('la photo s’affiche dans une bulle de la conversation (lien signé, image chargée)', await vignetteQ.count() === 1 && await vignetteQ.evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false))
  await fermerConv()
  verifie('la question répondue quitte « À toi de jouer »', await page.locator(elQsel).count() === 0)

  // ===================================================================
  // 5. À vérifier : « Tester » → la conversation (frise, comment vérifier, Ça marche / Corriger)
  console.log('  — à toi : à vérifier, mise en ligne')
  const CV = '1. Ouvre la page https://rnab26.github.io/Cockpit-General/ sur ton téléphone. 2. Touche la carte « Réglages ». 3. Tu dois voir ton e-mail en haut.'
  const iso = (min) => new Date(Date.now() - min * 60_000).toISOString()
  const jalonsComplets = JSON.stringify({ code: { at: iso(30), detail: null }, pousse: { at: iso(25), detail: 'abc1234' }, ci_ok: { at: iso(20), detail: null }, en_ligne: { at: iso(15), detail: 'https://rnab26.github.io/Cockpit-General/' } })
  const v1 = creerTest('verif avec etapes', { etat: 'a_verifier', priorite: 'haute', demande: 'Chantier livré, étapes écrites.', comment_verifier: CV, jalons: jalonsComplets, origine: 'session' })
  const v2 = creerTest('verif sans etapes', { etat: 'a_verifier', priorite: 'haute', demande: 'Chantier livré sans étapes.' })
  const v3 = creerTest('verif pas en ligne', { etat: 'a_verifier', priorite: 'haute', comment_verifier: '1. Attends.', jalons: JSON.stringify({ pousse: { at: iso(5), detail: 'def5678' } }) })
  await allerTout()
  await actualiser()
  const elV1 = await elementAToi(v1.id, 'a_verifier')
  verifie('à vérifier en ligne : « en ligne, à tester », bouton « Tester »', /en ligne, à tester/.test(await elV1.getByTestId('attente-a-toi').textContent()) && (await elV1.getByTestId('verbe-a-toi').textContent()).trim() === 'Tester')
  const elV3 = await elementAToi(v3.id, 'a_verifier')
  verifie('à vérifier pas encore en ligne : « livré, pas encore en ligne »', /livré, pas encore en ligne/.test(await elV3.getByTestId('attente-a-toi').textContent()))
  await (await elementAToi(v1.id, 'a_verifier')).getByTestId('verbe-a-toi').click()
  await attendreConv(v1.titre)
  const blocV1 = conv().getByTestId('bloc-validation')
  verifie('« Tester » → la conversation, positionnée sur la vérification', await blocV1.count() === 1 && await dansLaVue(blocV1))
  const encadre = blocV1.getByTestId('comment-verifier')
  verifie('à vérifier : « Comment vérifier » visible directement', await encadre.count() === 1 && await encadre.isVisible())
  const etapesV = encadre.getByTestId('etape-verifier')
  const nEtapes = await etapesV.count()
  const ys = []
  for (let i = 0; i < nEtapes; i++) ys.push((await etapesV.nth(i).boundingBox())?.y ?? -1)
  verifie('les trois étapes écrites sur UNE ligne s’affichent sur trois lignes distinctes', nEtapes === 3 && ys.every((y, i) => i === 0 || y > ys[i - 1] + 8), { nEtapes, ys })
  const textesEtapes = await etapesV.allTextContents()
  verifie('chaque ligne porte son numéro et son texte, sans le suivant', /^1\.\s*Ouvre la page/.test(textesEtapes[0] ?? '') && /^3\.\s*Tu dois voir/.test(textesEtapes[2] ?? '') && !(textesEtapes[0] ?? '').includes('Touche'), textesEtapes)
  const lienCv = encadre.getByRole('link')
  verifie('le lien du texte est cliquable, nouvel onglet, rel noopener',
    await lienCv.count() === 1 && await lienCv.getAttribute('href') === 'https://rnab26.github.io/Cockpit-General/' && await lienCv.getAttribute('target') === '_blank' && /noopener/.test(await lienCv.getAttribute('rel') ?? ''))
  const [bEnc, bCert] = [await encadre.boundingBox(), await blocV1.getByTestId('btn-certifier').boundingBox()]
  verifie('l’encadré est AVANT les boutons « Ça marche / Corriger »', bEnc && bCert && bEnc.y + bEnc.height <= bCert.y, { bEnc, bCert })
  const friseV1 = blocV1.getByTestId('frise-en-ligne')
  const etatsFrise = await friseV1.getByTestId('etape-en-ligne').evaluateAll((l) => l.map((e) => e.getAttribute('data-etat')))
  verifie('frise complète : 4 étapes cochées (Codé, Envoyé, Vérifié par les robots, En ligne)', etatsFrise.join(',') === 'fait,fait,fait,fait' && /Codé[\s\S]*Envoyé[\s\S]*robots[\s\S]*En ligne/.test(await friseV1.textContent()), etatsFrise)
  verifie('frise : l’adresse en ligne est un lien', await friseV1.getByRole('link').getAttribute('href') === 'https://rnab26.github.io/Cockpit-General/')
  const phraseV1 = blocV1.getByTestId('phrase-en-ligne')
  verifie('phrase : « C’est en ligne depuis … : tu peux vérifier maintenant »', /C’est en ligne depuis \d+ h \d{2}( du matin)? : tu peux vérifier maintenant/.test(await phraseV1.textContent()), await phraseV1.textContent())
  const [bPhrase, bCert2] = [await phraseV1.boundingBox(), await blocV1.getByTestId('btn-certifier').boundingBox()]
  verifie('la phrase est juste au-dessus de « Ça marche »', bPhrase && bCert2 && bPhrase.y + bPhrase.height <= bCert2.y && bCert2.y - (bPhrase.y + bPhrase.height) < 40, { bPhrase, bCert2 })
  verifie('à vérifier : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await captureUx(page, 'ux-conversation-a-verifier')
  // Certifier v1.
  await blocV1.getByTestId('btn-certifier').click()
  await blocV1.getByRole('button', { name: /Je certifie/ }).click()
  verifie('« Ça marche » → « Je certifie » : toast visible', await toastAuPremierPlan(/certifié/), { auPremierPlan: dernierDessus })
  await blocV1.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  await conv().getByTestId('bulle-certifie').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('certifié : la conversation le dit (« Certifié par … »)', await conv().getByTestId('bulle-certifie').count() === 1)
  verifie('en base : certifié (valide)', sql(`select etat from chantiers where id = '${v1.id}'`)[0]?.etat === 'valide')
  const replie = conv().getByTestId('comment-verifier-replie')
  verifie('certifié : « Comment vérifier » présent, replié', await replie.count() === 1 && await replie.getByTestId('etape-verifier').count() === 0)
  await replie.locator('> button').click()
  verifie('certifié : déplié, les trois étapes reviennent', await replie.getByTestId('etape-verifier').count() === 3)
  verifie('certifié : la frise de mise en ligne reste dans la conversation', await conv().getByTestId('frise-en-ligne').count() === 1)
  verifie('« lancé par Claude » sur un chantier d’origine session', await conv().getByTestId('origine-session').count() === 1)
  await capture(page, 'a-toi-certifie')
  await fermerConv()
  verifie('le chantier certifié quitte « À toi de jouer »', await page.locator(`[data-testid="element-a-toi"][data-element-chantier="${v1.id}"]`).count() === 0)
  // Sans étapes : la phrase et le bouton qui écrit la demande dans le fil.
  await (await elementAToi(v2.id, 'a_verifier')).getByTestId('verbe-a-toi').click()
  await attendreConv(v2.titre)
  const videV2 = conv().getByTestId('comment-verifier-vide')
  verifie('sans étapes : « La session n’a pas dit comment vérifier. Demande-lui avant de certifier : »', (await videV2.textContent()).includes('La session n’a pas dit comment vérifier. Demande-lui avant de certifier'))
  await videV2.getByTestId('btn-demander-verifier').click()
  verifie('« Demander comment vérifier » : toast de succès visible', await toastAuPremierPlan(/Demande envoyée/), { auPremierPlan: dernierDessus })
  const demandes = sql(`select kind, auteur_type, corps, answered_at from messages where chantier_id = '${v2.id}'`)
  verifie('la demande est en base : kind info, auteur propriétaire, texte convenu',
    demandes.length === 1 && demandes[0].kind === 'info' && demandes[0].auteur_type === 'proprietaire' && demandes[0].corps === 'Raphaël demande : comment vérifier ce chantier ? (étapes, où aller, ce que je dois voir)', demandes)
  await videV2.getByTestId('deja-demande').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('l’écran dit ensuite « Déjà demandé » (pas de doublon en aveugle)', await videV2.getByTestId('deja-demande').count() === 1 && (await videV2.getByTestId('btn-demander-verifier').textContent()).includes('Redemander'))
  verifie('…et la demande apparaît comme une bulle à droite (toi)', await conv().locator('[data-testid="bulle"][data-cote="droite"]', { hasText: 'comment vérifier ce chantier' }).count() === 1)
  await capture(page, 'comment-verifier-vide')
  await fermerConv()
  // Corriger v3, avec une photo de ce qui ne marche pas.
  await (await elementAToi(v3.id, 'a_verifier')).getByTestId('verbe-a-toi').click()
  await attendreConv(v3.titre)
  const blocV3 = conv().getByTestId('bloc-validation')
  const etatsV3 = await blocV3.getByTestId('etape-en-ligne').evaluateAll((l) => l.map((e) => e.getAttribute('data-etat')))
  verifie('seulement « envoyé » : « Pas encore en ligne : attends avant de vérifier »', /Pas encore en ligne/.test(await blocV3.getByTestId('phrase-en-ligne').textContent()))
  verifie('…et les étapes suivantes sont grises', etatsV3.join(',') === 'fait,fait,attente,attente', etatsV3)
  await blocV3.getByTestId('btn-corriger').click()
  await blocV3.getByRole('button', { name: /Envoyer la correction/ }).click()
  verifie('« Corriger » sans mots : refusé en clair (c’est ce que Claude lira)', await toastAuPremierPlan(/Dis ce qui ne marche pas/))
  await blocV3.locator('textarea').fill(`${MARQUE2} le bouton ne répond pas`)
  await blocV3.getByTestId('entree-medias').setInputFiles({ name: 'bug.png', mimeType: 'image/png', buffer: PNG_TEST })
  await blocV3.locator('[data-testid="piece-jointe"][data-etat="ok"]').waitFor({ timeout: 20000 })
  await blocV3.getByRole('button', { name: /Envoyer la correction/ }).click()
  verifie('« Corriger » : toast visible', await toastAuPremierPlan(/Correction envoyée/), { auPremierPlan: dernierDessus })
  const v3Base = sql(`select etat from chantiers where id = '${v3.id}'`)[0]
  const v3Msgs = sql(`select corps, medias from messages where chantier_id = '${v3.id}' order by created_at`)
  verifie('« Corriger » : en base, le chantier revient à Claude (libre), ses mots et la photo dans le fil',
    v3Base?.etat === 'libre' && v3Msgs.some((m) => m.corps.includes('le bouton ne répond pas')) && v3Msgs.some((m) => (m.medias ?? []).length === 1), { v3Base, v3Msgs })
  await fermerConv()

  // « Je ne sais pas : vérifie pour moi » (0016) : Raphaël colle ce qu'il a vu, Claude juge.
  const v4 = creerTest('verifie pour moi', { etat: 'a_verifier', comment_verifier: '1. Ouvre la session. 2. Demande la liste. 3. Tu dois voir 13 chantiers.' })
  await actualiser()
  await (await elementAToi(v4.id, 'a_verifier')).getByTestId('verbe-a-toi').click()
  await attendreConv(v4.titre)
  const blocV4 = conv().getByTestId('bloc-validation')
  verifie('« Je ne sais pas : vérifie pour moi » est proposé à côté de « Ça marche » / « Corriger »', await blocV4.getByTestId('btn-verifie-pour-moi').isVisible())
  await blocV4.getByTestId('btn-verifie-pour-moi').click()
  await blocV4.locator('textarea').fill(`${MARQUE2} voici la réponse de la session : 13 chantiers`)
  await blocV4.getByTestId('envoyer-verification').click()
  verifie('« Vérifie pour moi » : toast « Claude vérifie pour toi » visible', await toastAuPremierPlan(/Claude vérifie pour toi/), { auPremierPlan: dernierDessus })
  const v4Base = sql(`select verif_demandee_at from chantiers where id = '${v4.id}'`)[0]
  const v4Msg = sql(`select corps from messages where chantier_id = '${v4.id}' and kind = 'constat'`)[0]
  verifie('« Vérifie pour moi » : en base, la demande est posée avec ce qu’il a collé', !!v4Base?.verif_demandee_at && /13 chantiers/.test(v4Msg?.corps ?? ''), { v4Base, v4Msg })
  await blocV4.getByTestId('verification-en-cours').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('en attente de Claude : plus AUCUN bouton (ni « Ça marche », ni « Corriger »), seulement « En attente de Claude »', await blocV4.getByTestId('verification-en-cours').count() === 1 && await blocV4.getByTestId('btn-verifie-pour-moi').count() === 0 && await blocV4.getByTestId('btn-certifier').count() === 0 && await blocV4.getByTestId('btn-corriger').count() === 0)
  await fermerConv()
  verifie('pendant que Claude vérifie, le chantier sort de « À toi de jouer »', await page.locator(`[data-testid="element-a-toi"][data-element-chantier="${v4.id}"]`).count() === 0)
  // Retour de Raphaël (29 sept.) : « je ne vois pas où ce chantier part ». Il se voit, sous UN nom, partout.
  const lV4 = await ligneAvance(v4.id)
  verifie('…et se voit dans « Ça avance tout seul » : « Claude vérifie pour toi », vivant, sans « Relancer »',
    await lV4.count() === 1 && /Claude vérifie pour toi/.test(await lV4.textContent()) && (await lV4.getAttribute('data-vivant')) === 'oui' && await lV4.getByTestId('ouvrir-relance').count() === 0)
  verifie('…compté dans la tuile « ça avance » (même nombre que la liste)',
    Number(await page.getByTestId('tuile-caAvance').getByTestId('nombre-tuile').textContent()) === Number(await page.getByTestId('ca-avance-total').textContent()))
  await allerCockpit()
  await deplierTout()
  verifie('…et « Tous les chantiers » (vue du projet) dit « Claude vérifie pour toi »', (await ligneId(v4.id).getByTestId('badge-presence').textContent()).includes('Claude vérifie pour toi'))
  await allerTout()
  sql(`select rendre_verdict('${v4.id}'::uuid, 'test-web', true, '${esc(`${MARQUE2} Tout correspond à la base`)}')`)
  await actualiser()
  const elV4 = await elementAToi(v4.id, 'a_verifier')
  verifie('après le verdict « bon », il revient : « Claude a vérifié : c’est bon, confirme d’un toucher »', /c’est bon, confirme/.test(await elV4.getByTestId('attente-a-toi').textContent()))
  verifie('…et quitte « Ça avance tout seul »', await page.locator(`[data-testid="en-ce-moment"] [data-testid="ligne-en-ce-moment"][data-chantier-ligne="${v4.id}"]`).count() === 0)

  // ===================================================================
  // 6. À cadrer et bloqué : « Décider » / « Débloquer », la barre d'écriture, « prêt à lancer »
  console.log('  — à cadrer, bloqué')
  const K1 = creerTest('a cadrer', { etat: 'a_cadrer', demande: 'Faut-il un mode sombre ?' })
  const B1 = creerTest('bloque', { etat: 'bloque' })
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values ('${projet.id}', '${B1.id}', 'verifier-web', 'session', 'blocage', '${esc(`${MARQUE2} Il manque la clé de test dans l’environnement`)}')`)
  await actualiser()
  const elK = await elementAToi(K1.id, 'a_cadrer')
  verifie('à cadrer : « ta décision avant de coder », bouton « Décider »', /ta décision avant de coder/.test(await elK.getByTestId('attente-a-toi').textContent()) && (await elK.getByTestId('verbe-a-toi').textContent()).trim() === 'Décider')
  const elB = await elementAToi(B1.id, 'bloque')
  verifie('bloqué : « bloqué : <ce qui bloque> », bouton « Débloquer »', /bloqué : \[TEST web\] Il manque la clé/.test(await elB.getByTestId('attente-a-toi').textContent()) && (await elB.getByTestId('verbe-a-toi').textContent()).trim() === 'Débloquer')
  await elK.getByTestId('verbe-a-toi').click()
  await attendreConv(K1.titre)
  verifie('« Décider » → la conversation : la demande, puis la bulle « Ta décision avant de coder »', /Faut-il un mode sombre/.test(await conv().getByTestId('bulle-demande').textContent()) && await dansLaVue(conv().getByTestId('bloc-cadrer')))
  const barreK = conv().getByTestId('ecrire-a-claude')
  verifie('la barre du bas invite à écrire la décision', /Ta décision/.test(await barreK.locator('textarea').getAttribute('placeholder')))
  await barreK.locator('textarea').fill(`${MARQUE2} oui, suivre le téléphone`)
  await barreK.getByTestId('envoyer-message').click()
  verifie('décision envoyée : toast visible', await toastAuPremierPlan(/Message envoyé/), { auPremierPlan: dernierDessus })
  await conv().locator('[data-testid="bulle"][data-cote="droite"]', { hasText: 'oui, suivre le téléphone' }).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('…elle apparaît en bulle à droite', await conv().locator('[data-testid="bulle"][data-cote="droite"]', { hasText: 'oui, suivre le téléphone' }).count() === 1)
  await conv().getByTestId('pret-a-lancer').click()
  verifie('« C’est décidé : prêt à lancer » : toast visible', await toastAuPremierPlan(/est prêt/))
  verifie('…en base : libre', sql(`select etat from chantiers where id = '${K1.id}'`)[0]?.etat === 'libre')
  await fermerConv()
  await (await elementAToi(B1.id, 'bloque')).getByTestId('verbe-a-toi').click()
  await attendreConv(B1.titre)
  const blocB = conv().getByTestId('bloc-bloque')
  verifie('« Débloquer » → la bulle « Claude est bloqué » avec ce qui bloque', /Il manque la clé de test/.test(await blocB.textContent()) && await dansLaVue(blocB))
  await capture(page, 'bloque')
  await blocB.getByTestId('pret-a-lancer').click()
  verifie('« Débloqué : prêt à lancer » : toast visible, en base libre', await toastAuPremierPlan(/est prêt/) && sql(`select etat from chantiers where id = '${B1.id}'`)[0]?.etat === 'libre')
  await fermerConv()

  // ===================================================================
  // 7. Un chantier reporté : « Écrire à Claude » avec une photo, « Relancer maintenant »
  console.log('  — reporté, écrire à Claude')
  const R1 = creerTest('reporte', { etat: 'reporte', demande: 'Mis de côté pour la v2.' })
  await allerCockpit()
  await actualiser()
  await deplierTout()
  await ligneId(R1.id).waitFor({ timeout: 15000 })
  await ligneId(R1.id).getByTestId('ouvrir-chantier').click()
  await attendreConv(R1.titre)
  verifie('reporté : « Rien à faire de ta part, sauf si tu veux le relancer »', /Rien à faire de ta part/.test(await conv().getByTestId('bulle-reporte').textContent()))
  const ecrire = conv().getByTestId('ecrire-a-claude')
  verifie('« Écrire à Claude… » toujours visible en bas de la conversation', await ecrire.isVisible() && /Écrire à Claude/.test(await ecrire.locator('textarea').getAttribute('placeholder')))
  verifie('fil vide : seulement la demande, aucune bulle vide', await conv().getByTestId('bulle').count() === 0 && await conv().getByTestId('bulle-demande').count() === 1)
  const bEcr = await ecrire.boundingBox()
  verifie('la barre d’écriture est collée en bas de l’écran du téléphone', bEcr && Math.abs(bEcr.y + bEcr.height - 844) < 4, bEcr)
  verifie('« Envoyer » est inactif tant que rien n’est écrit', await ecrire.getByTestId('envoyer-message').isDisabled())
  await ecrire.locator('textarea').fill(`${MARQUE2} message à Claude`)
  await ecrire.getByTestId('entree-medias').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_PHOTO })
  await ecrire.locator('[data-testid="piece-jointe"][data-etat="ok"]').waitFor({ timeout: 20000 })
  await capture(page, 'ecrire-avec-photo')
  // Le crayon (29 sept.) : sur l'image jointe, une fois l'import fini.
  const crayon = ecrire.getByTestId('crayon-media')
  verifie('crayon : présent sur l’image jointe, en haut à droite', await crayon.count() === 1 && await (async () => { const c = await crayon.boundingBox(), v = await ecrire.getByTestId('piece-jointe').boundingBox(); return c.x + c.width / 2 > v.x + v.width / 2 && c.y < v.y + v.height / 2 })())
  const pieceAvant = await ecrire.locator('[data-testid="piece-jointe"] img').getAttribute('src')
  await crayon.click()
  const annoter = page.getByTestId('annoter')
  await annoter.getByTestId('annoter-toile').waitFor({ state: 'visible', timeout: 8000 })
  const bAnn = await annoter.boundingBox()
  verifie('crayon : l’image s’ouvre en plein écran', bAnn && bAnn.width >= 389 && bAnn.height >= 843, bAnn)
  verifie('crayon : « Enregistrer » inactif tant que rien n’est dessiné', await annoter.getByTestId('annoter-enregistrer').isDisabled())
  verifie('crayon : 4 couleurs, annuler le trait, tout effacer', await annoter.getByTestId('annoter-couleur').count() === 4 && await annoter.getByTestId('annoter-defaire').count() === 1 && await annoter.getByTestId('annoter-effacer').count() === 1)
  await tracer(page)
  await capture(page, 'crayon-trait')
  await annoter.getByTestId('annoter-annuler').click()
  await annoter.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  verifie('crayon : « Annuler » ferme sans rien changer', await page.getByTestId('annoter').count() === 0 && await ecrire.locator('[data-testid="piece-jointe"] img').getAttribute('src') === pieceAvant && await conv().count() === 1)
  await crayon.click()
  await annoter.getByTestId('annoter-toile').waitFor({ state: 'visible', timeout: 8000 })
  await tracer(page)
  await annoter.getByTestId('annoter-defaire').click()
  verifie('crayon : « annuler le dernier trait » le retire', await annoter.getByTestId('annoter-enregistrer').isDisabled())
  await tracer(page)
  await page.keyboard.press('Escape')
  const confDessin = page.locator('dialog[open]', { hasText: 'Quitter sans garder le dessin ?' })
  await confDessin.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('crayon : Échap avec un dessin demande avant de le perdre', await confDessin.count() === 1 && await annoter.count() === 1)
  await confDessin.getByRole('button', { name: 'Rester' }).click()
  await page.waitForTimeout(300)
  verifie('crayon : « Rester » garde le dessin', await annoter.count() === 1 && !(await annoter.getByTestId('annoter-enregistrer').isDisabled()))
  const rouge = await annoter.getByTestId('annoter-toile').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 100) n++; return n })
  verifie('crayon : le trait est bien peint en rouge sur l’image', rouge > 50, rouge)
  await annoter.getByTestId('annoter-enregistrer').click()
  await annoter.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  verifie('crayon : « Enregistrer » : toast visible', await toastAuPremierPlan(/Image annotée/), { auPremierPlan: dernierDessus })
  verifie('crayon : l’image annotée remplace la pièce jointe', await ecrire.getByTestId('piece-jointe').count() === 1 && await ecrire.locator('[data-testid="piece-jointe"] img').getAttribute('alt') === 'photo-annotee.png' && await ecrire.locator('[data-testid="piece-jointe"] img').getAttribute('src') !== pieceAvant)
  await capture(page, 'crayon-remplace')
  await ecrire.getByTestId('envoyer-message').click()
  verifie('« Envoyer » : toast visible', await toastAuPremierPlan(/Message envoyé/), { auPremierPlan: dernierDessus })
  const ecrits = sql(`select kind, auteur_type, corps from messages where chantier_id = '${R1.id}'`)
  verifie('le message est en base (info, propriétaire)', ecrits.length === 1 && ecrits[0].kind === 'info' && ecrits[0].auteur_type === 'proprietaire' && ecrits[0].corps === `${MARQUE2} message à Claude`, ecrits)
  const mR1 = sql(`select medias from messages where chantier_id = '${R1.id}'`)[0]?.medias ?? []
  verifie('« Écrire à Claude » : la photo (annotée) part avec le message', mR1.length === 1 && mR1[0].nom === 'photo-annotee.png', mR1)
  const objR1 = sql(`select name from storage.objects where bucket_id = 'cockpit-medias' and name like '${projet.id}/${R1.id}/%'`).map((r) => r.name)
  verifie('crayon : dans le stockage, l’annotée est là et l’originale retirée', objR1.length === 1 && objR1[0] === mR1[0]?.chemin, objR1)
  verifie('après l’envoi, plus de vignette en attente dans la barre', await ecrire.getByTestId('piece-jointe').count() === 0 && (await ecrire.locator('textarea').inputValue()) === '')
  const bulleR1 = conv().locator('[data-testid="bulle"][data-cote="droite"]', { hasText: 'message à Claude' })
  await bulleR1.waitFor({ timeout: 10000 }).catch(() => {})
  verifie('le message apparaît en bulle à droite (toi)', await bulleR1.count() === 1)
  const vignette = bulleR1.locator('[data-testid="media"] img').first()
  await vignette.waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  verifie('la photo s’affiche dans la bulle (lien signé, image réellement chargée)', await vignette.count() === 1 && await vignette.evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false))
  if (await vignette.count()) {
    await vignette.click()
    const grande = page.locator('dialog[open] img[alt="photo-annotee.png"]').last()
    await grande.waitFor({ timeout: 8000 }).catch(() => {})
    verifie('un toucher sur la vignette l’ouvre en grand', await grande.count() >= 1)
    await capture(page, 'photo-en-grand')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  verifie('Échap ferme la photo, pas la conversation', await conv().count() === 1)
  // Le crayon sur une image déjà envoyée : l'annotée part comme une nouvelle pièce, dans le même fil.
  const crayonBulle = bulleR1.getByTestId('crayon-media')
  verifie('crayon : aussi sur la photo envoyée (bulle de Raphaël)', await crayonBulle.count() === 1)
  if (await crayonBulle.count()) {
    await crayonBulle.click()
    await page.getByTestId('annoter-toile').waitFor({ state: 'visible', timeout: 15000 })
    await tracer(page)
    await page.getByTestId('annoter-enregistrer').click()
    await page.getByTestId('annoter').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    verifie('crayon après envoi : toast visible', await toastAuPremierPlan(/Image annotée envoyée/), { auPremierPlan: dernierDessus })
    const nouv = sql(`select corps, medias from messages where chantier_id = '${R1.id}' and corps like 'Image annotée%'`)
    verifie('crayon après envoi : nouvelle pièce dans le fil (l’envoyée ne change pas)', nouv.length === 1 && nouv[0].medias.length === 1 && nouv[0].medias[0].chemin !== mR1[0]?.chemin && sql(`select medias from messages where chantier_id = '${R1.id}'`).some((m) => m.medias?.[0]?.chemin === mR1[0]?.chemin), nouv)
    await conv().locator('[data-testid="bulle"]', { hasText: 'Image annotée' }).waitFor({ timeout: 10000 }).catch(() => {})
    verifie('crayon après envoi : la nouvelle bulle s’affiche', await conv().locator('[data-testid="bulle"]', { hasText: 'Image annotée' }).count() === 1)
  }
  await capture(page, 'conversation-reportee')
  await conv().getByTestId('relancer-maintenant').click()
  verifie('« Relancer maintenant » : toast visible', await toastAuPremierPlan(/relancé/), { auPremierPlan: dernierDessus })
  verifie('« Relancer maintenant » : en base, le chantier passe à libre', sql(`select etat from chantiers where id = '${R1.id}'`)[0]?.etat === 'libre')
  await fermerConv()

  // ===================================================================
  // 7 bis. Mise en ligne (GitHub simulé) et mode autonome, dans « Réglages du projet » (replié)
  console.log('  — mise en ligne et mode autonome')
  const reglagesP = page.getByTestId('reglages-projet')
  await reglagesP.locator('> button').click()
  const dep = reglagesP.getByTestId('barre-projet').getByTestId('deploiement')
  await dep.waitFor({ timeout: 10000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="barre-projet"] [data-testid="deploiement"]')?.getAttribute('data-etat') !== 'chargement', null, { timeout: 10000 }).catch(() => {})
  verifie('mise en ligne : « Mise en ligne en cours », animée', (await dep.getAttribute('data-etat')) === 'en_cours' && /Mise en ligne en cours/.test(await dep.textContent()) && await dep.locator('.point-vivant').count() === 1, await dep.textContent())
  await dep.getByTestId('deploiement-titre').click()
  verifie('mise en ligne : une ligne par workflow, avec le lien GitHub', await dep.getByTestId('deploiement-lignes').locator('a').count() === 2 && /github\.com/.test(await dep.getByTestId('deploiement-lignes').locator('a').first().getAttribute('href')))
  githubMode = 'limite'
  await dep.getByTestId('deploiement-relire').click()
  await dep.getByText(/GitHub limite les consultations/).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('GitHub en limite (403) : l’écran le dit, et garde le dernier état lu', /GitHub limite les consultations/.test(await dep.textContent()) && /Mise en ligne en cours/.test(await dep.textContent()))
  githubMode = 'ok'
  await dep.getByTestId('deploiement-relire').click()
  await capture(page, 'deploiement')
  const barreP = () => page.getByTestId('barre-projet')
  const auto = barreP().getByTestId('mode-autonome')
  await auto.getByTestId('autonome-ouvrir').click()
  verifie('mode autonome : le formulaire dit ce que fait la session (libres seulement, sans dépense…)', /chantiers LIBRES, pas encore triés ou abandonnés \(jamais « à cadrer »\), sans dépense, suppression ni envoi en ton nom/.test(await auto.textContent()))
  const defauts = { heure: await auto.getByTestId('autonome-heure').inputValue(), max: await auto.getByTestId('autonome-max').inputValue() }
  const maxBase = String(sql(`select autonome_max from projets where id = '${projet.id}'`)[0].autonome_max)
  verifie('mode autonome : heure par défaut 09:00, plafond = celui du projet en base', defauts.heure === '09:00' && defauts.max === maxBase, { ...defauts, maxBase })
  await auto.getByTestId('autonome-max').fill('99')
  await auto.getByTestId('autonome-allumer').click()
  verifie('mode autonome : un plafond hors 1-50 est refusé en clair', await toastAuPremierPlan(/entre 1 et 50/))
  await auto.getByTestId('autonome-max').fill('5')
  await capture(page, 'autonome-formulaire')
  await auto.getByTestId('autonome-allumer').click()
  verifie('mode autonome allumé : toast visible', await toastAuPremierPlan(/Autonome jusqu’à 09:00/), { auPremierPlan: dernierDessus })
  const [pa] = sql(`select autonome_jusqu_a, autonome_max from projets where id = '${projet.id}'`)
  verifie('mode autonome : en base, une heure de fin future (≤ 24 h) et le plafond 5', !!pa?.autonome_jusqu_a && Date.parse(pa.autonome_jusqu_a) > Date.now() && Date.parse(pa.autonome_jusqu_a) - Date.now() <= 24 * 3600_000 && pa.autonome_max === 5, pa)
  const bandeau = barreP().getByTestId('autonome-bandeau')
  await bandeau.waitFor({ timeout: 10000 }).catch(() => {})
  const nLibres = Number(sql(`select count(*) as n from chantiers_prenables('${projet.id}', null)`)[0].n)
  verifie('bandeau « Autonome jusqu’à 09:00 — N chantiers prêts » (N = chantiers_prenables en base)', /Autonome jusqu’à 09:00/.test(await bandeau.textContent()) && (await bandeau.textContent()).includes(`${nLibres} chantier`), { texte: await bandeau.textContent(), nLibres })
  verifie('« Réglages du projet » replié annonce « autonome »', /autonome/.test(await reglagesP.locator('> button').textContent()))
  await capture(page, 'autonome-allume')
  await barreP().getByTestId('autonome-arreter').click()
  verifie('« Arrêter maintenant » : toast visible', await toastAuPremierPlan(/Mode autonome arrêté/))
  verifie('« Arrêter maintenant » : en base, éteint (null)', sql(`select autonome_jusqu_a from projets where id = '${projet.id}'`)[0].autonome_jusqu_a === null)
  await barreP().getByTestId('autonome-ouvrir').click()
  await barreP().getByTestId('autonome-toujours').check()
  await barreP().getByTestId('autonome-allumer').click()
  verifie('« tout le temps » : toast visible', await toastAuPremierPlan(/Autonome tout le temps/))
  const [pt] = sql(`select autonome_toujours, autonome_jusqu_a from projets where id = '${projet.id}'`)
  verifie('« tout le temps » : en base, autonome_toujours sans heure de fin', pt?.autonome_toujours === true && pt.autonome_jusqu_a === null, pt)
  await barreP().getByTestId('autonome-bandeau').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('« tout le temps » : le bandeau le dit', /Autonome tout le temps/.test(await barreP().getByTestId('autonome-bandeau').textContent()))
  await barreP().getByTestId('autonome-changer').click()
  verifie('« Changer… » rouvre le choix, « tout le temps » coché', await barreP().getByTestId('autonome-toujours').isChecked())
  await barreP().getByTestId('autonome-jusqua').check()
  await barreP().getByTestId('autonome-allumer').click()
  await toastAuPremierPlan(/Autonome jusqu’à 09:00/)
  const [pc] = sql(`select autonome_toujours, autonome_jusqu_a from projets where id = '${projet.id}'`)
  verifie('« Changer… » → jusqu’à 09:00 : en base, plus « tout le temps », une heure de fin', pc?.autonome_toujours === false && !!pc.autonome_jusqu_a, pc)
  await barreP().getByTestId('autonome-arreter').click()
  await toastAuPremierPlan(/Mode autonome arrêté/)
  verifie('« tout le temps » arrêté : en base, éteint', (([r]) => r.autonome_toujours === false && r.autonome_jusqu_a === null)(sql(`select autonome_toujours, autonome_jusqu_a from projets where id = '${projet.id}'`)))
  await allerTout()
  await page.getByTestId('reglages-projets').locator('> button').click()
  const resumeProjet = page.locator(`[data-testid="projet-resume"][data-projet="${SLUG}"]`)
  verifie('« Tout » : « Réglages des projets » (replié), un bloc par projet (mise en ligne + mode autonome)', await resumeProjet.getByTestId('deploiement').count() === 1 && await resumeProjet.getByTestId('mode-autonome').count() === 1)
  await allerCockpit()

  // ===================================================================
  // 8. La liste complète en lignes, le menu ⋯, créer / supprimer
  console.log('  — tous les chantiers, menu ⋯')
  await page.evaluate(() => window.scrollTo(0, 0))
  await deplierTout()
  const nbLignes = await page.locator('[data-testid="tous-les-chantiers"] [data-testid="groupe-section"] [data-testid="ligne-chantier"]').count()
  verifie('les chantiers du projet s’affichent en lignes compactes, sections dépliées (≥ 10)', nbLignes >= 10, nbLignes)
  const nbGroupes = await page.getByTestId('groupe-section').count()
  verifie('groupés par section (≥ 3 groupes)', nbGroupes >= 3, nbGroupes)
  verifie('chaque en-tête de section porte ses compteurs (icônes, pas d’emoji)', await page.getByTestId('compteurs-section').count() === nbGroupes && await page.getByTestId('compteurs-section').first().locator('svg').count() >= 1)
  const hLigne = (await page.locator('[data-testid="groupe-section"] [data-testid="ligne-chantier"]').first().boundingBox())?.height ?? 999
  verifie('une ligne est compacte (≤ 64 px)', hLigne <= 64, hLigne)
  const premiere = page.locator('[data-testid="groupe-section"] [data-testid="ligne-chantier"]').first()
  const titrePremiere = (await premiere.locator('.truncate').first().textContent()).trim()
  await premiere.getByTestId('ouvrir-chantier').click()
  await attendreConv(titrePremiere)
  verifie('une ligne s’ouvre en conversation, « Écrire à Claude… » en bas', await conv().getByTestId('ecrire-a-claude').count() === 1)
  await conv().getByTestId('menu-chantier').click()
  const itemsMenu = await Promise.all(['modifier', 'ouvrir-historique', 'doublon-de', 'archiver', 'supprimer'].map((t) => conv().getByTestId(t).count()))
  verifie('menu ⋯ : Modifier, Historique, C’est un doublon de…, Archiver, Supprimer', itemsMenu.every((n) => n === 1), itemsMenu)
  await conv().getByTestId('modifier').click()
  const dlgM = page.getByRole('dialog').filter({ hasText: 'Modifier le chantier' })
  await dlgM.waitFor({ timeout: 5000 })
  verifie('« Modifier » s’ouvre par-dessus la conversation', await dlgM.isVisible())
  await page.keyboard.press('Escape')
  await dlgM.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  verifie('Échap ferme « Modifier », la conversation reste', await conv().count() === 1)
  // Même règle pour les dialogues : toucher le fond ferme, une modification non enregistrée est protégée.
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('modifier').click()
  await dlgM.waitFor({ timeout: 5000 })
  await page.mouse.click(195, 12)
  await dlgM.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  verifie('« Modifier » sans changement : toucher le fond au-dessus le ferme, la conversation reste', !(await dlgM.isVisible()) && await conv().count() === 1)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('modifier').click()
  await dlgM.waitFor({ timeout: 5000 })
  await dlgM.getByRole('textbox').first().fill('Titre changé mais pas enregistré')
  await page.mouse.click(195, 12)
  const confModif = page.locator('dialog[open]', { hasText: 'Quitter sans envoyer ?' })
  await confModif.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('« Modifier » avec un changement : toucher le fond demande d’abord', await confModif.count() === 1 && await dlgM.isVisible())
  await confModif.getByRole('button', { name: 'Rester' }).click()
  await page.waitForTimeout(300)
  verifie('…« Rester » : le changement est toujours là', await dlgM.getByRole('textbox').first().inputValue() === 'Titre changé mais pas enregistré')
  await dlgM.getByRole('button', { name: 'Annuler' }).click()
  await dlgM.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  verifie('« Annuler » reste un abandon explicite (sans question), la conversation reste', !(await dlgM.isVisible()) && await conv().count() === 1)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('doublon-de').click()
  const dlgDd = page.getByRole('dialog').filter({ hasText: 'Chantier à garder' })
  await dlgDd.waitFor({ timeout: 5000 })
  verifie('« C’est un doublon de… » s’ouvre par-dessus la conversation', await dlgDd.isVisible())
  await dlgDd.getByRole('button', { name: 'Annuler' }).click()
  verifie('toujours pas de défilement horizontal, conversation ouverte', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'conversation')
  await fermerConv()
  await page.getByTestId('tout-deplier').click()
  verifie('« Tout replier » replie les sections', await page.locator('[data-testid="groupe-section"] [data-testid="ligne-chantier"]').count() === 0)

  await page.getByTestId('nouveau-chantier').click()
  await page.getByTestId('titre').fill('Hook de démarrage paramétré par projet')
  verifie('« Ça existe déjà » s’affiche sur un titre proche d’un chantier existant', await page.getByTestId('ca-existe-deja').waitFor({ timeout: 3000 }).then(() => true, () => false))
  const titreTest = `${MARQUE} chantier éphémère`
  await page.getByTestId('titre').fill(titreTest)
  await page.getByTestId('demande').fill('Créé par verifier-web, supprimé juste après.')
  await page.getByTestId('creer-chantier').click()
  await page.getByText(/créé\.$/).first().waitFor({ timeout: 10000 })
  await deplierTout()
  const ligneTest = ligneDe(titreTest)
  await ligneTest.waitFor({ timeout: 15000 })
  verifie('le chantier créé apparaît dans la liste', await ligneTest.count() === 1)
  await ligneTest.getByTestId('ouvrir-chantier').click()
  await attendreConv(titreTest)
  // Archiver puis désarchiver : réversible, le toast le dit.
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('archiver').click()
  verifie('« Archiver » : toast visible, en base archivé', await toastAuPremierPlan(/Chantier archivé/) && !!sql(`select archived_at from chantiers where titre = '${esc(titreTest)}'`)[0]?.archived_at)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('archiver').click()
  verifie('« Désarchiver » : toast visible, en base de nouveau ouvert', await toastAuPremierPlan(/désarchivé/) && !sql(`select archived_at from chantiers where titre = '${esc(titreTest)}'`)[0]?.archived_at)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('supprimer').click()
  const dialogue = page.getByRole('dialog').filter({ hasText: 'Supprimer ce chantier' })
  await dialogue.waitFor({ timeout: 5000 })
  verifie('la confirmation nomme le chantier', (await dialogue.textContent()).includes(titreTest))
  await capture(page, 'confirmation')
  await dialogue.getByRole('button', { name: 'Annuler' }).click()
  verifie('« Annuler » ne supprime pas', await conv().count() === 1 && sql(`select count(*) as n from chantiers where titre = '${esc(titreTest)}'`)[0].n === 1)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('supprimer').click()
  await dialogue.waitFor({ timeout: 5000 })
  await dialogue.getByRole('button', { name: 'Supprimer' }).click()
  await page.getByText(/supprimé\.$/).first().waitFor({ timeout: 10000 })
  await conv().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('supprimé : la conversation se ferme', await conv().count() === 0)
  await ligneTest.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('le chantier supprimé disparaît de l’écran et de la base', await ligneTest.count() === 0 && sql(`select count(*) as n from chantiers where titre like '${MARQUE}%'`)[0].n === 0)
  verifie('la suppression a laissé sa trace dans « supprimes »', sql(`select count(*) as n from supprimes where ligne->>'titre' like '${MARQUE}%'`)[0].n >= 1)

  // --- menu et réglages (délai de silence, fenêtre « fini »)
  await page.getByTestId('menu').click()
  await page.getByRole('menuitem', { name: /Réglages/ }).click()
  await page.getByTestId('fenetre-livre').waitFor({ timeout: 5000 })
  const autreSilence = silenceMin === 30 ? 60 : 30
  await page.getByTestId('silence-minutes').getByRole('button', { name: `${autreSilence} min`, exact: true }).click()
  verifie('réglage « délai de silence » : toast visible', await toastAuPremierPlan(/Pris, mais silencieux/), { auPremierPlan: dernierDessus })
  const prefSil = sql(`select valeur from preferences where user_id = '${moiId}' and cle = 'silence_minutes'`)[0]
  verifie('réglage « délai de silence » : enregistré dans preferences (silence_minutes)', Number(prefSil?.valeur) === autreSilence, prefSil)
  verifie('le bouton choisi est marqué', (await page.getByTestId('silence-minutes').getByRole('button', { name: `${autreSilence} min`, exact: true }).getAttribute('aria-pressed')) === 'true')
  await capture(page, 'reglages')
  await page.getByTestId('silence-minutes').getByRole('button', { name: `${silenceMin} min`, exact: true }).click()
  await page.keyboard.press('Escape')

  // ===================================================================
  // 9. Doublons, sélection groupée, historique
  const toastAuPremierPlanLocal = toastAuPremierPlan
  const ANCIEN = 'Ancien texte de la demande, à retrouver par l’historique.'
  const d1a = creerTest('zorglub quintessence harmonique alpha', { demande: 'Premier de la paire ignorée.' })
  const d1b = creerTest('zorglub quintessence harmonique beta', { demande: 'Second de la paire ignorée.' })
  const s1 = creerTest('colibri turquoise', { priorite: 'haute' })
  const s2 = creerTest('mangouste ardoise', { priorite: 'basse' })
  const h1 = creerTest('pelican historique', { demande: ANCIEN })
  sql(`update chantiers set demande = 'Nouveau texte qui a écrasé l''ancien.' where id = '${h1.id}'`)
  await actualiser()
  await deplierTout()
  await ligneDe(h1.titre).waitFor({ timeout: 15000 })

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
  verifie('« Pas un doublon » : le toast de confirmation est visible au premier plan', await toastAuPremierPlanLocal(/ne sera plus proposée/), { auPremierPlan: dernierDessus })
  await paire1.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  verifie('« Pas un doublon » : la paire disparaît', await paire1.count() === 0)
  const prefD = sql(`select valeur from preferences where user_id = '${moiId}' and cle = 'doublons_ignores'`)[0]
  verifie('« Pas un doublon » : enregistré dans preferences (doublons_ignores)', !!prefD && Array.isArray(prefD.valeur) && prefD.valeur.includes(clePaire(d1a.id, d1b.id)), prefD)
  await page.keyboard.press('Escape')
  await dlgD.waitFor({ state: 'hidden', timeout: 5000 })

  const d2a = creerTest('pamplemousse gyroscope lunaire nord', { demande: 'Demande de la source.' })
  const d2b = creerTest('pamplemousse gyroscope lunaire sud', { demande: 'Demande de la cible.' })
  await actualiser()
  await deplierTout()
  await ligneDe(d2b.titre).waitFor({ timeout: 15000 })
  dlgD = await ouvrirDoublons()
  const paire2 = dlgD.getByTestId('paire-doublon').filter({ hasText: d2a.titre }).filter({ hasText: d2b.titre })
  await paire2.waitFor({ timeout: 5000 })
  verifie('Doublons : la paire ignorée ne revient pas à la réouverture', await dlgD.getByTestId('paire-doublon').filter({ hasText: d1a.titre }).count() === 0)
  await paire2.locator('button', { hasText: d2b.titre }).click()
  verifie('Doublons : le chantier choisi est marqué « On garde »', (await paire2.locator('button', { hasText: d2b.titre }).textContent()).includes('On garde'))
  const NOTE = 'note de fusion [TEST web]'
  await paire2.getByPlaceholder(/Note sur la fusion/).fill(NOTE)
  await paire2.getByRole('button', { name: 'Fusionner' }).click()
  verifie('Fusion : le toast de succès est visible au premier plan', await toastAuPremierPlanLocal(/fusionné dans/), { auPremierPlan: dernierDessus })
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

  console.log('  — sélection groupée')
  await page.getByTestId('menu').click()
  await page.getByRole('menuitem', { name: /Choisir/ }).click()
  const barre = page.getByTestId('barre-selection')
  await barre.waitFor({ timeout: 5000 })
  await page.getByRole('checkbox', { name: `Choisir ${s1.titre}` }).check()
  await page.getByRole('checkbox', { name: `Choisir ${s2.titre}` }).check()
  verifie('sélection : toutes les sections s’ouvrent (on ne coche pas ce qu’on ne voit pas)', await page.locator('[data-testid="groupe-section"] > button[aria-expanded="false"]').count() === 0)
  verifie('sélection : cocher ne rouvre pas de conversation', await conv().count() === 0)
  verifie('sélection : la barre compte « 2 choisis »', (await barre.textContent()).includes('2 choisis'), await barre.textContent())
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(300)
  const bBarre = await barre.boundingBox()
  const bDerniere = await page.locator('[data-testid="vue-projet"] > :last-child').boundingBox()
  verifie('sélection : la barre ne masque pas le bas de la page (défilement en bas)', bBarre && bDerniere && bDerniere.y + bDerniere.height <= bBarre.y + 0.5, { barre: bBarre, dernier: bDerniere })
  verifie('sélection : pas de défilement horizontal avec la barre', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'selection')
  await barre.getByLabel('Priorité').selectOption('normale')
  verifie('sélection : toast « 2 chantiers modifiés » visible, au-dessus de la barre', await toastAuPremierPlanLocal(/2 chantiers modifiés/), { auPremierPlan: dernierDessus })
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

  console.log('  — historique')
  await deplierTout()
  await ligneDe(h1.titre).scrollIntoViewIfNeeded()
  await ligneDe(h1.titre).getByTestId('ouvrir-chantier').click()
  await attendreConv(h1.titre)
  await conv().getByTestId('menu-chantier').click()
  await conv().getByTestId('ouvrir-historique').click()
  const hist = conv().getByTestId('historique')
  const ligneH = hist.locator('li', { hasText: ANCIEN.slice(0, 40) })
  await ligneH.waitFor({ timeout: 10000 }).catch(() => {})
  verifie('menu ⋯ → Historique : ouvert, la ligne « demande » montre l’ancien texte', await ligneH.count() === 1 && (await ligneH.textContent()).toLowerCase().includes('demande'))
  verifie('historique : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'historique')
  await ligneH.getByRole('button', { name: /Revenir à ce texte/ }).click()
  const dlgR = page.getByRole('dialog').filter({ hasText: 'Revenir à l’ancien' })
  await dlgR.waitFor({ timeout: 5000 })
  verifie('restauration : la confirmation montre le texte qui reviendra', (await dlgR.textContent()).includes(ANCIEN))
  await capture(page, 'historique-confirmation')
  await dlgR.getByRole('button', { name: 'Revenir à ce texte' }).click()
  verifie('restauration : toast « Texte restauré » visible', await toastAuPremierPlanLocal(/Texte restauré/), { auPremierPlan: dernierDessus })
  const [hApres] = sql(`select demande from chantiers where id = '${h1.id}'`)
  verifie('restauration : en base, la demande est revenue à l’ancien texte', hApres?.demande === ANCIEN, hApres)
  const traces = sql(`select champ, nouvelle, par from historique where chantier_id = '${h1.id}' order by id`)
  const derniere = traces[traces.length - 1]
  verifie('restauration : une nouvelle ligne d’historique trace la restauration', traces.length === 2 && derniere.champ === 'demande' && derniere.nouvelle === ANCIEN && /restauration/.test(derniere.par ?? ''), traces)
  await hist.locator('li', { hasText: 'Nouveau texte' }).first().waitFor({ timeout: 10000 }).catch(() => {})
  verifie('restauration : l’écran recharge l’historique (2 changements)', (await hist.textContent()).includes('2 changements'), await hist.textContent())
  verifie('restauration : la demande de la conversation suit', (await conv().getByTestId('bulle-demande').textContent()).includes(ANCIEN.slice(0, 30)))

  // --- grand écran : la conversation devient un grand dialogue centré
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(500)
  const bConvD = await conv().boundingBox()
  verifie('desktop : la conversation est un dialogue centré (pas plein écran)', bConvD && bConvD.width <= 680 && bConvD.x > 200, bConvD)
  verifie('desktop : pas de défilement horizontal non plus', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'desktop-conversation')
  await page.mouse.click(60, 450)
  await conv().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  verifie('desktop : cliquer à côté du dialogue le ferme', await conv().count() === 0)
  if (await conv().count()) await fermerConv()
  await capture(page, 'desktop')

  // Le 403 de GitHub est provoqué exprès (simulation de la limite) : c'est son effet voulu.
  const erreursReelles = erreursConsole.filter((t) => !estErreurWsConteneur(t) && !/status of 403/.test(t))
  verifie('aucune erreur JavaScript dans la console', erreursReelles.length === 0, erreursReelles.slice(0, 5))
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e && e.message ? e.message : e}`)
  await capture(page, 'echec').catch(() => {})
} finally {
  // Nettoyage des lignes de test, quoi qu'il arrive.
  try { sql(`delete from messages where corps like '${MARQUE}%'`); sql(`delete from chantiers where titre like '${MARQUE}%'`); sql(`delete from supprimes where ligne->>'titre' like '${MARQUE}%'`) } catch (e) { console.log(`  (nettoyage SQL : ${e.message})`) }
  // Chantiers de test (messages et activités suivent en cascade), leur historique,
  // leur trace de suppression, les paires « pas un doublon » et le réglage de silence.
  try {
    const ids = idsTest.length ? idsTest.map((i) => `'${i}'`).join(', ') : `'00000000-0000-0000-0000-000000000000'`
    sql(`delete from messages where chantier_id in (${ids}) or corps like '%${MARQUE2}%'`)
    sql(`delete from activite where chantier_id in (${ids}) or session like '${SESSION_TEST}%'`)
    sql(`delete from sessions where id like '${SESSION_TEST}%'`)
    sql(`delete from ce_qui_marche where chantier_id in (${ids})`)
    sql(`delete from chantiers where id in (${ids}) or titre like '${MARQUE2}%'`)
    sql(`delete from historique where chantier_id in (${ids})`)
    sql(`delete from supprimes where chantier_id in (${ids}) or ligne->>'titre' like '${MARQUE2}%'`)
    if (!prefDoublonsExistait) sql(`delete from preferences where user_id = '${moiId}' and cle = 'doublons_ignores'`)
    else if (idsTest.length) sql(`update preferences set valeur = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements_text(valeur) e where not (e ~ '${idsTest.join('|')}')) where user_id = '${moiId}' and cle = 'doublons_ignores'`)
    if (!prefSilenceAvant) sql(`delete from preferences where user_id = '${moiId}' and cle = 'silence_minutes'`)
    else sql(`update preferences set valeur = '${esc(JSON.stringify(prefSilenceAvant.valeur))}'::jsonb where user_id = '${moiId}' and cle = 'silence_minutes'`)
    if (projet) purgerProjetsDeTest([projet.id])
    const reste = sql(`select (select count(*) from chantiers where id in (${ids}) or titre like '${MARQUE2}%') + (select count(*) from historique where chantier_id in (${ids})) + (select count(*) from supprimes where chantier_id in (${ids})) + (select count(*) from activite where session like '${SESSION_TEST}%') + (select count(*) from sessions where id like '${SESSION_TEST}%') as n`)[0].n
    const restesReels = sql(`select (select count(*) from projets where slug like 'test-web-%') + (select count(*) from chantiers where titre like '[TEST%') + (select count(*) from messages where corps like '%[TEST%') + (select count(*) from activite where session like '${SESSION_TEST}%' or etape like '[TEST%') + (select count(*) from sessions where id like '${SESSION_TEST}%' or sujet like '[TEST%') + (select count(*) from taches where description like '[TEST%') + (select count(*) from supprimes where ligne->>'titre' like '[TEST%') as n`)[0].n
    verifie('nettoyage : plus AUCUNE ligne de test, ni projet de test, ni trace dans les projets réels', reste === 0 && restesReels === 0, { reste, restesReels })
  } catch (e) { console.log(`  (nettoyage SQL [TEST web] : ${e.message})`) }
  await navigateur.close()
  arreterServeur()
}
console.log(`\nverifier-web : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)

// Un toast réellement VISIBLE : présent ET au premier plan à son centre (pas
// caché derrière un dialogue modal ou la barre de sélection). Déclaré en
// function (hissée) : utilisé dans tout le parcours.
var dernierDessus = null
async function toastAuPremierPlan(re) {
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
