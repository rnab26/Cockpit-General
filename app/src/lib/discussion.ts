/**
 * Le fil d'un chantier est une DISCUSSION (Raphaël, 29 sept. 2026) : « la même
 * logique qu'une discussion dans une session […] que le dernier artefact où je
 * dois choisir des cartes se mette toujours en dernier, après ma question et
 * une fois que Claude a répondu […] comme si je regardais une discussion
 * WhatsApp ».
 *
 * Deux règles, pures et testées (app/scripts/verifier-discussion.ts) :
 *  - `ordreDuFil` : chronologique, le plus récent en bas ; ce qui attend un
 *    choix de sa part (question ouverte, fusion proposée) sort du fil et va
 *    TOUT EN BAS, après le dernier échange.
 *  - `attenteReponse` : après un message LIBRE de sa part, tant qu'aucune
 *    réponse écrite de Claude ne l'a suivi, ce qu'il en est (pris par un
 *    assistant, reçu par la session, en attente — et jusqu'à quand).
 * `estMessageLibre` est la MÊME règle que `cockpit.est_message_libre` (0024) ;
 * verifier-base.mjs §24 compare les deux sur les mêmes lignes.
 */
import type { Message } from './types.ts'

type M = Pick<Message, 'id' | 'auteur_type' | 'kind' | 'corps' | 'created_at' | 'answered_at' | 'chantier_id'> &
  Partial<Pick<Message, 'medias' | 'ou_en_est' | 'recu_at' | 'recu_par'>>

/** Un assistant qui a pris un message et n'a pas répondu en 2 h : on le redonne (même délai qu'en base). */
export const DELAI_PRISE_MS = 2 * 3600_000

const estQuestion = (m: Pick<M, 'kind'>) => m.kind === 'question' || m.kind === 'action'

/** Un message humain qui attend une réponse écrite de Claude (pas un bouton servi ailleurs). */
export function estMessageLibre(m: M, fil: readonly M[]): boolean {
  if (m.auteur_type !== 'proprietaire' && m.auteur_type !== 'utilisateur') return false
  if (m.kind !== 'info' && m.kind !== 'constat' && m.kind !== 'reponse') return false
  // Un constat vient d'un bouton : seul « Ça ne marche pas : … » (Corriger) attend une réponse.
  if (m.kind === 'constat' && !m.corps.startsWith('Ça ne marche pas : ')) return false
  if (m.ou_en_est) return false
  if (m.corps.startsWith('Doublon fusionné : ')) return false
  // Les pièces jointes d'une réponse à une question : servies avec la réponse (0017).
  if ((m.medias?.length ?? 0) > 0) {
    const t = Date.parse(m.created_at)
    if (fil.some((q) => estQuestion(q) && q.answered_at && q.chantier_id === m.chantier_id
      && t >= Date.parse(q.answered_at) - 5_000 && t <= Date.parse(q.answered_at) + 120_000)) return false
  }
  return true
}

/** Ce qui attend un geste de sa part dans le fil : une question ou une fusion pas encore tranchée. */
export const attendUnChoix = (m: Pick<M, 'kind' | 'answered_at'>) => (estQuestion(m) || m.kind === 'fusion') && !m.answered_at

/** Le fil, dans l'ordre d'une discussion : l'historique chronologique, puis ce qui attend son choix. */
export function ordreDuFil<T extends M>(messages: readonly T[]): { historique: T[]; aChoisir: T[] } {
  const tri = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at))
  return { historique: tri.filter((m) => !attendUnChoix(m)), aChoisir: tri.filter(attendUnChoix) }
}

export type EtatAttente = 'prise' | 'recue' | 'session' | 'attente' | 'personne'
export interface AttenteReponse {
  etat: EtatAttente
  /** Son premier message resté sans réponse. */
  depuis: string
  nombre: number
  titre: string
  detail: string
}

const heure = (iso: string) => {
  const d = new Date(iso)
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Où en est la réponse à ses derniers messages libres (null : rien n'attend).
 * `sessionTient` : une session vivante tient le chantier (elle le verra à son
 * prochain pas) ; `prochainPassage` : le prochain réveil de la chef du projet.
 */
export function attenteReponse(fil: readonly M[], o: { maintenant: number; sessionTient: boolean; prochainPassage: string | null }): AttenteReponse | null {
  const tri = [...fil].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const derniereSession = [...tri].reverse().find((m) => m.auteur_type === 'session')?.created_at ?? ''
  const enAttente = tri.filter((m) => m.created_at > derniereSession && estMessageLibre(m, tri))
  if (!enAttente.length) return null
  const base = { depuis: enAttente[0].created_at, nombre: enAttente.length }
  const prise = enAttente.find((m) => m.recu_par?.startsWith('agent/') && m.recu_at && o.maintenant - Date.parse(m.recu_at) < DELAI_PRISE_MS)
  if (prise) return { ...base, etat: 'prise', titre: 'Claude a reçu ton message', detail: 'Un assistant prépare la réponse : elle arrivera ici.' }
  if (enAttente.some((m) => m.recu_at && !m.recu_par?.startsWith('agent/'))) return { ...base, etat: 'recue', titre: 'Claude a reçu ton message', detail: 'La session qui travaille dessus te répond ici.' }
  if (o.sessionTient) return { ...base, etat: 'session', titre: 'Message envoyé', detail: 'La session qui travaille dessus le verra à son prochain pas, et te répondra ici.' }
  if (o.prochainPassage) {
    const t = Date.parse(o.prochainPassage)
    const quand = t > o.maintenant ? `vers ${heure(o.prochainPassage)}` : 'dans l’heure'
    return { ...base, etat: 'attente', titre: 'Message envoyé : réponse en attente', detail: `Aucune session n’est dessus. Prochain passage de Claude ${quand} : il te répondra ici.` }
  }
  return { ...base, etat: 'personne', titre: 'Message envoyé : réponse en attente', detail: 'Aucune session ne tourne sur ce projet : ouvre Claude Code sur ce projet pour qu’il te réponde.' }
}
