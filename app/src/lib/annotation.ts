// Crayon sur une image jointe (29 sept. 2026) : logique pure, testée par
// app/scripts/verifier-annotation.ts. Le dessin lui-même vit dans Annoter.tsx
// (un <canvas>, aucune librairie).

/** Les couleurs proposées : lisibles sur une capture claire comme sombre. */
export const COULEURS_ANNOTATION = [
  { nom: 'Rouge', valeur: '#ef4444' },
  { nom: 'Jaune', valeur: '#facc15' },
  { nom: 'Vert', valeur: '#22c55e' },
  { nom: 'Bleu', valeur: '#3b82f6' },
] as const

/** Deux épaisseurs, en part du grand côté de l'image : un trait garde la même allure quelle que soit sa taille. */
export const EPAISSEURS_ANNOTATION = { fin: 0.006, epais: 0.016 } as const
export type Epaisseur = keyof typeof EPAISSEURS_ANNOTATION

/** Plus grand côté de l'image enregistrée : assez pour lire une capture, loin des 50 Mo du stockage. */
export const COTE_MAX_ANNOTATION = 2560

export interface Point { x: number; y: number }
export interface Trait { couleur: string; epaisseur: Epaisseur; points: Point[] }

/** Taille de l'image enregistrée : celle d'origine, réduite si un côté dépasse `max` (proportions gardées). */
export function dimensionsSortie(largeur: number, hauteur: number, max = COTE_MAX_ANNOTATION): { largeur: number; hauteur: number } {
  const l = Math.max(1, Math.round(largeur)), h = Math.max(1, Math.round(hauteur))
  const grand = Math.max(l, h)
  if (grand <= max) return { largeur: l, hauteur: h }
  const k = max / grand
  return { largeur: Math.max(1, Math.round(l * k)), hauteur: Math.max(1, Math.round(h * k)) }
}

/** Largeur d'un trait en pixels de l'image (jamais sous 2 px : visible même sur une petite image). */
export function largeurTrait(epaisseur: Epaisseur, largeur: number, hauteur: number): number {
  return Math.max(2, Math.round(EPAISSEURS_ANNOTATION[epaisseur] * Math.max(largeur, hauteur)))
}

/** Un toucher à l'écran → le point de l'image (le canvas est affiché réduit), borné à l'image. */
export function versImage(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, largeur: number, hauteur: number): Point {
  const x = ((clientX - rect.left) / (rect.width || 1)) * largeur
  const y = ((clientY - rect.top) / (rect.height || 1)) * hauteur
  return { x: Math.min(largeur, Math.max(0, x)), y: Math.min(hauteur, Math.max(0, y)) }
}

/**
 * L'historique des traits : chaque geste (un trait, « tout effacer ») empile
 * l'état d'avant, « annuler » le dépile — même « tout effacer » se rattrape.
 */
export interface Dessin { traits: Trait[]; avant: Trait[][] }
export const DESSIN_VIDE: Dessin = { traits: [], avant: [] }
export function ajouterTrait(d: Dessin, t: Trait): Dessin {
  return t.points.length ? { traits: [...d.traits, t], avant: [...d.avant, d.traits] } : d
}
export function toutEffacer(d: Dessin): Dessin {
  return d.traits.length ? { traits: [], avant: [...d.avant, d.traits] } : d
}
export function annulerGeste(d: Dessin): Dessin {
  return d.avant.length ? { traits: d.avant[d.avant.length - 1], avant: d.avant.slice(0, -1) } : d
}

/** Format enregistré : PNG pour ce qui l'est déjà (captures, transparence), JPEG pour les photos. */
export function typeSortie(type: string): 'image/png' | 'image/jpeg' {
  return /^image\/(jpe?g|heic|heif)$/i.test(type) ? 'image/jpeg' : 'image/png'
}

/** « capture.png » → « capture-annotee.png » ; ré-annoter ne rallonge pas le nom. */
export function nomAnnote(nom: string, type: 'image/png' | 'image/jpeg'): string {
  const base = (nom.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'image').replace(/(-annotee)+$/, '')
  return `${base}-annotee.${type === 'image/png' ? 'png' : 'jpg'}`
}
