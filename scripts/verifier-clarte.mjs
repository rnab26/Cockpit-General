// Règle de clarté, vocabulaire (6 oct. 2026, chantier ca171345) : sans base, sans réseau.
// Les cas viennent de vrais textes lus par Raphaël (cartes « À toi », « comment vérifier »).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const CLARTE = fileURLToPath(new URL('./clarte.py', import.meta.url))
let ok = 0, ko = 0
const lance = (...champs) => spawnSync('python3', ['-I', CLARTE], { input: champs.join('\0') + '\0', encoding: 'utf8' })
const verifie = (nom, cond, detail = '') => { if (cond) { ok++; console.log('  ✓ ' + nom) } else { ko++; console.log('  ✗ ' + nom + ' ' + detail) } }

// Refusés : du jargon de développeur dans ce que Raphaël lit
const refuses = [
  ['endpoint RunPod', 'RunPod > endpoint prod > Edit : ne garder que 48 GB'],
  ['hook', 'Le hook est propagé au prochain démarrage'],
  ['migration', 'Applique la migration 0069 sur la base'],
  ['commit/branche', 'Vérifie le commit sur la branche agent/12'],
  ['script', 'Lance scripts/progression.sh --chantier X'],
  ['déployer', 'Déploie la fonction une fois en fin de lot'],
]
for (const [nom, t] of refuses) { const r = lance('x', t); verifie('refusé : ' + nom, r.status === 2 && /clarté/.test(r.stderr) && /plutôt/.test(r.stderr), r.stderr) }

// Acceptés : mots simples, bouton entre « », adresse, code
const acceptes = [
  ['phrase simple', 'Ouvre la page, touche « + Chantier » et tape un titre.'],
  ['bouton technique entre « »', 'Touche « Merge pull request » puis « Confirm merge ».'],
  ['adresse avec api', 'Ouvre https://example.org/api/v1 sur ton téléphone.'],
  ['« celui-ci » et « ci-dessous »', 'Touche « Compléter celui-ci », puis lis la suite ci-dessous.'],
  ['PR et mots courants', 'Fusionne la PR #12 : le texte des cartes devient plus simple.'],
]
for (const [nom, t] of acceptes) { const r = lance('x', t); verifie('accepté : ' + nom, r.status === 0, r.stderr) }

// Un message de refus nomme le champ et le mot
const r = lance('--question', 'Faut-il déployer ?', '--pourquoi', 'ok')
verifie('le refus dit quel champ et quel mot', r.status === 2 && /--question/.test(r.stderr) && /déployer/i.test(r.stderr), r.stderr)

console.log(`\nverifier-clarte : ${ok}/${ok + ko}`)
process.exit(ko ? 1 : 0)
