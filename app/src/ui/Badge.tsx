import type { ReactNode } from 'react'
import type { Teinte } from '../lib/etats.ts'

const TEINTES: Record<Teinte, string> = {
  neutre: 'bg-carte-2 text-texte-2 border-bord',
  ok: 'bg-ok/12 text-ok border-ok/30',
  attention: 'bg-attention/12 text-attention border-attention/30',
  alerte: 'bg-alerte/12 text-alerte border-alerte/30',
  info: 'bg-info/12 text-info border-info/30',
  accent: 'bg-accent/12 text-accent border-accent/30',
}

export function Badge({ teinte = 'neutre', children, className = '', title }: { teinte?: Teinte; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap ${TEINTES[teinte]} ${className}`}>
      {children}
    </span>
  )
}
