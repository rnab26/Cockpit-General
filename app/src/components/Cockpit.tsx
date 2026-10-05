import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfirmer } from '../ui/Confirm.tsx'
import { CONFIRMER_ABANDON, aUnBrouillon } from '../ui/Modale.ts'
import type { Chantier, Moi } from '../lib/types.ts'
import { GlobalCtx, type Contexte, type Global } from '../contexte.ts'
import { useDonnees, VUE_TOUT } from '../hooks/useDonnees.ts'
import { usePreferences } from '../hooks/usePreferences.ts'
import type { Theme } from '../hooks/useTheme.ts'
import { chantiersEnAttente } from '../lib/ouJenSuis.ts'
import { CLE_PREF_SILENCE, silenceMsDe } from '../lib/presence.ts'
import { PREF_LU_DEPUIS, PREF_LU_FILS, lireLus, reponsesNonLues, totalNonLus } from '../lib/lecture.ts'
import { pastillesProjet } from '../lib/entonnoir.ts'
import { autonomeActif, chantiersPrenables, etatAutonome, travailEnCours } from '../lib/autonome.ts'
import { Layers, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase.ts'
import { EnTete, type ActionMenu, type Pastilles } from './EnTete.tsx'
import { AideInstallation, useLancerInstallation } from './InstallerAppli.tsx'
import { AvecProjet } from './AvecProjet.tsx'
import { TableauDeBord, ReglagesProjet, ReglagesProjets } from './TableauDeBord.tsx'
import { lireLienFil } from '../lib/lienNotification.ts'
import { chargerEtatEcran, etatCoherent, sauverEtatEcran } from '../lib/etatEcran.ts'
import { Conversation, type CibleConversation } from './Conversation.tsx'
import { BulleFlottanteAide } from './BulleFlottanteAide.tsx'
import { TousLesChantiers } from './TousLesChantiers.tsx'
import { NouveauChantier } from './NouveauChantier.tsx'
import { ModifierChantier } from './ModifierChantier.tsx'
import { Sections } from './Sections.tsx'
import { Doublons, DoublonDe } from './Doublons.tsx'
import { BarreSelection } from './BarreSelection.tsx'
import { Reglages } from './Reglages.tsx'
import { ProjetsMembres } from './ProjetsMembres.tsx'
import { OngletsProjet } from './OngletsProjet.tsx'
import { CoutsProjet } from './Depenses.tsx'
import { ONGLET_DEFAUT, type OngletProjet } from '../lib/vueProjet.ts'
import { BarreOnglets } from './BarreOnglets.tsx'
import { useNavMobile } from '../hooks/useNavMobile.ts'
import { ongletBarreActif, type OngletBarre } from '../lib/navMobile.ts'
import { Chargement, Erreur, Vide } from '../ui/Etats.tsx'
import { Button } from '../ui/Button.tsx'

type Dialogue = 'nouveau' | 'sections' | 'doublons' | 'reglages' | 'projets' | 'installer' | null

/** La présence se recalcule toute seule, même sans événement : une session qui se tait passe de « travaille » à « plus de nouvelles ». */
export const TIC_PRESENCE_MS = 30_000

/**
 * L'écran unique. Deux vues, le même tableau de bord (modèle A : tuiles, À toi
 * de jouer, Ça avance tout seul, Prêt à lancer) : l'onglet « Tout » (tous les
 * projets, l'accueil) et la vue d'un projet, qui ajoute « Tous les chantiers »
 * et ses réglages. Chaque chantier s'ouvre en conversation (modèle D), par-dessus,
 * sans changer d'onglet. Tient l'état d'interface (conversation ouverte,
 * sections dépliées, sélection, dialogues).
 */
export function Cockpit({ moi, theme, changerTheme, seDeconnecter }: { moi: Moi; theme: Theme; changerTheme: (t: Theme) => void; seDeconnecter: () => Promise<void> }) {
  const d = useDonnees(true, moi.email)
  const { prefs, poser, chargees } = usePreferences(moi.user_id)
  const [sectionsOuvertes, setSectionsOuvertes] = useState<Set<string>>(new Set())
  // Reprise après que le navigateur a vidé la page (retour d'un lien ouvert ailleurs) : où l'on en était.
  const reprise = useRef(etatCoherent(chargerEtatEcran(), /projet=([a-z0-9-]+)/.exec(location.hash)?.[1] ?? null))
  const [conversation, setConversation] = useState<CibleConversation | null>(reprise.current?.conversation ?? null)
  const [dialogue, setDialogue] = useState<Dialogue>(null)
  const installation = useLancerInstallation(() => setDialogue('installer'))
  const [aModifier, setAModifier] = useState<Chantier | null>(null)
  const [doublonDe, setDoublonDe] = useState<Chantier | null>(null)
  const [selectionActive, setSelectionActive] = useState(false)
  const [selectionIds, setSelectionIds] = useState<Set<string>>(new Set())
  const [onglet, setOnglet] = useState<OngletProjet>(reprise.current?.onglet ?? ONGLET_DEFAUT)
  const [recherche, setRecherche] = useState(false)
  const barreBas = useNavMobile()
  const dernierProjet = useRef<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const admin = moi.admin

  // L'horloge de la présence : toutes les 30 s, et à chaque donnée reçue.
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), TIC_PRESENCE_MS); return () => window.clearInterval(t) }, [])
  useEffect(() => { if (d.derniereMaj) setNow(new Date()) }, [d.derniereMaj])
  // Un report daté dont la date est passée revient dans « Prêt à lancer » (0028) : à l'ouverture, sans attendre la chef.
  const charge = d.charge
  useEffect(() => {
    if (!admin || !charge) return
    void supabase.rpc('reveiller_reportes', { p_projet_id: null }).then(({ data }) => { if (typeof data === 'number' && data > 0) void d.recharger(true) })
  }, [admin, charge]) // eslint-disable-line react-hooks/exhaustive-deps

  const silenceMs = silenceMsDe(prefs[CLE_PREF_SILENCE])
  // « Claude a répondu » : le plancher (`lu_depuis`) est posé une fois, au premier chargement, pour ne pas allumer tout l'historique.
  useEffect(() => { if (chargees && typeof prefs[PREF_LU_DEPUIS] !== 'string') void poser(PREF_LU_DEPUIS, new Date().toISOString()).catch(() => {}) }, [chargees, prefs, poser])
  const nonLus = useMemo(
    () => (typeof prefs[PREF_LU_DEPUIS] === 'string' ? reponsesNonLues(d.messages, lireLus(prefs[PREF_LU_FILS]), prefs[PREF_LU_DEPUIS] as string) : new Map()),
    [d.messages, prefs],
  )
  // Onglet du navigateur et icône de l'appli : le nombre de réponses à lire.
  const nbNonLus = totalNonLus(nonLus)
  useEffect(() => {
    document.title = nbNonLus ? `(${nbNonLus}) Cockpit` : 'Cockpit'
    try { const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }; void (nbNonLus ? nav.setAppBadge?.(nbNonLus) : nav.clearAppBadge?.())?.catch(() => {}) } catch { /* non supporté */ }
  }, [nbNonLus])
  const enAttente = useMemo(() => chantiersEnAttente(d.messages), [d.messages])
  const parProjet = useMemo(() => new Map(d.projets.map((p) => [p.id, {
    sections: d.sections.filter((s) => s.projet_id === p.id),
    chantiers: d.chantiers.filter((c) => c.projet_id === p.id),
    messages: d.messages.filter((m) => m.projet_id === p.id),
    activites: d.activites.filter((a) => a.projet_id === p.id),
    sessions: d.sessions.filter((x) => x.projet_id === p.id),
    taches: d.taches.filter((x) => x.projet_id === p.id),
  }])), [d.projets, d.sections, d.chantiers, d.messages, d.activites, d.sessions, d.taches])
  const vue = d.vue ?? VUE_TOUT
  const vueTout = vue === VUE_TOUT

  // Garde l'écran courant sur l'appareil (projet, onglet, fil ouvert, défilement) pour le reprendre au rechargement.
  const slugCourant = vueTout ? null : d.projet?.slug ?? null
  const etatRef = useRef({ slugCourant, onglet, conversation, pret: false })
  etatRef.current = { slugCourant, onglet, conversation, pret: d.vue !== null }
  useEffect(() => {
    const garder = () => {
      const e = etatRef.current
      if (!e.pret) return  // rien n'est encore restauré : ne pas écraser l'état sauvé par l'écran par défaut
      sauverEtatEcran({ slug: e.slugCourant, onglet: e.onglet, conversation: e.conversation, scrollY: window.scrollY, at: Date.now() })
    }
    garder()
    const siCache = () => { if (document.visibilityState === 'hidden') garder() }
    document.addEventListener('visibilitychange', siCache)
    window.addEventListener('pagehide', garder)
    return () => { document.removeEventListener('visibilitychange', siCache); window.removeEventListener('pagehide', garder) }
  }, [slugCourant, onglet, conversation, d.vue])
  // Fil rouvert par la reprise : une entrée d'historique, comme à l'ouverture normale (le retour du téléphone le ferme).
  useEffect(() => { if (reprise.current?.conversation) history.pushState({ conversation: true }, '', location.href) }, [])
  // Défilement repris une fois les données revenues (sinon la page est trop courte pour y aller).
  useEffect(() => {
    const y = reprise.current?.scrollY
    if (!d.charge || !y) return
    reprise.current = null
    requestAnimationFrame(() => window.scrollTo({ top: y }))
  }, [d.charge])

  const changerVue = useCallback((id: string) => {
    d.choisirVue(id)
    setOnglet(ONGLET_DEFAUT)  // on arrive toujours sur la zone chantiers
    setRecherche(false)
    setSelectionActive(false); setSelectionIds(new Set())
    window.scrollTo({ top: 0 })
  }, [d.choisirVue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Une conversation s'ouvre PAR-DESSUS l'écran (pas de changement d'onglet) ; le geste « retour »
  // du téléphone la ferme : une entrée d'historique est posée à l'ouverture, retirée à la fermeture.
  const ouvrirChantier = useCallback((projetId: string, chantierId: string | null) => {
    setConversation((avant) => {
      if (!avant) history.pushState({ conversation: true }, '', location.href)
      return { projetId, chantierId }
    })
  }, [])
  // Le « retour » lui-même est écouté par la conversation (elle protège un brouillon) : onRetour.
  const fermerConversation = useCallback(() => {
    if ((history.state as { conversation?: boolean } | null)?.conversation) history.back()
    else setConversation(null)
  }, [])
  const confirmer = useConfirmer()
  const confirmerRef = useRef(confirmer)
  confirmerRef.current = confirmer
  // Lien profond d'une notification « Claude a répondu » : ouvert au chargement (appli fermée) ou par message du service worker (appli ouverte).
  useEffect(() => {
    const aller = (hash: string) => {
      const c = lireLienFil(hash)
      if (!c) return
      history.replaceState(history.state, '', location.pathname + location.search)
      // Une conversation avec un brouillon non envoyé : même question que pour la fermer, avant de changer de fil.
      const ouverte = document.querySelector<HTMLElement>('[data-testid="conversation"]')
      if (!aUnBrouillon(ouverte)) { ouvrirChantier(c.projetId, c.chantierId); return }
      void confirmerRef.current(CONFIRMER_ABANDON).then((ok) => { if (ok) ouvrirChantier(c.projetId, c.chantierId) })
    }
    aller(location.hash)
    const surMessage = (e: MessageEvent) => { const m = e.data as { type?: string; url?: string } | null; if (m?.type === 'ouvrir-fil' && m.url) aller(m.url.slice(m.url.indexOf('#'))) }
    navigator.serviceWorker?.addEventListener('message', surMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', surMessage)
  }, [ouvrirChantier])
  const conversationQuittee = useCallback(() => setConversation(null), [])

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
      ouvrirModifier: setAModifier, ouvrirDoublonDe: setDoublonDe, ouvrirChantier: (id: string | null) => ouvrirChantier(projetId, id),
    }
  }, [d.projets, parProjet, moi, admin, enAttente, now, silenceMs, recharger, prefs, poser, selection, ouvrirChantier])

  const global: Global = {
    moi, admin, par: moi.email, projets: d.projets, sections: d.sections, chantiers: d.chantiers, messages: d.messages, activites: d.activites,
    sessions: d.sessions, taches: d.taches, now, silenceMs, prefs, poser, recharger, rechargerProjets: d.rechargerProjets, nonLus, vue, ouvrirChantier, contexteDe,
  }

  const pastilles = useMemo(() => {
    const m = new Map<string, Pastilles>()
    m.set(VUE_TOUT, pastillesProjet(d.chantiers, d.messages, d.activites, d.sessions, d.taches, now, silenceMs, null))
    for (const p of d.projets) {
      // Le mode autonome se voit sur chaque onglet (0031) ; ambre s'il tourne sans rien à prendre.
      const auto = admin && autonomeActif(p, now)
        ? (etatAutonome(p, chantiersPrenables(d.chantiers, p.id, now, d.activites, d.taches, d.sessions), travailEnCours(d.chantiers, d.taches, p.id, now), now).alerte ? 'alerte' : 'actif')
        : null
      m.set(p.id, { ...pastillesProjet(d.chantiers, d.messages, d.activites, d.sessions, d.taches, now, silenceMs, p.id), autonome: auto })
    }
    return m
  }, [d.projets, d.chantiers, d.messages, d.activites, d.sessions, d.taches, now, silenceMs, admin])

  // Barre du bas : chaque onglet change d'écran, jamais de fenêtre par-dessus (sauf Réglages de l'appli depuis l'accueil).
  if (!vueTout && d.projet) dernierProjet.current = d.projet.id
  const projetCourant = (): string | null => dernierProjet.current && d.projets.some((p) => p.id === dernierProjet.current) ? dernierProjet.current : (d.projets.find((p) => p.actif)?.id ?? d.projets[0]?.id ?? null)
  const surBarre = (o: OngletBarre) => {
    if (o === 'recherche') { setRecherche((v) => !v); return }
    setRecherche(false)
    window.scrollTo({ top: 0 })
    if (o === 'accueil') { changerVue(VUE_TOUT); return }
    if (o === 'reglages' && vueTout) { setDialogue('reglages'); return }
    const id = vueTout ? projetCourant() : d.projet?.id ?? null
    if (!id) return
    if (vueTout) changerVue(id)
    const cible: OngletProjet = o === 'couts' ? 'couts' : o === 'reglages' ? 'reglages' : 'travail'
    // Retour du téléphone : revient à l'onglet précédent (une entrée d'historique par changement), puis quitte.
    if (cible !== onglet) history.pushState({ onglet: cible }, '', location.href)
    setOnglet(cible)
  }
  useEffect(() => {
    const retour = (e: PopStateEvent) => {
      const s = e.state as { onglet?: OngletProjet; conversation?: boolean } | null
      if (s?.conversation) return
      setOnglet(s?.onglet ?? ONGLET_DEFAUT); setRecherche(false)
    }
    window.addEventListener('popstate', retour)
    return () => window.removeEventListener('popstate', retour)
  }, [])
  const aToiTotal = pastilles.get(VUE_TOUT)?.aToi ?? 0

  const onMenu = (a: ActionMenu) => {
    if (a === 'choisir') { setSelectionActive((v) => !v); setSelectionIds(new Set()); return }
    if (a === 'installer') { void installation.lancer(); return }
    setDialogue(a)
  }

  if (d.chargementProjets && !d.projets.length) return <Chargement texte="Chargement des projets…" />
  if (d.erreur && !d.projets.length) return <div className="p-4"><Erreur texte={d.erreur} onReessayer={() => void d.chargerProjets()} /></div>

  const entete = (
    <EnTete projets={d.projets} projet={d.projet} vueTout={vueTout} choisirVue={changerVue} pastilles={pastilles} admin={admin} chargement={d.chargement} direct={d.direct}
      derniereMaj={d.derniereMaj} rechargeDu={d.rechargeDu} onActualiser={() => void d.recharger()} onNouveau={() => setDialogue('nouveau')} onMenu={onMenu} selectionActive={selectionActive} installable={installation.etat !== 'installee'}
      recherche={recherche} onRecherche={setRecherche} barreBas={barreBas} />
  )
  const reglages = <Reglages ouvert={dialogue === 'reglages'} onFermer={() => setDialogue(null)} theme={theme} changerTheme={changerTheme} onProjets={() => setDialogue('projets')} seDeconnecter={seDeconnecter} onAideInstallation={() => setDialogue('installer')} />
  const aideInstallation = <AideInstallation ouvert={dialogue === 'installer'} onFermer={() => setDialogue(null)} />
  const projetsMembres = admin ? <ProjetsMembres ouvert={dialogue === 'projets'} onFermer={() => setDialogue(null)} projets={d.projets} chargerProjets={d.chargerProjets} /> : null

  if (!d.projets.length) {
    return (
      <GlobalCtx.Provider value={global}>
        <div className="min-h-dvh">
          {entete}
          <main className="mx-auto max-w-3xl lg:max-w-5xl p-4">
            {admin
              ? <Vide icone={<Layers size={28} strokeWidth={1.5} />} titre="Aucun projet" texte="Crée le premier : un nom, un slug, une couleur." action={<Button variante="primaire" onClick={() => setDialogue('projets')}>+ Créer un projet</Button>} />
              : <Vide icone={<Lock size={28} strokeWidth={1.5} />} titre="Aucun projet pour toi" texte={<>Demande à Raphaël de t’ajouter à ton projet avec cette adresse : <b>{moi.email}</b>.</>} action={<Button onClick={() => void seDeconnecter()}>Se déconnecter</Button>} />}
          </main>
          {reglages}
          {aideInstallation}
          {projetsMembres}
        </div>
      </GlobalCtx.Provider>
    )
  }

  const pretAffichage = d.charge || !!d.erreur
  return (
    <GlobalCtx.Provider value={global}>
      <div className={`min-h-dvh ${selectionActive && !vueTout ? 'pb-40' : barreBas ? 'pb-24' : 'pb-8'}`}>
        {entete}
        <main className="mx-auto max-w-3xl lg:max-w-5xl space-y-3 px-3 pt-4">
          {d.erreur ? <Erreur texte={d.erreur} onReessayer={() => void d.recharger()} /> : null}
          {!pretAffichage ? <Chargement /> : vueTout || !d.projet ? (
            <div className="space-y-5" data-testid="vue-tout">
              <TableauDeBord projetId={null} />
              <ReglagesProjets />
            </div>
          ) : (
            <AvecProjet projetId={d.projet.id}>
              <div className="space-y-5" data-testid="vue-projet">
                <TableauDeBord projetId={d.projet.id} seulementTuiles={onglet !== 'travail'} entre={barreBas ? undefined : <OngletsProjet actif={onglet} onChoisir={setOnglet} />} />
                {onglet === 'travail' ? (
                  <TousLesChantiers sectionOuverte={(k) => sectionsOuvertes.has(k)} basculerSection={basculerSection}
                    deplierTout={deplierTout} onNouveau={() => setDialogue('nouveau')} />
                ) : null}
                {onglet === 'reglages' ? <ReglagesProjet projetId={d.projet.id} /> : null}
                {onglet === 'couts' ? <CoutsProjet /> : null}
              </div>
            </AvecProjet>
          )}
        </main>

        {!vueTout && d.projet ? (
          <AvecProjet projetId={d.projet.id}>
            <NouveauChantier ouvert={dialogue === 'nouveau'} onFermer={() => setDialogue(null)} />
            {admin ? (
              <>
                <Sections ouvert={dialogue === 'sections'} onFermer={() => setDialogue(null)} />
                <Doublons ouvert={dialogue === 'doublons'} onFermer={() => setDialogue(null)} />
                {selectionActive ? <BarreSelection onQuitter={() => { setSelectionActive(false); setSelectionIds(new Set()) }} /> : null}
              </>
            ) : null}
          </AvecProjet>
        ) : null}
        {conversation ? (
          <AvecProjet projetId={conversation.projetId}>
            <Conversation key={`${conversation.projetId}:${conversation.chantierId}`} cible={conversation} onFermer={fermerConversation} onRetour={conversationQuittee} />
          </AvecProjet>
        ) : null}
        {/* Modifier / doublon : ouverts depuis une conversation, dans le projet du chantier (et par-dessus elle). */}
        {admin && aModifier ? <AvecProjet projetId={aModifier.projet_id}><ModifierChantier chantier={aModifier} onFermer={() => setAModifier(null)} /></AvecProjet> : null}
        {admin && doublonDe ? <AvecProjet projetId={doublonDe.projet_id}><DoublonDe source={doublonDe} onFermer={() => setDoublonDe(null)} /></AvecProjet> : null}
        {reglages}
        {aideInstallation}
        {projetsMembres}
        <BulleFlottanteAide />
        {barreBas ? <BarreOnglets actif={ongletBarreActif(vueTout, onglet, recherche)} onChoisir={surBarre} aToi={aToiTotal} /> : null}
      </div>
    </GlobalCtx.Provider>
  )
}
