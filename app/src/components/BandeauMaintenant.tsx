import { useCockpit } from '../contexte.ts'
import { activiteDuProjet } from '../lib/activite.ts'
import { Progression } from './Progression.tsx'
import { nomCourtSession } from '../lib/texte.ts'

/** « 🔧 Là, maintenant » : la dernière activité en cours du projet. Rien s'il n'y en a pas. */
export function BandeauMaintenant({ onVoirChantier }: { onVoirChantier: (id: string) => void }) {
  const { activites, chantiers } = useCockpit()
  const a = activiteDuProjet(activites)
  if (!a) return null
  const chantier = a.chantier_id ? chantiers.find((c) => c.id === a.chantier_id) : null
  return (
    <section data-testid="bandeau-maintenant" className="rounded-2xl border border-attention/40 bg-attention/8 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-sm font-bold text-attention">
        <span>🔧 Là, maintenant</span>
        <span className="truncate font-medium text-texte-2">{nomCourtSession(a.session)}</span>
      </div>
      {chantier ? (
        <button type="button" onClick={() => onVoirChantier(chantier.id)} className="mt-0.5 block w-full truncate text-left font-semibold underline-offset-2 hover:underline">
          {chantier.titre}
        </button>
      ) : a.detail ? <div className="mt-0.5 truncate font-semibold">{a.detail}</div> : null}
      <Progression activite={a} compact />
    </section>
  )
}
