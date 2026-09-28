import { useMemo, useState } from 'react'
import type { Chantier, Section } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { bacDe } from '../lib/etats.ts'
import { compteursPresence, estEnCoursSansNouvelles, presenceDe, trierParPresence, LIBELLE_COURT_PRESENCE } from '../lib/entonnoir.ts'
import type { Presence } from '../lib/presence.ts'
import { normaliser } from '../lib/doublons.ts'
import { dansFenetre, estFenetre, FENETRES, FENETRE_DEFAUT } from '../lib/fenetre.ts'
import { CarteChantier } from './CarteChantier.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { Vide } from '../ui/Etats.tsx'
import { Input } from '../ui/Champs.tsx'
import { Button } from '../ui/Button.tsx'

export const cleSection = (projetId: string, sectionId: string | null) => `${projetId}:${sectionId ?? 'sans'}`
/** Le repli qui contient un chantier : sa section s'il est ouvert, sinon « Actif » ou « Archives ». */
export function cleDuChantier(c: Pick<Chantier, 'projet_id' | 'section_id' | 'etat' | 'archived_at'>, sectionsConnues: ReadonlySet<string>): string {
  const bac = bacDe(c)
  if (bac === 'actif') return `${c.projet_id}:__actif`
  if (bac === 'archives') return `${c.projet_id}:__archives`
  return cleSection(c.projet_id, c.section_id && sectionsConnues.has(c.section_id) ? c.section_id : null)
}

type Avec = { c: Chantier; presence: Presence }

/**
 * « Tous les chantiers » d'un projet, SOUS l'entonnoir : la liste complète,
 * sections repliées par défaut. Chaque en-tête dit d'un coup d'œil ce qui s'y
 * passe (🟢 1 · 🔴 2 · ⏸ 4) — c'est ce qui remplace « Où j'en suis ».
 * Certifiés et archives restent à part, repliés.
 */
export function TousLesChantiers({ ouverts, basculer, sectionOuverte, basculerSection, deplierTout, onNouveau }: {
  ouverts: Set<string>; basculer: (id: string) => void
  sectionOuverte: (cle: string) => boolean; basculerSection: (cle: string) => void
  deplierTout: (cles: string[] | null) => void; onNouveau: () => void
}) {
  const { chantiers, sections, activites, taches, enAttente, admin, now, silenceMs, prefs, projet, selection } = useCockpit()
  const [recherche, setRecherche] = useState('')
  const q = normaliser(recherche)
  const avec = useMemo<Avec[]>(() => chantiers.map((c) => ({ c, presence: presenceDe(c, activites, enAttente, now, silenceMs, taches).presence })),
    [chantiers, activites, taches, enAttente, now, silenceMs])
  const trouves = useMemo(() => q ? trierParPresence(avec.filter(({ c }) => normaliser(`${c.titre} ${c.demande ?? ''} ${c.resume_simple ?? ''}`).includes(q))) : [], [avec, q])
  const ouvertsBac = trierParPresence(avec.filter(({ c }) => bacDe(c) === 'optimisation'))
  const actifs = avec.filter(({ c }) => bacDe(c) === 'actif')
  const archives = avec.filter(({ c }) => bacDe(c) === 'archives')
  const fenetre = estFenetre(prefs.fenetre_livre) ? prefs.fenetre_livre : FENETRE_DEFAUT
  const libelleFenetre = FENETRES.find((f) => f.valeur === fenetre)?.libelle.toLowerCase() ?? ''
  const recents = actifs.filter(({ c }) => dansFenetre(c.valide_at, fenetre, now)).length
  const rendre = ({ c }: Avec) => <CarteChantier key={c.id} chantier={c} ouverte={ouverts.has(c.id)} onToggle={() => basculer(c.id)} />
  const groupes = grouper(ouvertsBac, sections)
  const cles = groupes.map((gr) => cleSection(projet.id, gr.section?.id ?? null))
  const toutOuvert = cles.length > 0 && cles.every(sectionOuverte)
  const forcer = selection.actif  // on ne coche pas ce qu'on ne voit pas
  // Tout ce qui est en cours se lit au même endroit, « En ce moment » : on y renvoie, pas de seconde liste.
  const nEnCours = ouvertsBac.filter(({ c, presence }) => presence.code === 'travaille' || estEnCoursSansNouvelles(c, presence)).length

  return (
    <section className="space-y-2.5" data-testid="tous-les-chantiers" aria-label="Tous les chantiers">
      <h2 className="flex items-center justify-between gap-2 px-1 pt-2 text-base font-bold">
        <span>📋 Tous les chantiers <span className="text-sm font-semibold text-texte-2">({chantiers.length})</span></span>
        {!q && cles.length ? (
          <Button taille="sm" variante="discret" onClick={() => deplierTout(toutOuvert ? null : cles)} data-testid="tout-deplier">
            {toutOuvert ? 'Tout replier' : 'Tout déplier'}
          </Button>
        ) : null}
      </h2>
      {nEnCours ? (
        <button type="button" data-testid="voir-en-ce-moment" className="w-full rounded-xl bg-ok/8 px-3 py-2 text-left text-sm font-semibold text-ok"
          onClick={() => document.querySelector('[data-testid="en-ce-moment"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          ⬆ {nEnCours} en cours : tout est regroupé dans « En ce moment », en haut
        </button>
      ) : null}
      <Input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="🔍 Chercher un chantier…" aria-label="Chercher" className="h-10" />

      {q ? (
        trouves.length ? <div className="space-y-2">{trouves.map(rendre)}</div>
          : <Vide emoji="🔎" titre="Rien ne correspond" texte="Essaie un autre mot." />
      ) : (
        <>
          {groupes.length ? groupes.map((gr) => {
            const cle = cleSection(projet.id, gr.section?.id ?? null)
            const compteurs = compteursPresence(gr.liste.map((x) => x.presence.code))
            return (
              <Repliable key={cle} testId="groupe-section" ouvert={forcer || sectionOuverte(cle)} onToggle={() => basculerSection(cle)}
                titre={<span className="truncate">{gr.section?.nom ?? 'Sans section'}</span>}
                badge={
                  <span className="flex items-center gap-1.5 text-xs font-semibold" data-testid="compteurs-section"
                    aria-label={compteurs.map((x) => `${x.n} ${LIBELLE_COURT_PRESENCE[x.code]}`).join(', ')}>
                    {compteurs.map((x) => <span key={x.code} className="tabular-nums">{x.icone} {x.n}</span>)}
                  </span>
                }>
                {gr.section?.description ? <p className="mb-2 text-xs text-texte-2">{gr.section.description}</p> : null}
                <div className="space-y-2">{gr.liste.map(rendre)}</div>
              </Repliable>
            )
          }) : (
            <Vide emoji="🎉" titre="Rien d’ouvert" texte={chantiers.length ? 'Tout ce qui est ouvert a été certifié.' : 'Aucun chantier sur ce projet pour l’instant.'}
              action={<Button variante="primaire" onClick={onNouveau}>+ Nouveau chantier</Button>} />
          )}
          <Repliable testId="bac-actif" ouvert={sectionOuverte(`${projet.id}:__actif`)} onToggle={() => basculerSection(`${projet.id}:__actif`)} titre={<span>✅ Actif (certifiés)</span>}
            badge={<span className="text-xs font-semibold">{actifs.length}{recents ? ` · ${recents} ${libelleFenetre}` : ''}</span>}>
            {actifs.length ? <div className="space-y-2">{actifs.map(rendre)}</div> : <p className="text-sm text-texte-2">Aucun chantier certifié pour l’instant.</p>}
          </Repliable>
          {archives.length || admin ? (
            <Repliable testId="bac-archives" ouvert={sectionOuverte(`${projet.id}:__archives`)} onToggle={() => basculerSection(`${projet.id}:__archives`)} titre={<span className="text-texte-2">🗃️ Archives</span>} badge={<span className="text-xs font-semibold">{archives.length}</span>}>
              {archives.length ? <div className="space-y-2">{archives.map(rendre)}</div> : <p className="text-sm text-texte-2">Rien d’archivé (hors certifiés) et aucun doublon fusionné.</p>}
            </Repliable>
          ) : null}
        </>
      )}
    </section>
  )
}

function grouper(liste: Avec[], sections: Section[]): { section: Section | null; liste: Avec[] }[] {
  const groupes: { section: Section | null; liste: Avec[] }[] = []
  const ordre = [...sections].sort((a, b) => a.position - b.position || a.nom.localeCompare(b.nom, 'fr'))
  for (const s of ordre) {
    const l = liste.filter(({ c }) => c.section_id === s.id)
    if (l.length) groupes.push({ section: s, liste: l })
  }
  const connues = new Set(sections.map((s) => s.id))
  const sans = liste.filter(({ c }) => !c.section_id || !connues.has(c.section_id))
  if (sans.length) groupes.push({ section: null, liste: sans })
  return groupes
}
