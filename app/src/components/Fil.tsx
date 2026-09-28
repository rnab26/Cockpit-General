import { useState } from 'react'
import type { Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { ICONE_AUTEUR, LIBELLE_KIND } from '../lib/etats.ts'
import { dateRelative, dateLongue } from '../lib/dates.ts'
import { extrait, nomCourtSession } from '../lib/texte.ts'

/**
 * Le fil d'un chantier, ULTRA condensé (demande de Raphaël : « trop de
 * pollution visuelle ») : replié sur une ligne, une ligne par message une
 * fois ouvert, le texte entier au tap.
 */
export function Fil({ chantierId, messages }: { chantierId: string; messages: Message[] }) {
  const { par, admin, projet, recharger } = useCockpit()
  const toast = useToast()
  const [ouvertId, setOuvertId] = useState<string | null>(null)
  const [texte, setTexte] = useState('')
  const [enCours, setEnCours] = useState(false)
  const dernier = messages[messages.length - 1]

  const envoyer = async () => {
    if (!texte.trim()) return
    setEnCours(true)
    const { error } = await supabase.from('messages').insert({
      projet_id: projet.id, chantier_id: chantierId, auteur: par,
      auteur_type: admin ? 'proprietaire' : 'utilisateur', kind: 'info', corps: texte.trim(),
    })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes('Message ajouté au fil.')
    setTexte('')
    await recharger()
  }

  return (
    <Repliable testId="fil"
      titre={<span className="text-sm">💬 {messages.length} message{messages.length > 1 ? 's' : ''}</span>}
      badge={dernier ? <span className="text-xs">dernier {dateRelative(dernier.created_at)}</span> : <span className="text-xs">aucun</span>}>
      <ul className="divide-y divide-bord/60">
        {messages.map((m) => {
          const ouvert = ouvertId === m.id
          return (
            <li key={m.id}>
              <button type="button" onClick={() => setOuvertId(ouvert ? null : m.id)} className="flex w-full items-baseline gap-2 py-1.5 text-left text-sm">
                <span aria-hidden>{ICONE_AUTEUR[m.auteur_type] ?? '•'}</span>
                <span className="shrink-0 text-xs font-semibold uppercase text-texte-2">{LIBELLE_KIND[m.kind] ?? m.kind}</span>
                <span className={`min-w-0 flex-1 ${ouvert ? 'whitespace-pre-wrap' : 'truncate'}`}>{ouvert ? m.corps : extrait(m.corps, 90)}</span>
                <span className="shrink-0 text-xs text-texte-2" title={dateLongue(m.created_at)}>{dateRelative(m.created_at)}</span>
              </button>
              {ouvert ? (
                <div className="mb-2 rounded-lg bg-carte-2 px-2.5 py-2 text-sm">
                  <div className="text-xs text-texte-2">{nomCourtSession(m.auteur)} · {dateLongue(m.created_at)}</div>
                  {m.pourquoi ? <p className="mt-1 whitespace-pre-wrap text-texte-2">Pourquoi : {m.pourquoi}</p> : null}
                  {m.reponse ? <p className="mt-1"><span className="font-semibold">Réponse :</span> {m.reponse}{m.precision ? ` — ${m.precision}` : ''}</p> : null}
                  {m.kind === 'action' && m.etat ? <p className="mt-1">État : {m.etat === 'pas_encore' ? 'pas encore' : m.etat}</p> : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <Textarea rows={2} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Écrire un message dans le fil…" />
        <div className="flex justify-end"><Button variante="primaire" taille="sm" chargement={enCours} disabled={!texte.trim()} onClick={envoyer}>Envoyer</Button></div>
      </div>
    </Repliable>
  )
}
