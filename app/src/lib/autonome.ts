// Le « mode autonome » d'un projet (migration 0010) : Raphaël, 29 sept. 2026,
// « quand je vais dormir, si la session n'a plus rien à reprendre, qu'elle
// poursuive sur les chantiers disponibles ». L'heure se choisit en heure
// d'ISRAËL (son heure), quel que soit le fuseau de l'appareil ; le serveur
// refuse le passé et plus de 24 h (regler_autonome). Pur, vérifié par
// scripts/verifier-autonome.ts.
import type { Activite, Chantier, SessionClaude, Tache } from './types.ts'

export const FUSEAU = 'Asia/Jerusalem'
export const HEURE_DEFAUT = '09:00'
export const MAX_DEFAUT = 20
export const MAX_MIN = 1
export const MAX_MAX = 50
export const DUREE_MAX_MS = 24 * 3600_000

/** Les composantes de l'heure murale d'une date dans un fuseau. */
function mural(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, j: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second }
}

/** L'instant UTC qui correspond à une heure murale dans un fuseau (gère l'heure d'été). */
function instantDe(y: number, m: number, j: number, h: number, mi: number, tz: string): Date {
  let t = Date.UTC(y, m - 1, j, h, mi)
  for (let i = 0; i < 2; i++) {            // deux passes suffisent, même un jour de changement d'heure
    const w = mural(new Date(t), tz)
    const ecart = Date.UTC(w.y, w.m - 1, w.j, w.h, w.mi) - Date.UTC(y, m - 1, j, h, mi)
    t -= ecart
  }
  return new Date(t)
}

/** « HH:MM » valide ? */
export function estHeure(v: string): boolean { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) }

/** La prochaine occurrence de « HH:MM » (heure d'Israël) après `now` : « 9:00 » à 23 h = demain matin. */
export function prochaineHeure(hhmm: string, now: Date = new Date(), tz: string = FUSEAU): Date {
  const [h, mi] = hhmm.split(':').map(Number)
  const w = mural(now, tz)
  let d = instantDe(w.y, w.m, w.j, h, mi, tz)
  if (d.getTime() <= now.getTime()) {
    const demain = new Date(Date.UTC(w.y, w.m - 1, w.j) + 86_400_000)
    d = instantDe(demain.getUTCFullYear(), demain.getUTCMonth() + 1, demain.getUTCDate(), h, mi, tz)
  }
  return d
}

/** « 09:00 » : l'heure de fin, en heure d'Israël. */
export function heureIsrael(iso: string | Date, tz: string = FUSEAU): string {
  const w = mural(typeof iso === 'string' ? new Date(iso) : iso, tz)
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`
}

/** Allumé = « tout le temps » (0011), ou une heure de fin dans le futur (même règle que cockpit.autonome_actif). */
export function autonomeActif(p: { autonome_jusqu_a: string | null; autonome_toujours?: boolean }, now: Date = new Date()): boolean {
  return !!p.autonome_toujours || (!!p.autonome_jusqu_a && Date.parse(p.autonome_jusqu_a) > now.getTime())
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const MIN = 60_000

/**
 * Ce qu'une session peut prendre seule (copie de cockpit.chantiers_prenables,
 * migration 0011, que l'app n'a pas le droit d'appeler) : libre ou pas encore
 * trié, ou EN COURS mais ABANDONNÉ (fiche immobile depuis 1 h, aucun signe de
 * vie depuis 30 min, aucune session vivante qui le tient). Jamais « à cadrer »,
 * « bloqué », « reporté », « à vérifier ». Ouvert, pas un doublon, pas réservé
 * par une autre (réservation expirée comprise).
 */
export function chantiersPrenables(
  chantiers: readonly Pick<Chantier, 'id' | 'projet_id' | 'etat' | 'archived_at' | 'doublon_de' | 'pris_par' | 'pris_jusqu_a' | 'updated_at'>[],
  projetId: string, now: Date = new Date(),
  activites: readonly Pick<Activite, 'chantier_id' | 'statut' | 'updated_at' | 'session'>[] = [],
  taches: readonly Pick<Tache, 'chantier_id' | 'statut' | 'vu_at'>[] = [],
  sessions: readonly Pick<SessionClaude, 'projet_id' | 'fin_at' | 'vu_at' | 'branche'>[] = [],
): number {
  const t = now.getTime()
  return chantiers.filter((c) => {
    if (c.projet_id !== projetId || c.archived_at || c.doublon_de) return false
    if (c.pris_par && !(ms(c.pris_jusqu_a) < t)) return false
    if (c.etat === 'libre' || c.etat === 'a_trier') return true
    if (c.etat !== 'en_cours' || !(ms(c.updated_at) < t - 60 * MIN)) return false
    if (activites.some((a) => a.chantier_id === c.id && a.statut === 'en_cours' && ms(a.updated_at) > t - 30 * MIN)) return false
    if (taches.some((x) => x.chantier_id === c.id && x.statut === 'en_cours' && ms(x.vu_at) > t - 30 * MIN)) return false
    const derniere = activites.filter((a) => a.chantier_id === c.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.session
    return !sessions.some((se) => se.projet_id === c.projet_id && !se.fin_at && ms(se.vu_at) > t - 30 * MIN && !!se.branche
      && (se.branche === c.pris_par || se.branche === derniere))
  }).length
}

/** Avant d'appeler le serveur : ce qu'il refuserait, dit en clair (null = OK). */
export function erreurReglage(fin: Date, max: number, now: Date = new Date()): string | null {
  if (!Number.isInteger(max) || max < MAX_MIN || max > MAX_MAX) return `Le plafond doit être entre ${MAX_MIN} et ${MAX_MAX} chantiers.`
  if (fin.getTime() <= now.getTime()) return 'L’heure de fin doit être dans le futur.'
  if (fin.getTime() - now.getTime() > DUREE_MAX_MS) return 'Pas plus de 24 h d’affilée.'
  return null
}
