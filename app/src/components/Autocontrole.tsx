import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, OctagonAlert, Info, Power } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Input } from '../ui/Champs.tsx'
import { ageEtHeure } from '../lib/dates.ts'
import { messageApresActivation } from '../lib/toutLancer.ts'
import { entierSaisi, erreurAutocontrole, ligneIncident, ordreIncidents, reglageAutocontrole, type Incident } from '../lib/incidents.ts'
import type { Projet } from '../lib/types.ts'

const SONDAGE_MS = 60_000

/** Les incidents ouverts (table `incidents`, 0105) : lus au chargement, au direct (postgres_changes) et toutes les 60 s au cas où le direct manque. */
function useIncidents(actif: boolean) {
  const [incidents, setIncidents] = useState<Incident[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const vivant = useRef(true)
  const charger = useCallback(async () => {
    const { data, error } = await supabase.from('incidents').select('*').eq('etat', 'ouvert').order('depuis', { ascending: true }).limit(100)
    if (!vivant.current) return
    if (error) { setErreur(messageErreur(error)); return }
    setErreur(null); setIncidents((data ?? []) as Incident[])
  }, [])
  useEffect(() => {
    if (!actif) return
    vivant.current = true
    void charger()
    const ch = supabase.channel('incidents-ouverts')
    ch.on('postgres_changes', { event: '*', schema: 'cockpit', table: 'incidents' }, () => { void charger() })
    ch.subscribe()
    const t = window.setInterval(() => { if (!document.hidden) void charger() }, SONDAGE_MS)
    return () => { vivant.current = false; window.clearInterval(t); void supabase.removeChannel(ch) }
  }, [actif, charger])
  return { incidents, erreur, recharger: charger }
}

/**
 * UNE ligne, tout en haut de l'écran principal (vue « Tout » et vue d'un projet) : « Problème : … » (ou « À savoir : … » quand c'est un choix
 * de Raphaël, comme le réveil automatique éteint). RIEN quand tout va bien. Un toucher ouvre le détail et, s'il en existe un, UN geste utile
 * (« Activer une session »). Le cockpit repère seul ses pannes (autocontrole_passe, 0105) et les résout seul : aucun bouton « fermer ».
 * Lecture impossible : la ligne le dit (« Autocontrôle illisible ») avec « Réessayer » ; tant qu'on charge, rien (pas de clignotement).
 */
export function LigneIncident({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const toast = useToast()
  const { incidents, erreur, recharger } = useIncidents(g.admin)
  const [ouvert, setOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const noms = useMemo(() => new Map(g.projets.filter((p) => p.actif).map((p) => [p.id, p.nom])), [g.projets])
  const slugs = useMemo(() => new Map(g.projets.map((p) => [p.id, p.slug])), [g.projets])
  const ligne = useMemo(() => (incidents ? ligneIncident(incidents, noms, projetId, g.now) : null), [incidents, noms, projetId, g.now])
  if (!g.admin) return null
  if (!incidents && erreur) return (
    <div role="alert" className="flex items-center gap-2 rounded-2xl border border-alerte/50 bg-carte px-3 py-2" data-testid="incident-erreur">
      <OctagonAlert size={17} className="shrink-0 text-alerte" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-snug">Autocontrôle illisible : {erreur}</p>
      <Button taille="sm" onClick={() => void recharger()} data-testid="incident-reessayer">Réessayer</Button>
    </div>
  )
  if (!ligne) return null
  const info = ligne.principal.gravite === 'info'
  const Icone = info ? Info : OctagonAlert
  const toutes = ordreIncidents(incidents ?? []).filter((i) => noms.has(i.projet_id) && (!projetId || i.projet_id === projetId))
  const activer = async () => {
    const slug = slugs.get(ligne.principal.projet_id)
    if (!slug || enCours) return
    setEnCours(true)
    const { data, error } = await supabase.rpc('activer_session', { p_projet: slug })
    setEnCours(false)
    const j = (data ?? null) as { resultat?: string; reveil_at?: string | null } | null
    const m = messageApresActivation([{ nom: noms.get(ligne.principal.projet_id) ?? slug, resultat: error ? null : (j?.resultat ?? null), reveil_at: j?.reveil_at ?? null, erreur: error ? messageErreur(error) : null }], new Date())
    if (m.ok) { toast.succes(m.texte); setOuvert(false) } else toast.erreur(m.texte)
    void recharger()
  }
  return (
    <>
      <button type="button" onClick={() => setOuvert(true)} data-testid="incident-ligne" data-gravite={ligne.principal.gravite} data-code={ligne.principal.code}
        className={`flex w-full items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[.99] ${info ? 'border-bord bg-carte hover:bg-carte-2' : 'border-alerte/60 bg-carte hover:bg-carte-2'}`}>
        <Icone size={18} className={`mt-0.5 shrink-0 ${info ? 'text-texte-2' : 'text-alerte'}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug" data-testid="incident-texte">{ligne.texte}</span>
          <span className="block text-xs text-texte-2" data-testid="incident-meta">
            {ligne.meta}{ligne.autres.length ? `${ligne.meta ? ' · ' : ''}+ ${ligne.autres.length} autre${ligne.autres.length > 1 ? 's' : ''}` : ''}
          </span>
        </span>
      </button>
      <Dialog ouvert={ouvert} onFermer={() => setOuvert(false)} titre={ligne.prefixe === 'Problème' ? 'Ce qui ne va pas' : 'À savoir'}
        pied={ligne.geste ? (
          <Button variante="primaire" taille="lg" pleine chargement={enCours} onClick={() => void activer()} data-testid="incident-geste"><Power size={16} aria-hidden />Activer une session</Button>
        ) : undefined}>
        <ul className="space-y-3" data-testid="incident-detail">
          {toutes.map((i) => (
            <li key={i.id} data-code={i.code} className="text-[15px] leading-snug">
              <p><span className="font-medium">{i.gravite === 'info' ? 'À savoir' : 'Problème'}</span> : {i.cause}</p>
              <p className="text-xs text-texte-2">
                {!projetId && noms.size > 1 ? `${noms.get(i.projet_id)} · ` : ''}depuis {ageEtHeure(i.depuis, g.now)}
                {i.detail?.reveil_at ? ` · dernier réveil ${ageEtHeure(i.detail.reveil_at, g.now)}` : ''}
              </p>
              {i.detail?.raisons?.length ? <p className="mt-0.5 text-xs text-texte-2">Ce qui attend : {i.detail.raisons.join(', ')}.</p> : null}
              {i.detail?.session_url ? (
                <a href={i.detail.session_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-lien underline" data-testid="incident-session">
                  <ExternalLink size={14} aria-hidden />Voir la session qui a été lancée
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-texte-2">Ça se règle tout seul dès que la cause disparaît : rien à fermer.</p>
      </Dialog>
    </>
  )
}

/**
 * Réglages du projet › « Autocontrôle » : après combien de temps le cockpit alerte quand du travail attend, quand il ferme une demande de
 * session restée sans suite, et combien de temps une erreur de session reste signalée. Admin seulement. Un message dit si ça a marché.
 */
export function AutocontroleProjet({ projet }: { projet: Projet }) {
  const g = useGlobal()
  const toast = useToast()
  const r = reglageAutocontrole(projet)
  const [delai, setDelai] = useState(String(r.delaiMin))
  const [nettoyage, setNettoyage] = useState(String(r.nettoyageMin))
  const [garde, setGarde] = useState(String(r.gardeH))
  const [enCours, setEnCours] = useState(false)
  const saisi = { delaiMin: entierSaisi(delai), nettoyageMin: entierSaisi(nettoyage), gardeH: entierSaisi(garde) }
  const refus = erreurAutocontrole(saisi)
  const inchange = saisi.delaiMin === r.delaiMin && saisi.nettoyageMin === r.nettoyageMin && saisi.gardeH === r.gardeH
  if (!g.admin) return null
  const enregistrer = async () => {
    if (refus) { toast.erreur(refus); return }
    setEnCours(true)
    const { error } = await supabase.rpc('regler_autocontrole', { p_projet: projet.slug, p_delai_min: saisi.delaiMin, p_nettoyage_min: saisi.nettoyageMin, p_garde_h: saisi.gardeH })
    setEnCours(false)
    if (error) { toast.erreur(`Réglage pas enregistré : ${messageErreur(error)}`); return }
    toast.succes(`${projet.nom} : autocontrôle réglé ✓`)
    await g.rechargerProjets()
  }
  const champ = (id: string, libelle: string, unite: string, valeur: string, set: (v: string) => void) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{libelle}</span>
      <Input className="!w-20" inputMode="numeric" aria-label={`${libelle} (${unite}) pour ${projet.nom}`} value={valeur} onChange={(e) => set(e.target.value)} data-testid={`autocontrole-${id}`} />
      <span className="text-sm text-texte-2">{unite}</span>
    </div>
  )
  return (
    <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="autocontrole-projet" data-projet={projet.slug}>
      <h3 className="text-sm font-semibold">Autocontrôle</h3>
      <p className="mt-0.5 text-xs text-texte-2">
        Le cockpit repère tout seul ce qui ne marche pas (du travail qui attend sans que rien ne démarre, une session qui s’arrête en erreur) et le dit en haut de l’écran.
        Il ne relance rien lui-même.
      </p>
      <div className="mt-2 space-y-2">
        {champ('delai', 'Prévenir quand du travail attend depuis', 'min', delai, setDelai)}
        {champ('nettoyage', 'Fermer une demande de session sans suite après', 'min', nettoyage, setNettoyage)}
        {champ('garde', 'Garder visible une erreur de session pendant', 'h', garde, setGarde)}
        <div className="flex flex-wrap items-center gap-2">
          <Button taille="sm" chargement={enCours} disabled={!!refus || inchange} onClick={() => void enregistrer()} data-testid="autocontrole-enregistrer">Enregistrer</Button>
          {refus ? <p className="text-xs text-alerte" data-testid="autocontrole-refus">{refus}</p> : <p className="text-xs text-texte-2">0 = ne jamais fermer une demande sans suite.</p>}
        </div>
      </div>
    </section>
  )
}
