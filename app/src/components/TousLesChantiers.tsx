import { useMemo, useState } from 'react'
import { Archive, ChevronRight, CircleCheck, Plus, Search } from 'lucide-react'
import type { Chantier, Section } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { bacDe } from '../lib/etats.ts'
import { compteursPresence, presenceDe, trierParPresence, LIBELLE_COURT_PRESENCE } from '../lib/entonnoir.ts'
import type { Presence } from '../lib/presence.ts'
import { normaliser } from '../lib/doublons.ts'
import { dansFenetre, estFenetre, FENETRES, FENETRE_DEFAUT } from '../lib/fenetre.ts'
import { Repliable } from '../ui/Repliable.tsx'
import { Vide } from '../ui/Etats.tsx'
import { Input } from '../ui/Champs.tsx'
import { Button } from '../ui/Button.tsx'
import { IconePresence } from './Icones.tsx'

export const cleSection = (projetId: string, sectionId: string | null) => `${projetId}:${sectionId ?? 'sans'}`

type Avec = { c: Chantier; presence: Presence }

/**
 * « Tous les chantiers » d'un projet, sous le tableau de bord : une LIGNE
 * compacte par chantier (le sujet, et où il en est en mots), rangées par
 * section, repliées. Une ligne s'ouvre en conversation. Recherche, sélection
 * groupée, « Fini » et « Archives » à part.
 */
export function TousLesChantiers({ sectionOuverte, basculerSection, deplierTout, onNouveau }: {
  sectionOuverte: (cle: string) => boolean; basculerSection: (cle: string) => void
  deplierTout: (cles: string[] | null) => void; onNouveau: () => void
}) {
  const { chantiers, sections, activites, taches, enAttente, admin, now, silenceMs, prefs, projet, selection } = useCockpit()
  const [recherche, setRecherche] = useState('')
  const q = normaliser(recherche)
  const avec = useMemo<Avec[]>(() => chantiers.map((c) => ({ c, presence: presenceDe(c, activites, enAttente, now, silenceMs, taches).presence })),
    [chantiers, activites, taches, enAttente, now, silenceMs])
  const trouves = useMemo(() => q ? trierParPresence(avec.filter(({ c }) => normaliser(`${c.titre} ${c.demande ?? ''} ${c.resume_simple ?? ''}`).includes(q))) : [], [avec, q])
  const ouverts = trierParPresence(avec.filter(({ c }) => bacDe(c) === 'optimisation'))
  const finis = avec.filter(({ c }) => bacDe(c) === 'actif')
  const archives = avec.filter(({ c }) => bacDe(c) === 'archives')
  const fenetre = estFenetre(prefs.fenetre_livre) ? prefs.fenetre_livre : FENETRE_DEFAUT
  const libelleFenetre = FENETRES.find((f) => f.valeur === fenetre)?.libelle.toLowerCase() ?? ''
  const recents = finis.filter(({ c }) => dansFenetre(c.valide_at, fenetre, now)).length
  const groupes = grouper(ouverts, sections)
  const cles = groupes.map((gr) => cleSection(projet.id, gr.section?.id ?? null))
  const toutOuvert = cles.length > 0 && cles.every(sectionOuverte)
  const forcer = selection.actif  // on ne coche pas ce qu'on ne voit pas
  const lignes = (l: Avec[]) => <ul className="-mx-3 divide-y divide-bord/70">{l.map((x) => <LigneChantier key={x.c.id} {...x} />)}</ul>

  return (
    <section className="space-y-2" data-testid="tous-les-chantiers" aria-label="Tous les chantiers">
      <h2 className="flex items-center justify-between gap-2 px-1 text-[13px] font-medium uppercase tracking-wide text-texte-2">
        <span>Tous les chantiers <span className="tabular-nums">({chantiers.length})</span></span>
        {!q && cles.length ? (
          <Button taille="sm" variante="discret" onClick={() => deplierTout(toutOuvert ? null : cles)} data-testid="tout-deplier" className="normal-case tracking-normal">
            {toutOuvert ? 'Tout replier' : 'Tout déplier'}
          </Button>
        ) : null}
      </h2>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texte-2" aria-hidden />
        <Input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un chantier…" aria-label="Chercher" className="h-10 pl-9" />
      </div>

      {q ? (
        trouves.length ? <div className="rounded-2xl border border-bord bg-carte px-3">{lignes(trouves)}</div>
          : <Vide icone={<Search size={28} strokeWidth={1.5} />} titre="Rien ne correspond" texte="Essaie un autre mot." />
      ) : (
        <>
          {groupes.length ? groupes.map((gr) => {
            const cle = cleSection(projet.id, gr.section?.id ?? null)
            const compteurs = compteursPresence(gr.liste.map((x) => x.presence.code))
            return (
              <Repliable key={cle} testId="groupe-section" ouvert={forcer || sectionOuverte(cle)} onToggle={() => basculerSection(cle)}
                titre={<span className="truncate text-[15px] font-medium">{gr.section?.nom ?? 'Sans section'}</span>}
                badge={
                  <span className="flex items-center gap-2 text-xs" data-testid="compteurs-section"
                    aria-label={compteurs.map((x) => `${x.n} ${LIBELLE_COURT_PRESENCE[x.code]}`).join(', ')}>
                    {compteurs.map((x) => <span key={x.code} className="inline-flex items-center gap-0.5 tabular-nums" title={LIBELLE_COURT_PRESENCE[x.code]}><IconePresence code={x.code} taille={13} />{x.n}</span>)}
                  </span>
                }>
                {gr.section?.description ? <p className="mb-1 text-xs text-texte-2">{gr.section.description}</p> : null}
                {lignes(gr.liste)}
              </Repliable>
            )
          }) : (
            <Vide titre="Rien d’ouvert" texte={chantiers.length ? 'Tout ce qui était ouvert est fini.' : 'Aucun chantier sur ce projet pour l’instant.'}
              action={<Button variante="primaire" onClick={onNouveau}><Plus size={16} aria-hidden />Nouveau chantier</Button>} />
          )}
          <Repliable testId="bac-actif" ouvert={forcer || sectionOuverte(`${projet.id}:__actif`)} onToggle={() => basculerSection(`${projet.id}:__actif`)}
            titre={<span className="flex items-center gap-1.5 text-[15px] font-medium"><CircleCheck size={16} className="text-ok" aria-hidden />Fini (certifiés)</span>}
            badge={<span className="text-xs">{finis.length}{recents ? ` · ${recents} ${libelleFenetre}` : ''}</span>}>
            {finis.length ? lignes(finis) : <p className="text-sm text-texte-2">Aucun chantier certifié pour l’instant.</p>}
          </Repliable>
          {archives.length || admin ? (
            <Repliable testId="bac-archives" ouvert={forcer || sectionOuverte(`${projet.id}:__archives`)} onToggle={() => basculerSection(`${projet.id}:__archives`)}
              titre={<span className="flex items-center gap-1.5 text-[15px] font-medium text-texte-2"><Archive size={16} aria-hidden />Archives</span>} badge={<span className="text-xs">{archives.length}</span>}>
              {archives.length ? lignes(archives) : <p className="text-sm text-texte-2">Rien d’archivé (hors certifiés) et aucun doublon fusionné.</p>}
            </Repliable>
          ) : null}
        </>
      )}
    </section>
  )
}

/** Une ligne : [case à cocher] · icône de présence · le sujet · où il en est en mots · › — un toucher ouvre la conversation. */
function LigneChantier({ c, presence }: Avec) {
  const { selection, ouvrirChantier } = useCockpit()
  const coche = selection.ids.has(c.id)
  const details = [
    c.priorite === 'haute' ? 'priorité haute' : null,
    c.origine === 'session' ? 'lancé par Claude' : c.origine === 'utilisateur' ? 'demande d’un utilisateur' : null,
    c.doublon_de ? 'doublon fusionné' : null,
  ].filter(Boolean)
  return (
    <li data-testid="ligne-chantier" data-chantier={c.id} data-etat={c.etat} data-presence={presence.code} className={coche ? 'bg-carte-2' : ''}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        {selection.actif ? (
          <input type="checkbox" aria-label={`Choisir ${c.titre}`} checked={coche} onChange={() => selection.basculer(c.id)} className="h-5 w-5 shrink-0 accent-accent" />
        ) : null}
        <button type="button" onClick={() => ouvrirChantier(c.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" data-testid="ouvrir-chantier">
          <IconePresence code={presence.code} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-snug">{c.titre}</span>
            <span className="block truncate text-xs text-texte-2">
              <span data-testid="badge-presence">{presence.libelle}</span>{details.length ? ` · ${details.join(' · ')}` : ''}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-texte-2" aria-hidden />
        </button>
      </div>
    </li>
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
