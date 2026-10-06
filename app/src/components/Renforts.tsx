import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Play, UsersRound } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { DELAI_ABANDON_MIN, DELAI_ABANDON_MIN_BORNES, erreurDelaiSansSigne } from '../lib/silence.ts'
import { Button } from '../ui/Button.tsx'
import { PointProjet } from './Icones.tsx'
import { LIBELLE_LANCER, LIEN_CLAUDE_CODE, etapesTraiter, etatTraiter, phraseTraiter } from '../lib/traiter.ts'
import {
  AGENTS_MAX, AGENTS_PARALLELE_MAX, EFFORTS, MODELES, SESSIONS_MAX, erreurReglageModeles, erreurReglageFermeture, erreurSeuilBascule, libelleFrein, libelleBascule, blocUtile, boutonRenforts, peutRelancer, erreurEffacement, alerteSaturation, erreurReglageRenforts, erreurSeuilAuto, libelleAuto, origineRenfort, ligneRenfort, partagerRenforts, messageDemande,
  type CodeLigne, type EffortClaude, type EtatModeles, type EtatRenforts, type ModeleClaude, type Renfort, type ResultatDemande,
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
  const [histo, setHisto] = useState(false)
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

  const [enCours, setEnCours] = useState<string | null>(null)
  const relancer = async (r: Renfort) => {
    setEnCours(r.id)
    const { error } = await supabase.rpc('relancer_renfort', { p_renfort: r.id })
    setEnCours(null)
    if (error) { toast.erreur(`Renfort non relancé : ${messageErreur(error)}`); return }
    toast.succes(`Renfort « ${r.section} » relancé : la session chef l’ouvre à son prochain passage.`)
    await charger()
  }
  const effacer = async () => {
    setEnCours('effacer')
    const { data, error } = await supabase.rpc('effacer_erreurs_renforts', { p_projet: projet.slug })
    setEnCours(null)
    if (error) { toast.erreur(`Erreurs non effacées : ${messageErreur(error)}`); return }
    toast.succes(`${data as number} ligne${(data as number) > 1 ? 's' : ''} en erreur effacée${(data as number) > 1 ? 's' : ''}.`)
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
  const ligneDe = (r: Renfort) => ligneRenfort(r, etat.chef, g.now, { projet: etat.projet ?? projet.nom, relais: etat.relais, relais_passage: etat.relais_passage })
  const part = partagerRenforts(etat.renforts)
  const ligneJsx = (r: Renfort, detail: boolean) => {
    const l = ligneDe(r)
    return (
      <li key={r.id} className="px-2.5 py-2" data-testid="renfort" data-code={l.code}>
        <p className="flex items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 truncate font-medium">{r.section}</span>
          <span className={`shrink-0 text-xs font-medium ${TEINTE[l.code]}`} data-testid="renfort-etat">{l.etat}</span>
        </p>
        <p className={`text-xs leading-snug ${l.code === 'erreur' ? 'text-alerte' : 'text-texte-2'}`}>{l.detail}</p>
        {detail && origineRenfort(r) ? <p className="text-xs leading-snug text-texte-2" data-testid="renfort-origine">{origineRenfort(r)}</p> : null}
        {peutRelancer(l) ? <Button taille="sm" className="mt-1" chargement={enCours === r.id} onClick={() => void relancer(r)} data-testid="renfort-relancer">Relancer</Button> : null}
      </li>
    )
  }
  const nErreurs = etat.renforts.filter((r) => ligneDe(r).code === 'erreur').length
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
        <div role={alerte.geste ? 'alert' : 'status'} data-testid="renforts-alerte" data-niveau={alerte.niveau} data-geste={alerte.geste ? 'oui' : 'non'}
          className={`mt-2.5 rounded-xl border border-l-4 px-2.5 py-2 text-xs leading-snug ${alerte.geste ? (alerte.niveau === 'sature' ? 'border-alerte' : 'border-accent') : 'border-ok'}`}>
          <p className="font-medium">{alerte.titre}</p>
          <p className="text-texte-2">{alerte.conseil}</p>
        </div>
      ) : null}
      <Button variante="primaire" pleine className="mt-2.5" chargement={envoi} disabled={!b.actif} onClick={() => void lancer()} data-testid="lancer-renforts">
        <UsersRound size={16} aria-hidden />Lancer des renforts
      </Button>
      <p className="mt-1 text-xs leading-snug text-texte-2" data-testid="renforts-aide">{b.aide}</p>
      <p className="mt-1 text-xs leading-snug text-texte-2" data-testid="renforts-auto">{libelleAuto(etat.auto, etat.frein_jusqu_a)}</p>
      {dernier ? <p className={`mt-1 text-xs leading-snug ${dernier.ok ? 'text-ok' : 'text-alerte'}`} role="status" data-testid="renforts-resultat">{dernier.texte}</p> : null}
      {part.visibles.length ? (
        <ul className="mt-2 divide-y divide-bord/70 rounded-xl border border-bord" data-testid="renforts-liste">
          {part.visibles.map((r) => ligneJsx(r, false))}
        </ul>
      ) : (
        <p className="mt-2 text-xs leading-snug text-texte-2" data-testid="renforts-rien">Aucun renfort ne tourne.</p>
      )}
      {part.historique.length ? (
        <div className="mt-1.5" data-testid="renforts-historique" data-ouvert={histo ? 'oui' : 'non'}>
          <button type="button" onClick={() => setHisto(!histo)} aria-expanded={histo} data-testid="renforts-historique-ouvrir"
            className="inline-flex items-center gap-0.5 text-xs text-texte-2 underline-offset-2 hover:underline">
            {part.libelleHistorique}
            <ChevronDown size={14} className={`transition ${histo ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {histo ? (
            <ul className="mt-1 divide-y divide-bord/70 rounded-xl border border-bord" data-testid="renforts-historique-liste">
              {part.historique.map((r) => ligneJsx(r, true))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {nErreurs ? (
        <div className="mt-1.5 flex items-center justify-between gap-2" data-testid="renforts-erreurs">
          <p className="text-xs text-texte-2">{nErreurs} ligne{nErreurs > 1 ? 's' : ''} en erreur{etat.erreurs_efface_h ? ` (effacées seules après ${etat.erreurs_efface_h} h)` : ''}</p>
          <Button taille="sm" chargement={enCours === 'effacer'} onClick={() => void effacer()} data-testid="renforts-effacer">Effacer les erreurs</Button>
        </div>
      ) : null}
      <button type="button" onClick={() => setReglages(!reglages)} aria-expanded={reglages} data-testid="renforts-reglages-ouvrir"
        className="mt-2 inline-flex items-center gap-0.5 text-xs text-texte-2 underline-offset-2 hover:underline">
        Réglages : {etat.sessions_max} session{etat.sessions_max > 1 ? 's' : ''} au plus, {etat.agents_par_session} agent{etat.agents_par_session > 1 ? 's' : ''} chacune
        <ChevronDown size={14} className={`transition ${reglages ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {reglages ? <ReglagesRenforts projet={projet} etat={etat} onFini={() => { setReglages(false); void charger() }} /> : null}
      {reglages ? <ReglagesModeles projet={projet} /> : null}
      {reglages ? <ReglageRenouvellement projet={projet} /> : null}
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
    <section aria-label={`${LIBELLE_LANCER}${avecNom ? ` · ${projet.nom}` : ''}`} data-testid="traiter" data-projet={projet.slug}
      className="rounded-2xl border-2 border-accent bg-carte px-3 py-3">
      <h2 className="text-[15px] font-semibold">{LIBELLE_LANCER}{avecNom ? <span className="ml-1.5 text-sm font-normal text-texte-2">{projet.nom}</span> : null}</h2>
      <p className="mt-0.5 text-xs leading-snug text-texte-2" data-testid="traiter-etat">{etatTraiter(etat, g.now)}</p>
      <Button variante="primaire" pleine className="mt-2.5" onClick={() => void lancer()} data-testid="traiter-lancer">
        <Play size={16} aria-hidden />{LIBELLE_LANCER}
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
  const [auto, setAuto] = useState(etat.auto?.actif ?? true)
  const [seuil, setSeuil] = useState(etat.auto && !etat.auto.seuil_defaut ? String(etat.auto.seuil) : '')
  const [efface, setEfface] = useState(String(etat.erreurs_efface_h ?? 6))
  const [envoi, setEnvoi] = useState(false)
  const enregistrer = async () => {
    const pb = erreurReglageRenforts(sessions, agents) ?? erreurSeuilAuto(seuil) ?? erreurEffacement(Number(efface))
    if (pb) { toast.erreur(pb); return }
    setEnvoi(true)
    const r1 = await supabase.rpc('regler_renforts', { p_projet: projet.slug, p_sessions: sessions, p_agents: agents })
    const r2 = r1.error ? null : await supabase.rpc('regler_renforts_auto', { p_projet: projet.slug, p_actif: auto, p_seuil: seuil.trim() === '' ? null : Number(seuil) })
    setEnvoi(false)
    const r3 = r1.error || r2?.error ? null : await supabase.rpc('regler_renforts_erreurs', { p_projet: projet.slug, p_heures: Number(efface) })
    const error = r1.error ?? r2?.error ?? r3?.error
    if (error) { toast.erreur(`Réglage non enregistré : ${messageErreur(error)}`); return }
    toast.succes(`Renforts : ${sessions} session${sessions > 1 ? 's' : ''} au plus, ${agents} agent${agents > 1 ? 's' : ''} chacune ; ouverture automatique ${auto ? 'allumée' : 'éteinte'}.`)
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
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-5 w-5" data-testid="renforts-auto-case" />
          Ouvrir des renforts automatiquement
        </label>
        <label className="mt-1.5 block text-xs text-texte-2">Seuil de l’alerte « session bientôt saturée » (l’ouverture, elle, se fait dès 1 chantier ; vide = agents par session)
          <input type="number" inputMode="numeric" min={1} max={20} value={seuil} placeholder={String(agents)} disabled={!auto} onChange={(e) => setSeuil(e.target.value)}
            className="ml-2 h-9 w-16 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums disabled:opacity-50" data-testid="renforts-auto-seuil" />
        </label>
      </div>
      <label className="block text-xs text-texte-2">Effacer les lignes en erreur après (heures, 0 = jamais)
        <input type="number" inputMode="numeric" min={0} max={168} value={efface} onChange={(e) => setEfface(e.target.value)}
          className="ml-2 h-9 w-16 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums" data-testid="renforts-efface-h" />
      </label>
      <div className="flex justify-end gap-2">
        <Button taille="sm" onClick={onFini}>Annuler</Button>
        <Button taille="sm" variante="primaire" chargement={envoi} onClick={() => void enregistrer()} data-testid="renforts-enregistrer">Enregistrer</Button>
      </div>
    </div>
  )
}

/**
 * Renouvellement automatique de la session chef (0068) : au-delà du seuil de jetons de son contexte, elle finit ses
 * agents en cours, ouvre une nouvelle session chef et s'archive. Réglable ici ; la règle vit en base (chef_a_renouveler).
 */
interface EtatRenouvellement { auto: boolean; seuil: number; jetons: number | null; jetons_at: string | null; depasse: boolean; agents: number; demande_at: string | null; erreur: string | null }
function libelleRenouvellement(e: EtatRenouvellement): string {
  if (e.seuil === 0 || !e.auto) return 'Renouvellement éteint : la session chef reste la même jusqu’à son arrêt.'
  const n = (v: number) => v.toLocaleString('fr-FR')
  const base = e.jetons == null ? `Jetons de la session chef pas encore relevés (seuil ${n(e.seuil)}).` : `Session chef : ${n(e.jetons)} jetons sur ${n(e.seuil)}.`
  if (e.erreur) return `${base} Dernier renouvellement échoué : ${e.erreur}`
  if (e.depasse) return `${base} Seuil atteint : elle finit ses ${e.agents} agent(s) puis passe la main à une nouvelle session.`
  return base
}
function ReglageRenouvellement({ projet }: { projet: Projet }) {
  const toast = useToast()
  const [etat, setEtat] = useState<EtatRenouvellement | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const [seuil, setSeuil] = useState(500000)
  const [envoi, setEnvoi] = useState(false)
  const lire = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_renouvellement', { p_projet: projet.slug })
    if (error) { setErreur(messageErreur(error)); return }
    const e = data as EtatRenouvellement | null
    if (!e) return
    setErreur(null); setEtat(e); setAuto(e.auto); setSeuil(e.seuil)
  }, [projet.slug])
  useEffect(() => { void lire() }, [lire])
  const enregistrer = async () => {
    if (!Number.isInteger(seuil) || !(seuil === 0 || (seuil >= 50000 && seuil <= 5000000))) { toast.erreur('Seuil de jetons : de 50 000 à 5 000 000 (0 = jamais).'); return }
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_renouvellement', { p_projet: projet.slug, p_auto: auto, p_seuil: seuil })
    setEnvoi(false)
    if (error) { toast.erreur(`Renouvellement non enregistré : ${messageErreur(error)}`); return }
    toast.succes(auto && seuil > 0 ? `Renouvellement enregistré : la session chef est remplacée à ${seuil.toLocaleString('fr-FR')} jetons.` : 'Renouvellement éteint.')
    void lire()
  }
  if (erreur) return <p className="mt-2 text-xs text-alerte" data-testid="renouvellement-erreur">Renouvellement indisponible : {erreur}</p>
  if (!etat) return <p className="mt-2 text-xs text-texte-2" role="status">Chargement du renouvellement…</p>
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-bord bg-carte-2/40 p-2.5 text-sm" data-testid="renouvellement-reglages">
      <p className="text-xs font-medium">Renouvellement de la session chef</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-texte-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="renouvellement-auto" />
          Ouvrir une nouvelle session chef quand l’actuelle est trop chargée
        </label>
        <label className="text-xs text-texte-2">à (jetons, 50 000 à 5 000 000)
          <input type="number" inputMode="numeric" min={0} max={5000000} step={50000} value={seuil} disabled={!auto} onChange={(e) => setSeuil(Number(e.target.value))}
            className="ml-2 h-9 w-28 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums" data-testid="renouvellement-seuil" />
        </label>
      </div>
      <p className={`text-xs leading-snug ${etat.depasse || etat.erreur ? 'text-alerte' : 'text-texte-2'}`} data-testid="renouvellement-etat">{libelleRenouvellement(etat)}</p>
      <div className="flex justify-end">
        <Button taille="sm" variante="primaire" chargement={envoi} onClick={() => void enregistrer()} data-testid="renouvellement-enregistrer">Enregistrer</Button>
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
  const [leger, setLeger] = useState<ModeleClaude>('sonnet')
  const [effort, setEffort] = useState<EffortClaude>('moyen')
  const [agents, setAgents] = useState(2)
  const [revueH, setRevueH] = useState(24)
  const [seuil, setSeuil] = useState(50)
  const [haikuOk, setHaikuOk] = useState(true)
  const [fermAuto, setFermAuto] = useState(true)
  const [fermMin, setFermMin] = useState(10)
  const { rechargerProjets } = useGlobal()
  const [sansSigne, setSansSigne] = useState(projet.delai_sans_signe_min ?? DELAI_ABANDON_MIN)
  useEffect(() => { setSansSigne(projet.delai_sans_signe_min ?? DELAI_ABANDON_MIN) }, [projet.delai_sans_signe_min])
  const [envoi, setEnvoi] = useState(false)
  const lire = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_modeles', { p_projet: projet.slug })
    if (error) { setErreur(messageErreur(error)); return }
    const e = data as EtatModeles | null
    if (!e) return
    const f = await supabase.rpc('etat_fermeture', { p_projet: projet.slug })
    if (!f.error && f.data) { const ff = f.data as { auto: boolean; delai_min: number }; setFermAuto(ff.auto); setFermMin(ff.delai_min) }
    setErreur(null); setEtat(e); setCode(e.modele_code); setLeger(e.modele_leger); setEffort(e.effort); setAgents(e.agents); setRevueH(e.revue_h); setSeuil(e.bascule_seuil_pct ?? 50); setHaikuOk(e.bascule_haiku !== false)
  }, [projet.slug])
  useEffect(() => { void lire() }, [lire])
  const enregistrer = async () => {
    const pb = erreurReglageModeles(agents, revueH) ?? erreurReglageFermeture(fermMin) ?? erreurSeuilBascule(seuil) ?? erreurDelaiSansSigne(sansSigne)
    if (pb) { toast.erreur(pb); return }
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_modeles', { p_projet: projet.slug, p_code: code, p_leger: leger, p_effort: effort, p_agents: agents, p_revue_h: revueH })
    const rb = error ? null : await supabase.rpc('regler_bascule_seuils', { p_projet: projet.slug, p_seuil: seuil, p_haiku: haikuOk })
    const rf = error || rb?.error ? null : await supabase.rpc('regler_fermeture', { p_projet: projet.slug, p_auto: fermAuto, p_delai_min: fermMin })
    const rs = error || rb?.error || rf?.error ? null : await supabase.rpc('regler_sans_signe', { p_projet: projet.slug, p_min: sansSigne })
    setEnvoi(false)
    if (error) { toast.erreur(`Modèles non enregistrés : ${messageErreur(error)}`); return }
    if (rb?.error) { toast.erreur(`Bascule non enregistrée : ${messageErreur(rb.error)}`); return }
    if (rf?.error) { toast.erreur(`Fermeture des sessions non enregistrée : ${messageErreur(rf.error)}`); return }
    if (rs?.error) { toast.erreur(`Délai sans signe de vie non enregistré : ${messageErreur(rs.error)}`); return }
    void rechargerProjets()
    toast.succes(`Réglages enregistrés : les modèles servent aux prochains agents lancés ; une réservation sans signe de vie depuis ${sansSigne} min est libérée.`)
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
      <div className="flex flex-wrap items-center gap-3" data-testid="bascule-reglages">
        <label className="text-xs text-texte-2">Plein gaz jusqu’à (% de la fenêtre d’usage, 10 à 90)
          <input type="number" inputMode="numeric" min={10} max={90} value={seuil} onChange={(e) => setSeuil(Number(e.target.value))}
            className="ml-2 h-9 w-16 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums" data-testid="bascule-seuil" />
        </label>
        <label className="flex items-center gap-2 text-xs text-texte-2">
          <input type="checkbox" checked={haikuOk} onChange={(e) => setHaikuOk(e.target.checked)} data-testid="bascule-haiku" />
          Autoriser Haiku en dernier recours (limite proche)
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3" data-testid="fermeture-reglages">
        <label className="flex items-center gap-2 text-xs text-texte-2">
          <input type="checkbox" checked={fermAuto} onChange={(e) => setFermAuto(e.target.checked)} data-testid="fermeture-auto" />
          Fermer les sessions ouvertes par le cockpit quand elles ont fini
        </label>
        <label className="text-xs text-texte-2">après (minutes)
          <input type="number" inputMode="numeric" min={0} max={1440} value={fermMin} disabled={!fermAuto} onChange={(e) => setFermMin(Number(e.target.value))}
            className="ml-2 h-9 w-16 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums" data-testid="fermeture-delai" />
        </label>
      </div>
      <div data-testid="sans-signe-reglage">
        <label className="text-xs text-texte-2">Libérer un chantier réservé sans signe de vie depuis (minutes, {DELAI_ABANDON_MIN_BORNES.min} à {DELAI_ABANDON_MIN_BORNES.max})
          <input type="number" inputMode="numeric" min={DELAI_ABANDON_MIN_BORNES.min} max={DELAI_ABANDON_MIN_BORNES.max} value={sansSigne} onChange={(e) => setSansSigne(Number(e.target.value))}
            className="ml-2 h-9 w-16 rounded-lg border border-bord bg-carte px-2 text-sm tabular-nums" data-testid="sans-signe-delai" />
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
    </div>
  )
}
