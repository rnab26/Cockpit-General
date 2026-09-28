import { useMemo, useState } from 'react'
import type { Chantier, Section } from '../lib/types.ts'
import { useCockpit, type Filtre } from '../contexte.ts'
import { bacDe } from '../lib/etats.ts'
import { trierChantiers } from '../lib/tri.ts'
import { normaliser } from '../lib/doublons.ts'
import { CarteChantier } from './CarteChantier.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { Vide } from '../ui/Etats.tsx'
import { Input } from '../ui/Champs.tsx'
import { Button } from '../ui/Button.tsx'

/**
 * Les deux bacs du Trieur (« 🔧 En cours d'optimisation », « ✅ Actif ») plus
 * les archives, groupés par section et triés par urgence. Un filtre
 * (alerte, « où j'en suis ») remplace les bacs par la liste filtrée.
 */
export function Bacs({ filtre, ouverts, basculer, onNouveau }: { filtre: Filtre | null; ouverts: Set<string>; basculer: (id: string) => void; onNouveau: () => void }) {
  const { chantiers, sections, enAttente, admin, poserFiltre } = useCockpit()
  const [recherche, setRecherche] = useState('')
  const q = normaliser(recherche)

  const visibles = useMemo(() => {
    let liste = chantiers
    if (filtre) liste = liste.filter((c) => filtre.ids.has(c.id))
    if (q) liste = liste.filter((c) => normaliser(`${c.titre} ${c.demande ?? ''} ${c.resume_simple ?? ''}`).includes(q))
    return trierChantiers(liste, enAttente)
  }, [chantiers, filtre, q, enAttente])

  const optimisation = visibles.filter((c) => bacDe(c) === 'optimisation')
  const actifs = visibles.filter((c) => bacDe(c) === 'actif')
  const archives = visibles.filter((c) => bacDe(c) === 'archives')
  const rendre = (c: Chantier) => <CarteChantier key={c.id} chantier={c} ouverte={ouverts.has(c.id)} onToggle={() => basculer(c.id)} />

  return (
    <div className="space-y-3" data-testid="bacs">
      <div className="flex items-center gap-2">
        <Input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="🔍 Chercher un chantier…" aria-label="Chercher" className="h-10" />
      </div>
      {filtre ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm" data-testid="filtre-actif">
          <span>Filtre : <b>{filtre.libelle}</b> · {visibles.length} chantier{visibles.length > 1 ? 's' : ''}</span>
          <Button taille="sm" onClick={() => poserFiltre(null)}>✕ Tout afficher</Button>
        </div>
      ) : null}

      {filtre || q ? (
        visibles.length ? <ParSection chantiers={visibles} sections={sections} rendre={rendre} />
          : <Vide emoji="🔎" titre="Rien ne correspond" texte={filtre ? 'Ce filtre ne contient plus de chantier.' : 'Essaie un autre mot.'} action={filtre ? <Button onClick={() => poserFiltre(null)}>Tout afficher</Button> : undefined} />
      ) : (
        <>
          <section data-testid="bac-optimisation">
            <h2 className="mb-2 flex items-center justify-between px-1 text-base font-bold">
              <span>🔧 En cours d’optimisation</span><span className="text-sm font-semibold text-texte-2">{optimisation.length}</span>
            </h2>
            {optimisation.length ? <ParSection chantiers={optimisation} sections={sections} rendre={rendre} />
              : <Vide emoji="🎉" titre="Rien en cours" texte={chantiers.length ? 'Tout ce qui est ouvert a été certifié.' : 'Aucun chantier sur ce projet pour l’instant.'}
                  action={<Button variante="primaire" onClick={onNouveau}>+ Premier chantier</Button>} />}
          </section>
          <Repliable testId="bac-actif" titre={<span>✅ Actif</span>} badge={<span className="text-sm font-semibold">{actifs.length}</span>}>
            {actifs.length ? <div className="space-y-2">{actifs.map(rendre)}</div> : <p className="text-sm text-texte-2">Aucun chantier certifié pour l’instant.</p>}
          </Repliable>
          {archives.length || admin ? (
            <Repliable testId="bac-archives" titre={<span className="text-texte-2">🗃️ Archives</span>} badge={<span className="text-sm font-semibold">{archives.length}</span>}>
              {archives.length ? <div className="space-y-2">{archives.map(rendre)}</div> : <p className="text-sm text-texte-2">Rien d’archivé (hors certifiés) et aucun doublon fusionné.</p>}
            </Repliable>
          ) : null}
        </>
      )}
    </div>
  )
}

function ParSection({ chantiers, sections, rendre }: { chantiers: Chantier[]; sections: Section[]; rendre: (c: Chantier) => React.ReactNode }) {
  const groupes: { section: Section | null; liste: Chantier[] }[] = []
  for (const s of sections) {
    const liste = chantiers.filter((c) => c.section_id === s.id)
    if (liste.length) groupes.push({ section: s, liste })
  }
  const connues = new Set(sections.map((s) => s.id))
  const sans = chantiers.filter((c) => !c.section_id || !connues.has(c.section_id))
  if (sans.length) groupes.push({ section: null, liste: sans })
  return (
    <div className="space-y-3">
      {groupes.map((g) => (
        <div key={g.section?.id ?? 'sans'} data-testid="groupe-section">
          <h3 className="mb-1.5 flex items-baseline justify-between px-1 text-sm font-semibold text-texte-2">
            <span>{g.section?.nom ?? 'Sans section'}</span><span className="text-xs">{g.liste.length}</span>
          </h3>
          {g.section?.description ? <p className="mb-1.5 px-1 text-xs text-texte-2">{g.section.description}</p> : null}
          <div className="space-y-2">{g.liste.map(rendre)}</div>
        </div>
      ))}
    </div>
  )
}
