// « Tout lancer » (16 oct. 2026, chantier 876e2e4b). Raphaël : « Je ne veux pas de superflu à l'écran. Je ne veux pas avoir à
// cliquer sur des boutons de renfort. En un seul bouton, lancer tous les chantiers […] j'appuie une fois, ça lance tous les
// chantiers, ils se traitent, ça ne s'arrête pas en plein milieu. Faire simple. »
// AUCUNE règle nouvelle : la file, les places et les refus viennent de la base (etat_renforts, demander_renforts) et de
// lib/renforts.ts (boutonRenforts, messageDemande, renfortsEnRoute). Ce module décide seulement ce que dit l'UNIQUE bouton et sa
// UNIQUE ligne d'état, pour un projet ou pour tous. Pur, vérifié par scripts/verifier-tout-lancer.ts.
import { boutonRenforts, messageDemande, renfortsEnRoute, type EtatRenforts, type ResultatDemande } from './renforts.ts'

export interface EntreeLancer {
  slug: string
  nom: string
  enPause: boolean
  /** null = pas encore lu (ou illisible : voir `erreur`). */
  etat: EtatRenforts | null
  erreur: string | null
  /** 0102 : sessions vivantes et messages qui attendent (null = pas encore lu ou illisible : le voyant dit « état inconnu »). */
  sessions?: EtatSessions | null
}

/** Ce que rend `etat_sessions` (0102). « Vivante » = la règle de la base (delai_signe), jamais recalculée ici. */
export interface EtatSessions {
  projet: string
  en_pause: boolean
  vivantes: number
  chef: boolean
  /** Messages de Raphaël qui attendent une réponse + réponses sans suite. */
  messages: number
  /** La routine de réveil est configurée (sinon : ouvrir Claude Code à la main). */
  reveil_possible: boolean
  reveil_at: string | null
  reveil_ecart_min: number
}

export interface DecisionLancer {
  /** Les projets qu'un clic va lancer (vide = bouton désactivé). */
  aLancer: string[]
  actif: boolean
  /** Lecture en cours (aucun état connu encore). */
  chargement: boolean
  /** Impossible de lire l'état : l'écran propose « Réessayer ». */
  enErreur: boolean
  /** UNE ligne d'état, en mots simples. */
  ligne: string
  /** Pourquoi le bouton est désactivé (null s'il est actif). */
  raison: string | null
  nChantiers: number
}

const pl = (n: number, un: string, plus: string) => `${n} ${n > 1 ? plus : un}`
const attendent = (n: number) => `${pl(n, 'chantier attend', 'chantiers attendent')}`

/** Ce que dit le bouton et sa ligne d'état. `entrees` = les projets actifs concernés (un seul dans la vue d'un projet). */
export function decisionToutLancer(entrees: EntreeLancer[]): DecisionLancer {
  const vide = { aLancer: [] as string[], actif: false, chargement: false, enErreur: false, nChantiers: 0 }
  if (!entrees.length) return { ...vide, ligne: 'Aucun projet actif.', raison: 'Aucun projet actif.' }
  const travaillables = entrees.filter((e) => !e.enPause)
  if (!travaillables.length) {
    const ligne = entrees.length === 1 ? `${entrees[0].nom} est en pause : rien ne démarre.` : 'Tous les projets sont en pause : rien ne démarre.'
    return { ...vide, ligne, raison: `En pause. Rallume ${entrees.length === 1 ? 'le projet' : 'un projet'} dans Réglages du projet.` }
  }
  const lus = travaillables.filter((e) => e.etat)
  const illisibles = travaillables.filter((e) => !e.etat && e.erreur)
  if (!lus.length) {
    if (illisibles.length) {
      const ligne = `Impossible de lire l’état : ${illisibles[0].erreur}`
      return { ...vide, enErreur: true, ligne, raison: 'État illisible : touche « Réessayer ».' }
    }
    return { ...vide, chargement: true, ligne: 'Lecture en cours…', raison: 'Lecture en cours…' }
  }
  const nChantiers = lus.reduce((n, e) => n + e.etat!.attente.reduce((s, a) => s + a.n, 0), 0)
  const enRoute = lus.reduce((n, e) => n + renfortsEnRoute(e.etat!).length, 0)
  const aLancer = lus.filter((e) => boutonRenforts(e.etat!).actif).map((e) => e.slug)
  const projetsQuiAttendent = lus.filter((e) => e.etat!.attente.length).length
  const suffixe = illisibles.length ? ` (${pl(illisibles.length, 'projet illisible', 'projets illisibles')})` : ''
  if (aLancer.length) {
    const ou = projetsQuiAttendent > 1 ? ` dans ${projetsQuiAttendent} projets` : ''
    return { aLancer, actif: true, chargement: false, enErreur: false, nChantiers, ligne: `${attendent(nChantiers)}${ou}${suffixe}`, raison: null }
  }
  if (nChantiers) {
    const eteint = lus.some((e) => e.etat!.attente.length && e.etat!.sessions_max === 0)
    const raison = eteint
      ? 'Les renforts sont éteints pour ce projet : règle-les dans Réglages du projet › Renforts (détails).'
      : 'Déjà demandés : le reste part tout seul dès qu’une place se libère.'
    return { ...vide, nChantiers, ligne: `${attendent(nChantiers)} · ${eteint ? 'renforts éteints' : 'déjà demandés'}${suffixe}`, raison }
  }
  return { ...vide, ligne: `${enRoute ? `Rien n’attend : ${pl(enRoute, 'renfort', 'renforts')} en route` : 'Rien n’attend'}${suffixe}`, raison: enRoute ? 'Rien n’attend : tout est déjà confié.' : 'Rien n’attend : rien à lancer.' }
}

export interface ResultatLancer { nom: string; resultat: ResultatDemande | null; erreur: string | null; sansChef: boolean }

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * Ce qu'on dit APRÈS le clic : « Lancé à 11:12, ça avance » ou pourquoi rien (erreur visible, « Réessayer »).
 * `reessayer` = une vraie erreur technique (pas un simple « rien n'attend »).
 */
export function messageApresLancer(rs: ResultatLancer[], now: Date): { ok: boolean; texte: string; reessayer: boolean } {
  const pannes = rs.filter((r) => r.erreur)
  const lances = rs.filter((r) => r.resultat && r.resultat.demandes.length)
  const plusRien = rs.filter((r) => r.resultat && !r.resultat.demandes.length)
  if (pannes.length) {
    const quoi = pannes.map((r) => `${rs.length > 1 ? `${r.nom} : ` : ''}${r.erreur}`).join(' · ')
    const fait = lances.length ? ` (${pl(lances.length, 'projet lancé', 'projets lancés')} quand même)` : ''
    return { ok: false, reessayer: true, texte: `Pas lancé : ${quoi}${fait}` }
  }
  if (!lances.length) {
    const m = plusRien.length ? messageDemande(plusRien[0].resultat!) : { texte: 'Rien à lancer.' }
    return { ok: false, reessayer: false, texte: m.texte }
  }
  const n = lances.reduce((s, r) => s + r.resultat!.demandes.reduce((t, d) => t + d.chantiers, 0), 0)
  const sans = lances.filter((r) => r.sansChef).map((r) => r.nom)
  const aide = sans.length ? ` Aucune session n’est ouverte pour ${sans.join(', ')} : ouvre Claude Code sur ${sans.length > 1 ? 'ces projets' : 'ce projet'} pour que ça démarre.` : ''
  return { ok: true, reessayer: false, texte: `Demandé à ${hhmm(now)} : ${pl(n, 'chantier', 'chantiers')}. Ils passent dans « ça avance » dès qu’une session les prend.${aide}` }
}

// ---- Voyant des sessions et « Activer une session » (19 oct. 2026, chantier cb3d17df, migration 0102) ----
// Raphaël : « Un voyant pour voir s'il y a des sessions actives directement. S'il n'y a pas de session active, appuyer pour activer
// une session. […] Même sans chantier à lancer, si j'ai répondu et que j'attends des réponses, un interrupteur. » AUCUNE règle
// nouvelle : « vivante » vient de la base (etat_sessions, delai_signe), le réveil de activer_session (reveiller_chef).

export type EtatVoyant = 'vivante' | 'aucune' | 'pause' | 'inconnu'

/** Phrase quand le réveil automatique n'est pas réglé : pas de bouton (il ne ferait rien), on dit quoi faire. */
export const SANS_REVEIL = 'Réveil automatique non réglé : ouvre Claude Code sur ce projet.'

export interface Voyant {
  slug: string
  nom: string
  etat: EtatVoyant
  /** Mots simples : « session ouverte », « aucune session », « en pause »… */
  texte: string
  /** Ce qui attend, en une phrase (« 2 chantiers · 1 message ») ; vide si rien. */
  attend: string
  nChantiers: number
  nMessages: number
  /** Renforts demandés qui attendent qu'une session les prenne. */
  nDemandes: number
  /** Le bouton « Activer une session » est proposé. */
  peutActiver: boolean
  /** Un réveil est déjà parti il y a peu : on le dit, pas de bouton (jamais de doublon). */
  dejaDemande: boolean
  /** Pourquoi pas de bouton, quand une session manque (null sinon). */
  raison: string | null
}

const minutesDepuis = (iso: string | null | undefined, now: Date): number | null => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / 60_000))
}

/** « il y a 3 min » / « à l’instant ». */
export const ilYA = (min: number): string => (min < 1 ? 'à l’instant' : `il y a ${min} min`)

export function voyantDe(e: EntreeLancer, now: Date): Voyant {
  const nChantiers = e.etat ? e.etat.attente.reduce((s, a) => s + a.n, 0) : 0
  const nMessages = e.sessions?.messages ?? 0
  // Un renfort DEMANDÉ attend lui aussi une session (« Tout lancer » vient de le poser) : sans ça le voyant dirait « rien n'attend ».
  const nDemandes = e.etat ? e.etat.renforts.filter((r) => r.statut === 'demande' && r.vivant).length : 0
  const attend = [nChantiers ? pl(nChantiers, 'chantier', 'chantiers') : '', nMessages ? pl(nMessages, 'message', 'messages') : '',
    nDemandes ? pl(nDemandes, 'renfort demandé', 'renforts demandés') : ''].filter(Boolean).join(' · ')
  const base = { slug: e.slug, nom: e.nom, attend, nChantiers, nMessages, nDemandes, peutActiver: false, dejaDemande: false, raison: null as string | null }
  if (e.enPause || e.sessions?.en_pause) return { ...base, etat: 'pause', texte: 'en pause', raison: 'En pause : rien ne démarre.' }
  const s = e.sessions
  if (!s) return { ...base, etat: 'inconnu', texte: e.erreur ? 'état illisible' : 'lecture en cours…', raison: e.erreur }
  if (s.vivantes > 0 || s.chef) return { ...base, etat: 'vivante', texte: s.vivantes > 1 ? `${s.vivantes} sessions ouvertes` : 'session ouverte' }
  const min = minutesDepuis(s.reveil_at, now)
  const dejaDemande = min !== null && min < s.reveil_ecart_min
  if (!attend) return { ...base, etat: 'aucune', texte: 'aucune session', raison: 'Rien n’attend : pas besoin de session.' }
  if (!s.reveil_possible) return { ...base, etat: 'aucune', texte: 'aucune session', raison: SANS_REVEIL }
  if (dejaDemande) return { ...base, etat: 'aucune', texte: 'aucune session', dejaDemande: true, raison: `Session demandée ${ilYA(min!)} : elle arrive.` }
  return { ...base, etat: 'aucune', texte: 'aucune session', peutActiver: true }
}

export const voyantsDe = (entrees: EntreeLancer[], now: Date): Voyant[] => entrees.map((e) => voyantDe(e, now))

/**
 * « Tout lancer » active lui-même une session pour chaque projet lancé qui n'en a aucune. On ne filtre PAS sur « déjà demandé »
 * ni sur « rien n'attend » : la demande de renforts vient de poser du travail, et la base ne tire jamais deux fois (activer_session).
 */
export const aActiverAvecLancer = (aLancer: string[], voyants: Voyant[]): string[] =>
  aLancer.filter((slug) => { const v = voyants.find((x) => x.slug === slug); return !!v && v.etat === 'aucune' && v.raison !== SANS_REVEIL })

export interface ResultatActivation { nom: string; resultat: string | null; reveil_at?: string | null; erreur: string | null }

/** Phrase après « Activer une session » (un ou plusieurs projets) : réussi, déjà fait, ou échec visible. `reessayer` = vraie panne. */
export function messageApresActivation(rs: ResultatActivation[], now: Date): { ok: boolean; texte: string; reessayer: boolean } {
  const nom = (r: ResultatActivation) => (rs.length > 1 ? `${r.nom} : ` : '')
  const maj = (t: string) => (rs.length > 1 ? t : t.charAt(0).toUpperCase() + t.slice(1))
  const dits = (r: ResultatActivation): { ok: boolean; texte: string } => {
    if (r.erreur) return { ok: false, texte: `${nom(r)}${r.erreur}` }
    switch (r.resultat) {
      case 'envoye': return { ok: true, texte: `${nom(r)}session demandée à ${hhmm(now)} : elle s’ouvre dans une ou deux minutes.` }
      case 'deja_demande': { const m = minutesDepuis(r.reveil_at, now); return { ok: true, texte: `${nom(r)}session déjà demandée${m === null ? '' : ` ${ilYA(m)}`} : elle arrive.` } }
      case 'session_vivante': return { ok: true, texte: `${nom(r)}une session est déjà ouverte.` }
      case 'projet_en_pause': return { ok: false, texte: `${nom(r)}projet en pause : rallume-le dans Réglages du projet.` }
      case 'pas_configure': return { ok: false, texte: `${nom(r)}le réveil automatique n’est pas réglé : ouvre Claude Code sur ce projet.` }
      case 'aucune_chef': return { ok: false, texte: `${nom(r)}aucun réveil automatique actif : ouvre Claude Code sur ce projet.` }
      default: return { ok: false, texte: `${nom(r)}réponse inattendue (${r.resultat ?? 'vide'}).` }
    }
  }
  const lignes = rs.map(dits)
  const ok = lignes.every((l) => l.ok)
  return { ok, reessayer: rs.some((r) => r.erreur), texte: ok ? lignes.map((l) => maj(l.texte)).join(' · ') : 'Pas activée : ' + lignes.map((l) => l.texte).join(' · ') }
}
