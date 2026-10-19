// Statuer un chantier ou une carte : les compteurs et les listes bougent TOUT DE SUITE, sur écran de téléphone (chantier fa297cc4, 19 oct. 2026).
// Raphaël : « lorsque je statue une tâche, qu'elle soit à lancer, à tester ou n'importe quoi, elle ne repart pas bien dans les compteurs […]
// pareil pour l'action à faire : elle reste statique ».
// Prouve, sur un projet jetable `test-statuts-…`, avec une écriture VOLONTAIREMENT retardée de 8 s (le compteur doit bouger avant sa réponse) :
//   - « Ça marche » : « à tester » 1 → 0 et « fini » 0 → 1 pendant que l'écriture est encore en route ; la base finit bien « valide » ;
//   - « Ça bloque » sur une carte d'action : « pour toi » 1 → 0 sur-le-champ, le chantier passe du côté de Claude (« pour Claude » 0 → 1) ;
//   - quand Claude répond dans le fil sans fermer la carte, elle revient dans « pour toi » ;
//   - « Ça ne marche pas » : « à tester » 1 → 0 sur-le-champ ;
//   - écriture refusée : le chantier revient où il était, avec un message (jamais un compteur faux) ;
//   - aucune erreur JavaScript, projet jetable supprimé.
// Usage : node app/scripts/verifier-statuts-ecran.mjs   (build d'abord : cd app && npm run build)
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlSh = path.resolve(racineApp, '..', 'scripts', 'sql.sh')
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4177)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-statuts-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const RETARD_MS = 8000
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

const ids = { projet: randomUUID() }
let navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${ids.projet}', '${SLUG}', 'Test statuts (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-statuts-ecran.mjs')`)
  const livre = randomUUID(), livre2 = randomUUID(), refuse = randomUUID(), avecAction = randomUUID()
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, livre_at) values ('${livre}', '${ids.projet}', 'Livré à certifier', 'Test.', 'a_verifier', now() - interval '1 day')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, livre_at) values ('${livre2}', '${ids.projet}', 'Livré qui ne marche pas', 'Test.', 'a_verifier', now() - interval '2 days')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, livre_at) values ('${refuse}', '${ids.projet}', 'Livré, écriture refusée', 'Test.', 'a_verifier', now() - interval '3 days')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values ('${avecAction}', '${ids.projet}', 'Fusionner la PR', 'Test.', 'libre')`)
  const idAction = randomUUID()
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps) values ('${idAction}', '${ids.projet}', '${avecAction}', 'Claude', 'session', 'action', 'Fusionne la PR #1 sur GitHub.')`)

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
  // Les écritures de ce banc sont ralenties : un compteur qui attend leur réponse bougerait trop tard et le banc le verrait.
  const ralenties = { certifier_chantier: 0, signaler_ne_marche_pas: 0, repondre_message: 0 }
  await page.route(/\/rest\/v1\/rpc\/(certifier_chantier|signaler_ne_marche_pas|repondre_message)/, async (route) => {
    const nom = /rpc\/([a-z_]+)/.exec(route.request().url())?.[1]
    if (nom) ralenties[nom]++
    await new Promise((r) => setTimeout(r, RETARD_MS))
    await route.fallback()
  })
  const nT = async (cle) => Number((await page.getByTestId(`tuile-${cle}`).first().innerText().catch(() => '')).split('\n')[0].replace(/\D/g, '')) || 0
  const compteurs = async () => ({ pourToi: await nT('pourToi'), aTester: await nT('aTester'), enPause: await nT('enPause'), caAvance: await nT('caAvance'), fini: await nT('fini') })
  const attend = async (cond, ms = 2500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await page.waitForTimeout(100) } return false }
  const ouvrirListe = async (cle, titre) => {
    await page.getByTestId(`tuile-${cle}`).click()
    const dlg = page.getByRole('dialog').filter({ hasText: titre })
    await dlg.waitFor({ timeout: 8000 })
    return dlg
  }
  const ouvrirChantierDe = async (cle, titre, ligne) => {
    const dlg = await ouvrirListe(cle, titre)
    await dlg.getByTestId('ligne-liste-ou-jen-suis').filter({ hasText: ligne }).first().click()
    await page.getByTestId('bloc-validation').waitFor({ timeout: 10000 })
  }
  const fermerConversation = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }

  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('tuiles').waitFor({ timeout: 30000 })
  await attend(async () => (await nT('aTester')) === 3, 30000)
  const c0 = await compteurs()
  verifie('départ : pour toi 1, à tester 3, fini 0', c0.pourToi === 1 && c0.aTester === 3 && c0.fini === 0, c0)

  // --- 1. « Ça marche » : le chantier change de compteur AVANT la réponse de la base (retardée de 8 s)
  await ouvrirChantierDe('aTester', 'À tester', 'Livré à certifier')
  const bloc = page.getByTestId('bloc-validation')
  await bloc.getByTestId('btn-certifier').click()
  await bloc.getByRole('button', { name: /Je certifie/ }).click()
  const parti = await page.getByTestId('bloc-validation').waitFor({ state: 'detached', timeout: 3500 }).then(() => true).catch(() => false)
  verifie('« Ça marche » : le bloc de test disparaît tout de suite, écriture encore en route (retard 8 s)', parti && ralenties.certifier_chantier === 1, { parti, ralenties })
  await fermerConversation()
  const c1 = await compteurs()
  verifie('« Ça marche » : à tester 3 → 2 et fini 0 → 1 AVANT la réponse de la base', c1.aTester === 2 && c1.fini === 1, c1)
  const dlgFini = await ouvrirListe('fini', 'Fini')
  verifie('« Ça marche » : le chantier est dans la liste « Fini », avec son heure', (await dlgFini.getByTestId('ligne-liste-ou-jen-suis').filter({ hasText: 'Livré à certifier' }).count()) === 1)
  await page.keyboard.press('Escape')
  await attend(async () => sql(`select etat from chantiers where id = '${livre}'`)[0]?.etat === 'valide', RETARD_MS + 8000)
  verifie('« Ça marche » : la base finit bien « valide »', sql(`select etat from chantiers where id = '${livre}'`)[0]?.etat === 'valide')

  // --- 2. « Ça ne marche pas » : il quitte « à tester » sur-le-champ (Claude va vérifier)
  await ouvrirChantierDe('aTester', 'À tester', 'Livré qui ne marche pas')
  const bloc2 = page.getByTestId('bloc-validation')
  await bloc2.getByTestId('btn-ne-marche-pas').click()
  await bloc2.getByTestId('envoyer-probleme').click()
  const parti2 = await page.getByTestId('verification-en-cours').waitFor({ timeout: 3500 }).then(() => true).catch(() => false)
  await fermerConversation()
  const c2 = await compteurs()
  verifie('« Ça ne marche pas » : à tester 2 → 1 AVANT la réponse de la base, le chantier est chez Claude (ça avance / pour Claude)',
    parti2 && c2.aTester === 1 && c2.caAvance + c2.enPause >= c1.caAvance + c1.enPause + 1, { parti2, c1, c2 })

  // --- 3. « Ça bloque » sur une carte d'action : la balle passe à Claude
  const ligneAction = page.locator(`[data-testid="element-a-toi"][data-element-chantier="${avecAction}"]`)
  await ligneAction.waitFor({ timeout: 10000 })
  const avantBloque = await compteurs()
  await ligneAction.getByTestId('action-bloque').click()
  const retiree = await attend(async () => (await nT('pourToi')) === 0, 3500)
  const apresBloque = await compteurs()
  verifie('« Ça bloque » : « pour toi » 1 → 0 sur-le-champ (écriture encore en route)', retiree && apresBloque.pourToi === 0, { avantBloque, apresBloque })
  verifie('« Ça bloque » : le chantier est passé du côté de Claude (ça avance / pour Claude +1)', apresBloque.caAvance + apresBloque.enPause === avantBloque.caAvance + avantBloque.enPause + 1, { avantBloque, apresBloque })
  verifie('« Ça bloque » : la carte n’est plus dans « À toi de jouer »', await ligneAction.count() === 0)
  await attend(async () => sql(`select etat, answered_at is null as ouverte, retour_at is not null as retour from messages where id = '${idAction}'`)[0]?.etat === 'bloque', RETARD_MS + 8000)
  const base = sql(`select etat, answered_at is null as ouverte, retour_at is not null as retour from messages where id = '${idAction}'`)[0]
  verifie('« Ça bloque » : en base, la carte reste ouverte avec son retour daté (Claude la lit)', base?.etat === 'bloque' && base?.ouverte === true && base?.retour === true, base)

  // --- 4. Claude répond dans le fil sans fermer la carte : la balle revient à Raphaël
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values ('${ids.projet}', '${avecAction}', 'Claude', 'session', 'info', 'J’ai regardé : la PR est en conflit, je la corrige.')`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('tuiles').waitFor({ timeout: 30000 })
  await attend(async () => (await nT('pourToi')) === 1, 15000)
  verifie('Claude a répondu sans fermer la carte : « pour toi » 0 → 1, la carte revient', (await nT('pourToi')) === 1 && await page.locator(`[data-testid="element-a-toi"][data-element-chantier="${avecAction}"]`).count() === 1)

  // --- 5. Écriture refusée : le chantier revient où il était, avec un message
  await ctx.route(/\/rest\/v1\/rpc\/certifier_chantier/, (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'refus du banc', details: null, hint: null }) }))
  const avantRefus = await compteurs()
  await ouvrirChantierDe('aTester', 'À tester', 'Livré, écriture refusée')
  const bloc3 = page.getByTestId('bloc-validation')
  await bloc3.getByTestId('btn-certifier').click()
  await bloc3.getByRole('button', { name: /Je certifie/ }).click()
  const toast = await page.getByText(/Pas certifié, il est revenu/).first().waitFor({ timeout: RETARD_MS + 6000 }).then(() => true).catch(() => false)
  await fermerConversation()
  const apresRefus = await compteurs()
  verifie('écriture refusée : message visible, le chantier est revenu dans « à tester » (compteurs comme avant)', toast && apresRefus.aTester === avantRefus.aTester && apresRefus.fini === avantRefus.fini, { toast, avantRefus, apresRefus })
  verifie('écriture refusée : rien n’a changé en base', sql(`select etat from chantiers where id = '${refuse}'`)[0]?.etat === 'a_verifier')

  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    await purgerProjetsDeTest(sql, [ids.projet], PREFIXE)
    const reste = sql(`select count(*)::int as n from projets where slug like '${PREFIXE}%'`)[0].n
    verifie('nettoyage : le projet jetable est supprimé', reste === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  await navigateur?.close()
  arreter()
  console.log(`\nverifier-statuts-ecran : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
