/**
 * Lien profond d'une notification « Claude a répondu » (30 sept. 2026, chantier
 * bff5a8cf) : toucher la notification ouvre directement le fil concerné.
 * Format du fragment : `#fil=<projet_id>` (fil du projet) ou
 * `#fil=<projet_id>:<chantier_id>`. `public/sw.js` l'écrit (même format, il ne
 * peut pas importer ce fichier), l'app le lit ici — une seule règle de lecture.
 */
export interface CibleFil { projetId: string; chantierId: string | null }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RE = new RegExp(`(?:^|[#&])fil=(${UUID})(?::(${UUID}))?(?:&|$)`, 'i')

export function lireLienFil(hash: string): CibleFil | null {
  const m = RE.exec(hash)
  return m ? { projetId: m[1].toLowerCase(), chantierId: m[2] ? m[2].toLowerCase() : null } : null
}

export function lienFil(base: string, projetId: string, chantierId: string | null): string {
  return `${base}#fil=${projetId}${chantierId ? `:${chantierId}` : ''}`
}
