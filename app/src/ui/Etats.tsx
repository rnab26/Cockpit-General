import type { ReactNode } from 'react'
import { Inbox, TriangleAlert } from 'lucide-react'
import { Button } from './Button.tsx'

export function Chargement({ texte = 'Chargement…' }: { texte?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-texte-2" role="status">
      <span className="inline-block h-5 w-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      {texte}
    </div>
  )
}

export function Vide({ icone, titre, texte, action }: { icone?: ReactNode; titre: string; texte?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-bord px-4 py-8 text-center">
      <div className="flex justify-center text-texte-2" aria-hidden>{icone ?? <Inbox size={28} strokeWidth={1.5} />}</div>
      <div className="mt-2 font-semibold">{titre}</div>
      {texte ? <div className="mt-1 text-sm text-texte-2">{texte}</div> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function Erreur({ texte, onReessayer }: { texte: string; onReessayer?: () => void }) {
  return (
    <div className="rounded-2xl border border-bord border-l-4 border-l-alerte bg-carte px-4 py-4 text-center" role="alert">
      <div className="flex items-center justify-center gap-2 font-medium text-alerte"><TriangleAlert size={18} className="shrink-0" />{texte}</div>
      {onReessayer ? <Button className="mt-3" onClick={onReessayer}>Réessayer</Button> : null}
    </div>
  )
}
