// Filet de sécurité (0044) : les mots que l'écran affiche. Toute la règle est en base
// (etat_filet, filet_passe) ; ici seulement la mise en mots, testée (verifier-filet.ts).

export interface EtatFiletBase {
  statut: 'actif' | 'eteint' | 'global_eteint' | 'cron_absent' | 'sans_jeton' | 'plafond' | 'test'
  projet_actif: boolean
  plafond: number
  delai_min: number
  aujourdhui: number
  dernier_at: string | null
  dernier_pourquoi: string | null
  attente: { n: number; raisons: string[] }
  vivant: boolean
}

/** Le geste concret quand ça bloque : `jeton` ouvre le champ du jeton, `rallumer` rallume, `plafond` ouvre la limite. */
export type ActionFilet = 'jeton' | 'rallumer' | 'plafond'

export interface PhraseFilet {
  ton: 'ok' | 'attente' | 'alerte' | 'neutre'
  /** UN état concret : « Tout est en ordre », « En attente : … », « Bloqué : pourquoi ». */
  titre: string
  /** Une seule ligne de précision (peut être vide). */
  detail: string
  action?: { code: ActionFilet; libelle: string }
}

/** À quoi ça sert, en français courant : toujours la même phrase, au premier niveau. */
export const ROLE_FILET = 'Si du travail attend et que personne ne s’en occupe, Claude est réveillé tout seul.'

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })

/** Le repli « Détails » : les chiffres, un par ligne, sans règle cachée. */
export function detailsFilet(e: EtatFiletBase): string[] {
  const l: string[] = []
  l.push(e.dernier_at ? `Dernier réveil : ${hhmm(e.dernier_at)} (${e.dernier_pourquoi ?? 'du travail attendait'}).` : 'Aucun réveil pour l’instant.')
  l.push(e.attente.n > 0 ? `Ce qui attend : ${e.attente.raisons.join(', ')}.` : 'Rien n’attend.')
  l.push(`Réveils aujourd’hui : ${e.aujourdhui} sur ${e.plafond} au plus.`)
  l.push(`Claude est réveillé si le travail attend depuis ${e.delai_min} min et qu’aucune session ne travaille.`)
  return l
}

export function phraseFilet(e: EtatFiletBase): PhraseFilet {
  const attente = e.attente.n > 0 ? e.attente.raisons.join(', ') : ''
  switch (e.statut) {
    case 'test': return { ton: 'neutre', titre: 'Pas actif sur un projet de test', detail: '' }
    case 'global_eteint': return { ton: 'alerte', titre: 'Bloqué : coupé pour tous les projets', detail: 'Pour le rallumer : scripts/chef.sh --filet-global oui' }
    case 'eteint': return { ton: 'alerte', titre: 'Éteint sur ce projet', detail: 'Rien ne réveillera Claude tout seul.', action: { code: 'rallumer', libelle: 'Rallumer' } }
    case 'cron_absent': return { ton: 'alerte', titre: 'Bloqué : la surveillance de la base ne tourne pas', detail: 'Le job « cockpit-filet-securite » est absent ou coupé.' }
    case 'sans_jeton': return { ton: 'alerte', titre: 'Bloqué : Claude ne peut pas être réveillé', detail: `${attente ? `${attente} attend. ` : ''}Il manque le jeton du réveil.`, action: { code: 'jeton', libelle: 'Coller le jeton' } }
    case 'plafond': return { ton: 'alerte', titre: `Bloqué : ${e.aujourdhui} réveils déjà faits aujourd’hui`, detail: `${attente ? `${attente} attend. ` : ''}Reprend demain, ou monte la limite.`, action: { code: 'plafond', libelle: 'Changer la limite' } }
    default:
      if (e.attente.n > 0 && e.vivant) return { ton: 'ok', titre: 'Une session s’en occupe', detail: `${attente}.` }
      if (e.attente.n > 0) return { ton: 'attente', titre: `En attente : ${attente}`, detail: `Personne dessus : Claude est réveillé après ${e.delai_min} min.` }
      return { ton: 'ok', titre: 'Tout est en ordre', detail: e.dernier_at ? `Rien n’attend. Dernier réveil à ${hhmm(e.dernier_at)}.` : 'Rien n’attend.' }
  }
}
