import { useState } from 'react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'
import { EncadreCommentVerifier } from './CommentVerifier.tsx'

/** Encadré orange d'un chantier « à vérifier » : certifier, ou corriger (mots obligatoires). */
export function BlocValidation({ chantier }: { chantier: Chantier }) {
  const { par, recharger } = useCockpit()
  const toast = useToast()
  const [mode, setMode] = useState<'choix' | 'certifier' | 'corriger'>('choix')
  const [mots, setMots] = useState('')
  const [enCours, setEnCours] = useState(false)

  const certifier = async () => {
    setEnCours(true)
    const { error } = await supabase.rpc('certifier_chantier', { p_id: chantier.id, p_par: par, p_mots: mots.trim() || null })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${chantier.titre} » certifié. Il passe dans ✅ Actif.`)
    await recharger()
  }
  const corriger = async () => {
    if (!mots.trim()) { toast.erreur('Dis ce qui ne marche pas : c’est ce que la session lira.'); return }
    setEnCours(true)
    const { error } = await supabase.rpc('corriger_chantier', { p_id: chantier.id, p_par: par, p_mots: mots.trim() })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes('Correction envoyée : le chantier revient à la session.')
    setMots(''); setMode('choix')
    await recharger()
  }

  return (
    <div data-testid="bloc-validation" className="rounded-xl border-2 border-attention/60 bg-attention/8 p-3">
      <p className="text-sm font-semibold text-attention">🧪 Livré par la session : à toi de dire si ça marche.</p>
      <div className="mt-2"><EncadreCommentVerifier chantier={chantier} /></div>
      {mode === 'choix' ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variante="ok" taille="lg" onClick={() => setMode('certifier')} data-testid="btn-certifier">✅ Ça fonctionne, je certifie</Button>
          <Button variante="attention" taille="lg" onClick={() => setMode('corriger')} data-testid="btn-corriger">✏️ Ça ne marche pas, corriger</Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <Textarea autoFocus rows={3} value={mots} onChange={(e) => setMots(e.target.value)}
            placeholder={mode === 'certifier' ? 'Tes mots (facultatif) : « testé sur mon téléphone, nickel »' : 'Ce qui ne marche pas, précisément (obligatoire)'} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setMode('choix'); setMots('') }}>Annuler</Button>
            {mode === 'certifier'
              ? <Button variante="ok" chargement={enCours} onClick={certifier}>✅ Je certifie</Button>
              : <Button variante="attention" chargement={enCours} onClick={corriger}>✏️ Envoyer la correction</Button>}
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
    <div className="rounded-xl border border-attention/50 p-3">
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
