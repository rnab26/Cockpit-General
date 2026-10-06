import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, messageErreur } from '../lib/supabase.ts'
import type { Moi } from '../lib/types.ts'

export interface EtatAuth {
  pret: boolean            // on sait s'il y a une session ou non
  session: Session | null
  moi: Moi | null
  erreurMoi: string | null
  recuperation: boolean    // arrivé par un lien « mot de passe oublié »
}

/** Un serveur qui ne répond pas ne doit jamais laisser un écran tourner sans fin (5 oct. 2026). */
const DELAI_SERVEUR_MS = 20_000
const MESSAGE_LENT = 'Le serveur met trop de temps à répondre. Réessaie dans un instant.'
function avecDelai<T>(p: PromiseLike<T>, message = MESSAGE_LENT, ms = DELAI_SERVEUR_MS): Promise<T> {
  return new Promise<T>((ok, ko) => {
    const t = window.setTimeout(() => ko(new Error(message)), ms)
    Promise.resolve(p).then((v) => { window.clearTimeout(t); ok(v) }, (e) => { window.clearTimeout(t); ko(e) })
  })
}

export function useAuth() {
  const [etat, setEtat] = useState<EtatAuth>({ pret: false, session: null, moi: null, erreurMoi: null, recuperation: false })

  const relance = useRef<number | null>(null)
  const chargerMoi = useCallback(async () => {
    if (relance.current != null) { window.clearTimeout(relance.current); relance.current = null }
    // Serveur de données en panne : on réessaie seul toutes les 10 s (tant qu'on est connecté).
    const reessayer = () => {
      relance.current = window.setTimeout(() => {
        relance.current = null
        void supabase.auth.getSession().then(({ data }) => { if (data.session) void chargerMoi() })
      }, 10_000)
    }
    try {
      const { data, error } = await avecDelai(supabase.rpc('moi'))
      if (error) { setEtat((e) => ({ ...e, moi: null, erreurMoi: messageErreur(error) })); reessayer(); return }
      setEtat((e) => ({ ...e, moi: data as Moi, erreurMoi: null }))
    } catch (err) {
      setEtat((e) => ({ ...e, moi: null, erreurMoi: messageErreur(err) }))
      reessayer()
    }
  }, [])

  useEffect(() => {
    let vivant = true
    supabase.auth.getSession().then(({ data }) => {
      if (!vivant) return
      setEtat((e) => ({ ...e, pret: true, session: data.session }))
      if (data.session) void chargerMoi()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      if (!vivant) return
      setEtat((e) => ({ ...e, pret: true, session, recuperation: evt === 'PASSWORD_RECOVERY' ? true : e.recuperation, moi: session ? e.moi : null }))
      if (session && (evt === 'SIGNED_IN' || evt === 'TOKEN_REFRESHED' || evt === 'USER_UPDATED')) void chargerMoi()
    })
    // Serveur d'authentification lent : après 15 s on montre l'écran de connexion
    // plutôt qu'un « Ouverture… » sans fin ; la session arrive d'elle-même si elle finit par répondre.
    const attente = window.setTimeout(() => { if (vivant) setEtat((e) => (e.pret ? e : { ...e, pret: true })) }, 15_000)
    return () => { vivant = false; window.clearTimeout(attente); sub.subscription.unsubscribe() }
  }, [chargerMoi])

  const seConnecter = useCallback(async (email: string, motDePasse: string) => {
    const { error } = await avecDelai(supabase.auth.signInWithPassword({ email, password: motDePasse }))
    if (error) throw new Error(traduireAuth(error.message))
  }, [])
  const sInscrire = useCallback(async (email: string, motDePasse: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password: motDePasse, options: { emailRedirectTo: urlApp() } })
    if (error) throw new Error(traduireAuth(error.message))
    return { confirmationRequise: !data.session }
  }, [])
  const motDePasseOublie = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: urlApp() })
    if (error) throw new Error(traduireAuth(error.message))
  }, [])
  const changerMotDePasse = useCallback(async (motDePasse: string) => {
    const { error } = await supabase.auth.updateUser({ password: motDePasse })
    if (error) throw new Error(traduireAuth(error.message))
    setEtat((e) => ({ ...e, recuperation: false }))
  }, [])
  const seDeconnecter = useCallback(async () => { await supabase.auth.signOut() }, [])

  return { ...etat, seConnecter, sInscrire, motDePasseOublie, changerMotDePasse, seDeconnecter, rechargerMoi: chargerMoi }
}

function urlApp(): string {
  return `${location.origin}${location.pathname}`
}

function traduireAuth(m: string): string {
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.'
  if (/Email not confirmed/i.test(m)) return 'Adresse pas encore confirmée : regarde ta boîte mail.'
  if (/User already registered/i.test(m)) return 'Un compte existe déjà avec cette adresse : connecte-toi.'
  if (/Password should be at least/i.test(m)) return 'Mot de passe trop court (6 caractères minimum).'
  if (/rate limit|too many/i.test(m)) return 'Trop d’essais : réessaie dans une minute.'
  if (/504|502|503|gateway|timed? ?out|unexpected token|<html/i.test(m)) return MESSAGE_LENT
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de réseau : impossible de joindre le serveur.'
  return m
}
