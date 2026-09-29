// « Qui travaille » : les SESSIONS Claude Code et leurs TÂCHES en arrière-plan
// (agents, commandes), migration 0008, suivies par les hooks de Claude Code.
//
// Raphaël, 29 sept. 2026 : « s'il y a des agents qui bossent, il faut que je
// voie combien, sur quel projet, ce qu'ils font ; la notion d'agent et la
// notion de session, c'est pas pareil, il faut que ce soit clair » — et sa
// capture du panneau « Tâches en arrière-plan » : « typiquement ce que j'ai
// envie de voir, mais simplifié, avec le motif clair […] leur progression,
// combien de temps avant la fin ».
//
// Deux règles qui ne se discutent pas :
//  - une barre ne s'affiche QUE si l'agent a lui-même signalé son avancement
//    (progres_at) ; sinon « avancement non signalé », jamais un chiffre inventé ;
//  - une session est « active » sur une preuve (dernier signe récent, tour en
//    cours, ou tâche en cours vue récemment), jamais sur la seule absence de fin.
//
// La présence d'un chantier (presence.ts) ne change pas : un agent vivant lié à
// un chantier s'y ajoute ICI, par `presenceAvecAgent`, pour ne pas toucher la
// copie de presence.ts que porte le module embarqué.
// Pur, vérifié par scripts/verifier-sessions.ts.
import type { Activite, Chantier, SessionClaude, Tache } from './types.ts'
import { preuveDeVie, type Presence } from './presence.ts'
import { dateRelative, etaLisible } from './dates.ts'

/** Un tour de réponse sans nouvelle depuis plus longtemps que ça n'est plus « en train de répondre ». */
export const TOUR_MAX_MS = 30 * 60_000
/** Une tâche en cours vue depuis moins que ça garde sa session active. */
export const TACHE_VIVANTE_MS = 2 * 3600_000
/** Une tâche finie reste visible (repliée) ce temps-là, puis disparaît. */
export const FINI_RECENT_MS = 10 * 60_000

const t = (iso: string | null | undefined) => { const x = iso ? Date.parse(iso) : NaN; return Number.isNaN(x) ? null : x }
const depuis = (iso: string | null | undefined, now: Date) => { const x = t(iso); return x === null ? Infinity : now.getTime() - x }

export function tacheEnCoursVivante(tc: Pick<Tache, 'statut' | 'vu_at'>, now: Date): boolean {
  return tc.statut === 'en_cours' && depuis(tc.vu_at, now) < TACHE_VIVANTE_MS
}

/** Une session arrêtée sur une limite reste affichée (en pause) ce temps-là : une limite d'usage se lève en quelques heures. */
export const PAUSE_VISIBLE_MS = 6 * 3600_000

const RAISONS_PAUSE: Record<string, string> = {
  rate_limit: 'limite d’usage atteinte (reprend toute seule quand la limite se lève)',
  overloaded: 'serveurs de Claude surchargés (reprend tout seul)',
  billing_error: 'problème de facturation du compte Claude',
  authentication_failed: 'connexion au compte Claude perdue',
  server_error: 'erreur des serveurs de Claude',
  invalid_request: 'requête refusée par Claude',
  max_output_tokens: 'réponse trop longue, coupée',
  unknown: 'arrêt inattendu',
}
/** « En pause — limite d'usage atteinte (…) », en français, jamais le code brut seul. */
export function libellePause(raison: string): string {
  return `En pause — ${RAISONS_PAUSE[raison] ?? `arrêt (${raison})`}`
}

/** En pause sur une limite, depuis moins de 6 h (0010). */
export function sessionEnPause(s: Pick<SessionClaude, 'pause_raison' | 'pause_at' | 'fin_at'>, now: Date): boolean {
  return !s.fin_at && !!s.pause_raison && depuis(s.pause_at, now) < PAUSE_VISIBLE_MS
}

/** Une session est active : pas finie, ET (en pause récente, OU répond depuis peu, OU signe récent, OU une tâche en cours vue < 2 h). */
export function sessionActive(s: SessionClaude, taches: readonly Tache[], now: Date, silenceMs: number): boolean {
  if (s.fin_at) return false
  if (sessionEnPause(s, now)) return true
  const vu = depuis(s.vu_at, now)
  if (s.tour_en_cours && vu < TOUR_MAX_MS) return true
  if (vu < silenceMs) return true
  return taches.some((x) => x.session_id === s.id && tacheEnCoursVivante(x, now))
}

/** Le temps restant d'une tâche, recalculé depuis son dernier signalement ; null si inconnu ou dépassé. */
export function resteTache(tc: Pick<Tache, 'eta_secondes' | 'progres_at'>, now: Date): number | null {
  if (tc.eta_secondes == null || tc.eta_secondes <= 0) return null
  const p = t(tc.progres_at)
  if (p === null) return null
  const reste = tc.eta_secondes - (now.getTime() - p) / 1000
  return reste > 0 ? Math.round(reste) : null
}

export interface VueTache {
  tache: Tache
  /** « Agent : … » / « Commande : … » */
  libelle: string
  /** Depuis combien de temps elle tourne (« 12 min »). */
  duree: string
  /** L'agent a-t-il signalé son avancement ? Sans ça : pas de barre. */
  signale: boolean
  pourcentage: number | null
  reste: string | null
  chantier: Chantier | null
}

export function libelleTache(tc: Pick<Tache, 'type' | 'description' | 'sorte' | 'tache_id'>): string {
  const quoi = tc.description?.trim() || tc.sorte?.trim() || tc.tache_id.replace(/^prov:/, '')
  if (tc.type === 'agent') return `Agent : ${quoi}`
  if (tc.type === 'commande') return `Commande : ${quoi}`
  return `Tâche : ${quoi}`
}

/** « 45 s », « 12 min », « 1 h 05 » : depuis quand une tâche tourne. */
export function dureeLisible(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

export function vueTache(tc: Tache, chantiers: readonly Chantier[], now: Date): VueTache {
  const signale = !!tc.progres_at
  const r = signale ? resteTache(tc, now) : null
  return {
    tache: tc, libelle: libelleTache(tc), duree: dureeLisible(depuis(tc.demarre_at, now)), signale,
    pourcentage: signale ? tc.pourcentage : null, reste: r === null ? null : etaLisible(r),
    chantier: tc.chantier_id ? chantiers.find((c) => c.id === tc.chantier_id) ?? null : null,
  }
}

export interface VueSession {
  session: SessionClaude
  /** « Session <sujet ou branche> » */
  titre: string
  repond: boolean
  /** « répond en ce moment » / « attend ton prochain message » / « En pause — … » */
  etat: string
  /** Arrêtée sur une limite : le libellé de la pause (rien ne s'anime), et le détail donné par Claude Code. */
  pause: string | null
  pauseDetail: string | null
  dernierSigne: string
  taches: VueTache[]
  /** Finies depuis moins de 10 min (affichées repliées). */
  finies: { tache: Tache; libelle: string; quand: string }[]
  /** Les barres de chantier (progression.sh) de cette session, rattachées par la branche. */
  activites: Activite[]
}

/** Une session lancée par le mode autonome (elles commencent toutes par la même consigne). */
export function estSessionAutonome(s: Pick<SessionClaude, 'sujet'>): boolean {
  return /^\s*Tu es la SESSION AUTONOME/i.test(s.sujet ?? '')
}

/**
 * Le nom COURT d'une session, pour une sous-ligne (« Claude (session autonome) ») :
 * « autonome », sinon le début de son premier message, sinon sa branche sans
 * « claude/ », sinon « sans nom (abcd1234) ».
 */
export function nomSession(s: Pick<SessionClaude, 'sujet' | 'branche' | 'id'>): string {
  if (estSessionAutonome(s)) return 'autonome'
  const sujet = s.sujet?.replace(/\s+/g, ' ').trim()
  if (sujet) return sujet.length > 32 ? `${sujet.slice(0, 31).trimEnd()}…` : sujet
  const b = s.branche?.trim().replace(/^claude\//, '').replace(/-[a-z0-9]{6}$/, '')
  return b || `sans nom (${s.id.replace(/^[^a-z0-9]+/i, '').slice(0, 8)})`
}

/** « Session <son premier message> », sinon sa branche, sinon « sans nom (abcd1234) » — jamais un id nu. */
export function titreSession(s: Pick<SessionClaude, 'sujet' | 'branche' | 'id'>): string {
  // Les sessions lancées par le mode autonome commencent toutes par la même consigne : on les nomme.
  if (estSessionAutonome(s)) return `Session autonome${s.branche ? ` (${s.branche})` : ''}`
  return `Session ${s.sujet?.trim() || s.branche?.trim() || `sans nom (${s.id.replace(/^[^a-z0-9]+/i, '').slice(0, 8)})`}`
}

export interface QuiTravaille {
  projetId: string
  sessions: VueSession[]
  /** Des barres vivantes (progression.sh) qu'aucune session suivie ne porte. */
  activitesSeules: Activite[]
}

/** `sessions` = celles qui travaillent (hors pause) ; `enPause` à part : une session en pause ne travaille pas. */
export interface Resume { sessions: number; agents: number; commandes: number; autres: number; enPause: number; texte: string }

const pl = (n: number, un: string, plus = `${un}s`) => `${n} ${n > 1 ? plus : un}`

export function resumeTravail(groupes: readonly QuiTravaille[]): Resume {
  let sessions = 0, agents = 0, commandes = 0, autres = 0, enPause = 0
  for (const g of groupes) {
    sessions += g.sessions.filter((s) => !s.pause).length + new Set(g.activitesSeules.map((a) => a.session)).size
    enPause += g.sessions.filter((s) => s.pause).length
    for (const s of g.sessions) for (const v of s.pause ? [] : s.taches) {
      if (v.tache.type === 'agent') agents++; else if (v.tache.type === 'commande') commandes++; else autres++
    }
  }
  const morceaux = [pl(sessions, 'session')]
  if (agents) morceaux.push(pl(agents, 'agent'))
  if (commandes) morceaux.push(pl(commandes, 'commande'))
  if (autres) morceaux.push(pl(autres, 'tâche'))
  const texte = `${morceaux.join(' · ')} en cours${enPause ? ` · ${enPause} en pause` : ''}`
  return { sessions, agents, commandes, autres, enPause, texte }
}

/**
 * Qui travaille, groupé par projet (dans l'ordre `ordreProjets`) : les sessions
 * actives avec leurs tâches en cours, leurs tâches finies récemment, et les
 * barres de chantier vivantes, rattachées à leur session par la branche.
 */
export function quiTravaille(
  sessions: readonly SessionClaude[], taches: readonly Tache[], activites: readonly Activite[], chantiers: readonly Chantier[],
  now: Date, silenceMs: number, ordreProjets: readonly string[], projetId: string | null = null,
): QuiTravaille[] {
  const actives = sessions
    .filter((s) => (!projetId || s.projet_id === projetId) && sessionActive(s, taches, now, silenceMs))
    .sort((a, b) => Number(b.tour_en_cours) - Number(a.tour_en_cours) || b.vu_at.localeCompare(a.vu_at))
  // Une barre vivante par session de progression.sh (la plus récente).
  const barres = new Map<string, Activite>()
  for (const a of activites) {
    if (projetId && a.projet_id !== projetId) continue
    if (!preuveDeVie(a, now, silenceMs)) continue
    const d = barres.get(`${a.projet_id}|${a.session}`)
    if (!d || a.updated_at > d.updated_at) barres.set(`${a.projet_id}|${a.session}`, a)
  }
  const rattachees = new Set<string>()
  const groupes = new Map<string, QuiTravaille>()
  const groupe = (pid: string) => { let g = groupes.get(pid); if (!g) { g = { projetId: pid, sessions: [], activitesSeules: [] }; groupes.set(pid, g) } return g }

  for (const s of actives) {
    const siennes = taches.filter((x) => x.session_id === s.id)
    const enCours = siennes.filter((x) => tacheEnCoursVivante(x, now))
      .sort((a, b) => Number(!!b.progres_at) - Number(!!a.progres_at) || a.demarre_at.localeCompare(b.demarre_at))
    const finies = siennes.filter((x) => x.statut !== 'en_cours' && depuis(x.fini_at, now) < FINI_RECENT_MS)
      .sort((a, b) => (b.fini_at ?? '').localeCompare(a.fini_at ?? ''))
    const acts: Activite[] = []
    if (s.branche) for (const [k, a] of barres) if (a.projet_id === s.projet_id && a.session === s.branche) { acts.push(a); rattachees.add(k) }
    const pause = sessionEnPause(s, now) ? libellePause(s.pause_raison!) : null
    const repond = !pause && s.tour_en_cours && depuis(s.vu_at, now) < TOUR_MAX_MS
    groupe(s.projet_id).sessions.push({
      session: s,
      titre: titreSession(s),
      repond,
      etat: pause ?? (repond ? 'répond en ce moment' : 'attend ton prochain message'),
      pause, pauseDetail: pause ? (s.pause_detail?.trim() || null) : null,
      dernierSigne: dateRelative(s.vu_at, now) || 'à l’instant',
      taches: enCours.map((x) => vueTache(x, chantiers, now)),
      finies: finies.map((x) => ({ tache: x, libelle: libelleTache(x), quand: dateRelative(x.fini_at, now) || 'à l’instant' })),
      activites: acts,
    })
  }
  for (const [k, a] of barres) if (!rattachees.has(k)) groupe(a.projet_id).activitesSeules.push(a)
  for (const g of groupes.values()) g.activitesSeules.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const rang = (id: string) => { const i = ordreProjets.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
  return [...groupes.values()].sort((a, b) => rang(a.projetId) - rang(b.projetId))
}

/** L'agent vivant d'un chantier : en cours, lié au chantier, et qui a signalé son avancement depuis moins que le délai de silence. */
export function agentVivantDuChantier(taches: readonly Tache[], chantierId: string, now: Date, silenceMs: number): Tache | null {
  return taches
    .filter((x) => x.chantier_id === chantierId && x.statut === 'en_cours' && x.type === 'agent' && depuis(x.progres_at, now) < silenceMs)
    .sort((a, b) => (b.progres_at ?? '').localeCompare(a.progres_at ?? ''))[0] ?? null
}

/**
 * La présence d'un chantier, complétée par ses agents : un agent vivant compte
 * comme preuve de vie (« 🟢 Un agent y travaille »), avec la même priorité que
 * dans presence.ts — il ne remplace que « Personne dessus » et « Pris, mais
 * silencieux ». Ce qui t'attend (question, à vérifier…) passe toujours avant.
 */
export function presenceAvecAgent(p: Presence, agent: Tache | null, now: Date): Presence {
  if (!agent || (p.code !== 'personne' && p.code !== 'silencieux')) return p
  const quoi = agent.description?.trim() || agent.sorte || 'agent'
  const quand = dateRelative(agent.progres_at, now) || 'à l’instant'
  return {
    code: 'travaille', libelle: 'Un agent y travaille', teinte: 'ok',
    detail: `${quoi}${agent.etape ? ` · ${agent.etape}` : ''} · ${quand}`,
    barreVive: agent.pourcentage != null, aRelancer: false, tonAction: null,
  }
}

/** Une tâche d'agent vue comme une « activité », pour la dessiner avec la même barre (temps restant recalculé). */
export function activiteDeTache(tc: Tache, now: Date): Activite {
  return {
    id: tc.id, projet_id: tc.projet_id, chantier_id: tc.chantier_id, session: tc.description ?? tc.tache_id,
    etape: tc.etape ?? '', pourcentage: tc.pourcentage ?? 0, eta_secondes: resteTache(tc, now), statut: 'en_cours',
    detail: null, demarre_at: tc.demarre_at, updated_at: tc.progres_at ?? tc.vu_at,
  }
}
