import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import type { OptionsConfirm } from './Confirm.tsx'

/**
 * Une seule règle pour tout ce qui s'ouvre par-dessus l'écran (conversation
 * d'un chantier, dialogues, menus) — Raphaël, 29 sept. 2026 : « quitter en
 * appuyant sur les zones extérieures, c'est beaucoup plus ergonomique ».
 *  - toucher le fond (hors de la carte) ferme, Échap ferme, le « retour » du
 *    téléphone ferme la conversation ;
 *  - un texte ou un fichier pas encore envoyé n'est jamais perdu sans
 *    prévenir : on demande d'abord.
 */

/** La question posée avant de perdre un texte non envoyé. */
export const CONFIRMER_ABANDON: OptionsConfirm = {
  titre: 'Quitter sans envoyer ?',
  texte: 'Ce que tu as écrit (ou joint) n’est pas encore envoyé. Si tu quittes, il sera perdu.',
  libelleOk: 'Quitter sans envoyer',
  libelleAnnuler: 'Rester',
  danger: true,
}

/**
 * Vrai si la zone contient un texte tapé et pas encore envoyé (champ de
 * saisie non vide) ou une pièce jointe en attente. Un champ en lecture seule
 * (la consigne à copier) ou marqué `data-sans-brouillon` ne compte pas.
 */
export function aUnBrouillon(racine: HTMLElement | null): boolean {
  if (!racine) return false
  const champs = racine.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input:not([type]), input[type="text"], input[type="email"], input[type="url"]')
  for (const z of champs) if (!z.readOnly && !z.disabled && z.value.trim() && !z.closest('[data-sans-brouillon]')) return true
  return !!racine.querySelector('[data-testid="piece-jointe"]')
}

/**
 * Le toucher sur le FOND d'un <dialog> modal : le navigateur l'adresse au
 * <dialog> lui-même (la carte le recouvre partout ailleurs). On exige que le
 * doigt se soit posé ET levé sur le fond : un glisser commencé dans la carte
 * (sélection de texte, défilement) qui finit dehors ne ferme rien.
 */
export function useToucherLeFond<T extends HTMLElement>(surFond: () => void, estFond: (cible: EventTarget, zone: T) => boolean = (c, z) => c === z) {
  const pose = useRef(false)
  return {
    onPointerDown: (e: PointerEvent<T>) => { pose.current = estFond(e.target, e.currentTarget) },
    onClick: (e: MouseEvent<T>) => {
      const ok = pose.current && estFond(e.target, e.currentTarget)
      pose.current = false
      if (ok) surFond()
    },
  }
}

/**
 * Un menu déroulant ouvert se ferme en touchant ailleurs ou avec Échap — et
 * Échap ne ferme QUE le menu, pas la conversation ou le dialogue dessous.
 */
export function useMenuQuiSeFerme(ouvert: boolean, zone: RefObject<HTMLElement | null>, fermer: () => void) {
  const f = useRef(fermer)
  f.current = fermer
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: Event) => { if (!zone.current?.contains(e.target as Node)) f.current() }
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.current() } }
    document.addEventListener('pointerdown', dehors)
    document.addEventListener('keydown', echap, true)
    return () => { document.removeEventListener('pointerdown', dehors); document.removeEventListener('keydown', echap, true) }
  }, [ouvert, zone])
}
