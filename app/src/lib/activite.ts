// Quelle ligne d'activité dessiner : la plus récente en cours ; une ligne
// terminée ou en échec reste visible un quart d'heure, puis s'efface.
import type { Activite } from './types.ts'

export const REMANENCE_FIN_MS = 15 * 60_000

export function activiteAffichable(a: Pick<Activite, 'statut' | 'updated_at'>, now: Date = new Date()): boolean {
  if (a.statut === 'en_cours' || a.statut === 'attente') return true
  const t = new Date(a.updated_at).getTime()
  return !Number.isNaN(t) && now.getTime() - t < REMANENCE_FIN_MS
}

/** La ligne à dessiner sur la carte d'un chantier (la plus récente d'abord). */
export function activiteDuChantier<T extends Activite>(activites: readonly T[], chantierId: string, now: Date = new Date()): T | null {
  const candidates = activites
    .filter((a) => a.chantier_id === chantierId && activiteAffichable(a, now))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return candidates.find((a) => a.statut === 'en_cours') ?? candidates[0] ?? null
}

/** Le bandeau « Là, maintenant » : la dernière ligne EN COURS du projet, rien sinon. */
export function activiteDuProjet<T extends Activite>(activites: readonly T[]): T | null {
  return [...activites].filter((a) => a.statut === 'en_cours').sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null
}
