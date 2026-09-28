import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** Une carte repliable qui garde son badge visible sur la barre de titre. */
export function Repliable({ titre, badge, ouvertParDefaut = false, ouvert, onToggle, children, className = '', testId }: {
  titre: ReactNode; badge?: ReactNode; ouvertParDefaut?: boolean; ouvert?: boolean; onToggle?: (v: boolean) => void
  children: ReactNode; className?: string; testId?: string
}) {
  const [interne, setInterne] = useState(ouvertParDefaut)
  const estOuvert = ouvert ?? interne
  const bascule = () => { onToggle?.(!estOuvert); if (ouvert === undefined) setInterne(!estOuvert) }
  return (
    <section className={`rounded-2xl border border-bord bg-carte ${className}`} data-testid={testId}>
      <button type="button" onClick={bascule} aria-expanded={estOuvert}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
        <span className="flex min-w-0 items-center gap-2 font-semibold">{titre}</span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-texte-2">{badge}<ChevronDown size={18} className={`transition ${estOuvert ? 'rotate-180' : ''}`} /></span>
      </button>
      {estOuvert ? <div className="border-t border-bord px-3 py-2.5">{children}</div> : null}
    </section>
  )
}
