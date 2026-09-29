import { useState } from 'react'
import type { Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { Repliable } from '../ui/Repliable.tsx'
import { ICONE_AUTEUR, LIBELLE_KIND } from '../lib/etats.ts'
import { dateRelative, dateLongue } from '../lib/dates.ts'
import { extrait, nomCourtSession } from '../lib/texte.ts'
import { mediasDe } from '../lib/medias.ts'
import { MediasMessage } from './Medias.tsx'

/**
 * Le fil d'un chantier, ULTRA condensé (demande de Raphaël : « trop de
 * pollution visuelle ») : replié sur une ligne qui dit le DERNIER message en
 * extrait, une ligne par message une fois ouvert, le texte entier au tap.
 * Vide : rien du tout (29 sept. : « 0 message » replié lui faisait croire
 * qu'on attendait quelque chose). Écrire passe par « ✍️ Écrire à Claude »,
 * toujours visible sur la carte — une seule façon d'écrire.
 */
export function Fil({ messages }: { chantierId?: string; messages: Message[] }) {
  const { now } = useCockpit()
  const [ouvertId, setOuvertId] = useState<string | null>(null)
  const dernier = messages[messages.length - 1]
  if (!dernier) return null

  return (
    <Repliable testId="fil"
      titre={<span className="min-w-0 truncate text-sm"><span className="font-bold">💬 {messages.length}</span> <span className="font-normal text-texte-2">· {ICONE_AUTEUR[dernier.auteur_type] ?? ''} « {extrait(dernier.corps, 60)} »</span></span>}
      badge={<span className="text-xs">{dateRelative(dernier.created_at, now)}</span>}>
      <ul className="divide-y divide-bord/60">
        {messages.map((m) => {
          const ouvert = ouvertId === m.id
          const medias = mediasDe(m)
          return (
            <li key={m.id}>
              <button type="button" onClick={() => setOuvertId(ouvert ? null : m.id)} className="flex w-full items-baseline gap-2 py-1.5 text-left text-sm">
                <span aria-hidden>{ICONE_AUTEUR[m.auteur_type] ?? '•'}</span>
                <span className="shrink-0 text-xs font-semibold uppercase text-texte-2">{LIBELLE_KIND[m.kind] ?? m.kind}</span>
                <span className={`min-w-0 flex-1 ${ouvert ? 'whitespace-pre-wrap' : 'truncate'}`}>{ouvert ? m.corps : extrait(m.corps, 90)}</span>
                {medias.length && !ouvert ? <span className="shrink-0 text-xs text-texte-2" aria-label={`${medias.length} pièce(s) jointe(s)`}>📎{medias.length}</span> : null}
                <span className="shrink-0 text-xs text-texte-2" title={dateLongue(m.created_at)}>{dateRelative(m.created_at, now)}</span>
              </button>
              {medias.length ? <div className="mb-1.5 pl-6"><MediasMessage medias={medias} petit={!ouvert} /></div> : null}
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
    </Repliable>
  )
}
