import { Pause, Plug } from 'lucide-react'
import { useState } from 'react'
import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { enPause, groupesPause, PAUSE_ARRETE, PAUSE_GARDE, phraseEnCours, phraseEtat, projetTravaille, resumePauses } from '../lib/pause.ts'

/**
 * Réglages du projet › « Branché / En pause » (0093). Un interrupteur : en pause, aucune session ni agent ne travaille sur le
 * projet (ni chef, ni renfort, ni réveil, ni prise de chantier) ; rien n'est supprimé. Mettre en pause demande une confirmation
 * qui dit ce qui s'arrête ; rallumer est direct. Chaque geste dit s'il a réussi ou échoué, et propose « Annuler » d'un toucher.
 * Admin seulement (regler_pause_projet le vérifie aussi).
 */
export function PauseProjet({ projet }: { projet: Projet }) {
  const { admin, now, chantiers, taches, rechargerProjets } = useGlobal()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [enCours, setEnCours] = useState(false)
  if (!admin) return null
  const pause = enPause(projet)

  const regler = async (vers: boolean): Promise<boolean> => {
    setEnCours(true)
    const { error } = await supabase.rpc('regler_pause_projet', { p_projet: projet.slug, p_pause: vers, p_raison: null })
    setEnCours(false)
    if (error) { toast.erreur(`${vers ? 'Mise en pause' : 'Rallumage'} de ${projet.nom} non enregistré : ${messageErreur(error)}`); return false }
    await rechargerProjets()
    return true
  }
  const mettreEnPause = async () => {
    const travaille = projetTravaille(chantiers, taches, projet.id, now)
    const ok = await confirmer({
      titre: `Mettre ${projet.nom} en pause ?`,
      texte: (
        <div className="space-y-2" data-testid="pause-confirmation">
          <p>Ce qui s’arrête :</p>
          <ul className="list-disc space-y-0.5 pl-5">{PAUSE_ARRETE.map((l) => <li key={l}>{l}</li>)}</ul>
          <p>{phraseEnCours(travaille)}</p>
          <p>{PAUSE_GARDE}</p>
        </div>
      ),
      libelleOk: 'Mettre en pause',
    })
    if (!ok) return
    if (await regler(true)) toast.avecAction(`${projet.nom} est en pause : Claude ne travaille plus dessus.`, { libelle: 'Annuler', onClick: () => void rallumer(true) })
  }
  const rallumer = async (annulation = false) => {
    if (await regler(false)) {
      if (annulation) toast.succes(`${projet.nom} est de nouveau branché.`)
      else toast.avecAction(`${projet.nom} est de nouveau branché : Claude reprend.`, { libelle: 'Remettre en pause', onClick: () => void regler(true).then((ok) => { if (ok) toast.succes(`${projet.nom} est en pause.`) }) })
    }
  }

  return (
    <section className={`rounded-2xl border px-3 py-2.5 ${pause ? 'border-attention/50 bg-carte' : 'border-bord bg-carte'}`} data-testid="pause-projet" data-pause={pause ? 'oui' : 'non'}>
      <div className="flex items-center gap-2.5">
        {pause ? <Pause size={18} aria-hidden className="shrink-0 text-attention" /> : <Plug size={18} aria-hidden className="shrink-0 text-ok" />}
        <div className="min-w-0 flex-1 leading-snug">
          <p className={`text-sm font-semibold ${pause ? 'text-attention' : 'text-texte'}`} data-testid="pause-etat">{pause ? 'En pause' : 'Branché'}</p>
          <p className="text-xs text-texte-2" data-testid="pause-phrase">{phraseEtat(projet, now)}</p>
        </div>
        <button type="button" role="switch" aria-checked={!pause} aria-label={pause ? `Rallumer ${projet.nom}` : `Mettre ${projet.nom} en pause`} disabled={enCours}
          onClick={() => void (pause ? rallumer() : mettreEnPause())} data-testid="pause-interrupteur"
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition disabled:opacity-60 ${pause ? 'border-bord bg-carte-2' : 'border-ok bg-ok'}`}>
          <span aria-hidden className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${pause ? 'translate-x-1' : 'translate-x-6'}`} />
        </button>
      </div>
    </section>
  )
}

/**
 * Dans « Tout » › Réglages des projets : la liste des projets branchés et en pause d'un coup d'œil (un toucher ouvre le projet).
 * État vide : un seul projet ou aucun, une phrase.
 */
export function ListePauses() {
  const { projets, admin } = useGlobal()
  const liste = projets.filter((p) => p.actif)
  if (!admin) return null
  if (!liste.length) return <p className="text-xs text-texte-2" data-testid="pauses-vide">Aucun projet pour l’instant.</p>
  const g = groupesPause(liste)
  const ligne = (p: Projet) => (
    <li key={p.id} data-testid="pauses-ligne" data-projet={p.slug} data-pause={enPause(p) ? 'oui' : 'non'} className="flex items-center gap-2 py-1 text-sm">
      {enPause(p) ? <Pause size={15} aria-hidden className="shrink-0 text-attention" /> : <Plug size={15} aria-hidden className="shrink-0 text-ok" />}
      <span className="min-w-0 flex-1 truncate">{p.nom}</span>
      <span className={`text-xs ${enPause(p) ? 'text-attention' : 'text-texte-2'}`}>{enPause(p) ? 'en pause' : 'branché'}</span>
    </li>
  )
  return (
    <div data-testid="liste-pauses" className="space-y-1">
      <p className="text-xs font-medium text-texte-2" data-testid="pauses-resume">{resumePauses(liste)}</p>
      <ul className="divide-y divide-bord/60">{[...g.branches, ...g.enPause].map(ligne)}</ul>
    </div>
  )
}
