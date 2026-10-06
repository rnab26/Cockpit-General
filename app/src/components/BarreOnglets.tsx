import { Layers, MessagesSquare, ListChecks, Search, Settings2, Wallet, type LucideIcon } from 'lucide-react'
import { HAUTEUR_BARRE_PX, type OngletBarre } from '../lib/navMobile.ts'

const ONGLETS: { cle: OngletBarre; libelle: string; Icone: LucideIcon; testid: string }[] = [
  { cle: 'accueil', libelle: 'Accueil', Icone: Layers, testid: 'onglet-barre-accueil' },
  { cle: 'projet', libelle: 'Projet', Icone: ListChecks, testid: 'onglet-vue-travail' },
  { cle: 'recherche', libelle: 'Recherche', Icone: Search, testid: 'loupe' },
  { cle: 'discussion', libelle: 'Discussions', Icone: MessagesSquare, testid: 'onglet-barre-discussions' },
  { cle: 'couts', libelle: 'Coûts', Icone: Wallet, testid: 'onglet-vue-couts' },
  { cle: 'reglages', libelle: 'Réglages', Icone: Settings2, testid: 'onglet-vue-reglages' },
]

/**
 * Barre d'onglets du bas, comme une application : fixe, zone de sécurité de
 * l'iPhone respectée, cibles de 56 px. Remplace les trois icônes de la page et
 * la loupe de l'en-tête quand elle est affichée (une seule façon de faire).
 */
export function BarreOnglets({ actif, onChoisir, aToi, reponses = 0 }: { actif: OngletBarre; onChoisir: (o: OngletBarre) => void; aToi: number; reponses?: number }) {
  return (
    <nav aria-label="Navigation" data-testid="barre-onglets" data-actif={actif}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-bord bg-fond/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div role="tablist" className="mx-auto grid max-w-3xl grid-cols-6" style={{ height: HAUTEUR_BARRE_PX }}>
        {ONGLETS.map(({ cle, libelle, Icone, testid }) => (
          <button key={cle} type="button" role="tab" aria-selected={actif === cle} aria-label={libelle} data-testid={testid} onClick={() => onChoisir(cle)}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] transition active:bg-carte-2 ${actif === cle ? 'font-semibold text-accent' : 'text-texte-2'}`}>
            <Icone size={22} aria-hidden strokeWidth={actif === cle ? 2.4 : 1.9} />
            <span className="max-w-full truncate">{libelle}</span>
            {cle === 'accueil' && aToi ? <span className="absolute right-[22%] top-1.5 min-w-4 rounded-full bg-alerte px-1 text-center text-[10px] font-bold leading-4 text-white" data-testid="barre-a-toi">{aToi}</span> : null}
            {cle === 'discussion' && reponses ? <span className="absolute right-[18%] top-1.5 min-w-4 rounded-full bg-alerte px-1 text-center text-[10px] font-bold leading-4 text-white" data-testid="barre-reponses">{reponses}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  )
}
