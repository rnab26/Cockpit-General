// « Chantiers et GitHub » de bout en bout, sur écran de téléphone (13 oct. 2026, migration 0080, chantier 6f112d51).
// Le cas de Raphaël : un chantier dont le travail est déjà dans GitHub reste « en cours » parce que la session ne l'a pas fermé.
// Prouve, sur un projet jetable `test-rgecran-…` branché sur le VRAI dépôt rnab26/Cockpit-General (supprimé à la fin) :
//   1. le bloc « Chantiers et GitHub » des réglages du projet dit son rôle et « Pas encore passé » ;
//   2. le collecteur (scripts/rapprocher.py), lancé sur le vrai dépôt GitHub, passe « à vérifier » le chantier dont le commit
//      « envoyé » est dans main — et laisse en paix le chantier dont le commit n'existe pas ;
//   3. l'écran le montre : « À jour », « 1 chantier passé « livré » tout seul », la tuile « à tester » compte 1, le fil dit
//      « Livré, d'après GitHub » avec le lien exact, jamais « validé » ;
//   4. un échec se dit à l'écran (rouge, la cause) ; Éteindre / Rallumer ; les délais se règlent par projet ; aucun défilement horizontal ; aucune erreur JavaScript.
// Usage : node app/scripts/verifier-rapprochement-ecran.mjs   (build d'abord : cd app && npm run build)
//   BASE_URL=https://rnab26.github.io/Cockpit-General/ node app/scripts/verifier-rapprochement-ecran.mjs   (le même parcours sur le site en ligne)
import { chromium } from 'playwright'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const racine = path.resolve(racineApp, '..')
const sqlSh = path.join(racine, 'scripts', 'sql.sh')
const rapprocher = path.join(racine, 'scripts', 'rapprocher.py')
const CAPTURES = process.env.CAPTURES ?? '/tmp'
mkdirSync(CAPTURES, { recursive: true })
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4176)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-rgecran-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

const P = randomUUID(), cache = mkdtempSync(path.join(tmpdir(), 'cockpit-rgecran-'))
let navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  // Le vrai dépôt : un commit RÉEL de main (la fusion de la PR #128, 99f10fc) que la session « avait signalé envoyé ».
  const SHA_REEL = '99f10fc'
  const reel = spawnSync('git', ['-C', racine, 'cat-file', '-t', SHA_REEL], { encoding: 'utf8' })
  if (reel.stdout.trim() !== 'commit') throw new Error(`le commit ${SHA_REEL} n'est pas dans ce dépôt : ${reel.stderr}`)
  sql(`insert into projets (id, slug, nom, couleur, actif, depot, delai_sans_signe_min) values (${q(P)}, ${q(SLUG)}, 'Test rapprochement (s’efface seul)', '#64748B', true, 'rnab26/Cockpit-General', 120)`)
  const il = (h) => new Date(Date.now() - h * 3600_000).toISOString()
  const ch = (titre, jalon) => {
    const id = randomUUID()
    sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, jalons, created_at, updated_at) values (${q(id)}, ${q(P)}, ${q(titre)}, 'Test.', 'en_cours', 'claude/test-rgecran', ${q(JSON.stringify({ pousse: { at: il(28), detail: jalon } }))}::jsonb, ${q(il(30))}, ${q(il(29))})`)
    sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, updated_at) values (${q(P)}, ${q(id)}, 'claude/test-rgecran', 'je travaille dessus', 50, 'en_cours', ${q(il(29))})`)
    return id
  }
  const livre = ch('Accueil : remettre les boxes (déjà dans GitHub)', `${SHA_REEL} Accueil : l'écran complet redevient la vue par défaut`)
  const inconnu = ch('Travail dont le commit n’existe pas', 'deadbee')
  sql(`set local session_replication_role = replica; update chantiers set updated_at = now() - interval '29 hours' where projet_id = ${q(P)}`)

  // --- connexion (lien magique) et écran de téléphone
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
  await page.getByTestId('tuiles').waitFor({ timeout: 30000 })
  const ouvrirReglages = async () => {
    await page.getByTestId('onglet-vue-reglages').click()
    const b = page.getByTestId('rapprochement-github')   // au niveau de l'onglet Réglages (comme le mode autonome), sans ouvrir le repli
    await b.waitFor({ timeout: 20000 })
    return b
  }

  // --- 1. avant le passage
  let bloc = await ouvrirReglages()
  verifie('le bloc « Chantiers et GitHub » dit son rôle (livré, à vérifier ; jamais « validé »)', /livré, à vérifier/.test(await bloc.getByTestId('rapprochement-role').textContent()) && /Jamais « validé »/.test(await bloc.getByTestId('rapprochement-role').textContent()))
  verifie('avant tout passage : « Pas encore passé »', /Pas encore passé/.test(await bloc.getByTestId('rapprochement-titre').textContent()))
  const box = await bloc.boundingBox()
  verifie('dans l’écran du téléphone (390 px), sans défilement horizontal', !!box && box.x >= 0 && box.x + box.width <= 390 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  verifie('état vide : « Aucun chantier n’a encore été passé « livré » tout seul », sans bouton Annuler', /Aucun chantier n’a encore été passé/.test(await bloc.getByTestId('rapprochement-passages-vide').textContent()) && (await bloc.getByTestId('rapprochement-annuler').count()) === 0)
  await page.screenshot({ path: `${CAPTURES}/rapprochement-avant.png` })

  // --- 2. le collecteur, sur le VRAI dépôt GitHub (clone d'appoint sans fichiers dans un dossier jetable)
  const run = spawnSync('python3', ['-I', rapprocher, '--projet', SLUG, '--depot-dir', racine], { encoding: 'utf8', timeout: 240000, env: { ...process.env, COCKPIT_CACHE: cache, COCKPIT_SQL: sqlSh } })
  verifie('le collecteur lit le vrai dépôt GitHub : 1 chantier livré sur 2 examinés', run.status === 0 && /2 chantier\(s\) ouvert\(s\) sans session examiné\(s\)/.test(run.stdout) && /1 livrés\./.test(run.stdout), { code: run.status, out: run.stdout, err: run.stderr })
  const etat = (id) => sql(`select etat, pris_par, comment_verifier, livre_at from chantiers where id = ${q(id)}`)[0]
  verifie('en base : le chantier prouvé est « à vérifier », jamais « validé », avec le lien GitHub exact', etat(livre).etat === 'a_verifier' && etat(livre).pris_par === null && /github\.com\/rnab26\/Cockpit-General\/commit\/99f10fc/.test(etat(livre).comment_verifier ?? ''), etat(livre))
  verifie('… et celui dont le commit n’existe pas n’est pas touché', etat(inconnu).etat === 'en_cours' && etat(inconnu).pris_par === 'claude/test-rgecran')
  const fil = sql(`select kind, corps from messages where chantier_id = ${q(livre)} and corps like 'Livré, d''après GitHub%'`)
  verifie('son fil dit « Livré, d’après GitHub » avec la preuve et le moyen de la contester', fil.length === 1 && fil[0].kind === 'constat' && /commit 99f10fc/.test(fil[0].corps) && /Ça ne marche pas/.test(fil[0].corps), fil)

  // --- 3. l'écran le montre
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('tuiles').waitFor({ timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="tuile-aTester"]')?.textContent?.startsWith('1'), null, { timeout: 30000 }).catch(() => {})
  verifie('la tuile « à tester » compte le chantier passé tout seul', (await page.getByTestId('tuile-aTester').innerText()).startsWith('1'), await page.getByTestId('tuile-aTester').innerText())
  bloc = await ouvrirReglages()
  verifie('l’écran dit « À jour : dernier passage … » (vert)', /^À jour : dernier passage/.test(await bloc.getByTestId('rapprochement-titre').textContent()) && (await bloc.getAttribute('data-ton')) === 'ok', await bloc.textContent())
  verifie('… et « 1 chantier passé « livré » tout seul ces dernières 24 h »', /^1 chantier passé « livré » tout seul ces dernières 24 h\.$/.test(await bloc.getByTestId('rapprochement-detail').textContent()), await bloc.getByTestId('rapprochement-detail').textContent())
  await page.screenshot({ path: `${CAPTURES}/rapprochement-apres.png` })

  // --- 3 bis. « Annuler » un passage depuis l'écran (chantier 7070ce60)
  const liste = bloc.getByTestId('rapprochement-passages')
  const lignes = liste.getByTestId('rapprochement-ligne-passage')
  await lignes.first().waitFor({ timeout: 20000 })
  verifie('« Derniers passages automatiques » : une ligne, le titre du chantier, « Annuler » assez grand pour un pouce', await lignes.count() === 1 && /remettre les boxes/.test(await lignes.first().textContent()) && ((await lignes.first().getByTestId('rapprochement-annuler').boundingBox())?.height ?? 0) >= 28)
  await lignes.first().getByTestId('rapprochement-annuler').click()
  const dlg = page.getByRole('dialog').filter({ hasText: 'Annuler ce passage' })
  await dlg.waitFor({ timeout: 10000 })
  verifie('confirmation avant : elle dit le chantier et l’état retrouvé', /remettre les boxes/.test(await dlg.textContent()) && /redeviendra « en cours »/.test(await dlg.textContent()))
  await dlg.getByRole('button', { name: 'Garder' }).click()
  await dlg.waitFor({ state: 'hidden', timeout: 10000 })
  verifie('« Garder » : rien ne change (toujours « à vérifier »)', etat(livre).etat === 'a_verifier')
  await lignes.first().getByTestId('rapprochement-annuler').click()
  await dlg.waitFor({ timeout: 10000 })
  await dlg.getByRole('button', { name: 'Annuler le passage' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="rapprochement-ligne-passage"]')?.getAttribute('data-statut') === 'annule', null, { timeout: 20000 }).catch(() => {})
  verifie('« Annuler le passage » : le chantier retrouve son état d’avant (en cours, tenu par la même session) et l’écran écrit « annulé »', etat(livre).etat === 'en_cours' && etat(livre).pris_par === null && (await lignes.first().getAttribute('data-statut')) === 'annule' && /annulé/.test(await lignes.first().textContent()) && (await lignes.first().getByTestId('rapprochement-annuler').count()) === 0, etat(livre))
  verifie('le fil le dit (« Rapprochement annulé ») et le décompte du bloc retombe à 0', sql(`select count(*)::int as n from messages where chantier_id = ${q(livre)} and corps like 'Rapprochement annulé%'`)[0].n === 1 && /^Rien à rattraper/.test(await bloc.getByTestId('rapprochement-detail').textContent()), await bloc.getByTestId('rapprochement-detail').textContent())
  await page.screenshot({ path: `${CAPTURES}/rapprochement-annule.png` })

  // --- 4. un échec se dit ; éteindre / rallumer
  sql(`select j from (select cockpit.noter_echec_rapprochement(${q(SLUG)}, 'clone impossible : dépôt injoignable (test)') as j) q`)
  await bloc.getByTestId('rapprochement-interrupteur').click()
  await page.waitForFunction(() => /Rallumer/.test(document.querySelector('[data-testid="rapprochement-interrupteur"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
  verifie('Éteindre : l’écran dit « Éteint sur ce projet », et la base est éteinte', /Éteint sur ce projet/.test(await bloc.getByTestId('rapprochement-titre').textContent()) && sql(`select rapprochement_auto as a from projets where id = ${q(P)}`)[0].a === false)
  await bloc.getByTestId('rapprochement-interrupteur').click()
  await page.waitForFunction(() => /a échoué/.test(document.querySelector('[data-testid="rapprochement-titre"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
  verifie('Rallumer : un passage qui a ÉCHOUÉ se dit en rouge, avec sa cause et « il réessaie »', (await bloc.getAttribute('data-ton')) === 'erreur' && /clone impossible : dépôt injoignable \(test\)/.test(await bloc.getByTestId('rapprochement-detail').textContent()) && /réessaie/.test(await bloc.getByTestId('rapprochement-detail').textContent()), await bloc.textContent())
  await page.screenshot({ path: `${CAPTURES}/rapprochement-echec.png` })
  // --- 5. les délais se règlent par projet (aucune valeur en dur)
  await bloc.getByTestId('rapprochement-regler').click()
  verifie('« Régler… » : les deux délais du projet (rappel après 4 heures, recherche toutes les 20 minutes)', (await bloc.getByTestId('rapprochement-trace').inputValue()) === '4' && (await bloc.getByTestId('rapprochement-passage').inputValue()) === '20')
  await bloc.getByTestId('rapprochement-trace').selectOption('2')
  await page.waitForFunction(() => document.querySelector('[data-testid="rapprochement-trace"]')?.value === '2', null, { timeout: 10000 }).catch(() => {})
  const delais = sql(`select to_jsonb(x) as j from (select rapprochement_trace_h as t, rapprochement_passage_min as m from projets where id = ${q(P)}) x`)[0].j
  verifie('rappel après 2 heures : l’écran et la base suivent (l’autre délai ne bouge pas)', (await bloc.getByTestId('rapprochement-trace').inputValue()) === '2' && delais.t === 2 && delais.m === 20, delais)
  await page.screenshot({ path: `${CAPTURES}/rapprochement-reglages.png` })
  verifie('aucune erreur JavaScript pendant tout le parcours', erreurs.length === 0, erreurs)
} catch (e) {
  total++; echecs++
  console.log(`  ✗ exception : ${e.stack ?? e.message}`)
} finally {
  try { if (navigateur) await navigateur.close() } catch {}
  try {
    await purgerProjetsDeTest(sql, [P], PREFIXE)
    verifie('nettoyage : le projet jetable est supprimé', sql(`select count(*)::int as n from projets where slug like ${q(PREFIXE + '%')}`)[0].n === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  rmSync(cache, { recursive: true, force: true })
  arreter()
  console.log(`\nverifier-rapprochement-ecran : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
