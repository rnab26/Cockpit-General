import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { EtatDeploiement } from './Deploiement.tsx'
import { ModeAutonome } from './ModeAutonome.tsx'
import { PastilleProjet } from './AvecProjet.tsx'

/** En tête de la vue d'un projet : l'état de sa mise en ligne et son mode autonome, en une ou deux lignes. */
export function BarreProjet({ projet }: { projet: Projet }) {
  const { now, admin } = useGlobal()
  if (!projet.depot && !admin) return null
  return (
    <section data-testid="barre-projet" className="space-y-1.5 rounded-2xl border border-bord bg-carte px-3 py-2">
      <EtatDeploiement projet={projet} now={now} />
      <ModeAutonome projet={projet} />
    </section>
  )
}

/** Dans « Tout », en bas : chaque projet, sa mise en ligne et son mode autonome (raccourci). */
export function ProjetsResume() {
  const { projets, now, admin } = useGlobal()
  const liste = projets.filter((p) => p.actif && (p.depot || admin))
  if (!liste.length) return null
  return (
    <section data-testid="projets-resume" aria-label="Tes projets" className="space-y-2">
      <h2 className="px-1 text-base font-bold">🛠️ Mises en ligne et nuit</h2>
      {liste.map((p) => (
        <div key={p.id} data-testid="projet-resume" data-projet={p.slug} className="space-y-1.5 rounded-2xl border border-bord bg-carte px-3 py-2">
          <PastilleProjet projet={p} />
          <EtatDeploiement projet={p} now={now} />
          <ModeAutonome projet={p} />
        </div>
      ))}
    </section>
  )
}
