import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, messageErreur } from '../lib/supabase.ts'
import type { Activite, Chantier, Message, Projet, Section } from '../lib/types.ts'

export type EtatDirect = 'connexion' | 'direct' | 'coupe'
export const INTERVALLE_SONDAGE_MS = 30_000
const CLE_PROJET = 'cockpit_projet'
type Table = 'sections' | 'chantiers' | 'messages' | 'activite'

function slugDuHash(): string | null {
  const m = /projet=([a-z0-9-]+)/.exec(location.hash)
  return m ? m[1] : null
}

/**
 * Toutes les données d'un projet, en direct : chargement, abonnement
 * postgres_changes filtré par projet, repli en sondage si le canal tombe.
 */
export function useDonnees(pret: boolean) {
  const [projets, setProjets] = useState<Projet[]>([])
  const [projetId, setProjetId] = useState<string | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [chantiers, setChantiers] = useState<Chantier[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [activites, setActivites] = useState<Activite[]>([])
  const [chargementProjets, setChargementProjets] = useState(true)
  const [chargement, setChargement] = useState(false)
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

  // Au démarrage : les projets, puis celui du hash / du dernier passage / le premier actif.
  useEffect(() => {
    if (!pret) return
    chargerProjets().then((liste) => {
      if (!liste.length) return
      const voulu = slugDuHash()
      let memo: string | null = null
      try { memo = localStorage.getItem(CLE_PROJET) } catch { /* sans stockage, on prend le premier */ }
      const p = liste.find((x) => x.slug === voulu) ?? liste.find((x) => x.id === memo) ?? liste.find((x) => x.actif) ?? liste[0]
      setProjetId(p.id)
    })
  }, [pret, chargerProjets])

  const projet = useMemo(() => projets.find((p) => p.id === projetId) ?? null, [projets, projetId])

  const choisirProjet = useCallback((id: string) => {
    setProjetId(id)
    const p = projets.find((x) => x.id === id)
    try { localStorage.setItem(CLE_PROJET, id) } catch { /* ignoré */ }
    if (p) history.replaceState(null, '', `#projet=${p.slug}`)
  }, [projets])

  const chargerTable = useCallback(async (table: Table, id: string) => {
    if (table === 'sections') {
      const { data, error } = await supabase.from('sections').select('*').eq('projet_id', id).order('position').order('nom')
      if (error) throw error
      setSections((data ?? []) as Section[])
    } else if (table === 'chantiers') {
      const { data, error } = await supabase.from('chantiers').select('*').eq('projet_id', id).order('updated_at', { ascending: false })
      if (error) throw error
      setChantiers((data ?? []) as Chantier[])
    } else if (table === 'messages') {
      const { data, error } = await supabase.from('messages').select('*').eq('projet_id', id).order('created_at')
      if (error) throw error
      setMessages((data ?? []) as Message[])
    } else {
      const { data, error } = await supabase.from('activite').select('*').eq('projet_id', id).order('updated_at', { ascending: false }).limit(300)
      if (error) throw error
      setActivites((data ?? []) as Activite[])
    }
  }, [])

  const recharger = useCallback(async (silencieux = false) => {
    if (!projetId) return
    if (!silencieux) setChargement(true)
    try {
      await Promise.all((['sections', 'chantiers', 'messages', 'activite'] as Table[]).map((t) => chargerTable(t, projetId)))
      setErreur(null)
      setDerniereMaj(new Date())
    } catch (e) {
      setErreur(messageErreur(e))
    } finally {
      setChargement(false)
    }
  }, [projetId, chargerTable])

  const rechargerCible = useCallback((table: Table) => {
    if (!projetId) return
    window.clearTimeout(minuteries.current[table])
    minuteries.current[table] = window.setTimeout(() => {
      chargerTable(table, projetId).then(() => setDerniereMaj(new Date())).catch((e) => setErreur(messageErreur(e)))
    }, 250)
  }, [projetId, chargerTable])

  // Chargement + abonnement temps réel à chaque changement de projet.
  useEffect(() => {
    if (!projetId) return
    setSections([]); setChantiers([]); setMessages([]); setActivites([])
    void recharger()
    setDirect('connexion')
    const ch = supabase.channel(`cockpit-${projetId}`)
    for (const table of ['chantiers', 'messages', 'activite', 'sections'] as Table[]) {
      ch.on('postgres_changes', { event: '*', schema: 'cockpit', table, filter: `projet_id=eq.${projetId}` }, () => rechargerCible(table))
    }
    ch.subscribe((statut) => {
      if (statut === 'SUBSCRIBED') { setDirect((d) => { if (d === 'coupe') void recharger(true); return 'direct' }) }
      else if (statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT' || statut === 'CLOSED') setDirect('coupe')
    })
    canal.current = ch
    return () => { void supabase.removeChannel(ch); canal.current = null }
  }, [projetId, recharger, rechargerCible])

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
    projets, projet, projetId, choisirProjet, chargerProjets,
    sections, chantiers, messages, activites,
    chargementProjets, chargement, erreur, direct, derniereMaj,
    recharger, rechargerCible,
  }
}
