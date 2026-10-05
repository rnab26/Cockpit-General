import type { Vue } from './vue.ts'
import type { OngletProjet } from './vueProjet.ts'

/**
 * Navigation « application » : barre d'onglets fixe en bas (Raphaël, 05/10 :
 * « une vraie navigation type téléphone, là c'est trop en mode navigateur »).
 * UNE règle : où elle apparaît. Mobile = toujours ; Ordinateur = jamais ;
 * Auto = sur un écran tactile (pointeur grossier). Le reste vit dans
 * components/BarreOnglets.tsx et hooks/useNavMobile.ts.
 */
export function navMobileActive(vue: Vue, tactile: boolean): boolean {
  return vue === 'mobile' || (vue === 'auto' && tactile)
}

/** Hauteur de la barre (hors zone de sécurité) : une seule valeur, lue par le CSS (--nav-h) pour tout ce qui est collé en bas. */
export const HAUTEUR_BARRE_PX = 56

export type OngletBarre = 'accueil' | 'projet' | 'recherche' | 'couts' | 'reglages'

/** Quel onglet de la barre est allumé, selon l'écran affiché. */
export function ongletBarreActif(vueTout: boolean, onglet: OngletProjet, recherche: boolean): OngletBarre {
  if (recherche) return 'recherche'
  if (vueTout) return 'accueil'
  return onglet === 'couts' ? 'couts' : onglet === 'reglages' ? 'reglages' : 'projet'
}
