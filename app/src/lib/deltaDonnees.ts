// Lecture INCRÉMENTALE des données de l'écran (chantier 9d83828c, 7 oct. 2026).
//
// Raphaël : « mon cockpit fonctionne mal, tout ce que je clique, c'est lent. » Mesuré (compte admin, vraies
// données) : chaque action (≈ 40 écrans appellent `recharger()`), chaque sondage de 30 s, chaque événement du
// direct relisaient messages + tâches + chantiers en ENTIER (≈ 2,9 Mo décodés, 11 relectures complètes en
// 70 s = 17 Mo, 24 tâches longues du fil principal). Règles de ce fichier, pures (testées sans navigateur,
// `verifier-delta.ts`) :
//  1. un événement du direct s'APPLIQUE (insert/update/delete) au lieu de déclencher une relecture ;
//  2. une rafale d'événements est regroupée (un seul passage d'application, jamais N) ;
//  3. un passage « delta » ne lit que les lignes modifiées depuis la plus récente déjà connue ;
//  4. une relecture COMPLÈTE n'arrive qu'au chargement, au bouton « Actualiser » et toutes les 5 minutes
//     (c'est elle qui attrape ce qu'un delta ne voit pas : une ligne supprimée sans que le direct l'ait dit).

export type TableDonnees = 'sections' | 'chantiers' | 'messages' | 'activite' | 'sessions' | 'taches'
export type LigneId = { id: string }

/** Relecture complète périodique (suppressions non vues). */
export const PLEIN_TOUTES_MS = 5 * 60_000
/** Regroupement des événements du direct : un passage 0,8 s après le dernier événement… */
export const LOT_ATTENTE_MS = 800
/** …et au plus 4 s après le premier d'une rafale (l'écran ne reste jamais figé plus longtemps). */
export const LOT_ATTENTE_MAX_MS = 4000
/** Recouvrement du curseur de delta : une ligne écrite au même instant qu'un passage n'est jamais ratée. */
export const RECOUVREMENT_MS = 2000
/** Tâches : au chargement complet, seulement les vivantes et les récentes (les vieilles ne servent à aucun écran). */
export const TACHES_RECENTES_H = 48

/** Colonnes datées qui disent « cette ligne a bougé » (la plus grande gagne). */
export const CHAMPS_DATES: Record<TableDonnees, string[]> = {
  sections: [],
  chantiers: ['updated_at', 'created_at'],
  messages: ['updated_at', 'created_at'],
  activite: ['updated_at'],
  sessions: ['vu_at'],
  taches: ['vu_at', 'fini_at', 'progres_at'],
}

type Comparateur<T> = (a: T, b: T) => number
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const descSur = (champ: string) => (a: Record<string, unknown>, b: Record<string, unknown>) => str(b[champ]).localeCompare(str(a[champ])) || str(a.id).localeCompare(str(b.id))
/** Ordre d'affichage de chaque table : le même que celui de la lecture complète (`order(...)`). */
export const ORDRES: Record<TableDonnees, Comparateur<never>> = {
  sections: ((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.position ?? 0) - Number(b.position ?? 0) || str(a.nom).localeCompare(str(b.nom))) as Comparateur<never>,
  chantiers: descSur('updated_at') as Comparateur<never>,
  messages: ((a: Record<string, unknown>, b: Record<string, unknown>) => str(a.created_at).localeCompare(str(b.created_at)) || str(a.id).localeCompare(str(b.id))) as Comparateur<never>,
  activite: descSur('updated_at') as Comparateur<never>,
  sessions: descSur('vu_at') as Comparateur<never>,
  taches: descSur('vu_at') as Comparateur<never>,
}

/**
 * Pose / remplace des lignes (par id) dans un tableau déjà trié, et retire des ids.
 * Rend LE MÊME tableau quand rien ne change (aucun rendu pour rien) : une ligne identique à celle déjà là est ignorée.
 */
export function appliquer<T extends LigneId>(base: T[], recues: T[], retirees: Iterable<string>, ordre: Comparateur<T>): T[] {
  const sup = new Set(retirees)
  const index = new Map<string, number>()
  base.forEach((l, i) => index.set(l.id, i))
  let copie: T[] | null = null
  const ecrire = () => (copie ??= base.slice())
  for (const r of recues) {
    if (sup.has(r.id)) continue
    const i = index.get(r.id)
    if (i === undefined) { ecrire().push(r); continue }
    const avant = (copie ?? base)[i]
    // Fusion colonne par colonne : un événement du direct peut omettre une colonne volumineuse inchangée
    // (valeur TOAST) — on garde alors celle qu'on avait, jamais une colonne effacée par erreur.
    const neuve = { ...avant, ...r }
    if (JSON.stringify(avant) !== JSON.stringify(neuve)) ecrire()[i] = neuve
  }
  if (sup.size) {
    const cible = (copie ?? base)
    if (cible.some((l) => sup.has(l.id))) copie = cible.filter((l) => !sup.has(l.id))
  }
  if (!copie) return base
  return copie.sort(ordre)
}

/** Curseur de delta d'une table : la plus récente de ses dates connues, moins le recouvrement ; null = tout lire. */
export function curseurDelta(table: TableDonnees, lignes: Record<string, unknown>[]): string | null {
  const champs = CHAMPS_DATES[table]
  if (!champs.length || !lignes.length) return null
  let max = 0
  for (const l of lignes) for (const c of champs) { const t = Date.parse(str(l[c])); if (t > max) max = t }
  return max ? new Date(max - RECOUVREMENT_MS).toISOString() : null
}

/** Filtre PostgREST `or(...)` d'un passage delta : toute colonne datée de la table plus récente que le curseur. */
export function filtreDelta(table: TableDonnees, curseur: string): string {
  return CHAMPS_DATES[table].map((c) => `${c}.gt.${curseur}`).join(',')
}

/** Un passage complet est-il dû ? (jamais lu, ou le dernier complet date de plus de PLEIN_TOUTES_MS) */
export function pleinDu(dernierPleinMs: number | null, maintenantMs: number): boolean {
  return dernierPleinMs === null || maintenantMs - dernierPleinMs >= PLEIN_TOUTES_MS
}

// --- événements du direct ---------------------------------------------------------------------------------

export interface EvenementDirect {
  eventType?: string
  new?: Record<string, unknown> | null
  old?: Record<string, unknown> | null
}
export interface LotTable {
  /** Dernière version de chaque ligne écrite pendant la rafale. */
  lignes: Map<string, Record<string, unknown>>
  suppressions: Set<string>
  /** Un événement sans ligne exploitable : on ne devine pas, on relit (delta) cette table. */
  arelire: boolean
}
export type Lot = Partial<Record<TableDonnees, LotTable>>

/** Réduit un événement du direct à une écriture de ligne, une suppression, ou « à relire ». */
export function lireEvenement(e: EvenementDirect): { type: 'ecrire'; ligne: Record<string, unknown> & { id: string } } | { type: 'supprimer'; id: string } | { type: 'relire' } {
  const t = e.eventType
  if (t === 'DELETE') {
    const id = e.old?.id
    return typeof id === 'string' ? { type: 'supprimer', id } : { type: 'relire' }
  }
  if ((t === 'INSERT' || t === 'UPDATE') && e.new && typeof e.new.id === 'string') return { type: 'ecrire', ligne: e.new as Record<string, unknown> & { id: string } }
  return { type: 'relire' }
}

export interface Horloge {
  setTimeout: (f: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
  now: () => number
}
const HORLOGE_REELLE: Horloge = { setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (h) => window.clearTimeout(h as number), now: () => Date.now() }

/**
 * Regroupe les événements du direct : `vider(lot)` est appelé UNE fois par rafale (LOT_ATTENTE_MS après le
 * dernier événement, ou LOT_ATTENTE_MAX_MS après le premier). Un insert suivi d'un delete s'annule ; une même
 * ligne écrite dix fois ne compte qu'une fois (la dernière version).
 */
export class LotEvenements {
  private lot: Lot = {}
  private minuterie: unknown = null
  private premier = 0
  /** Nombre de fois où `vider` a été appelé (les tests le comptent). */
  passages = 0
  private vider: (lot: Lot) => void
  private attente: number
  private attenteMax: number
  private h: Horloge
  constructor(vider: (lot: Lot) => void, attente = LOT_ATTENTE_MS, attenteMax = LOT_ATTENTE_MAX_MS, h: Horloge = HORLOGE_REELLE) {
    this.vider = vider; this.attente = attente; this.attenteMax = attenteMax; this.h = h
  }

  ajouter(table: TableDonnees, e: EvenementDirect): void {
    const t = (this.lot[table] ??= { lignes: new Map(), suppressions: new Set(), arelire: false })
    const l = lireEvenement(e)
    if (l.type === 'ecrire') { t.suppressions.delete(l.ligne.id); t.lignes.set(l.ligne.id, l.ligne) }
    else if (l.type === 'supprimer') { t.lignes.delete(l.id); t.suppressions.add(l.id) }
    else t.arelire = true
    const maintenant = this.h.now()
    if (!this.premier) this.premier = maintenant
    if (this.minuterie !== null) this.h.clearTimeout(this.minuterie)
    const reste = Math.max(0, this.premier + this.attenteMax - maintenant)
    this.minuterie = this.h.setTimeout(() => this.vidange(), Math.min(this.attente, reste))
  }

  /** Vide tout de suite (retour sur l'appli, fermeture). */
  vidange(): void {
    if (this.minuterie !== null) this.h.clearTimeout(this.minuterie)
    this.minuterie = null
    this.premier = 0
    const lot = this.lot
    this.lot = {}
    if (!Object.keys(lot).length) return
    this.passages++
    this.vider(lot)
  }

  annuler(): void {
    if (this.minuterie !== null) this.h.clearTimeout(this.minuterie)
    this.minuterie = null; this.premier = 0; this.lot = {}
  }
}
