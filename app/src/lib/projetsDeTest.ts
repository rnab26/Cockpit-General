/**
 * Les projets de TEST (slug `test-…`) : créés et supprimés par les bancs
 * (verifier-web, verifier-embed, verifier-base…). Raphaël ne les voit JAMAIS,
 * ni en onglet ni dans « Tout », même pendant qu'un banc tourne (29 sept.
 * 2026 : « des demandes de chantier que je ne comprends pas d'où elles
 * sortent »). Seuls les comptes de test des bancs (`test-…@cockpit.local`)
 * les voient, pour pouvoir les parcourir.
 *
 * Même règle que `cockpit.projet_de_test(slug)` en base (migration 0017) et
 * `EST_TEST` de scripts/bancs.mjs.
 */
export const PREFIXE_PROJET_DE_TEST = 'test-'

export function estProjetDeTest(slug: string | null | undefined): boolean {
  return (slug ?? '').startsWith(PREFIXE_PROJET_DE_TEST)
}

/** Un compte de banc (test-cockpit@cockpit.local, test-verif-…@cockpit.local), jamais une personne. */
export function estCompteDeTest(email: string | null | undefined): boolean {
  return /^test-[^@]*@cockpit\.local$/i.test(email ?? '')
}

/** Les projets que cette personne voit : sans les projets de test, sauf pour un compte de test. */
export function projetsVisibles<P extends { slug: string }>(projets: P[], email: string | null | undefined): P[] {
  return estCompteDeTest(email) ? projets : projets.filter((p) => !estProjetDeTest(p.slug))
}

/** Garde les lignes (chantiers, messages, activités…) des seuls projets visibles. */
export function lignesVisibles<L extends { projet_id: string | null }>(lignes: L[], idsVisibles: Set<string>): L[] {
  return lignes.filter((l) => l.projet_id != null && idsVisibles.has(l.projet_id))
}
