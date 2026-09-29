import { CircleCheck, CircleDot, CirclePause, Clock, Compass, FlaskConical, GitMerge, Hourglass, MessageCircleQuestion, OctagonAlert, type LucideIcon } from 'lucide-react'
import type { CodePresence } from '../lib/presence.ts'
import type { TypeAToi } from '../lib/entonnoir.ts'

/**
 * Les icônes de l'écran (29 sept. 2026, Raphaël : « mets des logos plutôt que
 * des emojis pour faire plus propre »). Une seule table par sens, lue partout :
 * fines (lucide), 16-18 px, gris par défaut ; la couleur seulement quand elle
 * dit quelque chose (alerte, attention, ok).
 */
interface Icone { I: LucideIcon; teinte: string }

export const ICONE_PRESENCE: Record<CodePresence, Icone> = {
  travaille: { I: CircleDot, teinte: 'text-ok' },
  attend_toi: { I: MessageCircleQuestion, teinte: 'text-alerte' },
  a_verifier: { I: FlaskConical, teinte: 'text-attention' },
  silencieux: { I: Hourglass, teinte: 'text-attention' },
  a_cadrer: { I: Compass, teinte: 'text-info' },
  bloque: { I: OctagonAlert, teinte: 'text-alerte' },
  personne: { I: CirclePause, teinte: 'text-texte-2' },
  reporte: { I: Clock, teinte: 'text-texte-2' },
  termine: { I: CircleCheck, teinte: 'text-ok' },
}

export const ICONE_A_TOI: Record<TypeAToi, Icone> = {
  question: { I: MessageCircleQuestion, teinte: 'text-alerte' },
  fusion: { I: GitMerge, teinte: 'text-info' },
  a_verifier: { I: FlaskConical, teinte: 'text-attention' },
  a_cadrer: { I: Compass, teinte: 'text-info' },
  bloque: { I: OctagonAlert, teinte: 'text-alerte' },
}

export function IconePresence({ code, taille = 16, className = '' }: { code: CodePresence; taille?: number; className?: string }) {
  const { I, teinte } = ICONE_PRESENCE[code]
  return <I size={taille} aria-hidden className={`shrink-0 ${teinte} ${className}`} />
}

export function IconeAToi({ type, taille = 18 }: { type: TypeAToi; taille?: number }) {
  const { I, teinte } = ICONE_A_TOI[type]
  return <I size={taille} aria-hidden className={`shrink-0 ${teinte}`} />
}

/** Le point de couleur d'un projet (jamais un fond plein). */
export function PointProjet({ couleur }: { couleur: string | null | undefined }) {
  return <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: couleur ?? 'var(--accent)' }} />
}
