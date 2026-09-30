import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDownUp, ChevronDown, ChevronRight, CirclePause, MessageSquareText, Rocket, Settings2 } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { tableauDeBord, classesDe, type TableauDeBord as Tableau } from '../lib/tableauDeBord.ts'
import { attenteAToi, trierAToi, VERBE_A_TOI, type ElementAToi, type TriAToi, type LigneALancer, type LigneCaAvance } from '../lib/entonnoir.ts'
import { ouJenSuis, type LigneOuJenSuis, type QuatreNombres } from '../lib/ouJenSuis.ts'
import { estFenetre, FENETRES, FENETRE_DEFAUT, type Fenetre } from '../lib/fenetre.ts'
import { infoEtat } from '../lib/etats.ts'
import { etaLisible, dateRelative, dateLongue } from '../lib/dates.ts'
import { useToast } from '../ui/Toast.tsx'
import { ModeAutonome } from './ModeAutonome.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { AvecProjet } from './AvecProjet.tsx'
import { BarreProjet, ProjetsResume } from './BarreProjet.tsx'
import { BoutonsRelance, SuiviOuEnEst } from './Relance.tsx'
import { ouEnEstVisible } from '../lib/ouEnEst.ts'
import { BlocSession } from './QuiTravaille.tsx'
import { IconeAToi, PointProjet } from './Icones.tsx'
import { useFlash } from './Vivant.tsx'
import { Renforts, RenfortsTout } from './Renforts.tsx'
import { ReveilImmediat } from './ReveilImmediat.tsx'

/**
 * L'accueil = le modèle A « Tableau de bord » (Raphaël, 29 sept. 2026 : « vas-y
 * fais A + D », « des modèles plus compacts, plus ergonomiques, moins casse-tête
 * visuellement, des logiques plus ordonnées »), pour l'onglet « Tout » ET la
 * vue d'un projet :
 *   quatre tuiles (pour toi · ça avance · en pause · fini) — chacune ouvre sa liste ;
 *   « À toi de jouer »       — une ligne par chose à faire, UN verbe ;
 *   « Ça avance tout seul »  — une ligne par CHANTIER, barre seulement si signalée ;
 *   « Prêt à lancer »        — ce que personne ne tient, « Lancer ».
 * Toucher une ligne ouvre la conversation du chantier (modèle D). Les nombres
 * viennent de lib/tableauDeBord.ts : une seule règle, testée.
 */
export function TableauDeBord({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const fenetre: Fenetre = estFenetre(g.prefs.fenetre_livre) ? g.prefs.fenetre_livre : FENETRE_DEFAUT
  const ordre = useMemo(() => g.projets.map((p) => p.id), [g.projets])
  const t = useMemo(() => tableauDeBord(
    { chantiers: g.chantiers, messages: g.messages, activites: g.activites, sessions: g.sessions, taches: g.taches },
    g.now, g.silenceMs, fenetre, ordre, projetId,
  ), [g.chantiers, g.messages, g.activites, g.sessions, g.taches, g.now, g.silenceMs, fenetre, ordre, projetId])
  return (
    <div className="space-y-5">
      <Tuiles t={t} projetId={projetId} fenetre={fenetre} />
      {projetId ? <EcrireAuProjet projetId={projetId} /> : null}
      <SectionAToi elements={t.aToi} avecProjet={!projetId && g.projets.length > 1} />
      <SectionCaAvance t={t} avecProjet={!projetId && g.projets.length > 1} projetId={projetId} />
      {/* Renforts (0024, D-10) : au-dessus de ce qui attend, bien distinct. */}
      {projetId ? <Renforts projetId={projetId} /> : <RenfortsTout />}
      <SectionPretALancer lignes={t.pretALancer} avecProjet={!projetId && g.projets.length > 1} />
    </div>
  )
}

// ---------------------------------------------------------------- écrire au projet

/**
 * « Écrire à Claude » au niveau du PROJET (0028, Raphaël : « créer des chantiers
 * et une ligne avec un chat sur chaque sujet évoqué ») : un message libre, même
 * sur plusieurs sujets ; Claude en fait un chantier par sujet et répond dans
 * chaque fil. Ouvre la discussion du projet (fil sans chantier).
 */
function EcrireAuProjet({ projetId }: { projetId: string }) {
  const g = useGlobal()
  const fil = g.messages.filter((m) => m.projet_id === projetId && !m.chantier_id)
  const dernier = fil.reduce<typeof fil[number] | null>((a, m) => (!a || m.created_at > a.created_at ? m : a), null)
  return (
    <button type="button" onClick={() => g.ouvrirChantier(projetId, null)} data-testid="ecrire-projet"
      className="flex w-full items-center gap-2.5 rounded-2xl border border-bord bg-carte px-3 py-2.5 text-left transition hover:bg-carte-2 active:scale-[.99]">
      <MessageSquareText size={18} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-texte-2">Écrire à Claude sur ce projet…</span>
        <span className="block truncate text-xs text-texte-2" data-testid="ecrire-projet-aide">
          {dernier ? `${dernier.auteur_type === 'session' ? 'Claude' : 'Toi'} : ${dernier.corps}` : 'Plusieurs sujets ? Claude ouvre un fil par sujet et répond dans chacun.'}
        </span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- tuiles

type CleTuile = 'pourToi' | 'caAvance' | 'enPause' | 'fini'
const TUILES: { cle: CleTuile; libelle: string; aide: string; couleur: (n: number) => string }[] = [
  { cle: 'pourToi', libelle: 'pour toi', aide: 'une question, une décision ou un test t’attend', couleur: (n) => (n ? 'text-alerte' : 'text-texte-2') },
  { cle: 'caAvance', libelle: 'ça avance', aide: 'une session ou un assistant y travaille vraiment (barre de progression)', couleur: (n) => (n ? 'text-texte' : 'text-texte-2') },
  { cle: 'enPause', libelle: 'en pause', aide: 'personne n’y travaille : prêt à lancer, ou en cours sans session dessus', couleur: (n) => (n ? 'text-texte' : 'text-texte-2') },
  { cle: 'fini', libelle: 'fini', aide: 'certifié dans la période choisie', couleur: (n) => (n ? 'text-ok' : 'text-texte-2') },
]
interface Liste { titre: string; ids: string[]; n: number }

function idsDe(t: Tableau, cle: CleTuile): string[] {
  if (cle === 'pourToi') return [...new Set(t.aToi.flatMap((e) => (e.chantier ? [e.chantier.id] : [])))]
  if (cle === 'caAvance') return t.caAvance.map((l) => l.c.id)
  if (cle === 'enPause') return [...t.pretALancer, ...t.sansSession].map((l) => l.c.id)
  return t.fini.map((c) => c.id)
}

function Tuiles({ t, projetId, fenetre }: { t: Tableau; projetId: string | null; fenetre: Fenetre }) {
  const g = useGlobal()
  const [liste, setListe] = useState<Liste | null>(null)
  const [detail, setDetail] = useState(false)
  const libelleFenetre = FENETRES.find((f) => f.valeur === fenetre)?.libelle.toLowerCase() ?? ''
  const changerFenetre = () => {
    const i = FENETRES.findIndex((f) => f.valeur === fenetre)
    void g.poser('fenetre_livre', FENETRES[(i + 1) % FENETRES.length].valeur)
  }
  return (
    <section aria-label="Où j’en suis" data-testid="ou-jen-suis">
      <div className="grid grid-cols-4 gap-2" data-testid="tuiles">
        {TUILES.map((x) => {
          const n = t.tuiles[x.cle]
          return (
            <button key={x.cle} type="button" data-testid={`tuile-${x.cle}`} title={x.aide} aria-label={`${n} ${x.libelle} : ${x.aide}`}
              onClick={() => setListe({ titre: x.cle === 'fini' ? `Fini ${libelleFenetre}` : x.libelle.charAt(0).toUpperCase() + x.libelle.slice(1), ids: idsDe(t, x.cle), n })}
              className="rounded-2xl border border-bord bg-carte px-1 pb-2 pt-2.5 text-center transition hover:bg-carte-2 active:scale-[.98]">
              <span className={`block text-2xl font-medium leading-none tabular-nums ${x.couleur(n)}`} data-testid="nombre-tuile">{n}</span>
              <span className="mt-1 block truncate text-xs text-texte-2">{x.libelle}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-texte-2">
        <button type="button" onClick={changerFenetre} data-testid="fenetre-ou-jen-suis" className="underline-offset-2 hover:underline">fini = {libelleFenetre} · changer</button>
        <button type="button" onClick={() => setDetail(!detail)} aria-expanded={detail} data-testid="detail-ou-jen-suis" className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
          Détail par {projetId ? 'section' : 'projet'}<ChevronDown size={14} className={`transition ${detail ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {detail ? <TableauDetail t={t} projetId={projetId} fenetre={fenetre} ouvrir={setListe} /> : null}
      <ListeChantiers liste={liste} onFermer={() => setListe(null)} />
    </section>
  )
}

const COLONNES: { cle: keyof QuatreNombres; libelle: string }[] = [
  { cle: 'pourToi', libelle: 'pour toi' }, { cle: 'bouge', libelle: 'ça avance' }, { cle: 'dort', libelle: 'en pause' }, { cle: 'livre', libelle: 'fini' },
]
const TEINTE: Record<keyof QuatreNombres, string> = { pourToi: 'text-alerte', bouge: 'text-texte', dort: 'text-texte-2', livre: 'text-ok', expirees: 'text-attention' }
interface LigneDetail { cle: string; nom: string; couleur: string | null; nombres: QuatreNombres; ids: LigneOuJenSuis['ids'] }

/**
 * Le détail sous les tuiles (« Où j'en suis », redemandé le 29 sept.) : une
 * ligne par section (vue projet) ou par projet (« Tout »), les MÊMES quatre
 * nombres que les tuiles (ouJenSuis + classesDe).
 */
function TableauDetail({ t, projetId, fenetre, ouvrir }: { t: Tableau; projetId: string | null; fenetre: Fenetre; ouvrir: (l: Liste) => void }) {
  const g = useGlobal()
  const lignes = useMemo<LigneDetail[]>(() => {
    const classes = classesDe(t)
    const resume = (pid: string) => ouJenSuis(g.sections.filter((s) => s.projet_id === pid), g.chantiers.filter((c) => c.projet_id === pid),
      g.messages.filter((m) => m.projet_id === pid), fenetre, g.now, classes)
    if (projetId) return resume(projetId).lignes.map((l) => ({ cle: l.section?.id ?? 'sans', nom: l.section?.nom ?? 'Sans section', couleur: null, nombres: l.nombres, ids: l.ids }))
    return g.projets.filter((p) => p.actif).map((p) => {
      const r = resume(p.id)
      const ids: LigneOuJenSuis['ids'] = { pourToi: [], bouge: [], dort: [], livre: [], expirees: [] }
      for (const l of r.lignes) for (const k of Object.keys(ids) as (keyof typeof ids)[]) ids[k].push(...l.ids[k])
      return { cle: p.id, nom: p.nom, couleur: p.couleur ?? 'var(--accent)', nombres: r.total, ids }
    })
  }, [t, g.sections, g.chantiers, g.messages, g.projets, g.now, fenetre, projetId])
  const expirees = lignes.reduce((n, l) => n + l.nombres.expirees, 0)
  return (
    <div className="mt-2 rounded-2xl border border-bord bg-carte px-3 py-2" data-testid="detail-par-ligne">
      <div className="grid grid-cols-[1fr_repeat(4,3rem)] items-end gap-x-1 pb-1 text-[11px] text-texte-2">
        <span />{COLONNES.map((c) => <span key={c.cle} className="text-center leading-tight">{c.libelle}</span>)}
      </div>
      {lignes.map((l) => (
        <div key={l.cle} data-testid="ligne-ou-jen-suis" className="grid grid-cols-[1fr_repeat(4,3rem)] items-center gap-x-1 border-t border-bord/70">
          <span className="flex min-w-0 items-center gap-1.5 py-1 text-sm">{l.couleur ? <PointProjet couleur={l.couleur} /> : null}<span className="truncate">{l.nom}</span></span>
          {COLONNES.map((c) => {
            const n = l.nombres[c.cle]
            return n ? (
              <button key={c.cle} type="button" data-colonne={c.cle} aria-label={`${l.nom} : ${n} ${c.libelle}`}
                onClick={() => ouvrir({ titre: `${l.nom} · ${c.libelle}`, ids: l.ids[c.cle], n })}
                className={`h-8 rounded-lg text-center text-[15px] font-medium tabular-nums hover:bg-carte-2 ${TEINTE[c.cle]}`}>{n}</button>
            ) : <span key={c.cle} className="h-8 text-center leading-8 text-texte-2/40">·</span>
          })}
        </div>
      ))}
      {!lignes.length ? <p className="py-1 text-sm text-texte-2">Aucun chantier pour l’instant.</p> : null}
      {expirees ? (
        <button type="button" data-testid="reservations-expirees" className="mt-1 text-xs text-attention underline-offset-2 hover:underline"
          onClick={() => ouvrir({ titre: 'Réservations expirées', ids: lignes.flatMap((l) => l.ids.expirees), n: expirees })}>
          {expirees} réservation{expirees > 1 ? 's' : ''} expirée{expirees > 1 ? 's' : ''} : à libérer
        </button>
      ) : null}
    </div>
  )
}

/** La liste des chantiers derrière un nombre ; chacun ouvre sa conversation. */
function ListeChantiers({ liste, onFermer }: { liste: Liste | null; onFermer: () => void }) {
  const g = useGlobal()
  const chantiers = useMemo(() => {
    if (!liste) return []
    const ids = new Set(liste.ids)
    return g.chantiers.filter((c) => ids.has(c.id)).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  }, [liste, g.chantiers])
  return (
    <Dialog ouvert={!!liste} onFermer={onFermer} titre={`${liste?.titre ?? ''} (${liste?.n ?? 0})`}>
      {liste && liste.n > chantiers.length ? (
        <p className="mb-1 text-xs text-texte-2" data-testid="note-liste">Un chantier peut porter plusieurs choses à faire, et une question sur le projet n’a pas de chantier : tout est dans « À toi de jouer ».</p>
      ) : null}
      <ul className="divide-y divide-bord" data-testid="liste-ou-jen-suis">
        {chantiers.map((c: Chantier) => {
          const projet = g.projets.find((p) => p.id === c.projet_id)
          return (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center gap-2 py-2.5 text-left" data-testid="ligne-liste-ou-jen-suis"
                onClick={() => { onFermer(); g.ouvrirChantier(c.projet_id, c.id) }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{c.titre}</span>
                  <span className="flex items-center gap-1.5 text-xs text-texte-2">
                    {g.projets.length > 1 ? <><PointProjet couleur={projet?.couleur} /><span className="truncate">{projet?.nom}</span><span>·</span></> : null}
                    <span>{infoEtat(c.etat).court}</span>
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-texte-2" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      {!chantiers.length && !liste?.n ? <p className="py-2 text-sm text-texte-2">Rien ici pour l’instant.</p> : null}
    </Dialog>
  )
}

// ---------------------------------------------------------------- blocs communs

function TitreSection({ numero, titre, n, testId }: { numero: number; titre: string; n: number; testId: string }) {
  return (
    <h2 className="mb-1.5 flex items-baseline justify-between px-1 text-[13px] font-medium uppercase tracking-wide text-texte-2">
      <span><span className="mr-1.5 tabular-nums">{numero}</span>{titre}</span><span className="tabular-nums" data-testid={testId}>{n}</span>
    </h2>
  )
}

function Liste({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-bord/70 overflow-hidden rounded-2xl border border-bord bg-carte">{children}</ul>
}

function VoirPlus({ reste, onClick, testId }: { reste: number; onClick: () => void; testId: string }) {
  if (reste <= 0) return null
  return (
    <li>
      <button type="button" onClick={onClick} data-testid={testId} className="flex w-full items-center justify-center gap-1 py-2.5 text-sm font-medium text-accent">
        Voir les {reste} autres<ChevronRight size={15} aria-hidden />
      </button>
    </li>
  )
}

/** Le point et le nom du projet, dans « Tout » (plusieurs projets). */
function Projet({ projetId }: { projetId: string }) {
  const g = useGlobal()
  const p = g.projets.find((x) => x.id === projetId)
  if (!p) return null
  return <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle" data-testid="pastille-projet"><PointProjet couleur={p.couleur} />{p.nom}</span>
}

// ---------------------------------------------------------------- 1. À toi de jouer

export const A_TOI_VISIBLES = 4

function SectionAToi({ elements, avecProjet }: { elements: ElementAToi[]; avecProjet: boolean }) {
  const g = useGlobal()
  const toast = useToast()
  const [tout, setTout] = useState(false)
  // Le plus récent en haut par défaut (Raphaël, 29 sept. : « je ne sais pas quelles sont les plus récentes ») ; réglable, retenu.
  const tri: TriAToi = g.prefs.tri_a_toi === 'anciens' ? 'anciens' : 'recents'
  const tries = useMemo(() => trierAToi(elements, tri), [elements, tri])
  const visibles = tout ? tries : tries.slice(0, A_TOI_VISIBLES)
  const nDepasses = elements.filter((e) => e.avanceDepuis).length
  const basculer = async () => {
    try { await g.poser('tri_a_toi', tri === 'recents' ? 'anciens' : 'recents') }
    catch (err) { toast.erreur(`Tri non retenu : ${err instanceof Error ? err.message : String(err)}`) }
  }
  return (
    <section aria-label="À toi de jouer" data-testid="a-toi">
      <TitreSection numero={1} titre="À toi de jouer" n={elements.length} testId="a-toi-total" />
      {elements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-bord px-3 py-4 text-center text-[15px] text-texte-2" data-testid="rien-ne-t-attend">Rien ne t’attend. Claude n’a besoin de rien.</p>
      ) : (
        <>
          {elements.length > 1 ? (
            <div className="mb-1 flex items-center justify-between gap-2 px-1 text-xs text-texte-2">
              <span data-testid="a-toi-depasses">{nDepasses ? `${nDepasses} peut-être plus à jour, en bas : Claude les revoit` : ''}</span>
              <button type="button" onClick={() => void basculer()} data-testid="tri-a-toi" data-tri={tri} className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:underline">
                <ArrowDownUp size={13} aria-hidden />{tri === 'recents' ? 'Plus récents d’abord' : 'Plus anciens d’abord'}
              </button>
            </div>
          ) : null}
          <Liste>
            {visibles.map((e) => <LigneAToi key={e.cle} e={e} avecProjet={avecProjet} />)}
            <VoirPlus reste={tries.length - visibles.length} onClick={() => setTout(true)} testId="voir-a-toi" />
          </Liste>
        </>
      )}
    </section>
  )
}

function LigneAToi({ e, avecProjet }: { e: ElementAToi; avecProjet: boolean }) {
  const g = useGlobal()
  const ouvrir = () => g.ouvrirChantier(e.projetId, e.chantier?.id ?? null)
  return (
    <li data-testid="element-a-toi" data-type={e.type} data-element-chantier={e.chantier?.id ?? ''} data-depuis={e.depuis} data-depasse={e.avanceDepuis ? '1' : ''}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" onClick={ouvrir} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-bord"><IconeAToi type={e.type} /></span>
          <span className="min-w-0 flex-1">
            <span className={`line-clamp-2 text-[15px] font-medium leading-snug ${e.avanceDepuis ? 'text-texte-2' : ''}`} data-testid="titre-a-toi">{e.chantier?.titre ?? 'Question sur le projet'}</span>
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <><Projet projetId={e.projetId} /><span aria-hidden> · </span></> : null}
              <span className="whitespace-nowrap tabular-nums" data-testid="age-a-toi" title={dateLongue(e.depuis)}>{dateRelative(e.depuis, g.now)}</span><span aria-hidden> · </span>
              <span data-testid="attente-a-toi" className={e.avanceDepuis ? 'text-attention' : ''}>{e.type === 'question' && !e.chantier && e.message ? e.message.corps : attenteAToi(e, g.now)}</span>
            </span>
          </span>
        </button>
        <Button taille="sm" variante={e.avanceDepuis ? 'discret' : undefined} onClick={ouvrir} data-testid="verbe-a-toi" className="shrink-0">{VERBE_A_TOI[e.type]}</Button>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------- 2. Ça avance tout seul

export const CA_AVANCE_VISIBLES = 5

function SectionCaAvance({ t, avecProjet, projetId }: { t: Tableau; avecProjet: boolean; projetId: string | null }) {
  const [tout, setTout] = useState(false)
  const [detail, setDetail] = useState(false)
  const [aide, setAide] = useState(false)
  const lignes = t.caAvance
  const visibles = tout ? lignes : lignes.slice(0, CA_AVANCE_VISIBLES)
  const rien = !lignes.length && !t.horsChantier.length
  const [voirSans, setVoirSans] = useState(false)
  const sans = t.sansSession
  const nSessions = t.travail.reduce((n, gr) => n + gr.sessions.length, 0)
  return (
    <section aria-label="Ça avance tout seul" data-testid="en-ce-moment">
      <TitreSection numero={2} titre="Ça avance tout seul" n={lignes.length} testId="ca-avance-total" />
      {rien ? (
        <div className="rounded-2xl border border-dashed border-bord px-3 py-3 text-center" data-testid="personne-ne-travaille">
          <p className="text-[15px] text-texte-2">Personne ne travaille {projetId ? 'sur ce projet ' : ''}en ce moment.</p>
          <p className="mt-0.5 text-xs text-texte-2">Pour faire avancer un chantier : « Lancer », dans « Prêt à lancer ».</p>
        </div>
      ) : (
        <Liste>
          {visibles.map((l) => <LigneAvance key={l.c.id} l={l} avecProjet={avecProjet} />)}
          <VoirPlus reste={lignes.length - visibles.length} onClick={() => setTout(true)} testId="voir-ca-avance" />
          {t.horsChantier.map((h) => (
            <li key={h.cle} data-testid="hors-chantier" className="flex items-center gap-2 px-3 py-2 text-xs text-texte-2">
              {h.pause ? <CirclePause size={14} className="shrink-0 text-attention" aria-hidden /> : <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-texte-2/60" aria-hidden />}
              <span className={`min-w-0 flex-1 ${h.pause ? 'text-attention' : ''}`}>{h.texte}</span>
              {avecProjet ? <Projet projetId={h.projetId} /> : null}
            </li>
          ))}
        </Liste>
      )}
      {sans.length ? (
        <div className="mt-1.5 px-1" data-testid="sans-session">
          <button type="button" onClick={() => setVoirSans(!voirSans)} aria-expanded={voirSans} data-testid="voir-sans-session"
            className="inline-flex items-center gap-0.5 text-xs text-attention underline-offset-2 hover:underline">
            {sans.length} en cours sans session dessus (comptés « en pause »)<ChevronDown size={14} className={`transition ${voirSans ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {voirSans ? <div className="mt-1.5"><Liste>{sans.map((l) => <LigneAvance key={l.c.id} l={l} avecProjet={avecProjet} />)}</Liste></div> : null}
        </div>
      ) : null}
      {nSessions ? (
        <div className="mt-1.5 px-1">
          <div className="flex items-center justify-between gap-2 text-xs text-texte-2">
            <button type="button" onClick={() => setDetail(!detail)} aria-expanded={detail} data-testid="detail-sessions" className="inline-flex min-w-0 items-center gap-0.5 underline-offset-2 hover:underline">
              <span data-testid="resume-travail">{resumeSimple(t.resume)}</span><ChevronDown size={14} className={`shrink-0 transition ${detail ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            <button type="button" data-testid="vocabulaire" aria-expanded={aide} onClick={() => setAide(!aide)} className="shrink-0 underline-offset-2 hover:underline">c’est quoi ?</button>
          </div>
          {aide ? (
            <p className="mt-1 rounded-lg border border-bord bg-carte px-2 py-1.5 text-xs leading-snug text-texte-2" data-testid="vocabulaire-texte">Une <b>conversation</b> (ou session) = une fenêtre Claude Code que tu as ouverte. Un <b>assistant</b> (ou agent) = une aide que Claude lance en parallèle. Une <b>commande</b> = un long calcul qu’il fait tourner (tests, construction…).</p>
          ) : null}
          {detail ? (
            <div className="mt-1.5 space-y-1.5" data-testid="liste-sessions">
              {t.travail.flatMap((gr) => gr.sessions.map((vs) => <AvecProjet key={vs.session.id} projetId={gr.projetId}><BlocSession vs={vs} projetId={gr.projetId} /></AvecProjet>))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** La barre d'une ligne : vive (verte, reflet) seulement avec une preuve de vie ; sinon fine et grise. */
function Barre({ pct, vive }: { pct: number; vive: boolean }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${vive ? 'bg-ok/15' : 'bg-carte-2'}`} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}
      data-testid="progression" data-vive={vive ? 'oui' : 'non'}>
      <div className={`h-full rounded-full ${vive ? 'barre-vive bg-ok transition-[width] duration-700' : 'bg-texte-2/35'}`} style={{ width: `${Math.max(vive ? 3 : 2, p)}%` }} />
    </div>
  )
}

function LigneAvance({ l, avecProjet }: { l: LigneCaAvance; avecProjet: boolean }) {
  const g = useGlobal()
  const [relance, setRelance] = useState(false)
  const a = l.activite
  const flash = useFlash(l.vivant && a ? `${a.updated_at}|${a.pourcentage}|${a.etape}` : null)
  const reste = l.vivant && a ? etaLisible(a.eta_secondes) : null
  const ouvrir = () => g.ouvrirChantier(l.c.projet_id, l.c.id)
  // « Où ça en est ? » en attente (0023) : la ligne la suit, et rien ne se renvoie.
  const oe = ouEnEstVisible(l.ouEnEst, g.now) ? l.ouEnEst! : null
  // Demande partie : le panneau « Relancer » se referme (la ligne montre le suivi, une seule fois).
  const attente = !!oe?.enAttente
  useEffect(() => { if (attente) setRelance(false) }, [attente])
  return (
    <li data-testid="ligne-en-ce-moment" data-chantier-ligne={l.c.id} data-vivant={l.vivant ? 'oui' : 'non'} data-flash={flash ? 'oui' : 'non'} className={flash ? 'flash-etape' : ''}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button type="button" onClick={ouvrir} className="min-w-0 flex-1 text-left">
          <span className="line-clamp-2 text-[15px] font-medium leading-snug">{l.c.titre}</span>
          {a ? (
            <span className="mt-1 flex items-center gap-2">
              <Barre pct={a.pourcentage} vive={l.vivant} />
              <span className={`shrink-0 text-xs tabular-nums ${l.vivant ? 'text-texte' : 'text-texte-2'}`}>{a.pourcentage} %{reste ? ` · reste ${reste}` : ''}</span>
            </span>
          ) : null}
          {l.vivant ? (
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <><Projet projetId={l.c.projet_id} /> · </> : null}
              <span className="point-vivant mr-1.5 inline-block h-2 w-2 rounded-full bg-ok align-middle" aria-hidden data-testid="point-travaille" />
              <span className="line-clamp-2 inline">{l.qui}{l.etape ? ` · « ${l.etape} »` : ''}</span>
            </span>
          ) : oe ? (
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <><Projet projetId={l.c.projet_id} /> · </> : null}
              {oe.enAttente ? <span className="point-vivant mr-1.5 inline-block h-2 w-2 rounded-full bg-info align-middle" aria-hidden data-testid="point-ou-en-est" /> : null}
              <span className={oe.enAttente ? 'text-info' : 'text-ok'}>{oe.enAttente ? 'Tu as demandé où ça en est' : 'Claude a répondu à « où ça en est ? »'}</span>
            </span>
          ) : l.reprise ? (
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <><Projet projetId={l.c.projet_id} /> · </> : null}
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-ok/60 align-middle" aria-hidden />
              <span data-testid="reprise-reponse" data-reprise={l.reprise}>{l.pourquoi}</span>
            </span>
          ) : (
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <><Projet projetId={l.c.projet_id} /> · </> : null}
              <span className="text-attention" data-testid="sans-nouvelles">{l.pourquoi}{a ? ` · dernier signe ${dateRelative(a.updated_at, g.now)}` : ''}</span>
            </span>
          )}
        </button>
        {!l.vivant && !l.reprise && !oe?.enAttente ? (
          <Button taille="sm" onClick={() => setRelance(!relance)} aria-expanded={relance} data-testid="ouvrir-relance" className="shrink-0">Relancer</Button>
        ) : null}
      </div>
      {oe && !(relance && !oe.enAttente) ? <div className="-mt-1 px-3 pb-2.5" data-testid="suivi-ligne"><SuiviOuEnEst etat={oe} compact={l.vivant} /></div> : null}
      {relance && !oe?.enAttente ? <div className="px-3 pb-2.5"><AvecProjet projetId={l.c.projet_id}><BoutonsRelance chantier={l.c} /></AvecProjet></div> : null}
    </li>
  )
}

/** « Qui travaille : 4 conversations · 1 assistant · 2 commandes » — les mots du vocabulaire, pas « session » / « agent ». */
function resumeSimple(r: Tableau['resume']): string {
  const pl = (n: number, un: string, plus: string) => `${n} ${n > 1 ? plus : un}`
  const m = [pl(r.sessions + r.enPause, 'conversation', 'conversations')]
  if (r.agents) m.push(pl(r.agents, 'assistant', 'assistants'))
  if (r.commandes) m.push(pl(r.commandes, 'commande', 'commandes'))
  return `Qui travaille : ${m.join(' · ')}${r.enPause ? ` (${r.enPause} en pause)` : ''}`
}

// ---------------------------------------------------------------- 3. Prêt à lancer

export const A_LANCER_VISIBLES = 5

function SectionPretALancer({ lignes, avecProjet }: { lignes: LigneALancer[]; avecProjet: boolean }) {
  const [tout, setTout] = useState(false)
  const visibles = tout ? lignes : lignes.slice(0, A_LANCER_VISIBLES)
  return (
    <section aria-label="Prêt à lancer" data-testid="a-lancer">
      <TitreSection numero={3} titre="Prêt à lancer" n={lignes.length} testId="a-lancer-total" />
      {lignes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-bord px-3 py-3 text-center text-sm text-texte-2">Rien en attente : tout ce qui est prêt est déjà en route.</p>
      ) : (
        <Liste>
          {visibles.map((l) => <LigneLancer key={l.c.id} l={l} avecProjet={avecProjet} />)}
          <VoirPlus reste={lignes.length - visibles.length} onClick={() => setTout(true)} testId="voir-a-lancer" />
        </Liste>
      )}
    </section>
  )
}

function LigneLancer({ l, avecProjet }: { l: LigneALancer; avecProjet: boolean }) {
  const g = useGlobal()
  const [ouvert, setOuvert] = useState(false)
  const a = l.activite
  const details = [
    l.c.etat === 'a_trier' ? 'pas encore examiné' : null,
    l.c.priorite === 'haute' ? 'priorité haute' : null,
    a ? `arrêté à ${a.pourcentage} % ${dateRelative(a.updated_at, g.now)}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <li data-testid="ligne-a-lancer" data-ligne-chantier={l.c.id}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => g.ouvrirChantier(l.c.projet_id, l.c.id)} className="min-w-0 flex-1 text-left">
          <span className="line-clamp-2 text-[15px] font-medium leading-snug">{l.c.titre}</span>
          {avecProjet || details ? (
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <Projet projetId={l.c.projet_id} /> : null}
              {avecProjet && details ? ' · ' : null}
              {details}
            </span>
          ) : null}
          {a ? <span className="mt-1 flex"><Barre pct={a.pourcentage} vive={false} /></span> : null}
        </button>
        <Button taille="sm" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} data-testid="lancer" className="shrink-0"><Rocket size={15} aria-hidden />Lancer</Button>
      </div>
      {ouvert ? (
        <div className="px-3 pb-2.5">
          <p className="mb-1.5 text-xs text-texte-2">Copie la consigne, puis colle-la dans Claude Code, sur ce projet : Claude s’y met.</p>
          <AvecProjet projetId={l.c.projet_id}><BoutonsRelance chantier={l.c} /></AvecProjet>
        </div>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------- réglages

/** Vue projet : le branchement, les mises en ligne et le mode autonome, repliés. */
export function ReglagesProjet({ projetId }: { projetId: string }) {
  const g = useGlobal()
  const p = g.projets.find((x) => x.id === projetId)
  if (!p || (!p.depot && !g.admin)) return null
  return (
    <>
      {/* L'interrupteur du mode autonome reste visible, hors du repli : un toucher (chantier 79ec70d6). */}
      {g.admin ? <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="autonome-projet"><ModeAutonome projet={p} /></section> : null}
      <Repliable testId="reglages-projet" titre={<span className="flex items-center gap-2 text-[15px] font-medium"><Settings2 size={17} className="text-texte-2" aria-hidden />Réglages du projet</span>}>
        <BarreProjet projet={p} nu sansAutonome />
        {g.admin ? <div className="mt-2"><ReveilImmediat projet={p} /></div> : null}
      </Repliable>
    </>
  )
}

/** « Tout » : les mêmes réglages, un bloc par projet, repliés. */
export function ReglagesProjets() {
  return (
    <Repliable testId="reglages-projets" titre={<span className="flex items-center gap-2 text-[15px] font-medium"><Settings2 size={17} className="text-texte-2" aria-hidden />Réglages des projets</span>}>
      <ProjetsResume />
    </Repliable>
  )
}
