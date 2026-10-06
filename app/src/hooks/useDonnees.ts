import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, messageErreur } from '../lib/supabase.ts'
import type { Activite, Chantier, Message, Projet, Section, SessionClaude, Tache } from '../lib/types.ts'
import { chargerEtatEcran } from '../lib/etatEcran.ts'
import { lignesVisibles, projetsVisibles } from '../lib/projetsDeTest.ts'
import { remplacerLigne, retirerLigne } from '../lib/reponseCarte.ts'

export type EtatDirect = 'connexion' | 'direct' | 'coupe'
export const INTERVALLE_SONDAGE_MS = 30_000
/** Absence minimale avant de tout relire au retour sur l'appli. */
export const RETOUR_MIN_MS = 20_000
type Table = 'sections' | 'chantiers' | 'messages' | 'activite' | 'sessions' | 'taches'
const TABLES: Table[] = ['sections', 'chantiers', 'messages', 'activite', 'sessions', 'taches']

function slugDuHash(): string | null {
  const m = /projet=([a-z0-9-]+)/.exec(location.hash)
  return m ? m[1] : null
}

/** La vue affichée : l'onglet « Tout » (tous les projets) ou un projet. */
export const VUE_TOUT = 'tout'

/**
 * Toutes les données de TOUS les projets de la personne (la RLS filtre), en
 * direct : chargement, un abonnement postgres_changes par table, repli en
 * sondage si le canal tombe. L'onglet « Tout » et la vue d'un projet lisent
 * les mêmes tableaux ; un projet n'est qu'un filtre dessus (Cockpit.tsx).
 * Volumes mesurés le 29 sept. 2026 : 26 chantiers, 6 messages, 19 activités
 * sur deux projets — tout charger coûte moins qu'une requête par projet.
 *
 * Les projets de TEST des bancs (slug `test-…`) sont retirés ICI, à la source,
 * pour tout l'écran (onglets, « Tout », pastilles, réglages) : leurs lignes
 * aussi, y compris celles qui arrivent en direct d'un projet de test créé
 * pendant que l'app est ouverte (on ne garde que les lignes des projets
 * visibles). Seul un compte de test les voit (lib/projetsDeTest.ts).
 */
/** Les projets passent par `projets_visibles` : un membre n'y reçoit ni la clé embed ni les réglages comptables. */
async function lireProjets() {
  const { data, error } = await supabase.rpc('projets_visibles')
  // Une réponse qui n'est pas une liste (vide fabriquée, page d'erreur) n'est JAMAIS « zéro projet » :
  // c'est un échec de lecture, l'écran garde ses dernières données (« Aucun projet » = lecture réussie qui rend []).
  if (!error && !Array.isArray(data)) return { data: null, error: new Error('Réponse illisible : les projets n’ont pas pu être lus.') }
  const liste = ((data ?? []) as Projet[]).slice().sort((a, b) => Number(b.actif) - Number(a.actif) || a.nom.localeCompare(b.nom, 'fr'))
  return { data: error ? null : liste, error }
}

export function useDonnees(pret: boolean, email: string | null = null) {
  const [tousProjets, setProjets] = useState<Projet[]>([])
  const projets = useMemo(() => projetsVisibles(tousProjets, email), [tousProjets, email])
  const [vue, setVue] = useState<string | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [chantiers, setChantiers] = useState<Chantier[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [activites, setActivites] = useState<Activite[]>([])
  const [sessions, setSessions] = useState<SessionClaude[]>([])
  const [taches, setTaches] = useState<Tache[]>([])
  const [chargementProjets, setChargementProjets] = useState(true)
  const [chargement, setChargement] = useState(false)
  const [charge, setCharge] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [direct, setDirect] = useState<EtatDirect>('connexion')
  const [derniereMaj, setDerniereMaj] = useState<Date | null>(null)
  /** Heure de DÉBUT (ms) du dernier rechargement complet réussi : toutes les tables lues après elle. */
  const [rechargeDu, setRechargeDu] = useState<number | null>(null)
  const canal = useRef<RealtimeChannel | null>(null)
  const minuteries = useRef<Partial<Record<Table, number>>>({})

  const chargerProjets = useCallback(async () => {
    setChargementProjets(true)
    const { data, error } = await lireProjets()
    if (error) { setErreur(messageErreur(error)); setChargementProjets(false); return [] as Projet[] }
    const liste = (data ?? []) as Projet[]
    setProjets(liste)
    setErreur(null)
    setChargementProjets(false)
    return projetsVisibles(liste, email)
  }, [email])

  // Au démarrage : les projets, puis la vue du lien (#projet=slug) ou « Tout » (l'accueil).
  useEffect(() => {
    if (!pret) return
    chargerProjets().then((liste) => {
      if (!liste.length) return
      // Lien sans projet (appli rouverte à son adresse de départ après avoir été vidée) : le projet d'avant.
      const voulu = slugDuHash() ?? (location.hash ? null : chargerEtatEcran()?.slug ?? null)
      const p = voulu ? liste.find((x) => x.slug === voulu) : null
      setVue(p ? p.id : VUE_TOUT)
    })
  }, [pret, chargerProjets])

  const projetId = vue && vue !== VUE_TOUT ? vue : null
  const projet = useMemo(() => projets.find((p) => p.id === projetId) ?? null, [projets, projetId])

  const choisirVue = useCallback((id: string) => {
    setVue(id)
    const p = projets.find((x) => x.id === id)
    history.replaceState(null, '', p ? `#projet=${p.slug}` : '#tout')
  }, [projets])

  const chargerTable = useCallback(async (table: Table) => {
    if (table === 'sections') {
      const { data, error } = await supabase.from('sections').select('*').order('position').order('nom')
      if (error) throw error
      setSections((data ?? []) as Section[])
    } else if (table === 'chantiers') {
      const { data, error } = await supabase.from('chantiers').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      setChantiers((data ?? []) as Chantier[])
    } else if (table === 'messages') {
      // Le serveur plafonne une requête à 1000 lignes (max-rows de PostgREST) : `.limit(5000)` était ignoré et,
      // triés du plus ancien au plus récent, les DERNIERS messages disparaissaient de l'app dès le 1001e
      // (constaté le 30 sept. 2026 : 1129 messages, les 129 derniers — dont les réponses de Claude — invisibles).
      // Une première page donne le total, les suivantes partent ensemble (jusqu'à 5000 messages).
      const PAGE = 1000
      const page = (debut: number) => supabase.from('messages').select('*', { count: 'exact' }).order('created_at').order('id').range(debut, debut + PAGE - 1)
      const premiere = await page(0)
      if (premiere.error) throw premiere.error
      const lignes = [...((premiere.data ?? []) as Message[])]
      const total = Math.min(premiere.count ?? lignes.length, 5000)
      const debuts: number[] = []
      for (let d = PAGE; d < total; d += PAGE) debuts.push(d)
      for (const r of await Promise.all(debuts.map(page))) {
        if (r.error) throw r.error
        lignes.push(...((r.data ?? []) as Message[]))
      }
      setMessages(lignes)
    } else if (table === 'activite') {
      const { data, error } = await supabase.from('activite').select('*').order('updated_at', { ascending: false }).limit(1000)
      if (error) throw error
      setActivites((data ?? []) as Activite[])
    } else if (table === 'sessions') {
      // Sessions et tâches (0008) : réservées à l'admin par la RLS ; un membre reçoit une liste vide.
      const { data, error } = await supabase.from('sessions').select('*').order('vu_at', { ascending: false }).limit(300)
      if (error) throw error
      setSessions((data ?? []) as SessionClaude[])
    } else {
      const { data, error } = await supabase.from('taches').select('*').order('vu_at', { ascending: false }).limit(1000)
      if (error) throw error
      setTaches((data ?? []) as Tache[])
    }
  }, [])

  /** Relit les projets sans l'écran de chargement (mode autonome réglé ailleurs, dépôt modifié…). */
  const rechargerProjets = useCallback(async () => {
    const { data, error } = await lireProjets()
    if (!error && data) setProjets(data as Projet[])
  }, [])

  // Un seul rechargement À LA FOIS (retour sur l'appli, direct rétabli, sondage et bouton partagent le passage)…
  // …mais jamais un passage PÉRIMÉ : une lecture déjà partie a pu commencer AVANT l'écriture qui vient d'avoir lieu
  // (revue du 5 oct. : après « Je ne peux pas vérifier » ou « Fait », l'écran gardait l'ancien état jusqu'au sondage
  // suivant). Une demande qui arrive pendant un passage en programme donc UN de plus juste derrière, partagé par
  // toutes les demandes du moment.
  const enCours = useRef<Promise<void> | null>(null)
  const suivant = useRef<{ p: Promise<void>; silencieux: boolean } | null>(null)
  const dejaCharge = useRef(false)
  const recharger = useCallback((silencieux = false): Promise<void> => {
    const lancer = (sil: boolean): Promise<void> => {
      const p = (async () => {
        if (!sil) setChargement(true)
        const debut = Date.now()
        try {
          await Promise.all([...TABLES.map((t) => chargerTable(t)), rechargerProjets()])
          setErreur(null)
          setDerniereMaj(new Date())
          setRechargeDu((avant) => Math.max(avant ?? 0, debut))
          setCharge(true)
          dejaCharge.current = true
        } catch (e) {
          // Une lecture silencieuse qui échoue (coupure brève, appli en arrière-plan) ne remplace rien et n'affiche rien :
          // les dernières données restent à l'écran.
          if (!(sil && dejaCharge.current)) setErreur(messageErreur(e))
        } finally {
          setChargement(false)
        }
      })().finally(() => { enCours.current = null })
      enCours.current = p
      return p
    }
    if (!enCours.current) return lancer(silencieux)
    if (suivant.current) { suivant.current.silencieux = suivant.current.silencieux && silencieux; return suivant.current.p }
    const file: { p: Promise<void>; silencieux: boolean } = { p: Promise.resolve(), silencieux }
    file.p = enCours.current.then(() => { suivant.current = null; return lancer(file.silencieux) })
    suivant.current = file
    return file.p
  }, [chargerTable, rechargerProjets])

  const rechargerCible = useCallback((table: Table) => {
    window.clearTimeout(minuteries.current[table])
    minuteries.current[table] = window.setTimeout(() => {
      chargerTable(table).then(() => setDerniereMaj(new Date())).catch((e) => setErreur(messageErreur(e)))
    }, 250)
  }, [chargerTable])

  // Chargement + UN abonnement temps réel pour tous les projets (la RLS filtre ce qui arrive).
  const aDesProjets = projets.length > 0
  useEffect(() => {
    if (!aDesProjets) return
    void recharger()
    setDirect('connexion')
    const ch = supabase.channel('cockpit-tout')
    for (const table of TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'cockpit', table }, () => rechargerCible(table))
    }
    ch.subscribe((statut) => {
      if (statut === 'SUBSCRIBED') { setDirect((d) => { if (d === 'coupe') void recharger(true); return 'direct' }) }
      else if (statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT' || statut === 'CLOSED') setDirect('coupe')
    })
    canal.current = ch
    return () => { void supabase.removeChannel(ch); canal.current = null }
  }, [aDesProjets, recharger, rechargerCible])

  // Direct coupé : sondage toutes les 30 s. La bibliothèque retente le canal d'elle-même.
  useEffect(() => {
    if (direct !== 'coupe') return
    const t = window.setInterval(() => void recharger(true), INTERVALLE_SONDAGE_MS)
    return () => window.clearInterval(t)
  }, [direct, recharger])

  // Retour au premier plan (téléphone) : on recharge, ce qui a bougé pendant la veille est passé à côté.
  useEffect(() => {
    // Pas de rechargement pour un aller-retour de quelques secondes ni sans réseau (le direct rattrape).
    let cacheDepuis = 0
    const onVis = () => {
      if (document.visibilityState === 'hidden') { cacheDepuis = Date.now(); return }
      if (navigator.onLine === false) return
      if (cacheDepuis && Date.now() - cacheDepuis < RETOUR_MIN_MS) return
      void recharger(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [recharger])

  // Écrire sans attendre un rechargement complet (lib/reponseCarte.ts) : poser/retirer UNE ligne de message à l'écran,
  // puis relire cette seule ligne en base. Le direct et le sondage la remplaceront de toute façon par la vraie.
  const poserMessage = useCallback((m: Message) => setMessages((l) => remplacerLigne(l, m)), [])
  const retirerMessage = useCallback((id: string) => setMessages((l) => retirerLigne(l, id)), [])
  const relireMessage = useCallback(async (id: string): Promise<Message | null> => {
    const { data, error } = await supabase.from('messages').select('*').eq('id', id).maybeSingle()
    return error ? null : (data as Message | null)
  }, [])

  const ids = useMemo(() => new Set(projets.map((p) => p.id)), [projets])
  const vis = useMemo(() => ({
    sections: lignesVisibles(sections, ids), chantiers: lignesVisibles(chantiers, ids), messages: lignesVisibles(messages, ids),
    activites: lignesVisibles(activites, ids), sessions: lignesVisibles(sessions, ids), taches: lignesVisibles(taches, ids),
  }), [ids, sections, chantiers, messages, activites, sessions, taches])

  return {
    projets, projet, projetId, vue, choisirVue, chargerProjets,
    ...vis,
    chargementProjets, chargement, charge, erreur, direct, derniereMaj, rechargeDu,
    recharger, rechargerCible, rechargerProjets, poserMessage, retirerMessage, relireMessage,
  }
}
