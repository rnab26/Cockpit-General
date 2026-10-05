// Survie des données côté SESSIONS (chantier 5b68a493) : quand la base est injoignable,
// scripts/sql.sh garde les écritures dans une file locale et les rejoue, dans l'ordre, au
// premier appel qui passe ; une lecture n'est jamais gardée ; un SQL refusé n'est jamais jeté.
// Projet jetable `test-sqlfile-…`, supprimé à la fin. Court (~20 s).
// Usage : node scripts/verifier-hors-ligne.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from './bancs.mjs'

const sqlSh = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'sql.sh')
const PREFIXE = 'test-sqlfile-'
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`
const DOSSIER = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'file-attente-'))
let total = 0, echecs = 0
const verifie = (nom, ok, detail) => { total++; console.log(`  ${ok ? '✓' : '✗'} ${nom}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); if (!ok) echecs++ }
const lancer = (args, env = {}) => spawnSync(sqlSh, args, { encoding: 'utf8', env: { ...process.env, COCKPIT_FILE_ATTENTE: DOSSIER, ...env } })
// « Pas de réseau » : on vise un nom qui n'existe pas, sans passer par le proxy (curl 6 = DNS).
const HORS = { SUPABASE_URL: 'https://base-injoignable.invalid', HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '' }
const sql = (q) => { const j = JSON.parse(execFileSync(sqlSh, [q], { encoding: 'utf8', env: { ...process.env, COCKPIT_FILE_ATTENTE: DOSSIER } })); if (!j.ok) throw new Error(j.error); return j.rows }
const fichiers = () => (existsSync(DOSSIER) ? readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')) : [])
let projetId = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  projetId = randomUUID()
  sql(`insert into projets (id, slug, nom, couleur, actif, description) values ('${projetId}', '${SLUG}', 'Test file (s’efface seul)', '#64748B', true, 'avant')`)

  console.log('base injoignable')
  const lecture = lancer(['select slug from projets limit 1'], HORS)
  verifie('une LECTURE échoue comme avant (code 1) et n’est pas gardée', lecture.status === 1 && fichiers().length === 0, { s: lecture.status, f: fichiers() })
  const e1 = lancer([`update projets set description = 'rejoué 1' where slug = '${SLUG}'`], HORS)
  verifie('une écriture est GARDÉE : code 0, en_attente, fichier créé', e1.status === 0 && /"en_attente": ?true/.test(e1.stdout) && fichiers().length === 1, { s: e1.status, out: e1.stdout, err: e1.stderr })
  verifie('elle le dit sur stderr', /GARDÉE/.test(e1.stderr), e1.stderr)
  const e2 = lancer([`update projets set description = 'rejoué 2' where slug = '${SLUG}'`], HORS)
  const e3 = lancer(['update table_qui_nexiste_pas set a = 1'], HORS)
  const e4 = lancer([`select poser_jalon('${randomUUID()}'::uuid, 'code', null)`], HORS)
  verifie('plusieurs écritures s’empilent (update, select fonction(…) sans from)', fichiers().length === 4, { f: fichiers(), e3: e3.status, e4: e4.status })
  // Lu avec un AUTRE dossier de file (vide) : cette lecture ne doit pas déclencher le rejeu.
  const vide = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'file-vide-'))
  const avant = lancer([`select description from projets where slug = '${SLUG}'`], { COCKPIT_FILE_ATTENTE: vide })
  rmSync(vide, { recursive: true, force: true })
  verifie('rien n’est arrivé en base pendant la coupure', JSON.parse(avant.stdout).rows[0].description === 'avant', avant.stdout)

  console.log('retour du réseau')
  const r = lancer(['select 1 as un'])
  verifie('le premier appel qui passe répond normalement', r.status === 0 && /"un": 1/.test(r.stdout), r.stdout + r.stderr)
  verifie('la file est vidée : plus rien ne reste en attente', fichiers().length === 0, fichiers())
  verifie('écrit dans l’ORDRE : la dernière valeur gagne (« rejoué 2 »)', sql(`select description from projets where slug = '${SLUG}'`)[0].description === 'rejoué 2')
  const refuses = existsSync(path.join(DOSSIER, 'refuses')) ? readdirSync(path.join(DOSSIER, 'refuses')) : []
  verifie('un SQL refusé n’est pas jeté : gardé dans refuses/', refuses.length >= 1, refuses)
  verifie('et l’appel le signale (stderr)', /REFUSÉE/.test(r.stderr), r.stderr)
  const rien = lancer(['--rejouer'])
  verifie('--rejouer sans rien en attente : silencieux, code 0', rien.status === 0)
} catch (e) {
  echecs++; total++
  console.log(`  ✗ exception : ${e.message}`)
} finally {
  try {
    if (projetId) await purgerProjetsDeTest((q) => sql(q), [projetId], PREFIXE)
    verifie('nettoyage : le projet jetable est supprimé', sql(`select count(*)::int as n from projets where slug = '${SLUG}'`)[0].n === 0)
  } catch (e) { console.log(`  (nettoyage : ${e.message})`) }
  rmSync(DOSSIER, { recursive: true, force: true })
  console.log(`\nverifier-hors-ligne (sessions) : ${total - echecs}/${total}`)
  process.exit(echecs ? 1 : 0)
}
