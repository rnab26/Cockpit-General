// Types miroir du schéma `cockpit` (supabase/migrations/0001_cockpit_base.sql).
// Une colonne ajoutée en base se déclare ici, jamais devinée dans un composant.

export type Etat =
  | 'a_trier' | 'a_cadrer' | 'libre' | 'en_cours'
  | 'a_verifier' | 'valide' | 'bloque' | 'reporte'
export type Priorite = 'basse' | 'normale' | 'haute'
export type Origine = 'proprietaire' | 'utilisateur' | 'session'
export type AuteurType = 'proprietaire' | 'utilisateur' | 'session'
export type KindMessage = 'info' | 'question' | 'reponse' | 'blocage' | 'action' | 'constat'
export type EtatAction = 'fait' | 'pas_encore' | 'bloque'
export type StatutActivite = 'en_cours' | 'termine' | 'echec' | 'attente'

export interface Projet {
  id: string
  slug: string
  nom: string
  description: string | null
  depot: string | null
  url_site: string | null
  couleur: string | null
  actif: boolean
  cle_embed: string
  created_at: string
}

export interface Section {
  id: string
  projet_id: string
  nom: string
  cle: string
  description: string | null
  position: number
  created_at: string
}

export interface Chantier {
  id: string
  projet_id: string
  section_id: string | null
  titre: string
  demande: string | null
  notes: string | null
  resume_simple: string | null
  etat: Etat
  priorite: Priorite
  origine: Origine
  visible_utilisateurs: boolean
  reproduction: unknown
  doublon_de: string | null
  pris_par: string | null
  pris_jusqu_a: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  livre_at: string | null
  valide_at: string | null
  valide_par: string | null
  archived_at: string | null
}

export interface OptionQuestion {
  libelle: string
  aide?: string
  recommande?: boolean
}

export interface Message {
  id: string
  projet_id: string
  chantier_id: string | null
  auteur: string
  auteur_type: AuteurType
  kind: KindMessage
  corps: string
  pourquoi: string | null
  options: OptionQuestion[] | null
  reponse: string | null
  precision: string | null
  repond_a: string | null
  etat: EtatAction | null
  answered_at: string | null
  answered_by: string | null
  created_at: string
}

export interface Activite {
  id: string
  projet_id: string
  chantier_id: string | null
  session: string
  etape: string
  pourcentage: number
  eta_secondes: number | null
  statut: StatutActivite
  detail: string | null
  demarre_at: string
  updated_at: string
}

export interface Historique {
  id: number
  chantier_id: string
  champ: string
  ancienne: string | null
  nouvelle: string | null
  par: string | null
  changed_at: string
}

export interface Membre {
  user_id: string
  email: string
  role: string
  created_at: string
}

export interface Moi {
  user_id: string
  admin: boolean
  email: string
}
