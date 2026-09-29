import { useMemo, useState } from 'react'
import type { Chantier } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { ouJenSuis, type LigneOuJenSuis, type QuatreNombres } from '../lib/ouJenSuis.ts'
import { estFenetre, FENETRES, FENETRE_DEFAUT, type Fenetre } from '../lib/fenetre.ts'
import { infoEtat } from '../lib/etats.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { PastilleProjet } from './AvecProjet.tsx'

/**
 * « Où j'en suis » : la vue d'ensemble d'un coup d'œil — combien de chantiers
 * t'attendent, bougent, dorment, ont été livrés. Supprimée par la refonte en
 * entonnoir du 29 sept. et redemandée le jour même (« où est passée la vue
 * d'ensemble sur le nombre de chantiers, ce qui bouge, ce qui ne bouge pas »).
 * Onglet « Tout » : une ligne par projet ; vue d'un projet : une ligne par
 * section. Un nombre se touche : la liste de ses chantiers, chacun s'ouvre.
 */
const COLONNES: { cle: keyof QuatreNombres; libelle: string; aide: string }[] = [
  { cle: 'pourToi', libelle: 'pour toi', aide: 'une question, une action ou une vérification t’attend' },
  { cle: 'bouge', libelle: 'bouge', aide: 'une session l’a pris' },
  { cle: 'dort', libelle: 'dort', aide: 'libre, à trier ou à cadrer, personne dessus' },
  { cle: 'livre', libelle: 'livré', aide: 'certifié dans la période choisie' },
]
const TEINTE: Record<keyof QuatreNombres, string> = { pourToi: 'text-alerte', bouge: 'text-texte', dort: 'text-texte-2', livre: 'text-ok', expirees: 'text-attention' }

interface Ligne { cle: string; nom: string; projetId: string | null; nombres: QuatreNombres; ids: LigneOuJenSuis['ids'] }
interface Liste { titre: string; ids: string[]; n: number }

const vide = (): QuatreNombres => ({ pourToi: 0, bouge: 0, dort: 0, livre: 0, expirees: 0 })
const idsVides = (): LigneOuJenSuis['ids'] => ({ pourToi: [], bouge: [], dort: [], livre: [], expirees: [] })

export function VueEnsemble({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const [liste, setListe] = useState<Liste | null>(null)
  const fenetre: Fenetre = estFenetre(g.prefs.fenetre_livre) ? g.prefs.fenetre_livre : FENETRE_DEFAUT
  const libelleFenetre = FENETRES.find((f) => f.valeur === fenetre)?.libelle.toLowerCase() ?? ''

  const { lignes, total } = useMemo(() => {
    const resume = (pid: string) => ouJenSuis(
      g.sections.filter((s) => s.projet_id === pid), g.chantiers.filter((c) => c.projet_id === pid),
      g.messages.filter((m) => m.projet_id === pid), fenetre, g.now)
    if (projetId) {
      const r = resume(projetId)
      return {
        lignes: r.lignes.map((l): Ligne => ({ cle: l.section?.id ?? 'sans', nom: l.section?.nom ?? 'Sans section', projetId, nombres: l.nombres, ids: l.ids })),
        total: { nombres: r.total, ids: fusion(r.lignes.map((l) => l.ids)) },
      }
    }
    const lignesProjets = g.projets.filter((p) => p.actif).map((p): Ligne => {
      const r = resume(p.id)
      return { cle: p.id, nom: p.nom, projetId: p.id, nombres: r.total, ids: fusion(r.lignes.map((l) => l.ids)) }
    })
    const t = vide()
    for (const l of lignesProjets) for (const k of Object.keys(t) as (keyof QuatreNombres)[]) t[k] += l.nombres[k]
    return { lignes: lignesProjets, total: { nombres: t, ids: fusion(lignesProjets.map((l) => l.ids)) } }
  }, [g.sections, g.chantiers, g.messages, g.projets, g.now, fenetre, projetId])

  const changerFenetre = () => {
    const i = FENETRES.findIndex((f) => f.valeur === fenetre)
    void g.poser('fenetre_livre', FENETRES[(i + 1) % FENETRES.length].valeur)
  }
  const ouvrir = (nom: string, cle: keyof QuatreNombres, ids: string[], n: number) =>
    setListe({ titre: `${nom} · ${cle === 'expirees' ? 'réservations expirées' : COLONNES.find((c) => c.cle === cle)?.libelle ?? cle}`, ids, n })

  return (
    <section data-testid="ou-jen-suis" aria-label="Où j’en suis" className="rounded-2xl border border-bord bg-carte px-3 py-2">
      <div className="grid grid-cols-[1fr_repeat(4,2.75rem)] items-end gap-x-1 text-[11px] uppercase tracking-wide text-texte-2">
        <span className="pb-1 text-sm font-semibold normal-case tracking-normal text-texte">Où j’en suis</span>
        {COLONNES.map((c) => <span key={c.cle} className="pb-1 text-center leading-tight" title={c.aide}>{c.libelle}</span>)}
      </div>
      {lignes.map((l) => (
        <LigneNombres key={l.cle} nom={l.nom} nombres={l.nombres} onTap={(cle) => ouvrir(l.nom, cle, l.ids[cle], l.nombres[cle])}
          projet={projetId ? null : g.projets.find((p) => p.id === l.projetId) ?? null} />
      ))}
      {lignes.length > 1 ? <LigneNombres nom="Total" nombres={total.nombres} total onTap={(cle) => ouvrir(projetId ? 'Tout le projet' : 'Tous les projets', cle, total.ids[cle], total.nombres[cle])} /> : null}
      {lignes.length === 0 ? <p className="py-1 text-sm text-texte-2">Aucun chantier pour l’instant.</p> : null}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-texte-2">
        <button type="button" onClick={changerFenetre} data-testid="fenetre-ou-jen-suis" className="underline-offset-2 hover:underline">livré = {libelleFenetre} · changer</button>
        {total.nombres.expirees ? (
          <button type="button" className="text-attention underline-offset-2 hover:underline" data-testid="reservations-expirees"
            onClick={() => ouvrir(projetId ? 'Tout le projet' : 'Tous les projets', 'expirees', total.ids.expirees, total.nombres.expirees)}>
            {total.nombres.expirees} réservation{total.nombres.expirees > 1 ? 's' : ''} expirée{total.nombres.expirees > 1 ? 's' : ''}
          </button>
        ) : null}
      </div>
      <ListeChantiers liste={liste} onFermer={() => setListe(null)} />
    </section>
  )
}

function fusion(listes: LigneOuJenSuis['ids'][]): LigneOuJenSuis['ids'] {
  const r = idsVides()
  for (const l of listes) for (const k of Object.keys(r) as (keyof LigneOuJenSuis['ids'])[]) r[k].push(...l[k])
  return r
}

function LigneNombres({ nom, nombres, total, projet, onTap }: {
  nom: string; nombres: QuatreNombres; total?: boolean; projet?: Parameters<typeof PastilleProjet>[0]['projet']; onTap: (cle: keyof QuatreNombres) => void
}) {
  return (
    <div data-testid="ligne-ou-jen-suis" className={`grid grid-cols-[1fr_repeat(4,2.75rem)] items-center gap-x-1 border-t border-bord/70 ${total ? 'font-semibold' : ''}`}>
      <span className="flex min-w-0 items-center gap-1.5 truncate py-0.5 text-sm">
        {projet ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: projet.couleur ?? 'var(--accent)' }} /> : null}
        <span className="truncate">{nom}</span>
      </span>
      {COLONNES.map((c) => {
        const n = nombres[c.cle]
        return n ? (
          <button key={c.cle} type="button" onClick={() => onTap(c.cle)} aria-label={`${nom} : ${n} ${c.libelle}`} data-colonne={c.cle}
            className={`h-8 rounded-lg text-center text-base tabular-nums hover:bg-carte-2 ${total ? 'font-bold' : 'font-semibold'} ${TEINTE[c.cle]}`}>{n}</button>
        ) : <span key={c.cle} className="h-8 text-center text-base leading-8 text-texte-2/40">·</span>
      })}
    </div>
  )
}

/** La liste des chantiers derrière un nombre ; chacun s'ouvre dans la vue de son projet. */
function ListeChantiers({ liste, onFermer }: { liste: Liste | null; onFermer: () => void }) {
  const g = useGlobal()
  const chantiers = useMemo(() => {
    if (!liste) return []
    const ids = new Set(liste.ids)
    return g.chantiers.filter((c) => ids.has(c.id)).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  }, [liste, g.chantiers])
  return (
    <Dialog ouvert={!!liste} onFermer={onFermer} titre={`${liste?.titre ?? ''} (${liste?.n ?? 0})`}>
      {liste && liste.n > chantiers.length ? (
        <p className="mb-1 text-xs text-texte-2" data-testid="note-liste">Un chantier peut porter plusieurs choses à faire, et une question de projet n’a pas de chantier : tout est détaillé dans « À toi ».</p>
      ) : null}
      <ul className="divide-y divide-bord" data-testid="liste-ou-jen-suis">
        {chantiers.map((c: Chantier) => {
          const projet = g.projets.find((p) => p.id === c.projet_id)
          return (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center gap-2 py-2.5 text-left" data-testid="ligne-liste-ou-jen-suis"
                onClick={() => { onFermer(); g.ouvrirChantier(c.projet_id, c.id) }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{c.titre}</span>
                  <span className="flex items-center gap-1.5 text-xs text-texte-2">
                    {g.projets.length > 1 ? <PastilleProjet projet={projet} /> : null}
                    <span>{infoEtat(c.etat).court}</span>
                  </span>
                </span>
                <span aria-hidden className="text-texte-2">›</span>
              </button>
            </li>
          )
        })}
      </ul>
      {!chantiers.length && !liste?.n ? <p className="py-2 text-sm text-texte-2">Plus rien ici : la liste a changé entre-temps.</p> : null}
    </Dialog>
  )
}
