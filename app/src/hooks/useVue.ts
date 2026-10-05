import { useCallback, useState } from 'react'
import { lireVue, viewportDe, VUE_DEFAUT, type Vue } from '../lib/vue.ts'

const CLE = 'cockpit_vue'

function lire(): Vue {
  try { return lireVue(localStorage.getItem(CLE)) } catch { return VUE_DEFAUT }
}
export function appliquerVue(v: Vue) {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', viewportDe(v))
  document.documentElement.classList.toggle('vue-mobile', v === 'mobile')
}
/** Appelé avant le premier rendu (main.tsx) : pas de flash de la mauvaise vue. */
export function preparerVue() { appliquerVue(lire()) }

/** Retourne la vue, et un changement qui dit si le réglage a tenu (false : stockage refusé, vue valable pour la session). */
export function useVue(): [Vue, (v: Vue) => boolean] {
  const [vue, setVue] = useState<Vue>(lire)
  const changer = useCallback((v: Vue) => {
    setVue(v); appliquerVue(v)
    try { if (v === VUE_DEFAUT) localStorage.removeItem(CLE); else localStorage.setItem(CLE, v); return true } catch { return false }
  }, [])
  return [vue, changer]
}
