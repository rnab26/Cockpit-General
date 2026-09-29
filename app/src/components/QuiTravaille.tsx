import { useState } from 'react'
import { Bot, CircleCheck, Terminal } from 'lucide-react'
import { useCockpit, useGlobal } from '../contexte.ts'
import { vueTache, tacheEnCoursVivante, activiteDeTache, type VueSession, type VueTache } from '../lib/sessions.ts'
import type { Activite } from '../lib/types.ts'
import { Progression } from './Progression.tsx'
import { PointTravaille, useFlash } from './Vivant.tsx'

/**
 * Le détail « qui travaille » : une conversation Claude Code (session) et ce
 * qu'elle a lancé (assistants, commandes). Replié sous « Ça avance tout
 * seul » (qui, lui, montre une ligne par CHANTIER) ; et sur la conversation
 * d'un chantier, les assistants qui y travaillent.
 */

/** Au-delà, « Voir les N autres tâches » : une session peut lancer dix agents, le premier écran doit rester lisible. */
export const TACHES_VISIBLES = 3

export function BlocSession({ vs, projetId }: { vs: VueSession; projetId: string }) {
  const [toutes, setToutes] = useState(false)
  const taches = toutes ? vs.taches : vs.taches.slice(0, TACHES_VISIBLES)
  const cachees = vs.taches.length - taches.length
  return (
    <div data-testid="session-active" data-session={vs.session.id} className={`rounded-xl border border-bord bg-carte px-2.5 py-2 ${vs.pause ? 'border-l-4 border-l-attention/70' : ''}`}>
      <p className="truncate text-sm font-medium" title={vs.titre}>{vs.titre}</p>
      {vs.pause ? (
        <div data-testid="session-en-pause">
          <p className="text-xs font-medium leading-snug text-attention" data-testid="etat-session">{vs.pause}</p>
          {vs.pauseDetail ? <p className="truncate text-[11px] text-texte-2" title={vs.pauseDetail}>{vs.pauseDetail}</p> : null}
        </div>
      ) : (
        <p className="truncate text-xs text-texte-2">
          <span className={vs.repond ? 'font-medium text-ok' : ''} data-testid="etat-session">{vs.repond ? 'répond en ce moment' : vs.titre.startsWith('Session autonome') ? 'en veille — se réveille toute seule chaque heure' : 'attend ton prochain message'}</span>
          {' · '}{vs.dernierSigne}
        </p>
      )}
      {vs.activites.length || vs.taches.length ? (
        <ul className="mt-1.5 space-y-1.5 border-l-2 border-bord pl-2">
          {vs.activites.map((a) => <li key={a.id}><LigneActivite a={a} projetId={projetId} /></li>)}
          {taches.map((v) => <li key={v.tache.id}><LigneTache v={v} projetId={projetId} enPause={!!vs.pause} /></li>)}
          {cachees > 0 ? <li><button type="button" className="text-xs font-medium text-accent" onClick={() => setToutes(true)} data-testid="voir-taches">Voir les {cachees} autres tâches</button></li> : null}
        </ul>
      ) : null}
      {vs.finies.length ? (
        <details className="mt-1 text-xs text-texte-2" data-testid="taches-finies">
          <summary className="cursor-pointer select-none">{vs.finies.length} fini{vs.finies.length > 1 ? 's' : ''} récemment</summary>
          <ul className="mt-0.5 space-y-0.5">
            {vs.finies.map((f) => <li key={f.tache.id} className="flex items-center gap-1 truncate"><CircleCheck size={12} className="shrink-0 text-ok" aria-hidden />fini {f.quand} — {f.libelle}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

/** Une barre de chantier vivante de la session : un toucher ouvre la conversation du chantier. */
function LigneActivite({ a, projetId }: { a: Activite; projetId: string }) {
  const g = useGlobal()
  const chantier = a.chantier_id ? g.chantiers.find((c) => c.id === a.chantier_id) ?? null : null
  return (
    <button type="button" data-testid="ligne-session-chantier" onClick={() => chantier && g.ouvrirChantier(projetId, chantier.id)} className="block w-full text-left">
      <span className="block truncate text-sm">{chantier?.titre ?? a.detail ?? 'Travail sans chantier'}</span>
      <Progression activite={a} vive compact now={g.now} />
    </button>
  )
}

/**
 * Un assistant (agent) ou une commande en cours : ce qu'il fait, depuis quand,
 * et — SI il l'a signalé — son étape, sa barre et le temps restant. Sinon
 * « avancement non signalé », en gris : jamais une barre inventée.
 */
export function LigneTache({ v, projetId, sansChantier = false, enPause = false }: { v: VueTache; projetId: string; sansChantier?: boolean; enPause?: boolean }) {
  const g = useGlobal()
  const t = v.tache
  const vivant = !enPause && !!t.progres_at && g.now.getTime() - Date.parse(t.progres_at) < g.silenceMs
  const flash = useFlash(t.progres_at ? `${t.progres_at}|${t.pourcentage}|${t.etape}` : null)
  const I = t.type === 'commande' ? Terminal : Bot
  return (
    <div data-testid="tache" data-tache={t.id} data-signale={v.signale ? 'oui' : 'non'} data-flash={flash ? 'oui' : 'non'} className={`rounded-lg text-sm ${flash ? 'flash-etape' : ''}`}>
      <p className="flex items-center gap-1.5">
        <I size={15} aria-hidden className="shrink-0 text-texte-2" />
        <span className="min-w-0 flex-1 truncate leading-snug" title={v.libelle}>{v.libelle}</span>
        {vivant ? <PointTravaille /> : null}
        <span className="shrink-0 text-xs tabular-nums text-texte-2">{v.signale ? `depuis ${v.duree}` : ''}</span>
      </p>
      {v.chantier && !sansChantier ? (
        <button type="button" onClick={() => g.ouvrirChantier(projetId, v.chantier!.id)} className="block max-w-full truncate text-xs font-medium text-accent underline-offset-2 hover:underline">
          {v.chantier.titre}
        </button>
      ) : null}
      {v.signale && v.pourcentage != null ? <Progression activite={activiteDeTache(t, g.now)} vive={vivant} compact now={g.now} />
        : v.signale ? <p className="text-xs text-texte-2">{t.etape ? `étape : ${t.etape}` : 'a donné signe de vie'}{v.reste ? ` · reste ${v.reste}` : ''} · avancement en % non signalé</p>
        : <p className="text-xs text-texte-2/80">depuis {v.duree} · <span data-testid="non-signale">avancement non signalé</span></p>}
    </div>
  )
}

/** Dans la conversation d'un chantier : les assistants et commandes en cours qui y travaillent. */
export function TachesDuChantier({ chantierId }: { chantierId: string }) {
  const { taches, chantiers, now, projet } = useCockpit()
  const liste = taches.filter((t) => t.chantier_id === chantierId && tacheEnCoursVivante(t, now))
  if (!liste.length) return null
  return (
    <div className="space-y-1.5" data-testid="taches-du-chantier">
      {liste.map((t) => <LigneTache key={t.id} v={vueTache(t, chantiers, now)} projetId={projet.id} sansChantier />)}
    </div>
  )
}
