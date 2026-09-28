import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Chantier, Moi } from '../lib/types.ts'
import { CockpitCtx, type Filtre } from '../contexte.ts'
import { useDonnees } from '../hooks/useDonnees.ts'
import { usePreferences } from '../hooks/usePreferences.ts'
import type { Theme } from '../hooks/useTheme.ts'
import { chantiersEnAttente } from '../lib/ouJenSuis.ts'
import { EnTete, type ActionMenu } from './EnTete.tsx'
import { BandeauMaintenant } from './BandeauMaintenant.tsx'
import { Alertes } from './Alertes.tsx'
import { OuJenSuis } from './OuJenSuis.tsx'
import { Bacs } from './Bacs.tsx'
import { BlocQuestion } from './BlocQuestion.tsx'
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

/** L'écran unique. Tient l'état d'interface (filtre, sélection, dialogues) et fournit le contexte. */
export function Cockpit({ moi, theme, changerTheme, seDeconnecter }: { moi: Moi; theme: Theme; changerTheme: (t: Theme) => void; seDeconnecter: () => Promise<void> }) {
  const d = useDonnees(true)
  const { prefs, poser } = usePreferences(moi.user_id)
  const [filtre, setFiltre] = useState<Filtre | null>(null)
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())
  const [dialogue, setDialogue] = useState<Dialogue>(null)
  const [aModifier, setAModifier] = useState<Chantier | null>(null)
  const [doublonDe, setDoublonDe] = useState<Chantier | null>(null)
  const [selectionActive, setSelectionActive] = useState(false)
  const [selectionIds, setSelectionIds] = useState<Set<string>>(new Set())
  const admin = moi.admin

  const enAttente = useMemo(() => chantiersEnAttente(d.messages), [d.messages])
  const questionsProjet = useMemo(() => d.messages.filter((m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at && !m.chantier_id), [d.messages])

  // Changer de projet remet l'écran à zéro (filtre, cartes, sélection).
  useEffect(() => { setFiltre(null); setOuverts(new Set()); setSelectionActive(false); setSelectionIds(new Set()) }, [d.projetId])

  const basculer = useCallback((id: string) => setOuverts((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const voirChantier = useCallback((id: string) => {
    setFiltre(null); setOuverts((s) => new Set(s).add(id))
    setTimeout(() => document.querySelector(`[data-chantier="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }, [])
  const poserFiltre = useCallback((f: Filtre | null) => {
    setFiltre(f)
    if (f) setTimeout(() => document.querySelector('[data-testid="bacs"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [])
  const onMenu = (a: ActionMenu) => {
    if (a === 'choisir') { setSelectionActive((v) => !v); setSelectionIds(new Set()); return }
    setDialogue(a)
  }
  const recharger = useCallback(() => d.recharger(true), [d.recharger]) // eslint-disable-line react-hooks/exhaustive-deps

  if (d.chargementProjets && !d.projets.length) return <Chargement texte="Chargement des projets…" />
  if (d.erreur && !d.projets.length) return <div className="p-4"><Erreur texte={d.erreur} onReessayer={() => void d.chargerProjets()} /></div>

  const entete = (
    <EnTete projets={d.projets} projet={d.projet} choisirProjet={d.choisirProjet} admin={admin} chargement={d.chargement} direct={d.direct}
      derniereMaj={d.derniereMaj} onActualiser={() => void d.recharger()} onNouveau={() => setDialogue('nouveau')} onMenu={onMenu} selectionActive={selectionActive} />
  )

  if (!d.projet) {
    return (
      <div className="min-h-dvh">
        {entete}
        <main className="mx-auto max-w-3xl p-4">
          {admin
            ? <Vide emoji="🏗️" titre="Aucun projet" texte="Crée le premier : un nom, un slug, une couleur." action={<Button variante="primaire" onClick={() => setDialogue('projets')}>+ Créer un projet</Button>} />
            : <Vide emoji="🔒" titre="Aucun projet pour toi" texte={<>Demande à Raphaël de t’ajouter à ton projet avec cette adresse : <b>{moi.email}</b>.</>} action={<Button onClick={() => void seDeconnecter()}>Se déconnecter</Button>} />}
        </main>
        {admin ? <ProjetsMembres ouvert={dialogue === 'projets'} onFermer={() => setDialogue(null)} projets={d.projets} chargerProjets={d.chargerProjets} /> : null}
      </div>
    )
  }

  const contexte = {
    moi, admin, par: moi.email, projet: d.projet, sections: d.sections, chantiers: d.chantiers, messages: d.messages, activites: d.activites,
    enAttente, recharger, prefs, poser,
    selection: { actif: selectionActive, ids: selectionIds, basculer: (id: string) => setSelectionIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) },
    ouvrirModifier: setAModifier, ouvrirDoublonDe: setDoublonDe, poserFiltre,
  }

  return (
    <CockpitCtx.Provider value={contexte}>
      <div className={`min-h-dvh ${selectionActive ? 'pb-40' : 'pb-8'}`}>
        {entete}
        <main className="mx-auto max-w-3xl space-y-3 px-3 pt-3">
          {d.erreur ? <Erreur texte={d.erreur} onReessayer={() => void d.recharger()} /> : null}
          {d.chargement && !d.chantiers.length && !d.erreur ? <Chargement /> : (
            <>
              <BandeauMaintenant onVoirChantier={voirChantier} />
              <Alertes />
              <OuJenSuis onOuvrirReglages={() => setDialogue('reglages')} />
              {questionsProjet.length ? (
                <section className="space-y-2" data-testid="questions-projet">
                  <h2 className="px-1 text-sm font-bold text-alerte">Questions sur le projet (sans chantier)</h2>
                  {questionsProjet.map((q) => <BlocQuestion key={q.id} message={q} />)}
                </section>
              ) : null}
              <Bacs filtre={filtre} ouverts={ouverts} basculer={basculer} onNouveau={() => setDialogue('nouveau')} />
            </>
          )}
        </main>

        <NouveauChantier ouvert={dialogue === 'nouveau'} onFermer={() => setDialogue(null)} />
        <Reglages ouvert={dialogue === 'reglages'} onFermer={() => setDialogue(null)} theme={theme} changerTheme={changerTheme} onProjets={() => setDialogue('projets')} seDeconnecter={seDeconnecter} />
        {admin ? (
          <>
            <ModifierChantier chantier={aModifier} onFermer={() => setAModifier(null)} />
            <Sections ouvert={dialogue === 'sections'} onFermer={() => setDialogue(null)} />
            <Doublons ouvert={dialogue === 'doublons'} onFermer={() => setDialogue(null)} />
            <DoublonDe source={doublonDe} onFermer={() => setDoublonDe(null)} />
            <ProjetsMembres ouvert={dialogue === 'projets'} onFermer={() => setDialogue(null)} projets={d.projets} chargerProjets={d.chargerProjets} />
            {selectionActive ? <BarreSelection onQuitter={() => { setSelectionActive(false); setSelectionIds(new Set()) }} /> : null}
          </>
        ) : null}
      </div>
    </CockpitCtx.Provider>
  )
}
