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
  /** 0071 : réglages de réactivité (affichés, modifiables dans « Détails »). */
  cadence_min?: number
  reveil_ecart_min?: number
  chef_reactif_min?: number
  chef?: { repond: boolean; raison: string } | null
}

/** Pourquoi la chef est jugée muette (vide si elle répond). */
export function phraseChef(c: EtatFiletBase['chef']): string {
  if (!c || c.repond) return ''
  if (c.raison === 'jetons') return 'La session chef est pleine (trop de jetons) : la prochaine session réveillée la relève.'
  if (c.raison === 'sans_passe') return 'La session chef ne réagit pas au travail qui attend : la prochaine session réveillée la relève.'
  return ''
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
  if (e.cadence_min) l.push(`La base vérifie toutes les ${e.cadence_min} min, puis réveille au plus toutes les ${e.reveil_ecart_min ?? 5} min ; une session chef est jugée muette après ${e.chef_reactif_min ?? 5} min.`)
  const ch = phraseChef(e.chef)
  if (ch) l.push(ch)
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

/** Délai réel entre un message de Raphaël et la première réponse d'une session (etat_reaction, 0071). */
export interface EtatReaction {
  jours: number; messages: number; repondus: number; sans_reponse: number
  mediane_s: number | null; p90_s: number | null; pire_s: number | null; dernier_s: number | null
  plus_ancien_sans_reponse: string | null
}

/** « 45 s », « 4 min », « 2 h 10 » : une durée lisible, jamais de décimale. */
export function dureeLisible(s: number): string {
  if (s < 90) return `${Math.max(1, Math.round(s))} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return m === 60 ? `${h + 1} h` : `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`
}

/** Une phrase : « Réponse en 4 min en général ». Texte d'attente si rien à mesurer. */
export function phraseReaction(r: EtatReaction | null | undefined): { titre: string; detail: string } {
  if (!r || r.messages === 0) return { titre: 'Pas encore de message à mesurer', detail: `Aucun message de toi sur ${r?.jours ?? 7} jours.` }
  const parts: string[] = []
  if (r.dernier_s != null) parts.push(`dernière réponse en ${dureeLisible(r.dernier_s)}`)
  if (r.p90_s != null) parts.push(`9 sur 10 en moins de ${dureeLisible(r.p90_s)}`)
  if (r.sans_reponse > 0) parts.push(`${r.sans_reponse} sans réponse pour l’instant`)
  if (r.mediane_s == null) return { titre: 'Aucune réponse mesurée', detail: parts.join(' · ') }
  return { titre: `Réponse en ${dureeLisible(r.mediane_s)} en général`, detail: `Sur ${r.repondus} message(s) en ${r.jours} j${parts.length ? ' · ' + parts.join(' · ') : ''}.` }
}
