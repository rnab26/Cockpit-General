// Déplacer un chantier vers un autre projet (0036) : logique pure.
import { estProjetDeTest } from './projetsDeTest.ts'

export interface ProjetCible { id: string; slug: string; nom: string; actif?: boolean }

/** Les projets où on peut déplacer : tous sauf le sien, les projets de test et les projets éteints. */
export function projetsCibles<P extends ProjetCible>(projets: readonly P[], projetIdActuel: string): P[] {
  return projets
    .filter((p) => p.id !== projetIdActuel && p.actif !== false && !estProjetDeTest(p.slug))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}

/** Ce que Raphaël lit avant de confirmer. */
export function texteConfirmationDeplacement(titre: string, depart: string, cible: string, nMessages: number, section: string | null): string {
  const msgs = nMessages ? `Ses ${nMessages} message${nMessages > 1 ? 's' : ''} (questions, réponses, pièces jointes) le suivent.` : 'Il n’a pas encore de message.'
  const sec = section ? `Il est rangé dans « ${section} » de « ${cible} » (section créée si besoin).` : 'Il arrive sans section.'
  return `« ${titre} » quitte « ${depart} » pour « ${cible} ». ${msgs} ${sec} Sa réservation par une session est libérée.`
}
