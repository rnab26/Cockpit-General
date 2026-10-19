#!/usr/bin/env node
// Hook utilisateur (hooks/utilisateur.sh) : une session ouverte sur plusieurs dépôts est branchée toute seule.
// Hors ligne, sans base : faux dépôts branchés dans un dossier jetable, hooks factices qui écrivent leur appel.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ICI = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(ICI, 'hooks', 'utilisateur.sh')
let ok = 0, ko = 0
const verifier = (nom, cond, detail = '') => { if (cond) { ok++; console.log('  ok  ' + nom) } else { ko++; console.log('  ECHEC ' + nom + (detail ? ' : ' + detail : '')) } }

const racine = mkdtempSync(join(tmpdir(), 'verif-utilisateur-'))
function depot(nom, slug) {
  const d = join(racine, nom); mkdirSync(join(d, '.claude'), { recursive: true }); mkdirSync(join(d, 'hooks'), { recursive: true })
  const hook = (n, sortie) => { writeFileSync(join(d, 'hooks', n), `#!/usr/bin/env bash\ncat >/dev/null\necho "$COCKPIT_PROJET|$CLAUDE_PROJECT_DIR|${n}|$AUTRE" >> "${racine}/appels.log"\n${sortie}\n`) }
  hook('start.sh', `printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"ETAT ${slug}"}}'`)
  hook('suivi.sh', 'true')
  hook('stop.sh', `printf '{"decision":"block","reason":"reponds ${slug}"}'`)
  const c = (f) => ({ hooks: [{ type: 'command', command: `bash "$CLAUDE_PROJECT_DIR"/hooks/${f}` }] })
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({
    env: { COCKPIT_PROJET: slug, AUTRE: 'valeur' },
    hooks: { SessionStart: [c('start.sh')], UserPromptSubmit: [c('suivi.sh')], Stop: [c('suivi.sh'), c('stop.sh')] },
  }))
  return d
}
function lancer(evenement, env = {}, charge = {}) {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: evenement, session_id: 's1', ...charge }),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, COCKPIT_RACINE_DEPOTS: racine, CLAUDE_PROJECT_DIR: racine, ...env }, encoding: 'utf8',
  })
  return { code: r.status, out: r.stdout.trim() }
}
const appels = () => (existsSync(join(racine, 'appels.log')) ? readFileSync(join(racine, 'appels.log'), 'utf8') : '')
const vider = () => rmSync(join(racine, 'appels.log'), { force: true })

try {
  // 1. Aucun dépôt branché : silence.
  mkdirSync(join(racine, 'autre', '.claude'), { recursive: true }); writeFileSync(join(racine, 'autre', '.claude', 'settings.json'), '{}')
  let r = lancer('SessionStart')
  verifier('aucun dépôt branché : silence, sortie 0', r.code === 0 && r.out === '' && appels() === '')

  // 2. Un seul dépôt branché : ses hooks tournent, avec le bon projet et le bon dossier.
  const fp = depot('Facepro', 'facepro')
  r = lancer('SessionStart')
  verifier("démarrage : l'état du projet arrive dans le contexte", r.code === 0 && JSON.parse(r.out).hookSpecificOutput.additionalContext === 'ETAT facepro', r.out)
  verifier('le hook du dépôt tourne avec COCKPIT_PROJET, CLAUDE_PROJECT_DIR et le reste de son env', appels().includes(`facepro|${fp}|start.sh|valeur`), appels())
  vider()
  r = lancer('UserPromptSubmit')
  verifier('message : le suivi du dépôt tourne (session visible)', appels().includes(`facepro|${fp}|suivi.sh`) && r.out === '', appels())
  vider()
  r = lancer('Stop')
  verifier("arrêt : le refus d'arrêt du hook du dépôt est transmis", r.out && JSON.parse(r.out).decision === 'block' && appels().includes('stop.sh'), r.out)
  vider()
  r = lancer('PostToolUse', {}, { tool_name: 'Bash' })
  verifier('un événement que le dépôt ne déclare pas : silence', r.out === '' && appels() === '')

  // 3. Session déjà branchée (hooks du projet) : jamais de doublon.
  r = lancer('SessionStart', { COCKPIT_PROJET: 'facepro' })
  verifier('COCKPIT_PROJET déjà posé : rien (pas de doublon)', r.out === '' && appels() === '')
  r = lancer('SessionStart', { CLAUDE_PROJECT_DIR: fp })
  verifier('session née dans un dépôt branché : rien (ses hooks tournent déjà)', r.out === '' && appels() === '')
  r = lancer('SessionStart', { COCKPIT_UTILISATEUR: 'off' })
  verifier('COCKPIT_UTILISATEUR=off : rien', r.out === '' && appels() === '')

  // 4. Plusieurs dépôts branchés : on ne devine pas, on le dit au démarrage seulement.
  // (Plusieurs dépôts : choix sur des SIGNES, gardé pour la session.)
  const ml = depot('Melissa', 'melissa-nabet')
  const home = join(racine, 'home'); const E = { COCKPIT_HOME: home }
  r = lancer('SessionStart', E, { session_id: 'A' })
  const t = r.out ? JSON.parse(r.out).hookSpecificOutput.additionalContext : ''
  verifier('deux dépôts, aucun signe : aucun hook de projet lancé', appels() === '', appels())
  verifier('aucun signe : le message nomme les deux et donne connecter.sh --depot', t.includes('facepro') && t.includes('melissa-nabet') && t.includes('--depot'), t)
  r = lancer('UserPromptSubmit', E, { session_id: 'A', prompt: 'bonjour, on continue' })
  verifier('aucun signe aux messages suivants : muet, rien lancé', r.out === '' && appels() === '')
  r = lancer('UserPromptSubmit', E, { session_id: 'A', prompt: 'et le cockpit de facepro et melissa nabet ?' })
  verifier('un message nomme DEUX projets : on ne devine pas', appels() === '', appels())
  r = lancer('PostToolUse', E, { session_id: 'B', cwd: ml, tool_name: 'Bash' })
  r = lancer('UserPromptSubmit', E, { session_id: 'B', prompt: 'autre chose' })
  verifier('dossier courant dans un dépôt : branchée sur celui-ci, et le choix tient ensuite', appels().includes(`melissa-nabet|${ml}|suivi.sh`) && !appels().includes('facepro'), appels())
  vider()
  r = lancer('PostToolUse', E, { session_id: 'C', tool_name: 'Edit', tool_input: { file_path: join(fp, 'x.py') } })
  r = lancer('Stop', E, { session_id: 'C' })
  verifier("fichier touché dans un dépôt : branchée sur celui-ci (refus d'arrêt transmis)", r.out.includes('reponds facepro') && !appels().includes('melissa'), r.out + appels())
  vider()
  r = lancer('UserPromptSubmit', E, { session_id: 'D', prompt: 'regarde le projet FacePro stp' })
  verifier('un message qui nomme UN projet : branchée sur celui-ci', appels().includes(`facepro|${fp}|suivi.sh`), appels())
  vider()
  mkdirSync(join(home, 'sessions'), { recursive: true }); writeFileSync(join(home, 'sessions', 'E.depot'), ml + '\n')
  r = lancer('Stop', E, { session_id: 'E' })
  verifier('choix posé par connecter.sh --depot : respecté', r.out.includes('reponds melissa-nabet'), r.out)
  vider()

  // 5. Entrée vide : sortie 0, jamais d'échec.
  const v = spawnSync('bash', [HOOK], { input: '', env: { PATH: process.env.PATH, COCKPIT_RACINE_DEPOTS: racine }, encoding: 'utf8' })
  verifier('entrée vide : sortie 0', v.status === 0)
  // 6. Le script est déclaré dans la liste du lanceur, sinon il n'arrive jamais dans le cache des sessions.
  verifier('hooks/utilisateur.sh figure dans modeles/fichiers.txt', readFileSync(join(ICI, 'modeles', 'fichiers.txt'), 'utf8').split('\n').includes('hooks/utilisateur.sh'))
} finally { rmSync(racine, { recursive: true, force: true }) }
console.log(`\n${ok} ok, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
