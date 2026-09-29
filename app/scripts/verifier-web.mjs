// Parcours de l'app dans un VRAI navigateur, à la taille d'un téléphone
// (390 × 844), contre la vraie base (projets « cockpit » et « facepro »).
//
//   cd app && npm run build
//   source <fichier des identifiants de test>   # COCKPIT_TEST_EMAIL / COCKPIT_TEST_PASSWORD
//   node scripts/verifier-web.mjs
//
// Il sert dist/ avec `vite preview`, se connecte, et vérifie :
//  - l'ACCUEIL = l'onglet « Tout » : « Où j'en suis » (vue d'ensemble), « En ce moment » et le début de « À toi »
//    dans le premier écran, « Personne ne travaille » quand aucune session n'a
//    donné signe de vie (29 sept. 2026 : barres orange à 85 % sans personne) ;
//  - la PRÉSENCE : une activité de test mise à jour maintenant apparaît dans
//    « En ce moment » avec une barre vive ; une vieille de 2 h n'y est pas, et
//    sa carte dit « Personne dessus » / « Pris, mais silencieux » ;
//  - « Qui travaille » : une session factice et ses deux tâches (un agent qui
//    a signalé son avancement → barre ; une commande muette → « avancement non
//    signalé », pas de barre), un agent lié à un chantier → « Un agent y travaille » ;
//  - « À toi » : une question se répond sans rien déplier ; une fusion
//    proposée par Claude disparaît sur « Garder séparés » ; un chantier à
//    vérifier montre ses étapes, sa frise de mise en ligne et la phrase « C'est
//    en ligne » / « Pas encore en ligne », et se certifie de là ;
//  - « À lancer » : « Copier la consigne » met le bon texte dans le
//    presse-papiers, « Demander où ça en est » écrit le message en base ;
//  - une carte reportée : « Écrire à Claude » visible, l'envoi crée le
//    message, « Relancer maintenant » la rend libre ;
//  - et tout ce qui existait : création/suppression avec confirmation,
//    réglages (dont le délai de silence), Doublons, sélection groupée avec
//    « Annuler », historique, « Comment vérifier ».
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
  sql(`insert into projets (id, slug, nom, couleur, actif, description, depot) values ('${id}', '${SLUG}', '🧪 Test auto (s’efface seul)', '#64748B', true, 'Projet créé et supprimé par app/scripts/verifier-web.mjs', '${DEPOT_TEST}')`)
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

// --- navigation
const allerTout = async () => { await page.getByTestId('onglet-tout').click(); await page.getByTestId('vue-tout').waitFor({ timeout: 10000 }) }
const ongletTest = () => page.getByTestId(`onglet-${SLUG}`)
const allerCockpit = async () => { await ongletTest().click(); await page.getByTestId('vue-projet').waitFor({ timeout: 10000 }) }
// Les sections de « Tous les chantiers » sont repliées par défaut : on les ouvre (et on rouvre si une section est apparue).
const deplierTout = async () => {
  const b = page.getByTestId('tout-deplier')
  if (await b.count() && (await b.textContent()).includes('Tout déplier')) { await b.click(); await page.waitForTimeout(150) }
}
const carteDe = (titre) => page.locator('[data-testid="tous-les-chantiers"] [data-testid="carte"]', { hasText: titre })
const carteId = (id) => page.locator(`[data-testid="tous-les-chantiers"] [data-chantier="${id}"]`)
const actualiser = async () => { await page.getByTestId('actualiser').click(); await page.waitForTimeout(700) }
// Un élément « À toi » d'un chantier, en dépliant « Voir les N autres » de son groupe s'il le faut.
const elementAToi = async (chantierId, type) => {
  const el = page.locator(`[data-testid="element-a-toi"][data-type="${type}"][data-element-chantier="${chantierId}"]`)
  if (!(await el.count())) {
    const plus = page.getByTestId(`groupe-a-toi-${type}`).getByRole('button', { name: /Voir les \d+ autres/ })
    if (await plus.count()) await plus.click()
  }
  await el.waitFor({ timeout: 10000 })
  return el
}
const ligneALancer = async (chantierId) => {
  const l = page.locator(`[data-testid="ligne-a-lancer"][data-ligne-chantier="${chantierId}"]`)
  if (!(await l.count())) {
    for (const b of await page.getByTestId('groupe-a-lancer').getByRole('button', { name: /Voir les \d+ autres/ }).all()) await b.click()
  }
  await l.waitFor({ timeout: 10000 })
  return l
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
  // 1. L'accueil : l'onglet « Tout », premier écran
  console.log('  — accueil « Tout »')
  verifie('l’onglet « Tout » est l’accueil (sélectionné par défaut)', (await page.getByTestId('onglet-tout').getAttribute('aria-selected')) === 'true')
  const bEnsemble = await page.getByTestId('ou-jen-suis').boundingBox()
  const bMoment = await page.getByTestId('en-ce-moment').boundingBox()
  verifie('« Où j’en suis » (vue d’ensemble) est le premier bloc, en haut de l’écran', bEnsemble && bEnsemble.y < 200, bEnsemble)
  verifie('« En ce moment » vient juste après', bMoment && bEnsemble && bMoment.y > bEnsemble.y && bMoment.y < bEnsemble.y + bEnsemble.height + 40, { bEnsemble, bMoment })
  const lignesEnsemble = await page.getByTestId('ligne-ou-jen-suis').count()
  const nProjetsActifs = Number(sql(`select count(*) as n from projets where actif`)[0].n)
  verifie('« Où j’en suis » dans « Tout » : une ligne par projet actif, plus le total', lignesEnsemble === nProjetsActifs + (nProjetsActifs > 1 ? 1 : 0), { lignesEnsemble, nProjetsActifs })
  const totalPourToi = await page.getByTestId('ou-jen-suis').locator('[data-testid="ligne-ou-jen-suis"]').last().locator('[data-colonne="pourToi"]').textContent().catch(() => '0')
  verifie('« pour toi » (total) = le nombre de « À toi » : une seule règle', Number(totalPourToi) === Number(await page.getByTestId('a-toi-total').textContent()), { tableau: totalPourToi, aToi: await page.getByTestId('a-toi-total').textContent() })
  await capture(page, 'ou-jen-suis')
  if (bMoment && bMoment.height <= 400) verifie('« En ce moment » entièrement dans le premier écran (844 px)', bMoment.y + bMoment.height <= 844, bMoment)
  const bToi = await page.getByTestId('a-toi').boundingBox()
  // « Au mieux » : quand beaucoup de choses tournent VRAIMENT (plusieurs sessions et agents, données
  // réelles), « En ce moment » peut dépasser l'écran à lui seul ; l'onglet « Tout » annonce alors le
  // nombre de choses qui t'attendent (🔴 n), déjà visible. Sinon, « À toi » doit commencer à l'écran.
  if (bMoment && bMoment.height > 400) {
    console.log(`    (« En ce moment » fait ${Math.round(bMoment.height)} px avec l’activité réelle de l’instant : on vérifie que l’onglet annonce « À toi »)`)
    verifie('beaucoup d’activité réelle : « À toi » annoncé dans le premier écran (nombre sur l’onglet « Tout » et colonne « pour toi »)', (await page.getByTestId('onglet-tout').getByTestId('pastille-a-toi').count()) === 1 || (await page.getByTestId('a-toi-total').textContent()) === '0')
  } else verifie('le début de « À toi » est dans le premier écran', bToi && bToi.y + 40 <= 844, bToi)
  // Ce que la base dit à l'instant, comparé à l'écran (d'autres sessions peuvent travailler en même temps).
  await actualiser()
  const vivants = compterVivants()
  if (vivants.barres + vivants.sessions === 0) {
    verifie('aucune preuve de vie → « 😴 Personne ne travaille en ce moment » + comment relancer',
      await page.getByTestId('personne-ne-travaille').count() === 1 && /Personne ne travaille/.test(await page.getByTestId('personne-ne-travaille').textContent()) && /copie la consigne/.test(await page.getByTestId('personne-ne-travaille').textContent()))
  } else {
    console.log(`    (${vivants.sessions} session(s) suivie(s) et ${vivants.barres} barre(s) vivante(s) en base à l’instant : « Personne ne travaille » vérifié plus bas, sur les données de test)`)
    verifie('« En ce moment » : autant de sessions actives qu’en base', await page.getByTestId('session-active').count() === vivants.sessions, { ecran: await page.getByTestId('session-active').count(), base: vivants.sessions })
    verifie('« En ce moment » : autant de barres de chantier vivantes qu’en base', await page.getByTestId('ligne-en-ce-moment').count() === vivants.barres, { ecran: await page.getByTestId('ligne-en-ce-moment').count(), base: vivants.barres })
  }
  verifie('« Tout » : aucune barre VIVE hors de « En ce moment »', await page.locator('[data-testid="vue-tout"] [data-vive="oui"]').count() === await page.locator('[data-testid="en-ce-moment"] [data-vive="oui"]').count())
  verifie('aucun défilement horizontal après connexion', (await scrollX()) <= 0, await scrollX())
  await captureUx(page, 'ux-tout')
  await capture(page, 'accueil')

  // Vue projet FacePro : le même entonnoir, premier écran.
  await page.getByTestId('onglet-facepro').click()
  await page.getByTestId('vue-projet').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  verifie('FacePro : « En ce moment », « À toi » et « À lancer » en tête de la vue projet',
    await page.getByTestId('en-ce-moment').count() === 1 && await page.getByTestId('a-toi').count() === 1 && await page.getByTestId('a-lancer').count() === 1)
  verifie('FacePro : aucune barre colorée sans preuve de vie (la capture du 29/09)',
    await page.locator('[data-testid="vue-projet"] [data-vive="oui"]').count() === await page.locator('[data-testid="en-ce-moment"] [data-vive="oui"], [data-presence="travaille"] [data-vive="oui"]').count())
  const vivantsFp = compterVivants('facepro')
  if (vivantsFp.barres + vivantsFp.sessions === 0)
    verifie('FacePro sans session → « 😴 Personne ne travaille sur ce projet en ce moment »', /Personne ne travaille sur ce projet/.test(await page.getByTestId('en-ce-moment').textContent()))
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
  const ligneP1 = page.locator(`[data-testid="ligne-en-ce-moment"][data-chantier-ligne="${P1.id}"]`)
  await ligneP1.waitFor({ timeout: 15000 }).catch(() => {})
  verifie('une activité mise à jour à l’instant apparaît dans « En ce moment »', await ligneP1.count() === 1)
  verifie('…avec une barre VIVE', await ligneP1.locator('[data-vive="oui"]').count() === 1)
  verifie('une activité en_cours vieille de 2 h n’est PAS une ligne vivante',
    await page.locator(`[data-testid="ligne-en-ce-moment"][data-chantier-ligne="${P2.id}"], [data-testid="ligne-en-ce-moment"][data-chantier-ligne="${P3.id}"]`).count() === 0)
  // Retour de Raphaël, 29 sept. : « je veux voir tout ce qui progresse, ensemble ».
  const snP2 = page.locator(`[data-testid="en-ce-moment"] [data-testid="ligne-sans-nouvelles"][data-ligne-chantier="${P2.id}"]`)
  const snP3 = page.locator(`[data-testid="en-ce-moment"] [data-testid="ligne-sans-nouvelles"][data-ligne-chantier="${P3.id}"]`)
  verifie('« En ce moment » montre AUSSI les en cours sans nouvelles, au même endroit (barre figée, pris mais silencieux)',
    await snP2.count() === 1 && await snP3.count() === 1 && (await snP3.textContent()).includes('Pris, mais silencieux'))
  verifie('…avec le titre du chantier en titre', (await snP2.textContent()).includes(P2.titre) && (await ligneP1.textContent()).includes(P1.titre))
  // B : ce qui travaille scintille, rien d'autre.
  verifie('la ligne vivante scintille : « ● travaille » qui pulse + reflet sur la barre',
    await ligneP1.getByTestId('point-travaille').count() === 1 && await ligneP1.locator('.point-vivant').count() === 1 && await ligneP1.locator('.barre-vive').count() === 1)
  verifie('la ligne silencieuse, elle, n’anime rien (ni pastille, ni reflet)',
    await snP3.locator('.point-vivant, .barre-vive, [data-testid="point-travaille"]').count() === 0 && await snP2.locator('.point-vivant, .barre-vive').count() === 0)
  const anim = await ligneP1.locator('.barre-vive').evaluate((e) => getComputedStyle(e).animationName)
  verifie('le reflet est réellement animé (animation CSS en cours)', anim && anim !== 'none', anim)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const animReduite = await ligneP1.locator('.point-vivant').evaluate((e) => ({ nom: getComputedStyle(e).animationName, visible: e.getBoundingClientRect().width > 0 }))
  verifie('« réduire les animations » : la pastille reste, fixe (aucune animation)', animReduite.nom === 'none' && animReduite.visible, animReduite)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Une nouvelle étape arrive : la ligne clignote une fois.
  sql(`update activite set etape = '${esc(`${MARQUE2} nouvelle étape`)}', pourcentage = 60, updated_at = now() where chantier_id = '${P1.id}'`)
  await page.getByTestId('actualiser').click()
  const flashVu = await page.waitForSelector(`[data-testid="ligne-en-ce-moment"][data-chantier-ligne="${P1.id}"][data-flash="oui"]`, { timeout: 8000 }).then(() => true, () => false)
  verifie('nouvelle étape : bref flash de la ligne vivante', flashVu)
  verifie('…la barre suit (60 %)', (await ligneP1.textContent()).includes('60 %'))
  await page.getByTestId('en-ce-moment').evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -64))
  await captureUx(page, 'ux-en-ce-moment')
  verifie('l’onglet du projet porte la pastille verte (quelqu’un y travaille)', (await ongletTest().getByTestId('pastille-travaillent').count()) === 1, await ongletTest().textContent())
  // Tap sur la ligne : on arrive sur le chantier, ouvert, dans son projet.
  await ligneP1.click()
  await page.getByTestId('vue-projet').waitFor({ timeout: 10000 })
  const carteP1 = carteId(P1.id)
  await carteP1.getByTestId('carte-detail').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('tap sur « En ce moment » → la carte du chantier, ouverte, dans son projet', (await ongletTest().getAttribute('aria-selected')) === 'true' && await carteP1.getByTestId('carte-detail').count() === 1)
  verifie('la carte d’une session vivante dit « 🟢 Claude y travaille », avec la pastille qui pulse', (await carteP1.getByTestId('badge-presence').textContent()).includes('Claude y travaille') && await carteP1.getByTestId('point-travaille').count() === 1)
  const lien = page.getByTestId('voir-en-ce-moment')
  verifie('« Tous les chantiers » renvoie vers « En ce moment » (pas de seconde liste de ce qui bouge)', await lien.count() === 1 && /En ce moment/.test(await lien.textContent()))
  await lien.click()
  await page.waitForTimeout(700)
  const bEcm = await page.getByTestId('en-ce-moment').boundingBox()
  verifie('…et le toucher remonte à « En ce moment »', bEcm && bEcm.y >= 0 && bEcm.y < 400, bEcm)
  await deplierTout()
  const carteP2 = carteId(P2.id), carteP3 = carteId(P3.id)
  verifie('vieille de 2 h, sans réservation → « ⏸️ Personne dessus », barre grise', (await carteP2.getByTestId('badge-presence').textContent()).includes('Personne dessus') && await carteP2.locator('[data-vive="non"]').count() === 1)
  verifie('…et le détail dit le dernier avancement connu (70 %)', /dernier avancement connu : 70 %/.test(await carteP2.getByTestId('detail-presence').textContent()), await carteP2.getByTestId('detail-presence').textContent())
  verifie('réservée mais muette depuis 2 h → « 🟡 Pris, mais silencieux »', (await carteP3.getByTestId('badge-presence').textContent()).includes('Pris, mais silencieux'))
  await carteP2.getByTestId('carte-titre').click()
  await carteP2.getByTestId('ton-action').waitFor({ timeout: 5000 })
  verifie('carte dépliée : « Ce qu’on attend de toi » en tête, avec Copier la consigne / Demander où ça en est',
    /Ce qu’on attend de toi/.test(await carteP2.getByTestId('ton-action').textContent()) && await carteP2.getByTestId('copier-consigne').count() === 1 && await carteP2.getByTestId('demander-ou-ca-en-est').count() === 1)
  verifie('carte dépliée : l’état technique reste lisible', /État : 🔧 En cours/.test(await carteP2.getByTestId('etat-technique').textContent()))
  await carteP2.getByTestId('carte-titre').click()

  // ===================================================================
  // 3. « À lancer » : copier la consigne, demander où ça en est
  console.log('  — à lancer')
  const P5 = creerTest('pres libre', { etat: 'libre', priorite: 'haute' })
  activiteTest(P5.id, 'ancien', 20, 300)
  await allerTout()
  await actualiser()
  const lP5 = await ligneALancer(P5.id)
  verifie('« À lancer » : ce qui n’a pas commencé, avec son dernier avancement en GRIS', (await lP5.textContent()).includes('Personne dessus') && await lP5.locator('[data-vive="non"]').count() === 1 && await lP5.locator('[data-vive="oui"]').count() === 0)
  verifie('« À lancer » ne répète ni le vivant ni les en cours sans nouvelles (déjà dans « En ce moment »)',
    await page.locator(`[data-testid="ligne-a-lancer"][data-ligne-chantier="${P1.id}"], [data-testid="ligne-a-lancer"][data-ligne-chantier="${P2.id}"], [data-testid="ligne-a-lancer"][data-ligne-chantier="${P3.id}"]`).count() === 0)
  const lP2 = page.locator(`[data-testid="en-ce-moment"] [data-testid="ligne-sans-nouvelles"][data-ligne-chantier="${P2.id}"]`)
  verifie('un en cours sans nouvelles dit son dernier avancement (70 %), sans barre vive', (await lP2.textContent()).includes('70 %') && await lP2.locator('[data-vive="oui"], .barre-vive').count() === 0)
  await page.evaluate(() => navigator.clipboard.writeText('vide'))
  verifie('ligne sans nouvelles : compacte, les gestes de relance à un toucher', await lP2.getByTestId('copier-consigne').count() === 0 && await lP2.getByTestId('ouvrir-relance').count() === 1)
  await lP2.getByTestId('ouvrir-relance').click()
  await lP2.getByTestId('copier-consigne').click()
  const toastCopie = await toastAuPremierPlan(/Consigne copiée/)
  verifie('« Copier la consigne » : toast visible', toastCopie, { auPremierPlan: dernierDessus })
  const pressePapiers = await page.evaluate(() => navigator.clipboard.readText())
  verifie('« Copier la consigne » : le presse-papiers contient la consigne du BON chantier',
    pressePapiers.includes(`« ${P2.titre} »`) && pressePapiers.includes(`id ${P2.id}`) && pressePapiers.includes(`projet ${SLUG}`) && pressePapiers.includes('progression'), pressePapiers)
  await lP5.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(200)
  await captureUx(page, 'ux-a-lancer')
  await lP2.getByTestId('demander-ou-ca-en-est').click()
  const toastOu = await toastAuPremierPlan(/Question posée dans le fil/)
  verifie('« Demander où ça en est » : toast visible', toastOu, { auPremierPlan: dernierDessus })
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
  await actualiser()
  const blocSession = page.locator(`[data-testid="session-active"][data-session="${SID}"]`)
  await blocSession.waitFor({ timeout: 15000 }).catch(() => {})
  verifie('la session factice apparaît dans « En ce moment », avec son sujet', await blocSession.count() === 1 && (await blocSession.textContent()).includes('💬 Session [TEST web] session factice'))
  verifie('…et son état : « répond en ce moment »', (await blocSession.getByTestId('etat-session').textContent()).includes('répond en ce moment'))
  const tAgent = blocSession.locator('[data-testid="tache"]', { hasText: 'agent qui parle' })
  const tCmd = blocSession.locator('[data-testid="tache"]', { hasText: 'commande muette' })
  verifie('agent qui a signalé : « 🤖 Agent : … », barre vive, temps restant', (await tAgent.textContent()).includes('🤖 Agent :') && await tAgent.locator('[data-vive="oui"]').count() === 1 && /reste ~\d+ min/.test(await tAgent.textContent()), await tAgent.textContent())
  verifie('commande muette : « ⚙️ Commande : … », « avancement non signalé », AUCUNE barre', (await tCmd.textContent()).includes('⚙️ Commande :') && await tCmd.getByTestId('non-signale').count() === 1 && await tCmd.getByRole('progressbar').count() === 0)
  verifie('chaque tâche dit depuis quand elle tourne', /depuis 12 min/.test(await tAgent.textContent()) && /depuis 3 min/.test(await tCmd.textContent()))
  verifie('la tâche liée à un chantier le nomme', (await tAgent.textContent()).includes(P4.titre))
  verifie('les tâches finies depuis peu sont repliées sous la session', (await blocSession.getByTestId('taches-finies').textContent()).includes('1 fini'))
  verifie('résumé chiffré en tête (sessions · agents · commande)', /\d+ sessions? · \d+ agents? · \d+ commandes?/.test(await page.getByTestId('resume-travail').textContent()), await page.getByTestId('resume-travail').textContent())
  verifie('l’aide « session ou agent ? » est là, repliée, et s’ouvre', await page.getByTestId('vocabulaire').count() === 1 && (await page.getByTestId('vocabulaire').getAttribute('aria-expanded')) === 'false')
  await page.getByTestId('vocabulaire').click()
  verifie('…elle dit « Une session = une conversation Claude Code… Un agent = un assistant… »', /Une session = une conversation Claude Code[\s\S]*Un agent = un assistant/.test(await page.getByTestId('vocabulaire-texte').textContent()))
  await page.getByTestId('vocabulaire').click()
  await blocSession.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await capture(page, 'sessions-agents')
  await tAgent.getByRole('button', { name: new RegExp(P4.titre.replace(/[[\]]/g, '\\$&')) }).click()
  const carteP4 = carteId(P4.id)
  await carteP4.getByTestId('carte-detail').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('un agent vivant lié au chantier → sa carte dit « 🟢 Un agent y travaille »', (await carteP4.getByTestId('badge-presence').textContent()).includes('Un agent y travaille'))
  verifie('…et la carte dépliée montre l’agent qui y travaille', await carteP4.getByTestId('taches-du-chantier').count() === 1)
  await allerTout()

  // Une session arrêtée sur une limite (0010) : « ⏸️ En pause », rien ne s'anime.
  const SIDP = `${SESSION_TEST}pause-${randomUUID().slice(0, 8)}`
  sql(`insert into sessions (id, projet_id, sujet, tour_en_cours, vu_at, pause_raison, pause_at, pause_detail) values ('${SIDP}', '${projet.id}', '${esc(`${MARQUE2} session en pause`)}', false, now() - interval '90 minutes', 'rate_limit', now() - interval '80 minutes', 'Limite atteinte, reprise à 4 h')`)
  sql(`insert into taches (session_id, projet_id, tache_id, type, description, statut, etape, pourcentage, progres_at, vu_at) values ('${SIDP}', '${projet.id}', 'agent-p', 'agent', '${esc(`${MARQUE2} agent arrêté`)}', 'en_cours', 'Étape', 30, now(), now())`)
  await actualiser()
  const blocPause = page.locator(`[data-testid="session-active"][data-session="${SIDP}"]`)
  await blocPause.waitFor({ timeout: 15000 }).catch(() => {})
  verifie('session en pause : « ⏸️ En pause — limite d’usage atteinte (reprend toute seule quand la limite se lève) »',
    await blocPause.getByTestId('session-en-pause').count() === 1 && (await blocPause.textContent()).includes('En pause — limite d’usage atteinte (reprend toute seule quand la limite se lève)'))
  verifie('…avec le détail en petit', (await blocPause.textContent()).includes('reprise à 4 h'))
  verifie('…et rien ne s’anime sous une session en pause', await blocPause.locator('.point-vivant, .barre-vive, [data-testid="point-travaille"]').count() === 0)
  await blocPause.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await capture(page, 'session-pause')

  // Une fusion proposée par Claude : « Garder séparés » la fait disparaître.
  console.log('  — fusion proposée')
  const F1 = creerTest('fusion source', { etat: 'libre' })
  const F2 = creerTest('fusion cible', { etat: 'libre' })
  const optionsF = JSON.stringify([{ libelle: 'Fusionner', recommande: true, source: F1.id, cible: F2.id, aide: 'Tout passe dans la cible.' }, { libelle: 'Garder séparés' }]).replace(/'/g, "''")
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values ('${projet.id}', '${F2.id}', 'verifier-web', 'session', 'fusion', '${esc(`${MARQUE2} Ces deux chantiers semblent le même sujet. Les fusionner ?`)}', 'Même demande, mots différents.', '${optionsF}'::jsonb)`)
  await actualiser()
  const elF = page.locator('[data-testid="element-a-toi"][data-type="fusion"]', { hasText: 'semblent le même sujet' })
  await elF.waitFor({ timeout: 15000 }).catch(() => {})
  verifie('« À toi » : « 🔀 Claude propose de fusionner », avec le pourquoi et deux boutons',
    await elF.count() === 1 && (await elF.textContent()).includes('Claude propose de fusionner') && (await elF.textContent()).includes('Même demande') && await elF.getByTestId('fusionner').count() === 1 && await elF.getByTestId('garder-separes').count() === 1)
  await elF.scrollIntoViewIfNeeded()
  await capture(page, 'fusion')
  await elF.getByTestId('garder-separes').click()
  const toastF = await toastAuPremierPlan(/Gardés séparés/)
  verifie('« Garder séparés » : toast visible', toastF, { auPremierPlan: dernierDessus })
  await elF.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('« Garder séparés » : la suggestion disparaît de « À toi »', await elF.count() === 0)
  const fBase = sql(`select reponse, answered_at from messages where chantier_id = '${F2.id}' and kind = 'fusion'`)[0]
  const f1Base = sql(`select archived_at from chantiers where id = '${F1.id}'`)[0]
  verifie('« Garder séparés » : en base, tranchée sans fusionner', fBase?.reponse === 'Garder séparés' && !!fBase.answered_at && !f1Base?.archived_at, { fBase, f1Base })

  // ===================================================================
  // 4. « À toi » : une question se répond sans rien déplier
  console.log('  — à toi : question')
  const Q1 = creerTest('question', { etat: 'libre' })
  await allerCockpit()
  await actualiser()
  const options = JSON.stringify([{ libelle: 'Option A', aide: 'la première', recommande: true }, { libelle: 'Option B' }]).replace(/'/g, "''")
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values ('${projet.id}', '${Q1.id}', 'verifier-web', 'session', 'question', '${MARQUE} Quelle option ?', 'Pour vérifier l''écran.', '${options}'::jsonb)`)
  const elQ = page.locator('[data-testid="element-a-toi"][data-type="question"]', { hasText: `${MARQUE} Quelle option` })
  let directVu = true
  try { await elQ.waitFor({ timeout: 12000 }) } catch { directVu = false; await actualiser(); await elQ.waitFor({ timeout: 15000 }) }
  // D-09 : « actualisation en live hyper précise ». Le direct doit la montrer SANS « Actualiser ».
  if (wsPossible) verifie('la question apparaît EN DIRECT, sans « Actualiser »', directVu)
  else verifie('sans direct (conteneur), la question apparaît après « Actualiser », et l’écran le dit', await page.getByTestId('direct-coupe').count() === 1)
  const nQ = await page.getByTestId('groupe-a-toi-question').getByTestId('compte-groupe').textContent()
  verifie('« À toi » compte la bonne quantité de questions du projet', Number(nQ) === nAttenteAvant + 1, { affiche: nQ, attendu: nAttenteAvant + 1 })
  verifie('la question porte le titre de son chantier', (await elQ.textContent()).includes(Q1.titre))
  const blocQ = elQ.getByTestId('bloc-question')
  verifie('options visibles SANS rien déplier, la recommandée marquée ★', await blocQ.isVisible() && (await blocQ.textContent()).includes('★ recommandé'))
  await deplierTout()
  verifie('la carte du chantier dit « 🔴 Attend ta réponse »', (await carteId(Q1.id).getByTestId('badge-presence').textContent()).includes('Attend ta réponse'))
  await elQ.scrollIntoViewIfNeeded()
  await capture(page, 'question')
  await blocQ.getByRole('radio', { name: /Option A/ }).click()
  await blocQ.getByPlaceholder(/précision/i).fill('précision de test')
  // Une capture jointe à la réponse (0013) : la vignette, puis le fichier dans le fil.
  await blocQ.getByTestId('entree-medias').setInputFiles({ name: 'capture écran.png', mimeType: 'image/png', buffer: PNG_TEST })
  await blocQ.locator('[data-testid="piece-jointe"][data-etat="ok"]').waitFor({ timeout: 20000 })
  verifie('réponse : la photo jointe s’affiche en vignette, envoyée', await blocQ.locator('[data-testid="piece-jointe"][data-etat="ok"] img').count() === 1)
  await capture(page, 'question-avec-photo')
  await blocQ.getByTestId('valider-reponse').click()
  const toastRep = await toastAuPremierPlan(/Réponse enregistrée/)
  verifie('réponse depuis « À toi » : toast visible', toastRep, { auPremierPlan: dernierDessus })
  await elQ.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('la question répondue quitte « À toi »', await elQ.count() === 0)
  const rep = sql(`select reponse, precision, answered_at from messages where corps like '${MARQUE}%'`)[0]
  verifie('la réponse est en base (option + précision + answered_at)', rep && rep.reponse === 'Option A' && rep.precision === 'précision de test' && !!rep.answered_at, rep)
  const pjQ = sql(`select corps, medias from messages where chantier_id = '${Q1.id}' and kind = 'info' and jsonb_array_length(medias) > 0`)
  verifie('la photo de la réponse est dans le fil du chantier (message info + medias)', pjQ.length === 1 && pjQ[0].medias[0].type === 'image/png' && pjQ[0].medias[0].chemin.startsWith(`${projet.id}/${Q1.id}/`) && /Option A/.test(pjQ[0].corps), pjQ)
  const objQ = sql(`select count(*) as n from storage.objects where bucket_id = 'cockpit-medias' and name = '${esc(pjQ[0]?.medias?.[0]?.chemin ?? '')}'`)[0]
  verifie('le fichier est bien dans le stockage privé', Number(objQ.n) === 1, objQ)

  // ===================================================================
  // 5. « À toi » : vérifier et certifier, avec la frise de mise en ligne
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
  const encadre = elV1.getByTestId('comment-verifier')
  verifie('à vérifier : « 👉 Comment vérifier » visible directement dans « À toi » (rien à déplier)', await encadre.count() === 1 && await encadre.isVisible())
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
  const [bEnc, bCert] = [await encadre.boundingBox(), await elV1.getByTestId('btn-certifier').boundingBox()]
  verifie('l’encadré est AVANT les boutons « certifier / corriger »', bEnc && bCert && bEnc.y + bEnc.height <= bCert.y, { bEnc, bCert })
  const friseV1 = elV1.getByTestId('frise-en-ligne')
  const etatsFrise = await friseV1.getByTestId('etape-en-ligne').evaluateAll((l) => l.map((e) => e.getAttribute('data-etat')))
  verifie('frise complète : 4 étapes cochées (Codé, Envoyé, Vérifié par les robots, En ligne)', etatsFrise.join(',') === 'fait,fait,fait,fait' && /Codé[\s\S]*Envoyé[\s\S]*robots[\s\S]*En ligne/.test(await friseV1.textContent()), etatsFrise)
  verifie('frise : l’adresse en ligne est un lien', await friseV1.getByRole('link').getAttribute('href') === 'https://rnab26.github.io/Cockpit-General/')
  const phraseV1 = elV1.getByTestId('phrase-en-ligne')
  verifie('phrase : « C’est en ligne depuis … : tu peux vérifier maintenant »', /C’est en ligne depuis \d+ h \d{2}( du matin)? : tu peux vérifier maintenant/.test(await phraseV1.textContent()), await phraseV1.textContent())
  const [bPhrase, bCert2] = [await phraseV1.boundingBox(), await elV1.getByTestId('btn-certifier').boundingBox()]
  verifie('la phrase est juste au-dessus de « Ça fonctionne »', bPhrase && bCert2 && bPhrase.y + bPhrase.height <= bCert2.y && bCert2.y - (bPhrase.y + bPhrase.height) < 40, { bPhrase, bCert2 })
  const elV3 = await elementAToi(v3.id, 'a_verifier')
  const etatsV3 = await elV3.getByTestId('etape-en-ligne').evaluateAll((l) => l.map((e) => e.getAttribute('data-etat')))
  verifie('seulement « envoyé » : « ⏳ Pas encore en ligne : attends avant de vérifier »', /Pas encore en ligne/.test(await elV3.getByTestId('phrase-en-ligne').textContent()))
  verifie('…et les étapes suivantes sont grises', etatsV3.join(',') === 'fait,fait,attente,attente', etatsV3)
  verifie('à vérifier : pas de défilement horizontal', (await scrollX()) <= 0, await scrollX())
  await elV1.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -64))
  await page.waitForTimeout(200)
  await captureUx(page, 'ux-tout-a-toi')

  // Sans étapes : la phrase et le bouton qui écrit la demande dans le fil.
  const elV2 = await elementAToi(v2.id, 'a_verifier')
  const videV2 = elV2.getByTestId('comment-verifier-vide')
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

  // Certifier v1 depuis « À toi ».
  await elV1.getByTestId('btn-certifier').click()
  await elV1.getByRole('button', { name: /Je certifie/ }).click()
  const toastCert = await toastAuPremierPlan(/certifié/)
  verifie('certifier depuis « À toi » : toast visible', toastCert, { auPremierPlan: dernierDessus })
  await elV1.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('le chantier certifié quitte « À toi »', await elV1.count() === 0)
  verifie('en base : certifié (valide)', sql(`select etat from chantiers where id = '${v1.id}'`)[0]?.etat === 'valide')
  await capture(page, 'a-toi-certifie')
  // Certifié : les étapes restent disponibles, repliées ; l'origine « session » se lit.
  await allerCockpit()
  const bacActif = page.getByTestId('bac-actif')
  await bacActif.waitFor({ timeout: 10000 })
  if ((await bacActif.locator('> button').getAttribute('aria-expanded')) !== 'true') await bacActif.locator('> button').click()
  const carteV1b = bacActif.locator('[data-testid="carte"]', { hasText: v1.titre })
  await carteV1b.waitFor({ timeout: 15000 })
  verifie('« 💬 lancé depuis une session Claude » sur un chantier d’origine session', await carteV1b.getByTestId('origine-session').count() === 1)
  if (await carteV1b.getByTestId('carte-detail').count() === 0) await carteV1b.getByTestId('carte-titre').click()
  const replie = carteV1b.getByTestId('comment-verifier-replie')
  await replie.waitFor({ timeout: 5000 }).catch(() => {})
  verifie('certifié : « Comment vérifier » présent, replié', await replie.count() === 1 && await replie.getByTestId('etape-verifier').count() === 0)
  await replie.locator('> button').click()
  verifie('certifié : déplié, les trois étapes reviennent', await replie.getByTestId('etape-verifier').count() === 3)
  verifie('certifié : la frise de mise en ligne reste sur la carte', await carteV1b.getByTestId('frise-en-ligne').count() === 1)
  await carteV1b.getByTestId('carte-titre').click()

  // ===================================================================
  // 6. Une carte reportée : « Écrire à Claude », « Relancer maintenant »
  console.log('  — carte reportée')
  const R1 = creerTest('reporte', { etat: 'reporte', demande: 'Mis de côté pour la v2.' })
  await actualiser()
  await deplierTout()
  const carteR1 = carteId(R1.id)
  await carteR1.waitFor({ timeout: 15000 })
  await carteR1.getByTestId('carte-titre').click()
  await carteR1.getByTestId('carte-detail').waitFor({ timeout: 5000 })
  verifie('reporté : « Rien à faire de ta part, sauf si tu veux le relancer »', /Rien à faire de ta part/.test(await carteR1.getByTestId('ton-action').textContent()))
  const ecrire = carteR1.getByTestId('ecrire-a-claude')
  verifie('« ✍️ Écrire à Claude » visible sans rien déplier d’autre que la carte', await ecrire.isVisible() && /Écrire à Claude/.test(await ecrire.textContent()) && /prochaine session/.test(await ecrire.textContent()))
  verifie('fil vide : aucun « 0 message » replié', await carteR1.getByTestId('fil').count() === 0)
  const [bEcrire, bActions] = [await ecrire.boundingBox(), await carteR1.getByTestId('actions-admin').boundingBox()]
  verifie('la réponse passe avant les actions (Modifier, Archiver…)', bEcrire && bActions && bEcrire.y < bActions.y)
  await ecrire.locator('textarea').fill(`${MARQUE2} message à Claude`)
  await ecrire.getByTestId('entree-medias').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_TEST })
  await ecrire.locator('[data-testid="piece-jointe"][data-etat="ok"]').waitFor({ timeout: 20000 })
  await ecrire.getByTestId('envoyer-message').click()
  const toastEcrit = await toastAuPremierPlan(/Message envoyé/)
  verifie('« Envoyer » : toast visible', toastEcrit, { auPremierPlan: dernierDessus })
  const ecrits = sql(`select kind, auteur_type, corps from messages where chantier_id = '${R1.id}'`)
  verifie('le message est en base (info, propriétaire)', ecrits.length === 1 && ecrits[0].kind === 'info' && ecrits[0].auteur_type === 'proprietaire' && ecrits[0].corps === `${MARQUE2} message à Claude`, ecrits)
  const mR1 = sql(`select medias from messages where chantier_id = '${R1.id}'`)[0]?.medias ?? []
  verifie('« Écrire à Claude » : la photo part avec le message', mR1.length === 1 && mR1[0].nom === 'photo.png', mR1)
  verifie('après l’envoi, plus de vignette en attente sous le champ', await ecrire.getByTestId('piece-jointe').count() === 0)
  await carteR1.getByTestId('fil').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('le fil apparaît, son en-tête cite le dernier message', await carteR1.getByTestId('fil').count() === 1 && (await carteR1.getByTestId('fil').textContent()).includes('message à Claude'))
  verifie('le fil replié annonce ses pièces jointes (📎 1)', /📎 1/.test(await carteR1.getByTestId('fil').textContent()))
  await carteR1.getByTestId('fil').locator('button').first().click()
  const vignette = carteR1.getByTestId('fil').locator('[data-testid="media"] img').first()
  await vignette.waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  verifie('la photo s’affiche dans le fil (lien signé, image réellement chargée)', await vignette.count() === 1 && await vignette.evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false))
  if (await vignette.count()) {
    await vignette.click()
    const grande = page.locator('dialog[open] img')
    await grande.waitFor({ timeout: 8000 }).catch(() => {})
    verifie('un toucher sur la vignette l’ouvre en grand', await grande.count() === 1)
    await capture(page, 'photo-en-grand')
    await page.keyboard.press('Escape')
  }
  await carteR1.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -64))
  await capture(page, 'carte-reportee')
  await carteR1.getByTestId('relancer-maintenant').click()
  const toastRel = await toastAuPremierPlan(/relancé/)
  verifie('« ▶️ Relancer maintenant » : toast visible', toastRel, { auPremierPlan: dernierDessus })
  verifie('« Relancer maintenant » : en base, le chantier passe à libre', sql(`select etat from chantiers where id = '${R1.id}'`)[0]?.etat === 'libre')

  // ===================================================================
  // 6 bis. Mise en ligne (GitHub simulé) et mode autonome, en tête de la vue projet
  console.log('  — mise en ligne et mode autonome')
  await page.evaluate(() => window.scrollTo(0, 0))
  const dep = page.getByTestId('barre-projet').getByTestId('deploiement')
  await dep.waitFor({ timeout: 10000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="barre-projet"] [data-testid="deploiement"]')?.getAttribute('data-etat') !== 'chargement', null, { timeout: 10000 }).catch(() => {})
  verifie('mise en ligne : « 🚀 Mise en ligne en cours », en tête de la vue projet, animée', (await dep.getAttribute('data-etat')) === 'en_cours' && /Mise en ligne en cours/.test(await dep.textContent()) && await dep.locator('.point-vivant').count() === 1, await dep.textContent())
  await dep.getByTestId('deploiement-titre').click()
  verifie('mise en ligne : une ligne par workflow, avec le lien GitHub', await dep.getByTestId('deploiement-lignes').locator('a').count() === 2 && /github\.com/.test(await dep.getByTestId('deploiement-lignes').locator('a').first().getAttribute('href')))
  githubMode = 'limite'
  await dep.getByTestId('deploiement-relire').click()
  await dep.getByText(/GitHub limite les consultations/).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('GitHub en limite (403) : l’écran le dit, et garde le dernier état lu', /GitHub limite les consultations/.test(await dep.textContent()) && /Mise en ligne en cours/.test(await dep.textContent()))
  githubMode = 'ok'
  await dep.getByTestId('deploiement-relire').click()
  await capture(page, 'deploiement')
  // Mode autonome : allumer depuis l'écran → en base → bandeau → arrêter.
  const auto = page.getByTestId('barre-projet').getByTestId('mode-autonome')
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
  const toastAuto = await toastAuPremierPlan(/Autonome jusqu’à 09:00/)
  verifie('mode autonome allumé : toast visible', toastAuto, { auPremierPlan: dernierDessus })
  const [pa] = sql(`select autonome_jusqu_a, autonome_max from projets where id = '${projet.id}'`)
  verifie('mode autonome : en base, une heure de fin future (≤ 24 h) et le plafond 5', !!pa?.autonome_jusqu_a && Date.parse(pa.autonome_jusqu_a) > Date.now() && Date.parse(pa.autonome_jusqu_a) - Date.now() <= 24 * 3600_000 && pa.autonome_max === 5, pa)
  const bandeau = page.getByTestId('barre-projet').getByTestId('autonome-bandeau')
  await bandeau.waitFor({ timeout: 10000 }).catch(() => {})
  // N = ce que la base donnerait vraiment à une session (cockpit.chantiers_prenables, 0011).
  const nLibres = Number(sql(`select count(*) as n from chantiers_prenables('${projet.id}', null)`)[0].n)
  verifie('bandeau « 🌙 Autonome jusqu’à 09:00 — N chantiers prêts » (N = chantiers_prenables en base)', /Autonome jusqu’à 09:00/.test(await bandeau.textContent()) && (await bandeau.textContent()).includes(`${nLibres} chantier`), { texte: await bandeau.textContent(), nLibres })
  await capture(page, 'autonome-allume')
  await page.getByTestId('barre-projet').getByTestId('autonome-arreter').click()
  verifie('« Arrêter maintenant » : toast visible', await toastAuPremierPlan(/Mode autonome arrêté/))
  verifie('« Arrêter maintenant » : en base, éteint (null)', sql(`select autonome_jusqu_a from projets where id = '${projet.id}'`)[0].autonome_jusqu_a === null)
  // « Tout le temps » (0011) : allumer, vérifier en base, éteindre.
  await page.getByTestId('barre-projet').getByTestId('autonome-ouvrir').click()
  await page.getByTestId('barre-projet').getByTestId('autonome-toujours').check()
  await page.getByTestId('barre-projet').getByTestId('autonome-allumer').click()
  verifie('« tout le temps » : toast visible', await toastAuPremierPlan(/Autonome tout le temps/))
  const [pt] = sql(`select autonome_toujours, autonome_jusqu_a from projets where id = '${projet.id}'`)
  verifie('« tout le temps » : en base, autonome_toujours sans heure de fin', pt?.autonome_toujours === true && pt.autonome_jusqu_a === null, pt)
  await page.getByTestId('barre-projet').getByTestId('autonome-bandeau').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('« tout le temps » : le bandeau le dit', /Autonome tout le temps/.test(await page.getByTestId('barre-projet').getByTestId('autonome-bandeau').textContent()))
  // « Changer… » : de « tout le temps » à « jusqu'à 09:00 », sans passer par « éteint ».
  await page.getByTestId('barre-projet').getByTestId('autonome-changer').click()
  verifie('« Changer… » rouvre le choix, « tout le temps » coché', await page.getByTestId('barre-projet').getByTestId('autonome-toujours').isChecked())
  await page.getByTestId('barre-projet').getByTestId('autonome-jusqua').check()
  await page.getByTestId('barre-projet').getByTestId('autonome-allumer').click()
  await toastAuPremierPlan(/Autonome jusqu’à 09:00/)
  const [pc] = sql(`select autonome_toujours, autonome_jusqu_a from projets where id = '${projet.id}'`)
  verifie('« Changer… » → jusqu’à 09:00 : en base, plus « tout le temps », une heure de fin', pc?.autonome_toujours === false && !!pc.autonome_jusqu_a, pc)
  await page.getByTestId('barre-projet').getByTestId('autonome-arreter').click()
  await toastAuPremierPlan(/Mode autonome arrêté/)
  verifie('« tout le temps » arrêté : en base, éteint', (([r]) => r.autonome_toujours === false && r.autonome_jusqu_a === null)(sql(`select autonome_toujours, autonome_jusqu_a from projets where id = '${projet.id}'`)))
  await allerTout()
  const resumeProjet = page.locator(`[data-testid="projet-resume"][data-projet="${SLUG}"]`)
  verifie('« Tout » : un résumé par projet (mise en ligne + mode autonome)', await resumeProjet.getByTestId('deploiement').count() === 1 && await resumeProjet.getByTestId('mode-autonome').count() === 1)
  await allerCockpit()

  // ===================================================================
  // 7. La liste complète, une carte qui se déplie, créer / supprimer
  console.log('  — tous les chantiers')
  await page.evaluate(() => window.scrollTo(0, 0))
  await deplierTout()
  const nbCartes = await page.locator('[data-testid="tous-les-chantiers"] [data-testid="carte"]').count()
  verifie('les chantiers du projet s’affichent, sections dépliées (≥ 10 cartes)', nbCartes >= 10, nbCartes)
  const nbGroupes = await page.getByTestId('groupe-section').count()
  verifie('groupés par section (≥ 3 groupes)', nbGroupes >= 3, nbGroupes)
  verifie('chaque en-tête de section porte ses compteurs de présence', await page.getByTestId('compteurs-section').count() === nbGroupes)
  const premiere = page.locator('[data-testid="tous-les-chantiers"] [data-testid="carte"]').first()
  await premiere.getByTestId('carte-titre').click()
  await premiere.getByTestId('carte-detail').waitFor({ timeout: 5000 })
  verifie('une carte se déplie (demande + « Écrire à Claude » visibles)', await premiere.getByTestId('ecrire-a-claude').count() === 1)
  verifie('les actions admin sont là sur la carte dépliée', await premiere.getByTestId('actions-admin').count() === 1)
  verifie('toujours pas de défilement horizontal, carte dépliée', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'carte')
  await premiere.getByTestId('carte-titre').click()
  await page.getByTestId('tout-deplier').click()
  verifie('« Tout replier » replie les sections', await page.locator('[data-testid="groupe-section"] [data-testid="carte"]').count() === 0)

  await page.getByTestId('nouveau-chantier').click()
  await page.getByTestId('titre').fill('Hook de démarrage paramétré par projet')
  verifie('« Ça existe déjà » s’affiche sur un titre proche d’un chantier existant', await page.getByTestId('ca-existe-deja').waitFor({ timeout: 3000 }).then(() => true, () => false))
  const titreTest = `${MARQUE} chantier éphémère`
  await page.getByTestId('titre').fill(titreTest)
  await page.getByTestId('demande').fill('Créé par verifier-web, supprimé juste après.')
  await page.getByTestId('creer-chantier').click()
  await page.getByText(/créé\.$/).first().waitFor({ timeout: 10000 })
  await deplierTout()
  const carteTest = carteDe(titreTest)
  await carteTest.waitFor({ timeout: 15000 })
  verifie('le chantier créé apparaît dans la liste', await carteTest.count() === 1)
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

  // --- menu et réglages (délai de silence, fenêtre « certifiés récemment »)
  await page.getByTestId('menu').click()
  await page.getByRole('menuitem', { name: /Réglages/ }).click()
  await page.getByTestId('fenetre-livre').waitFor({ timeout: 5000 })
  const autreSilence = silenceMin === 30 ? 60 : 30
  await page.getByTestId('silence-minutes').getByRole('button', { name: `${autreSilence} min`, exact: true }).click()
  const toastSil = await toastAuPremierPlan(/Pris, mais silencieux/)
  verifie('réglage « délai de silence » : toast visible', toastSil, { auPremierPlan: dernierDessus })
  const prefSil = sql(`select valeur from preferences where user_id = '${moiId}' and cle = 'silence_minutes'`)[0]
  verifie('réglage « délai de silence » : enregistré dans preferences (silence_minutes)', Number(prefSil?.valeur) === autreSilence, prefSil)
  verifie('le bouton choisi est marqué', (await page.getByTestId('silence-minutes').getByRole('button', { name: `${autreSilence} min`, exact: true }).getAttribute('aria-pressed')) === 'true')
  await capture(page, 'reglages')
  await page.getByTestId('silence-minutes').getByRole('button', { name: `${silenceMin} min`, exact: true }).click()
  await page.keyboard.press('Escape')

  // ===================================================================
  // 8. Doublons, sélection groupée, historique
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
  const toastIgnore = await toastAuPremierPlanLocal(/ne sera plus proposée/)
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
  await actualiser()
  await deplierTout()
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
  const toastFusion = await toastAuPremierPlanLocal(/fusionné dans/)
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
  verifie('sélection : toutes les sections s’ouvrent (on ne coche pas ce qu’on ne voit pas)', await page.locator('[data-testid="groupe-section"] > button[aria-expanded="false"]').count() === 0)
  verifie('sélection : la barre compte « 2 choisis »', (await barre.textContent()).includes('2 choisis'), await barre.textContent())
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(300)
  const bBarre = await barre.boundingBox()
  const bDerniereCarte = await page.getByTestId('carte').last().boundingBox()
  const bFinListe = await page.locator('[data-testid="tous-les-chantiers"] > :last-child').boundingBox()
  verifie('sélection : la barre ne masque pas la dernière carte (défilement en bas)', bBarre && bDerniereCarte && bDerniereCarte.y + bDerniereCarte.height <= bBarre.y + 0.5, { barre: bBarre, carte: bDerniereCarte })
  verifie('sélection : ni le dernier bloc de la liste', bBarre && bFinListe && bFinListe.y + bFinListe.height <= bBarre.y + 0.5, { barre: bBarre, dernier: bFinListe })
  verifie('sélection : pas de défilement horizontal avec la barre', (await scrollX()) <= 0, await scrollX())
  await capture(page, 'selection')
  await barre.getByLabel('Priorité').selectOption('normale')
  const toastSel = await toastAuPremierPlanLocal(/2 chantiers modifiés/)
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
  await deplierTout()
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
  const toastRest = await toastAuPremierPlanLocal(/Texte restauré/)
  verifie('restauration : toast « Texte restauré » visible', toastRest, { auPremierPlan: dernierDessus })
  const [hApres] = sql(`select demande from chantiers where id = '${h1.id}'`)
  verifie('restauration : en base, la demande est revenue à l’ancien texte', hApres?.demande === ANCIEN, hApres)
  const traces = sql(`select champ, nouvelle, par from historique where chantier_id = '${h1.id}' order by id`)
  const derniere = traces[traces.length - 1]
  verifie('restauration : une nouvelle ligne d’historique trace la restauration', traces.length === 2 && derniere.champ === 'demande' && derniere.nouvelle === ANCIEN && /restauration/.test(derniere.par ?? ''), traces)
  await hist.locator('li', { hasText: 'Nouveau texte' }).first().waitFor({ timeout: 10000 }).catch(() => {})
  verifie('restauration : l’écran recharge l’historique (2 changements)', (await hist.textContent()).includes('2 changements'), await hist.textContent())
  await carteH.getByTestId('carte-titre').click()

  // --- grand écran
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(500)
  verifie('desktop : pas de défilement horizontal non plus', (await scrollX()) <= 0, await scrollX())
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
