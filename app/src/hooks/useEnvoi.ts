import { useCallback, useEffect, useRef, useState } from 'react'
import { DUREE_ENVOYE_MS, type EtatEnvoi } from '../lib/reponseCarte.ts'

/**
 * Un envoi à la fois, dit à l'écran : « Envoi… » puis « Envoyé ✓ » (ou « échec »).
 * Le verrou est une référence (pas un état) : deux touchers dans le même instant,
 * avant que React ait redessiné le bouton, ne lancent qu'UN envoi.
 * `lancer(f)` : f rend true si l'envoi a réussi.
 */
export function useEnvoi() {
  const verrou = useRef(false)
  const vivant = useRef(true)
  const [etat, setEtat] = useState<EtatEnvoi>('repos')
  useEffect(() => { vivant.current = true; return () => { vivant.current = false } }, [])
  const lancer = useCallback(async (f: () => Promise<boolean>): Promise<boolean> => {
    if (verrou.current) return false
    verrou.current = true
    setEtat('envoi')
    let ok = false
    try { ok = await f() } catch { ok = false }
    verrou.current = false
    if (vivant.current) {
      setEtat(ok ? 'envoye' : 'echec')
      if (ok) window.setTimeout(() => { if (vivant.current) setEtat((e) => (e === 'envoye' ? 'repos' : e)) }, DUREE_ENVOYE_MS)
    }
    return ok
  }, [])
  return { etat, lancer, occupe: etat === 'envoi' }
}
