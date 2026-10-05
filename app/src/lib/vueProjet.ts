import type { Chantier, Message } from './types.ts'
import { normaliser } from './doublons.ts'

/** Les trois menus de la vue d'un projet (chantier 9cc71872) : on arrive toujours sur « travail ». */
export type OngletProjet = 'travail' | 'reglages' | 'couts'
export const ONGLET_DEFAUT: OngletProjet = 'travail'

export interface ResultatRecherche {
  /** Id du chantier, ou null pour la discussion générale du projet. */
  chantierId: string | null
  projetId: string
  titre: string
  /** Où le mot a été trouvé, en clair. */
  extrait: string
}

const LIMITE = 30

function extraitAutour(texte: string, q: string): string {
  const i = Math.max(0, normaliser(texte).indexOf(q))
  const debut = Math.max(0, i - 25)
  const morceau = texte.slice(debut, debut + 90).replace(/\s+/g, ' ').trim()
  return `${debut > 0 ? '…' : ''}${morceau}${texte.length > debut + 90 ? '…' : ''}`
}

/**
 * Recherche dans les chantiers (titre, demande, résumé) et dans leurs fils
 * (messages), puis dans la discussion générale du projet. `projetId` = un seul
 * projet, null = tous. Une requête vide ne trouve rien (l'écran montre alors
 * le mode d'emploi, pas toute la liste).
 */
export function chercher(requete: string, chantiers: readonly Chantier[], messages: readonly Message[], projetId: string | null): ResultatRecherche[] {
  const q = normaliser(requete)
  if (!q) return []
  const parChantier = new Map<string, Message[]>()
  for (const m of messages) if (m.chantier_id) { const l = parChantier.get(m.chantier_id); if (l) l.push(m); else parChantier.set(m.chantier_id, [m]) }
  const sortie: ResultatRecherche[] = []
  for (const c of chantiers) {
    if (projetId && c.projet_id !== projetId) continue
    const direct = [c.titre, c.demande ?? '', c.resume_simple ?? ''].find((t) => normaliser(t).includes(q))
    if (direct !== undefined) { sortie.push({ chantierId: c.id, projetId: c.projet_id, titre: c.titre, extrait: direct === c.titre ? '' : extraitAutour(direct, q) }); continue }
    const m = (parChantier.get(c.id) ?? []).find((x) => normaliser(x.corps ?? '').includes(q))
    if (m) sortie.push({ chantierId: c.id, projetId: c.projet_id, titre: c.titre, extrait: `Dans le fil : ${extraitAutour(m.corps, q)}` })
  }
  const vus = new Set<string>()
  for (const m of messages) {
    if (m.chantier_id || (projetId && m.projet_id !== projetId) || vus.has(m.projet_id)) continue
    if (normaliser(m.corps ?? '').includes(q)) { vus.add(m.projet_id); sortie.push({ chantierId: null, projetId: m.projet_id, titre: 'Discussion du projet', extrait: extraitAutour(m.corps, q) }) }
  }
  return sortie.slice(0, LIMITE)
}
