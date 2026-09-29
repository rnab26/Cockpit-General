/**
 * Appli installable (29 sept. 2026, Raphaël : « installer l'appli depuis la
 * page internet du cockpit, c'est plus pratique »). Une seule règle décide ce
 * que l'écran propose ; le reste (événement du navigateur) vit dans
 * hooks/useInstallation.ts.
 *
 * - installee : on tourne déjà en appli (plein écran) → rien à proposer ;
 * - possible : Chrome/Edge a donné son invite (beforeinstallprompt) → un
 *   toucher ouvre la vraie fenêtre « Installer » ;
 * - iphone : Safari n'a pas d'invite → aide « Partager › Sur l'écran d'accueil » ;
 * - manuel : navigateur sans invite (pas encore prête, Firefox…) → aide par le
 *   menu du navigateur.
 */
export type EtatInstallation = 'installee' | 'possible' | 'iphone' | 'manuel'

export function etatInstallation(o: { standalone: boolean; invite: boolean; userAgent: string; pointsTactiles?: number }): EtatInstallation {
  if (o.standalone) return 'installee'
  if (o.invite) return 'possible'
  if (estIos(o.userAgent, o.pointsTactiles ?? 0)) return 'iphone'
  return 'manuel'
}

/** iPhone/iPad (un iPad récent se présente comme un Mac tactile). */
export function estIos(userAgent: string, pointsTactiles: number): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && pointsTactiles > 1)
}

export const TEXTE_INSTALLATION: Record<Exclude<EtatInstallation, 'installee' | 'possible'>, string[]> = {
  iphone: [
    'Dans Safari, touche le bouton Partager (carré avec une flèche).',
    'Choisis « Sur l’écran d’accueil », puis « Ajouter ».',
  ],
  manuel: [
    'Ouvre le menu du navigateur (⋮ en haut à droite dans Chrome).',
    'Choisis « Installer l’appli » (ou « Ajouter à l’écran d’accueil » puis « Installer »).',
    'Si Chrome dit « Impossible d’installer », recharge la page une fois et réessaie.',
  ],
}
