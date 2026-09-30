/**
 * Bulle flottante d'aide : les règles pures (testées par verifier-bulle-aide.ts).
 *
 *  - Allumée PAR DÉFAUT : seule une préférence explicitement `false` l'éteint
 *    (30 sept. 2026 : elle était éteinte par défaut, Raphaël ne la voyait pas).
 *  - Vue projet : le fil de CE projet. Vue « Tout » : le projet `cockpit`, sinon
 *    le projet dont le fil libre a reçu le dernier message, sinon le premier.
 */
import type { Message, Projet } from './types.ts'

export const cleBulle = (projetId: string) => `bulle_flottante_aide_${projetId}`

export const bulleActive = (prefs: Record<string, unknown>, projetId: string): boolean => prefs[cleBulle(projetId)] !== false

export function projetDeLaBulle(vueProjetId: string | null, projets: readonly Projet[], messages: readonly Pick<Message, 'projet_id' | 'chantier_id' | 'created_at'>[]): Projet | null {
  if (vueProjetId) return projets.find((p) => p.id === vueProjetId) ?? null
  const reels = projets.filter((p) => !p.slug.startsWith('test-'))
  const liste = reels.length ? reels : projets
  const cockpit = liste.find((p) => p.slug === 'cockpit')
  if (cockpit) return cockpit
  let meilleur: Projet | null = null
  let quand = ''
  for (const m of messages) {
    if (m.chantier_id || m.created_at <= quand) continue
    const p = liste.find((x) => x.id === m.projet_id)
    if (p) { meilleur = p; quand = m.created_at }
  }
  return meilleur ?? liste[0] ?? null
}

/** Les messages du fil libre du projet (sans chantier), dans l'ordre, sans les lignes de mécanique. */
export function filDeLaBulle<T extends Pick<Message, 'projet_id' | 'chantier_id' | 'kind' | 'created_at' | 'ou_en_est'>>(messages: readonly T[], projetId: string): T[] {
  return messages
    .filter((m) => m.projet_id === projetId && !m.chantier_id && !m.ou_en_est && (m.kind === 'info' || m.kind === 'constat' || m.kind === 'reponse' || m.kind === 'blocage'))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}
