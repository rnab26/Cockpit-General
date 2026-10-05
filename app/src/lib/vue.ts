/**
 * Vue de l'app : mobile, ordinateur, ou automatique (défaut). Réglage de
 * l'APPAREIL (comme le thème) : un téléphone peut afficher la vue ordinateur
 * sans que le PC en hérite. Une seule règle décide du viewport ; le reste
 * (stockage, classe CSS) vit dans hooks/useVue.ts.
 * - auto : comportement d'origine ;
 * - ordinateur : viewport fixe 1280 px (un téléphone dézoome la page ; sur un
 *   vrai ordinateur c'est sans effet) ;
 * - mobile : viewport de l'appareil + colonne étroite centrée sur grand écran
 *   (classe `vue-mobile`, voir index.css).
 */
export type Vue = 'auto' | 'mobile' | 'ordinateur'
export const VUES: readonly { valeur: Vue; libelle: string; aide: string }[] = [
  { valeur: 'auto', libelle: 'Auto', aide: 'S’adapte à l’écran.' },
  { valeur: 'mobile', libelle: 'Mobile', aide: 'Colonne étroite, gros boutons.' },
  { valeur: 'ordinateur', libelle: 'Ordinateur', aide: 'Page large, comme sur un PC.' },
]
export const VUE_DEFAUT: Vue = 'auto'
export const LARGEUR_ORDINATEUR = 1280
export const VIEWPORT_BASE = 'width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover'

export function estVue(v: unknown): v is Vue {
  return v === 'auto' || v === 'mobile' || v === 'ordinateur'
}
export function lireVue(brut: unknown): Vue {
  return estVue(brut) ? brut : VUE_DEFAUT
}
/** Vue Mobile = application : pas de pincement ni de zoom à gérer (Raphaël, 05/10). */
export const VIEWPORT_APPLI = `${VIEWPORT_BASE}, maximum-scale=1, user-scalable=no`
export function viewportDe(v: Vue): string {
  return v === 'ordinateur' ? `width=${LARGEUR_ORDINATEUR}, viewport-fit=cover` : v === 'mobile' ? VIEWPORT_APPLI : VIEWPORT_BASE
}
