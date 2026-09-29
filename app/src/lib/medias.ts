// Médias joints aux réponses (0013). Logique pure : chemin, contrôle, libellés.
// Le dépôt et la lecture passent par le stockage privé `cockpit-medias`.
import type { Media } from './types.ts'

export const BUCKET_MEDIAS = 'cockpit-medias'
/** Plafond par fichier : celui du plan gratuit Supabase, posé aussi sur le bucket. */
export const TAILLE_MAX_MEDIA = 50 * 1024 * 1024
export const MEDIAS_MAX_PAR_MESSAGE = 10
/** Ce que le sélecteur propose (photos, vidéos, audio, PDF, textes) ; tout autre fichier reste possible. */
export const ACCEPT_MEDIAS = 'image/*,video/*,audio/*,application/pdf,text/*,.zip,.json,.csv,.log'

export type GenreMedia = 'image' | 'video' | 'audio' | 'pdf' | 'fichier'

export function genreMedia(type: string, nom = ''): GenreMedia {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/pdf' || /\.pdf$/i.test(nom)) return 'pdf'
  return 'fichier'
}

/** Un nom de fichier sûr pour un chemin de stockage (sans accents, espaces ni caractères spéciaux). */
export function nomSur(nom: string): string {
  const base = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-+$/g, '')
  return (base || 'fichier').slice(-80)
}

/** `<projet>/<chantier | projet>/<id>-<nom>` : le premier dossier porte le droit (politiques 0013). */
export function cheminMedia(projetId: string, chantierId: string | null, id: string, nom: string): string {
  return `${projetId}/${chantierId ?? 'projet'}/${id}-${nomSur(nom)}`
}

export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / 1024 / 1024).toFixed(octets < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} Mo`
}

/** Ce qui empêche d'ajouter ces fichiers (null = rien). */
export function refusMedias(fichiers: readonly { name: string; size: number }[], dejaJoints: number): string | null {
  if (dejaJoints + fichiers.length > MEDIAS_MAX_PAR_MESSAGE) return `${MEDIAS_MAX_PAR_MESSAGE} pièces au plus par message.`
  const trop = fichiers.find((f) => f.size > TAILLE_MAX_MEDIA)
  if (trop) return `« ${trop.name} » fait ${tailleLisible(trop.size)} : 50 Mo au plus par fichier.`
  const vide = fichiers.find((f) => f.size === 0)
  if (vide) return `« ${vide.name} » est vide.`
  return null
}

/** Les médias d'un message, toujours un tableau (colonne absente sur une vieille ligne → []). */
export function mediasDe(m: { medias?: Media[] | null }): Media[] {
  return Array.isArray(m.medias) ? m.medias : []
}

/** « 2 photos, 1 vidéo » — pour le fil replié et le texte d'un message sans mots. */
export function resumeMedias(medias: readonly Media[]): string {
  if (!medias.length) return ''
  const n = { image: 0, video: 0, audio: 0, pdf: 0, fichier: 0 } as Record<GenreMedia, number>
  for (const m of medias) n[genreMedia(m.type, m.nom)]++
  const mots: [GenreMedia, string, string][] = [['image', 'photo', 'photos'], ['video', 'vidéo', 'vidéos'], ['audio', 'audio', 'audios'], ['pdf', 'PDF', 'PDF'], ['fichier', 'fichier', 'fichiers']]
  return mots.filter(([g]) => n[g]).map(([g, un, plusieurs]) => `${n[g]} ${n[g] > 1 ? plusieurs : un}`).join(', ')
}
