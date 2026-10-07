import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, messageErreur } from '../lib/supabase.ts'
import type { Activite, Chantier, Message, Projet, Section, SessionClaude, Tache } from '../lib/types.ts'
import { chargerEtatEcran } from '../lib/etatEcran.ts'
import { lignesVisibles, projetsVisibles } from '../lib/projetsDeTest.ts'
import { abonner, etatFile } from '../lib/fetchResilient.ts'
import { fusionnerEnAttente } from '../lib/fileAttente.ts'
import { remplacerLigne, retirerLigne } from '../lib/reponseCarte.ts'
import { appliquer, curseurDelta, filtreDelta, LotEvenements, ORDRES, pleinDu, TACHES_RECENTES_H, type Lot, type TableDonnees } from '../lib/deltaDonnees.ts'

export type EtatDirect = 'connexion' | 'direct' | 'coupe'
export const INTERVALLE_SONDAGE_MS = 30_000
/** Absence minimale avant de tout relire au retour sur l'appli. */
export const RETOUR_MIN_MS = 20_000
type Table = TableDonnees
type Ligne = Record<string, unknown> & { id: string }
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
 *
 * VITESSE (7 oct. 2026, chantier 9d83828c) : la lecture complète des six tables
 * (≈ 2,9 Mo) n'a lieu qu'au chargement, au bouton « Actualiser » et toutes les
 * 5 minutes. Tout le reste est incrémental (lib/deltaDonnees.ts) : un événement du
 * direct est APPLIQUÉ à la ligne concernée (regroupé par rafale), un sondage ou une
 * action (`recharger()`) ne lit que les lignes modifiées depuis la plus récente
 * connue. Mesures avant/après dans le CLAUDE.md, section « Vitesse ».
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
  /** Heure de DÉBUT (ms) du dernier rechargement réussi (complet ou delta) : toutes les tables à jour après elle. */
  const [rechargeDu, setRechargeDu] = useState<number | null>(null)
  /** Nombre de relectures COMPLÈTES terminées (les blocs qui lisent la base eux-mêmes, comme Renforts, s'y accrochent). */
  const [passagesComplets, setPassagesComplets] = useState(0)
  const canal = useRef<RealtimeChannel | null>(null)
  // Miroir des tableaux affichés : un passage « delta » calcule son curseur dessus sans dépendre d'un rendu.
  const lignes = useRef<{ [T in Table]: Ligne[] }>({ sections: [], chantiers: [], messages: [], activite: [], sessions: [], taches: [] })
  const poserTable = useCallback((table: Table, liste: Ligne[]) => {
    lignes.current[table] = liste
    const l = liste as never
    if (table === 'sections') setSections(l)
    else if (table === 'chantiers') setChantiers(l)
    else if (table === 'messages') setMessages(l)
    else if (table === 'activite') setActivites(l)
    else if (table === 'sessions') setSessions(l)
    else setTaches(l)
  }, [])

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

  /** Lecture COMPLÈTE d'une table (chargement, « Actualiser », toutes les 5 minutes). */
  const lireTable = useCallback(async (table: Table): Promise<Ligne[]> => {
    if (table === 'sections') {
      const { data, error } = await supabase.from('sections').select('*').order('position').order('nom')
      if (error) throw error
      return (data ?? []) as Ligne[]
    }
    if (table === 'chantiers') {
      const { data, error } = await supabase.from('chantiers').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Ligne[]
    }
    if (table === 'messages') {
      // Le serveur plafonne une requête à 1000 lignes (max-rows de PostgREST) : `.limit(5000)` était ignoré et,
      // triés du plus ancien au plus récent, les DERNIERS messages disparaissaient de l'app dès le 1001e
      // (constaté le 30 sept. 2026 : 1129 messages, les 129 derniers — dont les réponses de Claude — invisibles).
      // Une première page donne le total, les suivantes partent ensemble (jusqu'à 5000 messages).
      const PAGE = 1000
      const page = (debut: number) => supabase.from('messages').select('*', { count: 'exact' }).order('created_at').order('id').range(debut, debut + PAGE - 1)
      const premiere = await page(0)
      if (premiere.error) throw premiere.error
      const lues = [...((premiere.data ?? []) as Ligne[])]
      const total = Math.min(premiere.count ?? lues.length, 5000)
      const debuts: number[] = []
      for (let d = PAGE; d < total; d += PAGE) debuts.push(d)
      for (const r of await Promise.all(debuts.map(page))) {
        if (r.error) throw r.error
        lues.push(...((r.data ?? []) as Ligne[]))
      }
      return lues
    }
    if (table === 'activite') {
      const { data, error } = await supabase.from('activite').select('*').order('updated_at', { ascending: false }).limit(1000)
      if (error) throw error
      return (data ?? []) as Ligne[]
    }
    if (table === 'sessions') {
      // Sessions et tâches (0008) : réservées à l'admin par la RLS ; un membre reçoit une liste vide.
      const { data, error } = await supabase.from('sessions').select('*').order('vu_at', { ascending: false }).limit(300)
      if (error) throw error
      return (data ?? []) as Ligne[]
    }
    // Tâches : les vivantes et les récentes seulement (les finies d'il y a plus de 48 h ne servent à aucun écran ;
    // mesuré le 7 oct. : 458 lignes gardées sur 867).
    const depuis = new Date(Date.now() - TACHES_RECENTES_H * 3_600_000).toISOString()
    const { data, error } = await supabase.from('taches').select('*').or(`statut.eq.en_cours,vu_at.gt.${depuis}`).order('vu_at', { ascending: false }).limit(1000)
    if (error) throw error
    return (data ?? []) as Ligne[]
  }, [])

  /**
   * Passage DELTA d'une table : seulement les lignes modifiées depuis la plus récente connue (curseur lu sur les
   * lignes déjà à l'écran). Pas de curseur (table vide) ou delta refusé (colonne absente d'une base pas à jour) :
   * lecture complète, comme avant. Les chantiers font en plus un contrôle d'identifiants (≈ 12 Ko) : un chantier
   * supprimé disparaît même si le direct ne l'a pas dit.
   */
  const lireDelta = useCallback(async (table: Table) => {
    const cur = curseurDelta(table, lignes.current[table])
    if (!cur) { poserTable(table, await lireTable(table)); return }
    const { data, error } = await supabase.from(table).select('*').or(filtreDelta(table, cur)).limit(1000)
    if (error) { poserTable(table, await lireTable(table)); return }
    let liste = appliquer(lignes.current[table], (data ?? []) as Ligne[], [], ORDRES[table] as never)
    if (table === 'chantiers') {
      const ids = await supabase.from('chantiers').select('id')
      if (!ids.error && Array.isArray(ids.data)) {
        const presents = new Set((ids.data as { id: string }[]).map((x) => x.id))
        const disparus = liste.filter((l) => !presents.has(l.id)).map((l) => l.id)
        if (disparus.length) {
          liste = appliquer(liste, [], disparus, ORDRES.chantiers as never)
          const sup = new Set(disparus)
          const msgs = lignes.current.messages.filter((m) => !(typeof m.chantier_id === 'string' && sup.has(m.chantier_id)))
          if (msgs.length !== lignes.current.messages.length) poserTable('messages', msgs)
        }
      }
    }
    if (liste !== lignes.current[table]) poserTable(table, liste)
  }, [lireTable, poserTable])

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
  // Un passage est INCRÉMENTAL (lireDelta) sauf : tout premier chargement, bouton « Actualiser » / « Réessayer »
  // (`complet`), ou dernier passage complet vieux de 5 minutes (suppressions que le direct n'aurait pas dites).
  const enCours = useRef<Promise<void> | null>(null)
  const suivant = useRef<{ p: Promise<void>; silencieux: boolean; complet: boolean } | null>(null)
  const dejaCharge = useRef(false)
  const dernierPlein = useRef<number | null>(null)
  const recharger = useCallback((silencieux = false, complet = false): Promise<void> => {
    const lancer = (sil: boolean, plein: boolean): Promise<void> => {
      const p = (async () => {
        if (!sil) setChargement(true)
        const debut = Date.now()
        const entier = plein || !dejaCharge.current || pleinDu(dernierPlein.current, debut)
        try {
          if (entier) {
            // Complet : toutes les tables lues d'un coup, puis posées (et le miroir du curseur avec).
            const lues = await Promise.all([...TABLES.map((t) => lireTable(t)), rechargerProjets()])
            TABLES.forEach((t, i) => poserTable(t, lues[i] as Ligne[]))
            dernierPlein.current = debut
            setPassagesComplets((n) => n + 1)
            setPassagesComplets((n) => n + 1)
          } else {
            await Promise.all([...TABLES.map((t) => lireDelta(t)), rechargerProjets()])
          }
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
    if (!enCours.current) return lancer(silencieux, complet)
    if (suivant.current) {
      suivant.current.silencieux = suivant.current.silencieux && silencieux
      suivant.current.complet = suivant.current.complet || complet
      return suivant.current.p
    }
    const file: { p: Promise<void>; silencieux: boolean; complet: boolean } = { p: Promise.resolve(), silencieux, complet }
    file.p = enCours.current.then(() => { suivant.current = null; return lancer(file.silencieux, file.complet) })
    suivant.current = file
    return file.p
  }, [lireTable, lireDelta, poserTable, rechargerProjets])

  // Événements du direct : regroupés par rafale (800 ms de calme, 4 s au plus), puis APPLIQUÉS aux lignes concernées.
  // Un événement sans ligne exploitable (jamais vu en pratique) relit cette seule table en delta.
  const appliquerLot = useCallback((lot: Lot) => {
    for (const table of TABLES) {
      const t = lot[table]
      if (!t) continue
      const liste = appliquer(lignes.current[table], [...t.lignes.values()] as Ligne[], t.suppressions, ORDRES[table] as never)
      if (liste !== lignes.current[table]) poserTable(table, liste)
      if (t.arelire) void lireDelta(table).catch(() => {})
      // Un chantier supprimé emporte ses messages (même règle que le passage delta).
      if (table === 'chantiers' && t.suppressions.size) {
        const msgs = lignes.current.messages.filter((m) => !(typeof m.chantier_id === 'string' && t.suppressions.has(m.chantier_id)))
        if (msgs.length !== lignes.current.messages.length) poserTable('messages', msgs)
      }
    }
    setDerniereMaj(new Date())
  }, [lireDelta, poserTable])
  const lotRef = useRef<LotEvenements | null>(null)
  useEffect(() => {
    const lot = new LotEvenements(appliquerLot)
    lotRef.current = lot
    return () => { lot.annuler(); lotRef.current = null }
  }, [appliquerLot])
  /** Compatibilité : un écran qui veut une table à jour sans attendre (delta, une seule table). */
  const rechargerCible = useCallback((table: Table) => { void lireDelta(table).then(() => setDerniereMaj(new Date())).catch((e) => setErreur(messageErreur(e))) }, [lireDelta])

  // Chargement + UN abonnement temps réel pour tous les projets (la RLS filtre ce qui arrive).
  const aDesProjets = projets.length > 0
  useEffect(() => {
    if (!aDesProjets) return
    void recharger()
    setDirect('connexion')
    const ch = supabase.channel('cockpit-tout')
    for (const table of TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'cockpit', table }, (p) => lotRef.current?.ajouter(table, p as never))
    }
    // Direct rétabli après une coupure : on a pu rater des suppressions, relecture complète.
    ch.subscribe((statut) => {
      if (statut === 'SUBSCRIBED') { setDirect((d) => { if (d === 'coupe') void recharger(true, true); return 'direct' }) }
      else if (statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT' || statut === 'CLOSED') setDirect('coupe')
    })
    canal.current = ch
    return () => { void supabase.removeChannel(ch); canal.current = null }
  }, [aDesProjets, recharger])

  // Direct coupé : sondage toutes les 30 s (delta : quelques Ko ; complet seulement toutes les 5 min).
  // La bibliothèque retente le canal d'elle-même.
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
      lotRef.current?.vidange()
      void recharger(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [recharger])

  // Écrire sans attendre un rechargement (lib/reponseCarte.ts) : poser/retirer UNE ligne de message à l'écran,
  // puis relire cette seule ligne en base. Le direct et le sondage la remplaceront de toute façon par la vraie.
  const poserMessage = useCallback((m: Message) => poserTable('messages', remplacerLigne(lignes.current.messages as unknown as Message[], m) as unknown as Ligne[]), [poserTable])
  const retirerMessage = useCallback((id: string) => poserTable('messages', retirerLigne(lignes.current.messages as unknown as Message[], id) as unknown as Ligne[]), [poserTable])
  const relireMessage = useCallback(async (id: string): Promise<Message | null> => {
    const { data, error } = await supabase.from('messages').select('*').eq('id', id).maybeSingle()
    return error ? null : (data as Message | null)
  }, [])

  // Les messages écrits hors ligne (gardés dans la file de l'appareil) se voient dans la bulle et le fil, marqués.
  const file = useSyncExternalStore(abonner, etatFile, etatFile)
  const messagesAffiches = useMemo(() => fusionnerEnAttente(messages, file.elements), [messages, file.elements])
  const ids = useMemo(() => new Set(projets.map((p) => p.id)), [projets])
  const vis = useMemo(() => ({
    sections: lignesVisibles(sections, ids), chantiers: lignesVisibles(chantiers, ids), messages: lignesVisibles(messagesAffiches, ids),
    activites: lignesVisibles(activites, ids), sessions: lignesVisibles(sessions, ids), taches: lignesVisibles(taches, ids),
  }), [ids, sections, chantiers, messagesAffiches, activites, sessions, taches])

  return {
    projets, projet, projetId, vue, choisirVue, chargerProjets,
    ...vis,
    chargementProjets, chargement, charge, erreur, direct, derniereMaj, rechargeDu, passagesComplets,
    recharger, rechargerCible, rechargerProjets, poserMessage, retirerMessage, relireMessage,
  }
}
