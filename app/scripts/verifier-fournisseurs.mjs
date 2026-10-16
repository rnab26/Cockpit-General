// Le bouton « Chercher mes fournisseurs » de Coûts (0084, chantier 07258fe5), parcours COMPLET sur écran de téléphone :
// état vide, demande (un seul toucher compte), annulation, état en attente, la « session » qui cherche (le vrai script
// scripts/chercher-fournisseurs.py) et la liste qui arrive toute seule, Suivre (prestataire créé, devise probable, jamais de doublon :
// relié à « Claude » pour Anthropic), Ignorer et Remettre, onglets avec leurs comptes, échec visible avec « Réessayer », puis « Choisir plusieurs » (Suivre, Ignorer, Remettre en groupe, Annuler,
// confirmation, refus visible).
// Projet jetable `test-fournisseurs-…`, supprimé à la fin.
// Usage : node app/scripts/verifier-fournisseurs.mjs   (build d'abord : cd app && npm run build)
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlSh = path.resolve(racineApp, '..', 'scripts', 'sql.sh')
const chercher = path.resolve(racineApp, '..', 'scripts', 'chercher-fournisseurs.py')
const CAPTURES = process.env.CAPTURES ?? '/tmp'
mkdirSync(CAPTURES, { recursive: true })
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4176)
const BASE = `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-fournisseurs-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }
const dossier = mkdtempSync(path.join(tmpdir(), 'cockpit-fourn-ecran-'))

const serveur = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

let projetId = null, navigateur = null
const session = (...args) => execFileSync('python3', ['-I', chercher, ...args, '--projet', SLUG], { encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'session_banc_ecran' } })
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  projetId = randomUUID()
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test fournisseurs (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-fournisseurs.mjs')`)
  sql(`insert into services (projet_id, nom, devise) values ('${projetId}', 'Claude', 'ILS')`)   // Anthropic doit se relier à lui, pas en créer un deuxième

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
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 20000 })
  await page.getByTestId('onglet-vue-couts').click()
  const bloc = page.getByTestId('recherche-fournisseurs')
  await bloc.waitFor({ timeout: 15000 })
  const etat = page.getByTestId('etat-recherche')
  await etat.waitFor({ timeout: 10000 })
  const ligne = (cle) => page.locator(`[data-testid="fournisseur"][data-cle="${cle}"]`)
  const carte = (nom) => page.locator(`[data-testid="service"][data-nom="${nom}"]`)
  const derniere = () => sql(`select statut, demandee_par, pris_par, trouves, nouveaux, note from recherches_fournisseurs where projet_id = '${projetId}' order by demandee_at desc limit 1`)[0]
  const attendreEtat = async (niveau, ms = 40000) => { await page.locator(`[data-testid="etat-recherche"][data-niveau="${niveau}"]`).waitFor({ timeout: ms }) }

  // --- 1. état vide
  verifie('état vide : le bloc explique la recherche par mots-clés et dit qu’il ne garde ni le contenu ni les pièces jointes',
    /Fournisseurs de factures/.test(await bloc.textContent()) && /par mots-clés \(facture, invoice, receipt, reçu…\)/.test(await bloc.textContent()) && /jamais le contenu de tes mails/.test(await bloc.textContent()))
  verifie('état vide : « Aucune recherche faite. », bouton « Chercher mes fournisseurs », la liste annonce qu’elle apparaîtra ici',
    await etat.getAttribute('data-niveau') === 'aucune' && /Aucune recherche faite\./.test(await etat.textContent()) && /Chercher mes fournisseurs/.test(await page.getByTestId('chercher-fournisseurs').textContent())
    && /la liste apparaîtra ici/.test(await page.getByTestId('fournisseurs-vide').textContent()))

  // --- 2. la demande
  await page.getByTestId('chercher-fournisseurs').click()
  await page.getByText(/Demande envoyée\. Claude la traite/).first().waitFor({ timeout: 10000 })
  await attendreEtat('attente')
  const d1 = derniere()
  verifie('un toucher = UNE demande en base, à ton nom, « en attente »', d1?.statut === 'en_attente' && d1.demandee_par === EMAIL && sql(`select count(*)::int n from recherches_fournisseurs where projet_id = '${projetId}'`)[0].n === 1, d1)
  verifie('l’écran dit « Demande envoyée », que Claude la traite dès qu’une session avec Gmail est ouverte ; le bouton est bloqué, « Annuler » apparaît',
    /Demande envoyée/.test(await etat.textContent()) && /dès qu’une session avec Gmail est ouverte/.test(await etat.textContent()) && await page.getByTestId('chercher-fournisseurs').isDisabled()
    && /Recherche demandée/.test(await page.getByTestId('chercher-fournisseurs').textContent()) && await page.getByTestId('annuler-recherche').isVisible())
  await page.screenshot({ path: `${CAPTURES}/fournisseurs-attente.png` })

  // --- 3. annuler
  await page.getByTestId('annuler-recherche').click()
  await page.getByText('Demande annulée.').first().waitFor({ timeout: 8000 })
  await attendreEtat('aucune')
  verifie('« Annuler la demande » : la base la passe « annulée », le bouton redevient « Chercher mes fournisseurs », l’écran le dit', derniere()?.statut === 'annulee' && !(await page.getByTestId('chercher-fournisseurs').isDisabled())
    && /Dernière demande annulée/.test(await etat.textContent()) && /Chercher mes fournisseurs/.test(await page.getByTestId('chercher-fournisseurs').textContent()) && await page.getByTestId('annuler-recherche').count() === 0)

  // --- 4. une session avec Gmail cherche (le vrai script) : l'écran se met à jour tout seul
  await page.getByTestId('chercher-fournisseurs').click()
  await attendreEtat('attente')
  session('--prendre')
  await attendreEtat('cours')
  verifie('quand la session prend la demande, l’écran passe à « Claude cherche… » sans recharger', /Claude cherche…/.test(await etat.textContent()) && derniere()?.statut === 'en_cours')
  const tsv = path.join(dossier, 'trouves.tsv')
  writeFileSync(tsv, [
    ['invoice+statements@mail.anthropic.com', '2026-10-02', 'Your receipt from Anthropic, PBC #1'], ['invoice+statements@mail.anthropic.com', '2026-09-02', 'Your receipt from Anthropic, PBC #2'],
    ['billing@vercel.com', '2026-10-09', 'Invoice'], ['billing@vercel.com', '2026-09-09', 'Invoice'], ['billing@vercel.com', '2026-08-09', 'Invoice'],
    ['facture@bezeq.co.il', '2026-09-01', 'חשבונית חודשית'],
    ['billing@render.com', '2026-10-05', 'Your Render invoice'],
    ['ami@gmail.com', '2026-08-02', 'Invoice du resto'],
  ].map((l) => l.join('\t')).join('\n') + '\n')
  session('--liste', tsv)
  await attendreEtat('ok')
  await page.getByTestId('fournisseurs-liste').waitFor({ timeout: 10000 })
  verifie('la liste arrive toute seule : « Dernière recherche », la note (fournisseurs, nouveaux, particuliers écartés), 4 fournisseurs « Nouveaux (4) », le particulier gmail absent',
    /Dernière recherche : /.test(await etat.textContent()) && /4 fournisseurs trouvés dont 4 nouveaux/.test(await etat.textContent()) && /1 de particuliers écartés/.test(await etat.textContent())
    && /Nouveaux \(4\)/.test(await page.getByTestId('onglet-fournisseur-nouveau').textContent()) && await page.getByTestId('fournisseur').count() === 4 && await ligne('gmail.com').count() === 0, await etat.textContent())
  verifie('chaque fournisseur : nom, expéditeur, nombre de mails et dernier mail, objet d’exemple ; Anthropic porte « Factures lues tout seul »',
    /Vercel/.test(await ligne('vercel.com').textContent()) && /billing@vercel\.com · 3 mails · dernier le 9 oct\. 2026/.test(await ligne('vercel.com').textContent()) && /« Invoice »/.test(await ligne('vercel.com').textContent())
    && /Factures lues tout seul/.test(await ligne('anthropic.com').textContent()) && await ligne('vercel.com').getByText('Factures lues tout seul').count() === 0, await ligne('vercel.com').textContent())
  verifie('le plus fréquent en premier (Vercel, 3 mails, avant Anthropic, 2)', (await page.getByTestId('fournisseur').first().getAttribute('data-cle')) === 'vercel.com')
  await page.getByTestId('fournisseurs-liste').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${CAPTURES}/fournisseurs-liste.png` })

  // --- 5. Suivre : prestataire créé (devise probable), jamais de doublon
  const avant = sql(`select count(*)::int n from services where projet_id = '${projetId}'`)[0].n
  await ligne('vercel.com').getByTestId('suivre-fournisseur').click()
  await page.getByText(/« Vercel » ajouté à tes prestataires \(devise USD/).first().waitFor({ timeout: 10000 })
  const vercel = sql(`select s.nom, s.devise, f.statut, f.service_id = s.id as lie from fournisseurs_detectes f join services s on s.id = f.service_id where f.projet_id = '${projetId}' and f.cle = 'vercel.com'`)[0]
  verifie('« Suivre » crée le prestataire « Vercel » (USD) et relie le fournisseur', vercel?.nom === 'Vercel' && vercel.devise === 'USD' && vercel.statut === 'suivi' && vercel.lie === true && sql(`select count(*)::int n from services where projet_id = '${projetId}'`)[0].n === avant + 1, vercel)
  await carte('Vercel').waitFor({ timeout: 10000 })
  verifie('le nouveau prestataire apparaît tout de suite dans « Prestataires du projet », les comptes des onglets suivent (Nouveaux 3, Suivis 1)',
    await carte('Vercel').count() === 1 && /Nouveaux \(3\)/.test(await page.getByTestId('onglet-fournisseur-nouveau').textContent()) && /Suivis \(1\)/.test(await page.getByTestId('onglet-fournisseur-suivi').textContent()))
  await ligne('bezeq.co.il').getByTestId('suivre-fournisseur').click()
  await page.getByText(/« Bezeq » ajouté à tes prestataires \(devise ILS/).first().waitFor({ timeout: 10000 })
  verifie('un domaine israélien est créé en shekels (ILS)', sql(`select devise from services where projet_id = '${projetId}' and nom = 'Bezeq'`)[0]?.devise === 'ILS')
  const avantAnthropic = sql(`select count(*)::int n from services where projet_id = '${projetId}'`)[0].n
  await ligne('anthropic.com').getByTestId('suivre-fournisseur').click()
  await page.getByText(/« Anthropic » relié au prestataire « Claude »/).first().waitFor({ timeout: 10000 })
  verifie('Anthropic est relié au prestataire « Claude » déjà là : aucun doublon créé', sql(`select count(*)::int n from services where projet_id = '${projetId}'`)[0].n === avantAnthropic
    && sql(`select s.nom from fournisseurs_detectes f join services s on s.id = f.service_id where f.projet_id = '${projetId}' and f.cle = 'anthropic.com'`)[0]?.nom === 'Claude')

  // --- 6. onglets, Ignorer, Remettre
  await page.getByTestId('onglet-fournisseur-suivi').click()
  verifie('onglet « Suivis (3) » : chacun dit son prestataire', await page.getByTestId('fournisseur').count() === 3 && /Prestataire : Claude/.test(await ligne('anthropic.com').textContent()) && /Prestataire : Vercel/.test(await ligne('vercel.com').textContent()))
  await page.getByTestId('onglet-fournisseur-nouveau').click()
  await ligne('render.com').getByTestId('ignorer-fournisseur').click()
  await page.getByText(/« Render » ignoré/).first().waitFor({ timeout: 8000 })
  await page.getByTestId('onglet-vide').waitFor({ timeout: 8000 })
  verifie('« Ignorer » : le fournisseur quitte « Nouveaux » (état vide « Aucun nouveau fournisseur. ») et passe en base « ignoré »',
    /Aucun nouveau fournisseur\./.test(await page.getByTestId('onglet-vide').textContent()) && sql(`select statut from fournisseurs_detectes where projet_id = '${projetId}' and cle = 'render.com'`)[0].statut === 'ignore')
  await page.getByTestId('onglet-fournisseur-ignore').click()
  verifie('onglet « Ignorés (1) » : Render, avec « Remettre dans la liste »', await page.getByTestId('fournisseur').count() === 1 && await ligne('render.com').getByTestId('remettre-fournisseur').isVisible())
  await ligne('render.com').getByTestId('remettre-fournisseur').click()
  await page.getByText(/« Render » remis dans « Nouveaux »/).first().waitFor({ timeout: 8000 })
  await page.getByTestId('onglet-vide').waitFor({ timeout: 8000 })
  verifie('« Remettre dans la liste » : défait l’ignorance (l’onglet « Ignorés » est vide, avec son message)', /Aucun fournisseur ignoré\./.test(await page.getByTestId('onglet-vide').textContent()) && sql(`select statut from fournisseurs_detectes where projet_id = '${projetId}' and cle = 'render.com'`)[0].statut === 'nouveau')

  // --- 7. une nouvelle recherche garde les décisions
  await page.getByTestId('onglet-fournisseur-nouveau').click()
  await page.getByTestId('chercher-fournisseurs').click()
  await attendreEtat('attente')
  session('--prendre')
  writeFileSync(tsv, [['billing@vercel.com', '2026-10-09', 'Invoice'], ['billing@vercel.com', '2026-09-09', 'Invoice'], ['billing@vercel.com', '2026-08-09', 'Invoice'], ['billing@vercel.com', '2026-07-09', 'Invoice'],
    ['billing@notion.so', '2026-10-01', 'Your Notion invoice']].map((l) => l.join('\t')).join('\n') + '\n')
  session('--liste', tsv)
  await attendreEtat('ok')
  await page.getByTestId('fournisseur').first().waitFor({ timeout: 10000 })
  verifie('« Actualiser la recherche » : un fournisseur suivi le reste (compte de mails à jour : 4), seul le nouveau (Notion) apparaît dans « Nouveaux »',
    sql(`select statut, mails from fournisseurs_detectes where projet_id = '${projetId}' and cle = 'vercel.com'`)[0].statut === 'suivi' && sql(`select mails from fournisseurs_detectes where projet_id = '${projetId}' and cle = 'vercel.com'`)[0].mails === 4
    && await ligne('notion.so').count() === 1 && /Notion/.test(await ligne('notion.so').textContent()) && /dont 1 nouveau /.test(await etat.textContent()), await etat.textContent())

  // --- 8. échec visible, « Réessayer »
  await page.getByTestId('chercher-fournisseurs').click()
  await attendreEtat('attente')
  session('--echec', 'Gmail inaccessible : aucun outil de messagerie dans cette session')
  await attendreEtat('echec')
  verifie('un échec se voit (alerte rouge) avec la raison ; le bouton propose « Réessayer la recherche »', await etat.getAttribute('role') === 'alert' && /a échoué/.test(await etat.textContent()) && /Gmail inaccessible/.test(await etat.textContent())
    && /Réessayer la recherche/.test(await page.getByTestId('chercher-fournisseurs').textContent()) && !(await page.getByTestId('chercher-fournisseurs').isDisabled()))
  await page.getByTestId('chercher-fournisseurs').click()
  await attendreEtat('attente')
  verifie('« Réessayer » repose une demande (en attente)', derniere()?.statut === 'en_attente')
  await page.screenshot({ path: `${CAPTURES}/fournisseurs-ecran.png`, fullPage: false })

  // --- 9. « Choisir plusieurs » : ignorer / suivre / remettre EN GROUPE (24 lignes une par une, ce n'est pas utilisable sur un téléphone)
  sql(`insert into fournisseurs_detectes (projet_id, cle, nom, domaine, expediteur, mails) values
    ('${projetId}', 'banque-test.fr', 'Banque Test', 'banque-test.fr', 'noreply@banque-test.fr', 6),
    ('${projetId}', 'virements-test.com', 'Virements Test', 'virements-test.com', 'noreply@virements-test.com', 5),
    ('${projetId}', 'plateforme-test.com', 'Plateforme Test', 'plateforme-test.com', 'billing@plateforme-test.com', 4),
    ('${projetId}', 'cabinet-test.co.il', 'Cabinet Test', 'cabinet-test.co.il', 'compta@cabinet-test.co.il', 3)`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 20000 })
  await page.getByTestId('onglet-vue-couts').click()
  await page.getByTestId('fournisseurs-liste').waitFor({ timeout: 15000 })
  await page.getByTestId('onglet-fournisseur-nouveau').waitFor({ timeout: 15000 })
  const lot = (nom) => page.getByTestId(`lot-${nom}`)
  const nbChoisis = async () => (await page.getByTestId('nb-choisis').textContent()).trim()
  const attendreCompte = (o, texte) => page.getByTestId(`onglet-fournisseur-${o}`).filter({ hasText: texte }).waitFor({ timeout: 10000 })
  const nbOnglet = async (o) => (await page.getByTestId(`onglet-fournisseur-${o}`).textContent()).replace(/\s+/g, ' ').trim()
  const statutsDe = (cles) => Object.fromEntries(sql(`select cle, statut from fournisseurs_detectes where projet_id = '${projetId}' and cle in (${cles.map((c) => `'${c}'`).join(',')})`).map((r) => [r.cle, r.statut]))
  const services = () => sql(`select nom, devise from services where projet_id = '${projetId}' order by nom`)
  await page.getByTestId('onglet-fournisseur-suivi').click()
  const sansLotDansSuivis = await page.getByTestId('choisir-plusieurs').count() === 0
  await page.getByTestId('onglet-fournisseur-nouveau').click()
  verifie('« Choisir plusieurs » est proposé dans « Nouveaux (6) » mais pas dans « Suivis » (un fournisseur suivi est déjà un prestataire)', sansLotDansSuivis && /Nouveaux \(6\)/.test(await nbOnglet('nouveau')) && await page.getByTestId('choisir-plusieurs').isVisible(), await nbOnglet('nouveau'))
  await page.getByTestId('choisir-plusieurs').click()
  verifie('mode choisir : une case par ligne (6), les boutons Suivre / Ignorer de chaque ligne disparaissent (une étape à la fois), la barre apparaît avec « 0 choisi » et des boutons éteints',
    await page.getByTestId('cocher-fournisseur').count() === 6 && await page.getByTestId('suivre-fournisseur').count() === 0 && await page.getByTestId('ignorer-fournisseur').count() === 0
    && await page.getByTestId('barre-fournisseurs').isVisible() && (await nbChoisis()) === '0 choisi' && await lot('suivre').isDisabled() && await lot('ignorer').isDisabled())
  await ligne('banque-test.fr').getByTestId('cocher-fournisseur').check()
  await ligne('virements-test.com').getByTestId('cocher-fournisseur').check()
  verifie('2 lignes cochées : « 2 choisis », les boutons disent le nombre (« Suivre (2) », « Ignorer (2) »)',
    (await nbChoisis()) === '2 choisis' && /Suivre \(2\)/.test(await lot('suivre').textContent()) && /Ignorer \(2\)/.test(await lot('ignorer').textContent()) && !(await lot('ignorer').isDisabled()))
  await page.screenshot({ path: `${CAPTURES}/fournisseurs-choisir.png` })
  await lot('ignorer').click()
  await page.getByText(/2 fournisseurs ignorés : ils ne reviendront pas dans « Nouveaux »/).first().waitFor({ timeout: 8000 })
  await attendreCompte('nouveau', 'Nouveaux (4)')
  verifie('« Ignorer (2) » : les deux passent « ignoré » EN UNE FOIS, quittent « Nouveaux (4) », la sélection est vidée et le mode choisir reste',
    JSON.stringify(statutsDe(['banque-test.fr', 'virements-test.com'])) === '{"banque-test.fr":"ignore","virements-test.com":"ignore"}' && /Nouveaux \(4\)/.test(await nbOnglet('nouveau'))
    && (await nbChoisis()) === '0 choisi' && await page.getByTestId('cocher-fournisseur').count() === 4, await nbOnglet('nouveau'))
  await page.locator('[role="status"]').getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.getByText(/Annulé : ils sont revenus dans la liste d’avant/).first().waitFor({ timeout: 8000 })
  await attendreCompte('nouveau', 'Nouveaux (6)')
  verifie('« Annuler » (le message dure 8 s) : les deux sont revenus « nouveau », « Nouveaux (6) »',
    JSON.stringify(statutsDe(['banque-test.fr', 'virements-test.com'])) === '{"banque-test.fr":"nouveau","virements-test.com":"nouveau"}' && /Nouveaux \(6\)/.test(await nbOnglet('nouveau')), await nbOnglet('nouveau'))

  // un refus du serveur : message visible, la sélection reste, rien n'est changé ; puis ça repasse quand le refus cesse
  await ligne('banque-test.fr').getByTestId('cocher-fournisseur').check()
  await ligne('virements-test.com').getByTestId('cocher-fournisseur').check()
  await page.route(/\/rest\/v1\/fournisseurs_detectes/, async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'refus de test' }) })
    else await route.fallback()
  })
  await lot('ignorer').click()
  await page.getByText(/refus de test/).first().waitFor({ timeout: 8000 })
  verifie('un refus du serveur : le message est visible, rien n’est changé en base, les 2 lignes restent cochées (on peut réessayer)',
    JSON.stringify(statutsDe(['banque-test.fr', 'virements-test.com'])) === '{"banque-test.fr":"nouveau","virements-test.com":"nouveau"}' && (await nbChoisis()) === '2 choisis' && !(await lot('ignorer').isDisabled()))
  await page.unroute(/\/rest\/v1\/fournisseurs_detectes/)
  await lot('ignorer').click()
  await page.getByText(/2 fournisseurs ignorés/).first().waitFor({ timeout: 8000 })
  await attendreCompte('nouveau', 'Nouveaux (4)')
  verifie('le refus levé, « Ignorer (2) » passe : « Nouveaux (4) » (Render, Notion, Plateforme, Cabinet)', /Nouveaux \(4\)/.test(await nbOnglet('nouveau')) && JSON.stringify(statutsDe(['banque-test.fr'])) === '{"banque-test.fr":"ignore"}')

  // « Tout choisir » + « Suivre (4) » : une confirmation qui nomme les fournisseurs, annulable ; puis les prestataires sont créés (devise probable) sans doublon
  await lot('suivre').waitFor({ timeout: 5000 })
  await page.getByTestId('tout-choisir').click()
  verifie('« Tout choisir » coche toute la liste (« 4 choisis »), le bouton devient « Aucun »', (await nbChoisis()) === '4 choisis' && /Aucun/.test(await page.getByTestId('tout-choisir').textContent()) && /Suivre \(4\)/.test(await lot('suivre').textContent()))
  const avantLot = services().length
  await lot('suivre').click()
  const dialogue = page.getByRole('dialog')
  await dialogue.waitFor({ timeout: 8000 })
  const texteDialogue = await dialogue.textContent()
  verifie('« Suivre (4) » demande confirmation : titre « Suivre 4 fournisseurs ? », elle nomme les 4 fournisseurs et dit que ça crée des prestataires',
    /Suivre 4 fournisseurs \?/.test(texteDialogue) && /Render/.test(texteDialogue) && /Notion/.test(texteDialogue) && /Plateforme Test/.test(texteDialogue) && /Cabinet Test/.test(texteDialogue) && /prestataire de Coûts/.test(texteDialogue), texteDialogue)
  await dialogue.getByRole('button', { name: 'Annuler', exact: true }).click()
  await page.waitForTimeout(600)
  verifie('« Annuler » dans la confirmation : aucun prestataire créé, la sélection reste (4 choisis)', services().length === avantLot && (await nbChoisis()) === '4 choisis' && JSON.stringify(statutsDe(['render.com'])) === '{"render.com":"nouveau"}')
  await lot('suivre').click()
  await dialogue.waitFor({ timeout: 8000 })
  await dialogue.getByRole('button', { name: /Suivre \(4\)/ }).click()
  await page.getByText(/4 fournisseurs suivis \(4 prestataires créés\)/).first().waitFor({ timeout: 20000 })
  const crees = Object.fromEntries(services().map((x) => [x.nom, x.devise]))
  verifie('« Suivre (4) » confirmé : 4 prestataires créés (Render et Notion en USD, Plateforme Test en USD, Cabinet Test en ILS : domaine israélien), les 4 fournisseurs passent « suivi » et reliés',
    services().length === avantLot + 4 && crees['Render'] === 'USD' && crees['Notion'] === 'USD' && crees['Plateforme Test'] === 'USD' && crees['Cabinet Test'] === 'ILS'
    && sql(`select count(*)::int n from fournisseurs_detectes where projet_id = '${projetId}' and cle in ('render.com','notion.so','plateforme-test.com','cabinet-test.co.il') and statut = 'suivi' and service_id is not null`)[0].n === 4, crees)
  await page.getByTestId('onglet-vide').waitFor({ timeout: 8000 })
  verifie('liste « Nouveaux » vide : son message, la barre d’actions disparaît toute seule, les nouveaux prestataires sont dans la page',
    /Aucun nouveau fournisseur\./.test(await page.getByTestId('onglet-vide').textContent()) && await page.getByTestId('barre-fournisseurs').count() === 0 && await carte('Cabinet Test').count() === 1)

  // « Ignorés » : « Remettre dans la liste » en groupe
  await page.getByTestId('onglet-fournisseur-ignore').click()
  await page.getByTestId('choisir-plusieurs').click()
  await page.getByTestId('tout-choisir').click()
  verifie('onglet « Ignorés » : une seule action groupée, « Remettre dans la liste (2) »', await lot('remettre').count() === 1 && await lot('suivre').count() === 0 && /Remettre dans la liste \(2\)/.test(await lot('remettre').textContent()), await page.getByTestId('barre-fournisseurs').textContent())
  await lot('remettre').click()
  await page.getByText(/2 fournisseurs remis dans « Nouveaux »/).first().waitFor({ timeout: 8000 })
  await attendreCompte('ignore', 'Ignorés (0)')
  verifie('« Remettre dans la liste (2) » : les deux reviennent « nouveau » en une fois, l’onglet « Ignorés » est vide et la barre disparaît',
    JSON.stringify(statutsDe(['banque-test.fr', 'virements-test.com'])) === '{"banque-test.fr":"nouveau","virements-test.com":"nouveau"}' && /Ignorés \(0\)/.test(await nbOnglet('ignore')) && await page.getByTestId('barre-fournisseurs').count() === 0)
  await page.getByTestId('onglet-fournisseur-nouveau').click()
  await page.getByTestId('choisir-plusieurs').click()
  await page.getByTestId('terminer-choix').click()
  verifie('« Terminer » quitte le mode choisir : plus de cases, plus de barre, les boutons de chaque ligne reviennent', await page.getByTestId('cocher-fournisseur').count() === 0 && await page.getByTestId('barre-fournisseurs').count() === 0 && await page.getByTestId('suivre-fournisseur').count() === 2)
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
  try { console.log(`    état : ${await (await navigateur?.contexts()[0]?.pages()[0])?.getByTestId('recherche-fournisseurs').textContent()}`.slice(0, 700)) } catch {}
} finally {
  try {
    if (projetId) {
      await purgerProjetsDeTest(sql, [projetId], PREFIXE)
      const restes = sql(`select (select count(*) from projets where slug = '${SLUG}')::int p, (select count(*) from recherches_fournisseurs where projet_id = '${projetId}')::int r, (select count(*) from fournisseurs_detectes where projet_id = '${projetId}')::int f, (select count(*) from services where projet_id = '${projetId}')::int s`)[0]
      verifie('nettoyage : projet jetable, demandes, fournisseurs et prestataires supprimés', restes.p === 0 && restes.r === 0 && restes.f === 0 && restes.s === 0, restes)
    }
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  rmSync(dossier, { recursive: true, force: true })
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-fournisseurs : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
