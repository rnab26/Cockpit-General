// L'autocontrôle sur écran de téléphone (19 oct. 2026, migration 0105, chantier 7cecd1f3) : « le cockpit repère seul ce qui ne marche pas ».
// Prouve, projet jetable `test-autocecran-…` (390 px, vraie base ; la passe tourne VRAIMENT : autocontrole_passe sur ce projet) :
//   1. rien n'est affiché quand tout va bien (une seule ligne, jamais une ligne vide) ;
//   2. du travail attend, le réveil automatique est éteint (état réel de la base) : « À savoir : … (ton choix) », jamais « Problème » ;
//   3. un toucher ouvre le détail, avec UN geste (« Activer une session ») qui appelle activer_session (le réveil lui-même est simulé :
//      ce banc ne dépense aucun jeton), un message dit si ça a marché, un refus se lit ;
//   4. un cas par incident de la liste fermée : « Problème : … », le détail, le lien de la session lancée ;
//   5. plusieurs incidents : UNE ligne, « + n autres », la panne la plus ancienne en tête, tous listés dans le détail ;
//   6. la résolution seule : la condition disparaît (Claude répond, la passe tourne), la ligne disparaît sans clic ;
//   7. « Tout » : la même ligne en tête, avec le nom du projet ; états chargement (rien de clignotant) et erreur (« illisible » + Réessayer) ;
//   8. Réglages du projet › Autocontrôle : réglages visibles, refus avec la borne, enregistrement relu en base ;
//   9. la ligne est tout en haut (au-dessus des boxes), aucun défilement horizontal, aucune erreur JavaScript.
// Le temps réel ne se vérifie pas dans ce Chromium (aucune WebSocket) : l'écran relit au rechargement ; le sondage de 60 s est le filet.
// Usage : node app/scripts/verifier-incidents.mjs   (build d'abord : cd app && npm run build ; BASE_URL=… pour le site en ligne)
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from '../../scripts/bancs.mjs'

const racineApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const racine = path.resolve(racineApp, '..')
const sqlSh = path.join(racine, 'scripts', 'sql.sh')
const CAPTURES = process.env.CAPTURES ?? '/tmp'
mkdirSync(CAPTURES, { recursive: true })
const REF = 'bexiyvmdbxcwxasgslxp', API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? 'test-cockpit@cockpit.local'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SR) { console.error('SUPABASE_SERVICE_ROLE_KEY absent.'); process.exit(2) }
const PORT = Number(process.env.PORT ?? 4179)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-autocecran-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const NOM = 'Test autocontrôle (s’efface seul)'
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

const P = randomUUID()
const appelsActiver = []
let reponseActiver = { status: 200, corps: { resultat: 'envoye', reveil_at: null } }
let lectureIncidents = null           // null = vraie base ; sinon { status, corps, delaiMs } pour fabriquer chargement / erreur / « Tout »
let navigateur = null
const poser = (code, gravite, cause, detail = {}, depuisMin = 25) => sql(
  `insert into incidents (projet_id, code, gravite, cause, detail, depuis) values (${q(P)}, ${q(code)}, ${q(gravite)}, ${q(cause)}, ${q(JSON.stringify(detail))}::jsonb, now() - interval '${depuisMin} minutes'
   ) on conflict (projet_id, code) where etat = 'ouvert' do update set cause = excluded.cause, detail = excluded.detail, gravite = excluded.gravite, depuis = excluded.depuis`)
const viderIncidents = () => sql(`delete from incidents where projet_id = ${q(P)}`)
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, depot) values (${q(P)}, ${q(SLUG)}, ${q(NOM)}, '#64748B', true, 'rnab26/Cockpit-General')`)
  sql(`insert into reveils_immediats (projet_id, trigger_id, secret_id, actif) values (${q(P)}, 'trig_bancecran', gen_random_uuid(), true)`)

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
    const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    if (r.method() === 'POST' && r.url().includes('/rest/v1/rpc/activer_session')) {
      appelsActiver.push(JSON.parse(r.postData() ?? '{}'))
      await route.fulfill({ status: reponseActiver.status, headers: cors, body: JSON.stringify(reponseActiver.corps) })
      return
    }
    if (r.method() === 'GET' && /\/rest\/v1\/incidents\?/.test(r.url()) && lectureIncidents) {
      if (lectureIncidents.delaiMs) await new Promise((ok) => setTimeout(ok, lectureIncidents.delaiMs))
      await route.fulfill({ status: lectureIncidents.status, headers: cors, body: JSON.stringify(lectureIncidents.corps) })
      return
    }
    try {
      const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
      const headers = Object.fromEntries(res.headers); delete headers['content-encoding']; delete headers['content-length']
      await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
    } catch { await route.abort('failed') }
  })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const ouvrir = async (hash) => {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('tuiles').waitFor({ timeout: 40000 })
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  }
  const ligne = () => page.getByTestId('incident-ligne')
  const passe = () => JSON.parse(execFileSync(sqlSh, [`select cockpit.autocontrole_passe(${q(SLUG)}, false, true) as r`], { encoding: 'utf8' })).rows[0].r

  // --- 1. tout va bien : rien
  await ouvrir(`#projet=${SLUG}`)
  verifie('tout va bien : aucune ligne, aucun cadre vide', (await ligne().count()) === 0 && (await page.getByTestId('incident-erreur').count()) === 0)

  // --- 2. du travail attend (message de Raphaël sans réponse depuis 60 min) ; le réveil automatique est éteint : état réel de la base
  sql(`insert into messages (projet_id, auteur, auteur_type, kind, corps, created_at) values (${q(P)}, 'banc', 'proprietaire', 'info', 'Vas-y fais ça', now() - interval '60 minutes')`)
  const reveilAutoAllume = sql(`select actif from filet_reglage where id = 1`)[0].actif === true
  const r1 = passe()
  verifie('la passe réelle ouvre un incident sur ce projet', r1?.projets?.[0]?.incidents?.length === 1, r1)
  await ouvrir(`#projet=${SLUG}`)
  await ligne().waitFor({ timeout: 15000 })
  const code1 = await ligne().getAttribute('data-code')
  const texte1 = (await page.getByTestId('incident-texte').innerText()).trim()
  if (!reveilAutoAllume) {
    verifie('réveil automatique éteint (ton choix) : « À savoir », jamais « Problème »', code1 === 'attente_reveil_eteint' && texte1.startsWith('À savoir : ') && /ton choix/.test(texte1) && !/Problème/.test(texte1), [code1, texte1])
  } else {
    verifie('du travail attend, aucun réveil parti : « Problème : … »', code1 === 'attente_sans_reveil' && texte1.startsWith('Problème : '), [code1, texte1])
  }
  const meta1 = (await page.getByTestId('incident-meta').innerText()).trim()
  verifie('l’âge et l’heure sont dits (« depuis il y a 1 h · hh:mm »), sans répéter le projet', /^depuis il y a 1 h · \d{2}:\d{2}$/.test(meta1), meta1)
  const yLigne = (await ligne().boundingBox()).y, yTuiles = (await page.getByTestId('tuiles').boundingBox()).y
  verifie('la ligne est TOUT en haut de l’écran, au-dessus des boxes', yLigne < yTuiles && yLigne < 200, [yLigne, yTuiles])
  await page.screenshot({ path: `${CAPTURES}/incident-a-savoir.png` })

  // --- 3. le détail et UN geste
  await ligne().click()
  const detail = page.getByTestId('incident-detail')
  await detail.waitFor({ timeout: 8000 })
  verifie('un toucher ouvre le détail : la cause, depuis quand, ce qui attend, « se règle tout seul »', /réveil automatique est éteint/.test(await detail.innerText()) && /depuis il y a 1 h/.test(await detail.innerText()) && /Ce qui attend : 1 message\(s\) sans réponse/.test(await detail.innerText()) && /se règle tout seul/.test(await page.getByRole('dialog').innerText()), await detail.innerText())
  verifie('UN seul geste, « Activer une session »', (await page.getByTestId('incident-geste').count()) === 1 && /Activer une session/.test(await page.getByTestId('incident-geste').innerText()))
  await page.screenshot({ path: `${CAPTURES}/incident-detail.png` })
  reponseActiver = { status: 400, corps: { message: 'Serveur indisponible (essai)' } }
  await page.getByTestId('incident-geste').click()
  await page.getByRole('status').filter({ hasText: /Pas activée/ }).first().waitFor({ timeout: 8000 })
  verifie('un refus se lit (« Pas activée : … ») et le détail reste ouvert pour réessayer', (await page.getByTestId('incident-geste').count()) === 1 && appelsActiver.length === 1 && appelsActiver[0].p_projet === SLUG, appelsActiver)
  reponseActiver = { status: 200, corps: { resultat: 'envoye', reveil_at: null } }
  await page.getByTestId('incident-geste').click()
  await page.getByRole('status').filter({ hasText: /[Ss]ession demandée/ }).first().waitFor({ timeout: 8000 })
  verifie('le geste réussi : « session demandée », le détail se ferme (le réveil réel est simulé : aucun jeton dépensé)', appelsActiver.length === 2 && (await page.getByTestId('incident-geste').count()) === 0)

  // --- 4. un cas par incident de la liste fermée
  viderIncidents()
  const cas = [
    ['reveil_refuse', 'panne', 'Du travail attend et le dernier réveil a échoué : la clé du réveil est refusée, il faut la renouveler.', { geste: 'activer_session', code_http: 401, reveil_at: new Date(Date.now() - 20 * 60_000).toISOString() }, /^Problème : Du travail attend et le dernier réveil a échoué/],
    ['reveil_sans_effet', 'panne', 'Du travail attend : un réveil est parti, mais la session lancée n’a rien pris.', { geste: 'activer_session', session_url: 'https://claude.ai/code/cse_banc', raisons: ['1 message(s) sans réponse'] }, /^Problème : Du travail attend : un réveil est parti/],
    ['attente_sans_reveil', 'panne', 'Du travail attend et aucun réveil n’est parti depuis.', { geste: 'activer_session' }, /^Problème : Du travail attend et aucun réveil/],
    ['attente_reveil_eteint', 'info', 'Du travail attend, et le réveil automatique est éteint (ton choix) : active une session si tu veux le faire avancer.', { geste: 'activer_session' }, /^À savoir : Du travail attend, et le réveil automatique est éteint/],
    ['renfort_en_erreur', 'panne', 'Une session lancée s’est arrêtée : Session arrêtée sans avoir fini : il reste 2 chantier(s) dans la section, à reprendre.', {}, /^Problème : Une session lancée s’est arrêtée : Session arrêtée sans avoir fini/],
    ['session_sans_nouvelles', 'panne', 'Une session qui devait travailler ne donne plus de nouvelles.', {}, /^Problème : Une session qui devait travailler ne donne plus de nouvelles\.$/],
    ['cartes_non_retirees', 'panne', '3 cartes périmées ne se retirent pas toutes seules.', {}, /^Problème : 3 cartes périmées ne se retirent pas toutes seules\.$/],
  ]
  for (const [code, gravite, cause, det, attendu] of cas) {
    viderIncidents(); poser(code, gravite, cause, det)
    await ouvrir(`#projet=${SLUG}`)
    await ligne().waitFor({ timeout: 15000 })
    const t = (await page.getByTestId('incident-texte').innerText()).trim()
    verifie(`${code} : une ligne « ${gravite === 'info' ? 'À savoir' : 'Problème'} : … »`, (await ligne().getAttribute('data-code')) === code && (await ligne().getAttribute('data-gravite')) === gravite && attendu.test(t), t)
    await ligne().click()
    await detail.waitFor({ timeout: 8000 })
    const dt = await detail.innerText()
    const geste = (await page.getByTestId('incident-geste').count()) === 1
    verifie(`${code} : le détail dit la cause${det.geste ? ' et propose UN geste' : ', sans geste inventé'}${det.session_url ? ', avec le lien de la session lancée' : ''}`,
      dt.includes(cause) && geste === !!det.geste && ((await page.getByTestId('incident-session').count()) === 1) === !!det.session_url, dt)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  // --- 5. plusieurs incidents : UNE ligne, la panne la plus ancienne, « + n autres »
  viderIncidents()
  poser('attente_reveil_eteint', 'info', 'Du travail attend, et le réveil automatique est éteint (ton choix).', { geste: 'activer_session' }, 600)
  poser('renfort_en_erreur', 'panne', 'Une session lancée s’est arrêtée : ça a planté.', {}, 5)
  poser('session_sans_nouvelles', 'panne', 'Une session qui devait travailler ne donne plus de nouvelles.', {}, 90)
  await ouvrir(`#projet=${SLUG}`)
  await ligne().waitFor({ timeout: 15000 })
  verifie('trois incidents : UNE seule ligne', (await ligne().count()) === 1)
  verifie('… la panne la plus ancienne en tête (jamais le « à savoir » devant une panne)', (await ligne().getAttribute('data-code')) === 'session_sans_nouvelles', await ligne().getAttribute('data-code'))
  verifie('… « + 2 autres »', /\+ 2 autres/.test(await page.getByTestId('incident-meta').innerText()), await page.getByTestId('incident-meta').innerText())
  await ligne().click(); await detail.waitFor({ timeout: 8000 })
  verifie('… les trois sont listés dans le détail', (await detail.locator('li').count()) === 3, await detail.innerText())
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // --- 6. résolution seule : Claude répond, la passe tourne, la ligne disparaît sans clic
  viderIncidents()
  const r6 = passe()                                                  // le message de 60 min attend toujours : l'incident revient, ouvert par la passe
  sql(`insert into messages (projet_id, auteur, auteur_type, kind, corps) values (${q(P)}, 'claude', 'session', 'info', 'Fait.')`)
  const r7 = passe()
  verifie('la réponse arrive : la passe résout l’incident toute seule', (r6?.projets?.[0]?.incidents?.length ?? 0) === 1 && (r7?.projets?.[0]?.incidents?.length ?? 1) === 0 && sql(`select count(*)::int as n from incidents where projet_id = ${q(P)} and etat = 'ouvert'`)[0].n === 0, [r6, r7])
  await ouvrir(`#projet=${SLUG}`)
  verifie('… la ligne a disparu de l’écran, sans aucun clic', (await ligne().count()) === 0)

  // --- 7. « Tout » : la même ligne en tête, avec le nom du projet ; chargement ; erreur
  const autre = sql(`select id, nom from projets where actif and slug not like 'test-%' order by slug limit 1`)[0]
  const fabrique = (extra = {}) => ({ id: randomUUID(), projet_id: P, code: 'reveil_sans_effet', gravite: 'panne', cause: 'Du travail attend : un réveil est parti, mais la session lancée n’a rien pris.', detail: { geste: 'activer_session' }, etat: 'ouvert', depuis: new Date(Date.now() - 25 * 60_000).toISOString(), vu_at: new Date().toISOString(), ...extra })
  lectureIncidents = { status: 200, corps: [fabrique({ depuis: new Date(Date.now() - 2 * 86_400_000).toISOString() }), fabrique({ projet_id: autre.id, code: 'attente_sans_reveil', cause: 'Du travail attend et aucun réveil n’est parti depuis.' })] }
  await ouvrir('#tout')
  await ligne().waitFor({ timeout: 15000 })
  const metaTout = await page.getByTestId('incident-meta').innerText()
  verifie('« Tout » : la ligne est en tête, avec le NOM du projet, « + 1 autre »', new RegExp(`^${NOM.replace(/[()]/g, '\\$&')} · depuis `).test(metaTout.trim()) && /\+ 1 autre/.test(metaTout), metaTout)
  verifie('« Tout » : elle est au-dessus des boxes', (await ligne().boundingBox()).y < (await page.getByTestId('tuiles').boundingBox()).y)
  await page.screenshot({ path: `${CAPTURES}/incident-tout.png` })
  // chargement : rien ne clignote tant que la lecture n'est pas revenue
  lectureIncidents = { status: 200, delaiMs: 2500, corps: [fabrique()] }
  await page.goto(BASE + '#tout', { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('tuiles').waitFor({ timeout: 40000 })
  verifie('pendant le chargement : ni ligne vide ni message d’erreur', (await ligne().count()) === 0 && (await page.getByTestId('incident-erreur').count()) === 0)
  await ligne().waitFor({ timeout: 15000 })
  verifie('… puis la ligne arrive', (await ligne().count()) === 1)
  // erreur : la lecture échoue, la ligne le DIT (jamais un silence qui ressemble à « tout va bien »)
  lectureIncidents = { status: 500, corps: { message: 'Serveur indisponible (essai)' } }
  await page.goto(BASE + '#tout', { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('incident-erreur').waitFor({ timeout: 20000 })
  verifie('lecture impossible : « Autocontrôle illisible » avec « Réessayer »', /Autocontrôle illisible/.test(await page.getByTestId('incident-erreur').innerText()) && (await page.getByTestId('incident-reessayer').count()) === 1, await page.getByTestId('incident-erreur').innerText())
  await page.screenshot({ path: `${CAPTURES}/incident-erreur.png` })
  lectureIncidents = null
  await page.getByTestId('incident-reessayer').click()
  await page.getByTestId('incident-erreur').waitFor({ state: 'detached', timeout: 15000 })
  verifie('« Réessayer » : l’erreur disparaît quand la lecture revient', (await page.getByTestId('incident-erreur').count()) === 0)

  // --- 8. Réglages du projet › Autocontrôle
  viderIncidents()
  await ouvrir(`#projet=${SLUG}`)
  await page.getByTestId('onglet-vue-reglages').click()
  const bloc = page.getByTestId('autocontrole-projet')
  await bloc.waitFor({ timeout: 20000 })
  verifie('les trois réglages sont là, avec les défauts de la base (20 / 60 / 6)', (await bloc.getByTestId('autocontrole-delai').inputValue()) === '20' && (await bloc.getByTestId('autocontrole-nettoyage').inputValue()) === '60' && (await bloc.getByTestId('autocontrole-garde').inputValue()) === '6')
  verifie('rien à enregistrer tant que rien ne change', await bloc.getByTestId('autocontrole-enregistrer').isDisabled())
  await bloc.getByTestId('autocontrole-delai').fill('4')
  verifie('un délai hors bornes est refusé avec la borne, bouton éteint', /entre 5 et 1440/.test(await bloc.getByTestId('autocontrole-refus').innerText()) && (await bloc.getByTestId('autocontrole-enregistrer').isDisabled()))
  await bloc.getByTestId('autocontrole-delai').fill('45'); await bloc.getByTestId('autocontrole-nettoyage').fill('5')
  verifie('un nettoyage entre 1 et 9 min est refusé (0 = jamais, sinon 10 à 1440)', /0 \(jamais\)/.test(await bloc.getByTestId('autocontrole-refus').innerText()))
  await bloc.getByTestId('autocontrole-nettoyage').fill('0'); await bloc.getByTestId('autocontrole-garde').fill('12')
  await bloc.getByTestId('autocontrole-enregistrer').click()
  await page.getByRole('status').filter({ hasText: /autocontrôle réglé/ }).first().waitFor({ timeout: 10000 })
  const rel = sql(`select autocontrole_delai_min as d, autocontrole_nettoyage_min as n, autocontrole_garde_h as g from projets where id = ${q(P)}`)[0]
  verifie('enregistré : « autocontrôle réglé ✓ » et relu en base (45 / 0 / 12)', rel.d === 45 && rel.n === 0 && rel.g === 12, rel)
  await page.screenshot({ path: `${CAPTURES}/incident-reglages.png` })
  await ouvrir(`#projet=${SLUG}`); await page.getByTestId('onglet-vue-reglages').click()
  verifie('après rechargement, l’écran affiche les valeurs enregistrées', (await page.getByTestId('autocontrole-delai').inputValue()) === '45' && (await page.getByTestId('autocontrole-garde').inputValue()) === '12')

  verifie('dans l’écran du téléphone (390 px), sans défilement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  verifie('aucune erreur JavaScript pendant tout le parcours', erreurs.length === 0, erreurs)
} catch (e) {
  total++; echecs++
  console.log(`  ✗ exception : ${e.stack ?? e.message}`)
} finally {
  try { await navigateur?.close() } catch {}
  try {
    await purgerProjetsDeTest(sql, [P], PREFIXE)
    verifie('nettoyage : le projet jetable est supprimé, ses incidents avec', sql(`select count(*)::int as n from projets where slug like ${q(PREFIXE + '%')}`)[0].n === 0 && sql(`select count(*)::int as n from incidents where projet_id = ${q(P)}`)[0].n === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  arreter()
  console.log(`\nverifier-incidents (écran) : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
