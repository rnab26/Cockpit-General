import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, messageErreur } from '../lib/supabase.ts'
import type { Activite, Chantier, Message, Projet, Section, SessionClaude, Tache } from '../lib/types.ts'

export type EtatDirect = 'connexion' | 'direct' | 'coupe'
export const INTERVALLE_SONDAGE_MS = 30_000
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
 */
export function useDonnees(pret: boolean) {
  const [projets, setProjets] = useState<Projet[]>([])
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
  const canal = useRef<RealtimeChannel | null>(null)
  const minuteries = useRef<Partial<Record<Table, number>>>({})

  const chargerProjets = useCallback(async () => {
    setChargementProjets(true)
    const { data, error } = await supabase.from('projets').select('*').order('actif', { ascending: false }).order('nom')
    if (error) { setErreur(messageErreur(error)); setChargementProjets(false); return [] as Projet[] }
    const liste = (data ?? []) as Projet[]
    setProjets(liste)
    setErreur(null)
    setChargementProjets(false)
    return liste
  }, [])

  // Au démarrage : les projets, puis la vue du lien (#projet=slug) ou « Tout » (l'accueil).
  useEffect(() => {
    if (!pret) return
    chargerProjets().then((liste) => {
      if (!liste.length) return
      const voulu = slugDuHash()
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
      const { data, error } = await supabase.from('messages').select('*').order('created_at').limit(5000)
      if (error) throw error
      setMessages((data ?? []) as Message[])
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
    const { data, error } = await supabase.from('projets').select('*').order('actif', { ascending: false }).order('nom')
    if (!error && data) setProjets(data as Projet[])
  }, [])

  const recharger = useCallback(async (silencieux = false) => {
    if (!silencieux) setChargement(true)
    try {
      await Promise.all([...TABLES.map((t) => chargerTable(t)), rechargerProjets()])
      setErreur(null)
      setDerniereMaj(new Date())
      setCharge(true)
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setChargement(false)
    }
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
    const onVis = () => { if (document.visibilityState === 'visible') void recharger(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [recharger])

  return {
    projets, projet, projetId, vue, choisirVue, chargerProjets,
    sections, chantiers, messages, activites, sessions, taches,
    chargementProjets, chargement, charge, erreur, direct, derniereMaj,
    recharger, rechargerCible, rechargerProjets,
  }
}
