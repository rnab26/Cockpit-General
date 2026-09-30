import { useCallback, useEffect, useState } from 'react'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { estIos } from '../lib/installation.ts'
import { cleEnOctets, cleEnTexte, etatPush, type EtatPush } from '../lib/push.ts'

const supporte = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const enAppli = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const permission = (): NotificationPermission | 'absente' => ('Notification' in window ? Notification.permission : 'absente')

async function registration() {
  const r = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  if (!r) throw new Error('Le service de notifications n’est pas prêt : recharge la page et réessaie.')
  return r
}

/**
 * Les notifications push de CET appareil (Réglages). Réglage par appareil : un
 * abonnement = une ligne `push_abonnements` (les siennes seulement, RLS) ;
 * l'envoi est fait par la fonction serveur cockpit-push (migration 0037).
 */
export function usePush() {
  const [cle, setCle] = useState<string | null>(null)
  const [abonne, setAbonne] = useState(false)
  const [perm, setPerm] = useState(permission())
  const [chargee, setChargee] = useState(false)
  const [occupe, setOccupe] = useState(false)

  const relire = useCallback(async () => {
    setPerm(permission())
    try {
      const r = supporte() ? await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL) : undefined
      setAbonne(!!(await r?.pushManager.getSubscription()))
    } catch { setAbonne(false) }
  }, [])

  useEffect(() => {
    let vivant = true
    void (async () => {
      const { data } = await supabase.from('push_config').select('vapid_public').eq('id', 1).maybeSingle()
      if (!vivant) return
      setCle((data as { vapid_public: string } | null)?.vapid_public ?? null)
      await relire()
      if (vivant) setChargee(true)
    })()
    return () => { vivant = false }
  }, [relire])

  const etat: EtatPush | 'chargement' = !chargee ? 'chargement'
    : etatPush({ supporte: supporte(), ios: estIos(navigator.userAgent, navigator.maxTouchPoints), standalone: enAppli(), cleServeur: !!cle, permission: perm, abonne })

  /** Active sur cet appareil ; lève une erreur lisible en cas d'échec. Rend true si tout est posé. */
  const activer = useCallback(async () => {
    if (!cle) throw new Error('Le serveur n’a pas encore de clé de notification.')
    setOccupe(true)
    try {
      const p = await Notification.requestPermission()
      setPerm(p)
      if (p !== 'granted') throw new Error(p === 'denied' ? 'Notifications bloquées dans le navigateur.' : 'Autorisation non donnée.')
      const r = await registration()
      const sub = (await r.pushManager.getSubscription()) ?? await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleEnOctets(cle) as BufferSource })
      const { error } = await supabase.from('push_abonnements').upsert({
        endpoint: sub.endpoint, p256dh: cleEnTexte(sub.getKey('p256dh')), auth: cleEnTexte(sub.getKey('auth')), appareil: navigator.userAgent.slice(0, 200),
      }, { onConflict: 'endpoint' })
      if (error) { await sub.unsubscribe().catch(() => {}); throw new Error(messageErreur(error)) }
      setAbonne(true)
      // Preuve immédiate sur l'appareil : la bannière s'affiche vraiment.
      await r.showNotification('Notifications activées', { body: 'Tu seras prévenu quand Claude répond, même hors de l’appli.', icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: 'cockpit-test' })
    } finally { setOccupe(false); await relire() }
  }, [cle, relire])

  const desactiver = useCallback(async () => {
    setOccupe(true)
    try {
      const r = await registration()
      const sub = await r.pushManager.getSubscription()
      if (sub) {
        const { error } = await supabase.from('push_abonnements').delete().eq('endpoint', sub.endpoint)
        if (error) throw new Error(messageErreur(error))
        await sub.unsubscribe()
      }
      setAbonne(false)
    } finally { setOccupe(false); await relire() }
  }, [relire])

  return { etat, occupe, activer, desactiver }
}
