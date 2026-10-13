/**
 * « Classer sans test » (13 oct. 2026, migration 0079). Raphaël : « des fois je ne traite pas sur le cockpit, donc ce n'est
 * pas traité si je ne le fais pas à la main » — 56 chantiers livrés attendaient un test. Deux gestes, jamais « certifié » :
 *   - classer d'un geste ceux de la liste (archiver_livres : état « à vérifier » gardé, aux archives, « Désarchiver » le rend) ;
 *   - classer tout seul ceux qui restent sans un mot de Raphaël après N jours (projets.livres_classes_apres_j, vide = jamais).
 * Règles pures, vérifiées par scripts/verifier-classer-livres.ts. La règle de fond (« sans retour ») vit en base : livre_sans_retour.
 */
import type { ElementAToi } from './entonnoir.ts'

/** Les délais proposés (vide = jamais). Le serveur accepte 1 à 90 jours ; l'écran en propose cinq, c'est tout. */
export const DELAIS_CLASSEMENT: readonly (number | null)[] = [null, 3, 7, 14, 30]

export function libelleDelai(jours: number | null | undefined): string {
  return jours ? `${jours} jour${jours > 1 ? 's' : ''}` : 'jamais'
}

/** Valeur d'un <select> → nombre de jours (ou null = jamais). Tout ce qui n'est pas un entier de 1 à 90 donne « jamais ». */
export function joursDeSaisie(brut: string): number | null {
  const n = Number(brut)
  return brut.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 90 ? n : null
}

/** Les chantiers que le geste « Classer sans test » toucherait (un par chantier, même s'il porte plusieurs éléments). */
export function idsAClasser(elements: readonly Pick<ElementAToi, 'type' | 'chantier'>[]): string[] {
  return [...new Set(elements.filter((e) => e.type === 'a_verifier' && e.chantier).map((e) => e.chantier!.id))]
}

export function titreConfirmation(n: number): string {
  return `Classer ${n} chantier${n > 1 ? 's' : ''} sans test ?`
}

export function phraseClasses(n: number): string {
  return `${n} chantier${n > 1 ? 's' : ''} classé${n > 1 ? 's' : ''} sans test.`
}
