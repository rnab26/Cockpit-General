// Les cartes déjà traitées se retirent seules, et chaque ligne de « Pour toi » dit sa date : sur écran de téléphone (16 oct. 2026, migration 0092).
// Raphaël (capture de « Pour toi (44) » et d'une carte de FacePro, 16 oct.) : « il y a des choses qui ont déjà été traitées […] j'ai pas la
// date ni l'horaire de quand ça date » ; « cette carte n'a pas lieu d'être, la retirer : pourquoi est-ce que je devrais faire une action
// manuelle ? […] pollution visuelle. Je veux vraiment que ce soit automatisé. »
// Prouve, sur un projet jetable `test-epuration-…` (vraie base, vrai navigateur, 390 x 844) :
//   - chaque ligne de la liste « Pour toi » porte « il y a 3 h · 11:07 » (âge ET heure, comme « À toi de jouer »), le plus récent en haut ;
//   - la passe automatique retire les cartes dépassées (preuve : le projet a avancé sans elles) et garde la carte toute jeune ;
//   - « À toi de jouer » dit « 2 cartes retirées seules · Voir » (vue complète ET vue simple), la liste dit pourquoi et depuis quand ;
//   - « Remettre » (depuis la liste, depuis le fil) remet la carte, la ligne disparaît, la carte ne sera plus retirée seule ;
//   - le délai se règle dans Réglages du projet › « Cartes déjà traitées », même avant tout retrait (champ refusé s'il est faux, message de succès, valeur lue par la base) ;
//   - il n'y a plus AUCUN « Cette carte n'a pas lieu d'être : la retirer » sur une carte ;
//   - aucun défilement horizontal, aucune erreur JavaScript.
// ~1 min. Usage : node app/scripts/verifier-epuration.mjs   (build d'abord : cd app && npm run build)
//   BASE_URL=https://rnab26.github.io/Cockpit-General/ node app/scripts/verifier-epuration.mjs   (le même parcours sur le site en ligne)
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
const PORT = Number(process.env.PORT ?? 4177)
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/Cockpit-General/`
const PREFIXE = 'test-epuration-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }

const serveur = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: racineApp, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const arreter = () => { try { if (serveur) process.kill(-serveur.pid, 'SIGTERM') } catch {} }
process.on('exit', arreter)
if (serveur) await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('vite preview ne démarre pas')), 20000); serveur.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); res() } }) })

const P = randomUUID()
const C = { fantome: randomUUID(), zoom: randomUUID(), voile: randomUUID(), gpu: randomUUID() }
const Q = { baguettes: randomUUID(), jeune: randomUUID(), projet: randomUUID() }
let navigateur = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${P}', '${SLUG}', 'Test épuration (s’efface seul)', '#64748B', true, 'Créé et supprimé par app/scripts/verifier-epuration.mjs')`)
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, origine) values
    ('${C.fantome}', '${P}', 'Fantôme translucide autour de la main (clip baguettes)', 'Test.', 'a_cadrer', 'session'),
    ('${C.zoom}', '${P}', 'Réglage optimal du zoom du visage', 'Test.', 'en_cours', 'session'),
    ('${C.voile}', '${P}', 'Voile au-dessus de la main : le fond recopié', 'Test.', 'a_verifier', 'session'),
    ('${C.gpu}', '${P}', 'Deuxième fournisseur GPU en plus de RunPod', 'Test.', 'bloque', 'session')`)
  // Les fiches vieillissent sans passer par le déclencheur (session_replication_role local à cet appel) : aucune n'est « vivante ».
  for (const [id, h] of [[C.fantome, 50], [C.zoom, 1], [C.voile, 1], [C.gpu, 1]]) sql(`set local session_replication_role = replica; update chantiers set updated_at = now() - interval '${h} hours' where id = '${id}'`)
  // Les cartes : la question des baguettes (30 h), une question du projet (40 h), une toute jeune (10 h, doit rester).
  const carte = (id, chantier, heures, corps, pourquoi) => sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options, created_at) values
    ('${id}', '${P}', ${chantier ? `'${chantier}'` : 'null'}, 'Claude', 'session', 'question', '${corps}', '${pourquoi}',
     '[{"libelle":"Oui, banc gratuit puis mise en ligne","aide":"Rejeu sur ordinateur, 0 $.","recommande":true},{"libelle":"Non, on laisse comme ça","aide":"Le fantôme reste tel quel."}]'::jsonb, now() - interval '${heures} hours')`)
  carte(Q.baguettes, C.fantome, 30, 'Fantôme des baguettes : un essai gratuit le réduit. Je le valide sur tous les clips, puis je le mets en ligne ?', 'Il touche dix fois plus de pixels que la tasse.')
  carte(Q.projet, null, 40, 'Je peux lancer un banc complet cette nuit ?', 'Aucun GPU ne tourne.')
  carte(Q.jeune, C.zoom, 10, 'Zoom du visage : je lance 5 rendus de test ?', 'Pour trouver le zoom le plus serré.')
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, created_at) values ('${P}', '${C.gpu}', 'Claude', 'session', 'blocage', 'Aucun deuxième fournisseur n’a répondu.', now() - interval '3 hours')`)
  // La preuve que le projet a avancé SANS ces cartes : une livraison (20 h) et un mot de Raphaël dans la session (20 h).
  sql(`insert into activite (projet_id, chantier_id, session, etape, statut, updated_at) values ('${P}', '${C.voile}', 'banc-epuration', 'Polygone gris retiré ; en ligne', 'termine', now() - interval '20 hours')`)
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session, created_at) values ('${P}', null, 'Raphaël (session Claude)', 'proprietaire', 'info', 'Oui, jusqu’à 7 dollars de GPU, fais-le.', true, now() - interval '20 hours')`)

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
  const charger = async () => {
    await page.goto(BASE + `#projet=${SLUG}`, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="a-toi"], [data-testid="accueil-a-toi"]').first().waitFor({ timeout: 40000 })
    // La section « À toi » s'affiche AVANT ses données : sur une base un peu lente (16 oct. 2026, premier passage rouge puis vert sans rien changer),
    // le banc cliquait une tuile encore vide. On attend la fin des lectures (plus aucune requête pendant 500 ms).
    await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {})
  }
  const fermerDialogue = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }
  const etat = (id) => sql(`select answered_at is not null as fermee, retiree_seule_at is not null as retiree_seule, epuration_exclue as exclue, left(reponse, 90) as reponse from messages where id = '${id}'`)[0]

  console.log('\n1. « Pour toi » : chaque ligne dit depuis quand elle attend, le plus récent en haut')
  await charger()
  await page.getByTestId('tuile-pourToi').click()
  const liste = page.getByTestId('liste-ou-jen-suis')
  await liste.waitFor({ timeout: 15000 })
  const lignes = liste.getByTestId('ligne-liste-ou-jen-suis')
  verifie('trois chantiers attendent un geste (à cadrer, en cours avec une carte, bloqué)', await lignes.count() === 3, await lignes.allInnerTexts())
  const titres = (await lignes.allInnerTexts()).map((t) => t.split('\n')[0])
  verifie('le plus récent en haut : le bloqué (il y a 3 h), puis le zoom (10 h), puis le fantôme (hier)', /GPU/.test(titres[0]) && /zoom/i.test(titres[1]) && /Fantôme/.test(titres[2]), titres)
  const ages = await liste.getByTestId('age-ligne-liste').allInnerTexts()
  verifie('chaque ligne a sa date : âge ET heure', ages.length === 3 && ages.every((a) => /^(il y a \d+ (h|j) · (hier |\d{1,2} \S+ )?\d{2}:\d{2}|hier \d{2}:\d{2})$/.test(a.replace(/\s+/g, ' ').trim())), ages)
  verifie('3 h, 10 h puis plus de 24 h', /il y a 3 h/.test(ages[0]) && /il y a 10 h/.test(ages[1]) && /^hier |^il y a \d+ j/.test(ages[2].trim()) && !/hier · hier/.test(ages.join(' ')), ages)
  await page.screenshot({ path: `${CAPTURES}/epuration-liste-pour-toi.png` })
  await fermerDialogue()
  verifie('« Pour toi » compte 5 choses (à cadrer, 3 questions, bloqué)', (await page.getByTestId('tuile-pourToi').innerText()).startsWith('5'), await page.getByTestId('tuile-pourToi').innerText())
  verifie('aucune ligne « retirées seules » tant que rien n’est retiré', await page.getByTestId('retirees-seules').count() === 0)
  await page.getByTestId('onglet-vue-reglages').click()
  await page.getByTestId('epuration-projet').waitFor({ timeout: 15000 })
  verifie('Réglages du projet › « Cartes déjà traitées » existe AVANT tout retrait, avec le délai et l’état vide en mots',
    await page.getByTestId('epuration-heures').inputValue() === '24' && /Rien n’a été retiré seul ces 7 derniers jours/.test(await page.getByTestId('epuration-projet').innerText()), await page.getByTestId('epuration-projet').innerText())
  await page.getByTestId('onglet-vue-travail').click()
  await page.locator('[data-testid="a-toi"], [data-testid="accueil-a-toi"]').first().waitFor({ timeout: 15000 })

  console.log('\n2. la passe automatique retire les cartes dépassées et garde la toute jeune')
  const passe = sql(`select cockpit.epuration_passe('${SLUG}', false, true) as r`)[0].r
  verifie('deux cartes retirées (30 h et 40 h), la jeune (10 h) gardée', passe.retirees.length === 2 && etat(Q.baguettes).retiree_seule && etat(Q.projet).retiree_seule && !etat(Q.jeune).fermee, passe)
  verifie('la raison est dite en mots simples', /^Retirée automatiquement : restée 30 h sans réponse pendant que le projet avançait \(1 livraison depuis\)\.$/.test(sql(`select reponse from messages where id = '${Q.baguettes}'`)[0].reponse))
  await charger()
  verifie('« À toi de jouer » : plus que 3 choses', (await page.getByTestId('a-toi-total').innerText()).trim() === '3', await page.getByTestId('a-toi-total').innerText())
  const ligneRet = page.getByTestId('retirees-seules')
  await ligneRet.waitFor({ timeout: 15000 })
  verifie('la ligne dit « 2 cartes retirées seules · Voir »', /2 cartes retirées seules/.test(await ligneRet.innerText()), await ligneRet.innerText())
  await page.screenshot({ path: `${CAPTURES}/epuration-a-toi.png` })

  console.log('\n3. la liste « Retirées seules » : quoi, pourquoi, depuis quand ; le délai se règle')
  await ligneRet.click()
  const dlg = page.getByTestId('liste-retirees-seules')
  await dlg.waitFor({ timeout: 15000 })
  const rows = dlg.getByTestId('ligne-retiree-seule')
  verifie('deux lignes, la plus récemment retirée d’abord ; chacune dit sa question', await rows.count() === 2 && /baguettes|banc complet/.test(await rows.first().innerText()), await rows.allInnerTexts())
  const raisons = await dlg.getByTestId('raison-retiree').allInnerTexts()
  verifie('chaque ligne dit « Retirée … · heure » et la raison (le projet a avancé sans elle)', raisons.length === 2 && raisons.every((r) => /^Retirée .* : restée \d+ h sans réponse pendant que le projet avançait/.test(r.replace(/\s+/g, ' ').trim())), raisons)
  verifie('le titre du chantier est dit (ou « Question sur le projet »)', /Fantôme translucide/.test(await dlg.innerText()) && /Question sur le projet/.test(await dlg.innerText()))
  verifie('la fenêtre dit où se règle le délai, et ne le règle pas elle-même (une seule place)', /Le délai se règle dans les réglages de chaque projet/.test(await page.getByTestId('retirees-seules-aide').innerText()) && await page.getByTestId('epuration-heures').count() === 0)
  await page.screenshot({ path: `${CAPTURES}/epuration-retirees.png` })

  console.log('\n3 bis. Réglages du projet › « Cartes déjà traitées » : le délai se règle (toujours accessible), la liste est à un toucher')
  await fermerDialogue()
  await page.getByTestId('onglet-vue-reglages').click()
  const bloc = page.getByTestId('epuration-projet')
  await bloc.waitFor({ timeout: 15000 })
  const reglage = bloc.locator(`[data-testid="reglage-epuration-projet"][data-projet="${SLUG}"]`)
  const champ = reglage.getByTestId('epuration-heures')
  verifie('le réglage montre 24 h (défaut) et le dit en mots', (await champ.inputValue()) === '24' && /Maintenant : après 24 h/.test(await reglage.innerText()), await reglage.innerText())
  verifie('la ligne « 2 cartes retirées seules · Voir » est aussi là', /2 cartes retirées seules/.test(await bloc.innerText()), await bloc.innerText())
  const enregistrer = reglage.getByTestId('epuration-enregistrer')
  verifie('rien à enregistrer tant que le champ n’a pas changé', await enregistrer.isDisabled())
  await champ.fill('abc')
  verifie('« abc » : Enregistrer est grisé', await enregistrer.isDisabled())
  await champ.fill('721')
  verifie('« 721 » : Enregistrer est grisé (de 0 à 720)', await enregistrer.isDisabled())
  await champ.fill('48')
  await enregistrer.click()
  await page.getByText(/se retire seule ✓/).waitFor({ timeout: 15000 })
  verifie('« 48 » : message de succès, valeur lue par la base', sql(`select epuration_delai_h as h from projets where id = '${P}'`)[0].h === 48)
  await bloc.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: `${CAPTURES}/epuration-reglage.png` })
  verifie('l’écran redit la nouvelle valeur', /Maintenant : après 48 h/.test(await reglage.innerText()) || /Maintenant : après 2 jours/.test(await reglage.innerText()), await reglage.innerText())
  await champ.fill('24'); await enregistrer.click()
  for (let i = 0; i < 24 && sql(`select epuration_delai_h as h from projets where id = '${P}'`)[0].h !== 24; i++) await page.waitForTimeout(500)
  verifie('remis à 24 h', sql(`select epuration_delai_h as h from projets where id = '${P}'`)[0].h === 24)
  await bloc.getByTestId('retirees-seules').click()
  await page.getByTestId('liste-retirees-seules').waitFor({ timeout: 15000 })
  verifie('un toucher sur la ligne ouvre la même liste', await page.getByTestId('ligne-retiree-seule').count() === 2)
  await fermerDialogue()
  await page.getByTestId('onglet-vue-travail').click()
  await page.locator('[data-testid="a-toi"], [data-testid="accueil-a-toi"]').first().waitFor({ timeout: 15000 })

  console.log('\n4. « Remettre » depuis la liste : la carte revient, la ligne disparaît, jamais retirée de nouveau')
  await page.getByTestId('retirees-seules').first().click()          // la fenêtre s'était fermée avec l'étape 3 bis
  await dlg.waitFor({ timeout: 15000 })
  const ligneProjet = rows.filter({ hasText: 'Je peux lancer un banc complet' })
  await ligneProjet.getByTestId('remettre-carte-liste').click()
  await page.getByText('Carte remise').first().waitFor({ timeout: 15000 })
  verifie('la ligne a disparu de la liste', await rows.count() === 1)
  const apres = etat(Q.projet)
  verifie('la base : carte rouverte, marquée « ne plus retirer seule »', !apres.fermee && !apres.retiree_seule && apres.exclue, apres)
  await fermerDialogue()
  verifie('la ligne du bas dit « 1 carte retirée seule »', /1 carte retirée seule/.test(await page.getByTestId('retirees-seules').innerText()), await page.getByTestId('retirees-seules').innerText())

  console.log('\n5. vue simple : la même ligne')
  await page.evaluate(() => localStorage.setItem('cockpit_accueil', 'simple'))
  await charger()
  await page.getByTestId('accueil-a-toi').waitFor({ timeout: 30000 })
  verifie('la vue simple montre aussi « 1 carte retirée seule »', await page.getByTestId('accueil-a-toi').getByTestId('retirees-seules').count() === 1)
  await page.evaluate(() => localStorage.removeItem('cockpit_accueil'))
  await charger()

  console.log('\n6. dans le fil : la carte retirée seule dit pourquoi et se remet d’un toucher')
  await page.getByTestId('tuile-pourToi').click()
  await page.getByTestId('liste-ou-jen-suis').waitFor({ timeout: 15000 })
  await page.getByTestId('ligne-liste-ou-jen-suis').filter({ hasText: 'Fantôme translucide' }).click()
  await page.getByTestId('conversation').waitFor({ timeout: 15000 })
  const retiree = page.getByTestId('carte-retiree-seule')
  await retiree.waitFor({ timeout: 15000 })
  verifie('le fil dit « Retirée seule · … : restée 30 h sans réponse… » avec un bouton « Remettre »', /Retirée seule/.test(await retiree.innerText()) && /restée 30 h sans réponse/.test(await retiree.innerText()) && await retiree.getByTestId('remettre-carte').count() === 1, await retiree.innerText())
  await page.screenshot({ path: `${CAPTURES}/epuration-fil.png` })
  await retiree.getByTestId('remettre-carte').click()
  await page.getByText('Carte remise').first().waitFor({ timeout: 15000 })
  await page.getByTestId('bloc-question').waitFor({ timeout: 15000 })
  verifie('la carte est de nouveau une question ouverte (réponses prêtes)', /Fantôme des baguettes/.test(await page.getByTestId('bloc-question').innerText()) && await page.getByTestId('carte-retiree-seule').count() === 0)
  const q1 = etat(Q.baguettes)
  verifie('la base : rouverte, marquée « ne plus retirer seule »', !q1.fermee && !q1.retiree_seule && q1.exclue, q1)
  verifie('plus AUCUN « Cette carte n’a pas lieu d’être : la retirer » sur la carte', await page.getByText(/n’a pas lieu d’être/).count() === 0 && await page.getByTestId('retirer-carte-ouvrir').count() === 0)
  await page.getByTestId('fermer-conversation').click()
  await page.getByTestId('conversation').waitFor({ state: 'detached', timeout: 10000 })

  console.log('\n7. rien d’autre n’a été retiré, rien ne reste à retirer')
  verifie('la carte toute jeune est toujours là', !etat(Q.jeune).fermee)
  const encore = sql(`select cockpit.epuration_passe('${SLUG}', false, true) as r`)[0].r
  verifie('une nouvelle passe ne retire rien (les deux remises sont à l’abri, la jeune est trop jeune)', encore.retirees.length === 0, encore)
  await charger()
  verifie('plus de ligne « retirées seules » (rien n’a été retiré ces 7 jours qui compte encore)', await page.getByTestId('retirees-seules').count() === 0)
  verifie('aucun défilement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  verifie('aucune erreur JavaScript', erreurs.length === 0, erreurs)
} finally {
  console.log('\nnettoyage')
  try { await navigateur?.close() } catch {}
  try {
    await purgerProjetsDeTest(sql, [P], PREFIXE)
    verifie('projet de test et traces supprimés', sql(`select (select count(*) from projets where id = '${P}')::int + (select count(*) from messages where projet_id = '${P}')::int as n`)[0].n === 0)
  } catch (e) { verifie('nettoyage', false, String(e?.message ?? e)) }
  arreter()
}
console.log(`\nverifier-epuration : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
