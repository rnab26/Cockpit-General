import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Play, UsersRound } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { PointProjet } from './Icones.tsx'
import { LIEN_CLAUDE_CODE, etapesTraiter, etatTraiter, phraseTraiter } from '../lib/traiter.ts'
import {
  AGENTS_MAX, AGENTS_PARALLELE_MAX, EFFORTS, MODELES, SESSIONS_MAX, erreurReglageModeles, libelleFrein, libelleBascule, blocUtile, boutonRenforts, alerteSaturation, erreurReglageRenforts, ligneRenfort, messageDemande,
  type CodeLigne, type EffortClaude, type EtatModeles, type EtatRenforts, type ModeleClaude, type ResultatDemande,
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
  const alerte = alerteSaturation(etat)
  const nAttente = etat.attente.reduce((n, a) => n + a.n, 0)
  return (
    <>
    <TraiterCeProjet projet={projet} etat={etat} avecNom={avecNom} />
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
      {alerte ? (
        <div role="alert" data-testid="renforts-alerte" data-niveau={alerte.niveau}
          className={`mt-2.5 rounded-xl border border-l-4 px-2.5 py-2 text-xs leading-snug ${alerte.niveau === 'sature' ? 'border-alerte' : 'border-accent'}`}>
          <p className="font-medium">{alerte.titre}</p>
          <p className="text-texte-2">{alerte.conseil}</p>
        </div>
      ) : null}
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
      {reglages ? <ReglagesModeles projet={projet} /> : null}
    </section>
    </>
  )
}

/**
 * « Traiter ce projet » : un toucher copie la phrase et ouvre Claude Code ; la session qui reçoit
 * un premier message devient la chef du projet et prend les chantiers en lot (voir lib/traiter.ts).
 * Aucun réglage par projet : tout vient du projet lui-même (nom, dépôt) et de l'état de la base.
 */
function TraiterCeProjet({ projet, etat, avecNom }: { projet: Projet; etat: EtatRenforts; avecNom: boolean }) {
  const g = useGlobal()
  const toast = useToast()
  const [copie, setCopie] = useState<'oui' | 'non' | null>(null)
  const phrase = phraseTraiter(projet.nom)
  const lancer = async () => {
    let ok = false
    try { await navigator.clipboard.writeText(phrase); ok = true } catch { ok = false }
    setCopie(ok ? 'oui' : 'non')
    if (ok) toast.succes('Phrase copiée : colle-la dans la nouvelle session.')
    else toast.erreur('Copie impossible : sélectionne la phrase ci-dessous et copie-la à la main.')
    window.open(LIEN_CLAUDE_CODE, '_blank', 'noopener')
  }
  return (
    <section aria-label={`Traiter ce projet${avecNom ? ` · ${projet.nom}` : ''}`} data-testid="traiter" data-projet={projet.slug}
      className="rounded-2xl border-2 border-accent bg-carte px-3 py-3">
      <h2 className="text-[15px] font-semibold">Traiter ce projet{avecNom ? <span className="ml-1.5 text-sm font-normal text-texte-2">{projet.nom}</span> : null}</h2>
      <p className="mt-0.5 text-xs leading-snug text-texte-2" data-testid="traiter-etat">{etatTraiter(etat, g.now)}</p>
      <Button variante="primaire" pleine className="mt-2.5" onClick={() => void lancer()} data-testid="traiter-lancer">
        <Play size={16} aria-hidden />Copier la phrase et ouvrir Claude Code
      </Button>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs leading-snug text-texte-2" data-testid="traiter-etapes">
        {etapesTraiter(projet.depot).map((e) => <li key={e}>{e}</li>)}
      </ol>
      <p className={`mt-2 select-all rounded-lg border px-2 py-1.5 text-xs leading-snug ${copie === 'non' ? 'border-alerte text-alerte' : 'border-bord bg-carte-2/40'}`} data-testid="traiter-phrase">{phrase}</p>
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

/**
 * Économie des modèles (0035) : quel modèle pour coder, lequel pour lire, quel effort, combien d'agents en
 * parallèle, et le frein (posé à la main ici, ou tout seul quand une session touche la limite d'usage).
 */
function ReglagesModeles({ projet }: { projet: Projet }) {
  const toast = useToast()
  const [etat, setEtat] = useState<EtatModeles | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [code, setCode] = useState<ModeleClaude>('sonnet')
  const [leger, setLeger] = useState<ModeleClaude>('haiku')
  const [effort, setEffort] = useState<EffortClaude>('moyen')
  const [agents, setAgents] = useState(2)
  const [revueH, setRevueH] = useState(24)
  const [envoi, setEnvoi] = useState(false)
  const lire = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_modeles', { p_projet: projet.slug })
    if (error) { setErreur(messageErreur(error)); return }
    const e = data as EtatModeles | null
    if (!e) return
    setErreur(null); setEtat(e); setCode(e.modele_code); setLeger(e.modele_leger); setEffort(e.effort); setAgents(e.agents); setRevueH(e.revue_h)
  }, [projet.slug])
  useEffect(() => { void lire() }, [lire])
  const enregistrer = async () => {
    const pb = erreurReglageModeles(agents, revueH)
    if (pb) { toast.erreur(pb); return }
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_modeles', { p_projet: projet.slug, p_code: code, p_leger: leger, p_effort: effort, p_agents: agents, p_revue_h: revueH })
    setEnvoi(false)
    if (error) { toast.erreur(`Modèles non enregistrés : ${messageErreur(error)}`); return }
    toast.succes('Modèles enregistrés : ils servent aux prochains agents lancés.')
    void lire()
  }
  const frein = async (heures: number) => {
    setEnvoi(true)
    const { error } = await supabase.rpc('freiner', { p_projet: projet.slug, p_heures: heures, p_raison: heures ? 'frein posé depuis le cockpit' : null })
    setEnvoi(false)
    if (error) { toast.erreur(`Frein non modifié : ${messageErreur(error)}`); return }
    toast.succes(heures ? `Frein posé pour ${heures} h.` : 'Frein levé.')
    void lire()
  }
  const basculer = async (actif: boolean) => {
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_bascule', { p_projet: projet.slug, p_actif: actif })
    setEnvoi(false)
    if (error) { toast.erreur(`Bascule non modifiée : ${messageErreur(error)}`); return }
    toast.succes(actif ? 'Bascule automatique allumée.' : 'Bascule automatique éteinte.')
    void lire()
  }
  const choix = <T extends string>(valeurs: { valeur: T; nom: string; aide?: string }[], courant: T, poser: (v: T) => void, nom: string, testId: string) => (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={nom} data-testid={testId}>
      {valeurs.map((v) => (
        <button key={v.valeur} type="button" role="radio" aria-checked={courant === v.valeur} onClick={() => poser(v.valeur)}
          className={`h-9 rounded-lg border px-2.5 text-sm ${courant === v.valeur ? 'border-accent bg-accent text-accent-fg' : 'border-bord bg-carte hover:bg-carte-2'}`}>
          {v.nom}{v.aide ? <span className="ml-1 text-[11px] opacity-70">{v.aide}</span> : null}
        </button>
      ))}
    </div>
  )
  if (erreur) return <p className="mt-2 text-xs text-alerte" data-testid="modeles-erreur">Modèles indisponibles : {erreur}</p>
  if (!etat) return <p className="mt-2 text-xs text-texte-2" role="status">Chargement des modèles…</p>
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-bord bg-carte-2/40 p-2.5 text-sm" data-testid="modeles-reglages">
      <p className="text-xs font-medium">Modèles et effort des agents</p>
      <div>
        <p className="mb-1 text-xs text-texte-2">Modèle pour coder (et pour les sessions de renfort)</p>
        {choix(MODELES, code, setCode, 'Modèle pour coder', 'modele-code')}
      </div>
      <div>
        <p className="mb-1 text-xs text-texte-2">Modèle pour lire (répondre, point, vérifier, revue)</p>
        {choix(MODELES, leger, setLeger, 'Modèle pour lire', 'modele-leger')}
      </div>
      <div>
        <p className="mb-1 text-xs text-texte-2">Effort de réflexion</p>
        {choix(EFFORTS, effort, setEffort, 'Effort', 'modele-effort')}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-texte-2">Agents en parallèle (1 à {AGENTS_PARALLELE_MAX})
          <input type="number" inputMode="numeric" min={1} max={AGENTS_PARALLELE_MAX} value={agents} onChange={(e) => setAgents(Number(e.target.value))}
            className="ml-2 h-9 w-16 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums" data-testid="modele-agents" />
        </label>
        <label className="text-xs text-texte-2">Revue « À toi » toutes les (heures)
          <input type="number" inputMode="numeric" min={1} max={168} value={revueH} onChange={(e) => setRevueH(Number(e.target.value))}
            className="ml-2 h-9 w-16 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums" data-testid="modele-revue" />
        </label>
      </div>
      <p className={`text-xs leading-snug ${etat.frein.actif ? 'text-alerte' : 'text-texte-2'}`} data-testid="modeles-frein">{libelleFrein(etat.frein)}</p>
      <p className={`text-xs leading-snug ${(etat.palier ?? 0) > 0 && etat.bascule_auto !== false ? 'text-alerte' : 'text-texte-2'}`} data-testid="modeles-bascule">{libelleBascule(etat)}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button taille="sm" chargement={envoi} onClick={() => void basculer(etat.bascule_auto === false)} data-testid="bascule-interrupteur">
          {etat.bascule_auto === false ? 'Allumer la bascule' : 'Éteindre la bascule'}
        </Button>
        {etat.frein.actif
          ? <Button taille="sm" chargement={envoi} onClick={() => void frein(0)} data-testid="frein-lever">Lever le frein</Button>
          : <Button taille="sm" chargement={envoi} onClick={() => void frein(3)} data-testid="frein-poser">Freiner 3 h</Button>}
        <Button taille="sm" variante="primaire" chargement={envoi} onClick={() => void enregistrer()} data-testid="modeles-enregistrer">Enregistrer</Button>
      </div>
      <p className="text-[11px] leading-snug text-texte-2">L’effort est une consigne donnée à chaque agent, pas un réglage forcé de Claude Code.</p>
    </div>
  )
}
