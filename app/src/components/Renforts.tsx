import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, UsersRound } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { PointProjet } from './Icones.tsx'
import {
  AGENTS_MAX, SESSIONS_MAX, blocUtile, boutonRenforts, erreurReglageRenforts, ligneRenfort, messageDemande,
  type CodeLigne, type EtatRenforts, type ResultatDemande,
} from '../lib/renforts.ts'

const SONDAGE_MS = 30_000
const TEINTE: Record<CodeLigne, string> = { demande: 'text-info', en_route: 'text-ok', termine: 'text-texte-2', erreur: 'text-alerte' }

/**
 * « Lancer des renforts » (0024, D-10) : au-dessus de « Prêt à lancer », bien
 * distinct, un bloc par projet. Un clic demande une session par SECTION en
 * attente ; la session chef du projet les ouvre. Admin seulement (la base le
 * vérifie aussi). L'état vient de etat_renforts : ce que la base comptera.
 */
export function Renforts({ projetId, avecNom = false }: { projetId: string; avecNom?: boolean }) {
  const g = useGlobal()
  const p = g.projets.find((x) => x.id === projetId)
  if (!g.admin || !p || !p.actif) return null
  return <BlocRenforts projet={p} avecNom={avecNom} toujours={!avecNom} />
}

/** « Tout » : un bloc par projet où quelque chose attend ou avance. */
export function RenfortsTout() {
  const g = useGlobal()
  if (!g.admin) return null
  return <>{g.projets.filter((p) => p.actif).map((p) => <BlocRenforts key={p.id} projet={p} avecNom toujours={false} />)}</>
}

function BlocRenforts({ projet, avecNom, toujours }: { projet: Projet; avecNom: boolean; toujours: boolean }) {
  const g = useGlobal()
  const toast = useToast()
  const [etat, setEtat] = useState<EtatRenforts | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [dernier, setDernier] = useState<{ ok: boolean; texte: string } | null>(null)
  const [reglages, setReglages] = useState(false)
  // Le projet n'existe plus (supprimé pendant l'affichage) : la base renvoie null, on ne montre rien.
  const [disparu, setDisparu] = useState(false)
  const vivant = useRef(true)

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_renforts', { p_projet: projet.slug })
    if (!vivant.current) return
    if (error) { setErreur(messageErreur(error)); return }
    setErreur(null)
    setEtat(data as EtatRenforts | null)
    setDisparu(data == null)
  }, [projet.slug])

  // Au montage, toutes les 30 s, et quand les chantiers changent (temps réel) : un peu après, groupé.
  useEffect(() => {
    vivant.current = true
    void charger()
    const t = window.setInterval(() => void charger(), SONDAGE_MS)
    return () => { vivant.current = false; window.clearInterval(t) }
  }, [charger])
  useEffect(() => {
    const t = window.setTimeout(() => void charger(), 1500)
    return () => window.clearTimeout(t)
  }, [g.chantiers, charger])

  const lancer = async () => {
    setEnvoi(true)
    const { data, error } = await supabase.rpc('demander_renforts', { p_projet: projet.slug })
    setEnvoi(false)
    if (error) { const m = { ok: false, texte: `Renforts non demandés : ${messageErreur(error)}` }; setDernier(m); toast.erreur(m.texte); return }
    const m = messageDemande(data as ResultatDemande)
    setDernier(m)
    if (m.ok) toast.succes(m.texte); else toast.erreur(m.texte)
    await charger()
  }

  if (disparu) return null
  if (!etat && !erreur) {
    return toujours ? <p className="px-1 text-sm text-texte-2" role="status" data-testid="renforts-chargement">Chargement des renforts…</p> : null
  }
  if (!etat) {
    return (
      <section aria-label="Renforts" data-testid="renforts" data-etat="erreur" className="rounded-2xl border border-bord border-l-4 border-l-alerte bg-carte px-3 py-2.5 text-sm">
        <p className="text-alerte">Renforts indisponibles : {erreur}</p>
        <Button taille="sm" className="mt-2" onClick={() => void charger()}>Réessayer</Button>
      </section>
    )
  }
  if (!toujours && !blocUtile(etat)) return null
  const b = boutonRenforts(etat)
  const nAttente = etat.attente.reduce((n, a) => n + a.n, 0)
  return (
    <section aria-label={`Renforts${avecNom ? ` · ${projet.nom}` : ''}`} data-testid="renforts" data-projet={projet.slug}
      className="rounded-2xl border-2 border-accent/50 bg-carte px-3 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/50 text-accent"><UsersRound size={18} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-semibold">
            Renforts{avecNom ? <span className="inline-flex items-center gap-1 text-sm font-normal text-texte-2"><PointProjet couleur={projet.couleur} />{projet.nom}</span> : null}
          </h2>
          <p className="text-xs leading-snug text-texte-2" data-testid="renforts-attente">
            {nAttente
              ? <>{nAttente} chantier{nAttente > 1 ? 's' : ''} attend{nAttente > 1 ? 'ent' : ''} sans personne : {etat.attente.map((a) => `${a.section} ${a.n}`).join(' · ')}</>
              : 'Rien n’attend sans personne.'}
          </p>
        </div>
      </div>
      <Button variante="primaire" pleine className="mt-2.5" chargement={envoi} disabled={!b.actif} onClick={() => void lancer()} data-testid="lancer-renforts">
        <UsersRound size={16} aria-hidden />Lancer des renforts
      </Button>
      <p className="mt-1 text-xs leading-snug text-texte-2" data-testid="renforts-aide">{b.aide}</p>
      {dernier ? <p className={`mt-1 text-xs leading-snug ${dernier.ok ? 'text-ok' : 'text-alerte'}`} role="status" data-testid="renforts-resultat">{dernier.texte}</p> : null}
      {etat.renforts.length ? (
        <ul className="mt-2 divide-y divide-bord/70 rounded-xl border border-bord" data-testid="renforts-liste">
          {etat.renforts.map((r) => {
            const l = ligneRenfort(r, etat.chef, g.now, { projet: etat.projet ?? projet.nom, relais: etat.relais, relais_passage: etat.relais_passage })
            return (
              <li key={r.id} className="px-2.5 py-2" data-testid="renfort" data-code={l.code}>
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{r.section}</span>
                  <span className={`shrink-0 text-xs font-medium ${TEINTE[l.code]}`} data-testid="renfort-etat">{l.etat}</span>
                </p>
                <p className={`text-xs leading-snug ${l.code === 'erreur' ? 'text-alerte' : 'text-texte-2'}`}>{l.detail}</p>
              </li>
            )
          })}
        </ul>
      ) : null}
      <button type="button" onClick={() => setReglages(!reglages)} aria-expanded={reglages} data-testid="renforts-reglages-ouvrir"
        className="mt-2 inline-flex items-center gap-0.5 text-xs text-texte-2 underline-offset-2 hover:underline">
        Réglages : {etat.sessions_max} session{etat.sessions_max > 1 ? 's' : ''} au plus, {etat.agents_par_session} agent{etat.agents_par_session > 1 ? 's' : ''} chacune
        <ChevronDown size={14} className={`transition ${reglages ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {reglages ? <ReglagesRenforts projet={projet} etat={etat} onFini={() => { setReglages(false); void charger() }} /> : null}
    </section>
  )
}

function ReglagesRenforts({ projet, etat, onFini }: { projet: Projet; etat: EtatRenforts; onFini: () => void }) {
  const toast = useToast()
  const [sessions, setSessions] = useState(etat.sessions_max)
  const [agents, setAgents] = useState(etat.agents_par_session)
  const [envoi, setEnvoi] = useState(false)
  const enregistrer = async () => {
    const pb = erreurReglageRenforts(sessions, agents)
    if (pb) { toast.erreur(pb); return }
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_renforts', { p_projet: projet.slug, p_sessions: sessions, p_agents: agents })
    setEnvoi(false)
    if (error) { toast.erreur(`Réglage non enregistré : ${messageErreur(error)}`); return }
    toast.succes(`Renforts : ${sessions} session${sessions > 1 ? 's' : ''} au plus, ${agents} agent${agents > 1 ? 's' : ''} chacune.`)
    onFini()
  }
  const choix = (min: number, max: number, valeur: number, poser: (n: number) => void, nom: string, testId: string) => (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={nom} data-testid={testId}>
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={valeur === v} onClick={() => poser(v)}
          className={`h-9 min-w-9 rounded-lg border px-2 text-sm tabular-nums ${valeur === v ? 'border-accent bg-accent text-accent-fg' : 'border-bord bg-carte hover:bg-carte-2'}`}>{v}</button>
      ))}
    </div>
  )
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-bord bg-carte-2/40 p-2.5 text-sm" data-testid="renforts-reglages">
      <div>
        <p className="mb-1 text-xs text-texte-2">Sessions de renfort au plus (0 = éteint)</p>
        {choix(0, SESSIONS_MAX, sessions, setSessions, 'Sessions de renfort au plus', 'renforts-sessions')}
      </div>
      <div>
        <p className="mb-1 text-xs text-texte-2">Agents en même temps dans chaque session (5 au plus : au-delà, ça coûte et ça se marche dessus)</p>
        {choix(1, AGENTS_MAX, agents, setAgents, 'Agents par session', 'renforts-agents')}
      </div>
      <div className="flex justify-end gap-2">
        <Button taille="sm" onClick={onFini}>Annuler</Button>
        <Button taille="sm" variante="primaire" chargement={envoi} onClick={() => void enregistrer()} data-testid="renforts-enregistrer">Enregistrer</Button>
      </div>
    </div>
  )
}
