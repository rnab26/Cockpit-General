// Similarité de titres : Jaccard sur les mots (≥ 3 lettres), titres
// normalisés sans accents. Deux usages, deux seuils : à la saisie (0,6,
// avertissement non bloquant) et dans la vue Doublons (0,5, côte à côte).
// Un seuil se remesure sur les vrais titres avant d'être baissé.

export const SEUIL_SAISIE = 0.6
export const SEUIL_DOUBLONS = 0.5

export function normaliser(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function motsUtiles(titre: string): Set<string> {
  return new Set(normaliser(titre).split(' ').filter((m) => m.length >= 3))
}

export function jaccard(a: string, b: string): number {
  const ma = motsUtiles(a)
  const mb = motsUtiles(b)
  if (ma.size === 0 || mb.size === 0) return 0
  let inter = 0
  for (const m of ma) if (mb.has(m)) inter++
  const union = ma.size + mb.size - inter
  return union === 0 ? 0 : inter / union
}

export interface TitreExistant { id: string; titre: string }

/** À la saisie : les chantiers dont le titre ressemble à celui qu'on tape. */
export function titresProches<T extends TitreExistant>(titre: string, existants: readonly T[], seuil = SEUIL_SAISIE): (T & { score: number })[] {
  if (motsUtiles(titre).size === 0) return []
  return existants
    .map((e) => ({ ...e, score: jaccard(titre, e.titre) }))
    .filter((e) => e.score >= seuil)
    .sort((a, b) => b.score - a.score)
}

export function clePaire(a: string, b: string): string {
  return [a, b].sort().join('|')
}

export interface Paire<T> { a: T; b: T; score: number; cle: string }

/** Vue Doublons : toutes les paires de chantiers qui se ressemblent, hors paires ignorées. */
export function pairesDoublons<T extends TitreExistant>(chantiers: readonly T[], ignorees: ReadonlySet<string> = new Set(), seuil = SEUIL_DOUBLONS): Paire<T>[] {
  const paires: Paire<T>[] = []
  for (let i = 0; i < chantiers.length; i++) {
    for (let j = i + 1; j < chantiers.length; j++) {
      const a = chantiers[i], b = chantiers[j]
      const cle = clePaire(a.id, b.id)
      if (ignorees.has(cle)) continue
      const score = jaccard(a.titre, b.titre)
      if (score >= seuil) paires.push({ a, b, score, cle })
    }
  }
  return paires.sort((x, y) => y.score - x.score)
}
