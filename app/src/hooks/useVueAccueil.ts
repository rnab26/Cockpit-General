import { useCallback, useEffect, useState } from 'react'
import { CLE_VUE_ACCUEIL, EVENEMENT_VUE_ACCUEIL, VUE_ACCUEIL_DEFAUT, lireVueAccueil, type VueAccueil } from '../lib/vueAccueil.ts'

// Si le navigateur refuse le stockage (fenêtre privée), la vue choisie tient quand même jusqu'au rechargement.
let enMemoire: VueAccueil | null = null

function lire(): VueAccueil {
  try {
    const brut = localStorage.getItem(CLE_VUE_ACCUEIL)
    if (brut !== null) return lireVueAccueil(brut)
  } catch { /* stockage indisponible : on retombe sur la mémoire */ }
  return enMemoire ?? VUE_ACCUEIL_DEFAUT
}

/** La vue de l'accueil (simple / détaillée), retenue par appareil et partagée entre tous les écrans qui la lisent. */
export function useVueAccueil(): [VueAccueil, (v: VueAccueil) => void] {
  const [vue, setVueEtat] = useState<VueAccueil>(lire)
  useEffect(() => {
    const maj = () => setVueEtat(lire())
    window.addEventListener(EVENEMENT_VUE_ACCUEIL, maj)
    window.addEventListener('storage', maj)
    return () => { window.removeEventListener(EVENEMENT_VUE_ACCUEIL, maj); window.removeEventListener('storage', maj) }
  }, [])
  const poser = useCallback((v: VueAccueil) => {
    enMemoire = v
    try { localStorage.setItem(CLE_VUE_ACCUEIL, v) } catch { /* retenu en mémoire seulement */ }
    setVueEtat(v)
    window.dispatchEvent(new Event(EVENEMENT_VUE_ACCUEIL))
  }, [])
  return [vue, poser]
}
