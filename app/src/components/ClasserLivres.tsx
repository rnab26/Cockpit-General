import { useState } from 'react'
import { Archive } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import type { ElementAToi } from '../lib/entonnoir.ts'
import { DELAIS_CLASSEMENT, idsAClasser, joursDeSaisie, libelleDelai, phraseClasses, titreConfirmation } from '../lib/classerLivres.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Button } from '../ui/Button.tsx'

/**
 * Sous la liste « livrés à tester » (13 oct. 2026, migration 0079) : « Classer sans test » d'un geste (confirmation, puis
 * « Annuler » pendant 10 s), et — dans la vue d'un projet — le classement automatique après N jours sans un mot de ta
 * part. Jamais « certifié » : le chantier garde son état et part aux archives, « Désarchiver » le rend. Réservé à l'admin.
 */
export function ClasserLivres({ elements, projetId }: { elements: ElementAToi[]; projetId: string | null }) {
  const g = useGlobal()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [enCours, setEnCours] = useState(false)
  const [reglage, setReglage] = useState(false)
  if (!g.admin) return null
  const ids = idsAClasser(elements)
  const projet = projetId ? g.projets.find((p) => p.id === projetId) ?? null : null

  const annuler = async (liste: string[]) => {
    const { error } = await supabase.from('chantiers').update({ archived_at: null }).in('id', liste).eq('etat', 'a_verifier')
    if (error) { toast.erreur(`Pas remis : ${messageErreur(error)}`); return }
    toast.succes('Remis dans « À tester ».')
    await g.recharger()
  }
  const classer = async () => {
    const ok = await confirmer({
      titre: titreConfirmation(ids.length), libelleOk: 'Classer sans test',
      texte: <p>Ils ne sont pas certifiés : ils quittent « À tester » et partent aux archives, avec une ligne dans leur fil. Rien n’est supprimé, « Désarchiver » rouvre chacun d’eux.</p>,
    })
    if (!ok) return
    setEnCours(true)
    const { data, error } = await supabase.rpc('archiver_livres', { p_ids: ids, p_motif: 'jamais testé, classé d’un geste' })
    setEnCours(false)
    if (error) { toast.erreur(`Pas classés : ${messageErreur(error)}`); return }
    const n = Number((data as { classes?: number } | null)?.classes ?? 0)
    toast.avecAction(phraseClasses(n), { libelle: 'Annuler', onClick: () => void annuler(ids) }, 10_000)
    await g.recharger()
  }
  const regler = async (brut: string) => {
    if (!projet) return
    const jours = joursDeSaisie(brut)
    setReglage(true)
    const { error } = await supabase.rpc('regler_classement_livres', { p_projet: projet.slug, p_jours: jours })
    setReglage(false)
    if (error) { toast.erreur(`Réglage non enregistré : ${messageErreur(error)}`); return }
    toast.succes(jours ? `Classé tout seul après ${libelleDelai(jours)} sans un mot de ta part.` : 'Plus de classement automatique.')
    await g.rechargerProjets()
  }

  return (
    <div className="space-y-2 rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="classer-livres">
      <Button taille="sm" chargement={enCours} disabled={!ids.length} onClick={() => void classer()} data-testid="classer-livres-bouton" className="w-full">
        <Archive size={15} aria-hidden />Classer ces {ids.length} sans test
      </Button>
      {projet ? (
        <label className="flex items-center gap-2 text-sm text-texte-2">
          <span className="flex-1">Classer tout seul ceux que tu n’as pas touchés après</span>
          <select value={projet.livres_classes_apres_j ?? ''} disabled={reglage} onChange={(e) => void regler(e.target.value)} aria-label="Classement automatique des livrés" data-testid="classer-livres-delai"
            className="h-9 rounded-lg border border-bord bg-carte px-2 text-texte">
            {DELAIS_CLASSEMENT.map((j) => <option key={j ?? 'jamais'} value={j ?? ''}>{libelleDelai(j)}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  )
}
