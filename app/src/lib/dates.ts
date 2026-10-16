// Dates lisibles pour un téléphone : « il y a 3 min », « ~12 min ».
// Toujours relatif à un `now` passé en paramètre, pour rester vérifiable.

export function dateRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.round((now.getTime() - t) / 1000)
  if (s < 45) return 'à l’instant'
  if (s < 90) return 'il y a 1 min'
  const m = Math.round(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.round(h / 24)
  if (j === 1) return 'hier'
  if (j < 30) return `il y a ${j} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function dateLongue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** « ~12 min », « ~2 h », « ~40 s » ; null quand on ne sait pas (jamais 0). */
export function etaLisible(secondes: number | null | undefined): string | null {
  if (secondes == null || !Number.isFinite(secondes) || secondes <= 0) return null
  if (secondes < 60) return `~${Math.round(secondes)} s`
  const m = Math.round(secondes / 60)
  if (m < 60) return `~${m} min`
  const h = Math.floor(m / 60)
  const reste = m % 60
  return reste ? `~${h} h ${reste} min` : `~${h} h`
}

/** Une réservation est valide si elle n'a pas expiré. */
export function reservationValide(prisJusquA: string | null | undefined, now: Date = new Date()): boolean {
  if (!prisJusquA) return false
  const t = new Date(prisJusquA).getTime()
  return !Number.isNaN(t) && t > now.getTime()
}

/**
 * L'heure exacte, lisible sur un téléphone (30 sept. 2026, Raphaël : « je ne
 * vois pas à quelle heure ils ont fini ») : « 12:17 » aujourd'hui, « hier
 * 23:53 », « 28 sept. 09:05 » avant. Heure locale de l'appareil.
 */
export function heureLisible(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const ecart = Math.round((jour(now) - jour(d)) / 86_400_000)
  if (ecart === 0) return hh
  if (ecart === 1) return `hier ${hh}`
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${hh}`
}

/**
 * L'âge ET l'heure d'une ligne qui attend (Raphaël, 16 oct. 2026 : « j'ai pas la date ni l'horaire de quand ça date ») :
 * « il y a 3 h · 05:44 », « hier 02:44 » (jamais « hier · hier 02:44 » ni « il y a 2 j · hier 02:44 »), « il y a 2 j · 14 oct. 23:22 »,
 * « 14 sept. 23:22 » au-delà d'un mois. Vide quand la date manque.
 */
export function ageEtHeure(iso: string | null | undefined, now: Date = new Date()): string {
  const rel = dateRelative(iso, now)
  if (!rel) return ''
  if (rel === 'à l’instant') return rel
  const heure = heureLisible(iso, now)
  // « il y a 2 j » arrondit (46 h = 2 j) alors que « hier » compte les jours du calendrier : les deux ensemble se contredisent (vu sur FacePro, 16 oct.).
  if (/^il y a \d+ j$/.test(rel) && heure.startsWith('hier')) return heure
  return rel.startsWith('il y a') ? `${rel} · ${heure}` : heure   // « hier » et les dates : l'heure dit déjà le jour
}
