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

// ---- Création : « ça existe déjà » → compléter, fusionner ou créer quand même (0060)
// La RESSEMBLANCE n'est jamais recalculée ici : elle vient de `chantiers_proches_creation`
// (= ressemblance_fusion + seuil du projet, une seule règle en base).

export interface ChantierProche { id: string; titre: string; etat: string; score: number }

/** Lecture défensive de la réponse de `chantiers_proches_creation` (jamais plus de `max`, jamais sans id ni titre). */
export function lireProches(rows: unknown, max = 3): ChantierProche[] {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .filter((r) => typeof r.id === 'string' && typeof r.titre === 'string' && r.titre !== '')
    .map((r) => ({ id: r.id as string, titre: r.titre as string, etat: typeof r.etat === 'string' ? r.etat : '', score: Number(r.score) || 0 }))
    .slice(0, max)
}

/** Ce que Raphaël lit avant de compléter. */
export function texteConfirmationCompleter(cible: string): string {
  return `Ce que tu as tapé est ajouté à la demande de « ${cible} », qui est gardé. Aucun nouveau chantier n’est créé.`
}

/** Libellé du bouton principal : « Créer » quand rien ne ressemble, « Créer quand même » sinon. */
export function libelleCreer(nProches: number): string { return nProches > 0 ? 'Créer quand même' : 'Créer' }
