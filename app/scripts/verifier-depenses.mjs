// Coûts du projet (0052, chantier 41127de1), parcours COMPLET sur écran de téléphone : état vide,
// prestataire (ajout, lien, solde bas), dépense avec facture jointe, périodes, sélection multiple,
// envoi à la compta (pas de partage de fichiers dans ce navigateur : marche manuelle, marquage explicite),
// suppression avec confirmation. Projet jetable `test-depenses-…`, supprimé à la fin.
// Usage : node app/scripts/verifier-depenses.mjs   (build d'abord : cd app && npm run build)
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
const PORT = Number(process.env.PORT ?? 4175)
const BASE = `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-depenses-'
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
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test dépenses (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-depenses.mjs')`)
  moiId = sql(`select id from auth.users where email = '${esc(EMAIL)}'`)[0]?.id ?? null

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
  const attendre = (ms) => page.waitForTimeout(ms)
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 20000 })
  await page.getByTestId('onglet-vue-couts').click()
  await page.getByTestId('couts-projet').waitFor({ timeout: 15000 })

  // --- 1. état vide
  verifie('état vide : « Aucun prestataire » et « Aucune dépense enregistrée »', /Aucun prestataire/.test(await page.getByTestId('services').textContent()) && /Aucune dépense enregistrée/.test(await page.getByTestId('depenses').textContent()))
  verifie('état vide : « Envoyer à la compta (0) » désactivé, pas de destinataire', await page.getByTestId('envoyer-compta').isDisabled() && /Aucun destinataire réglé/.test(await page.getByTestId('compta').textContent()))

  // --- 2. prestataire avec solde sous le seuil
  await page.getByTestId('service-ajouter').click()
  await page.getByRole('button', { name: 'RunPod', exact: true }).click()
  await page.getByLabel('Tableau de bord (lien)').fill('https://console.runpod.io/serverless')
  await page.getByLabel('Page des factures (lien)').fill('http://pas-https.example')
  verifie('lien non https refusé avec message', /commencer par https/.test(await page.getByRole('alert').textContent()) && await page.getByRole('button', { name: 'Enregistrer' }).isDisabled())
  await page.getByLabel('Page des factures (lien)').fill('https://console.runpod.io/user/billing')
  await page.getByLabel('Solde', { exact: true }).fill('4,5')
  await page.getByLabel('Alerte sous').fill('10')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByTestId('service').first().waitFor({ timeout: 10000 })
  const svc = page.getByTestId('service').first()
  verifie('prestataire créé : liens directs vers le tableau de bord et les factures', await svc.getByRole('link', { name: /Tableau de bord/ }).getAttribute('href') === 'https://console.runpod.io/serverless' && await svc.getByRole('link', { name: /Factures/ }).count() === 1)
  verifie('solde 4,50 sous le seuil de 10 : alerte visible', await svc.getByTestId('solde').getAttribute('data-bas') === 'true' && /recharge/.test(await svc.getByTestId('solde').textContent()))

  // --- 3. dépenses : deux factures (une avec pièce), une consommation, une recharge
  const ajouter = async ({ type, montant, date, ref, fichier }) => {
    await page.getByTestId('depense-ajouter').click()
    await page.getByLabel('Type').selectOption(type)
    await page.getByLabel('Montant').fill(montant)
    await page.getByLabel('Date').fill(date)
    if (ref) await page.getByLabel('N° de facture (facultatif)').fill(ref)
    if (fichier) { await page.getByTestId('depense-fichier').setInputFiles({ name: 'facture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }); await page.getByText('facture.pdf').first().waitFor({ timeout: 15000 }) }
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  }
  await page.getByTestId('depense-ajouter').click()
  await page.getByLabel('Montant').fill('abc')
  verifie('montant invalide refusé avec message', /Montant/.test(await page.getByRole('alert').textContent()) && await page.getByRole('button', { name: 'Enregistrer' }).isDisabled())
  await page.getByRole('button', { name: 'Annuler' }).click()
  await ajouter({ type: 'facture', montant: '12,5', date: '2026-10-05', ref: 'INV-1', fichier: true })
  await ajouter({ type: 'facture', montant: '7.3', date: '2026-10-06' })
  await ajouter({ type: 'consommation', montant: '2', date: '2026-09-15' })
  await ajouter({ type: 'recharge', montant: '100', date: '2026-10-01' })
  await page.getByTestId('depense').first().waitFor({ timeout: 10000 })
  await attendre(800)
  verifie('4 lignes enregistrées en base', sql(`select count(*)::int n from depenses where projet_id = '${projetId}'`)[0].n === 4)
  await page.getByRole('button', { name: 'Mois', exact: true }).click()
  const octobre = page.locator('[data-testid="periode-paquet"][data-cle="2026-10"]')
  verifie('vue mensuelle : octobre = 12,50 + 7,30 = 19,80 $ (la recharge de 100 n’est pas un coût)', /19,80/.test(await octobre.getByTestId('total-periode').textContent()), await octobre.getByTestId('total-periode').textContent())
  await page.getByRole('button', { name: 'Année', exact: true }).click()
  verifie('vue annuelle : 2026 = 21,80 $', /21,80/.test(await page.getByTestId('periode-paquet').first().getByTestId('total-periode').textContent()))
  await page.getByRole('button', { name: 'Jour', exact: true }).click()
  verifie('vue journalière : un paquet par date (4)', await page.getByTestId('periode-paquet').count() === 4)
  await page.getByRole('button', { name: 'Mois', exact: true }).click()
  await attendre(1200)
  verifie('le choix de période est retenu (préférence en base)', moiId ? sql(`select valeur::text v from preferences where user_id = '${moiId}' and cle = 'periode_couts'`)[0]?.v === '"mois"' : true)
  await page.screenshot({ path: `${CAPTURES}/depenses.png`, fullPage: true })

  // --- 4. téléchargement de la pièce : lien signé
  const dl = page.getByRole('button', { name: /Télécharger facture\.pdf/ })
  verifie('la facture jointe a son bouton « Télécharger »', await dl.count() === 1)
  const [telecharge] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), dl.click()])
  verifie('le téléchargement livre le fichier « facture.pdf » (lien signé)', !!telecharge && telecharge.suggestedFilename() === 'facture.pdf' && /storage\/v1\/object\/sign\//.test(telecharge.url()), telecharge?.url())

  // --- 5. envoi à la compta : sélection multiple, aperçu, marche manuelle, marquage explicite
  await page.getByRole('button', { name: /Tout sélectionner \(2\)/ }).click()
  verifie('sélection multiple : « Envoyer à la compta (2) » actif', await page.getByTestId('envoyer-compta').isEnabled() && /\(2\)/.test(await page.getByTestId('envoyer-compta').textContent()))
  await page.getByTestId('envoyer-compta').click()
  const resume = await page.getByTestId('resume-compta').textContent()
  verifie('aperçu : prestataire, réf., total, pièce manquante signalée', /INV-1/.test(resume) && /RunPod/.test(resume) && /pas de pièce jointe/.test(resume) && /Total/.test(resume), resume)
  await page.getByTestId('partager').click()
  await page.getByTestId('marquer-envoye').waitFor({ timeout: 20000 })
  verifie('sans partage de fichiers : marche manuelle, rien marqué avant ton geste', sql(`select count(*)::int n from depenses where projet_id = '${projetId}' and compta_statut = 'envoye'`)[0].n === 0)
  await page.getByTestId('marquer-envoye').click()
  await page.getByText(/Envoyée à la compta/).first().waitFor({ timeout: 10000 })
  await attendre(800)
  verifie('signe de traitement : 2 factures « envoyée à la compta » (base + écran)', sql(`select count(*)::int n from depenses where projet_id = '${projetId}' and compta_statut = 'envoye' and compta_at is not null and compta_par is not null`)[0].n === 2 && await page.getByText(/Envoyée à la compta/).count() >= 2)
  verifie('plus rien à envoyer : bouton désactivé', await page.getByTestId('envoyer-compta').isDisabled())

  // --- 6. remettre à envoyer, supprimer avec confirmation
  await page.getByRole('button', { name: 'Remettre à envoyer' }).first().click()
  await page.getByText(/Remise dans « À envoyer »/).waitFor({ timeout: 8000 })
  verifie('remise à envoyer : 1 facture envoyée restante', sql(`select count(*)::int n from depenses where projet_id = '${projetId}' and compta_statut = 'envoye'`)[0].n === 1)
  await page.getByRole('button', { name: 'Supprimer la dépense' }).first().click()
  verifie('suppression : confirmation d’abord, rien supprimé', await page.getByRole('button', { name: 'Supprimer', exact: true }).isVisible() && sql(`select count(*)::int n from depenses where projet_id = '${projetId}'`)[0].n === 4)
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await page.getByText('Dépense supprimée.').waitFor({ timeout: 8000 })
  verifie('suppression confirmée : 3 lignes restent', sql(`select count(*)::int n from depenses where projet_id = '${projetId}'`)[0].n === 3)

  // --- 7. destinataire
  await page.getByRole('button', { name: /Destinataire/ }).click()
  await page.getByLabel('Adresse e-mail').fill('pas-une-adresse')
  verifie('destinataire e-mail invalide refusé', /invalide/.test(await page.getByRole('alert').textContent()) && await page.getByRole('button', { name: 'Enregistrer' }).isDisabled())
  await page.getByLabel('Adresse e-mail').fill('compta@exemple.test')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByText('Destinataire de la compta enregistré.').waitFor({ timeout: 8000 })
  await page.getByText('compta@exemple.test').first().waitFor({ timeout: 8000 }).catch(() => {})
  verifie('destinataire enregistré en base', sql(`select compta_destinataire d from projets where id = '${projetId}'`)[0].d === 'compta@exemple.test')
  verifie('destinataire affiché dans le bloc Compta', /compta@exemple\.test/.test(await page.getByTestId('compta').textContent()), await page.getByTestId('compta').textContent())

  // --- 8. supprimer le prestataire : ses dépenses restent
  await page.getByRole('button', { name: /Supprimer RunPod/ }).click()
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await page.getByText(/« RunPod » supprimé/).waitFor({ timeout: 8000 })
  verifie('prestataire supprimé, dépenses gardées « sans prestataire »', sql(`select count(*)::int n from services where projet_id = '${projetId}'`)[0].n === 0 && sql(`select count(*)::int n from depenses where projet_id = '${projetId}' and service_id is null`)[0].n === 3)
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    if (projetId) {
      const h2 = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
      const objets = sql(`select name from storage.objects where bucket_id = 'cockpit-medias' and name like '${projetId}/%'`).map((r) => r.name)
      if (objets.length) await fetch(`${API}/storage/v1/object/cockpit-medias`, { method: 'DELETE', headers: h2, body: JSON.stringify({ prefixes: objets }) })
      await purgerProjetsDeTest(sql, [projetId], PREFIXE)
      const reste = sql(`select count(*)::int as n from projets where slug = '${SLUG}'`)[0].n
      const restes = sql(`select count(*)::int as n from depenses where projet_id = '${projetId}'`)[0].n
      verifie('nettoyage : projet jetable et dépenses supprimés', reste === 0 && restes === 0)
    }
    if (moiId) sql(`delete from preferences where user_id = '${moiId}' and cle = 'periode_couts'`)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-depenses : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
