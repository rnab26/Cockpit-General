// Accueil SIMPLE et chat plié, parcours complet sur écran de téléphone (13 oct. 2026, chantier « simplifier le cockpit »).
// Raphaël : « j'ai 30 actions à faire avant de voir l'historique du chat », « il y a encore trop d'informations ».
// Prouve, sur un projet jetable `test-accueil-…` (et un second, vide) :
//   - l'accueil simple est la vue par défaut : trois blocs (À toi, En cours, Livré), aucune tuile ;
//   - « À toi » ne compte que les DEMANDES (questions, décision) ; les 3 chantiers livrés sont « à tester », repliés ;
//   - chaque ligne a un sujet, et deux questions d'un même chantier ne se ressemblent pas ;
//   - « Vue détaillée » rend l'ancien accueil (tuile « à tester » comprise), le choix survit au rechargement ;
//   - vue « Tout » : le nombre de « À toi » = la pastille de l'onglet Accueil = les lignes + « Voir les N autres » ;
//   - chat : l'historique d'abord, une ligne par demande, une carte dépliée à la fois, les tests repliés, la pastille
//     de l'onglet Discussions ne compte pas les tests ;
//   - état vide : « Rien ne t'attend », « Personne ne travaille » ; aucun défilement horizontal ; aucune erreur JavaScript.
// Court (~1 min). Usage : node app/scripts/verifier-accueil.mjs   (build d'abord : cd app && npm run build)
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
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
const PORT = Number(process.env.PORT ?? 4175)
const BASE = `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-accueil-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const SLUG_VIDE = `${PREFIXE}vide-${randomUUID().slice(0, 6)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }

const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

const ids = { projet: randomUUID(), vide: randomUUID() }
let navigateur = null, moiId = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${ids.projet}', '${SLUG}', 'Test accueil (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-accueil.mjs')`)
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${ids.vide}', '${SLUG_VIDE}', 'Test accueil vide (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-accueil.mjs')`)
  moiId = sql(`select id from auth.users where email = '${esc(EMAIL)}'`)[0]?.id ?? null

  // Données : 2 questions sur UN chantier + 1 question de projet (balise « Sujet : ») + 1 décision à cadrer = 4 demandes ;
  // 3 chantiers livrés = « à tester » ; 1 chantier qui avance ; 1 chantier certifié aujourd'hui.
  const chQ = randomUUID(), chCadrer = randomUUID(), chEnCours = randomUUID(), chFini = randomUUID()
  const chTests = [randomUUID(), randomUUID(), randomUUID()]
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values ('${chQ}', '${ids.projet}', 'Décisions sur le bouton', 'Test.', 'libre')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values ('${chCadrer}', '${ids.projet}', 'Refaire l’écran des réglages', 'Test.', 'a_cadrer')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, pris_jusqu_a) values ('${chEnCours}', '${ids.projet}', 'Migration des photos', 'Test.', 'en_cours', 'claude/test-accueil', now() + interval '1 hour')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, valide_at, valide_par, archived_at) values ('${chFini}', '${ids.projet}', 'Logo en haut de page', 'Test.', 'valide', now(), '${esc(EMAIL)}', now())`)
  chTests.forEach((id, i) => sql(`insert into chantiers (id, projet_id, titre, demande, etat, livre_at) values ('${id}', '${ids.projet}', 'Livraison ${i + 1} à tester', 'Test.', 'a_verifier', now() - interval '${i + 1} days')`))
  const q = (chantier, corps) => sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, options) values ('${randomUUID()}', '${ids.projet}', ${chantier ? `'${chantier}'` : 'null'}, 'Claude', 'session', 'question', '${esc(corps)}', '[{"libelle":"Oui","aide":"ok","recommande":true},{"libelle":"Non","aide":"pas ok"}]'::jsonb)`)
  q(chQ, 'Quelle couleur pour le bouton principal ?')
  q(chQ, 'Le bouton doit-il être arrondi ?')
  q(null, 'Sujet : Solde RunPod. Peux-tu recharger le compte ?')
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, updated_at) values ('${ids.projet}', '${chEnCours}', 'claude/test-accueil', 'photos copiées, vérification en cours', 40, 'en_cours', now())`)

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
  const nombre = async (testId) => Number((await page.getByTestId(testId).first().innerText().catch(() => '')).replace(/\D/g, '')) || 0
  const typesVisibles = () => page.getByTestId('element-a-toi').evaluateAll((els) => els.map((e) => e.getAttribute('data-type')))

  // --- 1. vue du projet : l'accueil simple, par défaut (aucun réglage posé)
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('accueil-simple').waitFor({ timeout: 30000 })
  await page.getByTestId('accueil-a-toi-total').waitFor({ timeout: 20000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="accueil-a-toi-total"]')?.textContent !== '0', null, { timeout: 30000 }).catch(() => {})
  verifie('vue par défaut = accueil simple : trois blocs, aucune tuile', await page.getByTestId('accueil-a-toi').count() === 1 && await page.getByTestId('accueil-en-cours').count() === 1
    && await page.getByTestId('accueil-livre').count() === 1 && await page.getByTestId('tuiles').count() === 0)
  verifie('« À toi » = 4 demandes (2 questions du même chantier + 1 question du projet + 1 décision), jamais les 3 livrés', await nombre('accueil-a-toi-total') === 4, await nombre('accueil-a-toi-total'))
  verifie('les 4 lignes sont des demandes : aucune « à tester » parmi elles', (await typesVisibles()).length === 4 && !(await typesVisibles()).includes('a_verifier'), await typesVisibles())
  const libelleTests = await page.getByTestId('accueil-a-tester-libelle').innerText().catch(() => '')
  verifie('« 3 livrés à tester » : une ligne repliée sous les demandes', libelleTests === '3 livrés à tester' && await page.getByTestId('accueil-a-tester-repli').getAttribute('aria-expanded') === 'false', libelleTests)
  const sujets = await page.getByTestId('titre-a-toi').allInnerTexts()
  const details = await page.getByTestId('attente-a-toi').allInnerTexts()
  verifie('chaque ligne a un sujet lisible (jamais vide, jamais « Question sur le projet » quand le message dit de quoi il s’agit)', sujets.length === 4 && sujets.every((s) => s.trim().length > 3 && s.trim() !== 'Question sur le projet'), sujets)
  verifie('la question du projet porte son « Sujet : » (Solde RunPod), sa phrase en dessous', sujets.includes('Solde RunPod') && details.some((d) => d.includes('recharger le compte')), { sujets, details })
  verifie('deux questions d’un même chantier se distinguent : la 2e ligne est la question elle-même', details.includes('Quelle couleur pour le bouton principal ?') && details.includes('Le bouton doit-il être arrondi ?'), details)
  verifie('« En cours » : le chantier qui avance, avec sa barre', await nombre('accueil-en-cours-total') === 1 && await page.getByTestId('ligne-en-ce-moment').count() === 1, await nombre('accueil-en-cours-total'))
  verifie('« Livré » : le chantier certifié aujourd’hui, « Certifié par toi… »', await nombre('accueil-livre-total') === 1 && (await page.getByTestId('accueil-ligne-livre').first().innerText()).includes('Certifié'))
  verifie('bloc « Livré » : « Certifié aujourd’hui » et le lien « changer » sont là', (await page.getByTestId('accueil-livre').innerText()).includes('Certifié aujourd’hui') && await page.getByTestId('accueil-fenetre').count() === 1)
  verifie('aucun défilement horizontal (téléphone)', (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0)
  await page.screenshot({ path: `${CAPTURES}/accueil-simple-projet.png`, fullPage: false })

  // --- 2. « 3 livrés à tester » s'ouvre à un toucher et rend les lignes
  await page.getByTestId('accueil-a-tester-repli').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="element-a-toi"][data-type="a_verifier"]').length === 3, null, { timeout: 8000 }).catch(() => {})
  verifie('« à tester » dépliée : 3 lignes « à tester » en plus des 4 demandes', (await typesVisibles()).filter((t) => t === 'a_verifier').length === 3 && await nombre('accueil-a-toi-total') === 4)
  await page.getByTestId('accueil-a-tester-repli').click()
  verifie('… et se replie', (await typesVisibles()).filter((t) => t === 'a_verifier').length === 0)

  // --- 2 bis. « Classer sans test » : d'un geste (confirmation, puis « Annuler »), jamais « certifié » ; classement automatique réglable
  await page.getByTestId('accueil-a-tester-repli').click()
  await page.getByTestId('classer-livres').waitFor({ timeout: 8000 })
  verifie('« à tester » dépliée : le bouton « Classer ces 3 sans test » et le réglage du classement automatique sont là (vue du projet)',
    (await page.getByTestId('classer-livres-bouton').innerText()).includes('Classer ces 3 sans test') && await page.getByTestId('classer-livres-delai').count() === 1 && (await page.getByTestId('classer-livres-delai').inputValue()) === '')
  await page.getByTestId('classer-livres-delai').selectOption('7')
  await page.getByText('Classé tout seul après 7 jours', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('classement automatique réglé à 7 jours : message à l’écran ET en base', (await page.getByText('Classé tout seul après 7 jours', { exact: false }).count()) >= 1 && sql(`select livres_classes_apres_j as j from projets where id = '${ids.projet}'`)[0].j === 7)
  await page.getByTestId('classer-livres-delai').selectOption('')
  await page.getByText('Plus de classement automatique', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('… et « jamais » le remet à vide', sql(`select livres_classes_apres_j as j from projets where id = '${ids.projet}'`)[0].j === null)
  await page.getByTestId('classer-livres-bouton').click()
  await page.getByRole('button', { name: 'Annuler' }).first().waitFor({ timeout: 5000 })
  verifie('« Classer » demande confirmation et dit ce qui se passe (pas certifiés, archives, rien supprimé)', await page.getByText('Classer 3 chantiers sans test ?').count() === 1 && await page.getByText('Ils ne sont pas certifiés', { exact: false }).count() === 1)
  await page.getByRole('button', { name: 'Annuler' }).first().click()
  verifie('« Annuler » dans la confirmation : rien n’est classé', sql(`select count(*)::int as n from chantiers where projet_id = '${ids.projet}' and archived_at is not null and etat = 'a_verifier'`)[0].n === 0)
  await page.getByTestId('classer-livres-bouton').click()
  await page.getByRole('button', { name: 'Classer sans test' }).click()
  await page.getByText('3 chantiers classés sans test.').waitFor({ timeout: 15000 })
  const classes = sql(`select etat, archived_at is not null as archive, valide_at is not null as certifie from chantiers where projet_id = '${ids.projet}' and titre like 'Livraison % à tester'`)
  verifie('3 chantiers classés : archivés, « à vérifier » gardé, JAMAIS certifiés', classes.length === 3 && classes.every((c) => c.archive && c.etat === 'a_verifier' && !c.certifie), classes)
  verifie('une ligne « Classé sans test » dans le fil de chacun', sql(`select count(*)::int as n from messages where projet_id = '${ids.projet}' and corps like 'Classé sans test%'`)[0].n === 3)
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="accueil-a-tester"]').length === 0, null, { timeout: 15000 }).catch(() => {})
  verifie('la ligne « livrés à tester » disparaît de l’accueil, « À toi » ne bouge pas (4)', await page.getByTestId('accueil-a-tester').count() === 0 && await nombre('accueil-a-toi-total') === 4)
  await page.screenshot({ path: `${CAPTURES}/accueil-classes.png` })
  await page.getByRole('button', { name: 'Annuler' }).first().click()
  await page.getByText('Remis dans « À tester ».').waitFor({ timeout: 15000 })
  verifie('« Annuler » dans le message : les 3 sont remis dans « À tester », tels qu’avant', sql(`select count(*)::int as n from chantiers where projet_id = '${ids.projet}' and archived_at is null and etat = 'a_verifier'`)[0].n === 3)
  await page.getByTestId('accueil-a-tester-libelle').waitFor({ timeout: 15000 })
  verifie('… et la ligne « 3 livrés à tester » est revenue', (await page.getByTestId('accueil-a-tester-libelle').innerText()) === '3 livrés à tester')

  // --- 3. vue détaillée : l'ancien accueil, tuile « à tester » comprise ; le choix survit au rechargement
  await page.getByTestId('vue-detaillee').click()
  await page.getByTestId('tuiles').waitFor({ timeout: 10000 })
  verifie('« Vue détaillée » : les tuiles reviennent, « pour toi » = 4, « à tester » = 3', await page.getByTestId('accueil-simple').count() === 0 && (await page.getByTestId('tuile-pourToi').innerText()).startsWith('4') && (await page.getByTestId('tuile-aTester').innerText()).startsWith('3'), await page.getByTestId('tuiles').innerText())
  verifie('vue détaillée : six tuiles sur une ligne, dans la largeur du téléphone', await page.getByTestId('tuiles').locator('button').evaluateAll((els, w) => els.length === 6 && new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size === 1 && els.every((e) => e.getBoundingClientRect().right <= w), 390))
  verifie('vue détaillée : « À toi de jouer » ne liste que les demandes ; la section « À tester » est là, repliée', await page.getByTestId('a-tester').count() === 1 && (await typesVisibles()).length === 4 && !(await typesVisibles()).includes('a_verifier'), await typesVisibles())
  await page.screenshot({ path: `${CAPTURES}/accueil-detaille.png` })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('tuiles').waitFor({ timeout: 30000 })
  verifie('le choix « vue détaillée » survit au rechargement', await page.getByTestId('vue-simple').count() === 1 && await page.getByTestId('accueil-simple').count() === 0)
  await page.getByTestId('vue-simple').click()
  await page.getByTestId('accueil-simple').waitFor({ timeout: 10000 })
  verifie('« Vue simple » ramène l’accueil à 3 blocs', await page.getByTestId('tuiles').count() === 0 && await page.getByTestId('accueil-a-toi').count() === 1)

  // --- 4. vue « Tout » : le nombre de « À toi » = la pastille de l'onglet Accueil = les lignes + « Voir les N autres »
  if (!(await page.getByTestId('liste-projets').count())) await page.getByTestId('choix-projet-bouton').click()
  await page.getByTestId('liste-projets').waitFor({ timeout: 10000 })
  await page.getByTestId('onglet-tout').click()
  await page.getByTestId('vue-tout').waitFor({ timeout: 30000 })
  await page.getByTestId('accueil-simple').waitFor({ timeout: 30000 })
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="accueil-a-toi-total"]')?.textContent ?? 0) >= 4, null, { timeout: 30000 }).catch(() => {})
  const nTout = await nombre('accueil-a-toi-total')
  const lignes = (await page.getByTestId('element-a-toi').count())
  const reste = Number((await page.getByTestId('accueil-voir-demandes').innerText().catch(() => '')).replace(/\D/g, '')) || 0
  verifie('vue « Tout » : au moins nos 4 demandes ; lignes montrées (5 au plus) + « Voir les N autres » = le total', nTout >= 4 && lignes <= 5 && lignes + reste === nTout, { nTout, lignes, reste })
  verifie('vue « Tout » : la pastille de l’onglet Accueil dit le même nombre', await nombre('barre-a-toi') === nTout, { barre: await nombre('barre-a-toi'), nTout })
  verifie('vue « Tout » : le projet de chaque ligne est nommé (plusieurs projets)', await page.getByTestId('projet-a-toi').count() === lignes)
  if (reste) {
    await page.getByTestId('accueil-voir-demandes').click()
    verifie('« Voir les N autres » montre tout le reste', await page.getByTestId('element-a-toi').count() === nTout, { nTout, lignes: await page.getByTestId('element-a-toi').count() })
  }
  await page.screenshot({ path: `${CAPTURES}/accueil-simple-tout.png` })

  // --- 5. le chat du projet : l'historique d'abord, une ligne par demande, une carte dépliée à la fois, les tests repliés
  const ongletDisc = page.getByTestId('onglet-barre-discussions')
  await ongletDisc.click()
  await page.getByTestId('discussions-liste').waitFor({ timeout: 10000 })
  const ligneChat = page.locator(`[data-testid="discussion-ligne"][data-projet="${SLUG}"]`)
  await ligneChat.getByTestId('discussion-a-faire').waitFor({ timeout: 15000 }).catch(() => {})
  verifie('liste des discussions : « 4 à faire » (les demandes) et « 3 à tester » à part', (await ligneChat.getByTestId('discussion-a-faire').getAttribute('data-nombre').catch(() => null)) === '4' && (await ligneChat.getByTestId('discussion-a-tester').getAttribute('data-nombre').catch(() => null)) === '3')
  const sommeLignes = await page.getByTestId('discussion-ligne').evaluateAll((els) => els.reduce((n, e) => n + Number(e.querySelector('[data-testid=discussion-pastille]')?.getAttribute('data-nombre') ?? 0) + Number(e.querySelector('[data-testid=discussion-a-faire]')?.getAttribute('data-nombre') ?? 0), 0))
  verifie('la pastille de l’onglet Discussions = la somme des chats, SANS les chantiers à tester', await nombre('barre-reponses') === sommeLignes && sommeLignes >= 4, { barre: await nombre('barre-reponses'), sommeLignes })
  await ligneChat.click()
  await page.getByTestId('bulle-aide-panneau').waitFor({ timeout: 8000 })
  await page.getByTestId('bulle-a-faire-ligne').first().waitFor({ timeout: 10000 })
  verifie('chat : « À faire ici (4) », UNE ligne par demande, toutes repliées', (await page.getByTestId('bulle-a-faire-titre').innerText()) === 'À faire ici (4)' && await page.getByTestId('bulle-a-faire-ligne').count() === 4 && await page.getByTestId('bulle-a-faire-contenu').count() === 0)
  const sujetsChat = await page.getByTestId('bulle-a-faire-sujet').allInnerTexts()
  const detailsChat = await page.getByTestId('bulle-a-faire-detail').allInnerTexts()
  verifie('chat : chaque ligne dit son sujet, et sa question en dessous', sujetsChat.length === 4 && sujetsChat.every((s) => s.trim().length > 3) && detailsChat.includes('Le bouton doit-il être arrondi ?') && sujetsChat.includes('Solde RunPod'), { sujetsChat, detailsChat })
  verifie('chat : « 3 livrés à tester » replié, sans carte ouverte', (await page.getByTestId('bulle-a-tester-repli').innerText()).includes('3 livrés à tester') && await page.getByTestId('bulle-a-tester-liste').count() === 0)
  await page.screenshot({ path: `${CAPTURES}/chat-plie.png` })
  await page.getByTestId('bulle-a-faire-ligne').nth(0).click()
  await page.getByTestId('bulle-a-faire-contenu').waitFor({ timeout: 5000 })
  verifie('toucher une ligne déplie SA carte (la question, ses options)', await page.getByTestId('bulle-a-faire-contenu').count() === 1 && await page.getByTestId('bloc-question').count() === 1)
  await page.getByTestId('bulle-a-faire-ligne').nth(1).click()
  await page.waitForTimeout(300)
  verifie('une seule carte ouverte à la fois : en toucher une autre referme la première', await page.getByTestId('bulle-a-faire-contenu').count() === 1 && await page.locator('[data-testid="bulle-a-faire-carte"][data-ouverte="1"]').count() === 1)
  await page.getByTestId('bulle-a-faire-ligne').nth(1).click()
  await page.waitForTimeout(200)
  verifie('toucher la ligne ouverte la referme', await page.getByTestId('bulle-a-faire-contenu').count() === 0)
  await page.getByTestId('bulle-a-tester-repli').click()
  await page.getByTestId('bulle-a-tester-liste').waitFor({ timeout: 5000 })
  const lignesTests = page.getByTestId('bulle-a-tester-liste').getByTestId('bulle-a-faire-ligne')
  verifie('« à tester » dépliée : 3 lignes, repliées, avec leur titre', await lignesTests.count() === 3 && (await page.getByTestId('bulle-a-tester-liste').innerText()).includes('Livraison 1 à tester'))
  await lignesTests.first().click()
  await page.getByTestId('bloc-validation').waitFor({ timeout: 5000 }).catch(() => {})
  verifie('une ligne « à tester » déplie « Ça marche / Ça ne marche pas »', await page.getByTestId('bloc-validation').count() === 1 && await page.getByTestId('btn-certifier').isVisible())
  await page.screenshot({ path: `${CAPTURES}/chat-test-ouvert.png` })
  await page.keyboard.press('Escape')

  // --- 6. un projet sans rien : des phrases, pas des tableaux vides
  await page.goto(BASE + `#projet=${SLUG_VIDE}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('accueil-simple').waitFor({ timeout: 30000 })
  verifie('projet vide : « Rien ne t’attend », « Personne ne travaille sur ce projet », « Rien de certifié »',
    await page.getByTestId('rien-ne-t-attend').count() === 1 && (await page.getByTestId('accueil-personne').innerText()).includes('Personne ne travaille sur ce projet')
    && await page.getByTestId('accueil-rien-livre').count() === 1 && await page.getByTestId('accueil-a-tester').count() === 0 && await page.getByTestId('accueil-en-attente').count() === 0)
  await page.screenshot({ path: `${CAPTURES}/accueil-simple-vide.png` })
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    await purgerProjetsDeTest(sql, [ids.projet, ids.vide], PREFIXE)
    if (moiId) sql(`delete from preferences where user_id = '${moiId}' and cle in ('bulle_flottante_aide_${ids.projet}', 'bulle_flottante_aide_${ids.vide}')`)
    const reste = sql(`select count(*)::int as n from projets where slug like '${PREFIXE}%'`)[0].n
    verifie('nettoyage : les projets jetables sont supprimés', reste === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-accueil : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
