/**
 * « Claude m'a répondu » (Raphaël, 30 sept. 2026, chantier bff5a8cf) : « quand
 * j'envoie un message […] je ne vois aucune notification comme quoi il m'a
 * répondu. Ça reste comme un message normal. »
 *
 * Règle unique, pure et testée (verifier-lecture.ts) : une RÉPONSE est un message
 * de session écrit en réponse à quelqu'un (`repond_a`, posé par
 * `repondre_dans_fil` — pas les lignes automatiques « Pris par un renfort… »).
 * Elle est NON LUE tant qu'elle est plus récente que le dernier passage de
 * Raphaël dans ce fil. Le « lu jusqu'à » est une préférence par personne
 * (`lu_fils`), donc partagé entre son téléphone et son ordinateur ; `lu_depuis`
 * (posé au premier chargement) évite d'allumer d'un coup tout l'historique.
 */
import type { Message } from './types.ts'

export const PREF_LU_FILS = 'lu_fils'
export const PREF_LU_DEPUIS = 'lu_depuis'

type M = Pick<Message, 'projet_id' | 'chantier_id' | 'auteur_type' | 'kind' | 'repond_a' | 'created_at'>

/** Clé d'un fil : l'id du chantier, ou `projet:<id>` pour la discussion du projet. */
export const cleFil = (projetId: string, chantierId: string | null) => chantierId ?? `projet:${projetId}`

export const estReponseDeClaude = (m: Pick<M, 'auteur_type' | 'kind' | 'repond_a'>) =>
  m.auteur_type === 'session' && m.kind === 'info' && !!m.repond_a

export function lireLus(valeur: unknown): Record<string, string> {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return {}
  return Object.fromEntries(Object.entries(valeur as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
}

export interface NonLus { n: number; dernier: string }

/** Réponses non lues, par fil (clé `cleFil`). `depuis` : plancher pour un fil jamais ouvert. */
export function reponsesNonLues(messages: readonly M[], lus: Record<string, string>, depuis: string): Map<string, NonLus> {
  const r = new Map<string, NonLus>()
  for (const m of messages) {
    if (!estReponseDeClaude(m)) continue
    const cle = cleFil(m.projet_id, m.chantier_id)
    if (m.created_at <= (lus[cle] ?? depuis)) continue
    const a = r.get(cle)
    r.set(cle, { n: (a?.n ?? 0) + 1, dernier: a && a.dernier > m.created_at ? a.dernier : m.created_at })
  }
  return r
}

export const totalNonLus = (m: ReadonlyMap<string, NonLus>) => [...m.values()].reduce((s, x) => s + x.n, 0)

/** Le « lu jusqu'à » à écrire en ouvrant un fil (null : rien à changer). */
export function nouveauLu(fil: readonly Pick<M, 'created_at'>[], cle: string, lus: Record<string, string>): string | null {
  const dernier = fil.reduce((a, m) => (m.created_at > a ? m.created_at : a), '')
  return dernier && dernier > (lus[cle] ?? '') ? dernier : null
}
