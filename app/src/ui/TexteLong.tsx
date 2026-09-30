import { useState } from 'react'

/**
 * Un long texte replié à quelques lignes, « Lire la suite » au toucher (règle de
 * clarté, 29 sept. : le sujet d'un coup d'œil, le détail si on le veut).
 */
export function TexteLong({ texte, petit = false }: { texte: string; petit?: boolean }) {
  const [tout, setTout] = useState(false)
  const long = texte.length > (petit ? 200 : 320)
  return (
    <>
      <div className={`space-y-2 whitespace-pre-wrap leading-relaxed ${petit ? 'mt-1 text-sm text-texte-2' : 'text-[15px]'} ${long && !tout ? (petit ? 'line-clamp-3' : 'line-clamp-6') : ''}`} data-testid="texte-aere">
        {texte.split(/\n{2,}/).map((p, i) => <p key={i}>{p.trim()}</p>)}
      </div>
      {long ? <button type="button" onClick={() => setTout(!tout)} className="mt-0.5 text-sm font-medium text-accent" data-testid="lire-la-suite">{tout ? 'Réduire' : 'Lire la suite'}</button> : null}
    </>
  )
}
