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
  // Reconnaissance vocale simulée (le Chromium du conteneur n'a pas de micro) : dicte « dicté à la voix », ou refuse le micro.
  await ctx.addInitScript(() => {
    const ss = (k) => { try { return sessionStorage.getItem(k) } catch { return null } }
    if (ss('sansVoix')) { for (const n of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, n, { value: undefined, configurable: true, writable: true }); return }
    const Fausse = class {
      start() { setTimeout(() => { if (ss('voixErreur')) this.onerror?.({ error: 'not-allowed' }); else this.onresult?.({ results: [[{ transcript: 'dicté à la voix' }]] }); this.onend?.() }, 150) }
      stop() { this.onend?.() } abort() {}
    }
    for (const n of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, n, { value: Fausse, configurable: true, writable: true })
  })
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

  // La bulle flottante n'existe plus quand la barre du bas est là (chantier 6bb045e0) : les chats vivent dans l'onglet « Discussions ».
  const ongletDisc = page.getByTestId('onglet-barre-discussions')
  const ligneChat = page.locator(`[data-testid="discussion-ligne"][data-projet="${SLUG}"]`)
  const ouvrirChat = async () => {
    if (!(await page.getByTestId('discussions-liste').isVisible().catch(() => false))) await ongletDisc.click()
    await ligneChat.click()
  }

  // --- 1. vue « Tout » : l'onglet Discussions est là, la liste montre le projet
  await page.goto(BASE + '#tout', { waitUntil: 'domcontentloaded' })
  await ongletDisc.waitFor({ timeout: 20000 }).catch(() => {})
  verifie('vue « Tout » : l’onglet « Discussions » est dans la barre du bas, plus de bulle flottante', await ongletDisc.isVisible().catch(() => false) && await page.getByTestId('bulle-aide-bouton').count() === 0)
  const ordre = await page.getByTestId('barre-onglets').getByRole('tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  verifie('ordre : … loupe, Discussions, Coûts …', ordre.indexOf('onglet-barre-discussions') === ordre.indexOf('loupe') + 1, ordre)
  await ongletDisc.click()
  await page.getByTestId('discussions-liste').waitFor({ timeout: 10000 })
  verifie('la liste des discussions montre le projet, « Pas encore de message » (état vide du chat)', await ligneChat.count() === 1 && (await ligneChat.innerText()).includes('Pas encore de message'))
  await page.screenshot({ path: `${CAPTURES}/discussions-liste.png` })
  await page.keyboard.press('Escape')
  await page.getByTestId('discussions-liste').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  verifie('Échap ferme la liste', await page.getByTestId('discussions-liste').count() === 0)

  // --- 2. vue du projet jetable
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 20000 })
  await ongletDisc.waitFor({ timeout: 10000 }).catch(() => {})
  verifie('vue projet : l’onglet « Discussions » est visible sans réglage', await ongletDisc.isVisible().catch(() => false))
  const vp = page.viewportSize()
  const bb = await page.getByTestId('barre-onglets').getByRole('tab').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.right)] }))
  verifie('téléphone : 6 onglets sur une ligne, dans la largeur', bb.length === 6 && new Set(bb.map((x) => x[0])).size === 1 && bb.every((x) => x[1] <= vp.width), bb)
  const sansDefilement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  verifie('aucun défilement horizontal', sansDefilement <= 0, sansDefilement)
  await page.screenshot({ path: `${CAPTURES}/bulle-projet.png` })

  // --- 3. un message tapé dans la bulle = message libre du fil du projet
  await ouvrirChat()
  await panneau.waitFor({ timeout: 5000 })
  verifie('fil vide : le message d’aide s’affiche', await page.getByTestId('bulle-aide-vide').isVisible())
  const question = 'Comment ranger un chantier dans une section ?'
  await page.getByTestId('bulle-aide-saisie').fill(question)
  await page.getByTestId('bulle-aide-envoyer').click()
  await panneau.getByText(question).waitFor({ timeout: 45000 }).catch(() => {})
  verifie('sa question s’affiche dans la bulle (à droite)', await panneau.getByText(question).count() === 1, await panneau.innerText())
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

  // --- 4 bis. nom + heure, sujet en gras, rôle de la bulle
  verifie('rôle : la bulle dit à quoi elle sert (poser une question, où ça en est)', /où ça en est/.test(await page.getByTestId('bulle-aide-role').innerText()))
  const ent = await panneau.getByTestId('bulle-aide-entete').allInnerTexts()
  verifie('chaque message dit QUI (Toi / Claude) et À QUELLE HEURE', ent.length === 2 && /^Toi\s+\d{2}:\d{2}$/.test(ent[0].replace(/\n/g, ' ').trim()) && /^Claude\s+\d{2}:\d{2}$/.test(ent[1].replace(/\n/g, ' ').trim()), ent)
  sql(`select repondre_dans_fil('${SLUG}', null, 'claude/test-bulle', 'Sujet : Choix de la couleur. Veux-tu du bleu ou du vert ?') as id`)
  await panneau.getByText('Veux-tu du bleu ou du vert', { exact: false }).waitFor({ timeout: 90000 }).catch(() => {})
  verifie('le sujet est en gras (balise forte) au-dessus du message', (await page.getByTestId('bulle-aide-sujet').last().evaluate((e) => getComputedStyle(e).fontWeight)) >= 600 && (await page.getByTestId('bulle-aide-sujet').last().innerText()) === 'Choix de la couleur')

  // --- 4 ter. voix : dictée → texte dans la zone
  const micro = page.getByTestId('bulle-aide-micro')
  verifie('voix : le micro est proposé (navigateur compatible)', (await micro.getAttribute('data-voix')) === 'pret')
  await micro.click()
  await page.waitForFunction(() => document.querySelector('[data-testid=bulle-aide-saisie]')?.value.includes('dicté à la voix'), null, { timeout: 5000 }).catch(() => {})
  verifie('voix : le texte dicté arrive dans la zone de saisie', (await page.getByTestId('bulle-aide-saisie').inputValue()).includes('dicté à la voix'), await page.getByTestId('bulle-aide-saisie').inputValue())

  // --- 4 quater. répondre à une phrase précise de Claude + fichier joint
  await panneau.getByTestId('bulle-aide-repondre').last().click()
  verifie('répondre : la question de Claude est citée au-dessus de la saisie', (await page.getByTestId('bulle-aide-citation').innerText()).includes('Veux-tu du bleu ou du vert'))
  await page.getByTestId('entree-medias').setInputFiles({ name: 'maquette.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
  await page.locator('[data-testid=piece-jointe][data-etat=ok]').waitFor({ timeout: 20000 }).catch(() => {})
  verifie('fichier : la pièce est déposée (vignette prête), avec le crayon', await page.locator('[data-testid=piece-jointe][data-etat=ok]').count() === 1 && await page.getByTestId('crayon-media').count() === 1)
  await page.getByTestId('bulle-aide-saisie').fill('Le bleu, comme sur la maquette.')
  await page.getByTestId('bulle-aide-envoyer').click()
  await panneau.getByTestId('bulle-aide-citee').waitFor({ timeout: 15000 }).catch(() => {})
  verifie('la réponse s’affiche avec sa citation en encart et sa pièce', (await panneau.getByTestId('bulle-aide-citee').last().innerText()).includes('Veux-tu du bleu ou du vert') && await panneau.getByText('Le bleu, comme sur la maquette.').count() === 1)
  const r2 = sql(`select corps, jsonb_array_length(medias) as n, cockpit.est_message_libre(messages) as libre from messages where projet_id = '${projetId}' and corps like '> %'`)
  verifie('en base : citation « > » en tête, 1 média joint, message LIBRE (la chef le traite)', r2.length === 1 && r2[0].corps.startsWith('> Veux-tu du bleu ou du vert') && r2[0].n === 1 && r2[0].libre === true, r2)
  verifie('après envoi : citation et pièces vidées', await page.getByTestId('bulle-aide-citation').count() === 0 && await page.getByTestId('piece-jointe').count() === 0)
  verifie('téléphone : toujours aucun défilement horizontal bulle ouverte', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0)
  await page.screenshot({ path: `${CAPTURES}/bulle-ouverte-2.png` })
  await page.keyboard.press('Escape')
  await page.getByTestId('discussions-liste').waitFor({ timeout: 5000 })
  verifie('fermer le chat ramène à la liste, la ligne montre le dernier message', (await ligneChat.innerText()).includes('Toi : Le bleu'), await ligneChat.innerText())
  await page.keyboard.press('Escape')

  // --- 4 quinquies. voix : micro refusé = message clair ; navigateur sans voix = état « non supporté »
  await page.evaluate(() => sessionStorage.setItem('voixErreur', '1'))
  await ouvrirChat()
  await page.getByTestId('bulle-aide-micro').click()
  await page.getByText('Micro refusé', { exact: false }).waitFor({ timeout: 5000 }).catch(() => {})
  verifie('micro refusé : un message dit comment l’autoriser', await page.getByText('Micro refusé', { exact: false }).count() >= 1)
  await page.evaluate(() => { sessionStorage.removeItem('voixErreur'); sessionStorage.setItem('sansVoix', '1') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await ongletDisc.waitFor({ timeout: 20000 })
  await ouvrirChat()
  verifie('navigateur sans reconnaissance vocale : état « non supporté » dit clairement', (await page.getByTestId('bulle-aide-micro').getAttribute('data-voix')) === 'non-supporte' && await page.getByTestId('bulle-aide-voix-non').isVisible())
  await page.getByTestId('bulle-aide-micro').click()
  await page.getByText('dictée vocale n’est pas disponible', { exact: false }).waitFor({ timeout: 5000 }).catch(() => {})
  verifie('… et toucher le micro explique pourquoi (message)', await page.getByText('dictée vocale n’est pas disponible', { exact: false }).count() >= 1)
  await page.evaluate(() => sessionStorage.removeItem('sansVoix'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // --- 4 sexies. cartes « À faire ici » : comptées par chat, répondables sans quitter le chat, chat qui reste ouvert au clavier
  const chId = randomUUID(), qId = randomUUID()
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values ('${chId}', '${projetId}', 'Choisir la couleur du bouton', 'Test du chat.', 'libre')`)
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, options) values ('${qId}', '${projetId}', '${chId}', 'Claude', 'session', 'question', 'Quelle couleur pour le bouton ?', '[{"libelle":"Bleu","aide":"sobre","recommande":true},{"libelle":"Vert","aide":"vif"}]'::jsonb)`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await ongletDisc.waitFor({ timeout: 20000 })
  await ongletDisc.click()
  await page.getByTestId('discussions-liste').waitFor({ timeout: 10000 })
  await ligneChat.getByTestId('discussion-a-faire').waitFor({ timeout: 10000 }).catch(() => {})
  verifie('liste : le chat du projet dit « 1 à faire » (la carte qui l’attend)', (await ligneChat.getByTestId('discussion-a-faire').getAttribute('data-nombre').catch(() => null)) === '1')
  const nLignes = await page.getByTestId('discussion-ligne').evaluateAll((els) => els.reduce((n, e) => n + Number(e.querySelector('[data-testid=discussion-pastille]')?.getAttribute('data-nombre') ?? 0) + Number(e.querySelector('[data-testid=discussion-a-faire]')?.getAttribute('data-nombre') ?? 0), 0))
  const nBarre = Number(await page.getByTestId('barre-reponses').innerText().catch(() => '0'))
  verifie('la pastille de l’onglet Discussions = la somme des pastilles des chats', nLignes > 0 && nBarre === nLignes, { nLignes, nBarre })
  await ligneChat.click()
  await panneau.waitFor({ timeout: 5000 })
  await page.getByTestId('bulle-a-faire-carte').first().waitFor({ timeout: 10000 }).catch(() => {})
  verifie('chat : la carte « À faire ici » est là', await page.getByTestId('bulle-a-faire-carte').count() === 1)
  // Clavier ouvert (le visualViewport rétrécit) : le chat ne doit pas se refermer.
  await page.setViewportSize({ width: 390, height: 420 })
  await page.getByTestId('bulle-aide-saisie').tap()
  await page.waitForTimeout(500)
  verifie('clavier ouvert : le chat reste ouvert', await panneau.isVisible())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('radio', { name: /Bleu/ }).tap()
  await page.getByTestId('valider-reponse').tap()
  await page.getByTestId('bulle-a-faire-carte').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  const rep = sql(`select answered_at, reponse from messages where id = '${qId}'`)
  verifie('répondre dans le chat : la réponse part en base', !!rep[0]?.answered_at && String(rep[0]?.reponse ?? '').includes('Bleu'), rep)
  verifie('… le chat reste ouvert et la carte disparaît', await panneau.isVisible() && await page.getByTestId('bulle-a-faire-carte').count() === 0)
  await page.screenshot({ path: `${CAPTURES}/bulle-carte-repondue.png` })
  await page.keyboard.press('Escape')
  await page.getByTestId('discussions-liste').waitFor({ timeout: 5000 })
  verifie('liste : plus rien « à faire » une fois la carte traitée', await ligneChat.getByTestId('discussion-a-faire').count() === 0)
  await page.keyboard.press('Escape')

  // --- 5. le réglage d'extinction reste dans « Réglages du projet »
  await page.getByTestId('onglet-vue-reglages').click()
  await page.getByTestId('reglages-projet').getByRole('button').first().click()
  const caseBulle = page.getByLabel('Bulle d\'aide sur ce projet')
  await caseBulle.waitFor({ timeout: 5000 })
  verifie('Réglages du projet : « Bulle d’aide » cochée par défaut', await caseBulle.isChecked())
  await caseBulle.uncheck()
  await page.waitForTimeout(800)
  await ongletDisc.click()
  await page.getByTestId('discussions-liste').waitFor({ timeout: 8000 })
  verifie('décochée : le projet n’a plus de chat dans la liste', await ligneChat.count() === 0)
  await page.keyboard.press('Escape')
  await caseBulle.check()
  await page.waitForTimeout(800)
  await ongletDisc.click()
  await page.getByTestId('discussions-liste').waitFor({ timeout: 8000 })
  verifie('recochée : le chat revient dans la liste', await ligneChat.count() === 1)
  await page.keyboard.press('Escape')
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
