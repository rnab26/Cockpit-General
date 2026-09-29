import { useState } from 'react'
import { Check, FlaskConical, Pencil } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'
import { EncadreCommentVerifier } from './CommentVerifier.tsx'
import { FriseMiseEnLigne, PhraseMiseEnLigne } from './MiseEnLigne.tsx'
import { ChoisirMedias, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'

/**
 * Chantier « à vérifier » : certifier, ou corriger (mots obligatoires). Une
 * capture de ce qui ne marche pas (ou de ce qui marche) part dans le fil.
 */
export function BlocValidation({ chantier, sansEntete = false }: { chantier: Chantier; sansEntete?: boolean }) {
  const { par, admin, projet, recharger } = useCockpit()
  const toast = useToast()
  const [mode, setMode] = useState<'choix' | 'certifier' | 'corriger'>('choix')
  const [mots, setMots] = useState('')
  const [enCours, setEnCours] = useState(false)
  const pj = useMediasAJoindre(projet.id, chantier.id)
  /** Les médias partent juste après la décision ; renvoie false si leur envoi a échoué (le toast le dit). */
  const joindre = async (quoi: string) => {
    if (!pj.medias.length) return true
    const erreur = await ecrireAvecMedias({ projetId: projet.id, chantierId: chantier.id, par, admin, medias: pj.medias, corps: quoi })
    if (erreur) { toast.erreur(`Les fichiers ne sont pas partis : ${erreur}`); return false }
    pj.vider()
    return true
  }

  const certifier = async () => {
    if (pj.enCours) { toast.info('Un fichier est encore en cours d’envoi : un instant.'); return }
    setEnCours(true)
    const { error } = await supabase.rpc('certifier_chantier', { p_id: chantier.id, p_par: par, p_mots: mots.trim() || null })
    if (error) { setEnCours(false); toast.erreur(messageErreur(error)); return }
    const ok = await joindre('Capture jointe à la certification')
    setEnCours(false)
    if (ok) toast.succes(`« ${chantier.titre} » certifié. Il passe dans « Fini ».`)
    await recharger()
  }
  const corriger = async () => {
    if (!mots.trim()) { toast.erreur('Dis ce qui ne marche pas : c’est ce que la session lira.'); return }
    if (pj.enCours) { toast.info('Un fichier est encore en cours d’envoi : un instant.'); return }
    setEnCours(true)
    const { error } = await supabase.rpc('corriger_chantier', { p_id: chantier.id, p_par: par, p_mots: mots.trim() })
    if (error) { setEnCours(false); toast.erreur(messageErreur(error)); return }
    const ok = await joindre('Ce qui ne marche pas, en image')
    setEnCours(false)
    if (ok) toast.succes('Correction envoyée : le chantier revient à la session.')
    setMots(''); setMode('choix')
    await recharger()
  }

  return (
    <div data-testid="bloc-validation" className="rounded-2xl border border-l-4 border-bord border-l-attention bg-carte p-3">
      {sansEntete ? null : <p className="mb-2 flex items-center gap-1.5 text-[15px] font-medium"><FlaskConical size={16} className="text-attention" aria-hidden />C’est livré : à toi de tester</p>}
      <div className="space-y-2">
        <FriseMiseEnLigne chantier={chantier} />
        <EncadreCommentVerifier chantier={chantier} />
        <PhraseMiseEnLigne chantier={chantier} />
      </div>
      {mode === 'choix' ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variante="ok" taille="lg" onClick={() => setMode('certifier')} data-testid="btn-certifier"><Check size={18} aria-hidden />Ça marche</Button>
          <Button variante="attention" taille="lg" onClick={() => setMode('corriger')} data-testid="btn-corriger"><Pencil size={18} aria-hidden />Corriger</Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <Textarea autoFocus rows={3} value={mots} onChange={(e) => setMots(e.target.value)}
            placeholder={mode === 'certifier' ? 'Tes mots (facultatif) : « testé sur mon téléphone, nickel »' : 'Ce qui ne marche pas, précisément (obligatoire)'} />
          <ChoisirMedias ctrl={pj} testId="medias-validation" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setMode('choix'); setMots(''); pj.vider() }}>Annuler</Button>
            {mode === 'certifier'
              ? <Button variante="ok" chargement={enCours || pj.enCours} onClick={certifier}><Check size={16} aria-hidden />Je certifie</Button>
              : <Button variante="attention" chargement={enCours || pj.enCours} onClick={corriger}><Pencil size={16} aria-hidden />Envoyer la correction</Button>}
          </div>
        </div>
      )}
    </div>
  )
}

/** Sur un chantier certifié : un lien discret pour signaler un problème (même RPC corriger). */
export function SignalerProbleme({ chantier }: { chantier: Chantier }) {
  const { par, recharger } = useCockpit()
  const toast = useToast()
  const [ouvert, setOuvert] = useState(false)
  const [mots, setMots] = useState('')
  const [enCours, setEnCours] = useState(false)
  if (!ouvert) return <button type="button" className="text-sm text-texte-2 underline-offset-2 hover:underline" onClick={() => setOuvert(true)}>Signaler un problème</button>
  return (
    <div className="rounded-xl border border-bord border-l-4 border-l-attention p-3">
      <p className="text-sm font-semibold">Qu’est-ce qui ne marche plus ?</p>
      <Textarea className="mt-2" rows={3} autoFocus value={mots} onChange={(e) => setMots(e.target.value)} placeholder="Précisément, pour que la session puisse reproduire" />
      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={() => setOuvert(false)}>Annuler</Button>
        <Button variante="attention" chargement={enCours} onClick={async () => {
          if (!mots.trim()) { toast.erreur('Dis ce qui ne marche pas.'); return }
          setEnCours(true)
          const { error } = await supabase.rpc('corriger_chantier', { p_id: chantier.id, p_par: par, p_mots: mots.trim() })
          setEnCours(false)
          if (error) { toast.erreur(messageErreur(error)); return }
          toast.succes('Problème signalé : le chantier rouvre pour la session.')
          setOuvert(false); await recharger()
        }}>Envoyer</Button>
      </div>
    </div>
  )
}
