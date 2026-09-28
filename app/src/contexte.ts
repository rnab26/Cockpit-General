import { createContext, useContext } from 'react'
import type { Activite, Chantier, Message, Moi, Projet, Section } from './lib/types.ts'
import type { Preferences } from './hooks/usePreferences.ts'

export interface Filtre { libelle: string; ids: Set<string> }

export interface Contexte {
  moi: Moi
  admin: boolean
  par: string                       // l'e-mail, passé en p_par à chaque RPC
  projet: Projet
  sections: Section[]
  chantiers: Chantier[]
  messages: Message[]
  activites: Activite[]
  enAttente: Set<string>            // chantiers portant une question/action sans réponse
  recharger: () => Promise<void>
  prefs: Preferences
  poser: (cle: string, valeur: unknown) => Promise<void>
  selection: { actif: boolean; ids: Set<string>; basculer: (id: string) => void }
  ouvrirModifier: (c: Chantier) => void
  ouvrirDoublonDe: (c: Chantier) => void
  poserFiltre: (f: Filtre | null) => void
}

export const CockpitCtx = createContext<Contexte | null>(null)
export function useCockpit(): Contexte {
  const c = useContext(CockpitCtx)
  if (!c) throw new Error('useCockpit hors du CockpitCtx')
  return c
}
