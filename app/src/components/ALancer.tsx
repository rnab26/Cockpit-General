import { useMemo, useState } from 'react'
import { useCockpit, useGlobal } from '../contexte.ts'
import { aLancer, type LigneALancer } from '../lib/entonnoir.ts'
import { Button } from '../ui/Button.tsx'
import { AvecProjet, PastilleProjet } from './AvecProjet.tsx'
import { Progression } from './Progression.tsx'
import { BoutonsRelance } from './Relance.tsx'

/** Au-delà, « Voir les N autres » (demande de Raphaël : pas de liste interminable). */
export const PAR_PROJET_A_LANCER = 5

/**
 * « À lancer » : les chantiers que PERSONNE ne tient, groupés par projet. Une
 * ligne compacte chacun, le dernier avancement en GRIS, et les deux gestes :
 * copier la consigne pour une session Claude, ou demander où ça en est.
 */
export function ALancer({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const groupes = useMemo(() => aLancer(g.chantiers, g.activites, g.messages, g.now, g.silenceMs, g.projets.map((p) => p.id), projetId, g.taches),
    [g.chantiers, g.activites, g.messages, g.now, g.silenceMs, g.projets, projetId, g.taches])
  const total = groupes.reduce((n, gr) => n + gr.lignes.length, 0)
  const [tousVisibles, setTousVisibles] = useState<Set<string>>(new Set())
  return (
    <section data-testid="a-lancer" aria-label="À lancer" className="space-y-2">
      <h2 className="flex items-baseline justify-between px-1 text-base font-bold">
        <span>🚀 À lancer</span><span className="text-sm font-bold text-texte-2" data-testid="a-lancer-total">{total}</span>
      </h2>
      {total === 0 ? (
        <p className="rounded-2xl border border-dashed border-bord px-3 py-3 text-center text-sm text-texte-2">Aucun chantier en attente d’une session.</p>
      ) : (
        <>
          <p className="px-1 text-xs text-texte-2">Personne n’y travaille. Pour en lancer un : « Copier la consigne », puis colle-la dans une session Claude du projet.</p>
          {groupes.map((gr) => {
            const p = g.projets.find((x) => x.id === gr.projetId)
            const tout = tousVisibles.has(gr.projetId) || gr.lignes.length <= PAR_PROJET_A_LANCER
            const visibles = tout ? gr.lignes : gr.lignes.slice(0, PAR_PROJET_A_LANCER)
            return (
              <AvecProjet key={gr.projetId} projetId={gr.projetId}>
                <div className="overflow-hidden rounded-2xl border border-bord bg-carte" data-testid="groupe-a-lancer">
                  {projetId ? null : (
                    <div className="flex items-center justify-between border-b border-bord/70 px-3 py-1.5">
                      <PastilleProjet projet={p} className="max-w-[70%]" /><span className="text-xs font-semibold text-texte-2">{gr.lignes.length}</span>
                    </div>
                  )}
                  <ul className="divide-y divide-bord/70">
                    {visibles.map((l) => <Ligne key={l.c.id} l={l} />)}
                  </ul>
                  {!tout ? (
                    <Button pleine taille="sm" variante="discret" className="rounded-none border-t border-bord/70"
                      onClick={() => setTousVisibles((s) => new Set(s).add(gr.projetId))}>
                      Voir les {gr.lignes.length - PAR_PROJET_A_LANCER} autres
                    </Button>
                  ) : null}
                </div>
              </AvecProjet>
            )
          })}
        </>
      )}
    </section>
  )
}

function Ligne({ l }: { l: LigneALancer }) {
  const { ouvrirChantier, now } = useCockpit()
  return (
    <li className="px-3 py-2.5" data-testid="ligne-a-lancer" data-ligne-chantier={l.c.id}>
      <button type="button" onClick={() => ouvrirChantier(l.c.id)} className="block w-full text-left">
        <span className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 font-semibold leading-snug">{l.c.titre}</span>
          {l.c.priorite === 'haute' ? <span className="shrink-0 text-xs font-semibold text-alerte">🔥 haute</span> : null}
        </span>
        <span className={`mt-0.5 block text-xs ${l.presence.code === 'silencieux' ? 'font-semibold text-attention' : 'text-texte-2'}`}>
          {l.presence.libelle}{l.presence.code === 'silencieux' && l.presence.detail ? ` · ${l.presence.detail}` : ''}
        </span>
      </button>
      {l.activite ? <Progression activite={l.activite} vive={false} compact now={now} /> : null}
      <div className="mt-2"><BoutonsRelance chantier={l.c} /></div>
    </li>
  )
}
