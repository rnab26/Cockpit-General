// Un message n'est pas un chantier : la pastille et la discussion, sur écran de téléphone (16 oct. 2026, migration 0091).
// Raphaël (capture de « Ça avance tout seul », FacePro) : « chaque message que je crée en discussion est transcrit comme un chantier
// avec une progression […] il vaut mieux une petite pastille de notification et la discussion concernant le chantier en question.
// Quand on clique sur la barre de progression du chantier, pas que chaque message devienne un chantier avec une barre. »
// Prouve, sur un projet jetable `test-messages-…`, avec les VRAIS hooks pour la phrase de Raphaël :
//   - « Ça avance tout seul » (vue simple) ne montre que des chantiers : celui à 35 %, et celui dont la session n'a donné aucun
//     pourcentage montre « au travail » (une barre en mouvement), jamais « 0 % » ;
//   - une conversation Claude sans chantier est UNE ligne sans barre, qui dit ce qu'elle fait, avec la pastille de la discussion du projet ;
//   - toucher la ligne d'un chantier ouvre SA discussion (son message, la réponse de Claude) et éteint sa pastille ;
//   - la phrase exacte « Vas-y teste toi la piste du relighting voir ce que ca donne », tapée dans la session qui tient le chantier,
//     n'ajoute AUCUNE ligne ni barre : elle arrive dans le fil de ce chantier ; la réponse de Claude y allume la pastille sur la
//     MÊME ligne ; la même phrase sans chantier tenu arrive dans la discussion du projet ;
//   - aucun défilement horizontal, aucune erreur JavaScript.
// ~2 min (la dernière étape attend le sondage de l'écran). Usage : node app/scripts/verifier-messages.mjs   (build d'abord : cd app && npm run build)
//   BASE_URL=https://rnab26.github.io/Cockpit-General/ node app/scripts/verifier-messages.mjs   (le même parcours sur le site en ligne)
import { chromium } from 'playwright'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
const PORT = Number(process.env.PORT ?? 4176)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-messages-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const esc = (v) => String(v).replace(/'/g, "''")
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

const P = randomUUID()
const ch = { reel: randomUUID(), sansPct: randomUUID() }
const BR = { a: 'claude/test-messages-a', b: 'claude/test-messages-b', c: 'claude/test-messages-c' }
const PHRASE = 'Vas-y teste toi la piste du relighting voir ce que ca donne'
let navigateur = null
const dossier = mkdtempSync(path.join(tmpdir(), 'cockpit-messages-'))
const depot = (nom, branche) => { const d = path.join(dossier, nom); mkdirSync(d); spawnSync('git', ['init', '-q', '-b', branche, d]); return d }
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${P}', '${SLUG}', 'Test messages (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-messages.mjs')`)

  // Deux chantiers VRAIS : l'un à 35 % (la session l'a signalé), l'autre dont la session n'a donné aucun pourcentage (action en direct seulement).
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, pris_jusqu_a, origine) values
    ('${ch.reel}', '${P}', 'Scintillement : une piste sans surcoût', 'Test.', 'en_cours', '${BR.a}', now() + interval '2 hours', 'session'),
    ('${ch.sansPct}', '${P}', 'Bandeau hors ligne', 'Test.', 'en_cours', '${BR.b}', now() + interval '2 hours', 'session')`)
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, updated_at) values ('${P}', '${ch.reel}', '${BR.a}', 'Lot de rendus lancé, surveillance en cours', 35, 'en_cours', now())`)
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, pct_estime, updated_at) values ('${P}', '${ch.sansPct}', '${BR.b}', 'Au travail', 0, 'en_cours', false, now())`)
  // Trois sessions vivantes : A et B tiennent un chantier, C n'en tient aucun (elle travaille sur « Ranger la doc »).
  for (const [id, br, sujet, action] of [['sa', BR.a, 'Scintillement', null], ['sb', BR.b, 'Bandeau', 'Modifie Bandeau.tsx'], ['sc', BR.c, 'Ranger la doc', 'Modifie README.md']]) {
    sql(`insert into sessions (id, projet_id, branche, sujet, tour_en_cours, demarre_at, vu_at, action_live, action_live_at) values ('${SLUG}-${id}', '${P}', '${br}', '${sujet}', true, now() - interval '20 minutes', now(), ${action ? `'${action}'` : 'null'}, ${action ? 'now()' : 'null'})`)
  }
  // Le fil du chantier à 35 % : son message tapé dans la session et la réponse de Claude (non lue). Idem dans la discussion du projet.
  const mA = randomUUID(), mP = randomUUID()
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session, recu_par, created_at) values
    ('${mA}', '${P}', '${ch.reel}', 'Raphaël (session Claude)', 'proprietaire', 'info', 'Alors ça en est où, c’est fini ou pas ?', true, '${BR.a}', now() - interval '3 minutes'),
    ('${mP}', '${P}', null, 'Raphaël (session Claude)', 'proprietaire', 'info', 'Range aussi les fichiers du dossier docs par date', true, '${BR.c}', now() - interval '3 minutes')`)
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, repond_a, created_at) values
    ('${P}', '${ch.reel}', 'Claude', 'session', 'info', 'Le lot de six rendus tourne, je te dis ce que ça donne dans une heure.', '${mA}', now() - interval '2 minutes'),
    ('${P}', null, 'Claude', 'session', 'info', 'Les fichiers du dossier docs sont rangés par date.', '${mP}', now() - interval '2 minutes')`)

  const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }
  const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) })).json()
  const ses = await (await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json()
  if (!ses.access_token) throw new Error('connexion impossible')
  navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })
  await ctx.addInitScript(([k, v, vue]) => { try { localStorage.setItem(k, v); localStorage.setItem('cockpit_accueil', vue) } catch {} }, [`sb-${REF}-auth-token`, JSON.stringify(ses), 'simple'])
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
  const ligne = (id) => page.locator(`[data-chantier-ligne="${id}"]`)
  const pastille = (loc) => loc.getByTestId('pastille-reponse')

  console.log('\n1. « Ça avance tout seul » ne montre que de vrais chantiers, et une conversation sans chantier est une ligne')
  await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('accueil-en-cours').waitFor({ timeout: 40000 })
  await ligne(ch.reel).waitFor({ timeout: 40000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="hors-chantier"]').length >= 1, null, { timeout: 30000 }).catch(() => {})
  const lignes = await page.getByTestId('accueil-en-cours').getByTestId('ligne-en-ce-moment').count()
  verifie('deux lignes de chantier (les deux vrais), aucune autre', lignes === 2, lignes)
  const reel = ligne(ch.reel)
  verifie('le chantier à 35 % montre sa barre et « 35 % »', (await reel.getByTestId('progression').getAttribute('aria-valuenow')) === '35' && /35 %/.test(await reel.innerText()), await reel.innerText())
  const sans = ligne(ch.sansPct)
  verifie('celui dont la session n’a donné aucun pourcentage dit « au travail » (barre en mouvement), jamais « 0 % »', /au travail/.test(await sans.innerText()) && !/\b0 %/.test(await sans.innerText()) && await sans.locator('[data-sans-pct="oui"]').count() === 1, await sans.innerText())
  // L'action en direct vient de la SESSION (admin seulement), jamais de la ligne d'activité (lisible des membres invités).
  await sans.locator('button').first().click()
  await page.getByTestId('bulle-travail').waitFor({ timeout: 15000 })
  verifie('la discussion du chantier dit ce que la session fait à l’instant (« Modifie Bandeau.tsx »), lu sur la session', /Modifie Bandeau\.tsx/.test(await page.getByTestId('bulle-travail').innerText()), await page.getByTestId('bulle-travail').innerText())
  await page.getByTestId('fermer-conversation').click()
  await page.getByTestId('conversation').waitFor({ state: 'detached', timeout: 10000 })
  verifie('la pastille « Réponse » est sur la ligne du chantier dont Claude a répondu', await pastille(reel).count() === 1, await reel.innerText())
  verifie('l’autre chantier, sans réponse de Claude, n’a pas de pastille', await pastille(sans).count() === 0)
  const lignesSession = page.getByTestId('accueil-en-cours').getByTestId('hors-chantier')
  verifie('la conversation sans chantier est UNE ligne, sans aucune barre', await lignesSession.count() === 1 && await lignesSession.first().getByTestId('progression').count() === 0, await lignesSession.allInnerTexts())
  verifie('…qui dit ce que Claude fait à l’instant', /Ranger la doc.*travaille : Modifie README\.md/.test(await lignesSession.first().innerText()), await lignesSession.first().innerText())
  verifie('…avec la pastille de la discussion du projet (Claude y a répondu)', await pastille(lignesSession.first()).count() === 1)
  verifie('aucun chantier n’a été créé par un message (le projet n’en a que deux)', sql(`select count(*)::int n from chantiers where projet_id = '${P}'`)[0].n === 2)
  await page.screenshot({ path: `${CAPTURES}/messages-en-cours.png` })

  console.log('\n2. toucher la ligne d’un chantier ouvre SA discussion, et éteint la pastille')
  await reel.locator('button').first().click()
  await page.getByTestId('conversation').waitFor({ timeout: 15000 })
  const fil = page.getByTestId('fil-conversation')
  await fil.getByText('Alors ça en est où').waitFor({ timeout: 15000 })
  verifie('la discussion du chantier montre son message et la réponse de Claude', await fil.getByText('Le lot de six rendus tourne').count() === 1 && /Scintillement/.test(await page.getByTestId('titre-conversation').innerText()), await fil.innerText())
  await page.screenshot({ path: `${CAPTURES}/messages-fil-chantier.png` })
  await page.getByTestId('fermer-conversation').click()
  await page.getByTestId('conversation').waitFor({ state: 'detached', timeout: 10000 })
  await page.waitForFunction((id) => !document.querySelector(`[data-chantier-ligne="${id}"] [data-testid="pastille-reponse"]`), ch.reel, { timeout: 15000 }).catch(() => {})
  verifie('la pastille du chantier est éteinte une fois la discussion lue', await pastille(reel).count() === 0)

  console.log('\n3. toucher la ligne d’une conversation sans chantier ouvre la discussion du projet')
  await lignesSession.first().getByTestId('hors-chantier-ouvrir').click()
  await page.getByTestId('conversation').waitFor({ timeout: 15000 })
  await page.getByTestId('fil-conversation').getByText('Range aussi les fichiers').waitFor({ timeout: 15000 })
  verifie('la discussion du projet montre son message tapé dans la session et la réponse de Claude', await page.getByTestId('fil-conversation').getByText('Les fichiers du dossier docs sont rangés').count() === 1)
  await page.getByTestId('fermer-conversation').click()
  await page.getByTestId('conversation').waitFor({ state: 'detached', timeout: 10000 })
  await page.waitForFunction(() => !document.querySelector('[data-testid="hors-chantier"] [data-testid="pastille-reponse"]'), null, { timeout: 15000 }).catch(() => {})
  verifie('la pastille de la ligne de conversation est éteinte une fois lue', await pastille(page.getByTestId('hors-chantier').first()).count() === 0)

  console.log('\n4. la phrase exacte de Raphaël, tapée dans la session qui tient le chantier : aucun chantier de plus, la réponse allume la pastille')
  const dirA = depot('a', BR.a), dirC = depot('c', BR.c)
  const env = (dir) => ({ ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: dir, COCKPIT_SQL: sqlSh, TMPDIR: dossier, COCKPIT_REP_INTERVALLE: '0', COCKPIT_LIVE_INTERVALLE: '0', COCKPIT_BATTEMENT_PAS: '1' })
  const suivi = (dir, sid, prompt) => spawnSync('bash', [path.join(racine, 'hooks/suivi.sh')], { input: JSON.stringify({ session_id: sid, hook_event_name: 'UserPromptSubmit', prompt }), encoding: 'utf8', env: env(dir), timeout: 60000 })
  const tour = path.join(dossier, 'tour-a')
  const debut = sql(`select to_char(date_trunc('second', clock_timestamp()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as instant`)[0].instant
  writeFileSync(tour, `session sa\ndebut ${debut}\n`)
  const sortie = suivi(dirA, 'sa', PHRASE)
  verifie('le projet n’a toujours que deux chantiers', sql(`select count(*)::int n from chantiers where projet_id = '${P}'`)[0].n === 2)
  verifie('la phrase est dans le fil du chantier que la session tient (et nulle part ailleurs)', sql(`select count(*)::int n from messages where projet_id = '${P}' and chantier_id = '${ch.reel}' and corps = '${PHRASE}'`)[0].n === 1
    && sql(`select count(*)::int n from messages where projet_id = '${P}' and corps = '${PHRASE}'`)[0].n === 1)
  verifie('la session est prévenue que ce n’est pas un chantier', /n'est PAS un chantier/.test(sortie.stdout ?? ''), (sortie.stdout ?? '').slice(0, 200))
  const rep = spawnSync('bash', [path.join(racine, 'scripts/progression.sh'), '--chantier', ch.reel, '--point', 'Je teste la piste en ce moment, je te dis ce que ça donne.', '--projet', SLUG], { encoding: 'utf8', env: { ...env(dirA), CLAUDE_CODE_SESSION_ID: 'sa', COCKPIT_TOUR: tour } })
  verifie('la session répond dans ce fil', rep.status === 0, (rep.stdout ?? '') + (rep.stderr ?? ''))
  await page.getByTestId('actualiser').click()
  await page.waitForFunction((id) => !!document.querySelector(`[data-chantier-ligne="${id}"] [data-testid="pastille-reponse"]`), ch.reel, { timeout: 50000 }).catch(() => {})
  verifie('la pastille se rallume sur la MÊME ligne (pas de nouvelle ligne, pas de nouvelle barre)', await pastille(reel).count() === 1 && await page.getByTestId('accueil-en-cours').getByTestId('ligne-en-ce-moment').count() === 2)
  await page.screenshot({ path: `${CAPTURES}/messages-phrase-rangee.png` })
  // La même phrase dans une session qui ne tient aucun chantier : la discussion du projet.
  suivi(dirC, 'sc', 'Vas-y teste toi la piste du relighting voir ce que ca donne aussi sur le projet')
  verifie('sans chantier tenu : la phrase arrive dans la discussion du projet, toujours aucun chantier de plus', sql(`select count(*)::int n from messages where projet_id = '${P}' and chantier_id is null and corps like 'Vas-y teste%'`)[0].n === 1
    && sql(`select count(*)::int n from chantiers where projet_id = '${P}'`)[0].n === 2)

  console.log('\n5. le téléphone')
  const debord = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  verifie('aucun défilement horizontal', debord <= 1, debord)
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} catch (e) {
  verifie('le banc s’est déroulé sans planter', false, String(e?.stack ?? e).slice(0, 600))
} finally {
  console.log('\nnettoyage')
  try { await navigateur?.close() } catch {}
  try {
    await purgerProjetsDeTest(sql, [P], PREFIXE)
    verifie('projet de test et traces supprimés', sql(`select (select count(*) from projets where id = '${P}')::int + (select count(*) from sessions where projet_id = '${P}')::int as n`)[0].n === 0)
  } catch (e) { verifie('nettoyage', false, String(e?.message ?? e)) }
  arreter()
}
console.log(`\nverifier-messages : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
