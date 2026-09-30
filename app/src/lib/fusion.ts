// « Fusionner avec… » (menu ⋯ du fil) : logique pure. La fusion elle-même reste
// `fusionner_chantiers` (une seule règle, en base) ; la suggestion automatique
// est `candidat_fusion` / `ressemblance_fusion` (0042, testées par verifier-fusion.mjs).
import { normaliser } from './doublons.ts'

export interface ChantierFusion { id: string; titre: string; projet_id: string; etat: string; archived_at?: string | null; doublon_de?: string | null }

/** Les chantiers avec qui fusionner : même projet, ouverts (ni archivés, ni certifiés, ni déjà doublons), pas lui-même, filtrés par la recherche. */
export function candidatsFusion<T extends ChantierFusion>(chantiers: readonly T[], source: Pick<ChantierFusion, 'id' | 'projet_id'>, recherche = ''): T[] {
  const mots = normaliser(recherche).split(' ').filter(Boolean)
  return chantiers
    .filter((c) => c.id !== source.id && c.projet_id === source.projet_id && !c.archived_at && !c.doublon_de && c.etat !== 'valide')
    .filter((c) => { const t = normaliser(c.titre); return mots.every((m) => t.includes(m)) })
    .sort((a, b) => a.titre.localeCompare(b.titre, 'fr'))
}

/** Ce que Raphaël lit avant de confirmer. */
export function texteConfirmationFusion(source: string, cible: string, nMessages: number): string {
  const msgs = nMessages
    ? `Ses ${nMessages} message${nMessages > 1 ? 's' : ''} (questions, réponses, pièces jointes) et sa demande rejoignent « ${cible} ».`
    : `Sa demande rejoint « ${cible} ».`
  return `« ${source} » est archivé comme doublon de « ${cible} », qui est gardé. ${msgs} Rien n’est supprimé.`
}
