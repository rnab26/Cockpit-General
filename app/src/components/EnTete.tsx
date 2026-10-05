import { useRef, useState } from 'react'
import { SquareCheck, ChevronDown, Copy, Download, FolderTree, Layers, Moon, Plug, MoreHorizontal, Plus, RefreshCw, Settings, type LucideIcon } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { VUE_TOUT, type EtatDirect } from '../hooks/useDonnees.ts'
import { Button } from '../ui/Button.tsx'
import { dateRelative } from '../lib/dates.ts'
import { useMenuQuiSeFerme } from '../ui/Modale.ts'
import { useGlobal } from '../contexte.ts'
import { estBranche } from '../lib/branchement.ts'
import { BarreRecherche, BoutonLoupe } from './Recherche.tsx'

export type ActionMenu = 'sections' | 'doublons' | 'reglages' | 'projets' | 'choisir' | 'installer'

export interface Pastilles {
  travaillent: number; aToi: number
  /** Mode autonome allumé (0031) : « alerte » = allumé sans rien à prendre ni personne au travail. */
  autonome?: 'actif' | 'alerte' | null
}

/**
 * Les petites pastilles d'un onglet : n sessions au travail (point vert), n
 * choses qui t'attendent (nombre rouge). Rien quand c'est zéro. Sans pavé ni
 * emoji (29 sept. : « très coloré, ça fait mal aux yeux »).
 */
function PastillesOnglet({ p }: { p: Pastilles | undefined; actif?: boolean }) {
  if (!p || (!p.travaillent && !p.aToi && !p.autonome)) return null
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold tabular-nums leading-5" data-testid="pastilles-onglet">
      {p.autonome ? <span data-testid="pastille-autonome" data-alerte={p.autonome === 'alerte' ? 'oui' : 'non'} title={p.autonome === 'alerte' ? 'Autonome allumé, rien à prendre' : 'Mode autonome allumé'}
        className={p.autonome === 'alerte' ? 'text-attention' : 'text-info'}><Moon size={12} aria-label={p.autonome === 'alerte' ? 'autonome, rien à prendre' : 'autonome'} /></span> : null}
      {p.travaillent ? <span className="flex items-center gap-0.5 text-ok" data-testid="pastille-travaillent" title={`${p.travaillent} session(s) au travail`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />{p.travaillent}</span> : null}
      {p.aToi ? <span className="text-alerte" data-testid="pastille-a-toi" title={`${p.aToi} chose(s) t’attendent`}>{p.aToi}</span> : null}
    </span>
  )
}

export function EnTete({ projets, projet, vueTout, choisirVue, pastilles, admin, chargement, direct, derniereMaj, rechargeDu, onActualiser, onNouveau, onMenu, selectionActive, installable, recherche, onRecherche, barreBas }: {
  projets: Projet[]; projet: Projet | null; vueTout: boolean; choisirVue: (id: string) => void
  pastilles: Map<string, Pastilles>; admin: boolean
  chargement: boolean; direct: EtatDirect; derniereMaj: Date | null
  /** Début du dernier rechargement complet (ms) : les bancs attendent qu'il dépasse leur toucher. */
  rechargeDu: number | null
  onActualiser: () => void; onNouveau: () => void; onMenu: (a: ActionMenu) => void; selectionActive: boolean
  /** Faux quand le cockpit tourne déjà en appli installée. */
  installable: boolean
  /** Barre de recherche ouverte (état tenu par l'écran : la barre du bas la pilote aussi). */
  recherche: boolean; onRecherche: (v: boolean) => void
  /** Barre d'onglets du bas affichée : elle porte la recherche, plus de loupe ici. */
  barreBas: boolean
}) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Liste déroulante des projets (30 sept. : « on ne voit pas tous les projets » avec la rangée qui défile).
  const liste = useRef<HTMLDivElement>(null)
  const [ouvert, setOuvert] = useState(false)
  const { now } = useGlobal()
  useMenuQuiSeFerme(ouvert, liste, () => setOuvert(false))
  const choisir = (id: string) => { setOuvert(false); choisirVue(id) }
  useMenuQuiSeFerme(menu, ref, () => setMenu(false))
  const item = (a: ActionMenu, libelle: string, I: LucideIcon) => (
    <button type="button" role="menuitem" onClick={() => { setMenu(false); onMenu(a) }} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[15px] hover:bg-carte-2"><I size={17} className="shrink-0 text-texte-2" aria-hidden />{libelle}</button>
  )
  return (
    <header className="sticky top-0 z-30 border-b border-bord bg-fond/95 backdrop-blur" style={{ borderTopColor: (!vueTout && projet?.couleur) || undefined }}>
      <div className="mx-auto flex max-w-3xl lg:max-w-5xl items-center gap-1 px-3 pt-[max(env(safe-area-inset-top),6px)] pb-1.5">
        <div ref={liste} className="relative min-w-0 flex-1" data-testid="choix-projet" data-vue={vueTout ? 'tout' : projet?.slug ?? ''}>
          <button type="button" aria-haspopup="listbox" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)} data-testid="choix-projet-bouton"
            className="flex h-10 w-full min-w-0 items-center gap-2 rounded-full border border-bord bg-carte px-3 text-left text-sm font-semibold text-texte">
            {vueTout ? <Layers size={15} className="shrink-0 text-texte-2" aria-hidden /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: projet?.couleur ?? '#888' }} />}
            <span className="min-w-0 flex-1 truncate">{vueTout ? 'Tout' : projet?.nom ?? 'Projets'}</span>
            {!vueTout && projet && estBranche(projet, now) ? <Plug size={14} className="shrink-0 text-ok" aria-label="branché" /> : null}
            <PastillesOnglet p={pastilles.get(vueTout ? VUE_TOUT : projet?.id ?? '')} />
            <ChevronDown size={16} className={`shrink-0 text-texte-2 transition ${ouvert ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {ouvert ? (
            <div role="listbox" aria-label="Projets" data-testid="liste-projets" className="absolute left-0 right-0 top-11 z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-bord bg-carte py-1 shadow-xl">
              {projets.length ? (
                <button type="button" role="option" aria-selected={vueTout} onClick={() => choisir(VUE_TOUT)} data-testid="onglet-tout"
                  className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[15px] hover:bg-carte-2 ${vueTout ? 'font-semibold text-texte' : 'text-texte-2'}`}>
                  <Layers size={15} className="shrink-0 text-texte-2" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Tout</span>
                  <PastillesOnglet p={pastilles.get(VUE_TOUT)} />
                </button>
              ) : null}
              {projets.map((p) => {
                const actif = !vueTout && p.id === projet?.id
                return (
                  <button key={p.id} type="button" role="option" aria-selected={actif} onClick={() => choisir(p.id)} data-testid={`onglet-${p.slug}`}
                    className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[15px] hover:bg-carte-2 ${actif ? 'font-semibold text-texte' : 'text-texte-2'} ${!p.actif ? 'opacity-60' : ''}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.couleur ?? '#888' }} />
                    <span className="min-w-0 flex-1 truncate">{p.nom}</span>
                    {estBranche(p, now) ? <span data-testid="icone-branche" title="Branché : une session a démarré avec le cockpit dans les dernières 24 h" className="text-ok"><Plug size={15} aria-label="branché" /></span> : null}
                    <PastillesOnglet p={pastilles.get(p.id)} actif={actif} />
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <Button variante="discret" taille="sm" aria-label="Actualiser" title={derniereMaj ? `Mis à jour ${dateRelative(derniereMaj.toISOString())}` : 'Actualiser'} onClick={onActualiser} className="px-2" data-testid="actualiser" data-chargement={chargement ? '1' : '0'} data-recharge-du={rechargeDu ?? 0}>
          <RefreshCw size={18} className={chargement ? 'animate-spin' : ''} />
        </Button>
        {barreBas ? null : <BoutonLoupe ouvert={recherche} onToggle={() => onRecherche(!recherche)} />}
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
      {recherche ? <BarreRecherche onFermer={() => onRecherche(false)} /> : null}
      {direct === 'coupe' ? (
        <div className="border-t border-bord px-3 py-1 text-center text-xs text-texte-2" data-testid="direct-coupe">
          Direct coupé — rafraîchissement toutes les 30 s{derniereMaj ? ` · à jour ${dateRelative(derniereMaj.toISOString())}` : ''}
        </div>
      ) : null}
    </header>
  )
}
