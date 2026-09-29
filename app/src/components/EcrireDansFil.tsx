import { useState } from 'react'
import { useCockpit } from '../contexte.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'
import { resumeMedias } from '../lib/medias.ts'
import { ChoisirMedias, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'

/**
 * Écrire un message `info` dans le fil d'un chantier : le même geste pour le
 * fil d'une carte, une décision « à cadrer » et la réponse à un blocage.
 * Auteur : propriétaire si admin, sinon utilisateur. Photos, vidéos et
 * fichiers joints (0013) partent avec le message.
 */
export function EcrireDansFil({ chantierId, placeholder = 'Écrire un message dans le fil…', libelle = 'Envoyer', succes = 'Message ajouté au fil.', rows = 2, testId, aide }: {
  chantierId: string; placeholder?: string; libelle?: string; succes?: string; rows?: number; testId?: string; aide?: string
}) {
  const { par, admin, projet, recharger } = useCockpit()
  const toast = useToast()
  const [texte, setTexte] = useState('')
  const [enCours, setEnCours] = useState(false)

  const pj = useMediasAJoindre(projet.id, chantierId)
  const vide = !texte.trim() && !pj.medias.length

  const envoyer = async () => {
    if (vide || pj.enCours) return
    setEnCours(true)
    const erreur = await ecrireAvecMedias({ projetId: projet.id, chantierId, par, admin, corps: texte.trim() || `📎 ${resumeMedias(pj.medias)}`, medias: pj.medias })
    setEnCours(false)
    if (erreur) { toast.erreur(`Le message n’est pas parti : ${erreur}`); return }
    toast.succes(succes)
    setTexte('')
    pj.vider()
    await recharger()
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <Textarea rows={rows} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {aide ? <p className="text-xs leading-snug text-texte-2">{aide}</p> : null}
      <div className="flex items-end justify-between gap-2">
        <ChoisirMedias ctrl={pj} />
        <Button variante="primaire" taille="sm" chargement={enCours || pj.enCours} disabled={vide} onClick={envoyer} className="shrink-0" data-testid="envoyer-message">{libelle}</Button>
      </div>
    </div>
  )
}
