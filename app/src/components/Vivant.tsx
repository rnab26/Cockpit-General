import { useEffect, useRef, useState } from 'react'

/**
 * Ce qui montre que ça TRAVAILLE (Raphaël, 29 sept. : « quand un chantier
 * bouge, une couleur, quelque chose qui scintille »). Réservé à ce qui a une
 * preuve de vie : jamais sur un chantier muet. Avec prefers-reduced-motion, la
 * pastille reste verte, fixe (index.css).
 */
export function PointTravaille({ className = '' }: { className?: string }) {
  return (
    <span data-testid="point-travaille" className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1 text-[11px] font-medium leading-5 text-ok ${className}`}>
      <span className="point-vivant inline-block h-2 w-2 rounded-full bg-ok" aria-hidden />travaille
    </span>
  )
}

/** Vrai pendant ~1,4 s quand `cle` change (une nouvelle étape est arrivée) : la ligne clignote une fois. */
export function useFlash(cle: string | null | undefined): boolean {
  const [flash, setFlash] = useState(false)
  const avant = useRef(cle)
  useEffect(() => {
    const precedente = avant.current
    avant.current = cle
    if (precedente == null || cle == null || precedente === cle) return
    setFlash(true)
    const t = window.setTimeout(() => setFlash(false), 1400)
    return () => window.clearTimeout(t)
  }, [cle])
  return flash
}
