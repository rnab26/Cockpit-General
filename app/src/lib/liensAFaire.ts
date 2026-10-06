/**
 * Les liens directs de « À faire de ton côté » (chantier 2be961b8 ; Raphaël, 6 oct. 2026 :
 * « pourquoi tu ne mets pas les liens de ce qu'il y a à faire ici, afin de faciliter et épurer les tâches »).
 * UNE règle : chaque geste en attente donne sa page exacte, ouvrable d'un toucher depuis l'en-tête de la zone,
 * sans déplier la carte. Sources : le lien de la marche à suivre d'une carte (`messages.marche`), et les adresses
 * https écrites dans les étapes « Comment vérifier » d'un chantier à vérifier. Dédoublonné, https seulement.
 */
import { lienSur, marcheDe } from './marche.ts'

export interface LienAFaire { url: string; libelle: string }

const ADRESSE = /https:\/\/[^\s)»"'<>]+/g

export function liensAFaire(cartes: Array<{ marche?: unknown }>, commentVerifier?: string | null): LienAFaire[] {
  const vus = new Set<string>()
  const sortie: LienAFaire[] = []
  const ajoute = (url: string, libelle: string) => {
    const u = url.replace(/[.,;:]+$/, '')
    if (!lienSur(u) || vus.has(u)) return
    vus.add(u); sortie.push({ url: u, libelle })
  }
  for (const c of cartes) for (const l of marcheDe(c)?.liens ?? []) ajoute(l.url, l.libelle)
  for (const u of (commentVerifier ?? '').match(ADRESSE) ?? []) ajoute(u, 'Ouvrir la page à vérifier')
  return sortie
}
