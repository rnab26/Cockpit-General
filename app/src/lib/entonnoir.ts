// L'entonnoir du cockpit (29 sept. 2026) : trois questions, dans cet ordre,
// pour TOUS les projets d'un coup ou pour un seul.
//   1. « En ce moment » : qui travaille VRAIMENT (preuve de vie, presence.ts) ;
//   2. « À toi »        : ce qui attend un geste de Raphaël, trié ;
//   3. « À lancer »     : ce que personne ne tient, à relancer.
// Ses mots : « quand je regarde, j'ai déjà toutes les informations sous les
// yeux, je fais quelques clics, je réponds à des questions ».
//
// Pur : aucune dépendance React ni réseau, vérifié par
// scripts/verifier-entonnoir.ts. La règle « qui travaille » reste celle de
// presence.ts : ce module ne fait que la RANGER, il ne la redéfinit jamais.
import type { Activite, Chantier, Message, Priorite, SessionClaude, Tache } from './types.ts'
import { activiteDuChantier } from './activite.ts'
import { chantiersEnAttente } from './ouJenSuis.ts'
import { presenceChantier, preuveDeVie, derniereDemandeOuCaEnEst, type CodePresence, type Presence } from './presence.ts'
import { activiteDeTache, agentVivantDuChantier, nomSession, presenceAvecAgent, quiTravaille, resumeTravail, tacheEnCoursVivante, estSessionAutonome, type QuiTravaille } from './sessions.ts'
import { syntheseMiseEnLigne } from './jalons.ts'
import { etatOuEnEst, chantierTenu, ouEnEstVisible, type EtatOuEnEst } from './ouEnEst.ts'
import { extrait, nomCourtSession } from './texte.ts'
import { dateRelative } from './dates.ts'
import { estAction } from './discussion.ts'

type ChantierE = Chantier
type MessageE = Message

// ---------------------------------------------------------------- présence

/**
 * La présence d'un chantier, avec l'activité qui la fonde (une seule façon de
 * la calculer dans l'app) : la règle de presence.ts, puis ses agents vivants
 * (sessions.ts) — un agent qui a signalé son avancement compte comme preuve de vie.
 */
export function presenceDe(
  c: ChantierE, activites: readonly Activite[], enAttente: ReadonlySet<string>, now: Date, silenceMs: number, taches: readonly Tache[] = [],
): { presence: Presence; activite: Activite | null } {
  const activite = activiteDuChantier(activites, c.id, now)
  const base = presenceChantier(c, activite, enAttente.has(c.id), now, silenceMs)
  const agent = agentVivantDuChantier(taches, c.id, now, silenceMs)
  const presence = presenceAvecAgent(base, agent, now)
  return { presence, activite: presence !== base && agent && agent.pourcentage != null ? activiteDeTache(agent, now) : activite }
}

export const LIBELLE_COURT_PRESENCE: Record<CodePresence, string> = {
  travaille: 'Claude y travaille', attend_toi: 'attend ta réponse', a_verifier: 'à vérifier', claude_verifie: 'Claude vérifie pour toi', silencieux: 'pris, silencieux',
  a_cadrer: 'à cadrer', bloque: 'bloqué', personne: 'personne dessus', reporte: 'reporté', termine: 'certifié',
}
/** Ordre de lecture d'une liste : ce qui bouge, puis ce qui t'attend, puis ce qui dort. */
const RANG_PRESENCE: Record<CodePresence, number> = {
  travaille: 0, claude_verifie: 1, attend_toi: 2, a_verifier: 3, silencieux: 4, a_cadrer: 5, bloque: 6, personne: 7, reporte: 8, termine: 9,
}
const RANG_PRIORITE: Record<Priorite, number> = { haute: 0, normale: 1, basse: 2 }

/** Trie des chantiers par présence, puis priorité, puis dernier changement. */
export function trierParPresence<T extends { c: Pick<Chantier, 'priorite' | 'updated_at' | 'titre'>; presence: Pick<Presence, 'code'> }>(liste: readonly T[]): T[] {
  return [...liste].sort((a, b) =>
    RANG_PRESENCE[a.presence.code] - RANG_PRESENCE[b.presence.code]
    || (RANG_PRIORITE[a.c.priorite] ?? 1) - (RANG_PRIORITE[b.c.priorite] ?? 1)
    || (b.c.updated_at ?? '').localeCompare(a.c.updated_at ?? '')
    || a.c.titre.localeCompare(b.c.titre, 'fr'))
}

/** Compteurs par présence (en-tête de section) : seulement les codes présents, dans l'ordre de lecture. L'icône vient de l'écran. */
export function compteursPresence(codes: readonly CodePresence[]): { code: CodePresence; n: number }[] {
  const n = new Map<CodePresence, number>()
  for (const c of codes) n.set(c, (n.get(c) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => RANG_PRESENCE[a[0]] - RANG_PRESENCE[b[0]]).map(([code, k]) => ({ code, n: k }))
}

// ---------------------------------------------------------------- 1. En ce moment

export interface LigneEnCeMoment {
  activite: Activite
  chantier: Chantier | null
  projetId: string
}

/** Une ligne par session réellement vivante (sa dernière étape), la plus récente d'abord. */
export function enCeMoment(
  activites: readonly Activite[], chantiers: readonly Chantier[], now: Date, silenceMs: number, projetId: string | null = null,
): LigneEnCeMoment[] {
  const parSession = new Map<string, Activite>()
  for (const a of activites) {
    if (projetId && a.projet_id !== projetId) continue
    if (!preuveDeVie(a, now, silenceMs)) continue
    const deja = parSession.get(a.session)
    if (!deja || a.updated_at > deja.updated_at) parSession.set(a.session, a)
  }
  const parId = new Map(chantiers.map((c) => [c.id, c]))
  return [...parSession.values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((a) => ({ activite: a, chantier: a.chantier_id ? parId.get(a.chantier_id) ?? null : null, projetId: a.projet_id }))
}

// ---------------------------------------------------------------- 2. À toi

export type TypeAToi = 'question' | 'action' | 'fusion' | 'a_verifier' | 'a_cadrer' | 'bloque'
export const ORDRE_A_TOI: readonly TypeAToi[] = ['question', 'action', 'fusion', 'a_verifier', 'a_cadrer', 'bloque']
/** Le geste attendu, en UN verbe : le bouton de la ligne (modèle A, 29 sept. 2026). */
export const VERBE_A_TOI: Record<TypeAToi, string> = {
  question: 'Répondre', action: 'Faire', fusion: 'Trancher', a_verifier: 'Tester', a_cadrer: 'Décider', bloque: 'Débloquer',
}

export interface ElementAToi {
  type: TypeAToi
  /** Clé stable (React, tests). */
  cle: string
  projetId: string
  chantier: Chantier | null
  /** La question pour « question », l'action pour « action » ; la suggestion pour « fusion » ; le dernier « blocage » pour « bloque ». */
  message: Message | null
  /**
   * Depuis quand ça t'attend (ISO) : posée, livrée, bloquée… ou reconfirmée
   * par une session (0015 confirmee_at, 0022 a_toi_revu_at). Affiché « il y a
   * 12 h » et sert au tri (le plus récent en haut).
   */
  depuis: string
  /**
   * Claude a travaillé sur ce chantier APRÈS `depuis` sans reconfirmer (date du
   * dernier travail) : l'élément est peut-être dépassé. La session le confirme
   * ou le retire (demander.sh --confirmer / --retirer ; la chef le fait revoir,
   * a_toi_a_revoir). Sinon null.
   */
  avanceDepuis?: string | null
}

export const estQuestionOuverte = (m: Pick<Message, 'kind' | 'answered_at'>) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at

/**
 * Les questions et actions encore ouvertes d'un chantier, la plus ancienne
 * d'abord. Certifier ne les ferme pas (migration 0026) : l'app les montre à
 * Raphaël quand il touche « Ça marche », pour qu'il y réponde ou certifie quand même.
 */
export function questionsOuvertesDe<T extends Pick<Message, 'kind' | 'answered_at' | 'chantier_id' | 'created_at'>>(chantierId: string, messages: readonly T[]): T[] {
  return messages.filter((m) => m.chantier_id === chantierId && estQuestionOuverte(m)).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Une session qui écrit juste après avoir posé l'élément (fin de tour, livraison) n'a pas « avancé depuis ». */
export const GRACE_AVANCE_MS = 2 * 60_000
const plusTard = (a: string | null | undefined, b: string | null | undefined): string => ((a ?? '') > (b ?? '') ? a ?? '' : b ?? '')

/**
 * Le tri de « À toi » (Raphaël, 29 sept. 2026 : « je ne sais pas quelles sont
 * les requêtes les plus récentes et les plus vieilles ») : d'abord ce qui est
 * à jour, puis ce que Claude a peut-être dépassé ; dans chaque bloc, le plus
 * récent en haut (ou le plus ancien, au choix de l'écran).
 */
export type TriAToi = 'recents' | 'anciens'
export function trierAToi(elements: readonly ElementAToi[], tri: TriAToi = 'recents'): ElementAToi[] {
  const sens = tri === 'recents' ? -1 : 1
  return [...elements].sort((a, b) => Number(!!a.avanceDepuis) - Number(!!b.avanceDepuis) || sens * a.depuis.localeCompare(b.depuis) || a.cle.localeCompare(b.cle))
}

/**
 * Tout ce qui attend un geste de Raphaël : questions, fusions que Claude
 * propose, à vérifier, à cadrer, bloqués. Chaque élément dit depuis quand il
 * attend et si Claude a avancé depuis ; trié par trierAToi.
 */
export function aToi(chantiers: readonly ChantierE[], messages: readonly MessageE[], projetId: string | null = null,
  activites: readonly Activite[] = [], taches: readonly Tache[] = [], tri: TriAToi = 'recents'): ElementAToi[] {
  const parId = new Map(chantiers.map((c) => [c.id, c]))
  // Le dernier travail d'une session sur un chantier : message de session, étape signalée, étape d'agent.
  const dernierTravail = (cid: string): string | null => {
    let d = ''
    for (const m of messages) if (m.chantier_id === cid && m.auteur_type === 'session' && m.kind !== 'question' && m.kind !== 'action' && m.kind !== 'fusion' && m.created_at > d) d = m.created_at
    for (const a of activites) if (a.chantier_id === cid && a.updated_at > d) d = a.updated_at
    for (const t of taches) if (t.chantier_id === cid && t.progres_at && t.progres_at > d) d = t.progres_at
    return d || null
  }
  const avance = (cid: string | null, depuis: string): string | null => {
    if (!cid) return null
    const d = dernierTravail(cid)
    return d && new Date(d).getTime() > new Date(depuis).getTime() + GRACE_AVANCE_MS ? d : null
  }
  const dansProjet = (id: string) => !projetId || id === projetId
  const questions: ElementAToi[] = messages
    .filter((m) => estQuestionOuverte(m) && dansProjet(m.projet_id))
    // Un certifié est aussi archivé (« Fini ») : sa question gardée reste ici (0026). Un archivé l'a fermée en base.
    .filter((m) => { const c = m.chantier_id ? parId.get(m.chantier_id) : null; return !m.chantier_id || (!!c && (!c.archived_at || c.etat === 'valide')) })
    .map((m) => {
      const depuis = plusTard(m.created_at, m.confirmee_at)
      return { type: estAction(m) ? 'action' as const : 'question' as const, cle: `q-${m.id}`, projetId: m.projet_id, chantier: m.chantier_id ? parId.get(m.chantier_id) ?? null : null, message: m, depuis, avanceDepuis: avance(m.chantier_id, depuis) }
    })

  // Une suggestion de fusion (0008) : Claude a trouvé deux chantiers qui sont le même sujet.
  const fusions: ElementAToi[] = messages
    .filter((m) => m.kind === 'fusion' && !m.answered_at && dansProjet(m.projet_id))
    .map((m) => ({ type: 'fusion' as const, cle: `f-${m.id}`, projetId: m.projet_id, chantier: m.chantier_id ? parId.get(m.chantier_id) ?? null : null, message: m, depuis: m.created_at, avanceDepuis: null }))

  const ouverts = chantiers.filter((c) => !c.archived_at && dansProjet(c.projet_id))
  const dernierBlocage = (id: string) => messages.filter((m) => m.chantier_id === id && m.kind === 'blocage').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  // Depuis quand un chantier attend Raphaël : livré ou jugé (à vérifier), dernier blocage (bloqué), dernière modification sinon.
  const debut = (c: ChantierE, type: 'a_verifier' | 'a_cadrer' | 'bloque', blocage: MessageE | null): string =>
    plusTard(type === 'a_verifier' ? plusTard(c.livre_at, c.verdict_at) || c.updated_at : type === 'bloque' ? blocage?.created_at ?? c.updated_at : c.updated_at, c.a_toi_revu_at)
  // « Vérifie pour moi » en cours (0016) : ce n'est plus à Raphaël de jouer, Claude juge.
  const deType = (type: 'a_verifier' | 'a_cadrer' | 'bloque'): ElementAToi[] => ouverts.filter((c) => c.etat === type && !(type === 'a_verifier' && c.verif_demandee_at))
    .map((c) => {
      const message = type === 'bloque' ? dernierBlocage(c.id) : null
      const depuis = debut(c, type, message)
      return { type, cle: `${type}-${c.id}`, projetId: c.projet_id, chantier: c, message, depuis, avanceDepuis: avance(c.id, depuis) }
    })
  return trierAToi([...questions, ...fusions, ...deType('a_verifier'), ...deType('a_cadrer'), ...deType('bloque')], tri)
}

/** Les éléments regroupés par type, dans l'ordre de l'entonnoir, groupes vides retirés. */
export function grouperAToi(elements: readonly ElementAToi[]): { type: TypeAToi; elements: ElementAToi[] }[] {
  return ORDRE_A_TOI.map((type) => ({ type, elements: elements.filter((e) => e.type === type) })).filter((g) => g.elements.length > 0)
}

// ---------------------------------------------------------------- 3. À lancer

export interface LigneALancer {
  c: Chantier
  presence: Presence
  activite: Activite | null
  /** Quand « Demander où ça en est » a été envoyé pour la dernière fois (ISO), ou null. */
  demandeLe: string | null
}

/**
 * « En cours, mais plus de nouvelles » (29 sept., retour de Raphaël : « trois
 * chantiers en cours, un affiché en haut, deux en bas ; je veux voir tout ce
 * qui progresse ensemble ») : un chantier pris mais muet, ou « en cours » sans
 * personne derrière sa barre figée. Il s'affiche dans « En ce moment », en
 * jaune et sans animation — jamais dans « À lancer » (pas de doublon).
 */
export function estEnCoursSansNouvelles(c: Pick<Chantier, 'etat'>, p: Pick<Presence, 'code'>): boolean {
  return p.code === 'silencieux' || (p.code === 'personne' && c.etat === 'en_cours')
}

/** Personne ne tient ce chantier encore en travail : seul cas où « Où ça en est ? » le remet dans « Ça avance ». */
function enCoursSansPersonne(p: Pick<Presence, 'code'>): boolean {
  return p.code === 'personne' || p.code === 'silencieux'
}

function sansPersonne(
  chantiers: readonly ChantierE[], activites: readonly Activite[], messages: readonly MessageE[],
  now: Date, silenceMs: number, ordreProjets: readonly string[], projetId: string | null, taches: readonly Tache[],
  garder: (l: LigneALancer) => boolean,
): { projetId: string; lignes: LigneALancer[] }[] {
  const enAttente = chantiersEnAttente(messages)
  const lignes: LigneALancer[] = []
  for (const c of chantiers) {
    if (c.archived_at || (projetId && c.projet_id !== projetId)) continue
    const { presence, activite } = presenceDe(c, activites, enAttente, now, silenceMs, taches)
    if (!enCoursSansPersonne(presence)) continue
    // « Où ça en est ? » en attente (0023) : il est reparti, il se suit dans « Ça avance tout seul ».
    if (ouEnEstVisible(etatOuEnEst(c, messages, false, now), now)) continue
    const demande = derniereDemandeOuCaEnEst(messages.filter((m) => m.chantier_id === c.id))
    const l = { c, presence, activite, demandeLe: demande?.created_at ?? null }
    if (garder(l)) lignes.push(l)
  }
  const triees = trierParPresence(lignes)
  const groupes = new Map<string, LigneALancer[]>()
  for (const l of triees) groupes.set(l.c.projet_id, [...(groupes.get(l.c.projet_id) ?? []), l])
  const rang = (id: string) => { const i = ordreProjets.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
  return [...groupes.entries()].sort((a, b) => rang(a[0]) - rang(b[0])).map(([pid, l]) => ({ projetId: pid, lignes: l }))
}

/**
 * « À lancer » : les chantiers que PERSONNE ne tient et qui n'ont pas encore
 * commencé (libre, à trier…), groupés par projet dans l'ordre `ordreProjets`,
 * priorité haute d'abord. Ceux « en cours sans nouvelles » vont dans « En ce moment ».
 */
export function aLancer(
  chantiers: readonly ChantierE[], activites: readonly Activite[], messages: readonly MessageE[],
  now: Date, silenceMs: number, ordreProjets: readonly string[], projetId: string | null = null, taches: readonly Tache[] = [],
): { projetId: string; lignes: LigneALancer[] }[] {
  return sansPersonne(chantiers, activites, messages, now, silenceMs, ordreProjets, projetId, taches,
    (l) => !estEnCoursSansNouvelles(l.c, l.presence) && !repriseReponse(l.c, messages, activites, taches, now))
}

/** Les chantiers « en cours, mais plus de nouvelles », groupés par projet (silencieux d'abord). */
export function enCoursSansNouvelles(
  chantiers: readonly ChantierE[], activites: readonly Activite[], messages: readonly MessageE[],
  now: Date, silenceMs: number, ordreProjets: readonly string[], projetId: string | null = null, taches: readonly Tache[] = [],
): { projetId: string; lignes: LigneALancer[] }[] {
  return sansPersonne(chantiers, activites, messages, now, silenceMs, ordreProjets, projetId, taches,
    (l) => estEnCoursSansNouvelles(l.c, l.presence) && !repriseReponse(l.c, messages, activites, taches, now))
}

// ---------------------------------------------------------------- onglets

/**
 * Les pastilles d'un onglet : sessions qui travaillent (🟢 n : sessions
 * suivies actives + barres vivantes sans session suivie) et choses qui
 * t'attendent (🔴 n).
 */
export function pastillesProjet(
  chantiers: readonly ChantierE[], messages: readonly MessageE[], activites: readonly Activite[],
  sessions: readonly SessionClaude[], taches: readonly Tache[], now: Date, silenceMs: number, projetId: string | null,
): { travaillent: number; aToi: number } {
  return {
    travaillent: resumeTravail(quiTravaille(sessions, taches, activites, chantiers, now, silenceMs, [], projetId)).sessions,
    aToi: aToi(chantiers, messages, projetId).length,
  }
}

// ---------------------------------------------------------------- tableau de bord (modèle A, 29 sept. 2026)
// Raphaël : « des modèles plus compacts […] qu'un amateur, un enfant puisse
// s'y retrouver ». Une ligne = le SUJET d'abord (titre du chantier), puis en
// petit ce qu'on attend, puis UN bouton-verbe.

/** Ce qu'on attend de toi, en mots simples, sous le titre d'une ligne « À toi de jouer ». */
export function attenteAToi(e: Pick<ElementAToi, 'type' | 'chantier' | 'message' | 'avanceDepuis'>, now: Date = new Date()): string {
  // Claude a travaillé dessus depuis (0015, généralisé 0022) : peut-être déjà réglé, la chef le fait revoir.
  if (e.avanceDepuis) return `Claude a travaillé dessus ${dateRelative(e.avanceDepuis, now)} : peut-être déjà réglé, il vérifie`
  switch (e.type) {
    case 'action': return 'Claude attend un geste de toi'
    case 'question': return 'Claude te pose une question'
    case 'fusion': return 'Claude propose de fusionner deux chantiers'
    case 'a_verifier': {
      if (e.chantier?.verdict_at && e.chantier.verdict_ok) return 'Claude a vérifié : c’est bon, confirme d’un toucher'
      const s = e.chantier ? syntheseMiseEnLigne(e.chantier.jalons, now) : null
      if (!s) return 'livré, à tester'
      if (s.code === 'ci_ko') return 'livré, mais les robots ont trouvé un problème'
      if (s.code === 'geste') return 'livré, il faut ton geste avant de tester'
      return s.peutVerifier ? 'en ligne, à tester' : 'livré, pas encore en ligne'
    }
    case 'a_cadrer': return 'ta décision avant de coder'
    case 'bloque': return e.message ? `bloqué : ${extrait(e.message.corps, 60)}` : 'bloqué, dis-lui quoi faire'
  }
}

/** L'état de présence d'un chantier en mots, pour l'en-tête de sa conversation (« Claude y travaille — 60 % »). */
export function presenceEnMots(p: Pick<Presence, 'code' | 'libelle'>, activite: Pick<Activite, 'pourcentage'> | null): string {
  if (p.code === 'travaille') return activite ? `${p.libelle} — ${activite.pourcentage} %` : p.libelle
  return LIBELLE_COURT_PRESENCE[p.code]
}

export interface LigneCaAvance {
  c: Chantier
  presence: Presence
  /** La barre, SEULEMENT si un avancement a été signalé (grise si plus de nouvelles). */
  activite: Activite | null
  /** Preuve de vie : barre vive. Sinon « sans nouvelles » : à relancer. */
  vivant: boolean
  /** Qui avance, en mots de tous les jours : « Claude, en autonomie », « 1 assistant de Claude », « Claude (conversation « x ») · 2 assistants de Claude ». */
  qui: string
  /** La dernière étape signalée (« écran refait, tests en cours »), ou null. */
  etape: string | null
  /** Sans nouvelles : pourquoi (« Plus de nouvelles » / « Personne dessus »), et la dernière demande « où ça en est ». */
  pourquoi: string | null
  demandeLe: string | null
  /** Une réponse de Raphaël attend d'être reprise, ou l'est en ce moment (0017) : pas de « Relancer ». */
  reprise?: RepriseReponse | null
  /** Sa dernière demande « Où ça en est ? » et où elle en est (0023, lib/ouEnEst.ts). */
  ouEnEst?: EtatOuEnEst | null
}

// ---------------------------------------------------------------- réponse reprise (0017)
// Raphaël, 29 sept. : « je réponds dans le cockpit, mais je ne sais pas si
// c'est pris en compte et par quelle session ». Une réponse sur un chantier
// que personne ne tient est reprise par la session chef (scripts/chef.sh →
// reprendre_reponse) ; en attendant, et pendant la reprise, elle se VOIT.

/** Le début du message que la base écrit quand la chef reprend une réponse (0017, reprendre_reponse). */
export const PREFIXE_REPRISE = 'Claude reprend ta réponse'
/** Même fenêtre que reponses_sans_suite (0017) : une vieille réponse ne ressort jamais. */
export const JOURS_REPONSE_REPRISE = 7

export type RepriseReponse = 'attend' | 'reprise'

/**
 * Où en est la dernière réponse de Raphaël sur ce chantier :
 *  - « attend » : rien ne l'a suivie (aucun message de session, aucune étape,
 *    aucune étape d'agent) — la chef la reprendra à sa prochaine passe ;
 *  - « reprise » : la chef l'a reprise (« Claude reprend ta réponse »), le
 *    chantier est réservé, et l'assistant n'a encore rien signalé ;
 *  - null : rien à montrer (suivie, retirée, trop vieille, chantier fini).
 */
export function repriseReponse(
  c: Pick<Chantier, 'id' | 'etat' | 'archived_at' | 'pris_jusqu_a'>, messages: readonly MessageE[],
  activites: readonly Activite[], taches: readonly Tache[], now: Date,
): RepriseReponse | null {
  if (c.archived_at || c.etat === 'valide') return null
  const limite = new Date(now.getTime() - JOURS_REPONSE_REPRISE * 86_400_000).toISOString()
  let r: MessageE | null = null
  for (const m of messages) {
    // Seules SES réponses depuis l'app (answered_by) : une réponse notée par une session
    // vient de sa conversation, elle est déjà prise (0018, même règle que la base).
    if (m.chantier_id !== c.id || (m.kind !== 'question' && m.kind !== 'action') || !m.answered_at || !m.answered_by) continue
    if (!r || m.answered_at > r.answered_at!) r = m
  }
  if (!r || r.answered_at! <= limite || (r.reponse ?? '').startsWith('Retirée par Claude')) return null
  const t0 = r.answered_at!
  if (activites.some((a) => a.chantier_id === c.id && a.updated_at > t0)) return null
  if (taches.some((t) => t.chantier_id === c.id && !!t.progres_at && t.progres_at > t0)) return null
  const apres = messages.filter((m) => m.chantier_id === c.id && m.id !== r!.id && m.auteur_type === 'session' && m.created_at > t0)
  if (apres.length === 0) return 'attend'
  const tenu = !!c.pris_jusqu_a && c.pris_jusqu_a > now.toISOString()
  return tenu && apres.every((m) => m.kind === 'info' && m.corps.startsWith(PREFIXE_REPRISE)) ? 'reprise' : null
}

export const LIBELLE_REPRISE: Record<RepriseReponse, string> = {
  attend: 'Ta réponse est reçue : Claude va la reprendre',
  reprise: 'Claude reprend ta réponse',
}

/**
 * « Ça avance tout seul » : UNE ligne par CHANTIER (plus par session) — ce qui
 * travaille vraiment (preuve de vie, règle de presence.ts + agents), puis les
 * « en cours sans nouvelles », à relancer. Vivants d'abord (le plus récent en
 * tête), puis silencieux, puis personne.
 */
export function caAvanceToutSeul(
  chantiers: readonly ChantierE[], activites: readonly Activite[], messages: readonly MessageE[],
  sessions: readonly SessionClaude[], taches: readonly Tache[], now: Date, silenceMs: number, projetId: string | null = null,
): LigneCaAvance[] {
  const enAttente = chantiersEnAttente(messages)
  const lignes: LigneCaAvance[] = []
  const tenus = (id: string) => chantierTenu(id, activites, taches, now, silenceMs)
  for (const c of chantiers) {
    if (c.archived_at || (projetId && c.projet_id !== projetId)) continue
    const { presence: presenceBase, activite } = presenceDe(c, activites, enAttente, now, silenceMs, taches)
    const act = activiteDuChantier(activites, c.id, now)
    const parSession = act && preuveDeVie(act, now, silenceMs) ? act : null
    const agentVivant = agentVivantDuChantier(taches, c.id, now, silenceMs)
    // Retour de Raphaël, 29 sept. : « des agents tournent sur FacePro et le
    // cockpit ne montre rien en cours ». Un chantier qui ATTEND aussi sa
    // réponse (question ouverte, bloqué) restait hors de « Ça avance » alors
    // qu'une preuve de vie existe. Le travail réel se montre toujours ici ;
    // la question, elle, reste aussi dans « À toi ».
    const presence: Presence = presenceBase.code === 'travaille' || presenceBase.code === 'claude_verifie' || !(parSession || agentVivant) ? presenceBase : {
      code: 'travaille', libelle: 'Claude y travaille', teinte: 'ok', detail: presenceBase.detail,
      barreVive: !!parSession || agentVivant?.pourcentage != null, aRelancer: false, tonAction: presenceBase.tonAction,
    }
    if (presence.code === 'claude_verifie') {
      // « Vérifie pour moi » : sorti de « À toi », il avance ici, sous le même nom partout.
      const barre = agentVivant && agentVivant.pourcentage != null ? activiteDeTache(agentVivant, now) : parSession
      // Retour de Raphaël, 30 sept. : sans session ni assistant vivant il n'y a ni barre ni travail :
      // la ligne passe dans « en cours sans session dessus », pas dans « ça avance ».
      const vivant = !!(parSession || agentVivant)
      lignes.push({ c, presence, activite: vivant ? barre : null, vivant, qui: vivant ? presence.libelle : '',
        etape: vivant ? (barre?.etape || agentVivant?.etape || null) : null, pourquoi: vivant ? null : 'Vérification demandée : en attente d’un assistant',
        demandeLe: null, ouEnEst: etatOuEnEst(c, messages, vivant, now, tenus) })
    } else if (presence.code === 'travaille') {
      const agents = taches.filter((t) => t.chantier_id === c.id && t.type === 'agent' && tacheEnCoursVivante(t, now)).length
      const morceaux: string[] = []
      if (parSession) {
        const s = sessions.find((x) => x.projet_id === c.projet_id && x.branche === parSession.session)
        morceaux.push(s && estSessionAutonome(s) ? 'Claude, en autonomie' : `Claude (conversation « ${s ? nomSession(s) : nomCourtSession(parSession.session)} »)`)
      }
      if (agents) morceaux.push(`${agents} assistant${agents > 1 ? 's' : ''} de Claude`)
      // Jamais une vieille barre sous une ligne vivante : celle de la session, ou celle de l'agent s'il a signalé un %.
      // Deux sources vivantes (conversation ET assistant) : la barre est celle du signal le PLUS RÉCENT,
      // jamais l'ancien pourcentage d'une conversation devant l'avancement frais de l'assistant.
      const barreAgent = agentVivant && agentVivant.pourcentage != null ? activiteDeTache(agentVivant, now) : null
      const barre = parSession && barreAgent ? (barreAgent.updated_at > parSession.updated_at ? barreAgent : parSession)
        : parSession ?? (presence.barreVive ? (presenceBase.code === 'travaille' ? activite : barreAgent) : null)
      const agent = agentVivant
      lignes.push({ c, presence, activite: barre, vivant: true, qui: morceaux.join(' · ') || 'Claude',
        etape: barre?.etape || agent?.etape || null, pourquoi: null, demandeLe: null, ouEnEst: etatOuEnEst(c, messages, true, now, tenus) })
    } else if (repriseReponse(c, messages, activites, taches, now)) {
      // Raphaël a répondu, personne ne l'a encore suivie (ou la chef vient de la
      // reprendre) : ça avance, ce n'est ni « sans nouvelles » ni à relancer.
      const reprise = repriseReponse(c, messages, activites, taches, now)!
      lignes.push({ c, presence, activite: null, vivant: false, qui: '', etape: null, pourquoi: LIBELLE_REPRISE[reprise], demandeLe: null, reprise })
    } else if (enCoursSansPersonne(presence) && ouEnEstVisible(etatOuEnEst(c, messages, false, now, tenus), now)) {
      // « Où ça en est ? » (0023) : sa demande le remet dans ce qui avance ;
      // JAMAIS un chantier fini ou qui t'attend (à vérifier, bloqué, à cadrer,
      // reporté, question ouverte) : il est déjà dans « À toi » (Raphaël,
      // 30 sept. : « un chantier fini reste dans ce qui avance, ça pollue »).
      // la ligne suit la demande (envoyée → en file / reçue → réponse), en direct.
      // Jamais la vieille barre grise d'une livraison passée sous la demande
      // (Raphaël, 30 sept. : « la barre ne se réactive pas ») : la ligne suit
      // la DEMANDE ; la barre revient, vive, dès que l'assistant signale son étape
      // (il passe alors dans « travaille », au-dessus).
      const oe = etatOuEnEst(c, messages, false, now, tenus)!
      lignes.push({ c, presence, activite: null, vivant: false, qui: '', etape: null, pourquoi: oe.libelle, demandeLe: oe.demande.created_at, ouEnEst: oe })
    } else if (estEnCoursSansNouvelles(c, presence)) {
      const demande = derniereDemandeOuCaEnEst(messages.filter((m) => m.chantier_id === c.id))
      lignes.push({ c, presence, activite, vivant: false, qui: '', etape: activite?.etape || null, pourquoi: presence.code === 'silencieux' ? 'Plus de nouvelles' : 'Personne dessus',
        demandeLe: demande?.created_at ?? null })
    }
  }
  const quand = (l: LigneCaAvance) => l.activite?.updated_at ?? l.c.updated_at ?? ''
  return lignes.sort((a, b) => Number(b.vivant) - Number(a.vivant)
    || RANG_PRESENCE[a.presence.code] - RANG_PRESENCE[b.presence.code]
    || quand(b).localeCompare(quand(a)))
}

export interface LigneHorsChantier {
  cle: string
  projetId: string
  texte: string
  /** Arrêtée sur une limite d'usage : rien ne s'anime. */
  pause: boolean
}

/**
 * Le travail qu'aucun chantier ne porte : une session vivante dont aucune
 * barre ni aucun agent n'est rattaché à un chantier, ou une barre sans
 * chantier. Une ligne discrète chacune, dans les mots de ce qu'elle fait VRAIMENT.
 */
export function horsChantier(groupes: readonly QuiTravaille[]): LigneHorsChantier[] {
  const r: LigneHorsChantier[] = []
  for (const g of groupes) {
    for (const vs of g.sessions) {
      const surChantier = vs.activites.some((a) => a.chantier_id) || vs.taches.some((t) => t.chantier)
      if (surChantier) continue
      const nom = nomSession(vs.session)
      const texte = vs.pause ? `Claude (« ${nom} ») ${vs.pause.charAt(0).toLowerCase()}${vs.pause.slice(1)}`
        : vs.repond ? `Claude travaille sur autre chose (« ${nom} »)`
        : estSessionAutonome(vs.session) ? 'Claude en autonomie : en veille, se réveille tout seul chaque heure'
        : `Conversation « ${nom} » ouverte : attend ton message`
      r.push({ cle: `s-${vs.session.id}`, projetId: g.projetId, texte, pause: !!vs.pause })
    }
    for (const a of g.activitesSeules) {
      if (a.chantier_id) continue
      r.push({ cle: `a-${a.id}`, projetId: g.projetId, texte: `Claude travaille sur autre chose (« ${nomCourtSession(a.session)} »)${a.etape ? ` · ${a.etape}` : ''}`, pause: false })
    }
  }
  return r
}
