// Extraits et noms courts : coupés AU MOT, blancs écrasés avant de couper.

export function extrait(texte: string | null | undefined, max = 90): string {
  const t = (texte ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const coupe = t.slice(0, max)
  const dernierEspace = coupe.lastIndexOf(' ')
  return (dernierEspace > max * 0.6 ? coupe.slice(0, dernierEspace) : coupe).trimEnd() + '…'
}

/** « claude/cockpit-ideal-reusable-qldenz » → « cockpit-ideal-reusable ». */
export function nomCourtSession(session: string | null | undefined): string {
  if (!session) return ''
  let s = session.replace(/^claude\//, '')
  s = s.replace(/-[a-z0-9]{6}$/, '')
  return s.length > 28 ? s.slice(0, 27) + '…' : s
}

export function pluriel(n: number, un: string, plusieurs = un + 's'): string {
  return `${n} ${n > 1 ? plusieurs : un}`
}
