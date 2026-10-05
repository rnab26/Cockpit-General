import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquareText, Search, X } from 'lucide-react'
import { Button } from '../ui/Button.tsx'
import { useGlobal } from '../contexte.ts'
import { chercher } from '../lib/vueProjet.ts'
import { VUE_TOUT } from '../hooks/useDonnees.ts'
import { PointProjet } from './Icones.tsx'

/**
 * La loupe de l'en-tête (chantier 9cc71872) : un bouton qui déplie une barre de
 * recherche sous l'en-tête. Cherche dans les chantiers et les fils du projet
 * affiché (tous les projets dans « Tout »). Toucher un résultat ouvre le fil.
 * Échap ou « Fermer » : on quitte et on efface.
 */
export function BoutonLoupe({ ouvert, onToggle }: { ouvert: boolean; onToggle: () => void }) {
  return (
    <Button variante="discret" taille="sm" aria-label="Rechercher" aria-expanded={ouvert} onClick={onToggle} className="px-2" data-testid="loupe">
      <Search size={18} />
    </Button>
  )
}

export function BarreRecherche({ onFermer }: { onFermer: () => void }) {
  const g = useGlobal()
  const [q, setQ] = useState('')
  const champ = useRef<HTMLInputElement>(null)
  const projetId = g.vue === VUE_TOUT ? null : g.vue
  useEffect(() => { champ.current?.focus() }, [])
  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer() }
    document.addEventListener('keydown', touche)
    return () => document.removeEventListener('keydown', touche)
  }, [onFermer])
  const trouves = useMemo(() => chercher(q, g.chantiers, g.messages, projetId), [q, g.chantiers, g.messages, projetId])
  const projetDe = (id: string) => g.projets.find((p) => p.id === id)
  return (
    <div className="mx-auto max-w-3xl px-3 pb-2" data-testid="barre-recherche">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-texte-2" aria-hidden />
        <input ref={champ} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={projetId ? 'Chercher dans ce projet…' : 'Chercher dans tous les projets…'} aria-label="Rechercher"
          data-testid="recherche-champ" className="h-10 w-full rounded-full border border-bord bg-carte pl-9 pr-24 text-[15px] text-texte outline-none focus:border-accent" />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          {q ? <button type="button" onClick={() => { setQ(''); champ.current?.focus() }} aria-label="Effacer" data-testid="recherche-effacer" className="rounded-full p-1.5 text-texte-2 hover:bg-carte-2"><X size={15} /></button> : null}
          <button type="button" onClick={onFermer} data-testid="recherche-fermer" className="rounded-full px-2 py-1.5 text-xs font-medium text-texte-2 hover:bg-carte-2">Fermer</button>
        </div>
      </div>
      {q.trim() ? (
        trouves.length ? (
          <ul className="mt-2 max-h-[60vh] divide-y divide-bord/70 overflow-y-auto rounded-2xl border border-bord bg-carte" data-testid="recherche-resultats">
            {trouves.map((r) => {
              const p = projetDe(r.projetId)
              return (
                <li key={`${r.projetId}:${r.chantierId ?? 'projet'}`}>
                  <button type="button" data-testid="recherche-resultat" data-chantier={r.chantierId ?? ''}
                    onClick={() => { onFermer(); g.ouvrirChantier(r.projetId, r.chantierId) }}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-carte-2">
                    {r.chantierId ? null : <MessageSquareText size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{r.titre}</span>
                      {r.extrait ? <span className="block truncate text-xs text-texte-2">{r.extrait}</span> : null}
                    </span>
                    {!projetId && p ? <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-texte-2"><PointProjet couleur={p.couleur} />{p.nom}</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : <p className="mt-2 rounded-2xl border border-dashed border-bord px-3 py-4 text-center text-sm text-texte-2" data-testid="recherche-aucun">Rien ne correspond à « {q.trim()} ». Essaie un autre mot.</p>
      ) : <p className="mt-1.5 px-1 text-xs text-texte-2" data-testid="recherche-aide">Titre, demande ou message d’un fil.</p>}
    </div>
  )
}
