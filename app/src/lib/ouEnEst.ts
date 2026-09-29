// « Où ça en est ? » : une demande qui se SUIT (29 sept. 2026, migration 0022).
//
// Raphaël : « en cliquant on ne voit pas vraiment de différence […] fais en
// sorte que ça reparte dans les trucs à traiter, que ça s'actualise, qu'on ne
// pollue pas les sessions en cliquant 10 fois, et que ça ne reste pas
// statique ». Une demande passe par ces états, calculés ici à partir des
// messages (qui arrivent en direct) :
//
//   envoyée ──► reçue par Claude ──► réponse arrivée
//      │   (la session qui y travaille la voit à son prochain pas)
//      └─► en file d'attente (n°) ──► un assistant regarde ──► réponse arrivée
//          (personne ne tient le chantier : la chef du projet la prend)
//   sans réponse après DELAI_OU_EN_EST_MS : on peut redemander.
//
// MÊME règle que la base (cockpit.ou_en_est_en_attente, delai_ou_en_est) :
// verifier-base.mjs compare le délai. Pur, vérifié par verifier-ou-en-est.ts.
import type { Activite, Chantier, Message, Tache } from './types.ts'
import { activiteDuChantier, REMANENCE_FIN_MS } from './activite.ts'
import { preuveDeVie, estDemandeOuEnEst } from './presence.ts'
import { agentVivantDuChantier } from './sessions.ts'
import { dateRelative } from './dates.ts'

/** Au-delà, une demande sans réponse est périmée : on peut redemander. Même délai que cockpit.delai_ou_en_est() (0022). */
export const DELAI_OU_EN_EST_MS = 2 * 3600_000
/** La branche des assistants que la chef lance pour répondre (scripts/chef.sh, prendre_ou_en_est). */
export const PREFIXE_ASSISTANT_POINT = 'agent/point-'

export type CodeOuEnEst = 'envoyee' | 'file' | 'recue' | 'prise' | 'repondue' | 'sans_reponse'

type M = Pick<Message, 'id' | 'projet_id' | 'chantier_id' | 'auteur_type' | 'corps' | 'created_at' | 'repond_a'> & Partial<Pick<Message, 'ou_en_est' | 'recu_at' | 'recu_par' | 'kind'>>

export interface EtatOuEnEst {
  code: CodeOuEnEst
  /** La demande suivie (la dernière du chantier). */
  demande: M
  /** Ce qu'on affiche, en mots simples. */
  libelle: string
  /** Vrai tant qu'une réponse est attendue : le bouton ne renvoie rien (pas de pollution). */
  enAttente: boolean
  /** Rang dans la file d'attente du projet (1 = la prochaine), seulement pour « file ». */
  position: number | null
  /** La réponse arrivée (« repondue »). */
  reponse: M | null
  /** La dernière étape ATTEINTE de la frise : 1 envoyée, 2 reçue / en file / assistant (ou sans réponse), 3 réponse. */
  etape: 1 | 2 | 3
}

/** La réponse à une demande : le premier message d'une session sur le chantier après elle (même règle que la base). */
function reponseA(d: M, messages: readonly M[]): M | null {
  let r: M | null = null
  for (const m of messages) {
    if (m.chantier_id !== d.chantier_id || m.auteur_type !== 'session' || m.created_at <= d.created_at) continue
    if (!r || m.repond_a === d.id || (r.repond_a !== d.id && m.created_at < r.created_at)) r = m
  }
  return r
}

const perimee = (d: M, now: Date) => now.getTime() - new Date(d.created_at).getTime() > DELAI_OU_EN_EST_MS

/** Quelqu'un tient VRAIMENT ce chantier (étape récente, ou agent vivant) : le hook lui remettra la demande. */
export function chantierTenu(chantierId: string, activites: readonly Activite[], taches: readonly Tache[], now: Date, silenceMs: number): boolean {
  return preuveDeVie(activiteDuChantier(activites, chantierId, now), now, silenceMs) || !!agentVivantDuChantier(taches, chantierId, now, silenceMs)
}

/**
 * Où en est la dernière demande « où ça en est ? » de ce chantier, ou null
 * s'il n'y en a jamais eu. `tenu` : quelqu'un y travaille (chantierTenu).
 */
export function etatOuEnEst(
  c: Pick<Chantier, 'id' | 'projet_id'>, messages: readonly M[], tenu: boolean, now: Date,
  tenus: (chantierId: string) => boolean = () => false,
): EtatOuEnEst | null {
  let d: M | null = null
  for (const m of messages) if (m.chantier_id === c.id && estDemandeOuEnEst(m) && (!d || m.created_at > d.created_at)) d = m
  if (!d) return null
  const base = { demande: d, position: null, reponse: null }
  const reponse = reponseA(d, messages)
  if (reponse) return { ...base, code: 'repondue', reponse, enAttente: false, etape: 3,
    libelle: `Réponse arrivée ${dateRelative(reponse.created_at, now)}` }
  if (perimee(d, now)) return { ...base, code: 'sans_reponse', enAttente: false, etape: 2,
    libelle: `Pas de réponse depuis ${dateRelative(d.created_at, now).replace(/^il y a /, '')} : tu peux redemander` }
  if (d.recu_at) {
    const assistant = (d.recu_par ?? '').startsWith(PREFIXE_ASSISTANT_POINT)
    return { ...base, code: assistant ? 'prise' : 'recue', enAttente: true, etape: 2,
      libelle: assistant ? `Un assistant de Claude regarde (${dateRelative(d.recu_at, now)})` : `Reçue par Claude ${dateRelative(d.recu_at, now)} : réponse en préparation` }
  }
  if (tenu) return { ...base, code: 'envoyee', enAttente: true, etape: 1 as const,
    libelle: 'Envoyée : Claude la verra à son prochain pas' }
  // Personne ne le tient : la chef du projet la prendra, dans l'ordre d'arrivée
  // (les demandes du projet encore en file, sur des chantiers que personne ne tient).
  let position = 1
  const dernieres = new Map<string, M>()
  for (const m of messages) {
    if (m.projet_id !== c.projet_id || !m.chantier_id || m.chantier_id === c.id || !estDemandeOuEnEst(m)) continue
    const x = dernieres.get(m.chantier_id)
    if (!x || m.created_at > x.created_at) dernieres.set(m.chantier_id, m)
  }
  for (const m of dernieres.values()) {
    if (m.recu_at || m.created_at >= d.created_at || perimee(m, now) || reponseA(m, messages) || tenus(m.chantier_id!)) continue
    position++
  }
  return { ...base, code: 'file', enAttente: true, position, etape: 2,
    libelle: position === 1 ? 'En file d’attente : Claude la prend à sa prochaine passe' : `En file d’attente (${position}ᵉ) : Claude la prend à sa prochaine passe` }
}

/** Les trois étapes de la frise, en mots (la 2ᵉ dit par où elle passe). */
export function etapesOuEnEst(e: Pick<EtatOuEnEst, 'code' | 'position'>): [string, string, string] {
  const deux = e.code === 'file' ? 'En file' : e.code === 'prise' ? 'Assistant' : e.code === 'sans_reponse' ? 'Sans réponse' : 'Reçue'
  return ['Envoyée', deux, 'Réponse']
}

/**
 * La demande se montre dans « Ça avance tout seul » : tant qu'on attend sa
 * réponse, puis un quart d'heure après son arrivée (comme une étape terminée,
 * REMANENCE_FIN_MS) pour qu'il la voie sans ouvrir la conversation.
 */
export function ouEnEstVisible(e: EtatOuEnEst | null | undefined, now: Date): boolean {
  if (!e) return false
  if (e.enAttente) return true
  return e.code === 'repondue' && !!e.reponse && now.getTime() - new Date(e.reponse.created_at).getTime() < REMANENCE_FIN_MS
}
