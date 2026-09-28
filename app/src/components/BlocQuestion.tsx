import { useState } from 'react'
import type { Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'
import { dateRelative } from '../lib/dates.ts'
import { nomCourtSession } from '../lib/texte.ts'

/**
 * Une question (options cliquables + précision) ou une action (Fait / Pas
 * encore / Ça bloque) qui attend l'humain. Encadré rouge, toujours dépliée.
 */
export function BlocQuestion({ message }: { message: Message }) {
  const { par, recharger, now } = useCockpit()
  const toast = useToast()
  const [choix, setChoix] = useState<string | null>(null)
  const [precision, setPrecision] = useState('')
  const [enCours, setEnCours] = useState(false)
  const options = message.options ?? []
  const estAction = message.kind === 'action'

  const envoyer = async (reponse: string, etat?: 'fait' | 'pas_encore' | 'bloque') => {
    setEnCours(true)
    const { error } = await supabase.rpc('repondre_message', {
      p_id: message.id, p_par: par, p_reponse: reponse, p_precision: precision.trim() || null, p_etat: etat ?? null,
    })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(estAction ? 'État enregistré.' : 'Réponse enregistrée.')
    await recharger()
  }

  const valider = () => {
    const reponse = choix ?? precision.trim()
    if (!reponse) { toast.erreur(options.length ? 'Choisis une option, ou écris ta réponse.' : 'Écris ta réponse.'); return }
    void envoyer(reponse)
  }

  return (
    <div data-testid="bloc-question" className="rounded-xl border-2 border-alerte/60 bg-alerte/6 p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-texte-2">
        <span>{estAction ? '🙋 Action attendue de toi' : '🔴 Question'} · {nomCourtSession(message.auteur)}</span>
        <span>{dateRelative(message.created_at, now)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[15px] font-semibold leading-snug">{message.corps}</p>
      {message.pourquoi ? <p className="mt-1 whitespace-pre-wrap text-sm text-texte-2"><span className="font-medium">Pourquoi :</span> {message.pourquoi}</p> : null}

      {estAction ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button variante="ok" chargement={enCours} onClick={() => envoyer('Fait', 'fait')}>✅ Fait</Button>
          <Button chargement={enCours} onClick={() => envoyer('Pas encore', 'pas_encore')}>🕒 Pas encore</Button>
          <Button variante="danger" chargement={enCours} onClick={() => envoyer('Ça bloque', 'bloque')}>⛔ Ça bloque</Button>
        </div>
      ) : (
        <>
          {options.length ? (
            <div className="mt-3 flex flex-col gap-2" role="radiogroup">
              {options.map((o) => (
                <button key={o.libelle} type="button" role="radio" aria-checked={choix === o.libelle} onClick={() => setChoix(o.libelle)}
                  className={`min-h-12 rounded-xl border-2 px-3 py-2.5 text-left transition ${choix === o.libelle ? 'border-accent bg-accent/10' : 'border-bord bg-carte'}`}>
                  <span className="font-semibold">{o.libelle}</span>
                  {o.recommande ? <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">★ recommandé</span> : null}
                  {o.aide ? <span className="mt-0.5 block text-sm text-texte-2">{o.aide}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <Textarea className="mt-2" rows={2} value={precision} onChange={(e) => setPrecision(e.target.value)}
            placeholder={options.length ? 'Une précision, si tu veux (facultatif)' : 'Ta réponse'} />
          <Button variante="primaire" taille="lg" pleine className="mt-2" chargement={enCours} onClick={valider} data-testid="valider-reponse">✅ Valider cette réponse</Button>
        </>
      )}
      {estAction && message.etat ? <p className="mt-2 text-xs text-texte-2">Dernier état : {message.etat === 'pas_encore' ? 'pas encore' : message.etat}{message.answered_at ? '' : ' — la session attend « fait »'}</p> : null}
    </div>
  )
}
