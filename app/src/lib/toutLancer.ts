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
