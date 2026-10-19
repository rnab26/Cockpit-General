import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Power, Rocket } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { enPause } from '../lib/pause.ts'
import type { EtatRenforts, ResultatDemande } from '../lib/renforts.ts'
import {
  aActiverAvecLancer, decisionToutLancer, messageApresActivation, messageApresLancer, voyantsDe,
  type EntreeLancer, type EtatSessions, type ResultatActivation, type ResultatLancer,
} from '../lib/toutLancer.ts'

const SONDAGE_MS = 30_000

/**
 * Sous le bouton : un VOYANT par projet concerné (vert « session ouverte », gris « aucune session », « en pause »), et quand
 * aucune session ne vit et que quelque chose attend (chantier OU message sans réponse), « Activer une session » (activer_session,
 * 0102). « Tout lancer » active lui-même une session pour chaque projet lancé qui n'en a aucune. La règle « vivante » est celle de
 * la base (etat_sessions) : l'écran ne la recopie pas.
 *
 * L'UNIQUE bouton de l'écran principal (16 oct. 2026) : « Tout lancer ». Dans la vue d'un projet il lance ce projet ; dans
 * « Tout », chaque projet actif où quelque chose attend. Mêmes appels serveur que l'ancien « Lancer des renforts »
 * (etat_renforts, demander_renforts) : la logique reste côté base. Le détail (liste, relance, réglages, historique) est dans
 * Réglages du projet › « Renforts (détails) ». Admin seulement (la base le vérifie aussi).
 */
export function ToutLancer({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const toast = useToast()
  const projets = useMemo(
    () => g.projets.filter((p) => p.actif && (projetId ? p.id === projetId : true)),
    [g.projets, projetId],
  )
  const cle = projets.map((p) => p.slug).join(',')
  const [etats, setEtats] = useState<Record<string, { etat: EtatRenforts | null; erreur: string | null; sessions: EtatSessions | null }>>({})
  const [activation, setActivation] = useState<string | null>(null)   // slug en cours d'activation
  const [retour, setRetour] = useState<{ ok: boolean; texte: string; reessayer: string[] } | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [dernier, setDernier] = useState<{ ok: boolean; texte: string; reessayer: boolean } | null>(null)
  const vivant = useRef(true)

  const charger = useCallback(async () => {
    const slugs = cle ? cle.split(',') : []
    const lus = await Promise.all(slugs.map(async (slug) => {
      const [er, es] = await Promise.all([supabase.rpc('etat_renforts', { p_projet: slug }), supabase.rpc('etat_sessions', { p_projet: slug })])
      const sessions = es.error ? null : (es.data as EtatSessions | null)
      return [slug, er.error ? { etat: null, erreur: messageErreur(er.error), sessions }
        : es.error ? { etat: (er.data as EtatRenforts | null), erreur: null, sessions: null }
        : { etat: (er.data as EtatRenforts | null), erreur: null, sessions }] as const
    }))
    if (!vivant.current) return
    setEtats(Object.fromEntries(lus))
  }, [cle])

  useEffect(() => {
    vivant.current = true
    void charger()
    const t = window.setInterval(() => { if (!document.hidden) void charger() }, SONDAGE_MS)
    return () => { vivant.current = false; window.clearInterval(t) }
  }, [charger])
  // Relu un peu après qu'un chantier de ces projets a bougé (nombre + dernière modification), et à chaque « Actualiser ».
  const signature = useMemo(() => {
    const ids = new Set(projets.map((p) => p.id))
    let n = 0, max = ''
    for (const c of g.chantiers) if (ids.has(c.projet_id)) { n++; if (c.updated_at > max) max = c.updated_at }
    // Sessions : seulement leur nombre et combien sont finies (une session qui s'ouvre ou se ferme, en direct) ; leur « vu_at »
    // bouge à chaque geste et ne doit pas relire à chaque fois (le sondage de 30 s attrape le vieillissement). Messages : nombre.
    let ns = 0, nf = 0, nm = 0
    for (const x of g.sessions) if (ids.has(x.projet_id)) { ns++; if (x.fin_at) nf++ }
    for (const m of g.messages) if (ids.has(m.projet_id)) nm++
    return `${n}:${max}:${ns}:${nf}:${nm}:${g.passagesComplets}`
  }, [g.chantiers, g.sessions, g.messages, g.passagesComplets, projets])
  const premiere = useRef(true)
  useEffect(() => {
    if (premiere.current) { premiere.current = false; return }
    const t = window.setTimeout(() => void charger(), 1500)
    return () => window.clearTimeout(t)
  }, [signature, charger])

  const entrees: EntreeLancer[] = projets.map((p) => ({
    slug: p.slug, nom: p.nom, enPause: enPause(p), etat: etats[p.slug]?.etat ?? null, erreur: etats[p.slug]?.erreur ?? null, sessions: etats[p.slug]?.sessions ?? null,
  }))
  // Un projet supprimé pendant l'affichage : la base répond null, on ne le compte pas.
  const visibles = entrees.filter((e) => e.etat || e.erreur || !(e.slug in etats))
  const d = decisionToutLancer(visibles)
  const voyants = voyantsDe(visibles, new Date())

  const lancer = async () => {
    setEnvoi(true)
    setRetour(null)
    const rs: ResultatLancer[] = []
    for (const slug of d.aLancer) {
      const e = visibles.find((x) => x.slug === slug)!
      const { data, error } = await supabase.rpc('demander_renforts', { p_projet: slug })
      rs.push({
        nom: e.nom, resultat: error ? null : (data as ResultatDemande), erreur: error ? messageErreur(error) : null,
        sansChef: !e.etat?.chef && !e.etat?.relais,
      })
    }
    // Une session pour chaque projet lancé qui n'en a aucune : la base ne tire jamais deux fois (« déjà demandé » = bon).
    const slugsActives = aActiverAvecLancer(d.aLancer, voyants)
    const acts = await demanderActivations(slugsActives)
    setEnvoi(false)
    // Une session vient d'être demandée pour ces projets : « ouvre Claude Code sur ce projet » ne vaut plus pour eux.
    for (const x of acts) { if (!x.erreur && (x.resultat === 'envoye' || x.resultat === 'deja_demande' || x.resultat === 'session_vivante')) { const r = rs.find((y) => y.nom === x.nom); if (r) r.sansChef = false } }
    const m = messageApresLancer(rs, new Date())
    const a = acts.length ? messageApresActivation(acts, new Date()) : null
    const complet = a ? { ok: m.ok && a.ok, reessayer: m.reessayer || a.reessayer, texte: `${m.texte}${a ? ` ${a.texte}` : ''}` } : m
    setDernier(complet)
    if (complet.ok) toast.succes(complet.texte); else toast.erreur(complet.texte)
    await charger()
  }

  const demanderActivations = async (slugs: string[]): Promise<ResultatActivation[]> => {
    const acts: ResultatActivation[] = []
    for (const slug of slugs) {
      const e = visibles.find((x) => x.slug === slug)!
      const { data, error } = await supabase.rpc('activer_session', { p_projet: slug })
      const j = (data ?? null) as { resultat?: string; reveil_at?: string | null } | null
      acts.push({ nom: e.nom, resultat: error ? null : (j?.resultat ?? null), reveil_at: j?.reveil_at ?? null, erreur: error ? messageErreur(error) : null })
    }
    return acts
  }

  // « Activer une session » d'un seul projet (le voyant). Un toucher, retour visible, jamais de doublon (la base refuse un second tir).
  const activer = async (slug: string) => {
    if (activation) return
    setActivation(slug)
    setRetour(null)
    const acts = await demanderActivations([slug])
    setActivation(null)
    const m = messageApresActivation(acts, new Date())
    setRetour({ ok: m.ok, texte: m.texte, reessayer: m.reessayer ? [slug] : [] })
    if (m.ok) toast.succes(m.texte); else toast.erreur(m.texte)
    await charger()
  }

  // Le voyant est toujours là (Raphaël : « directement »). Le gros bouton et sa ligne n'apparaissent que s'il y a quelque chose à lancer,
  // une erreur à réessayer ou un résultat à lire (16 oct. : « tout le superflu à la poubelle »).
  if (!g.admin || !projets.length) return null
  const avecBouton = d.actif || d.enErreur || !!dernier
  return (
    <section aria-label="Tout lancer" data-testid="tout-lancer" data-etat={d.enErreur ? 'erreur' : d.chargement ? 'chargement' : d.actif ? 'pret' : 'rien'}
      className={`rounded-2xl border-2 ${avecBouton ? 'border-accent' : 'border-bord'} bg-carte px-3 py-3`}>
      {avecBouton ? (
        <>
          <Button variante="primaire" taille="lg" pleine chargement={envoi} disabled={!d.actif} onClick={() => void lancer()} data-testid="tout-lancer-bouton">
            <Rocket size={18} aria-hidden />Tout lancer
          </Button>
          <p className="mt-2 text-sm leading-snug" role="status" data-testid="tout-lancer-ligne">{d.ligne}</p>
          {!d.actif && d.raison && !d.enErreur && !d.chargement && !d.raison.startsWith('Rien n’attend') ? <p className="mt-0.5 text-xs leading-snug text-texte-2" data-testid="tout-lancer-raison">{d.raison}</p> : null}
          {d.enErreur ? <Button taille="sm" className="mt-2" onClick={() => void charger()} data-testid="tout-lancer-reessayer">Réessayer</Button> : null}
          {dernier ? (
            <div className={`mt-1.5 text-xs leading-snug ${dernier.ok ? 'text-ok' : 'text-alerte'}`} role="status" data-testid="tout-lancer-resultat">
              <p>{dernier.texte}</p>
              {dernier.reessayer && d.actif ? <Button taille="sm" className="mt-1.5" onClick={() => void lancer()} data-testid="tout-lancer-reessayer-lancement">Réessayer</Button> : null}
            </div>
          ) : null}
        </>
      ) : null}
      <ul className={`${avecBouton ? 'mt-3 border-t border-bord pt-2.5' : ''} space-y-2`} aria-label="Sessions ouvertes" data-testid="voyants-sessions">
        {voyants.map((v) => (
          <li key={v.slug} data-testid="voyant-session" data-projet={v.slug} data-etat={v.etat} data-signe={v.signe ?? ""} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${v.signe === 'travail' ? 'bg-ok shadow-[0_0_0_3px_color-mix(in_srgb,var(--ok)_25%,transparent)]' : v.signe === 'veille' ? 'bg-ok/50' : v.signe === 'sans_nouvelles' || v.etat === 'pause' ? 'bg-attention' : v.etat === 'inconnu' ? 'bg-bord animate-pulse' : 'bg-texte-2/40'}`} />
            <span className="min-w-0 flex-1 text-sm leading-snug" data-testid="voyant-texte">
              {projets.length > 1 ? <span className="font-medium">{v.nom} · </span> : null}{v.texte}
              {v.etat !== 'vivante' && v.etat !== 'pause' && v.etat !== 'inconnu' && v.attend ? <span className="text-texte-2"> · {v.attend} {v.nChantiers + v.nMessages + v.nDemandes > 1 ? 'attendent' : 'attend'}</span> : null}
            </span>
            {v.peutActiver ? (
              <Button variante="secondaire" taille="sm" chargement={activation === v.slug} disabled={!!activation} onClick={() => void activer(v.slug)} data-testid="activer-session">
                <Power size={15} aria-hidden />Activer une session
              </Button>
            ) : null}
            {!v.peutActiver && v.raison && v.etat !== 'vivante' ? <p className="basis-full pl-5 text-xs leading-snug text-texte-2" data-testid="voyant-raison">{v.raison}</p> : null}
          </li>
        ))}
      </ul>
      {retour ? (
        <div className={`mt-2 text-xs leading-snug ${retour.ok ? 'text-ok' : 'text-alerte'}`} role="status" data-testid="activer-resultat">
          <p>{retour.texte}</p>
          {retour.reessayer.length ? <Button taille="sm" className="mt-1.5" onClick={() => void activer(retour.reessayer[0])} data-testid="activer-reessayer">Réessayer</Button> : null}
        </div>
      ) : null}
    </section>
  )
}
