import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Chantier, Moi } from '../lib/types.ts'
import { GlobalCtx, type Contexte, type Global } from '../contexte.ts'
import { useDonnees, VUE_TOUT } from '../hooks/useDonnees.ts'
import { usePreferences } from '../hooks/usePreferences.ts'
import type { Theme } from '../hooks/useTheme.ts'
import { chantiersEnAttente } from '../lib/ouJenSuis.ts'
import { CLE_PREF_SILENCE, silenceMsDe } from '../lib/presence.ts'
import { pastillesProjet } from '../lib/entonnoir.ts'
import { EnTete, type ActionMenu, type Pastilles } from './EnTete.tsx'
import { AvecProjet } from './AvecProjet.tsx'
import { BarreProjet, ProjetsResume } from './BarreProjet.tsx'
import { EnCeMoment } from './EnCeMoment.tsx'
import { VueEnsemble } from './VueEnsemble.tsx'
import { AToi } from './AToi.tsx'
import { ALancer } from './ALancer.tsx'
import { TousLesChantiers, cleDuChantier } from './TousLesChantiers.tsx'
import { NouveauChantier } from './NouveauChantier.tsx'
import { ModifierChantier } from './ModifierChantier.tsx'
import { Sections } from './Sections.tsx'
import { Doublons, DoublonDe } from './Doublons.tsx'
import { BarreSelection } from './BarreSelection.tsx'
import { Reglages } from './Reglages.tsx'
import { ProjetsMembres } from './ProjetsMembres.tsx'
import { Chargement, Erreur, Vide } from '../ui/Etats.tsx'
import { Button } from '../ui/Button.tsx'

type Dialogue = 'nouveau' | 'sections' | 'doublons' | 'reglages' | 'projets' | null

/** La présence se recalcule toute seule, même sans événement : une session qui se tait passe de 🟢 à 🟡. */
export const TIC_PRESENCE_MS = 30_000

/**
 * L'écran unique. Deux vues, le même entonnoir (En ce moment / À toi / À
 * lancer) : l'onglet « Tout » (tous les projets, l'accueil) et la vue d'un
 * projet, qui ajoute « Tous les chantiers » en dessous. Tient l'état
 * d'interface (cartes et sections ouvertes, sélection, dialogues).
 */
export function Cockpit({ moi, theme, changerTheme, seDeconnecter }: { moi: Moi; theme: Theme; changerTheme: (t: Theme) => void; seDeconnecter: () => Promise<void> }) {
  const d = useDonnees(true)
  const { prefs, poser } = usePreferences(moi.user_id)
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())
  const [sectionsOuvertes, setSectionsOuvertes] = useState<Set<string>>(new Set())
  const [cible, setCible] = useState<string | null>(null)
  const [dialogue, setDialogue] = useState<Dialogue>(null)
  const [aModifier, setAModifier] = useState<Chantier | null>(null)
  const [doublonDe, setDoublonDe] = useState<Chantier | null>(null)
  const [selectionActive, setSelectionActive] = useState(false)
  const [selectionIds, setSelectionIds] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(() => new Date())
  const admin = moi.admin

  // L'horloge de la présence : toutes les 30 s, et à chaque donnée reçue.
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), TIC_PRESENCE_MS); return () => window.clearInterval(t) }, [])
  useEffect(() => { if (d.derniereMaj) setNow(new Date()) }, [d.derniereMaj])

  const silenceMs = silenceMsDe(prefs[CLE_PREF_SILENCE])
  const enAttente = useMemo(() => chantiersEnAttente(d.messages), [d.messages])
  const parProjet = useMemo(() => new Map(d.projets.map((p) => [p.id, {
    sections: d.sections.filter((s) => s.projet_id === p.id),
    chantiers: d.chantiers.filter((c) => c.projet_id === p.id),
    messages: d.messages.filter((m) => m.projet_id === p.id),
    activites: d.activites.filter((a) => a.projet_id === p.id),
    sessions: d.sessions.filter((x) => x.projet_id === p.id),
    taches: d.taches.filter((x) => x.projet_id === p.id),
  }])), [d.projets, d.sections, d.chantiers, d.messages, d.activites, d.sessions, d.taches])
  const sectionsConnues = useMemo(() => new Set(d.sections.map((s) => s.id)), [d.sections])
  const vue = d.vue ?? VUE_TOUT
  const vueTout = vue === VUE_TOUT

  const changerVue = useCallback((id: string) => {
    d.choisirVue(id)
    setOuverts(new Set()); setSelectionActive(false); setSelectionIds(new Set())
    window.scrollTo({ top: 0 })
  }, [d.choisirVue]) // eslint-disable-line react-hooks/exhaustive-deps

  const ouvrirChantier = useCallback((projetId: string, chantierId: string) => {
    if (vue !== projetId) changerVue(projetId)
    setOuverts((s) => new Set(s).add(chantierId))
    const c = d.chantiers.find((x) => x.id === chantierId)
    if (c) setSectionsOuvertes((s) => new Set(s).add(cleDuChantier(c, sectionsConnues)))
    setCible(chantierId)
  }, [vue, changerVue, d.chantiers, sectionsConnues])

  // Faire défiler jusqu'à la carte ouverte, une fois qu'elle est rendue (changement de vue, section dépliée).
  useEffect(() => {
    if (!cible) return
    let essais = 0
    let t = 0
    const essayer = () => {
      const el = document.querySelector(`[data-testid="tous-les-chantiers"] [data-chantier="${cible}"]`)
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); setCible(null) }
      else if (essais++ < 25) t = window.setTimeout(essayer, 60)
      else setCible(null)
    }
    t = window.setTimeout(essayer, 30)
    return () => window.clearTimeout(t)
  }, [cible])

  const basculer = useCallback((id: string) => setOuverts((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const basculerSection = useCallback((cle: string) => setSectionsOuvertes((s) => { const n = new Set(s); if (n.has(cle)) n.delete(cle); else n.add(cle); return n }), [])
  const deplierTout = useCallback((cles: string[] | null) => setSectionsOuvertes((s) => {
    if (!cles) return new Set([...s].filter((k) => !k.startsWith(`${vue}:`) || k.endsWith(':__actif') || k.endsWith(':__archives')))
    return new Set([...s, ...cles])
  }), [vue])
  const recharger = useCallback(() => d.recharger(true), [d.recharger]) // eslint-disable-line react-hooks/exhaustive-deps
  const selection = useMemo(() => ({
    actif: selectionActive, ids: selectionIds,
    basculer: (id: string) => setSelectionIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }),
  }), [selectionActive, selectionIds])

  const contexteDe = useCallback((projetId: string): Contexte | null => {
    const projet = d.projets.find((p) => p.id === projetId)
    const x = parProjet.get(projetId)
    if (!projet || !x) return null
    return {
      moi, admin, par: moi.email, projet, ...x, enAttente, now, silenceMs, recharger, prefs, poser, selection,
      ouvrirModifier: setAModifier, ouvrirDoublonDe: setDoublonDe, ouvrirChantier: (id: string) => ouvrirChantier(projetId, id),
    }
  }, [d.projets, parProjet, moi, admin, enAttente, now, silenceMs, recharger, prefs, poser, selection, ouvrirChantier])

  const global: Global = {
    moi, admin, par: moi.email, projets: d.projets, sections: d.sections, chantiers: d.chantiers, messages: d.messages, activites: d.activites,
    sessions: d.sessions, taches: d.taches, now, silenceMs, prefs, poser, recharger, rechargerProjets: d.rechargerProjets, vue, ouvrirChantier, contexteDe,
  }

  const pastilles = useMemo(() => {
    const m = new Map<string, Pastilles>()
    m.set(VUE_TOUT, pastillesProjet(d.chantiers, d.messages, d.activites, d.sessions, d.taches, now, silenceMs, null))
    for (const p of d.projets) m.set(p.id, pastillesProjet(d.chantiers, d.messages, d.activites, d.sessions, d.taches, now, silenceMs, p.id))
    return m
  }, [d.projets, d.chantiers, d.messages, d.activites, d.sessions, d.taches, now, silenceMs])

  const onMenu = (a: ActionMenu) => {
    if (a === 'choisir') { setSelectionActive((v) => !v); setSelectionIds(new Set()); return }
    setDialogue(a)
  }

  if (d.chargementProjets && !d.projets.length) return <Chargement texte="Chargement des projets…" />
  if (d.erreur && !d.projets.length) return <div className="p-4"><Erreur texte={d.erreur} onReessayer={() => void d.chargerProjets()} /></div>

  const entete = (
    <EnTete projets={d.projets} projet={d.projet} vueTout={vueTout} choisirVue={changerVue} pastilles={pastilles} admin={admin} chargement={d.chargement} direct={d.direct}
      derniereMaj={d.derniereMaj} onActualiser={() => void d.recharger()} onNouveau={() => setDialogue('nouveau')} onMenu={onMenu} selectionActive={selectionActive} />
  )
  const reglages = <Reglages ouvert={dialogue === 'reglages'} onFermer={() => setDialogue(null)} theme={theme} changerTheme={changerTheme} onProjets={() => setDialogue('projets')} seDeconnecter={seDeconnecter} />
  const projetsMembres = admin ? <ProjetsMembres ouvert={dialogue === 'projets'} onFermer={() => setDialogue(null)} projets={d.projets} chargerProjets={d.chargerProjets} /> : null

  if (!d.projets.length) {
    return (
      <GlobalCtx.Provider value={global}>
        <div className="min-h-dvh">
          {entete}
          <main className="mx-auto max-w-3xl p-4">
            {admin
              ? <Vide emoji="🏗️" titre="Aucun projet" texte="Crée le premier : un nom, un slug, une couleur." action={<Button variante="primaire" onClick={() => setDialogue('projets')}>+ Créer un projet</Button>} />
              : <Vide emoji="🔒" titre="Aucun projet pour toi" texte={<>Demande à Raphaël de t’ajouter à ton projet avec cette adresse : <b>{moi.email}</b>.</>} action={<Button onClick={() => void seDeconnecter()}>Se déconnecter</Button>} />}
          </main>
          {reglages}
          {projetsMembres}
        </div>
      </GlobalCtx.Provider>
    )
  }

  const pretAffichage = d.charge || !!d.erreur
  return (
    <GlobalCtx.Provider value={global}>
      <div className={`min-h-dvh ${selectionActive && !vueTout ? 'pb-40' : 'pb-8'}`}>
        {entete}
        <main className="mx-auto max-w-3xl space-y-3 px-3 pt-3">
          {d.erreur ? <Erreur texte={d.erreur} onReessayer={() => void d.recharger()} /> : null}
          {!pretAffichage ? <Chargement /> : vueTout || !d.projet ? (
            <div className="space-y-3" data-testid="vue-tout">
              <VueEnsemble projetId={null} />
              <EnCeMoment projetId={null} />
              <AToi projetId={null} />
              <ALancer projetId={null} />
              <ProjetsResume />
            </div>
          ) : (
            <AvecProjet projetId={d.projet.id}>
              <div className="space-y-3" data-testid="vue-projet">
                <VueEnsemble projetId={d.projet.id} />
                <BarreProjet projet={d.projet} />
                <EnCeMoment projetId={d.projet.id} />
                <AToi projetId={d.projet.id} />
                <ALancer projetId={d.projet.id} />
                <TousLesChantiers ouverts={ouverts} basculer={basculer} sectionOuverte={(k) => sectionsOuvertes.has(k)} basculerSection={basculerSection}
                  deplierTout={deplierTout} onNouveau={() => setDialogue('nouveau')} />
              </div>
            </AvecProjet>
          )}
        </main>

        {!vueTout && d.projet ? (
          <AvecProjet projetId={d.projet.id}>
            <NouveauChantier ouvert={dialogue === 'nouveau'} onFermer={() => setDialogue(null)} />
            {admin ? (
              <>
                <ModifierChantier chantier={aModifier} onFermer={() => setAModifier(null)} />
                <Sections ouvert={dialogue === 'sections'} onFermer={() => setDialogue(null)} />
                <Doublons ouvert={dialogue === 'doublons'} onFermer={() => setDialogue(null)} />
                <DoublonDe source={doublonDe} onFermer={() => setDoublonDe(null)} />
                {selectionActive ? <BarreSelection onQuitter={() => { setSelectionActive(false); setSelectionIds(new Set()) }} /> : null}
              </>
            ) : null}
          </AvecProjet>
        ) : null}
        {reglages}
        {projetsMembres}
      </div>
    </GlobalCtx.Provider>
  )
}
