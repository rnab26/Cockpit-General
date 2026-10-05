import { useEffect, useSyncExternalStore } from 'react'
import {
  INTERVALLE_VERSION_MS, REGLAGES_VERSION_DEFAUT, banniereVisible, lireInfoVersion, lireReglagesVersion, nouvelleVersion, peutMajAuto,
  statutVersion, type EtatVersion, type InfoVersion, type Lecture, type ReglagesVersion,
} from '../lib/version.ts'
import { aUnBrouillon } from '../ui/Modale.ts'

declare const __VERSION_APP__: string
declare const __DATE_APP__: string

/** La version qui tourne (commit de la construction, « dev » en local). */
export const VERSION_APP: string = typeof __VERSION_APP__ === 'string' ? __VERSION_APP__ : 'dev'
const DATE_APP: string | null = typeof __DATE_APP__ === 'string' ? __DATE_APP__ : null
const COURANTE: InfoVersion = { version: VERSION_APP, date: DATE_APP }
const CLE = 'cockpit_maj'
const SUIVI_ACTIF = import.meta.env.PROD && VERSION_APP !== 'dev'

// Un seul état pour toute l'app (bannière + Réglages) : une lecture, une vérité.
interface Etat { lue: InfoVersion | null; lecture: Lecture; ecarteA: number | null; enCours: boolean; reglages: ReglagesVersion; tic: number }
let etat: Etat = { lue: null, lecture: 'jamais', ecarteA: null, enCours: false, reglages: lireStock(), tic: 0 }
const abonnes = new Set<() => void>()
function lireStock(): ReglagesVersion {
  try { return lireReglagesVersion(localStorage.getItem(CLE)) } catch { return REGLAGES_VERSION_DEFAUT }
}
function poser(p: Partial<Etat>) { etat = { ...etat, ...p }; abonnes.forEach((f) => f()) }

/** Relit version.json SANS cache. Rend l'état qui en résulte (pour dire le résultat). */
export async function verifierVersion(): Promise<EtatVersion> {
  if (!SUIVI_ACTIF) return { courante: COURANTE, lue: null, lecture: 'ok' }
  poser({ lecture: 'en_cours' })
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
    const info = r.ok ? lireInfoVersion(await r.json()) : null
    if (!info) throw new Error('version illisible')
    poser({ lue: info, lecture: 'ok' })
    return { courante: COURANTE, lue: info, lecture: 'ok' }
  } catch {
    poser({ lecture: 'erreur' })
    return { courante: COURANTE, lue: etat.lue, lecture: 'erreur' }
  }
}

/**
 * « Mettre à jour » pour de vrai : désinscrit le service worker, vide ses
 * caches, force le réseau pour la page (le cache HTTP de GitHub Pages garde
 * index.html ~10 min), puis recharge. Le fragment de l'adresse est conservé.
 */
export async function appliquerMiseAJour(): Promise<void> {
  poser({ enCours: true })
  try {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k)
    await fetch(window.location.pathname, { cache: 'reload' })
    await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'reload' })
  } catch { /* hors ligne : le rechargement dira lui-même l'erreur */ }
  window.location.reload()
}

export function reglerVersion(r: Partial<ReglagesVersion>): boolean {
  const reglages = { ...etat.reglages, ...r }
  poser({ reglages })
  try { localStorage.setItem(CLE, JSON.stringify(reglages)); return true } catch { return false }
}

/** « Plus tard » : écarté pour le délai de rappel, puis la bannière revient. En mémoire seulement : un nouveau lancement la remontre. */
export function ecarterBanniere() { poser({ ecarteA: Date.now() }) }

const abonner = (f: () => void) => { abonnes.add(f); return () => { abonnes.delete(f) } }
const lireEtat = () => etat

/** Boucle de suivi, à monter UNE fois (NouvelleVersion). */
export function useSuiviVersion() {
  useEffect(() => {
    if (!SUIVI_ACTIF) return
    const lire = () => { if (document.visibilityState !== 'hidden') void verifierVersion() }
    const auRetour = () => { if (document.visibilityState === 'visible') void verifierVersion() }
    // Le tic fait réapparaître la bannière écartée sans nouvelle lecture, et laisse l'auto attendre la fin d'une saisie.
    const t = window.setInterval(lire, INTERVALLE_VERSION_MS)
    const tic = window.setInterval(() => poser({ tic: etat.tic + 1 }), 15_000)
    document.addEventListener('visibilitychange', auRetour)
    window.addEventListener('focus', auRetour)
    void verifierVersion()
    return () => { window.clearInterval(t); window.clearInterval(tic); document.removeEventListener('visibilitychange', auRetour); window.removeEventListener('focus', auRetour) }
  }, [])
}

export interface VueVersion {
  etat: EtatVersion
  statut: ReturnType<typeof statutVersion>
  nouvelle: boolean
  banniere: boolean
  enCours: boolean
  reglages: ReglagesVersion
}

export function useVersion(): VueVersion {
  const e = useSyncExternalStore(abonner, lireEtat)
  const nouvelle = SUIVI_ACTIF && nouvelleVersion(VERSION_APP, e.lue)
  const ev: EtatVersion = { courante: COURANTE, lue: e.lue, lecture: e.lecture }
  return {
    etat: ev, statut: statutVersion(ev), nouvelle, enCours: e.enCours, reglages: e.reglages,
    banniere: banniereVisible({ nouvelle, ecarteA: e.ecarteA, maintenant: Date.now(), rappelMin: e.reglages.rappelMin }),
  }
}

/** Mise à jour automatique (réglage, éteint par défaut) : seulement quand rien n'est en cours de saisie. */
export function useMajAuto() {
  const v = useVersion()
  const e = useSyncExternalStore(abonner, lireEtat)
  useEffect(() => {
    if (peutMajAuto({ auto: v.reglages.auto, nouvelle: v.nouvelle, brouillon: aUnBrouillon(document.body), enCours: v.enCours })) void appliquerMiseAJour()
  }, [v.reglages.auto, v.nouvelle, v.enCours, e.tic])
}
