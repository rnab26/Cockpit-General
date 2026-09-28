import { useMemo, useState } from 'react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { corpsDemandeVerifier, derniereDemandeVerifier, etapesVerifier, segmentsAvecLiens } from '../lib/commentVerifier.ts'
import { dateRelative } from '../lib/dates.ts'

/** Un texte dont les adresses http(s) deviennent des liens (nouvel onglet). */
function TexteAvecLiens({ texte }: { texte: string }) {
  return <>{segmentsAvecLiens(texte).map((s, i) => s.lien
    ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-accent underline underline-offset-2">{s.texte}</a>
    : <span key={i}>{s.texte}</span>)}</>
}

/** Les étapes, une par ligne, le numéro dans sa propre colonne. */
function Etapes({ texte }: { texte: string }) {
  const etapes = useMemo(() => etapesVerifier(texte), [texte])
  return (
    <ol className="mt-1.5 space-y-1.5 text-[15px] leading-snug" data-testid="etapes-verifier">
      {etapes.map((e, i) => (
        <li key={i} data-testid="etape-verifier" className="flex gap-2">
          {e.numero ? <span className="w-5 shrink-0 text-right font-bold text-accent">{e.numero}.</span> : null}
          <span className="min-w-0 flex-1 break-words"><TexteAvecLiens texte={e.texte} /></span>
        </li>
      ))}
    </ol>
  )
}

/**
 * En tête du bloc orange « à vérifier » : ce que la session a écrit pour
 * dire QUOI vérifier. Vide : on le dit, et un bouton le lui demande dans le
 * fil (kind 'info', pour ne pas le ranger dans ses propres questions).
 */
export function EncadreCommentVerifier({ chantier }: { chantier: Chantier }) {
  const { admin, par, projet, messages, recharger } = useCockpit()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  const texte = chantier.comment_verifier?.trim()
  const deja = useMemo(() => derniereDemandeVerifier(messages.filter((m) => m.chantier_id === chantier.id), chantier.livre_at),
    [messages, chantier.id, chantier.livre_at])

  if (texte) {
    return (
      <div data-testid="comment-verifier" className="rounded-lg border border-accent/40 bg-carte px-3 py-2">
        <p className="text-sm font-semibold">👉 Comment vérifier</p>
        <Etapes texte={texte} />
      </div>
    )
  }

  const demander = async () => {
    setEnCours(true)
    const { error } = await supabase.from('messages').insert({
      projet_id: projet.id, chantier_id: chantier.id, auteur: par,
      auteur_type: admin ? 'proprietaire' : 'utilisateur', kind: 'info',
      corps: corpsDemandeVerifier(admin ? 'Raphaël' : par),
    })
    setEnCours(false)
    if (error) { toast.erreur(`La demande n’est pas partie : ${messageErreur(error)}`); return }
    toast.succes('Demande envoyée dans le fil : la session écrira les étapes.')
    await recharger()
  }

  return (
    <div data-testid="comment-verifier-vide" className="rounded-lg border border-dashed border-attention/60 bg-carte px-3 py-2">
      <p className="text-sm">La session n’a pas dit comment vérifier. Demande-lui avant de certifier :</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button taille="sm" chargement={enCours} onClick={demander} data-testid="btn-demander-verifier">
          {deja ? '❓ Redemander comment vérifier' : '❓ Demander comment vérifier'}
        </Button>
        {deja ? <span className="text-xs text-texte-2" data-testid="deja-demande">Déjà demandé {dateRelative(deja.created_at)}</span> : null}
      </div>
    </div>
  )
}

/** Sur un chantier certifié : les mêmes étapes, repliées, pour revérifier plus tard. */
export function CommentVerifierReplie({ chantier }: { chantier: Chantier }) {
  const texte = chantier.comment_verifier?.trim()
  if (!texte) return null
  return (
    <Repliable testId="comment-verifier-replie" titre={<span className="text-sm">👉 Comment vérifier</span>}>
      <Etapes texte={texte} />
    </Repliable>
  )
}
