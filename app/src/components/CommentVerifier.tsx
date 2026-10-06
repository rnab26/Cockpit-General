import { useMemo, useState } from 'react'
import { CircleHelp, ExternalLink, ListChecks } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { corpsDemandeVerifier, derniereDemandeVerifier, etapesVerifier, liensAOuvrir, segmentsAvecLiens } from '../lib/commentVerifier.ts'
import { dateRelative } from '../lib/dates.ts'
import { mediasVerifier } from '../lib/medias.ts'
import { MediasMessage } from './Medias.tsx'

/** 0020 : « voici ce que tu dois voir » — les images jointes par la session. */
function CeQueTuDoisVoir({ chantier }: { chantier: Chantier }) {
  const medias = mediasVerifier(chantier)
  if (!medias.length) return null
  return (
    <div className="mt-2" data-testid="images-verifier">
      <p className="mb-1 text-xs font-medium text-texte-2">Ce que tu dois voir :</p>
      <MediasMessage medias={medias} apercu testId="images-verifier-liste" />
    </div>
  )
}

/** Un texte dont les adresses http(s) deviennent des liens (nouvel onglet). */
function TexteAvecLiens({ texte }: { texte: string }) {
  return <>{segmentsAvecLiens(texte).map((s, i) => s.lien
    ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-accent underline underline-offset-2">{s.texte}</a>
    : <span key={i}>{s.texte}</span>)}</>
}

/** Les liens du texte en boutons : un toucher, pas de recherche dans les étapes. */
function LiensAOuvrir({ texte }: { texte: string }) {
  const liens = useMemo(() => liensAOuvrir(texte), [texte])
  if (!liens.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-testid="liens-verifier">
      {liens.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" data-testid="lien-verifier"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-3 text-sm font-medium text-accent">
          <ExternalLink size={16} aria-hidden />{l.libelle}
        </a>
      ))}
    </div>
  )
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
      <div data-testid="comment-verifier" className="rounded-lg border border-bord bg-carte px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-medium"><ListChecks size={16} className="text-texte-2" aria-hidden />Comment vérifier</p>
        <LiensAOuvrir texte={texte} />
        <Etapes texte={texte} />
        <CeQueTuDoisVoir chantier={chantier} />
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
    <div data-testid="comment-verifier-vide" className="rounded-lg border border-dashed border-bord bg-carte px-3 py-2">
      <p className="text-sm">La session n’a pas dit comment vérifier. Demande-lui avant de certifier :</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button taille="sm" chargement={enCours} onClick={demander} data-testid="btn-demander-verifier">
          <CircleHelp size={16} aria-hidden />{deja ? 'Redemander comment vérifier' : 'Demander comment vérifier'}
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
    <Repliable testId="comment-verifier-replie" titre={<span className="flex items-center gap-1.5 text-sm font-medium"><ListChecks size={16} className="text-texte-2" aria-hidden />Comment vérifier</span>}>
      <LiensAOuvrir texte={texte} />
        <Etapes texte={texte} />
      <CeQueTuDoisVoir chantier={chantier} />
    </Repliable>
  )
}
