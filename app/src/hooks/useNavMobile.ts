import { useEffect, useState } from 'react'
import { lireVue, type Vue } from '../lib/vue.ts'
import { HAUTEUR_BARRE_PX, navMobileActive } from '../lib/navMobile.ts'

function vueActuelle(): Vue { return lireVue(document.documentElement.dataset.vue) }
function tactile(): boolean { try { return matchMedia('(pointer: coarse)').matches } catch { return false } }

/** Vrai quand la barre d'onglets du bas doit s'afficher ; suit le réglage de vue (événement posé par appliquerVue). */
/** Clavier ouvert (la zone visible rétrécit nettement) : la barre se cache pour ne pas flotter au-dessus. */
function useClavierOuvert(): boolean {
  const [ouvert, setOuvert] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const maj = () => setOuvert(window.innerHeight - vv.height > 150 && vv.scale <= 1.01)
    vv.addEventListener('resize', maj)
    maj()
    return () => vv.removeEventListener('resize', maj)
  }, [])
  return ouvert
}

export function useNavMobile(): boolean {
  const clavier = useClavierOuvert()
  const [actifBrut, setActif] = useState(() => navMobileActive(vueActuelle(), tactile()))
  useEffect(() => {
    const maj = () => setActif(navMobileActive(vueActuelle(), tactile()))
    window.addEventListener('cockpit-vue', maj)
    let mq: MediaQueryList | null = null
    try { mq = matchMedia('(pointer: coarse)'); mq.addEventListener('change', maj) } catch { /* ancien navigateur */ }
    return () => { window.removeEventListener('cockpit-vue', maj); mq?.removeEventListener('change', maj) }
  }, [])
  const actif = actifBrut && !clavier
  // Tout ce qui est collé en bas (bulle, sélection, messages) se décale de la barre via --nav-h.
  useEffect(() => {
    const r = document.documentElement
    r.style.setProperty('--nav-h', actif ? `calc(${HAUTEUR_BARRE_PX}px + env(safe-area-inset-bottom))` : '0px')
    return () => { r.style.removeProperty('--nav-h') }
  }, [actif])
  return actif
}
