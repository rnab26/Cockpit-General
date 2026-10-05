import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Chantier, Etat, Priorite } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Button } from '../ui/Button.tsx'
import { Select } from '../ui/Champs.tsx'
import { ETATS, PRIORITES } from '../lib/etats.ts'

export const DUREE_ANNULATION_MS = 8000
type Champ = 'section_id' | 'priorite' | 'etat' | 'archived_at'

/**
 * Barre d'actions groupées (admin) : UNE requête `.in('id', ids)` par action,
 * toast « N chantiers modifiés — Annuler » 8 s ; l'annulation rend à chaque
 * chantier SA valeur d'avant (une requête par valeur d'origine).
 */
export function BarreSelection({ onQuitter }: { onQuitter: () => void }) {
  const { chantiers, sections, selection, recharger } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [enCours, setEnCours] = useState(false)
  const ids = [...selection.ids]
  const choisis = chantiers.filter((c) => selection.ids.has(c.id))

  const appliquer = async (champ: Champ, valeur: string | null, libelle: string) => {
    if (!ids.length) return
    const avant = new Map<string, string | null>(choisis.map((c) => [c.id, (c[champ] as string | null) ?? null]))
    setEnCours(true)
    const { error } = await supabase.from('chantiers').update({ [champ]: valeur } as Partial<Chantier>).in('id', ids)
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    await recharger()
    toast.avecAction(`${ids.length} chantier${ids.length > 1 ? 's' : ''} modifié${ids.length > 1 ? 's' : ''} (${libelle})`, {
      libelle: 'Annuler',
      onClick: async () => {
        const groupes = new Map<string | null, string[]>()
        for (const [id, v] of avant) groupes.set(v, [...(groupes.get(v) ?? []), id])
        for (const [v, liste] of groupes) {
          const { error: e2 } = await supabase.from('chantiers').update({ [champ]: v } as Partial<Chantier>).in('id', liste)
          if (e2) { toast.erreur(messageErreur(e2)); return }
        }
        toast.succes('Annulé : valeurs d’avant rétablies.'); await recharger()
      },
    }, DUREE_ANNULATION_MS)
  }

  const supprimer = async () => {
    const ok = await confirmer({ titre: `Supprimer ${ids.length} chantier${ids.length > 1 ? 's' : ''} ?`, danger: true, libelleOk: 'Supprimer',
      texte: <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm">{choisis.map((c) => <li key={c.id}>{c.titre}</li>)}</ul> })
    if (!ok) return
    setEnCours(true)
    const { error } = await supabase.from('chantiers').delete().in('id', ids)
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`${ids.length} chantier${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}.`); onQuitter(); await recharger()
  }

  return (
    <div data-testid="barre-selection" style={{ bottom: 'var(--nav-h, 0px)' }} className="fixed inset-x-0 z-40 border-t border-bord bg-carte px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 shadow-2xl">
      <div className="mx-auto flex max-w-3xl lg:max-w-5xl flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{ids.length} choisi{ids.length > 1 ? 's' : ''}</span>
          <Button taille="sm" onClick={onQuitter}>Terminer</Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Select aria-label="Section" disabled={!ids.length || enCours} value="" onChange={(e) => { if (e.target.value !== '') void appliquer('section_id', e.target.value === '__sans' ? null : e.target.value, 'section') }}>
            <option value="">Section…</option><option value="__sans">Sans section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </Select>
          <Select aria-label="Priorité" disabled={!ids.length || enCours} value="" onChange={(e) => { if (e.target.value) void appliquer('priorite', e.target.value as Priorite, 'priorité') }}>
            <option value="">Priorité…</option>{PRIORITES.map((p) => <option key={p.priorite} value={p.priorite}>{p.libelle}</option>)}
          </Select>
          <Select aria-label="État" disabled={!ids.length || enCours} value="" onChange={(e) => { if (e.target.value) void appliquer('etat', e.target.value as Etat, 'état') }}>
            <option value="">État…</option>{ETATS.map((x) => <option key={x.etat} value={x.etat}>{x.libelle}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button taille="sm" disabled={!ids.length} chargement={enCours} onClick={() => appliquer('archived_at', new Date().toISOString(), 'archivés')}><Archive size={15} aria-hidden />Archiver</Button>
          <Button taille="sm" disabled={!ids.length} chargement={enCours} onClick={() => appliquer('archived_at', null, 'désarchivés')}><ArchiveRestore size={15} aria-hidden />Désarchiver</Button>
          <Button taille="sm" variante="danger" disabled={!ids.length} chargement={enCours} onClick={supprimer}><Trash2 size={15} aria-hidden />Supprimer</Button>
        </div>
      </div>
    </div>
  )
}
