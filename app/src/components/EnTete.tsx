import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import type { EtatDirect } from '../hooks/useDonnees.ts'
import { Button } from '../ui/Button.tsx'
import { dateRelative } from '../lib/dates.ts'

export type ActionMenu = 'sections' | 'doublons' | 'reglages' | 'projets' | 'choisir'

export function EnTete({ projets, projet, choisirProjet, admin, chargement, direct, derniereMaj, onActualiser, onNouveau, onMenu, selectionActive }: {
  projets: Projet[]; projet: Projet | null; choisirProjet: (id: string) => void; admin: boolean
  chargement: boolean; direct: EtatDirect; derniereMaj: Date | null
  onActualiser: () => void; onNouveau: () => void; onMenu: (a: ActionMenu) => void; selectionActive: boolean
}) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const fermer = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', fermer)
    return () => document.removeEventListener('mousedown', fermer)
  }, [menu])
  const item = (a: ActionMenu, libelle: string) => (
    <button type="button" role="menuitem" onClick={() => { setMenu(false); onMenu(a) }} className="block w-full px-3 py-2.5 text-left text-[15px] hover:bg-carte-2">{libelle}</button>
  )
  return (
    <header className="sticky top-0 z-30 border-b border-bord bg-fond/95 backdrop-blur" style={{ borderTopColor: projet?.couleur ?? undefined }}>
      <div className="mx-auto flex max-w-3xl items-center gap-1 px-3 pt-[max(env(safe-area-inset-top),6px)] pb-1.5">
        <div className="sans-barre flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1" role="tablist" aria-label="Projets">
          {projets.map((p) => {
            const actif = p.id === projet?.id
            return (
              <button key={p.id} type="button" role="tab" aria-selected={actif} onClick={() => choisirProjet(p.id)}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition ${actif ? 'border-transparent text-white' : 'border-bord bg-carte text-texte-2'} ${!p.actif ? 'opacity-60' : ''}`}
                style={actif ? { background: p.couleur ?? 'var(--accent)' } : undefined}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: actif ? 'rgba(255,255,255,.85)' : (p.couleur ?? '#888') }} />
                {p.nom}
              </button>
            )
          })}
        </div>
        <Button variante="discret" taille="sm" aria-label="Actualiser" title={derniereMaj ? `Mis à jour ${dateRelative(derniereMaj.toISOString())}` : 'Actualiser'} onClick={onActualiser} className="px-2" data-testid="actualiser">
          <RefreshCw size={18} className={chargement ? 'animate-spin' : ''} />
        </Button>
        {projet ? <Button variante="primaire" taille="sm" onClick={onNouveau} data-testid="nouveau-chantier" className="px-2.5"><Plus size={18} /><span className="hidden sm:inline">Chantier</span></Button> : null}
        <div className="relative" ref={ref}>
          <Button variante="discret" taille="sm" aria-label="Menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="px-2" data-testid="menu"><MoreHorizontal size={20} /></Button>
          {menu ? (
            <div role="menu" className="absolute right-0 top-10 z-40 w-56 overflow-hidden rounded-xl border border-bord bg-carte py-1 shadow-xl">
              {projet && admin ? item('sections', '🗂️ Sections') : null}
              {projet && admin ? item('doublons', '🔁 Doublons') : null}
              {projet && admin ? item('choisir', selectionActive ? '☑️ Terminer la sélection' : '☑️ Choisir (sélection groupée)') : null}
              {admin ? item('projets', '🏗️ Projets & membres') : null}
              {item('reglages', '⚙️ Réglages')}
            </div>
          ) : null}
        </div>
      </div>
      {direct === 'coupe' ? (
        <div className="bg-attention/15 px-3 py-1 text-center text-xs text-attention" data-testid="direct-coupe">
          Direct coupé — rafraîchissement toutes les 30 s{derniereMaj ? ` · à jour ${dateRelative(derniereMaj.toISOString())}` : ''}
        </div>
      ) : null}
    </header>
  )
}
