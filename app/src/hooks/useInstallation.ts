import { useCallback, useSyncExternalStore } from 'react'
import { etatInstallation, type EtatInstallation } from '../lib/installation.ts'

/** L'invite de Chrome (non typée par TypeScript). */
interface InviteInstallation extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let invite: InviteInstallation | null = null
let installee = false
const abonnes = new Set<() => void>()
const prevenir = () => { for (const f of abonnes) f() }

const enAppli = () => installee
  || window.matchMedia?.('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true

/**
 * À appeler UNE fois, avant le rendu (main.tsx) : Chrome envoie son invite
 * très tôt, souvent avant que React soit monté. Enregistre aussi le service
 * worker (seulement sur le site construit : en dev il gênerait Vite).
 */
export function preparerInstallation() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invite = e as InviteInstallation; prevenir() })
  window.addEventListener('appinstalled', () => { invite = null; installee = true; prevenir() })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', prevenir)
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
        .catch((err) => console.warn('Service worker non enregistré :', err))
    })
  }
}

const lire = (): EtatInstallation =>
  etatInstallation({ standalone: enAppli(), invite: !!invite, userAgent: navigator.userAgent, pointsTactiles: navigator.maxTouchPoints })
const abonner = (f: () => void) => { abonnes.add(f); return () => { abonnes.delete(f) } }

export type ResultatInstallation = 'acceptee' | 'refusee' | 'indisponible'

export function useInstallation() {
  const etat = useSyncExternalStore(abonner, lire)
  /** Ouvre la vraie fenêtre « Installer » de Chrome (une invite ne sert qu'une fois). */
  const installer = useCallback(async (): Promise<ResultatInstallation> => {
    const i = invite
    if (!i) return 'indisponible'
    invite = null
    await i.prompt()
    const { outcome } = await i.userChoice
    if (outcome === 'accepted') installee = true
    prevenir()
    return outcome === 'accepted' ? 'acceptee' : 'refusee'
  }, [])
  return { etat, installer }
}
