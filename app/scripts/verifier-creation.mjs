// Création d'un chantier proche d'un autre (0060, chantier 69f1650e), parcours sur écran de téléphone :
// « Ça existe déjà » vient de la règle de la fusion suggérée (chantiers_proches_creation), « Compléter
// celui-ci » ajoute les mots tapés à la demande existante sans créer de chantier, « Fusionner » garde les
// DEUX demandes dans un seul chantier, le bouton principal devient « Créer quand même », et sans titre
// proche tout redevient « Créer ». Projet jetable `test-creation-…`, supprimé à la fin. Court (~1 min).
// Usage : node app/scripts/verifier-creation.mjs   (build d'abord : cd app && npm run build)
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
const PREFIXE = 'test-creation-'
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
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test création (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-creation.mjs')`)
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
  const panneau = page.getByTestId('bulle-aide-panneau')

    const un = randomUUID(), deux = randomUUID()
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values ('${un}', '${projetId}', 'Notifications push du téléphone', 'Demande de départ du chantier existant.', 'libre')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values ('${deux}', '${projetId}', 'Mode sombre illisible', 'Autre sujet.', 'libre')`)
  const nChantiers = () => Number(sql(`select count(*) as n from chantiers where projet_id = '${projetId}'`)[0].n)
  const toast = (re) => page.getByRole('status').getByText(re).first().waitFor({ timeout: 10000 }).then(() => true, () => false)
  const ouvrir = async () => { await page.getByTestId('nouveau-chantier').click(); await page.getByTestId('titre').waitFor({ timeout: 8000 }) }
  const scrollX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const dlg = () => page.getByRole('dialog').filter({ hasText: 'Nouveau chantier' })

  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 20000 })
  await ouvrir()

  // 1. Titre sans rapport : rien n'est proposé, « Créer ».
  await page.getByTestId('titre').fill('Zèbre quantique')
  await page.waitForTimeout(1200)
  verifie('titre sans rapport : aucune suggestion, bouton « Créer »', await page.getByTestId('ca-existe-deja').count() === 0 && (await page.getByTestId('creer-chantier').textContent()).trim() === 'Créer')

  // 2. Titre proche : la suggestion (règle de la base), avec ses deux gestes.
  await page.getByTestId('titre').fill('Notification push sur téléphone')
  await page.getByTestId('ca-existe-deja').waitFor({ timeout: 8000 }).catch(() => {})
  verifie('titre proche : le chantier existant est proposé (une seule ligne, pas le cousin)', await page.getByTestId('proche').count() === 1 && /Notifications push du téléphone/.test(await page.getByTestId('proche').textContent()))
  verifie('« Compléter celui-ci » et « Fusionner » sont là, le bouton principal devient « Créer quand même »', await page.getByTestId('completer-proche').isVisible() && await page.getByTestId('fusionner-proche').isVisible() && (await page.getByTestId('creer-chantier').textContent()).trim() === 'Créer quand même')
  const bx = await page.getByTestId('completer-proche').boundingBox()
  verifie('téléphone : les boutons tiennent dans l’écran, aucun défilement horizontal', !!bx && bx.x >= 0 && bx.x + bx.width <= 390 && (await scrollX()) <= 0, { bx, sx: await scrollX() })
  await page.screenshot({ path: `${CAPTURES}/creation-proche.png` })

  // 3. Compléter : confirmation, toast, demande complétée, aucun chantier créé, fenêtre fermée.
  await page.getByTestId('demande').fill('Mots ajoutés par compléter.')
  const avant = nChantiers()
  await page.getByTestId('completer-proche').click()
  const dc = page.getByRole('dialog').filter({ hasText: 'Compléter ce chantier' })
  await dc.waitFor({ timeout: 5000 })
  verifie('compléter : la confirmation dit que rien n’est créé', /Aucun nouveau chantier/.test(await dc.textContent()))
  await dc.getByRole('button', { name: 'Annuler' }).click()
  verifie('compléter, « Annuler » : rien n’a changé', nChantiers() === avant && !/Mots ajoutés/.test(sql(`select demande from chantiers where id = '${un}'`)[0].demande))
  await page.getByTestId('completer-proche').click()
  await dc.waitFor({ timeout: 5000 })
  await dc.getByRole('button', { name: 'Compléter' }).click()
  verifie('compléter : toast de réussite', await toast(/complété/))
  const d1 = sql(`select demande from chantiers where id = '${un}'`)[0].demande
  verifie('compléter : la demande existante est gardée ET les mots tapés sont ajoutés, aucun chantier créé', d1.startsWith('Demande de départ du chantier existant.') && d1.includes('Mots ajoutés par compléter.') && nChantiers() === avant, d1)
  verifie('compléter : la fenêtre se ferme', await page.getByTestId('titre').count() === 0)

  // 4. Fusionner : le chantier tapé est archivé en doublon, les deux demandes vivent dans le gardé.
  await ouvrir()
  await page.getByTestId('titre').fill('Notification push sur téléphone')
  await page.getByTestId('demande').fill('Mots du doublon tapé.')
  await page.getByTestId('fusionner-proche').waitFor({ timeout: 8000 })
  await page.getByTestId('fusionner-proche').click()
  const df = page.getByRole('dialog').filter({ hasText: 'Fusionner avec ce chantier' })
  await df.waitFor({ timeout: 5000 })
  await df.getByRole('button', { name: 'Fusionner' }).click()
  verifie('fusionner : toast « les deux demandes sont gardées »', await toast(/les deux demandes sont gardées/))
  const d2 = sql(`select demande from chantiers where id = '${un}'`)[0].demande
  const dbl = sql(`select titre, demande, archived_at, doublon_de from chantiers where doublon_de = '${un}'`)
  verifie('fusionner : le chantier gardé porte la demande de départ, le complément ET celle du doublon', d2.includes('Demande de départ') && d2.includes('Mots ajoutés par compléter.') && d2.includes('Mots du doublon tapé.'), d2)
  verifie('fusionner : le doublon tapé est archivé, relié, et garde sa demande', dbl.length === 1 && !!dbl[0].archived_at && dbl[0].demande === 'Mots du doublon tapé.', dbl)

  // 5. Créer quand même : un vrai nouveau chantier.
  await ouvrir()
  await page.getByTestId('titre').fill('Notification push sur téléphone')
  await page.getByTestId('ca-existe-deja').waitFor({ timeout: 8000 })
  const avant5 = nChantiers()
  await page.getByTestId('creer-chantier').click()
  verifie('« Créer quand même » : toast de création', await toast(/créé/))
  verifie('« Créer quand même » : un chantier de plus', nChantiers() === avant5 + 1, { avant5, apres: nChantiers() })

  // 6. Titre court : pas de recherche (rien de proposé), erreur du serveur : message sobre, la création reste possible.
  await ouvrir()
  await page.getByTestId('titre').fill('No')
  await page.waitForTimeout(900)
  verifie('titre trop court : aucune suggestion', await page.getByTestId('ca-existe-deja').count() === 0)
  await page.route(/chantiers_proches_creation/, (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'panne simulée' }) }))
  await page.getByTestId('titre').fill('Notification push sur téléphone encore')
  await page.getByTestId('proches-erreur').waitFor({ timeout: 8000 }).catch(() => {})
  verifie('recherche en panne : message sobre, « Créer » reste utilisable', await page.getByTestId('proches-erreur').isVisible().catch(() => false) && await page.getByTestId('creer-chantier').isEnabled())
  await page.screenshot({ path: `${CAPTURES}/creation-erreur.png` })
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    if (projetId) await purgerProjetsDeTest(sql, [projetId], PREFIXE)
    const reste = sql(`select count(*)::int as n from projets where slug = '${SLUG}'`)[0].n
    verifie('nettoyage : le projet jetable est supprimé', reste === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-creation : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
