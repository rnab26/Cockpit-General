import { Home, ListChecks, Settings2, Wallet, type LucideIcon } from 'lucide-react'
import type { OngletProjet } from '../lib/vueProjet.ts'

export type CleNavigation = 'accueil' | OngletProjet
const ONGLETS: { cle: CleNavigation; libelle: string; Icone: LucideIcon }[] = [
  { cle: 'accueil', libelle: 'Accueil', Icone: Home },
  { cle: 'travail', libelle: 'Travail', Icone: ListChecks },
  { cle: 'reglages', libelle: 'Réglages', Icone: Settings2 },
  { cle: 'couts', libelle: 'Coûts', Icone: Wallet },
]

/**
 * Barre d'onglets en bas, comme une appli de téléphone. Visible seulement en vue Mobile, et en Auto sur un écran
 * tactile étroit (CSS `.nav-bas`, index.css) ; sur ordinateur elle reste masquée et les onglets du haut servent.
 * `actif` = 'accueil' dans la vue « Tout ».
 */
export function BarreNavigation({ actif, onChoisir }: { actif: CleNavigation; onChoisir: (c: CleNavigation) => void }) {
  return (
    <nav aria-label="Navigation" data-testid="barre-navigation" data-actif={actif}
      className="nav-bas fixed inset-x-0 bottom-0 z-30 grid-cols-4 border-t border-bord bg-carte pb-[env(safe-area-inset-bottom)]">
      {ONGLETS.map(({ cle, libelle, Icone }) => (
        <button key={cle} type="button" aria-current={actif === cle ? 'page' : undefined} onClick={() => onChoisir(cle)} data-testid={`nav-${cle}`}
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] active:bg-carte-2 ${actif === cle ? 'font-semibold text-accent' : 'text-texte-2'}`}>
          <Icone size={22} aria-hidden />{libelle}
        </button>
      ))}
    </nav>
  )
}
