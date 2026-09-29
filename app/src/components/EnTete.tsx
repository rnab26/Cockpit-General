import { useEffect, useRef, useState } from 'react'
import { SquareCheck, Copy, Download, FolderTree, Layers, MoreHorizontal, Plus, RefreshCw, Settings, type LucideIcon } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { VUE_TOUT, type EtatDirect } from '../hooks/useDonnees.ts'
import { Button } from '../ui/Button.tsx'
import { dateRelative } from '../lib/dates.ts'
import { useMenuQuiSeFerme } from '../ui/Modale.ts'

export type ActionMenu = 'sections' | 'doublons' | 'reglages' | 'projets' | 'choisir' | 'installer'

export interface Pastilles { travaillent: number; aToi: number }

/**
 * Les petites pastilles d'un onglet : n sessions au travail (point vert), n
 * choses qui t'attendent (nombre rouge). Rien quand c'est zéro. Sans pavé ni
 * emoji (29 sept. : « très coloré, ça fait mal aux yeux »).
 */
function PastillesOnglet({ p }: { p: Pastilles | undefined; actif?: boolean }) {
  if (!p || (!p.travaillent && !p.aToi)) return null
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold tabular-nums leading-5" data-testid="pastilles-onglet">
      {p.travaillent ? <span className="flex items-center gap-0.5 text-ok" data-testid="pastille-travaillent" title={`${p.travaillent} session(s) au travail`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />{p.travaillent}</span> : null}
      {p.aToi ? <span className="text-alerte" data-testid="pastille-a-toi" title={`${p.aToi} chose(s) t’attendent`}>{p.aToi}</span> : null}
    </span>
  )
}

export function EnTete({ projets, projet, vueTout, choisirVue, pastilles, admin, chargement, direct, derniereMaj, onActualiser, onNouveau, onMenu, selectionActive, installable }: {
  projets: Projet[]; projet: Projet | null; vueTout: boolean; choisirVue: (id: string) => void
  pastilles: Map<string, Pastilles>; admin: boolean
  chargement: boolean; direct: EtatDirect; derniereMaj: Date | null
  onActualiser: () => void; onNouveau: () => void; onMenu: (a: ActionMenu) => void; selectionActive: boolean
  /** Faux quand le cockpit tourne déjà en appli installée. */
  installable: boolean
}) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const onglets = useRef<HTMLDivElement>(null)
  // L'onglet affiché reste entièrement visible (la rangée défile sur un téléphone).
  useEffect(() => { onglets.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) }, [vueTout, projet?.id])
  useMenuQuiSeFerme(menu, ref, () => setMenu(false))
  const item = (a: ActionMenu, libelle: string, I: LucideIcon) => (
    <button type="button" role="menuitem" onClick={() => { setMenu(false); onMenu(a) }} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[15px] hover:bg-carte-2"><I size={17} className="shrink-0 text-texte-2" aria-hidden />{libelle}</button>
  )
  return (
    <header className="sticky top-0 z-30 border-b border-bord bg-fond/95 backdrop-blur" style={{ borderTopColor: (!vueTout && projet?.couleur) || undefined }}>
      <div className="mx-auto flex max-w-3xl items-center gap-1 px-3 pt-[max(env(safe-area-inset-top),6px)] pb-1.5">
        <div ref={onglets} className="sans-barre flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1" role="tablist" aria-label="Projets">
          {projets.length ? (
            <button type="button" role="tab" aria-selected={vueTout} onClick={() => choisirVue(VUE_TOUT)} data-testid="onglet-tout"
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold transition ${vueTout ? 'border-texte/70 bg-carte text-texte' : 'border-bord bg-carte text-texte-2'}`}>
              <span>Tout</span>
              <PastillesOnglet p={pastilles.get(VUE_TOUT)} actif={vueTout} />
            </button>
          ) : null}
          {projets.map((p) => {
            const actif = !vueTout && p.id === projet?.id
            return (
              <button key={p.id} type="button" role="tab" aria-selected={actif} onClick={() => choisirVue(p.id)} data-testid={`onglet-${p.slug}`}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold transition ${actif ? 'border-texte/70 bg-carte text-texte' : 'border-bord bg-carte text-texte-2'} ${!p.actif ? 'opacity-60' : ''}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.couleur ?? '#888' }} />
                <span>{p.nom}</span>
                <PastillesOnglet p={pastilles.get(p.id)} actif={actif} />
              </button>
            )
          })}
        </div>
        <Button variante="discret" taille="sm" aria-label="Actualiser" title={derniereMaj ? `Mis à jour ${dateRelative(derniereMaj.toISOString())}` : 'Actualiser'} onClick={onActualiser} className="px-2" data-testid="actualiser">
          <RefreshCw size={18} className={chargement ? 'animate-spin' : ''} />
        </Button>
        {projet && !vueTout ? <Button variante="primaire" taille="sm" onClick={onNouveau} data-testid="nouveau-chantier" className="px-2.5"><Plus size={18} /><span className="hidden sm:inline">Chantier</span></Button> : null}
        <div className="relative" ref={ref}>
          <Button variante="discret" taille="sm" aria-label="Menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="px-2" data-testid="menu"><MoreHorizontal size={20} /></Button>
          {menu ? (
            <div role="menu" className="absolute right-0 top-10 z-40 w-56 overflow-hidden rounded-xl border border-bord bg-carte py-1 shadow-xl">
              {projet && !vueTout && admin ? item('sections', 'Sections', FolderTree) : null}
              {projet && !vueTout && admin ? item('doublons', 'Doublons', Copy) : null}
              {projet && !vueTout && admin ? item('choisir', selectionActive ? 'Terminer la sélection' : 'Choisir (sélection groupée)', SquareCheck) : null}
              {admin ? item('projets', 'Projets & membres', Layers) : null}
              {installable ? item('installer', 'Installer l’appli', Download) : null}
              {item('reglages', 'Réglages', Settings)}
            </div>
          ) : null}
        </div>
      </div>
      {direct === 'coupe' ? (
        <div className="border-t border-bord px-3 py-1 text-center text-xs text-texte-2" data-testid="direct-coupe">
          Direct coupé — rafraîchissement toutes les 30 s{derniereMaj ? ` · à jour ${dateRelative(derniereMaj.toISOString())}` : ''}
        </div>
      ) : null}
    </header>
  )
}
