// Survie des données hors ligne, parcours COMPLET sur écran de téléphone (chantier 5b68a493) :
// sans réseau, ce qu'on écrit est gardé sur l'appareil (bandeau « en attente »), survit à un
// rechargement de la page, repart tout seul au retour du réseau, UNE seule fois même quand la
// réponse du serveur s'est perdue ; un refus du serveur reste visible et se réessaie ; l'écran
// d'un projet s'ouvre hors ligne avec les dernières données. Projet jetable `test-horsligne-…`.
// Usage : node app/scripts/verifier-hors-ligne.mjs   (build d'abord : cd app && npm run build)
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
const PREFIXE = 'test-horsligne-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

// Mode du « réseau » vu par le navigateur : ok | coupe | refus (le serveur répond 400 aux écritures) | perdue (la requête
// ARRIVE au serveur mais la réponse se perd — le cas qui doublerait une ligne sans identifiant fixé côté appareil).
let reseau = 'ok'
let appelsProjets = 0
const compte = () => sql(`select count(*)::int as n from messages where projet_id = '${projetId}'`)[0].n
let projetId = null, moiId = null, navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  projetId = randomUUID()
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test hors ligne (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-hors-ligne.mjs')`)
  moiId = sql(`select id from auth.users where email = '${esc(EMAIL)}'`)[0]?.id ?? null

  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
  const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const ses = await (await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json()
  if (!ses.access_token) throw new Error('connexion impossible')
  navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  await ctx.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(ses)])
  // Délai du panneau réglé court pour le banc (le défaut de l'appli est 10 s) : même mécanisme que Réglages.
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('cockpit_delai_panneau_s')) localStorage.setItem('cockpit_delai_panneau_s', '3') } catch {} })
  // Le Chromium du conteneur ne fait pas confiance au proxy : les requêtes https passent par Node (certificat vérifié).
  await ctx.route(/^https:\/\//, async (route) => {
    const r = route.request()
    const ecriture = r.method() !== 'GET' && r.method() !== 'HEAD' && /\/rest\/v1\//.test(r.url()) && !/\/rpc\/(etat_|moi|prochain_|projets_visibles|journal_invites|membres_)/.test(r.url())
    if (r.method() === 'POST' && /\/rpc\/projets_visibles/.test(r.url())) appelsProjets++
    if (reseau === 'coupe') { await route.abort('internetdisconnected'); return }
    try {
      if (reseau === 'refus' && ecriture) { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'refus de test' }) }); return }
      const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
      const corps = Buffer.from(await res.arrayBuffer())
      if (reseau === 'perdue' && ecriture) { await route.abort('connectionreset'); return }
      const headers = Object.fromEntries(res.headers); delete headers['content-encoding']; delete headers['content-length']
      await route.fulfill({ status: res.status, headers, body: corps })
    } catch { await route.abort('failed') }
  })
  const page = await ctx.newPage()
  if (process.env.DEBUG_RESEAU) { page.on('requestfailed', (r) => console.log('FAIL', r.url().slice(0, 120), r.failure()?.errorText)); page.on('response', (r) => console.log(r.status(), r.url().slice(0, 140))); page.on('console', (m) => console.log('CONSOLE', m.text().slice(0, 200))) }
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const bandeau = page.getByTestId('bandeau-file-attente')
  const envoyer = async (texte) => {
    await page.getByTestId('bulle-aide-bouton').click()
    await page.getByTestId('bulle-aide-saisie').fill(texte)
    await page.getByTestId('bulle-aide-envoyer').click()
    await page.waitForFunction(() => document.querySelector('[data-testid=bulle-aide-saisie]')?.value === '', null, { timeout: 20000 }).catch(() => {})
    await page.keyboard.press('Escape') // referme la fenêtre d'aide pour voir le bandeau
    await page.getByTestId('bulle-aide-bouton').waitFor({ timeout: 5000 }).catch(() => {})
  }

  // --- 1. en ligne : rien à signaler, les données sont gardées pour le hors ligne
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 90000 }).catch(async (e) => { await page.screenshot({ path: `${CAPTURES}/hors-ligne-echec.png` }); console.log((await page.innerText('body')).slice(0, 400)); throw e })
  await pause(1500)
  verifie('en ligne : aucun bandeau', await bandeau.count() === 0)

  // --- 2. réseau coupé : l'écran du projet s'ouvre quand même (dernières données)
  reseau = 'coupe'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 90000 }).catch(() => {})
  verifie('hors ligne : l’écran du projet s’ouvre avec les dernières données reçues', await page.getByTestId('vue-projet').count() === 1)
  await bandeau.waitFor({ timeout: 10000 }).catch(() => {})
  const voyant = page.getByTestId('voyant-hors-ligne')
  await voyant.waitFor({ timeout: 10000 }).catch(() => {})
  verifie('hors ligne : un petit voyant « Hors ligne », pas de panneau', /Hors ligne/.test(await voyant.innerText().catch(() => '')) && await bandeau.count() === 0)
  verifie('hors ligne : jamais « Aucun projet » (dernières données gardées)', !(await page.innerText('body')).includes('Aucun projet'))
  await page.screenshot({ path: `${CAPTURES}/hors-ligne-lecture.png` })

  // --- 2 bis. régression PR #72 : une LECTURE n'est jamais mise en file, une coupure brève ne vide pas l'écran
  reseau = 'ok'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 90000 })
  reseau = 'coupe'
  await page.getByTestId('actualiser').click().catch(() => {})
  await pause(2500)
  verifie('coupure brève : l’écran du projet reste tel quel', await page.getByTestId('vue-projet').count() === 1)
  verifie('coupure brève : jamais « Aucun projet »', !(await page.innerText('body')).includes('Aucun projet'))
  verifie('coupure brève : aucun panneau (lecture ≠ écriture en attente)', await bandeau.count() === 0)
  await pause(3500) // plus que le délai du panneau (3 s)
  verifie('même après le délai : aucun panneau, la lecture n’est pas en file', await bandeau.count() === 0)
  const enFile = () => page.evaluate(() => new Promise((res) => { const o = indexedDB.open('cockpit-hors-ligne'); o.onsuccess = () => { const q = o.result.transaction('file').objectStore('file').getAll(); q.onsuccess = () => res(q.result.map((e) => ({ id: e.id, url: e.url, m: e.methode, statut: e.statut, raison: e.raison }))); q.onerror = () => res([]) }; o.onerror = () => res([]) }))
  verifie('IndexedDB : rien en file', (await enFile()).length === 0, await enFile())
  // migration : une lecture déjà en file (ancienne règle) est retirée, une vraie écriture est gardée et envoyée
  const tMig = 'Écriture gardée avant le correctif — ' + randomUUID().slice(0, 6)
  const idMig = randomUUID()
  await page.evaluate(([api, projet, id, texte, cle]) => new Promise((res) => {
    const o = indexedDB.open('cockpit-hors-ligne'); o.onsuccess = () => {
      const t = o.result.transaction('file', 'readwrite'); const s = t.objectStore('file')
      s.put({ id: 'lecture-' + id, ajoute: Date.now() - 60000, uid: null, methode: 'POST', url: api + '/rest/v1/rpc/projets_visibles', entetes: [['content-type', 'application/json'], ['content-profile', 'cockpit'], ['accept-profile', 'cockpit']], corps: { type: 'texte', v: '{}' }, essais: 2, statut: 'attente', resume: 'Action « projets visibles »', apercu: '{}' })
      s.put({ id: 'ecriture-' + id, ajoute: Date.now() - 50000, uid: null, methode: 'POST', url: api + '/rest/v1/messages', entetes: [['content-type', 'application/json'], ['content-profile', 'cockpit'], ['accept-profile', 'cockpit'], ['prefer', 'return=minimal'], ['apikey', cle]], corps: { type: 'texte', v: JSON.stringify({ id, projet_id: projet, kind: 'info', auteur: 'Test', auteur_type: 'proprietaire', corps: texte }) }, essais: 1, statut: 'attente', resume: 'Message dans un fil (ajout)', apercu: texte })
      t.oncomplete = () => res(true)
    }
  }), [API, projetId, idMig, tMig, CLE_PUBLIQUE])
  reseau = 'coupe'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 90000 }).catch(() => {})
  await pause(1500)
  const apres = await enFile()
  verifie('migration : la lecture « projets visibles » est retirée de la file', !apres.some((e) => /projets_visibles/.test(e.url)), apres)
  verifie('migration : la vraie écriture est conservée', apres.some((e) => e.id === 'ecriture-' + idMig), apres)
  reseau = 'ok'
  await page.getByTestId('renvoyer-maintenant').click().catch(() => {})
  for (let i = 0; i < 30 && sql(`select count(*)::int as n from messages where id = '${idMig}'`)[0].n < 1; i++) { await pause(500); await page.evaluate(() => window.dispatchEvent(new Event('online'))) }
  verifie('migration : l’écriture conservée arrive en base', sql(`select count(*)::int as n from messages where id = '${idMig}'`)[0].n === 1, await enFile())
  await bandeau.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  sql(`delete from messages where id = '${idMig}'`) // la suite compte les messages du projet jetable
  // retour sur l'appli : un aller-retour bref ne relit rien
  const avant = appelsProjets
  await page.evaluate(() => { for (const v of ['hidden', 'visible']) { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')) } })
  await pause(2000)
  verifie('aller-retour de moins de 20 s : aucun rechargement', appelsProjets === avant, appelsProjets - avant)
  reseau = 'coupe'
  // lecture sans aucun cache : une erreur claire, jamais « Aucun projet »
  await page.evaluate(() => new Promise((res) => { const o = indexedDB.open('cockpit-hors-ligne'); o.onsuccess = () => { const t = o.result.transaction('cache', 'readwrite'); t.objectStore('cache').clear(); t.oncomplete = () => res(true) } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await pause(4000)
  const corpsSansCache = await page.innerText('body')
  verifie('sans réseau ni cache : une erreur lisible, jamais « Aucun projet »', !corpsSansCache.includes('Aucun projet') && /Pas de réseau|injoignable|Réessayer/.test(corpsSansCache), corpsSansCache.slice(0, 200))
  reseau = 'ok'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 90000 })
  reseau = 'coupe'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 90000 }).catch(() => {})

  // --- 3. écrire hors ligne : gardé, dit, pas encore en base
  const t1 = 'Message écrit sans réseau — ' + randomUUID().slice(0, 6)
  await envoyer(t1)
  verifie('écriture à l’instant : voyant seulement, panneau pas encore (délai)', await bandeau.count() === 0 && await page.getByTestId('voyant-hors-ligne').count() === 1)
  await page.getByTestId('bandeau-texte').getByText('enregistré', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('le bandeau dit « 1 élément enregistré sur cet appareil »', /1 élément enregistré sur cet appareil/.test(await page.getByTestId('bandeau-texte').innerText().catch(() => '')))
  verifie('rien en base pour l’instant (honnête : pas de faux succès)', compte() === 0)
  await page.screenshot({ path: `${CAPTURES}/hors-ligne-attente.png` })

  // --- 4. fermer et rouvrir la page (réseau toujours coupé) : le message est toujours là
  await page.reload({ waitUntil: 'domcontentloaded' })
  await bandeau.waitFor({ timeout: 15000 }).catch(() => {})
  verifie('après rechargement hors ligne : toujours « 1 élément enregistré »', /1 élément enregistré/.test(await page.getByTestId('bandeau-texte').innerText().catch(() => '')))

  // --- 4 bis. le message écrit hors ligne se VOIT dans la bulle (même après rechargement), marqué « en attente d'envoi »
  await page.getByTestId('bulle-aide-bouton').click()
  await page.getByTestId('bulle-aide-message').filter({ hasText: t1 }).waitFor({ timeout: 10000 }).catch(() => {})
  const ligneT1 = page.getByTestId('bulle-aide-message').filter({ hasText: t1 })
  verifie('bulle : le message écrit hors ligne est affiché après rechargement', await ligneT1.count() === 1)
  verifie('bulle : il est marqué « En attente d’envoi »', /En attente d’envoi/.test(await ligneT1.innerText().catch(() => '')))
  await page.screenshot({ path: `${CAPTURES}/hors-ligne-message-en-attente.png` })
  await page.keyboard.press('Escape')

  // --- 5. un deuxième message hors ligne s'ajoute derrière (ordre conservé)
  const t2 = 'Deuxième message hors ligne — ' + randomUUID().slice(0, 6)
  await envoyer(t2)
  await page.getByTestId('bandeau-texte').getByText('2 éléments', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('deux éléments en attente', /2 éléments enregistrés/.test(await page.getByTestId('bandeau-texte').innerText().catch(() => '')))

  // --- 6. le réseau revient : tout part, dans l'ordre, une seule fois chacun
  reseau = 'ok'
  await page.getByTestId('renvoyer-maintenant').click()
  for (let i = 0; i < 40 && compte() < 2; i++) await pause(500)
  const lignes = sql(`select corps from messages where projet_id = '${projetId}' order by created_at, id`)
  verifie('au retour du réseau : les 2 messages arrivent en base', lignes.length === 2, lignes)
  verifie('dans l’ordre où ils ont été écrits', lignes[0]?.corps === t1 && lignes[1]?.corps === t2, lignes)
  await page.getByTestId('bulle-aide-bouton').click()
  await page.getByTestId('bulle-aide-message').filter({ hasText: t1 }).waitFor({ timeout: 10000 }).catch(() => {})
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=message-en-attente]').length === 0, null, { timeout: 15000 }).catch(() => {})
  verifie('bulle : une fois parti, le message est normal (plus de marque, pas de doublon)', await page.getByTestId('message-en-attente').count() === 0 && await page.getByTestId('bulle-aide-message').filter({ hasText: t1 }).count() === 1)
  await page.keyboard.press('Escape')
  await bandeau.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  verifie('le bandeau disparaît quand tout est parti', await bandeau.count() === 0)

  // --- 7. réponse perdue : la requête est arrivée mais l'appareil ne le sait pas → pas de doublon
  reseau = 'perdue'
  const t3 = 'Réponse perdue — ' + randomUUID().slice(0, 6)
  await envoyer(t3)
  await page.getByTestId('bandeau-texte').getByText('enregistré', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {})
  verifie('réponse perdue : le serveur a déjà la ligne, l’appareil la croit en attente', sql(`select count(*)::int as n from messages where projet_id = '${projetId}' and corps = '${esc(t3)}'`)[0].n === 1)
  reseau = 'ok'
  await page.getByTestId('renvoyer-maintenant').click()
  await bandeau.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  verifie('renvoi : la ligne n’est PAS doublée (identifiant fixé côté appareil)', sql(`select count(*)::int as n from messages where projet_id = '${projetId}' and corps = '${esc(t3)}'`)[0].n === 1)
  verifie('et le bandeau s’éteint', await bandeau.count() === 0)

  // --- 8. refus du serveur : jamais jeté, visible, réessayable
  reseau = 'coupe'
  const t4 = 'Message qui sera refusé — ' + randomUUID().slice(0, 6)
  await envoyer(t4)
  await page.getByTestId('bandeau-texte').getByText('enregistré', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {})
  reseau = 'refus'
  await page.getByTestId('renvoyer-maintenant').click()
  await page.getByTestId('bandeau-texte').getByText('refusé', { exact: false }).waitFor({ timeout: 15000 }).catch(() => {})
  verifie('refusé par le serveur : le bandeau le dit (rien n’est perdu)', /refusé/.test(await page.getByTestId('bandeau-texte').innerText().catch(() => '')))
  await bandeau.getByLabel('Voir le détail').click()
  verifie('le détail montre le contenu gardé et la raison', (await page.getByTestId('liste-file-attente').innerText()).includes('Refusé (400)'))
  await page.screenshot({ path: `${CAPTURES}/hors-ligne-refus.png` })
  reseau = 'ok'
  await page.getByRole('button', { name: 'Réessayer' }).click()
  for (let i = 0; i < 40 && sql(`select count(*)::int as n from messages where projet_id = '${projetId}' and corps = '${esc(t4)}'`)[0].n < 1; i++) await pause(500)
  verifie('Réessayer : le message arrive en base', sql(`select count(*)::int as n from messages where projet_id = '${projetId}' and corps = '${esc(t4)}'`)[0].n === 1)

  // --- 9. abandonner demande confirmation
  reseau = 'coupe'
  await envoyer('À abandonner — ' + randomUUID().slice(0, 6))
  await page.getByTestId('bandeau-texte').getByText('enregistré', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {})
  if (await bandeau.getByLabel('Voir le détail').count()) await bandeau.getByLabel('Voir le détail').click()
  await page.getByTestId('liste-file-attente').getByRole('button', { name: 'Abandonner' }).click()
  verifie('abandonner : une confirmation est demandée avant d’effacer', await page.getByText('Abandonner cet envoi ?').isVisible())
  await page.getByRole('button', { name: 'Abandonner', exact: true }).last().click()
  await pause(1000)
  reseau = 'ok'
  verifie('confirmé : l’envoi est retiré de la file (plus rien « enregistré sur cet appareil »)', !/enregistré/.test(await bandeau.innerText().catch(() => '')))

  const sansDefilement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  verifie('téléphone : aucun défilement horizontal', sansDefilement <= 0, sansDefilement)
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    if (projetId) await purgerProjetsDeTest(sql, [projetId], PREFIXE)
    if (moiId) sql(`delete from preferences where user_id = '${moiId}' and cle like '%${projetId}%'`)
    const reste = sql(`select count(*)::int as n from projets where slug = '${SLUG}'`)[0].n
    verifie('nettoyage : le projet jetable est supprimé', reste === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-hors-ligne : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
