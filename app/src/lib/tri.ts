// Ordre d'urgence d'un bac : ce qui attend un humain d'abord, puis ce qui
// bouge, puis ce qui dort. Priorité haute avant, à urgence égale.
import type { Chantier, Etat } from './types.ts'

const RANG_ETAT: Record<Etat, number> = {
  a_verifier: 1, en_cours: 2, bloque: 3, libre: 4, a_trier: 5, a_cadrer: 6, reporte: 7, valide: 8,
}
const RANG_PRIORITE = { haute: 0, normale: 1, basse: 2 } as const

export function rangUrgence(c: Pick<Chantier, 'etat'>, questionEnAttente: boolean): number {
  if (questionEnAttente) return 0
  return RANG_ETAT[c.etat] ?? 9
}

export type ChantierTriable = Pick<Chantier, 'id' | 'etat' | 'priorite' | 'updated_at' | 'titre'>

export function trierChantiers<T extends ChantierTriable>(liste: readonly T[], enAttente: ReadonlySet<string>): T[] {
  return [...liste].sort((a, b) => {
    const ra = rangUrgence(a, enAttente.has(a.id))
    const rb = rangUrgence(b, enAttente.has(b.id))
    if (ra !== rb) return ra - rb
    const pa = RANG_PRIORITE[a.priorite] ?? 1
    const pb = RANG_PRIORITE[b.priorite] ?? 1
    if (pa !== pb) return pa - pb
    // Plus récemment touché d'abord, puis le titre pour un ordre stable.
    const d = (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
    if (d !== 0) return d
    return a.titre.localeCompare(b.titre, 'fr')
  })
}
