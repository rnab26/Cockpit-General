// « Pris, mais silencieux » : qui le tient, depuis quand, ce qui se passe, et
// LE geste à faire — ou « rien, ça se relance seul à HH:MM ».
//
// Raphaël (30 sept. 2026, chantier fb19d6a8) : « je n'arrive pas à comprendre
// ce qui se passe réellement […] relancer encore alors que c'est déjà
// relancé ? Attente pour rien. » Une seule règle, pure, lue par l'écran et le
// test. La base (0036) reprend un chantier réservé mais abandonné : plus aucun
// signe de vie depuis DELAI_ABANDON_MIN, la passe de la chef le reprend seule.
import type { Activite, Chantier } from './types.ts'
import { heureLisible, dateRelative } from './dates.ts'
import { nomQui } from './enAttente.ts'

/**
 * Délai « sans signe de vie » PAR DÉFAUT (min) : au-delà, un chantier réservé est « abandonné » et la chef le
 * reprend. La vraie valeur est réglable par projet (`projets.delai_sans_signe_min`, 1 à 120, 0046) et lue par
 * UNE règle en base (`delai_signe`) ; l'écran la reçoit en `abandonMin`. Ce défaut n'est que le repli quand la
 * ligne du projet ne la porte pas ; `verifier-base` le compare au défaut de la colonne.
 */
export const DELAI_ABANDON_MIN = 60
/** Mêmes bornes que `regler_sans_signe` (0046). */
export const DELAI_ABANDON_MIN_BORNES = { min: 1, max: 120 } as const

/** Message d'erreur du réglage du délai, ou null s'il est valable (même règle que la base). */
export function erreurDelaiSansSigne(min: number): string | null {
  if (!Number.isInteger(min) || min < DELAI_ABANDON_MIN_BORNES.min || min > DELAI_ABANDON_MIN_BORNES.max) {
    return `Délai sans signe de vie : de ${DELAI_ABANDON_MIN_BORNES.min} à ${DELAI_ABANDON_MIN_BORNES.max} minutes.`
  }
  return null
}

export type GesteSilence = 'rien' | 'attendre' | 'relancer'

export interface SituationSilence {
  /** Qui le tient (nom court de la session, ou « une session »). */
  qui: string
  /** Dernier signe de vie : « il y a 40 min », ou « aucun signe depuis la réservation ». */
  depuis: string
  /** Ce qui se passe réellement, une phrase. */
  ceQuiSePasse: string
  /** Le geste : rien (déjà pris en charge), attendre (pas encore abandonné), relancer (rien ne le fera). */
  geste: GesteSilence
  /** La phrase du geste, en une ligne. */
  consigne: string
  /** Heure de la reprise automatique, si connue. */
  repriseA: string | null
}

type C = Pick<Chantier, 'pris_par' | 'pris_jusqu_a'> & { updated_at?: string | null }
type A = Pick<Activite, 'updated_at' | 'pourcentage' | 'etape'>

const t = (iso: string | null | undefined) => { const n = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(n) ? null : n }

/** Premier passage horaire (même minute que `passage`) qui tombe à `apres` ou plus tard. */
export function passageApres(passage: string | null, apres: number, now: number): number | null {
  const p = t(passage)
  if (p === null) return null
  let x = p
  while (x < Math.max(apres, now)) x += 3_600_000
  return x
}

export function situationSilence(
  c: C,
  activite: A | null,
  ctx: { now: Date; prochainPassage: string | null; demandeEnCours: boolean; abandonMin?: number },
): SituationSilence {
  const now = ctx.now.getTime()
  const abandonMs = (ctx.abandonMin ?? DELAI_ABANDON_MIN) * 60_000
  const dernier = t(activite?.updated_at)
  const qui = nomQui(c.pris_par)
  const depuis = dernier !== null ? (dateRelative(activite!.updated_at, ctx.now) || 'à l’instant') : 'aucun signe depuis la réservation'
  // Sans étape signalée, on compte depuis la dernière modification de la fiche.
  const reference = dernier ?? t(c.updated_at)
  const abandonneA = reference !== null ? reference + abandonMs : null
  const abandonne = abandonneA !== null && abandonneA <= now
  const repriseMs = passageApres(ctx.prochainPassage, abandonneA ?? now, now)
  const repriseA = repriseMs !== null ? heureLisible(new Date(repriseMs).toISOString(), ctx.now) : null
  const base = { qui, depuis, repriseA }

  if (ctx.demandeEnCours) return { ...base, geste: 'rien',
    ceQuiSePasse: 'Tu as déjà demandé où ça en est : un assistant regarde.',
    consigne: 'Rien à faire : la réponse arrive ici toute seule. Ne relance pas encore.' }
  if (abandonne && repriseA) return { ...base, geste: 'rien',
    ceQuiSePasse: `${qui} s’est arrêté (dernier signe : ${depuis}) : le chantier n’avance plus.`,
    consigne: `Rien à faire : il sera repris tout seul vers ${repriseA}.` }
  if (abandonne) return { ...base, geste: 'relancer',
    ceQuiSePasse: `${qui} s’est arrêté (dernier signe : ${depuis}) et rien n’est programmé pour le reprendre.`,
    consigne: 'À faire : touche « Relancer maintenant » ci-dessous (copie la consigne à coller dans Claude Code, ou demande où ça en est).' }
  const finAttente = abandonneA !== null ? heureLisible(new Date(abandonneA).toISOString(), ctx.now) : null
  return { ...base, geste: 'attendre',
    ceQuiSePasse: `${qui} l’a pris, mais rien de nouveau (${depuis}) : il travaille peut-être encore.`,
    consigne: repriseA && finAttente
      ? `Rien à faire pour l’instant : sans nouvelle d’ici ${finAttente}, il est repris tout seul vers ${repriseA}.`
      : `Rien à faire avant ${finAttente ?? `${DELAI_ABANDON_MIN} min sans nouvelle`} : passé ce délai, relance-le toi-même (aucune reprise automatique n’est programmée).` }
}

/**
 * 0041 : la base a libéré une réservation sans signe de vie (`liberer_silencieux`).
 * Une phrase tant que personne ne l'a reprise : qui, depuis quand, quand il est
 * repris seul. Null si rien n'a été libéré ou si une réservation vit de nouveau.
 */
export function phraseLiberee(
  c: Pick<Chantier, 'pris_jusqu_a' | 'libere_at' | 'libere_de' | 'libere_apres_min'>,
  ctx: { now: Date; prochainPassage: string | null },
): string | null {
  if (t(c.libere_at) === null) return null
  const now = ctx.now.getTime()
  const jusqua = t(c.pris_jusqu_a)
  if (jusqua !== null && jusqua > now) return null
  const qui = c.libere_de ? nomQui(c.libere_de).toLowerCase() : 'une session'
  const passage = passageApres(ctx.prochainPassage, now, now)
  const reprise = passage !== null ? `repris seul vers ${heureLisible(new Date(passage).toISOString(), ctx.now)}` : 'repris seul à la prochaine passe de la chef'
  return `Pris par ${qui}, sans signe de vie depuis ${c.libere_apres_min ?? DELAI_ABANDON_MIN} min : libéré à ${heureLisible(c.libere_at!, ctx.now)}, ${reprise}. Rien à faire de ton côté.`
}

// ---- « Travail réel » (0104, chantier a33cf882) : les seuils de la règle `etat_session`, réglables par projet ----
// « Vivant » ne dépend plus d'un délai seul : un tour en cours, une tâche d'arrière-plan avec preuve, un calcul mesuré, ou l'ouverture
// récente. Le délai « sans signe de vie » ci-dessus devient le REPLI (combien de temps une session muette reste affichée).
// Mêmes bornes que `regler_travail_reel` (0104) et que les contraintes des colonnes.
export const BORNES_TRAVAIL = {
  tourMin: { min: 1, max: 120 }, fondMin: { min: 1, max: 1440 }, machineMin: { min: 2, max: 60 }, seuilPct: { min: 1, max: 400 }, pasS: { min: 30, max: 600 },
} as const

export interface ReglageTravail { tourMin: number; fondMin: number; machineMin: number; seuilPct: number; pasS: number }
/** Défauts du battement machine (ceux des colonnes de la base ; `verifier-etat-travail.mjs` les compare). */
export const MACHINE_DEFAUT = { seuilPct: 5, pasS: 120 } as const

/** Message d'erreur des réglages « travail réel », ou null s'ils sont valables (mêmes règles que la base : jamais un envoi refusé). */
export function erreurTravailReel(r: ReglageTravail): string | null {
  const b = BORNES_TRAVAIL
  const ok = (n: number, { min, max }: { min: number; max: number }) => Number.isInteger(n) && n >= min && n <= max
  if (!ok(r.tourMin, b.tourMin)) return `Tour en cours : de ${b.tourMin.min} à ${b.tourMin.max} minutes.`
  if (!ok(r.fondMin, b.fondMin)) return `Preuve d’une tâche en arrière-plan : de ${b.fondMin.min} à ${b.fondMin.max} minutes.`
  if (!ok(r.machineMin, b.machineMin)) return `Calcul récent : de ${b.machineMin.min} à ${b.machineMin.max} minutes.`
  if (!ok(r.seuilPct, b.seuilPct)) return `Seuil de calcul : de ${b.seuilPct.min} à ${b.seuilPct.max} %.`
  if (!ok(r.pasS, b.pasS)) return `Mesure de la machine : toutes les ${b.pasS.min} à ${b.pasS.max} secondes.`
  if (r.machineMin * 60 < 2 * r.pasS) return `Calcul récent : au moins deux mesures (${r.pasS} s) doivent tenir dans ${r.machineMin} min.`
  return null
}
