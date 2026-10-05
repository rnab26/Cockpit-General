import { ListChecks, Settings2, Wallet, type LucideIcon } from 'lucide-react'
import type { OngletProjet } from '../lib/vueProjet.ts'

const ONGLETS: { cle: OngletProjet; libelle: string; Icone: LucideIcon }[] = [
  { cle: 'travail', libelle: 'Travail', Icone: ListChecks },
  { cle: 'reglages', libelle: 'Réglages', Icone: Settings2 },
  { cle: 'couts', libelle: 'Coûts', Icone: Wallet },
]

/** Trois icônes sur une ligne (chantier 9cc71872) : travail et chantiers, réglages du projet, coûts. */
export function OngletsProjet({ actif, onChoisir }: { actif: OngletProjet; onChoisir: (o: OngletProjet) => void }) {
  return (
    <div role="tablist" aria-label="Menus du projet" className="onglets-haut grid grid-cols-3 gap-1.5" data-testid="onglets-projet" data-actif={actif}>
      {ONGLETS.map(({ cle, libelle, Icone }) => (
        <button key={cle} type="button" role="tab" aria-selected={actif === cle} aria-label={libelle} onClick={() => onChoisir(cle)} data-testid={`onglet-vue-${cle}`}
          className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-1.5 text-xs transition active:scale-[.98] ${actif === cle ? 'border-accent bg-carte font-semibold text-texte' : 'border-bord text-texte-2 hover:bg-carte-2'}`}>
          <Icone size={20} aria-hidden />{libelle}
        </button>
      ))}
    </div>
  )
}
