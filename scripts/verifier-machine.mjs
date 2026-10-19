// Battement machine (19 oct. 2026, migration 0104, chantier a33cf882) : le vrai hook, le vrai processus détaché, un vrai calcul.
//   node scripts/verifier-machine.mjs        (≈ 3 min, 1 cœur : un calcul de 80 s, un battement toutes les 30 s)
// Projet jetable `test-machine-…` (supprimé à la fin) ; le calcul porte un identifiant de session de test, jamais la vraie session.
// Prouve : (1) ÉTEINT par défaut : le hook lance le processus, la base répond « eteint », il s'arrête seul, et le hook ne le relance pas
// tout de suite ; (2) allumé : un calcul lancé DÉTACHÉ (setsid, reparenté à init, comme un calcul d'arrière-plan) est vu et la session, muette
// depuis 90 min, devient « au travail » grâce à lui seul ; (3) le calcul fini, le processus s'arrête seul (rien ne tourne = plus de battement) ;
// (4) le coût réel : temps CPU du battement et nombre d'appels à la base.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from './bancs.mjs'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const SQL = join(RACINE, 'scripts/sql.sh')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY absente.'); process.exit(2) }
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? ' — ' + String(detail).slice(0, 400) : ''}`) } }
const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
function sql(requete) {
  const r = spawnSync(SQL, [requete], { encoding: 'utf8', env: { ...process.env, COCKPIT_PROJET: process.env.COCKPIT_PROJET || 'cockpit' } })
  const j = JSON.parse(r.stdout || '{}')
  if (!j.ok) throw new Error(`SQL refusé : ${j.error ?? r.stderr}\n  ${requete.slice(0, 200)}`)
  return j.rows ?? []
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const PAS = 30, CALCUL_S = 50
const SLUG = `test-machine-${randomUUID().slice(0, 8)}`, P = randomUUID(), SID = `banc-machine-${randomUUID().slice(0, 8)}`
const dossier = mkdtempSync(join(tmpdir(), 'cockpit-machine-'))
const TMP = join(dossier, 'tmp'); mkdirSync(TMP)
const DEPOT = join(dossier, 'depot'); mkdirSync(DEPOT)
spawnSync('git', ['init', '-q', '-b', 'claude/test-machine', DEPOT])
const env = { ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: DEPOT, COCKPIT_SQL: SQL, TMPDIR: TMP, COCKPIT_MACHINE_CLAUDE_PID: '0', COCKPIT_MACHINE_ETEINT_S: '1', COCKPIT_MACHINE_RETENTE_S: '1', COCKPIT_BATTEMENT_MAX: '1' }   // pas de battement de tour : il rafraîchirait vu_at et masquerait la preuve mesurée
const hook = () => spawnSync('bash', [join(RACINE, 'hooks/suivi.sh')], {
  encoding: 'utf8', timeout: 60000, env,
  input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: SID, cwd: DEPOT, tool_name: 'Read', tool_input: {}, tool_response: {} }),
})
const pidf = join(TMP, `cockpit-machine-pid-${SID}`)
const pidBattement = () => (existsSync(pidf) ? Number(readFileSync(pidf, 'utf8').trim()) : 0)
const vivant = (pid) => pid > 0 && existsSync(`/proc/${pid}`) && !/^Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1] ?? '')
const ticks = (pid) => { try { const c = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return Number(c[11]) + Number(c[12]) } catch { return null } }
let calcul = null
try {
  await purgerPassesPrecedentes(sql, 'test-machine-')
  sql(`insert into projets (id, slug, nom, depot, machine_pas_s, machine_fraicheur_min) values (${q(P)}, ${q(SLUG)}, 'Test machine', 'rnab26/test-machine', ${PAS}, 2)`)

  console.log('1. Éteint par défaut')
  hook()
  await dormir(4000)
  let p1 = pidBattement()
  verifie('le hook a lancé le processus détaché (pid noté)', p1 > 0, p1)
  verifie('la base a répondu « eteint » : le processus s’est arrêté tout seul', !vivant(p1), p1)
  verifie('rien n’est écrit sur la session (aucune mesure retenue)', sql(`select machine_vu_at is null as n from sessions where id = ${q(SID)}`)[0]?.n === true)
  verifie('le hook a posé sa marque « éteint » (pas de relance à chaque outil)', existsSync(join(TMP, `cockpit-machine-eteint-${SID}`)))

  console.log('2. Allumé : un vrai calcul détaché est vu')
  sql(`update projets set machine_actif = true where id = ${q(P)}`)
  rmSync(join(TMP, `cockpit-machine-eteint-${SID}`), { force: true })
  // un calcul d'arrière-plan : détaché (setsid), reparenté à init, qui porte l'identifiant de la session — comme une commande lancée en arrière-plan
  calcul = spawn('python3', ['-c', `import time\nfin=time.time()+${CALCUL_S}\nwhile time.time()<fin: pass`], { detached: true, stdio: 'ignore', env: { ...process.env, CLAUDE_CODE_SESSION_ID: SID } })
  calcul.unref()
  hook()
  await dormir(1500)
  const pid = pidBattement()
  verifie('le hook relance le battement (le calcul tourne)', vivant(pid), pid)
  // la session est muette : seul le calcul mesuré peut la rendre « au travail »
  sql(`update sessions set vu_at = now() - interval '90 minutes', demarre_at = now() - interval '5 hours', tour_en_cours = false where id = ${q(SID)}`)
  const etat = () => sql(`select cockpit.etat_session(s) as e, machine_cpu_pct, machine_procs from sessions s where id = ${q(SID)}`)[0]
  const avant = etat()
  verifie('avant la 2e mesure : session muette depuis 90 min = « absente »', avant.e === 'absente', JSON.stringify(avant))
  const t0 = Date.now(); let cpu0 = ticks(pid), vu = null
  while (Date.now() - t0 < (PAS + 25) * 1000) { await dormir(5000); vu = etat(); if (vu.e === 'au_travail') break }
  verifie('après la 2e mesure : la session muette est « au travail » grâce au calcul seul', vu?.e === 'au_travail', JSON.stringify(vu))
  verifie('le calcul est mesuré à plein régime (≥ 80 % d’un cœur) avec au moins 1 processus', (vu?.machine_cpu_pct ?? 0) >= 80 && (vu?.machine_procs ?? 0) >= 1, JSON.stringify(vu))

  console.log('3. Le calcul fini, le battement s’arrête seul')
  const fin = Date.now() + (CALCUL_S + 2 * PAS + 40) * 1000
  let derniersTicks = cpu0
  while (vivant(pid) && Date.now() < fin) { await dormir(5000); derniersTicks = ticks(pid) ?? derniersTicks }
  verifie('le processus de mesure s’est arrêté tout seul (rien ne tourne : plus de battement)', !vivant(pid), pid)
  const apres = etat()
  verifie('dernière mesure : calcul fini (CPU bas, 0 processus)', (apres.machine_cpu_pct ?? 99) < 5 && apres.machine_procs === 0, JSON.stringify(apres))
  verifie('et la session muette n’est plus « au travail » une fois la preuve périmée (2 min)', (() => { sql(`update sessions set machine_actif_at = now() - interval '3 minutes' where id = ${q(SID)}`); const x = etat(); verifie.detail = JSON.stringify(x); return x.e === 'absente' })(), (() => JSON.stringify(sql(`select vu_at, demarre_at, tour_en_cours, machine_actif_at, now() as maintenant from sessions where id = ${q(SID)}`)))())

  console.log('4. Coût mesuré')
  const duree = (Date.now() - t0) / 1000
  const appels = Math.round(duree / PAS)
  console.log(`  (battement : ${derniersTicks ?? '?'} ticks CPU (1 tick = 10 ms) en ≈ ${Math.round(duree)} s de vie, ≈ ${appels} appels à la base (1 toutes les ${PAS} s))`)
  verifie('le coût du battement est négligeable (moins de 1 % d’un cœur sur sa vie)', derniersTicks === null || derniersTicks / 100 / duree < 0.01, derniersTicks)
} finally {
  try { if (calcul?.pid) process.kill(calcul.pid, 'SIGKILL') } catch { /* déjà fini */ }
  try { const p = pidBattement(); if (p) process.kill(p, 'SIGKILL') } catch { /* déjà fini */ }
  try { await purgerProjetsDeTest(async (x) => sql(x), [P], 'test-machine-') } catch (x) { console.log('  (nettoyage : ' + x.message + ')') }
  try { sql(`delete from sessions where id = ${q(SID)}`) } catch { /* purgée avec le projet */ }
  rmSync(dossier, { recursive: true, force: true })
}
const reste = sql(`select count(*)::int n from projets where slug like 'test-machine-%'`)[0].n
verifie('aucun projet « test-machine-… » ne reste', reste === 0, reste)
console.log(`\nverifier-machine : ${total - echecs}/${total}`)
process.exit(echecs ? 1 : 0)
