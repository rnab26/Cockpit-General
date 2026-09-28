import { useMemo, useState } from 'react'
import type { Activite } from '../lib/types.ts'
import { useCockpit, useGlobal } from '../contexte.ts'
import { quiTravaille, resumeTravail, vueTache, tacheEnCoursVivante, activiteDeTache, type QuiTravaille, type VueSession, type VueTache } from '../lib/sessions.ts'
import { enCoursSansNouvelles, type LigneALancer } from '../lib/entonnoir.ts'
import { nomCourtSession } from '../lib/texte.ts'
import { dateRelative } from '../lib/dates.ts'
import { Progression } from './Progression.tsx'
import { AvecProjet, PastilleProjet } from './AvecProjet.tsx'
import { BoutonsRelance } from './Relance.tsx'
import { PointTravaille, useFlash } from './Vivant.tsx'

/**
 * « En ce moment » : TOUT ce qui est en cours, au même endroit (Raphaël, 29
 * sept. : « trois chantiers en cours, un affiché en haut, deux en bas […] je
 * veux voir tout ce qui progresse, ensemble, avec des titres clairs »).
 *  - ce qui travaille VRAIMENT (preuve de vie) : chantiers en cours, sessions
 *    Claude Code et leurs agents/commandes — barre animée, « ● travaille » ;
 *  - puis, en jaune et sans animation, les chantiers « en cours, mais plus de
 *    nouvelles » (pris et muets, ou barre figée), avec de quoi les relancer.
 * Le titre d'une ligne est le titre du CHANTIER ; la session est écrite en petit.
 */
export function EnCeMoment({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const ordre = useMemo(() => g.projets.map((p) => p.id), [g.projets])
  const vivants = useMemo(() => quiTravaille(g.sessions, g.taches, g.activites, g.chantiers, g.now, g.silenceMs, ordre, projetId),
    [g.sessions, g.taches, g.activites, g.chantiers, g.now, g.silenceMs, ordre, projetId])
  const muets = useMemo(() => enCoursSansNouvelles(g.chantiers, g.activites, g.messages, g.now, g.silenceMs, ordre, projetId, g.taches),
    [g.chantiers, g.activites, g.messages, g.now, g.silenceMs, ordre, projetId, g.taches])
  const resume = resumeTravail(vivants)
  const nMuets = muets.reduce((n, gr) => n + gr.lignes.length, 0)
  const projets = ordre.filter((id) => vivants.some((v) => v.projetId === id) || muets.some((m) => m.projetId === id))
  const personne = resume.sessions === 0
  const [aide, setAide] = useState(false)
  return (
    <section data-testid="en-ce-moment" aria-label="En ce moment" className={`scroll-mt-16 rounded-2xl border px-3 py-2 ${personne ? 'border-bord bg-carte' : 'border-ok/50 bg-ok/5'}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-texte-2">
          {personne ? null : <span className="point-vivant inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-ok" aria-hidden />}
          En ce moment
        </h2>
        <button type="button" data-testid="vocabulaire" aria-expanded={aide} onClick={() => setAide(!aide)} className="shrink-0 text-[11px] font-medium text-texte-2 underline-offset-2 hover:underline">
          ⓘ session ou agent ?
        </button>
      </div>
      {aide ? (
        <p className="mt-1 rounded-lg bg-carte-2 px-2 py-1.5 text-xs leading-snug text-texte-2" data-testid="vocabulaire-texte">Une <b>session</b> = une conversation Claude Code que tu as ouverte. Un <b>agent</b> = un assistant qu’une session lance pour l’aider, en parallèle. Une <b>commande</b> = un long calcul qu’elle fait tourner (tests, construction…).</p>
      ) : null}
      {personne ? (
        <div data-testid="personne-ne-travaille" className="mt-0.5">
          <p className="text-[15px] font-semibold">😴 Personne ne travaille {projetId ? 'sur ce projet ' : ''}en ce moment</p>
          <p className="mt-0.5 text-xs leading-snug text-texte-2">Pour faire avancer un chantier, ouvre-le dans « À lancer » et copie la consigne dans une session Claude du projet.</p>
        </div>
      ) : null}
      {!personne || nMuets ? (
        <p className="mt-0.5 text-sm font-bold leading-snug">
          {personne ? null : <span className="text-ok" data-testid="resume-travail">{resume.texte}</span>}
          {nMuets ? <span className="text-attention" data-testid="resume-sans-nouvelles">{personne ? '' : ' · '}🟡 {nMuets} sans nouvelles</span> : null}
        </p>
      ) : null}
      {projets.length ? (
        <div className="mt-1.5 space-y-2.5">
          {projets.map((pid) => {
            const v = vivants.find((x) => x.projetId === pid)
            const m = muets.find((x) => x.projetId === pid)
            return (
              <div key={pid} data-testid="groupe-en-ce-moment" className="space-y-1.5">
                {projetId ? null : (
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <PastilleProjet projet={g.projets.find((p) => p.id === pid)} className="max-w-[60%]" />
                    {projets.length > 1 && v ? <span className="truncate text-[11px] text-texte-2">{resumeTravail([v]).texte}</span> : null}
                  </div>
                )}
                {v ? <Vivants v={v} /> : null}
                {m ? (
                  <AvecProjet projetId={pid}>
                    <ListeSansNouvelles lignes={m.lignes} />
                  </AvecProjet>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Les « sans nouvelles » d'un projet : 3 visibles, le reste replié. Sinon, un
 * jour chargé (8 le 29 sept.), ils poussent « À toi » hors du premier écran de
 * téléphone — et ce qui attend Raphaël passe avant ce qui dort.
 */
const SANS_NOUVELLES_VISIBLES = 3
function ListeSansNouvelles({ lignes }: { lignes: Parameters<typeof LigneSansNouvelles>[0]['l'][] }) {
  const [tout, setTout] = useState(false)
  const visibles = tout ? lignes : lignes.slice(0, SANS_NOUVELLES_VISIBLES)
  const reste = lignes.length - visibles.length
  return (
    <>
      <ul className="space-y-1.5">{visibles.map((l) => <li key={l.c.id}><LigneSansNouvelles l={l} /></li>)}</ul>
      {reste > 0 ? (
        <button type="button" onClick={() => setTout(true)} data-testid="voir-sans-nouvelles"
          className="text-xs font-semibold text-attention underline-offset-2 hover:underline">
          Voir les {reste} autres sans nouvelles
        </button>
      ) : null}
    </>
  )
}

function Vivants({ v }: { v: QuiTravaille }) {
  return (
    <>
      {v.activitesSeules.map((a) => <LigneActivite key={a.id} a={a} projetId={v.projetId} />)}
      {v.sessions.map((vs) => <BlocSession key={vs.session.id} vs={vs} projetId={v.projetId} />)}
    </>
  )
}

/**
 * Un chantier en cours sans nouvelles : UNE ligne compacte, jaune et fixe
 * (jamais animée) — le titre, pourquoi il est jaune, le dernier avancement.
 * Les gestes de relance sont à un toucher (« Relancer ») : ils tiennent le
 * premier écran libre pour ce qui travaille et ce qui t'attend.
 */
function LigneSansNouvelles({ l }: { l: LigneALancer }) {
  const { ouvrirChantier, now } = useCockpit()
  const [relance, setRelance] = useState(false)
  const a = l.activite
  const pourquoi = l.presence.code === 'silencieux' ? 'Pris, mais silencieux' : 'Personne dessus'
  const dernier = a ? ` · ${a.pourcentage} % ${dateRelative(a.updated_at, now)}` : ''
  return (
    <div data-testid="ligne-sans-nouvelles" data-ligne-chantier={l.c.id} className="rounded-xl border border-attention/40 bg-attention/5 px-2.5 py-1">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => ouvrirChantier(l.c.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold">🟡 {l.c.titre}</span>
          <span className="block truncate text-xs text-attention">{pourquoi}{dernier}</span>
        </button>
        <button type="button" onClick={() => setRelance(!relance)} aria-expanded={relance} data-testid="ouvrir-relance"
          className="shrink-0 rounded-lg border border-attention/40 px-2 py-1 text-xs font-semibold text-attention">Relancer</button>
      </div>
      {relance ? <div className="mt-1.5"><BoutonsRelance chantier={l.c} /></div> : null}
    </div>
  )
}

/** Au-delà, « Voir les N autres tâches » : une session peut lancer dix agents, le premier écran doit rester lisible. */
export const TACHES_VISIBLES = 3

function BlocSession({ vs, projetId }: { vs: VueSession; projetId: string }) {
  const [toutes, setToutes] = useState(false)
  const taches = toutes ? vs.taches : vs.taches.slice(0, TACHES_VISIBLES)
  const cachees = vs.taches.length - taches.length
  return (
    <div data-testid="session-active" data-session={vs.session.id} className={`rounded-xl border px-2.5 py-2 ${vs.pause ? 'border-attention/40 bg-attention/5' : 'border-bord bg-carte'}`}>
      <p className="truncate text-sm font-semibold" title={vs.titre}>{vs.titre}</p>
      {vs.pause ? (
        <div data-testid="session-en-pause">
          <p className="text-xs font-semibold leading-snug text-attention" data-testid="etat-session">{vs.pause}</p>
          {vs.pauseDetail ? <p className="truncate text-[11px] text-texte-2" title={vs.pauseDetail}>{vs.pauseDetail}</p> : null}
        </div>
      ) : (
        <p className="truncate text-xs text-texte-2">
          <span className={vs.repond ? 'font-semibold text-ok' : ''} data-testid="etat-session">{vs.repond ? '✍️ répond en ce moment' : vs.titre.startsWith('🤖 Session autonome') ? '💤 en veille — se réveille toute seule chaque heure' : '⏸️ attend ton prochain message'}</span>
          {' · '}{vs.dernierSigne}
        </p>
      )}
      {vs.activites.length || vs.taches.length ? (
        <ul className="mt-1.5 space-y-1.5 border-l-2 border-bord pl-2">
          {vs.activites.map((a) => <li key={a.id}><LigneActivite a={a} projetId={projetId} dansSession /></li>)}
          {taches.map((v) => <li key={v.tache.id}><LigneTache v={v} projetId={projetId} enPause={!!vs.pause} /></li>)}
          {cachees > 0 ? <li><button type="button" className="text-xs font-semibold text-accent" onClick={() => setToutes(true)} data-testid="voir-taches">Voir les {cachees} autres tâches</button></li> : null}
        </ul>
      ) : null}
      {vs.finies.length ? (
        <details className="mt-1 text-xs text-texte-2" data-testid="taches-finies">
          <summary className="cursor-pointer select-none">✅ {vs.finies.length} fini{vs.finies.length > 1 ? 's' : ''} récemment</summary>
          <ul className="mt-0.5 space-y-0.5">
            {vs.finies.map((f) => <li key={f.tache.id} className="truncate">✅ fini {f.quand} — {f.libelle}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

/** Une barre de chantier vivante (progression.sh) : tap → le chantier dans son projet. */
function LigneActivite({ a, projetId, dansSession = false }: { a: Activite; projetId: string; dansSession?: boolean }) {
  const g = useGlobal()
  const chantier = a.chantier_id ? g.chantiers.find((c) => c.id === a.chantier_id) ?? null : null
  const flash = useFlash(`${a.updated_at}|${a.pourcentage}|${a.etape}`)
  return (
    <button type="button" data-testid="ligne-en-ce-moment" data-chantier-ligne={chantier?.id ?? ''} data-flash={flash ? 'oui' : 'non'}
      onClick={() => chantier && g.ouvrirChantier(projetId, chantier.id)}
      className={`block w-full rounded-xl text-left ${dansSession ? '' : 'border border-ok/40 bg-carte px-2.5 py-2'} ${flash ? 'flash-etape' : ''}`}>
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">📌 {chantier?.titre ?? a.detail ?? 'Travail hors chantier'}</span>
        <PointTravaille />
        {chantier ? <span aria-hidden className="text-texte-2">›</span> : null}
      </span>
      <Progression activite={a} vive compact now={g.now} />
      {dansSession ? null : <span className="mt-0.5 block truncate text-xs text-texte-2">session {nomCourtSession(a.session)}</span>}
    </button>
  )
}

/**
 * Un agent ou une commande en cours : ce qu'il fait, depuis quand, et — SI il
 * l'a signalé — son étape, sa barre et le temps restant. Sinon « avancement
 * non signalé », en gris : jamais une barre inventée.
 */
export function LigneTache({ v, projetId, sansChantier = false, enPause = false }: { v: VueTache; projetId: string; sansChantier?: boolean; enPause?: boolean }) {
  const g = useGlobal()
  const t = v.tache
  // « travaille » : l'agent a signalé son avancement depuis moins que le délai de silence.
  // Une session en pause sur une limite ne travaille pas : rien ne s'anime sous elle.
  const vivant = !enPause && !!t.progres_at && g.now.getTime() - Date.parse(t.progres_at) < g.silenceMs
  const flash = useFlash(t.progres_at ? `${t.progres_at}|${t.pourcentage}|${t.etape}` : null)
  return (
    <div data-testid="tache" data-tache={t.id} data-signale={v.signale ? 'oui' : 'non'} data-flash={flash ? 'oui' : 'non'} className={`rounded-lg text-sm ${flash ? 'flash-etape' : ''}`}>
      <p className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-medium leading-snug" title={v.libelle}>{v.libelle}</span>
        {vivant ? <PointTravaille /> : null}
        <span className="shrink-0 text-xs tabular-nums text-texte-2">{v.signale ? `depuis ${v.duree}` : ''}</span>
      </p>
      {v.chantier && !sansChantier ? (
        <button type="button" onClick={() => g.ouvrirChantier(projetId, v.chantier!.id)} className="block max-w-full truncate text-xs font-medium text-accent underline-offset-2 hover:underline">
          📌 {v.chantier.titre}
        </button>
      ) : null}
      {v.signale && v.pourcentage != null ? <Progression activite={activiteDeTache(t, g.now)} vive={vivant} compact now={g.now} />
        : v.signale ? <p className="text-xs text-texte-2">{t.etape ? `étape : ${t.etape}` : 'a donné signe de vie'}{v.reste ? ` · reste ${v.reste}` : ''} · avancement en % non signalé</p>
        : <p className="text-xs text-texte-2/80">depuis {v.duree} · <span data-testid="non-signale">avancement non signalé</span></p>}
    </div>
  )
}

/** Sur la carte d'un chantier : les agents et commandes en cours qui y travaillent. */
export function TachesDuChantier({ chantierId }: { chantierId: string }) {
  const { taches, chantiers, now, projet } = useCockpit()
  const liste = taches.filter((t) => t.chantier_id === chantierId && tacheEnCoursVivante(t, now))
  if (!liste.length) return null
  return (
    <div className="space-y-1.5 rounded-xl border border-ok/40 bg-ok/5 px-3 py-2" data-testid="taches-du-chantier">
      <p className="text-xs font-bold uppercase tracking-wide text-ok">En train d’y travailler</p>
      {liste.map((t) => <LigneTache key={t.id} v={vueTache(t, chantiers, now)} projetId={projet.id} sansChantier />)}
    </div>
  )
}
