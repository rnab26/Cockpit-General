// Rapprochement GitHub → chantiers (0080, 13 oct. 2026) : le COLLECTEUR (scripts/rapprocher.py) sur de VRAIS dépôts git, la vraie base,
// un projet jetable `test-rapprochement-…` (supprimé à la fin). La règle SQL (qui est livré, sur quelle preuve) est jouée par
// verifier-base §57 sur des faits fabriqués ; ici on prouve que le collecteur LIT les bons faits dans git, et qu'il ne touche à rien d'autre :
//   - un commit « envoyé » dans main, une branche dédiée fusionnée par une PR (branche gardée ou supprimée), une PR qui cite l'identifiant,
//     un squash « (#8) », un titre de PR presque identique → livrés ;
//   - une branche qui ne contient que du journal, une branche jamais fusionnée, une simple mention dans un commit, un commit inconnu → jamais ;
//   - un passage d'essai n'écrit rien, la copie de travail de la session reste intacte, un deuxième passage ne fait rien de plus ;
//   - `--si-ancien` et le réglage « éteint » arrêtent les hooks, mais pas un passage demandé à la main ;
//   - une panne (dépôt injoignable, projet inconnu, pas de dépôt) ne fait jamais planter : un message clair, rien d'écrit ;
//   - les deux hooks (démarrage, message) lancent le collecteur en tâche de fond, et le rappel précis arrive à la session qui tient le chantier.
// Usage : node scripts/verifier-rapprochement.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from './bancs.mjs'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlSh = path.join(racine, 'scripts', 'sql.sh')
const rapprocher = path.join(racine, 'scripts', 'rapprocher.py')
const PREFIXE = 'test-rapprochement-'
const rand = randomUUID().slice(0, 8)
const SLUG = `${PREFIXE}${rand}`, SLUG2 = `${PREFIXE}${rand}-vide`
const P = randomUUID(), P2 = randomUUID()
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
const sql = (requete) => { const j = JSON.parse(execFileSync(sqlSh, [requete], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
const une = (requete) => sql(requete)[0] ?? null
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ''}`); if (!ok) echecs++ }
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- git ----------
const dossier = mkdtempSync(path.join(tmpdir(), 'cockpit-rapprochement-'))
const BARE = path.join(dossier, 'origine.git'), W = path.join(dossier, 'session'), CACHE = path.join(dossier, 'cache')
const HOOKDIR = path.join(dossier, 'hook'), SANS_ORIGINE = path.join(dossier, 'sans-origine'), TMP = path.join(dossier, 'tmp')
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Banc', GIT_AUTHOR_EMAIL: 'banc@cockpit.local', GIT_COMMITTER_NAME: 'Banc', GIT_COMMITTER_EMAIL: 'banc@cockpit.local', GIT_TERMINAL_PROMPT: '0' }
const ep = (h) => `@${Math.floor((Date.now() - h * 3600_000) / 1000)} +0000` // date git « il y a h heures » (le format @epoch est le plus sûr)
function git(dir, args, quand) {
  const env = { ...GIT_ENV, ...(quand ? { GIT_AUTHOR_DATE: quand, GIT_COMMITTER_DATE: quand } : {}) }
  const r = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`)
  return r.stdout.trim()
}
function commit(dir, fichier, contenu, message, quand) {
  mkdirSync(path.dirname(path.join(dir, fichier)), { recursive: true })
  writeFileSync(path.join(dir, fichier), contenu)
  git(dir, ['add', fichier])
  git(dir, ['commit', '-q', '-m', message], quand)
  return git(dir, ['rev-parse', 'HEAD'])
}
const photo = (dir) => JSON.stringify({
  refs: git(dir, ['for-each-ref', '--format=%(refname) %(objectname)']),
  statut: git(dir, ['status', '--porcelain']),
  tete: git(dir, ['rev-parse', 'HEAD']),
  config: readFileSync(path.join(dir, '.git', 'config'), 'utf8'),
  fichiers: readdirSync(dir).sort(),
})

// ---------- le collecteur et les hooks ----------
function collecteur(args, { cwd = W, env = {}, cache = CACHE } = {}) {
  const r = spawnSync('python3', ['-I', rapprocher, ...args], { cwd, encoding: 'utf8', timeout: 240000, env: { ...process.env, COCKPIT_CACHE: cache, COCKPIT_SQL: sqlSh, COCKPIT_PROJET: '', ...env } })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}
const repere = (slug = SLUG, cache = CACHE) => path.join(cache, `rapproche-${slug}.t`)
const rapprocheAt = (id) => une(`select to_jsonb(x) as j from (select rapproche_at as t from projets where id = ${q(id)}) x`)?.j?.t ?? null
const etatDe = (id) => une(`select to_jsonb(x) as j from (select etat, pris_par, livre_at, comment_verifier from chantiers where id = ${q(id)}) x`).j
const journalDe = (id) => sql(`select regle, annule_at from rapprochements where chantier_id = ${q(id)}`)

console.log('verifier-rapprochement')
try {
  await purgerPassesPrecedentes(sql, PREFIXE)

  // ---- 1. Un dépôt « origine » (comme GitHub) et la copie de travail d'une session ----
  mkdirSync(W, { recursive: true })
  git(dossier, ['init', '-q', '--bare', '-b', 'main', BARE])
  git(BARE, ['config', 'uploadpack.allowFilter', 'true']); git(BARE, ['config', 'uploadpack.allowAnySHA1InWant', 'true'])
  git(W, ['init', '-q', '-b', 'main'])
  git(W, ['remote', 'add', 'origin', `file://${BARE}`])
  commit(W, 'README.md', 'Départ\n', 'Départ', ep(100))
  const sur = (branche, fichier, message, h) => { git(W, ['checkout', '-q', '-b', branche, 'main']); const sha = commit(W, fichier, `${branche}\n`, message, ep(h)); git(W, ['checkout', '-q', 'main']); return sha }
  sur('claude/b', 'src/b.txt', 'B : le code du chantier', 71.5)
  sur('claude/c', 'src/c.txt', 'C : le code du chantier', 71.4)
  const shaF = sur('claude/f', 'src/f.txt', 'F : du code, jamais fusionné', 71.3)
  sur('claude/e', 'PROJECT_LOG.md', 'E : une note de journal', 71.2)
  sur('claude/x', 'src/x.txt', 'X : travail de la PR 7', 71.1)
  sur('claude/t', 'src/t.txt', 'T : le bouton', 43.5)
  sur('claude/h', 'src/h.txt', 'H : la PR piégée', 42.5)
  const shaA = commit(W, 'src/a.txt', 'a\n', 'Chantier A : envoi direct sur main', ep(70))
  git(W, ['merge', '--no-ff', '-q', '-m', 'Merge pull request #5 from rnab26/claude/b', '-m', 'Banc : branche B', 'claude/b'], ep(48))
  git(W, ['merge', '--no-ff', '-q', '-m', 'Merge pull request #6 from rnab26/claude/c', '-m', 'Banc : branche C', 'claude/c'], ep(47))
  git(W, ['merge', '--no-ff', '-q', '-m', "Merge branch 'claude/e'", 'claude/e'], ep(46.5))
  const D = randomUUID(), S = randomUUID(), M = randomUUID(), H = randomUUID()
  const PIEGE = `Piège $fa$faits$its$'); select 1/0; -- \\ '' $$ $f0$`
  git(W, ['merge', '--no-ff', '-q', '-m', 'Merge pull request #7 from rnab26/claude/x', '-m', `Une PR (chantier ${D.slice(0, 8)})`, 'claude/x'], ep(46))
  commit(W, 'src/s.txt', 's\n', `Chantier ${S.slice(0, 8)} : tableau à jour (#8)`, ep(45))
  commit(W, 'src/m.txt', 'm\n', `Étape du chantier ${M.slice(0, 8)}`, ep(44))
  git(W, ['merge', '--no-ff', '-q', '-m', 'Merge pull request #9 from rnab26/claude/t', '-m', 'Bouton rouge du solde bas', 'claude/t'], ep(43))
  git(W, ['merge', '--no-ff', '-q', '-m', 'Merge pull request #10 from rnab26/claude/h', '-m', `${PIEGE} (chantier ${H.slice(0, 8)})`, 'claude/h'], ep(42))
  git(W, ['push', '-q', 'origin', 'main', 'claude/b', 'claude/f', 'claude/e']) // claude/c, x et t : supprimées après leur fusion (comme sur GitHub)
  verifie('le dépôt de test est prêt : main = 5 fusions de PR (dont une au texte piégé), 1 fusion de branche, 3 commits directs ; 3 branches gardées sur l\'origine', git(W, ['rev-list', '--first-parent', '--count', 'main']) === '10' && git(BARE, ['branch', '--list']).split('\n').length === 4, [git(W, ['rev-list', '--first-parent', '--count', 'main']), git(BARE, ['branch', '--list'])])

  // ---- 2. Les chantiers (tous « sans session » depuis 71 h, sauf L) ----
  sql(`insert into projets (id, slug, nom, depot, delai_sans_signe_min) values (${q(P)}, ${q(SLUG)}, 'Banc rapprochement GitHub', 'rnab26/test-inexistant', 120), (${q(P2)}, ${q(SLUG2)}, 'Banc rapprochement GitHub (vide)', 'rnab26/test-inexistant', 120)`)
  const il = (h) => new Date(Date.now() - h * 3600_000).toISOString()
  const ids = {}
  const ch = (cle, titre, o = {}) => {
    const id = o.id ?? randomUUID(); ids[cle] = id
    sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, jalons, created_at, updated_at) values (${q(id)}, ${q(P)}, ${q(titre)}, 'Test.', ${q(o.etat ?? 'en_cours')}, ${q(o.pris_par ?? null)}, ${q(JSON.stringify(o.jalons ?? {}))}::jsonb, ${q(il(o.cree ?? 72))}, ${q(il(o.trace ?? 71))})`)
    sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, updated_at) values (${q(P)}, ${q(id)}, ${q(o.pris_par ?? 'session-test')}, 'je travaille dessus', 50, 'en_cours', ${q(o.vivant ? new Date().toISOString() : il(o.trace ?? 71))})`)
    return id
  }
  ch('A', 'Jalon : le commit envoyé est dans main', { pris_par: 'claude/a', jalons: { pousse: { at: il(70), detail: `${shaA.slice(0, 7)} Chantier A : envoi direct sur main` } } })
  ch('B', 'Branche dédiée fusionnée par une PR', { pris_par: 'claude/b' })
  ch('C', 'PR dont la branche a été supprimée', { pris_par: 'claude/c' })
  ch('D', 'Titre de PR qui cite le chantier', { id: D, etat: 'libre' })
  ch('S', 'Squash cité par son numéro de PR', { id: S, etat: 'libre' })
  ch('T', 'Bouton rouge du solde bas', { etat: 'libre' })
  ch('H', 'Chantier cité par une PR au texte piégé', { id: H, etat: 'libre' })
  ch('E', 'Branche avec seulement du journal', { pris_par: 'claude/e' })
  ch('F', 'Branche jamais fusionnée', { pris_par: 'claude/f', jalons: { pousse: { at: il(71), detail: shaF.slice(0, 7) } } })
  ch('M', 'Simple mention dans un commit', { id: M, etat: 'libre' })
  ch('N', 'Jalon vers un commit inconnu', { pris_par: 'claude/n', jalons: { pousse: { at: il(70), detail: 'deadbee' } } })
  ch('R', 'Rappel : tenu sans trace', { pris_par: 'claude/rappel' })
  ch('L', 'Tenu par une session vivante', { pris_par: 'claude/live', vivant: true })
  // Les inserts d'activité « touchent » la fiche : on la vieillit (sauf L, vivant).
  sql(`set local session_replication_role = replica; update chantiers set updated_at = now() - interval '71 hours' where projet_id = ${q(P)} and id <> ${q(ids.L)}`)
  const ATTENDUS = { A: 'jalon', B: 'branche', C: 'branche', D: 'identifiant', S: 'identifiant', T: 'titre', H: 'identifiant' }
  const JAMAIS = ['E', 'F', 'M', 'N', 'R', 'L']
  const intact = () => JAMAIS.every((k) => ['en_cours', 'libre'].includes(etatDe(ids[k]).etat)) && Object.keys(ATTENDUS).every((k) => ['en_cours', 'libre'].includes(etatDe(ids[k]).etat))
  verifie('13 chantiers de test posés, tous ouverts, aucun passage encore', intact() && rapprocheAt(P) === null)

  // ---- 3. Dépôt injoignable : un message, rien d'écrit ----
  const cassee = path.join(dossier, 'session-cassee')
  mkdirSync(cassee); git(cassee, ['init', '-q', '-b', 'main']); git(cassee, ['remote', 'add', 'origin', 'https://rg-user:Sup3rS3cret@127.0.0.1:9/n-existe-pas.git'])   // refusé tout de suite ; l'adresse porte un identifiant qu'aucun message ne doit répéter
  const etatRg = () => une(`select cockpit.etat_rapprochement(${q(SLUG)}) as e`).e
  const hsEssai = collecteur(['--projet', SLUG, '--essai'], { cwd: cassee, cache: path.join(dossier, 'cache-vide-essai') })
  verifie('dépôt injoignable, passage d\'ESSAI : code 1, et aucun échec n\'est noté en base', hsEssai.code === 1 && etatRg().erreur === null, { hsEssai, e: etatRg() })
  const hs = collecteur(['--projet', SLUG], { cwd: cassee, cache: path.join(dossier, 'cache-vide') })
  verifie('dépôt injoignable : sortie en erreur (code 1) avec un message « Rapprochement GitHub : … », jamais une trace Python', hs.code === 1 && /^Rapprochement GitHub : /m.test(hs.err) && !/Traceback/.test(hs.err), hs)
  verifie('… rien n\'est livré ni daté, mais la CAUSE de l\'échec est notée (l\'écran « Chantiers et GitHub » l\'affiche)', intact() && rapprocheAt(P) === null && /impossible/.test(etatRg().erreur ?? '') && !!etatRg().erreur_at, etatRg())
  verifie('… sans aucun secret : l\'identifiant de l\'adresse n\'apparaît ni dans le message, ni en base', !/Sup3rS3cret/.test(hs.err + hs.out) && !/Sup3rS3cret/.test(etatRg().erreur ?? ''), { err: hs.err, erreur: etatRg().erreur })
  const masque = spawnSync('python3', ['-I', '-c', `import importlib.util;s=importlib.util.spec_from_file_location('r',${JSON.stringify(rapprocher)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.masquer('x https://u:Sup3rS3cret@h/p Authorization: Bearer abc.def.ghi-123 ghp_ABCDEFGHIJKLMNOPQRSTUV eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijk1234'))`], { encoding: 'utf8' })
  verifie('masquer() retire identifiants d\'adresse, en-têtes d\'autorisation, jetons GitHub et clés', masque.status === 0 && !/Sup3rS3cret|abc\.def\.ghi|ghp_ABCDEF|eyJhbGci/.test(masque.stdout) && /\*\*\*/.test(masque.stdout), masque)

  // ---- 4. Passage d'essai : dit tout, n'écrit rien, ne touche pas à la copie de travail ----
  const avant = photo(W)
  const essai = collecteur(['--projet', SLUG, '--essai', '--json'])
  let r = null; try { r = JSON.parse(essai.out) } catch { /* vérifié ci-dessous */ }
  verifie('--essai : sortie JSON lisible (malgré un texte de PR piégé : « $fa$faits$its$ », guillemets, requête), 7 chantiers « seraient livrés », 0 livré', essai.code === 0 && r && r.a_livrer === 7 && r.livres === 0, essai)
  const regle = Object.fromEntries((r?.actions ?? []).map((a) => [a.chantier, a.regle]))
  for (const [cle, attendu] of Object.entries(ATTENDUS)) verifie(`preuve ${cle} : règle « ${attendu} »`, regle[ids[cle]] === attendu, regle[ids[cle]])
  verifie('jamais livrés : branche de journal seul, branche non fusionnée, simple mention, commit inconnu, rappel, session vivante', JAMAIS.every((k) => !regle[ids[k]]), JAMAIS.filter((k) => regle[ids[k]]))
  verifie('compte : 12 examinés (sans session, sans question), 1 tenu par une session vivante laissé', r?.examines === 12 && r?.tenus_vivants === 1, { examines: r?.examines, vivants: r?.tenus_vivants })
  verifie('--essai n\'écrit RIEN en base (états, journal, date du passage)', intact() && rapprocheAt(P) === null && une(`select count(*)::int as n from rapprochements where projet_id = ${q(P)}`).n === 0)
  verifie('--essai ne pose PAS le repère des hooks (sinon le vrai passage lancé juste après par un hook est sauté 20 min : constaté sur le moteur, 13 oct.)', !existsSync(repere()), existsSync(repere()))
  verifie('la copie de travail de la session est intacte (références, état, tête, réglages, fichiers)', photo(W) === avant)
  const clone = path.join(CACHE, 'depots', SLUG)
  verifie('le clone d\'appoint est ISOLÉ (dossier de cache) et sans fichiers extraits', existsSync(path.join(clone, '.git')) && readdirSync(clone).join() === '.git', readdirSync(clone))

  // ---- 5. Le vrai passage ----
  const reel = collecteur(['--projet', SLUG])
  verifie('passage réel : code 0, « 7 livrés » et une ligne par chantier avec sa preuve', reel.code === 0 && /7 livrés\./.test(reel.out) && (reel.out.match(/^ {2}- « /gm) ?? []).length === 7, reel.out)
  const etats = Object.fromEntries(Object.keys(ATTENDUS).map((k) => [k, etatDe(ids[k])]))
  verifie('les 7 sont « à vérifier », libérés de toute réservation, jamais « validé »', Object.values(etats).every((e) => e.etat === 'a_verifier' && e.pris_par === null), etats)
  verifie('« Comment vérifier » donne un lien GitHub exact (jamais « validé » par le rapprochement)', Object.values(etats).every((e) => /https:\/\/github\.com\/rnab26\/test-inexistant\//.test(e.comment_verifier ?? '')), Object.values(etats).map((e) => e.comment_verifier))
  const dateFusion = (cle) => new Date(etats[cle].livre_at).getTime()
  verifie('chaque chantier est livré À LA DATE DE LA FUSION (pas à celle du passage) : B -48 h, D -46 h, A -70 h', Math.abs(dateFusion('B') - (Date.now() - 48 * 3600_000)) < 20 * 60_000 && Math.abs(dateFusion('D') - (Date.now() - 46 * 3600_000)) < 20 * 60_000 && Math.abs(dateFusion('A') - (Date.now() - 70 * 3600_000)) < 20 * 60_000, Object.fromEntries(Object.keys(ATTENDUS).map((k) => [k, etats[k].livre_at])))
  verifie('les autres ne bougent pas', JAMAIS.every((k) => ['en_cours', 'libre'].includes(etatDe(ids[k]).etat)) && etatDe(ids.E).pris_par === 'claude/e' && etatDe(ids.R).pris_par === 'claude/rappel')
  verifie('journal : 7 lignes, une règle chacune, aucune annulée', Object.entries(ATTENDUS).every(([k, reg]) => { const j = journalDe(ids[k]); return j.length === 1 && j[0].regle === reg && j[0].annule_at === null }))
  const dernierPassage = rapprocheAt(P)
  verifie('le passage est daté', dernierPassage !== null && Date.now() - new Date(dernierPassage).getTime() < 5 * 60_000, dernierPassage)
  verifie('… et ce passage réussi EFFACE l\'échec noté plus tôt', etatRg().erreur === null && etatRg().erreur_at === null, etatRg())
  const fil = sql(`select count(*)::int as n from messages where projet_id = ${q(P)} and kind = 'constat' and corps like 'Livré, d''après GitHub%'`)[0].n
  verifie('le fil de chaque chantier livré dit « Livré, d\'après GitHub » (7 lignes)', fil === 7, fil)
  const piege = sql(`select corps from messages where chantier_id = ${q(ids.H)} and corps like 'Livré, d''après GitHub%'`)[0]?.corps ?? ''
  verifie('le texte piégé d\'une PR est rangé tel quel et reste inerte (rien d\'exécuté, la preuve cite « $fa$faits$its$ » et « select 1/0 »)', piege.includes("Piège $fa$faits$its$'); select 1/0; --") && etatDe(ids.H).etat === 'a_verifier', piege)

  // ---- 6. Idempotent ; --si-ancien ; réglage « éteint » ----
  const deux = collecteur(['--projet', SLUG, '--json'])
  let r2 = null; try { r2 = JSON.parse(deux.out) } catch { /* vérifié ci-dessous */ }
  verifie('deuxième passage : rien de plus à livrer', deux.code === 0 && r2 && r2.a_livrer === 0 && r2.livres === 0, deux)
  await attendre(1100)
  const t1 = rapprocheAt(P)
  const frais = collecteur(['--projet', SLUG, '--si-ancien', '20', '--silencieux'])
  verifie('--si-ancien 20 juste après un passage : sort tout de suite, en silence, sans toucher à la base', frais.code === 0 && frais.out === '' && rapprocheAt(P) === t1, { out: frais.out, t1, t2: rapprocheAt(P) })
  const vieux = new Date(Date.now() - 30 * 60_000)
  utimesSync(repere(), vieux, vieux)
  const apres = collecteur(['--projet', SLUG, '--si-ancien', '20', '--silencieux'])
  verifie('… et repasse quand le dernier passage date de plus de 20 minutes', apres.code === 0 && rapprocheAt(P) !== t1, { avant: t1, apres: rapprocheAt(P) })

  sql(`select cockpit.regler_rapprochement(${q(SLUG)}, false)`)
  utimesSync(repere(), vieux, vieux)
  const t2 = rapprocheAt(P)
  await attendre(1100)
  const eteint = collecteur(['--projet', SLUG, '--si-ancien', '20', '--silencieux'])
  verifie('réglage « éteint » : les hooks (--si-ancien) ne passent plus', eteint.code === 0 && eteint.out === '' && rapprocheAt(P) === t2, { out: eteint.out })
  const manuel = collecteur(['--projet', SLUG, '--silencieux'])
  verifie('… mais un passage demandé à la main écrit toujours', manuel.code === 0 && rapprocheAt(P) !== t2)
  sql(`select cockpit.regler_rapprochement(${q(SLUG)}, true)`)

  // ---- 7. Du travail neuf dans main : le clone d'appoint se met à jour ----
  const shaP = commit(W, 'src/p.txt', 'p\n', 'Chantier P : envoi direct', ep(2.5))
  git(W, ['push', '-q', 'origin', 'main'])
  ch('P', 'Chantier posé après le premier passage', { pris_par: 'claude/p', cree: 4, trace: 3, jalons: { pousse: { at: il(2.5), detail: shaP.slice(0, 7) } } })
  sql(`set local session_replication_role = replica; update chantiers set updated_at = now() - interval '3 hours' where id = ${q(ids.P)}`)
  const neuf = collecteur(['--projet', SLUG])
  verifie('un commit poussé après le premier passage est vu (mise à jour du clone) : le nouveau chantier est livré', neuf.code === 0 && etatDe(ids.P).etat === 'a_verifier' && journalDe(ids.P)[0]?.regle === 'jalon', { out: neuf.out, etat: etatDe(ids.P) })
  verifie('les chantiers qui n\'avaient pas de preuve restent intacts', JAMAIS.every((k) => ['en_cours', 'libre'].includes(etatDe(ids[k]).etat)))

  // ---- 7 bis. Réglages généraux (0081) : l'interrupteur GÉNÉRAL et le délai du PROJET, lus par le collecteur (base simulée : on ne touche jamais au vrai interrupteur) ----
  const testPy = path.join(dossier, 'test-reglages.py')
  writeFileSync(testPy, `import importlib.util, json, os, sys, time
spec = importlib.util.spec_from_file_location('r', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cache = sys.argv[2]; os.makedirs(cache, exist_ok=True); os.environ['COCKPIT_CACHE'] = cache
repere = os.path.join(cache, 'rapproche-p.t')
etat = {'global': True, 'passage': 45, 'auto': True}; appels = []
def faux_sql(requete):
    appels.append(requete[:50])
    if 'from projets where slug' in requete:
        return [{'slug': 'p', 'depot': 'a/b', 'rapprochement_auto': etat['auto'], 'rapprochement_passage_min': etat['passage'], 'global_actif': etat['global']}]
    raise RuntimeError('stop : pas de dépôt dans ce test')
m.sql = faux_sql
def lancer(hook=True):
    sys.argv = ['rapprocher.py', '--projet', 'p', '--silencieux'] + (['--si-ancien', '20'] if hook else [])
    n = len(appels)
    try: code = m.main()
    except RuntimeError: code = 'stop'
    return code, len(appels) - n
def vieillir(minutes):
    t = time.time() - minutes * 60; os.utime(repere, (t, t))
sortie = {}
etat['global'] = False
sortie['general_eteint_hook'] = lancer()                      # sort après UNE lecture, rien d'autre
sortie['general_eteint_main'] = lancer(hook=False)            # demandé à la main : passe
etat['global'] = True
sortie['repere_apres_passage'] = open(repere).read().strip()  # le délai du projet (45) est noté pour le prochain hook
vieillir(30); sortie['trente_min_hook'] = lancer()            # 30 < 45 : sort sans appeler la base
vieillir(50); sortie['cinquante_min_hook'] = lancer()         # 50 > 45 : passe
open(repere, 'w').write('n importe quoi'); vieillir(25); sortie['repere_illisible_25_min'] = lancer()   # illisible : 20 par défaut, 25 > 20 : passe
open(repere, 'w').write('45'); vieillir(5); sortie['cinq_min_main'] = lancer(hook=False)   # à la main : passe toujours
etat['auto'] = False; vieillir(60); sortie['projet_eteint_hook'] = lancer()
# Un ESSAI ne consomme pas le repère des hooks (constaté sur le moteur, 13 oct. : mon essai avait fait sauter le vrai passage pendant 20 min).
def essai():
    sys.argv = ['rapprocher.py', '--projet', 'p', '--essai', '--silencieux']
    try: m.main()
    except RuntimeError: pass
os.remove(repere); essai(); sortie['essai_sans_repere'] = not os.path.exists(repere)
open(repere, 'w').write('45'); vieillir(5); avant = (os.path.getmtime(repere), open(repere).read()); essai()
sortie['essai_repere_intact'] = (os.path.getmtime(repere), open(repere).read()) == avant
print(json.dumps(sortie))
`)
  const py = spawnSync('python3', ['-I', testPy, rapprocher, path.join(dossier, 'cache-reglages')], { encoding: 'utf8', timeout: 60000 })
  let rg = null; try { rg = JSON.parse(py.stdout.trim().split('\n').pop()) } catch { /* vérifié ci-dessous */ }
  verifie('interrupteur GÉNÉRAL éteint : le hook sort après UNE seule lecture (code 0) ; demandé à la main, le passage a lieu quand même', rg && rg.general_eteint_hook[0] === 0 && rg.general_eteint_hook[1] === 1 && rg.general_eteint_main[0] === 'stop' && rg.general_eteint_main[1] >= 2, { rg, err: py.stderr.slice(-300) })
  verifie('le délai du PROJET est noté dans le repère après un passage (45 min), sans appel à la base pour le relire', rg && rg.repere_apres_passage === '45', rg)
  verifie('… 30 min après : le hook sort sans toucher à la base ; 50 min après : il passe', rg && rg.trente_min_hook[0] === 0 && rg.trente_min_hook[1] === 0 && rg.cinquante_min_hook[0] === 'stop' && rg.cinquante_min_hook[1] >= 2, rg)
  verifie('repère illisible : le délai des hooks (20 min) s\'applique ; un passage demandé à la main passe toujours ; projet éteint : le hook sort', rg && rg.repere_illisible_25_min[0] === 'stop' && rg.cinq_min_main[0] === 'stop' && rg.projet_eteint_hook[0] === 0 && rg.projet_eteint_hook[1] === 1, rg)
  verifie('un ESSAI ne crée pas le repère des hooks, et ne rafraîchit ni ne réécrit un repère déjà là (même date, même délai noté)', rg && rg.essai_sans_repere === true && rg.essai_repere_intact === true, rg)

  // ---- 8. Pannes et cas limites : jamais de plantage ----
  mkdirSync(SANS_ORIGINE)
  const vide = collecteur(['--projet', SLUG2], { cwd: SANS_ORIGINE })
  verifie('projet sans chantier ouvert : le dit, note le passage', vide.code === 0 && /aucun chantier ouvert sans session à vérifier/.test(vide.out) && rapprocheAt(P2) !== null, { out: vide.out, err: vide.err })
  sql(`update projets set depot = null where id = ${q(P2)}`)
  const sansDepot = collecteur(['--projet', SLUG2], { cwd: SANS_ORIGINE })
  verifie('ni dépôt réglé ni « origin » : dit qu\'il n\'y a rien à rapprocher, sans échec', sansDepot.code === 0 && /Aucun dépôt git/.test(sansDepot.err), sansDepot)
  const inconnu = collecteur(['--projet', `${PREFIXE}inconnu-${rand}`])
  verifie('projet inconnu : refusé (code 2) avec un message', inconnu.code === 2 && /Projet inconnu dans le cockpit/.test(inconnu.err), inconnu)
  const sansProjet = collecteur([])
  verifie('sans --projet ni COCKPIT_PROJET : refusé (code 2)', sansProjet.code === 2 && /--projet/.test(sansProjet.err), sansProjet)

  // ---- 9. Les hooks lancent le collecteur en tâche de fond, et rappellent la session qui tient un chantier sans trace ----
  mkdirSync(TMP); mkdirSync(HOOKDIR); git(HOOKDIR, ['init', '-q', '-b', 'claude/rappel'])
  const sortieStub = path.join(dossier, 'stub-sortie.json'), stub = path.join(dossier, 'stub-rapprocher.py')
  writeFileSync(stub, "import json, os, sys\nopen(os.environ['STUB_SORTIE'], 'w').write(json.dumps({'argv': sys.argv[1:], 'projet': os.environ.get('COCKPIT_PROJET'), 'cwd': os.getcwd()}))\n")
  const hook = (script, entree, extra = {}) => {
    rmSync(sortieStub, { force: true })
    const x = spawnSync('bash', [path.join(racine, 'hooks', script)], { input: JSON.stringify(entree), encoding: 'utf8', timeout: 60000,
      env: { ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: HOOKDIR, COCKPIT_SQL: sqlSh, TMPDIR: TMP, COCKPIT_RAPPROCHER: stub, STUB_SORTIE: sortieStub,
             COCKPIT_PROG_CMD: '/chemin/progression.sh', COCKPIT_CHANTIER_CMD: '/chemin/chantier.sh', ...extra } })
    let sortie = {}; try { sortie = JSON.parse((x.stdout || '').trim())?.hookSpecificOutput ?? {} } catch { sortie = { brut: (x.stdout || '').trim() } }
    return sortie
  }
  const attendreStub = async () => { for (let i = 0; i < 40 && !existsSync(sortieStub); i++) await attendre(250); return existsSync(sortieStub) ? JSON.parse(readFileSync(sortieStub, 'utf8')) : null }
  const NOTIF = '<task-notification>agent fini</task-notification>' // un vrai message ferait de cette session la chef du projet de test
  let o = hook('prompt-rappel.sh', { session_id: `test-rg-${rand}`, hook_event_name: 'UserPromptSubmit', prompt: NOTIF })
  const lance = await attendreStub()
  verifie('prompt-rappel.sh lance le collecteur en fond : --projet <slug> --si-ancien 20 --silencieux, depuis le dossier de la session', lance && lance.projet === SLUG && lance.argv.join(' ') === `--projet ${SLUG} --si-ancien 20 --silencieux` && lance.cwd === HOOKDIR, lance)
  const ctx = o.additionalContext ?? ''
  verifie('le rappel précis : le chantier tenu sans trace depuis longtemps (délai du PROJET, 4 h par défaut) est nommé (titre, identifiant, heures)', /SANS TRACE depuis longtemps/.test(ctx) && !/plus de 4 h/.test(ctx) && ctx.includes(ids.R) && /Rappel : tenu sans trace/.test(ctx) && /\d+ h sans trace/.test(ctx), ctx.slice(-600))
  verifie('… avec les trois issues et les vraies commandes du projet (terminé / étape / de côté)', /\/chemin\/progression\.sh --chantier <id> --termine/.test(ctx) && /\/chemin\/progression\.sh --chantier <id> --etape/.test(ctx) && /\/chemin\/chantier\.sh --de-cote <id>/.test(ctx), ctx.slice(-400))
  verifie('… et il ne réclame jamais un chantier qu\'une autre branche tient (E, B, L : pas dans ce rappel)', !ctx.includes(ids.E) && !ctx.includes(ids.L) && !ctx.includes(ids.B))
  o = hook('prompt-rappel.sh', { session_id: `test-rg1b-${rand}`, hook_event_name: 'UserPromptSubmit', prompt: NOTIF }, { COCKPIT_RAPPROCHEMENT: '0' })
  verifie('le rappel n\'est donné qu\'une fois par 30 min et par copie de travail : le message suivant n\'en porte plus (le contexte ne gonfle pas)', !/SANS TRACE/.test(o.additionalContext ?? ''), (o.additionalContext ?? '').slice(-200))
  o = hook('prompt-rappel.sh', { session_id: `test-rg1c-${rand}`, hook_event_name: 'UserPromptSubmit', prompt: NOTIF }, { COCKPIT_RAPPROCHEMENT: '0', COCKPIT_SANS_TRACE_MIN: '0' })
  verifie('… sauf avec un délai de 0 (à chaque message)', /SANS TRACE/.test(o.additionalContext ?? '') && (o.additionalContext ?? '').includes(ids.R))
  git(HOOKDIR, ['symbolic-ref', 'HEAD', 'refs/heads/claude/autre'])
  o = hook('prompt-rappel.sh', { session_id: `test-rg2-${rand}`, hook_event_name: 'UserPromptSubmit', prompt: NOTIF }, { COCKPIT_RAPPROCHEMENT: '0', COCKPIT_SANS_TRACE_MIN: '0' })
  await attendre(1500)
  verifie('une autre branche : aucun rappel ; COCKPIT_RAPPROCHEMENT=0 : le collecteur n\'est PAS lancé', !/SANS TRACE/.test(o.additionalContext ?? '') && !existsSync(sortieStub), o.additionalContext)
  hook('session-start.sh', { session_id: `test-rg3-${rand}`, hook_event_name: 'SessionStart', source: 'startup' })
  const demarrage = await attendreStub()
  verifie('session-start.sh lance aussi le collecteur en fond, avec les mêmes arguments', demarrage && demarrage.projet === SLUG && demarrage.argv.join(' ') === `--projet ${SLUG} --si-ancien 20 --silencieux`, demarrage)
  hook('session-start.sh', { session_id: `test-rg4-${rand}`, hook_event_name: 'SessionStart', source: 'startup' }, { COCKPIT_RAPPROCHEMENT: '0' })
  await attendre(1500)
  verifie('session-start.sh avec COCKPIT_RAPPROCHEMENT=0 : rien n\'est lancé', !existsSync(sortieStub))

  // ---- 9. Le moteur est un projet comme les autres (13 oct.) : ses sessions n'ont pas le bloc de gestes que brancher.sh écrit chez les projets branchés, ----
  // ---- donc son CLAUDE.md les porte. Garde contre un « alléger le CLAUDE.md » qui les retirerait, et contre une dérive d'avec le bloc (la source). ----
  const compact = (t) => t.replace(/\s+/g, ' ')
  const claudeMoteur = compact(readFileSync(path.join(racine, 'CLAUDE.md'), 'utf8'))
  const blocSource = compact(readFileSync(path.join(racine, 'docs', 'bloc-CLAUDE.md'), 'utf8'))
  const gestes = ['--jalon pousse --detail', '--de-cote', '--abandonner', 'SANS TRACE', '--point']
  verifie('le bloc source porte les quatre gestes de session (jalon à chaque envoi, terminer/de côté, rappel SANS TRACE, verdict dans le fil)', gestes.every((g) => blocSource.includes(g)), gestes.filter((g) => !blocSource.includes(g)))
  verifie('le CLAUDE.md du moteur les porte aussi, et renvoie au bloc comme source unique', gestes.every((g) => claudeMoteur.includes(g)) && claudeMoteur.includes('docs/bloc-CLAUDE.md'), gestes.filter((g) => !claudeMoteur.includes(g)))
} catch (e) {
  total++; echecs++
  console.log(`  ✗ exception : ${e.stack ?? e.message}`)
} finally {
  try {
    await purgerProjetsDeTest(sql, [P, P2], PREFIXE)
    verifie('nettoyage : les projets jetables sont supprimés', sql(`select count(*)::int as n from projets where slug like ${q(PREFIXE + rand + '%')}`)[0].n === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  rmSync(dossier, { recursive: true, force: true })
  console.log(`\nverifier-rapprochement : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
