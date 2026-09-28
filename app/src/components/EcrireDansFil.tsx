import { useState } from 'react'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'

/**
 * Écrire un message `info` dans le fil d'un chantier : le même geste pour le
 * fil d'une carte, une décision « à cadrer » et la réponse à un blocage.
 * Auteur : propriétaire si admin, sinon utilisateur.
 */
export function EcrireDansFil({ chantierId, placeholder = 'Écrire un message dans le fil…', libelle = 'Envoyer', succes = 'Message ajouté au fil.', rows = 2, testId, aide }: {
  chantierId: string; placeholder?: string; libelle?: string; succes?: string; rows?: number; testId?: string; aide?: string
}) {
  const { par, admin, projet, recharger } = useCockpit()
  const toast = useToast()
  const [texte, setTexte] = useState('')
  const [enCours, setEnCours] = useState(false)

  const envoyer = async () => {
    if (!texte.trim()) return
    setEnCours(true)
    const { error } = await supabase.from('messages').insert({
      projet_id: projet.id, chantier_id: chantierId, auteur: par,
      auteur_type: admin ? 'proprietaire' : 'utilisateur', kind: 'info', corps: texte.trim(),
    })
    setEnCours(false)
    if (error) { toast.erreur(`Le message n’est pas parti : ${messageErreur(error)}`); return }
    toast.succes(succes)
    setTexte('')
    await recharger()
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <Textarea rows={rows} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <div className="flex items-center justify-between gap-2">
        {aide ? <p className="text-xs leading-snug text-texte-2">{aide}</p> : <span />}
        <Button variante="primaire" taille="sm" chargement={enCours} disabled={!texte.trim()} onClick={envoyer} className="shrink-0" data-testid="envoyer-message">{libelle}</Button>
      </div>
    </div>
  )
}
