import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Ban, Check, Clock, ArrowDownUp, ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronRight, CirclePause, MessageSquareText, Rocket, Settings2 } from 'lucide-react'
import type { Chantier, Message } from '../lib/types.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { marcheDe } from '../lib/marche.ts'
import { MarcheASuivre } from './MarcheASuivre.tsx'
import { useGlobal } from '../contexte.ts'
import { tableauDeBord, classesDe, type TableauDeBord as Tableau } from '../lib/tableauDeBord.ts'
import { attenteAToi, estNouveau, trierAToi, VERBE_A_TOI, type ElementAToi, type TriAToi, type TypeAToi, type LigneALancer, type LigneCaAvance } from '../lib/entonnoir.ts'
import { ordreListe, ouJenSuis, quandFini, type LigneOuJenSuis, type QuatreNombres } from '../lib/ouJenSuis.ts'
import { estFenetre, FENETRES, FENETRE_DEFAUT, type Fenetre } from '../lib/fenetre.ts'
import { infoEtat } from '../lib/etats.ts'
import { phraseAttente, projetAutonome } from '../lib/enAttente.ts'
import { DELAI_ABANDON_MIN } from '../lib/silence.ts'
import { useProchainPassage } from '../hooks/useProchainPassage.ts'
import { etaLisible, dateRelative, dateLongue, heureLisible } from '../lib/dates.ts'
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
import { FiletSecurite } from './FiletSecurite.tsx'
import { quandDeCote } from '../lib/reporter.ts'
import { PastilleReponse } from './PastilleReponse.tsx'
import { cleFil } from '../lib/lecture.ts'
import { bulleActive, cleBulle } from '../lib/bulleAide.ts'
import { basculerRepli, comptesAToi, pastillesVisibles, filtreEffectif, filtrerAToi, lireRepliees, LIBELLE_FILTRE_A_TOI, PREF_FILTRE_A_TOI, PREF_REPLIEES, toutBasculer, toutEstReplie, type SectionAccueil } from '../lib/repli.ts'

/**
 * L'accueil = le modèle A « Tableau de bord » (Raphaël, 29 sept. 2026 : « vas-y
 * fais A + D », « des modèles plus compacts, plus ergonomiques, moins casse-tête
 * visuellement, des logiques plus ordonnées »), pour l'onglet « Tout » ET la
 * vue d'un projet :
 *   cinq tuiles (pour toi · ça avance · à lancer · de côté · fini) — chacune ouvre sa liste ;
 *   « Ça avance tout seul »  — une ligne par CHANTIER, barre seulement si signalée (en premier) ;
 *   « À toi de jouer »       — une ligne par chose à faire, UN verbe (en second) ;
 *   « Prêt à lancer »        — ce que personne ne tient, « Lancer ».
 * Toucher une ligne ouvre la conversation du chantier (modèle D). Les nombres
 * viennent de lib/tableauDeBord.ts : une seule règle, testée.
 */
export function TableauDeBord({ projetId, entre, seulementTuiles = false }: { projetId: string | null; entre?: ReactNode; seulementTuiles?: boolean }) {
  const g = useGlobal()
  const fenetre: Fenetre = estFenetre(g.prefs.fenetre_livre) ? g.prefs.fenetre_livre : FENETRE_DEFAUT
  const ordre = useMemo(() => g.projets.map((p) => p.id), [g.projets])
  const t = useMemo(() => tableauDeBord(
    { chantiers: g.chantiers, messages: g.messages, activites: g.activites, sessions: g.sessions, taches: g.taches },
    g.now, g.silenceMs, fenetre, ordre, projetId,
  ), [g.chantiers, g.messages, g.activites, g.sessions, g.taches, g.now, g.silenceMs, fenetre, ordre, projetId])
  const toast = useToast()
  // Sections repliées : retenu par personne (préférences), un seul geste « Tout replier / Tout déplier ».
  const repliees = useMemo(() => lireRepliees(g.prefs[PREF_REPLIEES]), [g.prefs])
  const retenir = async (liste: SectionAccueil[]) => {
    try { await g.poser(PREF_REPLIEES, liste) }
    catch (err) { toast.erreur(`Repli non retenu : ${err instanceof Error ? err.message : String(err)}`) }
  }
  const repli = (cle: SectionAccueil) => ({ replie: repliees.has(cle), onToggle: () => void retenir(basculerRepli(repliees, cle)) })
  const tout = toutEstReplie(repliees)
  return (
    <div className="space-y-5">
      <Tuiles t={t} projetId={projetId} fenetre={fenetre} />
      {/* Vue d'un projet : les trois icônes (travail, réglages, coûts) viennent juste sous les chiffres, puis la discussion. */}
      {entre}
      {seulementTuiles ? null : <>
      {projetId ? <EcrireAuProjet projetId={projetId} /> : null}
      <div className="-mb-3 flex justify-end">
        <Button taille="sm" variante="discret" onClick={() => void retenir(toutBasculer(repliees))} data-testid="tout-replier-accueil" data-replie={tout ? '1' : ''}>
          {tout ? <ChevronsUpDown size={15} aria-hidden /> : <ChevronsDownUp size={15} aria-hidden />}{tout ? 'Tout déplier' : 'Tout replier'}
        </Button>
      </div>
      <SectionCaAvance t={t} avecProjet={!projetId && g.projets.length > 1} projetId={projetId} {...repli('ca-avance')} />
      <SectionAToi elements={t.aToi} avecProjet={!projetId && g.projets.length > 1} {...repli('a-toi')} />
      {/* Renforts (0024, D-10) : au-dessus de ce qui attend, bien distinct. */}
      {projetId ? <Renforts projetId={projetId} /> : <RenfortsTout />}
      <SectionPretALancer lignes={t.pretALancer} avecProjet={!projetId && g.projets.length > 1} {...repli('a-lancer')} />
      </>}
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
      <PastilleReponse cle={cleFil(projetId, null)} />
    </button>
  )
}

// ---------------------------------------------------------------- tuiles

type CleTuile = 'pourToi' | 'caAvance' | 'enPause' | 'deCote' | 'fini'
const TUILES: { cle: CleTuile; libelle: string; aide: string; couleur: (n: number) => string }[] = [
  { cle: 'pourToi', libelle: 'pour toi', aide: 'une question, une décision ou un test t’attend', couleur: (n) => (n ? 'text-alerte' : 'text-texte-2') },
  { cle: 'caAvance', libelle: 'ça avance', aide: 'une session ou un assistant y travaille vraiment (barre de progression)', couleur: (n) => (n ? 'text-texte' : 'text-texte-2') },
  { cle: 'enPause', libelle: 'à lancer', aide: 'prêts à démarrer (nouveaux compris) ou en cours sans session dessus : rien ne les bloque, personne ne les a encore pris', couleur: (n) => (n ? 'text-texte' : 'text-texte-2') },
  { cle: 'deCote', libelle: 'de côté', aide: 'mis de côté ou reportés exprès : ils ne bougent pas tant que tu ne les relances pas', couleur: (n) => (n ? 'text-texte' : 'text-texte-2') },
  { cle: 'fini', libelle: 'fini', aide: 'certifié dans la période choisie', couleur: (n) => (n ? 'text-ok' : 'text-texte-2') },
]
interface Liste { titre: string; ids: string[]; n: number; fini?: boolean; pourToi?: boolean; enAttente?: boolean; deCote?: boolean; aide?: string }

function idsDe(t: Tableau, cle: CleTuile): string[] {
  if (cle === 'pourToi') return [...new Set(t.aToi.flatMap((e) => (e.chantier ? [e.chantier.id] : [])))]
  if (cle === 'caAvance') return t.caAvance.map((l) => l.c.id)
  if (cle === 'enPause') return [...t.pretALancer, ...t.sansSession].map((l) => l.c.id)
  if (cle === 'deCote') return t.deCote.map((c) => c.id)
  return t.fini.map((c) => c.id)
}

/**
 * Les pastilles « geste attendu » (Questions, À tester, Actions…) vivent SOUS les tuiles, en permanence tant qu'il
 * reste quelque chose à faire (Raphaël, 6 oct. : elles n'apparaissaient que dans « À toi de jouer » et
 * disparaissaient avec lui). Toucher une pastille filtre « À toi de jouer » (même préférence) ; la même, ou « Tout »,
 * retire le filtre. Rien à faire : rien affiché. UNE règle : `comptesAToi`.
 */
function PastillesAToi({ elements }: { elements: ElementAToi[] }) {
  const g = useGlobal()
  const toast = useToast()
  const comptes = useMemo(() => comptesAToi(elements), [elements])
  const filtre = filtreEffectif(g.prefs[PREF_FILTRE_A_TOI], elements)
  if (!pastillesVisibles(elements)) return null
  const choisir = async (type: TypeAToi | null) => {
    try { await g.poser(PREF_FILTRE_A_TOI, type && filtre !== type ? type : 'tout') }
    catch (err) { toast.erreur(`Filtre non retenu : ${err instanceof Error ? err.message : String(err)}`); return }
    document.querySelector('[data-testid="a-toi"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="-mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Ce qui t’attend, par geste" data-testid="filtre-a-toi">
      {[{ type: null as TypeAToi | null, n: elements.length }, ...comptes].map((x) => {
        const actif = filtre === x.type
        return (
          <button key={x.type ?? 'tout'} type="button" aria-pressed={actif} data-testid="filtre-a-toi-puce" data-type={x.type ?? 'tout'}
            onClick={() => void choisir(x.type)}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-sm ${actif ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-bord text-texte-2'}`}>
            {x.type ? LIBELLE_FILTRE_A_TOI[x.type] : 'Tout'}<span className="tabular-nums">{x.n}</span>
          </button>
        )
      })}
    </div>
  )
}

function Tuiles({ t, projetId, fenetre }: { t: Tableau; projetId: string | null; fenetre: Fenetre }) {
  const g = useGlobal()
  const [liste, setListe] = useState<Liste | null>(null)
  // Détail par projet/section : ouvert d'emblée (Raphaël, 30 sept. : « pas replié automatiquement »).
  const [detail, setDetail] = useState(true)
  const libelleFenetre = FENETRES.find((f) => f.valeur === fenetre)?.libelle.toLowerCase() ?? ''
  const changerFenetre = () => {
    const i = FENETRES.findIndex((f) => f.valeur === fenetre)
    void g.poser('fenetre_livre', FENETRES[(i + 1) % FENETRES.length].valeur)
  }
  return (
    <section aria-label="Où j’en suis" data-testid="ou-jen-suis">
      <div className="grid grid-cols-5 gap-1.5" data-testid="tuiles">
        {TUILES.map((x) => {
          const n = t.tuiles[x.cle]
          return (
            <button key={x.cle} type="button" data-testid={`tuile-${x.cle}`} title={x.aide} aria-label={`${n} ${x.libelle} : ${x.aide}`}
              onClick={() => setListe({ titre: x.cle === 'fini' ? `Fini ${libelleFenetre}` : x.libelle.charAt(0).toUpperCase() + x.libelle.slice(1), ids: idsDe(t, x.cle), n, fini: x.cle === 'fini', pourToi: x.cle === 'pourToi', enAttente: x.cle === 'enPause', deCote: x.cle === 'deCote', aide: x.aide })}
              className="min-w-0 rounded-2xl border border-bord bg-carte px-0.5 pb-2 pt-2.5 text-center transition hover:bg-carte-2 active:scale-[.98]">
              <span className={`block text-2xl font-medium leading-none tabular-nums ${x.couleur(n)}`} data-testid="nombre-tuile">{n}</span>
              <span className="mt-1 block truncate text-[11px] text-texte-2">{x.libelle}</span>
            </button>
          )
        })}
      </div>
      <PastillesAToi elements={t.aToi} />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-texte-2">
        <button type="button" onClick={changerFenetre} data-testid="fenetre-ou-jen-suis" className="underline-offset-2 hover:underline">fini = {libelleFenetre} · changer</button>
        <button type="button" onClick={() => setDetail(!detail)} aria-expanded={detail} data-testid="detail-ou-jen-suis" className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
          Détail par {projetId ? 'section' : 'projet'}<ChevronDown size={14} className={`transition ${detail ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {detail ? <TableauDetail t={t} projetId={projetId} fenetre={fenetre} ouvrir={setListe} /> : null}
      <ListeChantiers liste={liste} onFermer={() => setListe(null)} avance={t.caAvance} aToi={t.aToi} />
    </section>
  )
}

const COLONNES: { cle: keyof QuatreNombres; libelle: string }[] = [
  { cle: 'pourToi', libelle: 'pour toi' }, { cle: 'bouge', libelle: 'ça avance' }, { cle: 'dort', libelle: 'à lancer' }, { cle: 'livre', libelle: 'fini' },
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
        <div key={l.cle} data-testid="ligne-ou-jen-suis" data-cle={l.cle} className="grid grid-cols-[1fr_repeat(4,3rem)] items-center gap-x-1 border-t border-bord/70">
          <span className="flex min-w-0 items-center gap-1.5 py-1 text-sm">{l.couleur ? <PointProjet couleur={l.couleur} /> : null}<span className="truncate">{l.nom}</span></span>
          {COLONNES.map((c) => {
            const n = l.nombres[c.cle]
            return n ? (
              <button key={c.cle} type="button" data-colonne={c.cle} aria-label={`${l.nom} : ${n} ${c.libelle}`}
                onClick={() => ouvrir({ titre: `${l.nom} · ${c.libelle}`, ids: l.ids[c.cle], n, fini: c.cle === 'livre', pourToi: c.cle === 'pourToi' })}
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

/**
 * Une ligne de « À lancer » (clé interne enAttente) : le titre en entier (sur plusieurs lignes), puis une phrase qui dit ce qui se passe,
 * ce qui va être fait et quand, et si tu as quelque chose à faire (sinon « rien à faire »). Règle : lib/enAttente.ts.
 */
function LigneEnAttente({ c, onOuvrir }: { c: Chantier; onOuvrir: () => void }) {
  const g = useGlobal()
  const projet = g.projets.find((p) => p.id === c.projet_id)
  const prochainPassage = useProchainPassage(c.projet_id)
  const activite = useMemo(() => g.activites.filter((a) => a.chantier_id === c.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null, [g.activites, c.id])
  const p = phraseAttente(c, activite, { now: g.now, abandonMin: projet?.delai_sans_signe_min ?? DELAI_ABANDON_MIN, prochainPassage, autonome: projetAutonome(projet, g.now) })
  return (
    <li>
      <button type="button" className="flex w-full items-start gap-2 py-2.5 text-left" data-testid="ligne-en-attente" data-a-faire={p.aFaire ? 'oui' : 'non'} onClick={onOuvrir}>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug">{c.titre}</span>
          {g.projets.length > 1 ? <span className="flex items-center gap-1.5 text-xs text-texte-2"><PointProjet couleur={projet?.couleur} /><span>{projet?.nom}</span></span> : null}
          <span className="mt-0.5 block text-sm leading-snug text-texte-2" data-testid="attente-quoi">{p.quoi}</span>
          <span className={`block text-sm leading-snug ${p.aFaire ? 'font-medium text-attention' : 'text-ok'}`} data-testid="attente-suite">{p.suite}{p.aFaire ? '' : ' Rien à faire de ton côté.'}</span>
        </span>
        <PastilleReponse cle={c.id} className="mt-0.5" />
        <ChevronRight size={16} className="mt-1 shrink-0 text-texte-2" aria-hidden />
      </button>
    </li>
  )
}

/** La liste des chantiers derrière un nombre ; chacun ouvre sa conversation. */
function ListeChantiers({ liste, onFermer, avance, aToi }: { liste: Liste | null; onFermer: () => void; avance: readonly LigneCaAvance[]; aToi: readonly ElementAToi[] }) {
  const g = useGlobal()
  // Le nombre « pour toi » compte les CHOSES à faire ; une ligne = un chantier : on dit combien il en porte.
  const nbParChantier = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of aToi) if (e.chantier) m.set(e.chantier.id, (m.get(e.chantier.id) ?? 0) + 1)
    return m
  }, [aToi])
  // La MÊME ligne que « Ça avance tout seul » (une seule source) : barre et % du dépliage = ceux de la ligne.
  const ligneDe = useMemo(() => new Map(avance.map((l) => [l.c.id, l])), [avance])
  const chantiers = useMemo(() => {
    if (!liste) return []
    const ids = new Set(liste.ids)
    return ordreListe(g.chantiers.filter((c) => ids.has(c.id)), !!liste.fini)
  }, [liste, g.chantiers])
  return (
    <Dialog ouvert={!!liste} onFermer={onFermer} titre={`${liste?.titre ?? ''} (${liste?.n ?? 0})`}>
      {liste?.aide ? <p className="mb-1 text-xs text-texte-2" data-testid="aide-liste">{liste.aide.charAt(0).toUpperCase() + liste.aide.slice(1)}.</p> : null}
      {liste && liste.n > chantiers.length && !liste.deCote && !liste.enAttente ? (
        <p className="mb-1 text-xs text-texte-2" data-testid="note-liste">Un chantier peut porter plusieurs choses à faire, et une question sur le projet n’a pas de chantier : tout est dans « À toi de jouer ».</p>
      ) : null}
      <ul className="divide-y divide-bord" data-testid="liste-ou-jen-suis">
        {chantiers.map((c: Chantier) => {
          const projet = g.projets.find((p) => p.id === c.projet_id)
          if (liste?.enAttente) return <LigneEnAttente key={c.id} c={c} onOuvrir={() => { onFermer(); g.ouvrirChantier(c.projet_id, c.id) }} />
          return (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center gap-2 py-2.5 text-left" data-testid="ligne-liste-ou-jen-suis"
                onClick={() => { onFermer(); g.ouvrirChantier(c.projet_id, c.id) }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{c.titre}</span>
                  <span className="flex items-center gap-1.5 text-xs text-texte-2">
                    {g.projets.length > 1 ? <><PointProjet couleur={projet?.couleur} /><span className="truncate">{projet?.nom}</span><span>·</span></> : null}
                    {liste?.deCote ? <span className="truncate" data-testid="quand-de-cote">{quandDeCote(c, g.now)}</span> : null}
                    {liste?.deCote ? null : liste?.fini && quandFini(c, g.moi.email, g.now)
                      ? <span className="truncate tabular-nums" data-testid="quand-fini" title={dateLongue(c.valide_at)}>{quandFini(c, g.moi.email, g.now)}</span>
                      : <span>{infoEtat(c.etat).court}</span>}
                    {liste?.pourToi && (nbParChantier.get(c.id) ?? 0) > 1 ? <span className="shrink-0 font-medium text-alerte" data-testid="nb-choses">· {nbParChantier.get(c.id)} choses à faire</span> : null}
                  </span>
                  {ligneDe.get(c.id) ? <BarreDeLigne l={ligneDe.get(c.id)!} /> : null}
                </span>
                <PastilleReponse cle={c.id} />
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

interface Repli { replie: boolean; onToggle: () => void }

/** Titre d'une section de l'accueil : un toucher la replie (le compteur reste visible). */
function TitreSection({ numero, titre, n, testId, replie, onToggle }: { numero: number; titre: string; n: number; testId: string } & Repli) {
  return (
    <h2 className="mb-1.5 text-[13px] font-medium uppercase tracking-wide text-texte-2">
      <button type="button" onClick={onToggle} aria-expanded={!replie} data-testid={`${testId}-repli`}
        className="flex min-h-9 w-full items-center justify-between gap-2 px-1 text-left uppercase tracking-wide">
        <span><span className="mr-1.5 tabular-nums">{numero}</span>{titre}</span>
        <span className="flex items-center gap-1.5"><span className="tabular-nums" data-testid={testId}>{n}</span><ChevronDown size={16} className={`transition ${replie ? '' : 'rotate-180'}`} aria-hidden /></span>
      </button>
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

function SectionAToi({ elements, avecProjet, replie, onToggle }: { elements: ElementAToi[]; avecProjet: boolean } & Repli) {
  const g = useGlobal()
  const toast = useToast()
  const [tout, setTout] = useState(false)
  // Le plus récent en haut par défaut (Raphaël, 29 sept. : « je ne sais pas quelles sont les plus récentes ») ; réglable, retenu.
  const tri: TriAToi = g.prefs.tri_a_toi === 'anciens' ? 'anciens' : 'recents'
  // Filtre par geste attendu (Questions, À tester…) : retenu par personne, jamais une liste vide cachée.
  const filtre = filtreEffectif(g.prefs[PREF_FILTRE_A_TOI], elements)
  const tries = useMemo(() => trierAToi(filtrerAToi(elements, filtre), tri), [elements, filtre, tri])
  const visibles = tout ? tries : tries.slice(0, A_TOI_VISIBLES)
  const nDepasses = elements.filter((e) => e.avanceDepuis).length
  const retenir = async (cle: string, valeur: unknown, quoi: string) => {
    try { await g.poser(cle, valeur) }
    catch (err) { toast.erreur(`${quoi} non retenu : ${err instanceof Error ? err.message : String(err)}`) }
  }
  const basculer = () => retenir('tri_a_toi', tri === 'recents' ? 'anciens' : 'recents', 'Tri')
  return (
    <section aria-label="À toi de jouer" data-testid="a-toi">
      <TitreSection numero={2} titre="À toi de jouer" n={elements.length} testId="a-toi-total" replie={replie} onToggle={onToggle} />
      {replie ? null : elements.length === 0 ? (
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

/**
 * Une action (« Fusionne la PR… ») se traite ICI, sans ouvrir de fil : la marche à suivre, puis Fait / Pas encore /
 * Ça bloque, avec un retour visible (toast succès ou échec). Même RPC que la carte du fil (`repondre_message`).
 */
function ActionDirecte({ message, onOuvrir }: { message: Message; onOuvrir: () => void }) {
  const g = useGlobal()
  const toast = useToast()
  const [enCours, setEnCours] = useState<string | null>(null)
  const marche = marcheDe(message)
  const repondre = async (reponse: string, etat: 'fait' | 'pas_encore' | 'bloque') => {
    setEnCours(etat)
    const { error } = await supabase.rpc('repondre_message', { p_id: message.id, p_par: g.par, p_reponse: reponse, p_precision: null, p_etat: etat })
    if (error) { setEnCours(null); toast.erreur(`Action non enregistrée : ${messageErreur(error)}`); return }
    toast.succes(etat === 'fait' ? 'Fait : Claude est prévenu.' : etat === 'pas_encore' ? 'Noté : pas encore.' : 'Noté : ça bloque.')
    await g.recharger()
    setEnCours(null)
  }
  return (
    <div className="px-3 pb-2.5" data-testid="action-directe">
      {marche ? <MarcheASuivre marche={marche} /> : null}
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <Button taille="sm" variante="ok" chargement={enCours === 'fait'} disabled={!!enCours} onClick={() => void repondre('Fait', 'fait')} data-testid="action-fait"><Check size={15} aria-hidden />Fait</Button>
        <Button taille="sm" chargement={enCours === 'pas_encore'} disabled={!!enCours} onClick={() => void repondre('Pas encore', 'pas_encore')} data-testid="action-pas-encore"><Clock size={15} aria-hidden />Pas encore</Button>
        <Button taille="sm" variante="attention" chargement={enCours === 'bloque'} disabled={!!enCours} onClick={() => void repondre('Ça bloque', 'bloque')} data-testid="action-bloque"><Ban size={15} aria-hidden />Ça bloque</Button>
      </div>
      <button type="button" onClick={onOuvrir} className="mt-1 text-xs text-texte-2 underline-offset-2 hover:underline" data-testid="action-voir-fil">Écrire un mot ou voir le fil</button>
    </div>
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
            <span className={`block text-xs font-semibold tabular-nums ${e.avanceDepuis ? 'text-attention' : 'text-accent'}`}>
              <span data-testid="age-a-toi" title={dateLongue(e.depuis)}>{dateRelative(e.depuis, g.now)}</span>
              <span className="font-normal text-texte-2" data-testid="heure-a-toi"> · {heureLisible(e.depuis, g.now)}</span>
            </span>
            <span className={`line-clamp-2 text-[15px] font-medium leading-snug ${e.avanceDepuis ? 'text-texte-2' : ''}`} data-testid="titre-a-toi">{e.chantier?.titre ?? 'Question sur le projet'}</span>
            <PastilleReponse cle={cleFil(e.projetId, e.chantier?.id ?? null)} className="mt-0.5" />
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <><Projet projetId={e.projetId} /><span aria-hidden> · </span></> : null}
              <span data-testid="attente-a-toi" className={e.avanceDepuis ? 'text-attention' : ''}>{(e.type === 'question' || e.type === 'action') && !e.chantier && e.message ? e.message.corps : attenteAToi(e, g.now)}</span>
            </span>
          </span>
        </button>
        {e.type === 'action' && e.message ? null : <Button taille="sm" variante={e.avanceDepuis ? 'discret' : undefined} onClick={ouvrir} data-testid="verbe-a-toi" className="shrink-0">{VERBE_A_TOI[e.type]}</Button>}
      </div>
      {e.type === 'action' && e.message ? <ActionDirecte message={e.message} onOuvrir={ouvrir} /> : null}
    </li>
  )
}

// ---------------------------------------------------------------- 2. Ça avance tout seul

export const CA_AVANCE_VISIBLES = 5

function SectionCaAvance({ t, avecProjet, projetId, replie, onToggle }: { t: Tableau; avecProjet: boolean; projetId: string | null } & Repli) {
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
      <TitreSection numero={1} titre="Ça avance tout seul" n={lignes.length} testId="ca-avance-total" replie={replie} onToggle={onToggle} />
      {replie ? null : rien ? (
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
      {!replie && sans.length ? (
        <div className="mt-1.5 px-1" data-testid="sans-session">
          <button type="button" onClick={() => setVoirSans(!voirSans)} aria-expanded={voirSans} data-testid="voir-sans-session"
            className="inline-flex items-center gap-0.5 text-xs text-attention underline-offset-2 hover:underline">
            {sans.length} en cours sans session dessus (comptés « à lancer »)<ChevronDown size={14} className={`transition ${voirSans ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {voirSans ? <div className="mt-1.5"><Liste>{sans.map((l) => <LigneAvance key={l.c.id} l={l} avecProjet={avecProjet} />)}</Liste></div> : null}
        </div>
      ) : null}
      {!replie && nSessions ? (
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

/** Barre + % + temps restant d'une ligne qui avance (dépliage des tuiles et « Ça avance tout seul » : même rendu). */
function BarreDeLigne({ l }: { l: LigneCaAvance }) {
  const a = l.activite
  if (!a) return <span className="mt-1 block text-xs text-texte-2" data-testid="avancement-non-signale">Claude y travaille · avancement pas encore signalé</span>
  const reste = l.vivant ? etaLisible(a.eta_secondes) : null
  return (
    <span className="mt-1 flex items-center gap-2" data-testid="barre-liste">
      <Barre pct={a.pourcentage} vive={l.vivant} />
      <span className={`shrink-0 text-xs tabular-nums ${l.vivant ? 'text-texte' : 'text-texte-2'}`}>{a.pourcentage} %{reste ? ` · reste ${reste}` : ''}</span>
    </span>
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
          <PastilleReponse cle={cleFil(l.c.projet_id, l.c.id)} className="mt-0.5" />
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

function SectionPretALancer({ lignes, avecProjet, replie, onToggle }: { lignes: LigneALancer[]; avecProjet: boolean } & Repli) {
  const g = useGlobal()
  const [tout, setTout] = useState(false)
  // Les nouveaux sont toujours visibles, même au-delà des 5 lignes (ils arrivent en tête).
  const nouveaux = lignes.filter((l) => estNouveau(l.c, g.now)).length
  const visibles = tout ? lignes : lignes.slice(0, Math.max(A_LANCER_VISIBLES, nouveaux))
  return (
    <section aria-label="Prêt à lancer" data-testid="a-lancer">
      <TitreSection numero={3} titre="Prêt à lancer" n={lignes.length} testId="a-lancer-total" replie={replie} onToggle={onToggle} />
      {replie || !nouveaux ? null : <p className="-mt-1 mb-1.5 text-xs text-texte-2" data-testid="a-lancer-nouveaux">Dont {nouveaux} nouveau{nouveaux > 1 ? 'x' : ''} (créé{nouveaux > 1 ? 's' : ''} depuis moins de 24 h), en haut de la liste.</p>}
      {replie ? null : lignes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-bord px-3 py-3 text-center text-sm text-texte-2">Rien à lancer : tout ce qui est prêt est déjà en route.</p>
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
          <span className="line-clamp-2 text-[15px] font-medium leading-snug">
            {estNouveau(l.c, g.now) ? <span className="mr-1.5 rounded-md bg-accent px-1.5 py-0.5 align-middle text-[11px] font-semibold uppercase text-accent-fg" data-testid="badge-nouveau">Nouveau</span> : null}
            {l.c.titre}
          </span>
          {avecProjet || details ? (
            <span className="mt-0.5 block text-xs leading-snug text-texte-2">
              {avecProjet ? <Projet projetId={l.c.projet_id} /> : null}
              {avecProjet && details ? ' · ' : null}
              {details}
            </span>
          ) : null}
          {a ? <span className="mt-1 flex"><Barre pct={a.pourcentage} vive={false} /></span> : null}
        </button>
        <PastilleReponse cle={l.c.id} />
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
  const toast = useToast()
  const [reglagesOuverts, setReglagesOuverts] = useState(false)
  if (!p || (!p.depot && !g.admin)) return null

  // « Coller le jeton » (réveil automatique bloqué) : ouvre les réglages et amène au champ.
  const versJeton = () => {
    setReglagesOuverts(true)
    window.setTimeout(() => document.querySelector('[data-testid="reveil-immediat"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
  }

  const clepref = cleBulle(p.id)
  const actif = bulleActive(g.prefs, p.id)
  const basculer = async () => {
    try {
      await g.poser(clepref, !actif)
      toast.succes(actif ? 'Bulle désactivée' : 'Bulle activée')
    } catch (e) {
      toast.erreur('Impossible de changer le réglage')
    }
  }

  return (
    <>
      {/* L'interrupteur du mode autonome reste visible, hors du repli : un toucher (chantier 79ec70d6). */}
      {g.admin ? <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="autonome-projet"><ModeAutonome projet={p} /></section> : null}
      {g.admin ? <FiletSecurite projet={p} onJeton={versJeton} /> : null}
      <Repliable testId="reglages-projet" ouvert={reglagesOuverts} onToggle={setReglagesOuverts} titre={<span className="flex items-center gap-2 text-[15px] font-medium"><Settings2 size={17} className="text-texte-2" aria-hidden />Réglages du projet</span>}>
        <BarreProjet projet={p} nu sansAutonome />
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={actif}
              onChange={basculer}
              className="h-4 w-4 rounded border border-bord bg-fond accent-lien"
            />
            <span className="text-sm text-texte">Bulle d'aide sur ce projet</span>
          </label>
        </div>
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
