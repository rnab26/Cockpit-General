import { useEffect, useState } from 'react'
import { INTERVALLE_VERSION_MS, nouvelleVersion } from '../lib/version.ts'

declare const __VERSION_APP__: string

/** La version qui tourne (commit de la construction, « dev » en local). */
export const VERSION_APP: string = typeof __VERSION_APP__ === 'string' ? __VERSION_APP__ : 'dev'

/**
 * Vrai dès que le site sert une nouvelle version : relu au retour sur l'app
 * (onglet, appli rouverte) et toutes les 5 min. Une panne réseau ne dit rien.
 */
export function useNouvelleVersion(): boolean {
  const [nouvelle, setNouvelle] = useState(false)
  useEffect(() => {
    if (!import.meta.env.PROD || VERSION_APP === 'dev') return
    let fini = false
    const lire = async () => {
      if (fini || document.visibilityState === 'hidden') return
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (r.ok && nouvelleVersion(VERSION_APP, await r.json()) && !fini) setNouvelle(true)
      } catch { /* hors ligne : on réessaiera */ }
    }
    const auRetour = () => { if (document.visibilityState === 'visible') void lire() }
    const t = window.setInterval(() => void lire(), INTERVALLE_VERSION_MS)
    document.addEventListener('visibilitychange', auRetour)
    window.addEventListener('focus', auRetour)
    void lire()
    return () => { fini = true; window.clearInterval(t); document.removeEventListener('visibilitychange', auRetour); window.removeEventListener('focus', auRetour) }
  }, [])
  return nouvelle
}
