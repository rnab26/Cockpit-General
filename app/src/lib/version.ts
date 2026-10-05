// « Nouvelle version en ligne » (30 sept. 2026, Raphaël : « comment faire pour
// que les correctifs prennent sans recharger la page ? »). Les DONNÉES
// arrivent en direct (temps réel) ; le CODE de l'app, lui, reste celui du
// chargement tant que la page vit — une appli installée peut rester ouverte
// des jours. Chaque construction grave son numéro (commit) dans l'app ET dans
// `version.json` à côté (vite.config.ts, une seule source) ; l'app relit ce
// fichier et propose de se mettre à jour d'un toucher.
//
// 5 oct. 2026 (chantier c4de4baa) : toute la DÉCISION vit ici, une seule fois
// (bannière, ligne des Réglages, mise à jour automatique), et se teste sans
// navigateur (verifier-version.ts).

/** Relecture pendant que l'app est ouverte ; en plus, à chaque retour sur l'app. */
export const INTERVALLE_VERSION_MS = 5 * 60_000

/** Ce que dit `version.json` (ou l'app elle-même) : le commit, et l'heure de construction si connue. */
export interface InfoVersion { version: string; date: string | null }

/** Lecture tolérante de version.json : null si ce n'est pas une version utilisable. */
export function lireInfoVersion(lue: unknown): InfoVersion | null {
  if (!lue || typeof lue !== 'object') return null
  const o = lue as { version?: unknown; date?: unknown }
  if (typeof o.version !== 'string') return null
  const version = o.version.trim()
  if (!version || version === 'dev') return null
  const date = typeof o.date === 'string' && !Number.isNaN(Date.parse(o.date)) ? o.date : null
  return { version, date }
}

/** Vrai quand le site sert une autre version que celle qui tourne. Jamais en développement ni sur une lecture vide. */
export function nouvelleVersion(courante: string, lue: unknown): boolean {
  if (!courante || courante === 'dev') return false
  const v = lireInfoVersion(lue)
  return v !== null && v.version !== courante
}

// --- Bannière écartée : elle REVIENT ------------------------------------
// Cause du défaut (prouvée, verifier-version.ts) : « Plus tard » mettait un
// drapeau en mémoire que plus rien ne remettait à zéro, et la nouvelle version
// n'étant signalée qu'une fois, la bannière ne revenait jamais avant un
// rechargement. Désormais l'écartement est daté et expire.

export const RAPPELS_MIN = [15, 60, 240] as const
export const RAPPEL_DEFAUT_MIN = 60

export interface ReglagesVersion { rappelMin: number; auto: boolean }
export const REGLAGES_VERSION_DEFAUT: ReglagesVersion = { rappelMin: RAPPEL_DEFAUT_MIN, auto: false }

export function lireReglagesVersion(brut: string | null): ReglagesVersion {
  try {
    const o = brut ? JSON.parse(brut) : null
    const m = o && typeof o === 'object' ? (o as { rappelMin?: unknown; auto?: unknown }) : {}
    return {
      rappelMin: (RAPPELS_MIN as readonly unknown[]).includes(m.rappelMin) ? (m.rappelMin as number) : RAPPEL_DEFAUT_MIN,
      auto: m.auto === true,
    }
  } catch { return REGLAGES_VERSION_DEFAUT }
}

/** La bannière se montre si une nouvelle version existe et qu'elle n'est pas écartée depuis moins du délai de rappel. */
export function banniereVisible(e: { nouvelle: boolean; ecarteA: number | null; maintenant: number; rappelMin: number }): boolean {
  if (!e.nouvelle) return false
  if (e.ecarteA === null) return true
  return e.maintenant - e.ecarteA >= e.rappelMin * 60_000
}

/** Mise à jour automatique : seulement si le réglage est allumé, qu'une version attend et que rien n'est en train d'être écrit. */
export function peutMajAuto(e: { auto: boolean; nouvelle: boolean; brouillon: boolean; enCours: boolean }): boolean {
  return e.auto && e.nouvelle && !e.brouillon && !e.enCours
}

// --- Ligne « Version de l'application » des Réglages --------------------

export type Lecture = 'jamais' | 'en_cours' | 'ok' | 'erreur'

export interface EtatVersion {
  courante: InfoVersion
  lue: InfoVersion | null
  lecture: Lecture
}

export type StatutVersion = 'dev' | 'a_jour' | 'nouvelle' | 'verification' | 'hors_ligne'

/** UN statut, lu par la ligne des Réglages et par la bannière. */
export function statutVersion(e: EtatVersion): StatutVersion {
  if (e.courante.version === 'dev') return 'dev'
  if (e.lecture === 'en_cours') return 'verification'
  if (e.lue && nouvelleVersion(e.courante.version, e.lue)) return 'nouvelle'
  if (e.lecture === 'erreur') return 'hors_ligne'
  return 'a_jour'
}

/** « 05/10 14:32 » (heure locale), ou null si la date manque. */
export function dateCourte(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function courtCommit(v: string): string { return v.slice(0, 7) }

/** La phrase de la ligne des Réglages. */
export function phraseVersion(e: EtatVersion): string {
  const s = statutVersion(e)
  const d = dateCourte(e.courante.date)
  if (s === 'dev') return 'Version de développement : pas de suivi des mises à jour.'
  if (s === 'verification') return 'Vérification en cours…'
  if (s === 'nouvelle') {
    const dn = dateCourte(e.lue!.date)
    return `Nouvelle version disponible (${courtCommit(e.lue!.version)}${dn ? `, du ${dn}` : ''}). Tu utilises la ${courtCommit(e.courante.version)}.`
  }
  const base = `À jour (commit ${courtCommit(e.courante.version)}${d ? `, du ${d}` : ''})`
  return s === 'hors_ligne' ? `${base}. Impossible de vérifier : pas de réseau ?` : `${base}.`
}

/** Le message du toast après « Vérifier maintenant ». */
export function messageVerification(e: EtatVersion): { ok: boolean; texte: string } {
  const s = statutVersion(e)
  if (s === 'hors_ligne') return { ok: false, texte: 'Impossible de vérifier la version : pas de réseau ou site injoignable.' }
  if (s === 'nouvelle') return { ok: true, texte: 'Une nouvelle version est disponible : touche « Mettre à jour ».' }
  if (s === 'dev') return { ok: true, texte: 'Version de développement : rien à comparer.' }
  return { ok: true, texte: 'Tu as déjà la dernière version.' }
}
