// « Programme dans ton compte Google » (0088, chantier 72a8d0f4), parcours COMPLET sur écran de téléphone :
// la carte du prestataire Claude (pas de ligne sur un autre prestataire), l'assistant en sept étapes (une à la fois), la clé créée et montrée
// une seule fois, les deux textes à copier (le programme avec SA clé, les réglages Google), l'attente puis la confirmation quand le programme
// appelle vraiment le cockpit, la copie qui vit sur la carte, remplacer la clé, fermer sans terminer (confirmation), révoquer (confirmation),
// et l'erreur visible quand le serveur refuse. Projet jetable `test-recusui-…`, supprimé à la fin.
// Usage : cd app && npm run build && cd .. && DENO=<deno> node app/scripts/verifier-recus-google.mjs --local   (fonction lancée ici, avant tout déploiement)
//         node app/scripts/verifier-recus-google.mjs                                                          (fonction déployée)
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lancerFonctionLocale, purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const racine = path.resolve(racineApp, '..')
const sqlSh = path.resolve(racine, 'scripts', 'sql.sh')
const CAPTURES = process.env.CAPTURES ?? '/tmp'
mkdirSync(CAPTURES, { recursive: true })
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const LOCAL = process.argv.includes('--local')
const PORT = Number(process.env.PORT ?? 4177)
// BASE_URL=https://rnab26.github.io/Cockpit-General/ vise le site EN LIGNE (preuve que la production sert le nouveau code) ; sinon l'aperçu local de app/dist.
const BASE_EXTERNE = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/?$/, '/') : null
const BASE = BASE_EXTERNE ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-recusui-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${typeof detail === 'string' ? detail.slice(0, 500) : JSON.stringify(detail).slice(0, 500)}` : ''}`); if (!ok) echecs++ }

let FONCTION = process.env.COCKPIT_RECUS_URL || `${API}/functions/v1/cockpit-recus`
let locale = null
if (LOCAL) { locale = await lancerFonctionLocale(racine, 'cockpit-recus', API); FONCTION = locale.url; console.log(`(fonction lancée ici avec Deno : ${FONCTION})`) }
else console.log(`(fonction visée : ${FONCTION})`)
async function appel(corps, cle) {
  const r = await fetch(FONCTION, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cockpit-key': cle }, body: JSON.stringify(corps) })
  return { code: r.status, json: await r.json().catch(() => null) }
}

const serveur = BASE_EXTERNE ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreterVite = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch { /* arrêté */ } }
process.on('exit', arreterVite)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

let projetId = null, navigateur = null
const S_CLAUDE = randomUUID(), S_AUTRE = randomUUID()
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  projetId = randomUUID()
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test reçus Google (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-recus-google.mjs')`)
  sql(`insert into services (id, projet_id, nom, devise, import_depuis) values ('${S_CLAUDE}', '${projetId}', 'Claude', 'ILS', '2026-10-13'), ('${S_AUTRE}', '${projetId}', 'RunPod', 'USD', '2026-10-13')`)
  // une facture plus ancienne que le jour de départ : c'est elle que le bouton « Récupérer les PDF des anciennes factures » rattrape
  sql(`insert into depenses (projet_id, service_id, date, montant, devise, type, description, reference) values ('${projetId}', '${S_CLAUDE}', '2026-07-14', 59, 'ILS', 'facture', 'Test ancienne facture', 'TESTUIOLD-0001')`)

  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
  const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const ses = await (await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json()
  if (!ses.access_token) throw new Error('connexion impossible')
  navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin }).catch(() => {})
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch { /* privé */ } }, [`sb-${REF}-auth-token`, JSON.stringify(ses)])
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
  const erreursPage = []
  page.on('pageerror', (e) => erreursPage.push(String(e)))
  const attendre = (ms) => page.waitForTimeout(ms)
  const sansDebordement = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  const etape = () => page.getByTestId('assistant-google').getAttribute('data-etape')
  const lireCopie = () => page.evaluate(() => navigator.clipboard.readText())
  const carte = page.locator('[data-testid="service"][data-nom="Claude"]')
  const autre = page.locator('[data-testid="service"][data-nom="RunPod"]')
  const clesActives = () => sql(`select id, empreinte, fin, revoquee_at, derniere_utilisation_at, programme_version from cles_import where projet_id = '${projetId}' and revoquee_at is null`)

  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('vue-projet').waitFor({ timeout: 20000 })
  await page.getByTestId('onglet-vue-couts').click()
  await page.getByTestId('couts-projet').waitFor({ timeout: 15000 })
  await carte.waitFor({ timeout: 10000 })

  // --- 1. la carte, avant tout
  const ligne = carte.getByTestId('import-google')
  verifie('la carte « Claude » propose de brancher le compte Google (état vide dit ce que ça apporte)', await ligne.getAttribute('data-niveau') === 'aucune' && /pas encore branchés/.test(await ligne.textContent()) && /PDF/.test(await ligne.textContent()) && await ligne.getByTestId('import-google-gerer').textContent() === 'Brancher mon compte Google')
  verifie('un autre prestataire (RunPod) n’a pas cette ligne : seuls les reçus d’Anthropic sont lus', await autre.getByTestId('import-google').count() === 0)
  await page.screenshot({ path: path.join(CAPTURES, 'google-carte-aucune.png') })

  // --- 2. l'assistant : une étape à la fois
  await ligne.getByTestId('import-google-gerer').click()
  await page.getByTestId('google-cle').waitFor({ timeout: 5000 })
  const intro = await page.getByTestId('assistant-google').textContent()
  verifie('avant la clé : ce que fait le programme, en mots simples (lecture seule, mails d’Anthropic seulement, gratuit, une seule fois)', /ton compte Google/.test(intro) && /Lecture seule/.test(intro) && /Gratuit/.test(intro) && /10 à 15 minutes/.test(intro))
  verifie('aucun bouton des étapes suivantes n’est visible avant la clé', await page.getByTestId('google-suivant').count() === 0 && await page.getByTestId('google-copier-programme').count() === 0)
  await page.screenshot({ path: path.join(CAPTURES, 'google-cle.png') })

  // l'erreur visible quand le serveur refuse
  await page.route('**/rest/v1/rpc/creer_cle_import', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée', code: 'XX000' }) }))
  await page.getByTestId('google-creer-cle').click()
  await page.getByRole('alert').first().waitFor({ timeout: 8000 })
  verifie('si le serveur refuse : le message est dit à l’écran, le bouton reste disponible, aucune clé créée', /panne simulée|erreur|Réessaie/i.test(await page.getByRole('alert').first().textContent()) && await page.getByTestId('google-creer-cle').isEnabled() && clesActives().length === 0)
  await page.unroute('**/rest/v1/rpc/creer_cle_import')

  await page.getByTestId('google-creer-cle').click()
  await page.getByTestId('google-suivant').waitFor({ timeout: 15000 })
  verifie('la clé est créée : l’assistant passe à l’étape 2 sur 7, titre dans l’en-tête', /Étape 2 sur 7/.test(await page.getByRole('dialog').locator('h2').textContent()) && await etape() === 'google')
  const cles = clesActives()
  verifie('une seule clé active en base, jamais de clé en clair dans la base', cles.length === 1 && cles[0].derniere_utilisation_at === null)
  const texte2 = await page.getByTestId('assistant-google').textContent()
  verifie('une étape à la fois : seules les consignes de l’étape 2 sont à l’écran', /Ouvre Google/.test(await page.getByRole('dialog').locator('h2').textContent()) && !/Colle le programme/.test(texte2) && !/installer/.test(texte2))
  const lienGoogle = page.getByTestId('google-lien')
  verifie('l’adresse exacte de Google à ouvrir est un lien (https, nouvel onglet, sans référent)', await lienGoogle.getAttribute('href') === 'https://script.google.com/' && await lienGoogle.getAttribute('target') === '_blank' && /noopener/.test(await lienGoogle.getAttribute('rel')))
  verifie('« Précédent » est grisé sur la première étape de l’installation (on ne revient pas à la création de clé)', await page.getByTestId('google-precedent').isDisabled())
  await page.screenshot({ path: path.join(CAPTURES, 'google-etape-google.png') })

  // --- 3. le programme avec SA clé
  await page.getByTestId('google-suivant').click()
  await page.getByTestId('google-copier-programme').waitFor({ timeout: 5000 })
  verifie('étape 3 : le bouton « Copier le programme »', await etape() === 'programme' && /Copier le programme/.test(await page.getByTestId('google-copier-programme').textContent()))
  await page.getByTestId('google-copier-programme').click()
  await attendre(400)
  const copie = await lireCopie().catch(() => '')
  const cleCopiee = /const CLE = '(cki_[0-9a-f]{64})';/.exec(copie)?.[1]
  verifie('le texte copié est le programme complet avec SA clé (jamais « __CLE__ »)', copie.length > 3000 && !!cleCopiee && !copie.includes('__CLE__') && copie.includes('const VERSION = 1;') && copie.includes('function installer()'), copie.slice(0, 120))
  verifie('la clé du programme est celle de la base (seule son empreinte y est), avec ses 4 derniers caractères', !!cleCopiee && sha256(cleCopiee) === cles[0].empreinte && cleCopiee.slice(-4) === cles[0].fin)
  const brut = readFileSync(path.join(racineApp, 'src/google/recus-claude/Code.gs'), 'utf8')
  verifie('…et c’est exactement le fichier du dépôt, la clé en plus', !!cleCopiee && copie === brut.replace("'__CLE__'", `'${cleCopiee}'`))
  verifie('le bouton dit « Copié »', /Copié/.test(await page.getByTestId('google-copier-programme').textContent()))
  await page.getByText('Si la copie ne marche pas').click()
  verifie('si la copie échoue : le texte est affichable pour le copier à la main (même texte, même clé)', (await page.getByLabel('Copier le programme', { exact: true }).inputValue()) === copie)
  await page.screenshot({ path: path.join(CAPTURES, 'google-etape-programme.png') })

  // --- 4. les réglages Google
  await page.getByTestId('google-suivant').click()
  await attendre(200)
  verifie('étape 4 : afficher le fichier de réglages (la case à cocher, nom exact)', await etape() === 'reglages' && /Afficher le fichier manifeste/.test(await page.getByTestId('assistant-google').textContent()))
  await page.getByTestId('google-suivant').click()
  await page.getByTestId('google-copier-reglages').waitFor({ timeout: 5000 })
  await page.getByTestId('google-copier-reglages').click()
  await attendre(400)
  const reglages = readFileSync(path.join(racineApp, 'src/google/recus-claude/appsscript.json'), 'utf8')
  verifie('étape 5 : « Copier les réglages » copie le fichier de réglages Google du dépôt, tel quel', await lireCopie().catch(() => '') === reglages)
  await page.getByTestId('google-precedent').click()
  verifie('« Précédent » ramène à l’étape d’avant', await etape() === 'reglages')
  await page.getByTestId('google-suivant').click()
  await page.getByTestId('google-suivant').click()

  // --- 5. installer, puis l'attente et la confirmation
  const t6 = await page.getByTestId('assistant-google').textContent()
  verifie('étape 6 : la fonction à lancer et l’écran d’avertissement de Google à passer sont dits mot pour mot', await etape() === 'installer' && /« installer »/.test(t6) && /Exécuter/.test(t6) && /n’a pas validé/.test(t6) && /Paramètres avancés/.test(t6) && /Autoriser/.test(t6))
  await page.getByTestId('google-suivant').click()
  await page.getByTestId('google-attente').waitFor({ timeout: 5000 })
  verifie('étape 7 : tant que le programme n’a pas appelé, l’écran attend et « Terminer » est grisé', await etape() === 'verifier' && await page.getByTestId('google-terminer').isDisabled() && /J’attends le premier appel/.test(await page.getByTestId('google-attente').textContent()))
  await page.screenshot({ path: path.join(CAPTURES, 'google-attente.png') })
  verifie('à aucun moment de l’assistant la page ne déborde de l’écran du téléphone', await sansDebordement())

  // une clé fausse, puis la vraie : seule la vraie fait passer au vert
  const faux = await appel({ action: 'etat', version: 1 }, 'cki_' + '1'.repeat(64))
  await attendre(5500)
  verifie('un appel avec une AUTRE clé ne confirme rien', faux.code === 401 && await page.getByTestId('google-contact-ok').count() === 0)
  const vrai = await appel({ action: 'etat', version: 1 }, cleCopiee)
  verifie('le programme appelle vraiment la fonction avec sa clé', vrai.code === 200 && vrai.json?.ok === true && vrai.json.prestataire === 'Claude', vrai)
  await page.getByTestId('google-contact-ok').waitFor({ timeout: 20000 })
  verifie('l’écran se met au vert tout seul : « Le programme a bien appelé le cockpit », « Terminer » disponible', await page.getByTestId('google-terminer').isEnabled() && /a bien appelé le cockpit/.test(await page.getByTestId('google-contact-ok').textContent()))
  verifie('ce qu’il se passe ensuite est dit (le dimanche, comment tout arrêter)', /dimanche/.test(await page.getByTestId('google-contact-ok').textContent()) && /Révoquer/.test(await page.getByTestId('google-contact-ok').textContent()))
  await attendre(700)
  await page.screenshot({ path: path.join(CAPTURES, 'google-ok.png') })
  // « PDF de toutes les factures » : la facture du 14 juillet est plus ancienne que le jour de départ (13 oct.) ; un bouton recule le départ
  const rattrapage = page.getByTestId('google-rattrapage')
  verifie('une facture plus ancienne que le jour de départ : l’écran le dit (« depuis le 14 juil. 2026 ») et propose de récupérer les PDF', /depuis le 14 juil\. 2026/.test(await rattrapage.textContent()) && /dimanche/.test(await rattrapage.textContent()))
  await page.getByTestId('google-reculer').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="google-rattrapage"]'), null, { timeout: 15000 })
  verifie('le bouton recule le jour de départ du prestataire à la plus ancienne facture (14 juillet) et disparaît', sql(`select import_depuis::text d from services where id = '${S_CLAUDE}'`)[0].d === '2026-07-14' && await page.getByTestId('google-reculer').count() === 0)
  await page.getByTestId('google-terminer').click()
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})

  // --- 6. la carte après installation
  await ligne.waitFor({ timeout: 5000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="import-google"]')?.getAttribute('data-niveau') === 'branche', null, { timeout: 15000 })
  verifie('la carte dit : programme branché, il a appelé le cockpit à l’instant, avec la fin de la clé', /Programme du compte Google branché/.test(await ligne.textContent()) && new RegExp(`…${cles[0].fin}`).test(await ligne.textContent()) && await ligne.getByTestId('import-google-gerer').textContent() === 'Gérer')
  await appel({ action: 'passage', resultats: [{ statut: 'ajoute', facture: 'TESTUI0001-0001', montant: '289.00', devise: 'ILS', date: '2026-10-02', pdf: 'depose' }], cadence_jours: 7 }, cleCopiee)
  await page.getByTestId('import-auto').waitFor({ timeout: 20000 })
  verifie('le passage du programme se voit sur la carte (ligne « Import automatique » : chaque semaine, passé, ce qu’il a fait)', await carte.getByTestId('import-auto').getAttribute('data-niveau') === 'ok' && /chaque semaine/.test(await carte.getByTestId('import-auto').textContent()) && /1 facture ajoutée : 289,00 ₪ \(2 oct\.\)/.test(await carte.getByTestId('import-auto-detail').textContent()))
  await page.screenshot({ path: path.join(CAPTURES, 'google-carte-branche.png') })

  // --- 7. gérer : état, remplacer la clé, fermer sans terminer
  await ligne.getByTestId('import-google-gerer').click()
  await page.getByTestId('google-gestion').waitFor({ timeout: 5000 })
  const gestion = await page.getByTestId('google-gestion').textContent()
  verifie('« Gérer » dit la fin de la clé, quand le programme a appelé, sa version (à jour), et que la clé ne peut plus s’afficher', new RegExp(`…${cles[0].fin}`).test(gestion) && /a appelé le cockpit/.test(gestion) && /Version du programme : 1 \(à jour\)/.test(gestion) && /ne peut pas être affichée de nouveau/.test(gestion))
  await page.screenshot({ path: path.join(CAPTURES, 'google-gestion.png') })
  await page.getByTestId('google-remplacer').click()
  await page.getByTestId('google-creer-cle').waitFor({ timeout: 5000 })
  verifie('« Nouvelle clé » reprend au début, avec le bouton « Créer une nouvelle clé »', /Créer une nouvelle clé/.test(await page.getByTestId('google-creer-cle').textContent()))
  await page.getByTestId('google-creer-cle').click()
  await page.getByTestId('google-suivant').waitFor({ timeout: 15000 })
  const apres = clesActives()
  verifie('la nouvelle clé remplace l’ancienne : une seule active, l’ancienne est révoquée', apres.length === 1 && apres[0].fin !== cles[0].fin && sql(`select count(*)::int n from cles_import where projet_id = '${projetId}' and revoquee_at is not null`)[0].n === 1)
  const ancienne = await appel({ action: 'etat' }, cleCopiee)
  verifie('l’ancienne clé est refusée par le cockpit, avec ce qu’il faut faire', ancienne.code === 401 && /remplacée ou révoquée/.test(ancienne.json?.erreur ?? ''), ancienne)
  verifie('pas de fausse confirmation : l’ancien appel ne compte pas pour la nouvelle clé (étape 2, rien de vert)', await etape() === 'google' && await page.getByTestId('google-contact-ok').count() === 0)
  await page.getByTestId('google-suivant').click()
  await page.getByTestId('google-copier-programme').click()
  await attendre(400)
  const cle2 = /const CLE = '(cki_[0-9a-f]{64})';/.exec(await lireCopie().catch(() => ''))?.[1]
  verifie('le nouveau programme copié porte la NOUVELLE clé (celle de la base), pas l’ancienne', !!cle2 && cle2 !== cleCopiee && sha256(cle2) === apres[0].empreinte)

  // fermer sans terminer : confirmation, annuler garde la fenêtre, confirmer la ferme
  await page.getByRole('button', { name: 'Fermer', exact: true }).first().click()
  const confirmation = page.getByRole('dialog').filter({ hasText: 'Fermer sans terminer' })
  await confirmation.waitFor({ timeout: 5000 })
  verifie('fermer avant la fin demande confirmation et dit pourquoi (la clé ne s’affichera plus)', /ne s’affichera plus/.test(await confirmation.textContent()))
  await confirmation.getByRole('button', { name: 'Annuler' }).click()
  await attendre(300)
  verifie('« Annuler » garde l’assistant ouvert, à la même étape', await page.getByTestId('assistant-google').count() === 1 && await etape() === 'programme')
  await page.getByRole('button', { name: 'Fermer', exact: true }).first().click()
  await confirmation.waitFor({ timeout: 5000 })
  await confirmation.locator('button').filter({ hasText: /^Fermer$/ }).click()
  await page.getByTestId('assistant-google').waitFor({ state: 'detached', timeout: 5000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="import-google"]')?.getAttribute('data-niveau') === 'attente', null, { timeout: 15000 })
  verifie('la carte dit alors : clé créée, le programme n’a pas encore appelé (état « attente », pas de fausse alerte)', /n’a pas encore appelé le cockpit/.test(await ligne.textContent()) && /Termine l’installation/.test(await ligne.textContent()))
  await page.screenshot({ path: path.join(CAPTURES, 'google-carte-attente.png') })

  // --- 8. révoquer
  await ligne.getByTestId('import-google-gerer').click()
  await page.getByTestId('google-revoquer').waitFor({ timeout: 5000 })
  await page.getByTestId('google-revoquer').click()
  const confirmerRevocation = page.getByRole('dialog').filter({ hasText: 'ses prochains passages seront refusés' })
  await confirmerRevocation.waitFor({ timeout: 5000 })
  verifie('révoquer demande confirmation et dit ce qui se passe (le programme s’arrête, les factures ne bougent pas)', /s’arrête/.test(await confirmerRevocation.textContent()) && /ne bougent pas/.test(await confirmerRevocation.textContent()))
  await confirmerRevocation.getByRole('button', { name: 'Annuler' }).click()
  await attendre(300)
  verifie('« Annuler » ne révoque rien', clesActives().length === 1)
  await page.getByTestId('google-revoquer').click()
  await confirmerRevocation.waitFor({ timeout: 5000 })
  await confirmerRevocation.getByRole('button', { name: 'Révoquer', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="import-google"]')?.getAttribute('data-niveau') === 'aucune', null, { timeout: 15000 })
  verifie('après révocation : plus aucune clé active, la carte est revenue à « pas encore branchés »', clesActives().length === 0 && /pas encore branchés/.test(await ligne.textContent()))
  const revoquee = await appel({ action: 'etat' }, cle2)
  verifie('la clé révoquée est refusée par le cockpit tout de suite', revoquee.code === 401 && /remplacée ou révoquée/.test(revoquee.json?.erreur ?? ''), revoquee)
  await page.getByRole('button', { name: 'Fermer', exact: true }).first().click().catch(() => {})
  verifie('aucune erreur JavaScript pendant tout le parcours', erreursPage.length === 0, erreursPage)
  verifie('la page ne déborde pas, carte comprise', await sansDebordement())
} finally {
  try { await navigateur?.close() } catch { /* fermé */ }
  try {
    if (projetId) {
      await purgerProjetsDeTest(async (x) => sql(x), [projetId], PREFIXE)
      const r = sql(`select (select count(*) from cles_import where projet_id = '${projetId}')::int c, (select count(*) from services where projet_id = '${projetId}')::int s, (select count(*) from projets where id = '${projetId}')::int p`)[0]
      verifie('aucun reste : ni clé, ni prestataire, ni projet de test', r.c === 0 && r.s === 0 && r.p === 0, r)
    }
  } catch (x) { console.log('  (nettoyage : ' + x.message + ')') }
  arreterVite()
  try { locale?.arreter() } catch { /* arrêtée */ }
}
console.log(`\n${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
