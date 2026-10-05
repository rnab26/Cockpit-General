// Types miroir du schéma `cockpit` (supabase/migrations/0001_cockpit_base.sql).
// Une colonne ajoutée en base se déclare ici, jamais devinée dans un composant.

export type Etat =
  | 'a_trier' | 'a_cadrer' | 'libre' | 'en_cours'
  | 'a_verifier' | 'valide' | 'bloque' | 'reporte'
export type Priorite = 'basse' | 'normale' | 'haute'
export type Origine = 'proprietaire' | 'utilisateur' | 'session'
export type AuteurType = 'proprietaire' | 'utilisateur' | 'session'
export type KindMessage = 'info' | 'question' | 'reponse' | 'blocage' | 'action' | 'constat' | 'fusion'
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
  /** Mode autonome (0010) : null = éteint ; sinon la session enchaîne les chantiers libres jusqu'à cette heure. */
  autonome_jusqu_a: string | null
  /** Preuves de branchement (0012) : dernier démarrage de session avec le hook, dernière mise à jour automatique, dernier appel du module du site. */
  branchement_vu_at?: string | null
  branchement_maj_at?: string | null
  embed_vu_at?: string | null
  /** Au plus N chantiers enchaînés par session (1-50, défaut 20 depuis 0011). */
  autonome_max: number
  /** Mode autonome « tout le temps », sans heure de fin (0011). */
  autonome_toujours: boolean
  /** S'éteint tout seul après N heures sans rien à prendre (0031 ; 0 = jamais, 3 par défaut). */
  autonome_arret_vide_h?: number
  /** Minutes sans signe de vie après lesquelles une réservation est libérée (1-120, défaut 3 depuis 0046). */
  delai_sans_signe_min?: number
  /** Premier passage qui n'a rien trouvé à prendre (0031), null dès qu'il y a du travail. */
  autonome_vide_depuis?: string | null
  /** Quand il s'est éteint tout seul (0031), null s'il a été réglé à la main depuis. */
  autonome_eteint_auto_at?: string | null
  /** Où partent les factures (0052) : moyen et destinataire (e-mail, numéro WhatsApp, nom). */
  compta_canal?: 'email' | 'whatsapp' | 'autre' | null
  compta_destinataire?: string | null
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
  /** Étapes écrites par la session qui livre, pour la personne qui certifie (0005). */
  comment_verifier: string | null
  /** 0020 : « voici ce que tu dois voir » — images jointes par la session à « Comment vérifier ». */
  verifier_medias?: Media[] | null
  /** 0016 : Raphaël a demandé « vérifie pour moi » (Claude juge) ; puis le verdict de Claude. */
  verif_demandee_at?: string | null
  verdict_ok?: boolean | null
  verdict_texte?: string | null
  verdict_at?: string | null
  /** 0022 : une session a revu cet élément de « À toi » et l'a confirmé toujours utile (demander.sh --confirmer). */
  a_toi_revu_at?: string | null
  /** 0028 : reporté jusqu'à cette date (revient seul dans « Prêt à lancer ») ; null = mis de côté sans date. */
  reporte_jusqu_a?: string | null
  /** Étapes de mise en ligne (0007) : code, pousse, ci_ok|ci_ko, en_ligne|pas_en_ligne → {at, detail}. Lire avec lib/jalons.ts. */
  jalons: unknown
  etat: Etat
  priorite: Priorite
  origine: Origine
  visible_utilisateurs: boolean
  reproduction: unknown
  doublon_de: string | null
  pris_par: string | null
  pris_jusqu_a: string | null
  /** 0041 : réservation sans signe de vie libérée (quand, de qui, après combien de minutes). */
  libere_at?: string | null
  libere_de?: string | null
  libere_apres_min?: number | null
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
  /** Suggestion de fusion (kind 'fusion', 0008) : le chantier qui disparaît et celui qui reste. */
  source?: string
  cible?: string
}

export interface Message {
  id: string
  projet_id: string
  chantier_id: string | null
  auteur: string
  auteur_type: AuteurType
  /** Posé par le serveur quand l'auteur est une personne invitée (pas un admin). */
  auteur_user?: string | null
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
  /** Pièces jointes (0013) : fichiers du stockage privé `cockpit-medias`. */
  medias?: Media[] | null
  /** 0033 : marche à suivre d'une action manuelle ({liens, etapes, copier}) ; se lit par `marcheDe` (lib/marche.ts). */
  marche?: unknown
  /** 0015 : la session a confirmé la question « toujours d'actualité » après avoir avancé. */
  confirmee_at?: string | null
  /** 0023 : une demande « Où ça en est ? » (demander_ou_en_est), et quand/par qui elle a été reçue.
   *  0025 : vaut aussi pour un message libre (reçu par une session, ou pris par un assistant `agent/…`). */
  ou_en_est?: boolean | null
  recu_at?: string | null
  recu_par?: string | null
  /** 0027 : écrit par Raphaël dans une SESSION Claude (hook de suivi), recopié dans le fil. Déjà lu et répondu là-bas. */
  via_session?: boolean | null
  /** 0033 : le fil vers lequel ce message renvoie (chantier ouvert depuis ce fil, ou fil d'origine). */
  chantier_lie?: string | null
}

export interface Media {
  chemin: string   // <projet_id>/<chantier_id | projet>/<uuid>-<nom>
  nom: string
  type: string     // type MIME
  taille: number   // octets
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
  /** Rôle dans chaque projet où la personne est invitée (projet_id → rôle). */
  roles?: Record<string, RoleMembre>
  /** Droits effectifs par projet (migration 0059) : demandes, messages, valider. */
  droits?: Record<string, Partial<Record<'demandes' | 'messages' | 'valider', boolean>>>
}

export type RoleMembre = 'lecteur' | 'suggere' | 'utilisateur'

/** Une conversation Claude Code (migration 0008), suivie par les hooks. */
export interface SessionClaude {
  id: string
  projet_id: string
  branche: string | null
  sujet: string | null
  tour_en_cours: boolean
  demarre_at: string
  vu_at: string
  fin_at: string | null
  /** Arrêtée sur une limite (0010) : rate_limit, billing_error, overloaded… ; levée au signe de vie suivant. */
  pause_raison: string | null
  pause_at: string | null
  pause_detail: string | null
  relances: number
}

export type TypeTache = 'agent' | 'commande' | 'autre'
export type StatutTache = 'en_cours' | 'termine' | 'echec' | 'arrete'

/** Un travail qu'une session lance en arrière-plan : un agent ou une commande (0008). */
export interface Tache {
  id: string
  session_id: string
  projet_id: string
  tache_id: string
  type: TypeTache
  description: string | null
  sorte: string | null
  statut: StatutTache
  chantier_id: string | null
  etape: string | null
  /** null = inconnu (l'agent n'a rien signalé) : jamais une barre inventée. */
  pourcentage: number | null
  eta_secondes: number | null
  progres_at: string | null
  demarre_at: string
  vu_at: string
  fini_at: string | null
}
