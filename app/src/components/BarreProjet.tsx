import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { EtatDeploiement } from './Deploiement.tsx'
import { ModeAutonome } from './ModeAutonome.tsx'
import { PastilleProjet } from './AvecProjet.tsx'
import { etatBranchement } from '../lib/branchement.ts'

/** « Branché ? » : preuves lues en base (sessions, mise à jour automatique, module du site). */
function Branchement({ projet }: { projet: Projet }) {
  const { now, chantiers } = useGlobal()
  const n = chantiers.filter((c) => c.projet_id === projet.id && c.origine === 'session').length
  const couleur = { ok: 'text-ok', attention: 'text-attention', neutre: 'text-texte-2' } as const
  return (
    <ul data-testid="branchement" className="space-y-0.5 text-xs">
      {etatBranchement(projet, n, now).map((l) => <li key={l.texte} className={couleur[l.teinte]}>{l.texte}</li>)}
    </ul>
  )
}

/** En tête de la vue d'un projet : l'état de sa mise en ligne et son mode autonome, en une ou deux lignes. */
export function BarreProjet({ projet, nu = false }: { projet: Projet; nu?: boolean }) {
  const { now, admin } = useGlobal()
  if (!projet.depot && !admin) return null
  return (
    <section data-testid="barre-projet" className={nu ? 'space-y-2' : 'space-y-1.5 rounded-2xl border border-bord bg-carte px-3 py-2'}>
      <Branchement projet={projet} />
      <EtatDeploiement projet={projet} now={now} />
      <ModeAutonome projet={projet} />
    </section>
  )
}

/** Dans « Tout », replié en bas : chaque projet, sa mise en ligne et son mode autonome. */
export function ProjetsResume() {
  const { projets, now, admin } = useGlobal()
  const liste = projets.filter((p) => p.actif && (p.depot || admin))
  if (!liste.length) return null
  return (
    <section data-testid="projets-resume" aria-label="Tes projets" className="divide-y divide-bord/70">
      {liste.map((p) => (
        <div key={p.id} data-testid="projet-resume" data-projet={p.slug} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
          <PastilleProjet projet={p} />
          <Branchement projet={p} />
          <EtatDeploiement projet={p} now={now} />
          <ModeAutonome projet={p} />
        </div>
      ))}
    </section>
  )
}
