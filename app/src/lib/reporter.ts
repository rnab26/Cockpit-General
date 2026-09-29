// Mettre de côté, reporter, abandonner un chantier depuis son fil (29 sept.
// 2026, migration 0027). Raphaël : « un chat par requête pour le finir jusqu'au
// bout et le classer le plus efficacement possible, ou le mettre de côté,
// l'abandonner ou le reporter ».
//   - Mettre de côté : état « reporte », sans date (« Relancer maintenant » le rouvre).
//   - Reporter : « reporte » jusqu'à une date ; ce jour-là il revient tout seul
//     dans « Prêt à lancer » (reveiller_reportes, passe de la chef et l'app).
//   - Abandonner : archivé (Désarchiver le rend), une ligne dans le fil.
// Pur, vérifié par scripts/verifier-reporter.ts.
import type { Chantier } from './types.ts'

export type ChoixReport = 'demain' | '3j' | 'semaine' | 'mois'
export const CHOIX_REPORT: { cle: ChoixReport; libelle: string; jours: number }[] = [
  { cle: 'demain', libelle: 'Demain', jours: 1 },
  { cle: '3j', libelle: 'Dans 3 jours', jours: 3 },
  { cle: 'semaine', libelle: 'Dans une semaine', jours: 7 },
  { cle: 'mois', libelle: 'Dans un mois', jours: 30 },
]

/** La date de retour : le matin (9 h, heure locale) du jour choisi. */
export function dateDeReport(jours: number, now: Date): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + jours)
  d.setHours(9, 0, 0, 0)
  return d
}

/** Une date saisie (AAAA-MM-JJ) → 9 h ce jour-là ; null si illisible, passée ou à plus d'un an (même borne que la base). */
export function dateSaisie(valeur: string, now: Date): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0, 0)
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) return null
  if (d.getTime() > now.getTime() + 365 * 86400_000) return null
  return d
}

const JOUR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })

/** Ce que dit la bulle d'un chantier mis de côté ou reporté. */
export function texteReporte(c: Pick<Chantier, 'etat' | 'reporte_jusqu_a' | 'archived_at'>, now: Date): string | null {
  if (c.etat !== 'reporte') return null
  if (c.archived_at) return 'Abandonné. « Désarchiver » dans le menu le rend, puis « Relancer maintenant ».'
  if (c.reporte_jusqu_a) {
    const t = Date.parse(c.reporte_jusqu_a)
    if (t > now.getTime()) return `Reporté au ${JOUR.format(new Date(t))} : ce jour-là, il revient tout seul dans « Prêt à lancer ».`
    return 'La date de report est passée : il revient dans « Prêt à lancer » au prochain passage de Claude.'
  }
  return 'Mis de côté exprès. Rien à faire de ta part, sauf si tu veux le relancer.'
}
