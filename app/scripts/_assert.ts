// Mini-harnais commun aux verifier-*.ts : pas de dépendance, sortie lisible.
let echecs = 0
let total = 0
export function verifie(nom: string, condition: boolean, detail?: unknown): void {
  total++
  if (condition) { console.log(`  ✓ ${nom}`); return }
  echecs++
  console.log(`  ✗ ${nom}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
export function bilan(titre: string): void {
  console.log(`\n${titre} : ${total - echecs}/${total}`)
  if (echecs) process.exit(1)
}
