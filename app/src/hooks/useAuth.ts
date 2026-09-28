import { useCallback, useEffect, useState } from 'react'
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

export function useAuth() {
  const [etat, setEtat] = useState<EtatAuth>({ pret: false, session: null, moi: null, erreurMoi: null, recuperation: false })

  const chargerMoi = useCallback(async () => {
    const { data, error } = await supabase.rpc('moi')
    if (error) { setEtat((e) => ({ ...e, moi: null, erreurMoi: messageErreur(error) })); return }
    setEtat((e) => ({ ...e, moi: data as Moi, erreurMoi: null }))
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
    return () => { vivant = false; sub.subscription.unsubscribe() }
  }, [chargerMoi])

  const seConnecter = useCallback(async (email: string, motDePasse: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse })
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
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de réseau : impossible de joindre le serveur.'
  return m
}
