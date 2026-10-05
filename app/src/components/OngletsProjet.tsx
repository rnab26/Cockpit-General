import { ListChecks, Settings2, Wallet, type LucideIcon } from 'lucide-react'
import { Vide } from '../ui/Etats.tsx'
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

/** Coûts du projet : aucune donnée de coût n'existe dans la base du cockpit, l'écran le dit au lieu d'inventer. */
export function CoutsProjet() {
  return (
    <section aria-label="Coûts du projet" data-testid="couts-projet">
      <Vide icone={<Wallet size={28} strokeWidth={1.5} />} titre="Aucune dépense enregistrée"
        texte="Le cockpit ne suit pas encore les coûts ni les dépenses d’un projet : aucun chiffre n’est stocké, donc rien n’est affiché. Dès qu’une source existera, elle apparaîtra ici." />
    </section>
  )
}
