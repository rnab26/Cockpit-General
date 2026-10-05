// Replier / déplier les sections de l'écran d'accueil, et filtrer « À toi de jouer ».
// Règles pures (testées par scripts/verifier-repli.ts) ; l'état est retenu PAR PERSONNE
// dans les préférences (cockpit.preferences), jamais en dur dans l'écran.
import type { ElementAToi, TypeAToi } from './entonnoir.ts'
import { ORDRE_A_TOI } from './entonnoir.ts'

/** Les trois sections de l'accueil, dans l'ordre d'affichage. */
export const SECTIONS_ACCUEIL = ['ca-avance', 'a-toi', 'a-lancer'] as const
export type SectionAccueil = (typeof SECTIONS_ACCUEIL)[number]

export const PREF_REPLIEES = 'sections_repliees_accueil'
export const PREF_FILTRE_A_TOI = 'filtre_a_toi'

/** Lecture défensive d'une préférence : ne garde que des clés connues. */
export function lireRepliees(v: unknown): Set<SectionAccueil> {
  if (!Array.isArray(v)) return new Set()
  return new Set(v.filter((x): x is SectionAccueil => (SECTIONS_ACCUEIL as readonly unknown[]).includes(x)))
}

export function basculerRepli(repliees: ReadonlySet<SectionAccueil>, cle: SectionAccueil): SectionAccueil[] {
  const n = new Set(repliees)
  if (n.has(cle)) n.delete(cle); else n.add(cle)
  return [...n]
}

/** Tout est replié ? (le bouton unique propose alors « Tout déplier »). */
export function toutEstReplie(repliees: ReadonlySet<SectionAccueil>): boolean {
  return SECTIONS_ACCUEIL.every((c) => repliees.has(c))
}

/** Le geste unique : tout replier, ou tout déplier si tout l'est déjà. */
export function toutBasculer(repliees: ReadonlySet<SectionAccueil>): SectionAccueil[] {
  return toutEstReplie(repliees) ? [] : [...SECTIONS_ACCUEIL]
}

export const LIBELLE_FILTRE_A_TOI: Record<TypeAToi, string> = {
  question: 'Questions', action: 'Actions', fusion: 'Fusions', a_verifier: 'À tester', a_cadrer: 'À décider', bloque: 'Bloqués',
}

/** Combien d'éléments par type (seulement les types présents, dans l'ordre d'urgence habituel). */
export function comptesAToi(elements: readonly Pick<ElementAToi, 'type'>[]): { type: TypeAToi; n: number }[] {
  return ORDRE_A_TOI.map((type) => ({ type, n: elements.filter((e) => e.type === type).length })).filter((x) => x.n > 0)
}

/**
 * UNE règle d'affichage des pastilles de filtre de « À toi de jouer » : au moins 2 types présents, OU au
 * moins une action ouverte (Raphaël, 5 oct. : « je ne vois pas la pastille Actions » — avec un seul type
 * la rangée était cachée). À zéro action et un seul type, rien : l'état vide / la liste suffisent.
 */
export function pastillesVisibles(elements: readonly Pick<ElementAToi, 'type'>[]): boolean {
  const c = comptesAToi(elements)
  return c.length > 1 || c.some((x) => x.type === 'action')
}

/** Filtre retenu valide ? Sinon (inconnu, ou plus rien de ce type) : pas de filtre, on ne cache jamais tout. */
export function filtreEffectif(pref: unknown, elements: readonly Pick<ElementAToi, 'type'>[]): TypeAToi | null {
  const t = (ORDRE_A_TOI as readonly unknown[]).includes(pref) ? (pref as TypeAToi) : null
  return t && elements.some((e) => e.type === t) ? t : null
}

export function filtrerAToi<T extends Pick<ElementAToi, 'type'>>(elements: readonly T[], type: TypeAToi | null): T[] {
  return type ? elements.filter((e) => e.type === type) : [...elements]
}
