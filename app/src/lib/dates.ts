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
