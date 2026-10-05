// Une phrase claire par chantier « en attente » ou « sans nouvelles » : ce qui se passe, ce qui va
// être fait et quand, et si Raphaël a quelque chose à faire (sinon « rien à faire »).
//
// Raphaël (30 sept. 2026, chantier 37405805) : « je ne comprends pas ce qu'il y a à faire ni ce qui
// va être fait ». Une seule règle, pure, lue par la liste « En attente » ET par la carte « Plus de
// nouvelles » du fil (via situationSilence, qui s'appuie sur `nomQui`) : jamais de nom technique
// (renfort/e8d57a/fdcf17, réservé, abandonné) dans ce que l'écran affiche.
import type { Activite, Chantier } from './types.ts'
import { heureLisible, dateRelative } from './dates.ts'

type C = Pick<Chantier, 'etat' | 'pris_par' | 'pris_jusqu_a' | 'updated_at'>
type A = Pick<Activite, 'updated_at'>

const t = (iso: string | null | undefined) => { const n = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(n) ? null : n }

/** Qui tient le chantier, en mots simples (jamais l'identifiant de branche ou de session). */
export function nomQui(prisPar: string | null | undefined): string {
  if (!prisPar) return 'Une session Claude'
  if (/renfort/i.test(prisPar)) return 'Un assistant de renfort'
  if (/agent/i.test(prisPar)) return 'Un assistant Claude'
  return 'Une session Claude'
}

export interface PhraseAttente {
  /** Ce qui se passe, une phrase. */
  quoi: string
  /** Ce qui va être fait, et quand. */
  suite: string
  /** true : Raphaël a un geste à faire ; false : « rien à faire ». */
  aFaire: boolean
}

/** Premier passage horaire (même minute que `passage`) à `apres` ou plus tard. */
function prochainPassageApres(passage: string | null, apres: number, now: number): number | null {
  const p = t(passage)
  if (p === null) return null
  let x = p
  while (x < Math.max(apres, now)) x += 3_600_000
  return x
}

export function phraseAttente(
  c: C, activite: A | null,
  ctx: { now: Date; abandonMin: number; prochainPassage: string | null; autonome: boolean },
): PhraseAttente {
  const now = ctx.now.getTime()
  const reserve = !!c.pris_par && (t(c.pris_jusqu_a) ?? 0) > now
  const repriseDe = (apres: number) => {
    const ms = prochainPassageApres(ctx.prochainPassage, apres, now)
    return ms === null ? null : heureLisible(new Date(ms).toISOString(), ctx.now)
  }
  if (!reserve) {
    const vers = repriseDe(now)
    const quoi = c.etat === 'en_cours' ? 'Il était en cours, mais plus personne n’y travaille.' : 'Personne n’y travaille pour l’instant.'
    if (ctx.autonome) return { quoi, suite: vers ? `Une session le prend toute seule vers ${vers}.` : 'Une session le prendra toute seule dès qu’elle repasse sur le projet.', aFaire: false }
    return { quoi, suite: 'Rien ne le lance tout seul : touche « Lancer » pour qu’une session Claude le prenne.', aFaire: true }
  }
  const dernier = t(activite?.updated_at) ?? t(c.updated_at)
  const qui = nomQui(c.pris_par)
  const depuis = activite ? (dateRelative(activite.updated_at, ctx.now) || 'à l’instant') : null
  const limite = dernier !== null ? dernier + ctx.abandonMin * 60_000 : null
  if (limite !== null && limite > now) {
    const fin = heureLisible(new Date(limite).toISOString(), ctx.now)
    const vers = repriseDe(limite)
    return {
      quoi: `${qui} l’a pris et travaille peut-être encore : rien de nouveau${depuis ? ` (${depuis})` : ''}.`,
      suite: vers ? `Sans nouvelle d’ici ${fin}, il est repris tout seul vers ${vers}.` : `Sans nouvelle d’ici ${fin}, relance-le toi-même : aucune reprise automatique n’est programmée.`,
      aFaire: !vers,
    }
  }
  const vers = repriseDe(now)
  return {
    quoi: `${qui} s’est arrêté${depuis ? ` (dernier signe ${depuis})` : ' sans rien signaler'}.`,
    suite: vers ? `Il est repris tout seul vers ${vers}.` : 'Aucune reprise automatique n’est programmée : touche « Lancer » pour qu’une session le reprenne.',
    aFaire: !vers,
  }
}

/** La phrase complète, avec le verdict « rien à faire » quand c'est le cas. */
export function phraseComplete(p: PhraseAttente): string {
  return `${p.quoi} ${p.suite}${p.aFaire ? '' : ' Rien à faire de ton côté.'}`
}

/** Le mode autonome du projet est-il allumé en ce moment ? (permanent, ou jusqu'à une heure à venir). */
export function projetAutonome(p: { autonome_toujours?: boolean; autonome_jusqu_a?: string | null } | null | undefined, now: Date): boolean {
  if (!p) return false
  return !!p.autonome_toujours || (t(p.autonome_jusqu_a) ?? 0) > now.getTime()
}
