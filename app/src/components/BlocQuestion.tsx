import { useState } from 'react'
import { Ban, Check, Clock, Star } from 'lucide-react'
import type { Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'
import { TexteLong } from '../ui/TexteLong.tsx'
import { dateRelative } from '../lib/dates.ts'
import { extrait } from '../lib/texte.ts'
import { ChoisirMedias, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'

/**
 * Une question (options cliquables + précision) ou une action (Fait / Pas
 * encore / Ça bloque) qui attend l'humain : une bulle de la conversation.
 * Règle de clarté (29 sept.) : la question en gros, le pourquoi en petit
 * dessous, les réponses toutes prêtes bien visibles. Carte neutre avec un
 * liseré ; photos et fichiers joints partent dans le fil, sous la réponse.
 */
export function BlocQuestion({ message }: { message: Message }) {
  const { par, admin, projet, recharger, now } = useCockpit()
  const toast = useToast()
  const [choix, setChoix] = useState<string | null>(null)
  const [precision, setPrecision] = useState('')
  const [enCours, setEnCours] = useState(false)
  const options = message.options ?? []
  const estAction = message.kind === 'action'
  const pj = useMediasAJoindre(projet.id, message.chantier_id)

  const envoyer = async (reponse: string, etat?: 'fait' | 'pas_encore' | 'bloque') => {
    if (pj.enCours) { toast.info('Un fichier est encore en cours d’envoi : un instant.'); return }
    setEnCours(true)
    const { error } = await supabase.rpc('repondre_message', {
      p_id: message.id, p_par: par, p_reponse: reponse, p_precision: precision.trim() || null, p_etat: etat ?? null,
    })
    if (error) { setEnCours(false); toast.erreur(messageErreur(error)); return }
    let erreurMedias: string | null = null
    if (pj.medias.length) {
      erreurMedias = await ecrireAvecMedias({ projetId: projet.id, chantierId: message.chantier_id, par, admin, medias: pj.medias,
        corps: `Pièces jointes à ma réponse « ${extrait(reponse, 60)} » à : ${extrait(message.corps, 80)}` })
    }
    setEnCours(false)
    if (erreurMedias) toast.erreur(`Réponse enregistrée, mais les fichiers ne sont pas partis : ${erreurMedias}`)
    else toast.succes(`${estAction ? 'État enregistré' : 'Réponse enregistrée'}${pj.medias.length ? ' avec tes fichiers' : ''}.`)
    pj.vider()
    await recharger()
  }

  const valider = () => {
    const reponse = choix ?? precision.trim()
    if (!reponse) { toast.erreur(options.length ? 'Choisis une option, ou écris ta réponse.' : 'Écris ta réponse.'); return }
    void envoyer(reponse)
  }

  return (
    <div data-testid="bloc-question" className="rounded-2xl border border-l-4 border-bord border-l-alerte bg-carte p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-texte-2">
        <span className="font-medium text-alerte">{estAction ? 'Claude attend un geste de toi' : 'Claude te pose une question'}</span>
        <span>{dateRelative(message.created_at, now)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-base font-medium leading-snug">{message.corps}</p>
      {message.pourquoi ? <TexteLong texte={message.pourquoi} petit /> : null}

      {estAction ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button variante="ok" chargement={enCours} onClick={() => envoyer('Fait', 'fait')}><Check size={16} aria-hidden />Fait</Button>
          <Button chargement={enCours} onClick={() => envoyer('Pas encore', 'pas_encore')}><Clock size={16} aria-hidden />Pas encore</Button>
          <Button variante="attention" chargement={enCours} onClick={() => envoyer('Ça bloque', 'bloque')}><Ban size={16} aria-hidden />Ça bloque</Button>
        </div>
      ) : (
        <>
          {options.length ? (
            <div className="mt-3 flex flex-col gap-2" role="radiogroup">
              {options.map((o) => (
                <button key={o.libelle} type="button" role="radio" aria-checked={choix === o.libelle} onClick={() => setChoix(o.libelle)}
                  className={`min-h-12 rounded-xl border px-3 py-2.5 text-left transition ${choix === o.libelle ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-bord bg-carte hover:bg-carte-2'}`}>
                  <span className="font-medium">{o.libelle}</span>
                  {o.recommande ? <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-medium text-accent"><Star size={12} aria-hidden />recommandé</span> : null}
                  {o.aide ? <span className="mt-0.5 block text-sm text-texte-2">{o.aide}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <Textarea className="mt-2" rows={2} value={precision} onChange={(e) => setPrecision(e.target.value)}
            placeholder={options.length ? 'Une précision, si tu veux (facultatif)' : 'Ta réponse'} />
          <div className="mt-2"><ChoisirMedias ctrl={pj} testId="medias-reponse" /></div>
          <Button variante="primaire" taille="lg" pleine className="mt-2" chargement={enCours || pj.enCours} onClick={valider} data-testid="valider-reponse">Valider cette réponse</Button>
        </>
      )}
      {estAction ? <div className="mt-2"><ChoisirMedias ctrl={pj} testId="medias-reponse" /></div> : null}
      {estAction && message.etat ? <p className="mt-2 text-xs text-texte-2">Dernier état : {message.etat === 'pas_encore' ? 'pas encore' : message.etat}{message.answered_at ? '' : ' — la session attend « fait »'}</p> : null}
    </div>
  )
}
