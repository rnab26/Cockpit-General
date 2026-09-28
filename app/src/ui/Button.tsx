import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variante = 'primaire' | 'secondaire' | 'discret' | 'danger' | 'ok' | 'attention'
type Taille = 'sm' | 'md' | 'lg'

const VARIANTES: Record<Variante, string> = {
  primaire: 'bg-accent text-accent-fg hover:opacity-90 border-transparent',
  secondaire: 'bg-carte text-texte border-bord hover:bg-carte-2',
  discret: 'bg-transparent text-texte-2 border-transparent hover:bg-carte-2 hover:text-texte',
  danger: 'bg-alerte text-white border-transparent hover:opacity-90',
  ok: 'bg-ok text-white border-transparent hover:opacity-90',
  attention: 'bg-attention text-white border-transparent hover:opacity-90',
}
const TAILLES: Record<Taille, string> = {
  sm: 'h-8 px-2.5 text-sm gap-1',
  md: 'h-10 px-3.5 text-[15px] gap-1.5',
  lg: 'h-12 px-4 text-base gap-2 font-semibold',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  taille?: Taille
  chargement?: boolean
  pleine?: boolean
  children?: ReactNode
}

export function Button({ variante = 'secondaire', taille = 'md', chargement, pleine, className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || chargement}
      className={`inline-flex items-center justify-center rounded-xl border font-medium select-none transition
        disabled:opacity-50 disabled:pointer-events-none active:scale-[.98] whitespace-nowrap
        ${VARIANTES[variante]} ${TAILLES[taille]} ${pleine ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {chargement ? <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}
