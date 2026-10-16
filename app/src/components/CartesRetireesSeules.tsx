import { useMemo, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Input } from '../ui/Champs.tsx'
import { PointProjet } from './Icones.tsx'
import { ageEtHeure, dateLongue } from '../lib/dates.ts'
import { extrait } from '../lib/texte.ts'
import { cartesRetireesSeules, delaiEpuration, delaiSaisi, phraseDelai, phraseRetirees, JOURS_RETIREES, type CarteRetiree } from '../lib/epuration.ts'
import type { Projet } from '../lib/types.ts'

/**
 * « 13 cartes retirées seules · Voir » (0092) : la preuve que le cockpit a fait le ménage tout seul, sous « À toi de jouer ».
 * Raphaël (16 oct. 2026) : « pourquoi est-ce que je devrais faire une action manuelle ? […] Je veux vraiment que ce soit automatisé. »
 * Rien à faire ici : la liste dit ce qui a été retiré et pourquoi, « Remettre » en ramène une, et le délai se règle en bas.
 * N'apparaît que s'il y en a eu ces 7 derniers jours (jamais une ligne vide de plus à l'écran).
 */
export function LigneRetireesSeules({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const [ouvert, setOuvert] = useState(false)
  const cartes = useMemo(
    () => cartesRetireesSeules(g.messages.filter((m) => !projetId || m.projet_id === projetId), g.chantiers, g.now),
    [g.messages, g.chantiers, g.now, projetId])
  if (!g.admin || cartes.length === 0) return null
  return (
    <>
      <button type="button" onClick={() => setOuvert(true)} data-testid="retirees-seules"
        className="mt-1.5 flex min-h-9 w-full items-center gap-1.5 px-1 text-left text-xs text-texte-2 underline-offset-2 hover:underline">
        <Check size={14} className="shrink-0 text-ok" aria-hidden />
        <span><span data-testid="retirees-seules-n">{phraseRetirees(cartes.length)}</span> · Voir</span>
      </button>
      <ListeRetireesSeules ouvert={ouvert} onFermer={() => setOuvert(false)} cartes={cartes} />
    </>
  )
}

function ListeRetireesSeules({ ouvert, onFermer, cartes }: { ouvert: boolean; onFermer: () => void; cartes: CarteRetiree[] }) {
  const g = useGlobal()
  const [remises, setRemises] = useState<ReadonlySet<string>>(new Set())
  const visibles = cartes.filter((c) => !remises.has(c.message.id))
  const plusieursProjets = g.projets.filter((p) => p.actif !== false).length > 1
  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre={`Retirées seules (${visibles.length})`}>
      <p className="mb-2 text-sm text-texte-2" data-testid="retirees-seules-aide">
        Ces cartes étaient restées sans réponse pendant que le travail continuait : elles n’attendent plus rien de toi (retirées ces {JOURS_RETIREES} derniers jours).
        « Remettre » en ramène une, et elle ne sera plus retirée toute seule. Le délai se règle dans les réglages de chaque projet.
      </p>
      {visibles.length ? (
        <ul className="divide-y divide-bord" data-testid="liste-retirees-seules">
          {visibles.map((c) => (
            <LigneRetiree key={c.message.id} c={c} avecProjet={plusieursProjets}
              onRemise={() => setRemises((s) => new Set(s).add(c.message.id))}
              onRevenue={() => setRemises((s) => { const n = new Set(s); n.delete(c.message.id); return n })} />
          ))}
        </ul>
      ) : <p className="py-2 text-sm text-texte-2" data-testid="retirees-seules-vide">Rien n’a été retiré seul ces {JOURS_RETIREES} derniers jours.</p>}
    </Dialog>
  )
}

function LigneRetiree({ c, avecProjet, onRemise, onRevenue }: { c: CarteRetiree; avecProjet: boolean; onRemise: () => void; onRevenue: () => void }) {
  const g = useGlobal()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  const projet = g.projets.find((p) => p.id === c.message.projet_id)
  const remettre = async () => {
    setEnCours(true)
    onRemise()                                           // elle quitte la liste tout de suite ; si la base refuse, elle revient
    const { error } = await supabase.rpc('restaurer_carte', { p_id: c.message.id })
    setEnCours(false)
    if (error) { onRevenue(); toast.erreur(`Carte pas remise, elle reste retirée : ${messageErreur(error)}`); return }
    toast.succes('Carte remise ✓ Elle ne sera plus retirée toute seule.')
    await g.recharger(true)
  }
  return (
    <li className="py-2.5" data-testid="ligne-retiree-seule">
      <p className="flex items-center gap-1.5 text-xs text-texte-2">
        {avecProjet ? <><PointProjet couleur={projet?.couleur} /><span className="truncate">{projet?.nom}</span><span>·</span></> : null}
        <span className="truncate">{c.chantier?.titre ?? 'Question sur le projet'}</span>
      </p>
      <p className="mt-0.5 text-[15px] leading-snug">{extrait(c.message.corps, 140)}</p>
      <p className="mt-0.5 text-sm text-texte-2" data-testid="raison-retiree">
        <span title={dateLongue(c.retireeAt)}>Retirée {ageEtHeure(c.retireeAt, g.now)}</span> : {c.raison}
      </p>
      <Button taille="sm" className="mt-1.5" chargement={enCours} onClick={() => void remettre()} data-testid="remettre-carte-liste"><RotateCcw size={14} aria-hidden />Remettre</Button>
    </li>
  )
}

/**
 * Réglages du projet › « Cartes déjà traitées » : le délai avant qu'une carte dépassée se retire seule, toujours accessible
 * (pas seulement après un premier retrait), avec la liste de ce qui l'a été. Admin seulement, comme les autres blocs automatiques.
 */
export function EpurationProjet({ projet }: { projet: Projet }) {
  const g = useGlobal()
  const n = useMemo(() => cartesRetireesSeules(g.messages.filter((m) => m.projet_id === projet.id), g.chantiers, g.now).length, [g.messages, g.chantiers, g.now, projet.id])
  if (!g.admin) return null
  return (
    <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="epuration-projet">
      <h3 className="text-sm font-semibold">Cartes déjà traitées</h3>
      <p className="mt-0.5 text-xs text-texte-2">
        Une question restée sans réponse pendant que le travail continue se retire toute seule, avec sa raison : tu n’as rien à faire, et tu peux la remettre d’un toucher.
      </p>
      <ReglageProjet p={projet} />
      {n === 0
        ? <p className="mt-1 text-xs text-texte-2" data-testid="epuration-rien">Rien n’a été retiré seul ces {JOURS_RETIREES} derniers jours.</p>
        : <LigneRetireesSeules projetId={projet.id} />}
    </section>
  )
}

/** Le délai d'un projet : un champ, « Enregistrer », un message qui dit si ça a marché (jamais un réglage muet). */
function ReglageProjet({ p }: { p: Projet }) {
  const g = useGlobal()
  const toast = useToast()
  const h = delaiEpuration(p)
  const [texte, setTexte] = useState(String(h))
  const [enCours, setEnCours] = useState(false)
  const saisi = delaiSaisi(texte)
  const enregistrer = async () => {
    if (saisi === null) { toast.erreur('Écris un nombre d’heures entre 0 et 720 (0 = ne jamais retirer seule).'); return }
    setEnCours(true)
    const { error } = await supabase.rpc('regler_epuration', { p_projet: p.slug, p_heures: saisi })
    setEnCours(false)
    if (error) { toast.erreur(`Réglage pas enregistré : ${messageErreur(error)}`); return }
    toast.succes(saisi === 0 ? `${p.nom} : plus aucune carte ne sera retirée toute seule ✓` : `${p.nom} : une question sans réponse depuis ${saisi} h se retire seule ✓`)
    await g.rechargerProjets()
  }
  return (
    <div className="mt-2" data-testid="reglage-epuration-projet" data-projet={p.slug}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Retirer une question restée sans réponse après</span>
        <Input className="!w-20" inputMode="numeric" aria-label={`Heures avant de retirer seule une carte de ${p.nom}`} value={texte}
          onChange={(e) => setTexte(e.target.value)} data-testid="epuration-heures" />
        <span className="text-sm text-texte-2">h</span>
        <Button taille="sm" chargement={enCours} disabled={saisi === null || saisi === h} onClick={() => void enregistrer()} data-testid="epuration-enregistrer">Enregistrer</Button>
      </div>
      <p className="mt-1 text-xs text-texte-2" data-testid="epuration-phrase">Maintenant : {phraseDelai(h)}. 0 = jamais. Une action (un geste à faire) attend 7 fois plus.</p>
    </div>
  )
}
