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
import { activiteDeTache, agentVivantDuChantier, presenceAvecAgent, quiTravaille, resumeTravail } from './sessions.ts'

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

export const ICONE_PRESENCE: Record<CodePresence, string> = {
  travaille: '🟢', attend_toi: '🔴', a_verifier: '🧪', silencieux: '🟡', a_cadrer: '🗣️',
  bloque: '⛔', personne: '⏸️', reporte: '💤', termine: '✅',
}
export const LIBELLE_COURT_PRESENCE: Record<CodePresence, string> = {
  travaille: 'Claude y travaille', attend_toi: 'attend ta réponse', a_verifier: 'à vérifier', silencieux: 'pris, silencieux',
  a_cadrer: 'à cadrer', bloque: 'bloqué', personne: 'personne dessus', reporte: 'reporté', termine: 'certifié',
}
/** Ordre de lecture d'une liste : ce qui bouge, puis ce qui t'attend, puis ce qui dort. */
const RANG_PRESENCE: Record<CodePresence, number> = {
  travaille: 0, attend_toi: 1, a_verifier: 2, silencieux: 3, a_cadrer: 4, bloque: 5, personne: 6, reporte: 7, termine: 8,
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

/** Compteurs par présence (en-tête de section) : seulement les codes présents, dans l'ordre de lecture. */
export function compteursPresence(codes: readonly CodePresence[]): { code: CodePresence; icone: string; n: number }[] {
  const n = new Map<CodePresence, number>()
  for (const c of codes) n.set(c, (n.get(c) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => RANG_PRESENCE[a[0]] - RANG_PRESENCE[b[0]]).map(([code, k]) => ({ code, icone: ICONE_PRESENCE[code], n: k }))
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

export type TypeAToi = 'question' | 'fusion' | 'a_verifier' | 'a_cadrer' | 'bloque'
export const ORDRE_A_TOI: readonly TypeAToi[] = ['question', 'fusion', 'a_verifier', 'a_cadrer', 'bloque']
export const TITRE_A_TOI: Record<TypeAToi, string> = {
  question: '🔴 Questions', fusion: '🔀 Fusions proposées par Claude', a_verifier: '🧪 À vérifier', a_cadrer: '🗣️ À cadrer', bloque: '⛔ Bloqués',
}

export interface ElementAToi {
  type: TypeAToi
  /** Clé stable (React, tests). */
  cle: string
  projetId: string
  chantier: Chantier | null
  /** La question/action pour « question » ; la suggestion pour « fusion » ; le dernier « blocage » pour « bloque ». */
  message: Message | null
}

const estQuestionOuverte = (m: Pick<Message, 'kind' | 'answered_at'>) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at

/**
 * Tout ce qui attend un geste de Raphaël, trié : questions (la plus ancienne
 * d'abord : elle attend depuis le plus longtemps) → fusions que Claude propose
 * → à vérifier → à cadrer → bloqués (priorité haute d'abord, puis le plus
 * récemment touché).
 */
export function aToi(chantiers: readonly ChantierE[], messages: readonly MessageE[], projetId: string | null = null): ElementAToi[] {
  const parId = new Map(chantiers.map((c) => [c.id, c]))
  const dansProjet = (id: string) => !projetId || id === projetId
  const questions: ElementAToi[] = messages
    .filter((m) => estQuestionOuverte(m) && dansProjet(m.projet_id))
    .filter((m) => { const c = m.chantier_id ? parId.get(m.chantier_id) : null; return !m.chantier_id || (!!c && !c.archived_at) })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({ type: 'question' as const, cle: `q-${m.id}`, projetId: m.projet_id, chantier: m.chantier_id ? parId.get(m.chantier_id) ?? null : null, message: m }))

  // Une suggestion de fusion (0008) : Claude a trouvé deux chantiers qui sont le même sujet.
  const fusions: ElementAToi[] = messages
    .filter((m) => m.kind === 'fusion' && !m.answered_at && dansProjet(m.projet_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({ type: 'fusion' as const, cle: `f-${m.id}`, projetId: m.projet_id, chantier: m.chantier_id ? parId.get(m.chantier_id) ?? null : null, message: m }))

  const ouverts = chantiers.filter((c) => !c.archived_at && dansProjet(c.projet_id))
  const tri = (a: ChantierE, b: ChantierE) => (RANG_PRIORITE[a.priorite] ?? 1) - (RANG_PRIORITE[b.priorite] ?? 1) || b.updated_at.localeCompare(a.updated_at)
  const dernierBlocage = (id: string) => messages.filter((m) => m.chantier_id === id && m.kind === 'blocage').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  const deType = (type: 'a_verifier' | 'a_cadrer' | 'bloque'): ElementAToi[] => ouverts.filter((c) => c.etat === type).sort(tri)
    .map((c) => ({ type, cle: `${type}-${c.id}`, projetId: c.projet_id, chantier: c, message: type === 'bloque' ? dernierBlocage(c.id) : null }))
  return [...questions, ...fusions, ...deType('a_verifier'), ...deType('a_cadrer'), ...deType('bloque')]
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
    if (presence.code !== 'personne' && presence.code !== 'silencieux') continue
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
  return sansPersonne(chantiers, activites, messages, now, silenceMs, ordreProjets, projetId, taches, (l) => !estEnCoursSansNouvelles(l.c, l.presence))
}

/** Les chantiers « en cours, mais plus de nouvelles », groupés par projet (silencieux d'abord). */
export function enCoursSansNouvelles(
  chantiers: readonly ChantierE[], activites: readonly Activite[], messages: readonly MessageE[],
  now: Date, silenceMs: number, ordreProjets: readonly string[], projetId: string | null = null, taches: readonly Tache[] = [],
): { projetId: string; lignes: LigneALancer[] }[] {
  return sansPersonne(chantiers, activites, messages, now, silenceMs, ordreProjets, projetId, taches, (l) => estEnCoursSansNouvelles(l.c, l.presence))
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
