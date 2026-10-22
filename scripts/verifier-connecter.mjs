// scripts/connecter.sh : brancher une session À LA MAIN quand les hooks du dépôt ne se sont pas chargés (13 oct. 2026).
// Raphaël : « le projet Cockpit n'est pas branché, je ne sais pas pourquoi ». Cause prouvée : une session ouverte sur plusieurs
// dépôts démarre dans /home/user, où aucun hook de projet ne tourne. Ce banc rejoue ce cas EXACT : la commande est lancée
// depuis un dossier qui n'est pas un dépôt, sur un projet jetable `test-connecter-…` (supprimé à la fin).
// Usage : node scripts/verifier-connecter.mjs
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from './bancs.mjs'

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlSh = path.join(racine, 'scripts', 'sql.sh')
const connecter = path.join(racine, 'scripts', 'connecter.sh')
const PREFIXE = 'test-connecter-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8' })); if (!j.ok) throw new Error(j.error); return j.rows }
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); if (!ok) echecs++ }
const lancer = (args, env = {}, cwd) => {
  try { return { code: 0, sortie: execFileSync('bash', [connecter, ...args], { encoding: 'utf8', cwd, env: { ...process.env, COCKPIT_PRESENCE: 'off', ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }) } }
  catch (e) { return { code: e.status ?? 1, sortie: `${e.stdout ?? ''}${e.stderr ?? ''}` } }
}

console.log('verifier-connecter')
const projetId = randomUUID()
const dossierNu = mkdtempSync(path.join(tmpdir(), 'cockpit-sans-depot-'))
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  sql(`insert into projets (id, slug, nom, depot) values ('${projetId}', '${SLUG}', 'Test connecter (s’efface seul)', 'rnab26/test-inexistant')`)
  // exec_sql rend `null` (et non un objet) pour une ligne dont toutes les colonnes sont vides : on le ramène à « jamais ».
  const vu = () => sql(`select to_jsonb(x) as j from (select branchement_vu_at as t, extract(epoch from (now() - branchement_vu_at)) as age from projets where id = '${projetId}') x`)[0]?.j ?? { t: null, age: null }
  verifie('avant : le projet n’a jamais été branché', vu().t === null)

  // Le cas du 13 oct. : session sans hook, dans un dossier qui n'est PAS un dépôt, avec son identifiant de session.
  const sid = randomUUID()
  const r = lancer(['--projet', SLUG], { CLAUDE_CODE_SESSION_ID: sid, COCKPIT_PROJET: '' }, dossierNu)
  verifie('depuis un dossier sans dépôt : la commande réussit et dit « Session branchée au cockpit »', r.code === 0 && /Session branchée au cockpit : projet « test-connecter-/.test(r.sortie), r)
  verifie('elle montre l’état du projet (le même texte que le hook de démarrage)', /état au démarrage de cette session/.test(r.sortie) && /Chantiers ouverts|Aucun chantier/.test(r.sortie), r.sortie.slice(0, 300))
  verifie('elle dit que la session est déclarée dans l’app (identifiant court + branche)', new RegExp(`déclarée dans l'app : oui \\(session ${sid.slice(0, 8)}`).test(r.sortie), r.sortie.slice(0, 200))
  verifie('en base : la preuve « branché » est posée à l’instant (branchement_vu_at)', vu().t !== null && Number(vu().age) < 90, vu())
  const s = sql(`select id, branche, fin_at from sessions where id::text = '${sid}'`)
  verifie('en base : la session est listée, vivante', s.length === 1 && s[0].fin_at === null, s)

  // Sans identifiant de session (variable absente) : l'état s'affiche quand même, et la commande dit ce qui manque.
  const sans = lancer(['--projet', SLUG], { CLAUDE_CODE_SESSION_ID: '', COCKPIT_PROJET: '' }, dossierNu)
  verifie('sans CLAUDE_CODE_SESSION_ID : l’état s’affiche, et la commande dit que la session ne sera pas listée', sans.code === 0 && /ne sera pas listée/.test(sans.sortie) && /état au démarrage/.test(sans.sortie), sans)

  // Erreurs claires, rien d'écrit.
  const inconnu = lancer(['--projet', `${PREFIXE}inexistant-${randomUUID().slice(0, 6)}`], { CLAUDE_CODE_SESSION_ID: sid }, dossierNu)
  verifie('projet inconnu : échec net (code 1), aucun faux « branché »', inconnu.code === 1 && !/Session branchée/.test(inconnu.sortie), inconnu)
  const mauvais = lancer(['--n-importe-quoi'], {}, dossierNu)
  verifie('argument inconnu : refusé (code 2) avec l’usage', mauvais.code === 2 && /usage/.test(mauvais.sortie), mauvais)
  const aide = lancer(['--help'], {}, dossierNu)
  verifie('--help dit à quoi ça sert (la cause du débranchement)', aide.code === 0 && /plusieurs dépôts/i.test(aide.sortie), aide.sortie.slice(0, 200))
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    await purgerProjetsDeTest(sql, [projetId], PREFIXE)
    verifie('nettoyage : le projet jetable est supprimé', sql(`select count(*)::int as n from projets where slug like '${PREFIXE}%'`)[0].n === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  rmSync(dossierNu, { recursive: true, force: true })
  console.log(`\nverifier-connecter : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
