import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'

/** Descriptif d'un chantier (0090) : une phrase simple sous le titre ; au toucher, le texte plus long.
 *  Pas de descriptif : une ligne qui le dit (jamais un blanc qui ressemble à une panne). */
export function DescriptifChantier({ c, vide = true }: { c: Pick<Chantier, 'descriptif' | 'descriptif_detail'>; vide?: boolean }) {
  const [ouvert, setOuvert] = useState(false)
  const court = c.descriptif?.trim()
  const detail = c.descriptif_detail?.trim()
  if (!court) return vide ? <p className="mt-0.5 text-xs italic text-texte-2" data-testid="descriptif-vide">Pas encore de descriptif : Claude l’écrira.</p> : null
  if (!detail) return <p className="mt-0.5 text-[13px] leading-snug text-texte-2" data-testid="descriptif-court">{court}</p>
  return (
    <div className="mt-0.5" data-testid="descriptif">
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} data-testid="descriptif-bouton"
        className="flex min-h-8 w-full items-start gap-1 text-left text-[13px] leading-snug text-texte-2">
        <span className="flex-1" data-testid="descriptif-court">{court}</span>
        <ChevronDown size={15} className={`mt-0.5 shrink-0 transition ${ouvert ? 'rotate-180' : ''}`} aria-label={ouvert ? 'Masquer le détail' : 'Lire le détail'} />
      </button>
      {ouvert ? <p className="whitespace-pre-wrap rounded-lg bg-carte-2 px-2.5 py-2 text-sm leading-snug" data-testid="descriptif-detail">{detail}</p> : null}
    </div>
  )
}
