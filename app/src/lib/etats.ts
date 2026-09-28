// Libellés, badges et couleurs d'un état : UNE seule table, lue partout
// (carte, filtre, sélection groupée, dialogue de modification).
import type { Chantier, Etat, Priorite, StatutActivite } from './types.ts'

export type Teinte = 'neutre' | 'ok' | 'attention' | 'alerte' | 'info' | 'accent'

export interface InfoEtat {
  etat: Etat
  libelle: string        // avec l'emoji, tel qu'affiché
  court: string          // sans emoji, pour les menus
  teinte: Teinte
  aide: string
}

export const ETATS: readonly InfoEtat[] = [
  { etat: 'a_trier',    libelle: '⏳ Pas encore examinée',      court: 'Pas encore examinée', teinte: 'neutre',    aide: 'Une demande arrivée, que personne n’a encore lue.' },
  { etat: 'a_cadrer',   libelle: '🗣️ À cadrer avec Raphaël',    court: 'À cadrer',           teinte: 'info',      aide: 'À discuter avant de coder : coût, périmètre, accès.' },
  { etat: 'libre',      libelle: '🟢 Libre',                    court: 'Libre',              teinte: 'ok',        aide: 'Spécifiée, prête à être prise par une session.' },
  { etat: 'en_cours',   libelle: '🔧 En cours',                 court: 'En cours',           teinte: 'attention', aide: 'Une session travaille dessus.' },
  { etat: 'a_verifier', libelle: '🧪 Codée, à vérifier',        court: 'Codée, à vérifier',  teinte: 'attention', aide: 'Livrée par la session : à toi de certifier ou corriger.' },
  { etat: 'valide',     libelle: '✅ Certifiée',                court: 'Certifiée',          teinte: 'ok',        aide: 'Un humain a constaté que ça marche.' },
  { etat: 'bloque',     libelle: '⛔ Bloquée',                  court: 'Bloquée',            teinte: 'alerte',    aide: 'Quelque chose d’extérieur empêche d’avancer.' },
  { etat: 'reporte',    libelle: '💤 Reportée',                 court: 'Reportée',           teinte: 'neutre',    aide: 'Volontairement mise de côté.' },
]

export const BADGE_REPONSE_ATTENDUE = '🔴 Réponse attendue'

const PAR_ETAT: Record<Etat, InfoEtat> = Object.fromEntries(ETATS.map((e) => [e.etat, e])) as Record<Etat, InfoEtat>

export function infoEtat(etat: Etat): InfoEtat {
  return PAR_ETAT[etat] ?? { etat, libelle: etat, court: etat, teinte: 'neutre', aide: '' }
}

/** Le badge affiché sur la ligne : une question en attente prime sur l'état. */
export function badgeChantier(c: Pick<Chantier, 'etat'>, questionEnAttente: boolean): { libelle: string; teinte: Teinte } {
  if (questionEnAttente) return { libelle: BADGE_REPONSE_ATTENDUE, teinte: 'alerte' }
  const i = infoEtat(c.etat)
  return { libelle: i.libelle, teinte: i.teinte }
}

export const PRIORITES: readonly { priorite: Priorite; libelle: string }[] = [
  { priorite: 'haute', libelle: '🔥 Haute' },
  { priorite: 'normale', libelle: 'Normale' },
  { priorite: 'basse', libelle: 'Basse' },
]

export function libellePriorite(p: Priorite): string {
  return PRIORITES.find((x) => x.priorite === p)?.libelle ?? p
}

/** Couleur de la barre de progression (visuel FacePro) : vert fini, ambre en cours, rouge à peine commencé ou échec. */
export function teinteProgression(pourcentage: number, statut: StatutActivite): 'ok' | 'attention' | 'alerte' {
  if (statut === 'echec') return 'alerte'
  if (statut === 'termine' || pourcentage >= 100) return 'ok'
  if (pourcentage < 30) return 'alerte'
  return 'attention'
}

/** Dans quel bac va un chantier. */
export type Bac = 'optimisation' | 'actif' | 'archives'
export function bacDe(c: Pick<Chantier, 'etat' | 'archived_at'>): Bac {
  if (c.etat === 'valide') return 'actif'
  if (c.archived_at) return 'archives'
  return 'optimisation'
}

export const ICONE_AUTEUR: Record<string, string> = { session: '🤖', proprietaire: '👤', utilisateur: '🙋' }
export const LIBELLE_KIND: Record<string, string> = {
  info: 'info', question: 'question', reponse: 'réponse', blocage: 'blocage', action: 'action', constat: 'constat',
}
