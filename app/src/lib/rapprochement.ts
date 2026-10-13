// Rapprochement GitHub → chantiers (0080, 13 oct. 2026) : les mots que l'écran « Chantiers et GitHub » affiche.
// Toute la règle est en base (rapprocher_depot, etat_rapprochement) ; ici seulement la mise en mots, testée (verifier-rapprochement.ts).
import { dateRelative } from './dates.ts'

export interface EtatRapprochement {
  rapproche_at: string | null
  /** Le passage automatique des hooks est allumé sur ce projet (réglable). */
  auto: boolean
  livres_24h: number
  livres_total: number
  /** Pourquoi le dernier passage a échoué (git injoignable…) ; null tant qu'il n'a pas échoué, effacé par le passage réussi suivant. */
  erreur?: string | null
  erreur_at?: string | null
  /** Rappeler une session qui tient un chantier sans trace depuis N heures (0081 : 1 à 72, 4 par défaut). */
  trace_h?: number
  /** Chercher dans GitHub au plus toutes les N minutes (0081 : 5 à 1440, 20 par défaut). */
  passage_min?: number
  /** L'interrupteur GÉNÉRAL (0081) : faux = le rapprochement est éteint pour TOUS les projets. */
  global?: boolean
}

/** Les choix proposés à l'écran (le serveur accepte tout entier dans ses bornes ; une valeur posée ailleurs s'affiche quand même : `avecCourant`). */
export const CHOIX_TRACE_H: readonly number[] = [1, 2, 4, 8, 24]
export const CHOIX_PASSAGE_MIN: readonly number[] = [10, 20, 60, 180, 720]

export function libelleHeures(h: number): string {
  if (h >= 24 && h % 24 === 0) return h === 24 ? '1 jour' : `${h / 24} jours`
  return h === 1 ? '1 heure' : `${h} heures`
}

export function libelleMinutes(m: number): string {
  if (m >= 60 && m % 60 === 0) return m === 60 ? '1 heure' : `${m / 60} heures`
  return `${m} minutes`
}

/** La liste des choix, avec la valeur actuelle si elle n'y est pas (posée par un script) : un sélecteur ne doit jamais mentir. */
export function avecCourant(choix: readonly number[], courant: number | undefined): number[] {
  const l = [...choix]
  if (typeof courant === 'number' && Number.isFinite(courant) && !l.includes(courant)) l.push(courant)
  return l.sort((a, b) => a - b)
}

/** Le rôle en une phrase : ce que fait le rapprochement, et ce qu'il ne fait jamais. */
export const ROLE_RAPPROCHEMENT =
  'Un chantier que plus aucune session ne tient, et dont le travail est dans GitHub (fusionné dans main), passe « livré, à vérifier » tout seul, avec la preuve dans son fil. Jamais « validé » : c’est toi.'

export type TonRapprochement = 'ok' | 'attente' | 'eteint' | 'erreur'

/** L'état en une phrase + un détail : éteint, jamais passé, à jour, ou pas passé depuis longtemps. `now` : milliseconde courante. */
export function phraseRapprochement(e: EtatRapprochement, now: number = Date.now()): { titre: string; detail: string; ton: TonRapprochement } {
  const livres = e.livres_24h > 0
    ? `${e.livres_24h} chantier${e.livres_24h > 1 ? 's' : ''} passé${e.livres_24h > 1 ? 's' : ''} « livré » tout seul ces dernières 24 h.`
    : e.livres_total > 0 ? `Rien à rattraper ces dernières 24 h (${e.livres_total} au total depuis le début).` : 'Rien à rattraper pour l’instant.'
  if (e.global === false) {
    return { titre: 'Éteint pour tous les projets', detail: 'L’interrupteur général est éteint : aucun projet ne se met à jour d’après GitHub. Demande à Claude de le rallumer.', ton: 'eteint' }
  }
  if (!e.auto) {
    return { titre: 'Éteint sur ce projet', detail: 'Les chantiers ne se mettent plus à jour d’après GitHub à l’ouverture d’une session.', ton: 'eteint' }
  }
  // Un échec plus récent que le dernier bon passage se DIT (sinon « pas encore passé » ferait croire que tout va bien).
  const tErr = e.erreur_at ? new Date(e.erreur_at).getTime() : Number.NaN
  const tBon = e.rapproche_at ? new Date(e.rapproche_at).getTime() : Number.NaN
  if (e.erreur && !Number.isNaN(tErr) && (Number.isNaN(tBon) || tErr > tBon)) {
    const cause = e.erreur.length > 200 ? `${e.erreur.slice(0, 197)}…` : e.erreur
    return { titre: 'Le dernier passage a échoué', detail: `${cause} (${dateRelative(e.erreur_at, new Date(now))}). Il réessaie à l’ouverture d’une session sur ce projet.`, ton: 'erreur' }
  }
  if (!e.rapproche_at) {
    return { titre: 'Pas encore passé', detail: 'Le premier passage a lieu à l’ouverture d’une session sur ce projet (au plus toutes les 20 minutes).', ton: 'attente' }
  }
  const t = new Date(e.rapproche_at).getTime()
  const ecoule = Number.isNaN(t) ? 0 : now - t
  const quand = dateRelative(e.rapproche_at, new Date(now))
  if (ecoule > 6 * 3600_000) {
    return { titre: `Dernier passage ${quand}`, detail: `Il se refait à l’ouverture d’une session sur ce projet. ${livres}`, ton: 'attente' }
  }
  return { titre: `À jour : dernier passage ${quand}`, detail: livres, ton: 'ok' }
}
