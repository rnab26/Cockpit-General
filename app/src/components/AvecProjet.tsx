import type { ReactNode } from 'react'
import { CockpitCtx, useGlobal } from '../contexte.ts'
import type { Projet } from '../lib/types.ts'

/**
 * Rend `children` dans le contexte d'UN projet. C'est ce qui permet à
 * l'onglet « Tout » de réutiliser tels quels les blocs d'un projet (question,
 * validation, fil, relance) : chacun écrit dans SON projet.
 */
export function AvecProjet({ projetId, children }: { projetId: string; children: ReactNode }) {
  const g = useGlobal()
  const ctx = g.contexteDe(projetId)
  if (!ctx) return null
  return <CockpitCtx.Provider value={ctx}>{children}</CockpitCtx.Provider>
}

/** La pastille d'un projet : sa couleur et son nom, pour savoir d'un coup d'œil de quel projet on parle. */
export function PastilleProjet({ projet, className = '' }: { projet: Pick<Projet, 'nom' | 'couleur'> | null | undefined; className?: string }) {
  if (!projet) return null
  return (
    <span className={`inline-flex max-w-[45%] shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-bold leading-4 text-white ${className}`}
      style={{ background: projet.couleur ?? 'var(--accent)' }} data-testid="pastille-projet">
      <span className="truncate">{projet.nom}</span>
    </span>
  )
}
