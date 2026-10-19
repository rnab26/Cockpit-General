// Fusion automatique des PR sûres (19 oct. 2026, chantier f4a4e3f3) : sans base, sans réseau, tourne aussi dans la CI.
//  A. la règle d'éligibilité (scripts/fusion_auto.py) sur une table de cas ;
//  B. toutes ses raisons passent la règle de clarté (Raphaël les lit sur la carte) ;
//  C. la liste « mise en ligne relancée » = le bloc paths de deploy.yml (une seule vérité, vérifiée ici) ;
//  D. le workflow fusion-auto.yml : pas de checkout, jamais de code de la PR, permissions minimales, interrupteur, concurrence ;
//  E. pr-a-fusionner.sh sur une base simulée : PR sûre = aucune carte (et celle qui existait est retirée), PR sensible = carte
//     avec la raison, repli après le délai, dans le doute = carte.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGLE = join(RACINE, 'scripts/fusion_auto.py')
let ok = 0, ko = 0
const verifie = (nom, cond, detail = '') => { if (cond) { ok++; console.log('  ✓ ' + nom) } else { ko++; console.log('  ✗ ' + nom + ' ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))) } }
const regle = (fichiers, branche = 'agent/x', meme = 'oui') => {
  const r = spawnSync('python3', ['-I', REGLE, '--branche', branche, '--meme-depot', meme], { input: fichiers.join('\n') + '\n', encoding: 'utf8' })
  try { return JSON.parse(r.stdout) } catch { return { decision: '?', raison: r.stderr } }
}

console.log('A. la règle d’éligibilité')
const cas = [
  // [nom, fichiers, branche, même dépôt, attendu]
  ['écran seul', ['app/src/App.tsx'], 'agent/x', 'oui', 'auto'],
  ['écran + documentation + banc', ['app/src/lib/a.ts', 'docs/REPRISE.md', 'scripts/verifier-fusion.mjs', 'app/scripts/verifier-web.mjs'], 'renfort/5ec870/f31537', 'oui', 'auto'],
  ['branche claude/', ['docs/historique/x.md'], 'claude/abc', 'oui', 'auto'],
  ['branche worktree-', ['docs/historique/x.md'], 'worktree-agent-1', 'oui', 'auto'],
  ['un fichier sensible parmi des sûrs', ['app/src/a.tsx', 'supabase/migrations/0103_x.sql'], 'agent/x', 'oui', 'carte'],
  ['base', ['supabase/migrations/0103_x.sql'], 'agent/x', 'oui', 'carte'],
  ['hooks', ['hooks/suivi.sh'], 'agent/x', 'oui', 'carte'],
  ['réglages de Claude', ['.claude/settings.json'], 'agent/x', 'oui', 'carte'],
  ['workflow', ['.github/workflows/deploy.yml'], 'agent/x', 'oui', 'carte'],
  ['outil shell', ['scripts/progression.sh'], 'agent/x', 'oui', 'carte'],
  ['outil python', ['scripts/clarte.py'], 'agent/x', 'oui', 'carte'],
  ['règles du projet', ['CLAUDE.md'], 'agent/x', 'oui', 'carte'],
  ['bloc de règles des projets branchés (sous docs/)', ['docs/bloc-CLAUDE.md'], 'agent/x', 'oui', 'carte'],
  ['module embarqué', ['embed/cockpit-embed.js'], 'agent/x', 'oui', 'carte'],
  ['modèles reçus par les autres projets', ['modeles/cockpit-sql.sh'], 'agent/x', 'oui', 'carte'],
  ['dépendances de l’app', ['app/package.json'], 'agent/x', 'oui', 'carte'],
  ['verrou des dépendances', ['app/package-lock.json'], 'agent/x', 'oui', 'carte'],
  ['fichier hors liste (banc non « verifier- »)', ['scripts/bancs.mjs'], 'agent/x', 'oui', 'carte'],
  ['fichier à la racine', ['README.md'], 'agent/x', 'oui', 'carte'],
  ['sensible en sous-dossier d’outils (hors liste blanche)', ['scripts/sous/dossier/x.sh'], 'agent/x', 'oui', 'carte'],
  ['renommage depuis un fichier sensible (l’ancien nom compte)', ['docs/x.md', 'hooks/suivi.sh'], 'agent/x', 'oui', 'carte'],
  ['fork', ['docs/x.md'], 'agent/x', 'non', 'carte'],
  ['branche inconnue', ['docs/x.md'], 'feature/x', 'oui', 'carte'],
  ['branche vide', ['docs/x.md'], '', 'oui', 'carte'],
  ['branche « agent/ » sans nom', ['docs/x.md'], 'agent/', 'oui', 'carte'],
  ['aucune branche en « main »', ['docs/x.md'], 'main', 'oui', 'carte'],
  ['liste vide', [], 'agent/x', 'oui', 'carte'],
  ['chemin remontant', ['docs/../hooks/suivi.sh'], 'agent/x', 'oui', 'carte'],
  ['chemin absolu', ['/etc/passwd'], 'agent/x', 'oui', 'carte'],
  ['majuscules (autre dossier)', ['Hooks/suivi.sh', 'APP/x.tsx'], 'agent/x', 'oui', 'carte'],
  ['dossier qui commence comme app (« app-secret/ »)', ['app-secret/x.txt'], 'agent/x', 'oui', 'carte'],
  ['dossier « docs » imité (« docsx/ »)', ['docsx/x.md'], 'agent/x', 'oui', 'carte'],
  ['banc du dossier app', ['app/scripts/verifier-web.mjs'], 'agent/x', 'oui', 'auto'],
]
for (const [nom, f, b, m, attendu] of cas) {
  const r = regle(f, b, m)
  verifie(`${attendu === 'auto' ? 'auto ' : 'carte'} : ${nom}`, r.decision === attendu, r)
}
verifie('mise en ligne relancée si l’écran change, pas pour de la documentation',
  regle(['app/src/a.tsx']).deploiement === true && regle(['docs/x.md']).deploiement === false)

console.log('B. les raisons se lisent sans jargon')
const clarte = (texte) => spawnSync('python3', ['-I', join(RACINE, 'scripts/clarte.py')], { input: ['x', texte].join('\0') + '\0', encoding: 'utf8' })
const raisons = new Set()
for (const [, f, b, m] of cas) { const r = regle(f, b, m); if (r.decision === 'carte') raisons.add(r.raison) }
for (const r of raisons) { const c = clarte(`Cette PR ${r} : elle ne se fusionne pas seule, c'est à toi.`); verifie(`vocabulaire : « ${r} »`, c.status === 0, c.stderr) }
const repli = clarte("Elle devait se fusionner seule depuis plus de 20 minutes et ne l'a pas fait. Fusionne-la toi-même.")
verifie('vocabulaire : phrase du repli', repli.status === 0, repli.stderr)

console.log('C. la mise en ligne relancée suit deploy.yml')
const deploy = readFileSync(join(RACINE, '.github/workflows/deploy.yml'), 'utf8')
const bloc = deploy.match(/paths:\n((?:\s+- .+\n)+)/)?.[1] ?? ''
const chemins = [...bloc.matchAll(/- '([^']+)'/g)].map((x) => x[1])
const enRegex = (c) => c.replace(/[.]/g, '\\.').replace(/\*\*$/, '.*')
const py = spawnSync('python3', ['-I', '-c', 'import sys,json; sys.path.insert(0, sys.argv[1]); import fusion_auto as f; print(json.dumps(f.DEPLOIEMENT))', join(RACINE, 'scripts')], { encoding: 'utf8' })
let dep = []; try { dep = JSON.parse(py.stdout) } catch { /* rouge plus bas */ }
verifie('les chemins de deploy.yml sont lus', chemins.length >= 3, chemins)
verifie('DEPLOIEMENT (fusion_auto.py) = chemins de deploy.yml', JSON.stringify([...dep].sort()) === JSON.stringify(chemins.map(enRegex).sort()), { dep, chemins })

console.log('D. le workflow')
const wf = readFileSync(join(RACINE, '.github/workflows/fusion-auto.yml'), 'utf8')
const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')   // sans les commentaires
verifie('déclenché par workflow_run de « Vérifications », terminé', /workflow_run:\s+workflows: \["Vérifications"\]\s+types: \[completed\]/.test(code))
verifie('AUCUN checkout (jamais de code de la PR)', !/actions\/checkout|git checkout|git clone|git fetch/.test(code))
verifie('aucune donnée de la PR collée dans une commande (pas de ${{ …pull_request… / head_ref / head_branch / title / body }})', !/\$\{\{[^}]*(pull_request|head_ref|head_branch|\.title|\.body|head_repository)[^}]*\}\}/.test(code))
verifie('les seules expressions ${{ }} sont des constantes de confiance (jeton, dépôt, branche par défaut, variable, déclencheur)',
  [...code.matchAll(/\$\{\{([^}]*)\}\}/g)].every((x) => /^\s*(github\.token|github\.repository|github\.event\.repository\.default_branch|vars\.FUSION_AUTO != 'off'|github\.event\.workflow_run\.(name|conclusion|head_sha))\s*$/.test(x[1])), [...code.matchAll(/\$\{\{([^}]*)\}\}/g)].map((x) => x[1]))
verifie('permissions minimales : contenu, PR, actions en écriture, rien d’autre', /permissions:\n  contents: write\n  pull-requests: write\n  actions: write\n/.test(code) && (code.match(/: write/g) ?? []).length === 3)
verifie('une seule exécution à la fois, sans annulation', /concurrency:\n  group: fusion-auto\n  cancel-in-progress: false/.test(code))
verifie('interrupteur : FUSION_AUTO = off éteint tout', /if: \$\{\{ vars\.FUSION_AUTO != 'off' \}\}/.test(code))
verifie('la règle est lue depuis la branche par défaut (API), pas depuis la PR', /contents\/scripts\/fusion_auto\.py\?ref=\$DEFAULT_BRANCH/.test(code))
verifie('la fusion exige le commit vérifié (--match-head-commit) et le mode « merge » du dépôt', /gh pr merge "\$n" --repo "\$REPO" --merge --match-head-commit "\$sha"/.test(code))
verifie('fusion seulement si CLEAN, contrôles verts, règle « auto », pas brouillon, même dépôt', /"\$etat" = "CLEAN"/.test(code) && /"\$verts" = "true"/.test(code) && /"\$decision" = "auto"/.test(code) && /isDraft/.test(code) && /isCrossRepository/.test(code))
verifie('mise en ligne relancée à la main après une fusion qui touche l’écran', /gh workflow run deploy\.yml/.test(code) && /deploy\.yml/.test(deploy) && /workflow_dispatch:/.test(deploy))
verifie('journal lisible : une ligne par PR (éligible, pourquoi, contrôles, état, résultat)', /GITHUB_STEP_SUMMARY/.test(code) && /éligible : \$1/.test(code))
verifie('le nom du workflow de contrôle existe (verifications.yml, « Vérifications »)', /^name: Vérifications/m.test(readFileSync(join(RACINE, '.github/workflows/verifications.yml'), 'utf8')) && /CONTROLES: verifications\.yml/.test(code))
verifie('le workflow de contrôle lance CE banc', /verifier-fusion-auto\.mjs/.test(readFileSync(join(RACINE, '.github/workflows/verifications.yml'), 'utf8')))

console.log('E. pr-a-fusionner.sh sur une base simulée')
const dossier = mkdtempSync(join(tmpdir(), 'verifier-fusion-auto-'))
try {
  const sqlFaux = join(dossier, 'sql.sh'), demFaux = join(dossier, 'demander.sh')
  writeFileSync(sqlFaux, `#!/usr/bin/env bash
q="$1"; printf '%s\\n' "$q" >> "${dossier}/sql.log"
case "$q" in
  *"from projets where slug"*) printf '{"ok":true,"rows":[{"id":"00000000-0000-0000-0000-000000000001","depot":"rnab26/banc-fusion"}]}' ;;
  *"count(*) filter"*) printf '{"ok":true,"rows":[{"ouvertes":%s,"toutes":%s}]}' "$(cat "${dossier}/ouvertes" 2>/dev/null || echo 0)" "$(cat "${dossier}/ouvertes" 2>/dev/null || echo 0)" ;;
  *"select count(*) as n"*) printf '{"ok":true,"rows":[{"n":0}]}' ;;
  *) printf '{"ok":true,"rows":[]}' ;;
esac
`)
  writeFileSync(demFaux, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${dossier}/dem.log"
`)
  chmodSync(sqlFaux, 0o755); chmodSync(demFaux, 0o755)
  const lance = (args, ouvertes = 0) => {
    for (const f of ['sql.log', 'dem.log']) rmSync(join(dossier, f), { force: true })
    writeFileSync(join(dossier, 'ouvertes'), String(ouvertes))
    const r = spawnSync('bash', [join(RACINE, 'scripts/pr-a-fusionner.sh'), ...args], { encoding: 'utf8', env: { ...process.env, COCKPIT_SQL: sqlFaux, COCKPIT_DEM: demFaux, COCKPIT_PROJET: 'banc-fusion', GITHUB_TOKEN: '' } })
    const lire = (f) => (existsSync(join(dossier, f)) ? readFileSync(join(dossier, f), 'utf8') : '')
    return { code: r.status, sortie: r.stdout + r.stderr, dem: lire('dem.log'), sql: lire('sql.log') }
  }
  const base = ['--etat', 'open', '--merge-state', 'clean', '--branche', 'agent/x', '--meme-depot', 'oui', '--fusion-presente', 'oui', '--titre', 'Un titre']
  const sure = lance(['501', ...base, '--fichiers', 'app/src/a.tsx,docs/x.md'])
  verifie('PR sûre : AUCUNE carte posée, le script dit qu’elle se fusionne seule', sure.code === 0 && sure.dem === '' && /AUTO : PR #501 se fusionne seule/.test(sure.sortie), sure)
  const sureAvecCarte = lance(['502', ...base, '--fichiers', 'app/src/a.tsx'], 1)
  verifie('PR sûre qui avait déjà une carte : la carte est retirée (réponse automatique, answered_by vide), rien n’est reposé',
    sureAvecCarte.code === 0 && sureAvecCarte.dem === '' && /answered_by = null/.test(sureAvecCarte.sql) && /se fusionne seule/.test(sureAvecCarte.sql) && /Carte PR #502 retirée/.test(sureAvecCarte.sortie), sureAvecCarte)
  const sensible = lance(['503', ...base, '--fichiers', 'app/src/a.tsx,supabase/migrations/0103_x.sql'])
  verifie('PR sensible : la carte « Fusionne la PR » est posée, avec la raison en mots simples', sensible.code === 0 && /--question Fusionne la PR #503 : Un titre/.test(sensible.dem) && /touche la base de données : elle ne se fusionne pas seule/.test(sensible.dem), sensible)
  const outils = lance(['504', ...base, '--fichiers', 'scripts/progression.sh'])
  verifie('PR qui touche les outils : carte avec sa raison', /touche les outils du cockpit/.test(outils.dem), outils)
  const hors = lance(['505', ...base, '--fichiers', 'scripts/bancs.mjs'])
  verifie('fichier hors liste sûre : carte', /ne classe pas comme sûr/.test(hors.dem), hors)
  const fork = lance(['506', ...base, '--meme-depot', 'non', '--fichiers', 'docs/x.md'])
  verifie('PR d’un autre dépôt : carte, jamais automatique', /--question Fusionne la PR #506/.test(fork.dem) && !/AUTO/.test(fork.sortie), fork)
  const inconnu = lance(['507', '--etat', 'open', '--merge-state', 'clean', '--titre', 'Titre'])
  verifie('fichiers illisibles : carte avec la phrase habituelle (on ne promet jamais ce qu’on ne sait pas)', /--question Fusionne la PR #507/.test(inconnu.dem) && /Seul ton toucher/.test(inconnu.dem) && !/AUTO/.test(inconnu.sortie), inconnu)
  const vieille = lance(['508', ...base, '--fichiers', 'docs/x.md', '--age-min', '25'])
  verifie('repli : une PR sûre restée ouverte plus de 20 min redevient une carte (fusion refusée, interrupteur éteint…)', /--question Fusionne la PR #508/.test(vieille.dem) && /plus de 20 minutes/.test(vieille.dem), vieille)
  const jeune = lance(['509', ...base, '--fichiers', 'docs/x.md', '--age-min', '5'])
  verifie('pas de repli avant le délai', jeune.dem === '' && /AUTO/.test(jeune.sortie), jeune)
  const enCours = lance(['510', '--etat', 'open', '--merge-state', 'unstable', '--ci', 'cours', '--branche', 'agent/x', '--meme-depot', 'oui', '--fichiers', 'docs/x.md'])
  verifie('contrôles en cours : rien n’est changé, aucune carte (le comportement d’avant)', enCours.dem === '' && /PAS PRÊTE/.test(enCours.sortie) && !/AUTO/.test(enCours.sortie), enCours)
  const fermee = lance(['511', '--fermee'])
  verifie('PR fermée : toujours retirée comme avant', fermee.code === 0 && /aucune carte à retirer/.test(fermee.sortie), fermee)
  const sansWorkflow = lance(['513', ...base, '--fusion-presente', 'non', '--fichiers', 'docs/x.md'])
  verifie('dépôt SANS le workflow de fusion (FacePro, Melissa, Trieur) : PR « sûre » = carte posée, jamais retirée en silence', sansWorkflow.code === 0 && /--question Fusionne la PR #513/.test(sansWorkflow.dem) && /n'a pas la fusion automatique/.test(sansWorkflow.dem) && !/AUTO/.test(sansWorkflow.sortie), sansWorkflow)
  const sansWorkflowAvecCarte = lance(['514', ...base, '--fusion-presente', 'non', '--fichiers', 'app/src/a.tsx'], 1)
  verifie('dépôt sans le workflow : une carte déjà posée n\'est PAS retirée', !/answered_by = null/.test(sansWorkflowAvecCarte.sql) && !/AUTO/.test(sansWorkflowAvecCarte.sortie), sansWorkflowAvecCarte)
  const presenteInvalide = lance(['515', '--fusion-presente', 'peutetre'])
  verifie('--fusion-presente invalide refusé', presenteInvalide.code === 2, presenteInvalide)
  const mauvais = lance(['512', '--meme-depot', 'peutetre'])
  verifie('--meme-depot invalide refusé', mauvais.code === 2, mauvais)
} finally { rmSync(dossier, { recursive: true, force: true }) }

console.log(`\n${ok} ok, ${ko} KO`)
process.exit(ko ? 1 : 0)
