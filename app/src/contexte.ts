import { createContext, useContext } from 'react'
import type { Activite, Chantier, Message, Moi, Projet, Section, SessionClaude, Tache } from './lib/types.ts'
import type { Preferences } from './hooks/usePreferences.ts'
import type { NonLus } from './lib/lecture.ts'

/**
 * Deux étages de contexte (29 sept. 2026, onglet « Tout ») :
 *  - `Global` : tous les projets à la fois, l'horloge de présence, les
 *    préférences — ce que lisent l'onglet « Tout », les onglets, les réglages ;
 *  - `Contexte` : UN projet (ses sections, chantiers, messages, activités).
 *    Chaque élément de l'onglet « Tout » est rendu dans le contexte de SON
 *    projet (<AvecProjet>), si bien que les mêmes composants (question,
 *    validation, fil…) servent aux deux vues sans être recopiés.
 */
export interface Contexte {
  moi: Moi
  admin: boolean
  par: string                       // l'e-mail, passé en p_par à chaque RPC
  projet: Projet
  sections: Section[]
  chantiers: Chantier[]
  messages: Message[]
  activites: Activite[]
  /** Sessions Claude Code et leurs tâches (agents, commandes) — 0008, admin seulement. */
  sessions: SessionClaude[]
  taches: Tache[]
  enAttente: Set<string>            // chantiers portant une question/action sans réponse
  /** L'heure de référence de la présence : avance toute seule toutes les 30 s. */
  now: Date
  /** Le délai de silence (réglage `silence_minutes`), en ms. */
  silenceMs: number
  recharger: () => Promise<void>
  prefs: Preferences
  poser: (cle: string, valeur: unknown) => Promise<void>
  selection: { actif: boolean; ids: Set<string>; basculer: (id: string) => void }
  ouvrirModifier: (c: Chantier) => void
  ouvrirDoublonDe: (c: Chantier) => void
  /** Ouvre la conversation d'un chantier (null : les questions du projet), sans changer d'onglet. */
  ouvrirChantier: (chantierId: string | null) => void
}

export interface Global {
  moi: Moi
  admin: boolean
  par: string
  projets: Projet[]
  sections: Section[]
  chantiers: Chantier[]
  messages: Message[]
  activites: Activite[]
  sessions: SessionClaude[]
  taches: Tache[]
  now: Date
  silenceMs: number
  prefs: Preferences
  poser: (cle: string, valeur: unknown) => Promise<void>
  recharger: () => Promise<void>
  /** Relit la liste des projets (mode autonome, dépôt…). */
  rechargerProjets: () => Promise<void>
  /** « N chantiers prêts » par projet, lu en base (0065) ; null : pas encore reçu, l'écran retombe sur sa copie locale. */
  prenables: Map<string, number> | null
  /** Réponses de Claude pas encore lues, par fil (lib/lecture.ts). */
  nonLus: ReadonlyMap<string, NonLus>
  /** 'tout' ou l'id du projet affiché. */
  vue: string
  ouvrirChantier: (projetId: string, chantierId: string | null) => void
  /** Le contexte d'un projet (null s'il n'est pas/plus visible). */
  contexteDe: (projetId: string) => Contexte | null
}

export const CockpitCtx = createContext<Contexte | null>(null)
export const GlobalCtx = createContext<Global | null>(null)

export function useCockpit(): Contexte {
  const c = useContext(CockpitCtx)
  if (!c) throw new Error('useCockpit hors du CockpitCtx')
  return c
}
export function useGlobal(): Global {
  const g = useContext(GlobalCtx)
  if (!g) throw new Error('useGlobal hors du GlobalCtx')
  return g
}
