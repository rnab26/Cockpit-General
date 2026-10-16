// Les cartes déjà traitées se retirent seules (16 oct. 2026, migration 0092, chantier fe412d83).
// Raphaël : « pourquoi est-ce que je devrais faire une action manuelle ? […] pollution visuelle. Je veux vraiment que ce soit
// automatisé » et « j'ai pas la date ni l'horaire de quand ça date ». La RÈGLE du retrait est en base (`carte_depassee`) : l'écran
// n'en recalcule aucune. Ici, seulement ce qu'il faut pour MONTRER ce que la base a fait (et le remettre) et pour dater les lignes.
import type { Chantier, Message, Projet } from './types.ts'
import type { ElementAToi } from './entonnoir.ts'

/** Ce que la base écrit devant la raison d'une carte retirée toute seule (déclencheur « chantier archivé » compris). */
export const PREFIXE_RETRAIT = 'Retirée automatiquement : '
/** Combien de jours une carte retirée seule reste visible dans « Retirées seules » (au-delà : elle est passée). */
export const JOURS_RETIREES = 7
/** Le délai par défaut d'un projet (= la valeur par défaut de la colonne `projets.epuration_delai_h`, comparée par verifier-base). */
export const DELAI_EPURATION_DEFAUT_H = 24
export const DELAI_EPURATION_MAX_H = 720

export interface CarteRetiree { message: Message; chantier: Chantier | null; retireeAt: string; raison: string }

/** La raison, sans le préfixe écrit par la base : « restée 46 h sans réponse pendant que le projet avançait (29 livraisons depuis). » */
export function raisonRetrait(m: Pick<Message, 'reponse'>): string {
  const r = (m.reponse ?? '').trim()
  return r.startsWith(PREFIXE_RETRAIT) ? r.slice(PREFIXE_RETRAIT.length).trim() : r
}

/**
 * Les cartes retirées TOUTES SEULES (pas celles qu'il a fermées lui-même, ni celles d'un chantier archivé : elles n'ont plus
 * d'objet), depuis `jours` jours, la plus récente d'abord. Une carte qu'il a remise (epuration_exclue) n'en fait plus partie.
 */
export function cartesRetireesSeules(messages: readonly Message[], chantiers: readonly Chantier[], now: Date, jours = JOURS_RETIREES): CarteRetiree[] {
  const parId = new Map(chantiers.map((c) => [c.id, c]))
  const limite = now.getTime() - jours * 86_400_000
  const out: CarteRetiree[] = []
  for (const m of messages) {
    if (!m.retiree_seule_at || !m.answered_at || m.epuration_exclue) continue
    if (new Date(m.retiree_seule_at).getTime() < limite) continue
    const c = m.chantier_id ? parId.get(m.chantier_id) ?? null : null
    if (m.chantier_id && !c) continue                            // chantier plus visible : rien à remettre
    if (c && c.archived_at && c.etat !== 'valide') continue      // archivé : la question n'a plus d'objet de toute façon
    out.push({ message: m, chantier: c, retireeAt: m.retiree_seule_at, raison: raisonRetrait(m) })
  }
  return out.sort((a, b) => b.retireeAt.localeCompare(a.retireeAt) || a.message.id.localeCompare(b.message.id))
}

/** « 1 carte retirée seule », « 13 cartes retirées seules » ; rien quand il n'y en a pas (la ligne n'apparaît pas). */
export function phraseRetirees(n: number): string {
  if (n <= 0) return ''
  return n === 1 ? '1 carte retirée seule' : `${n} cartes retirées seules`
}

/** Depuis quand chaque chantier attend quelque chose de Raphaël : le plus récent de ses éléments (clé : id du chantier). */
export function depuisParChantier(elements: readonly Pick<ElementAToi, 'chantier' | 'depuis'>[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of elements) {
    if (!e.chantier) continue
    const avant = m.get(e.chantier.id)
    if (!avant || e.depuis > avant) m.set(e.chantier.id, e.depuis)
  }
  return m
}

/** La liste « Pour toi » : ce qui attend depuis le moins longtemps en haut (comme « À toi de jouer »), puis l'ordre d'origine. */
export function ordrePourToi<T extends { id: string }>(chantiers: readonly T[], depuis: ReadonlyMap<string, string>): T[] {
  const rang = new Map(chantiers.map((c, i) => [c.id, i]))
  return [...chantiers].sort((a, b) => (depuis.get(b.id) ?? '').localeCompare(depuis.get(a.id) ?? '') || (rang.get(a.id) ?? 0) - (rang.get(b.id) ?? 0))
}

/** Le réglage d'un projet (heures, 0 = jamais), avec le défaut de la base quand la colonne n'est pas encore arrivée. */
export function delaiEpuration(p: Pick<Projet, 'epuration_delai_h'> | null | undefined): number {
  const h = p?.epuration_delai_h
  return typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= DELAI_EPURATION_MAX_H ? h : DELAI_EPURATION_DEFAUT_H
}

/** Ce qu'il tape dans le champ des heures : un entier de 0 à 720, sinon null (le champ le dit). */
export function delaiSaisi(texte: string): number | null {
  const t = texte.trim()
  if (!/^\d{1,3}$/.test(t)) return null
  const n = Number(t)
  return n >= 0 && n <= DELAI_EPURATION_MAX_H ? n : null
}

/** La phrase du réglage : « jamais », « après 24 h », « après 3 jours ». Une action attend 7 fois plus (dit à part dans l'écran). */
export function phraseDelai(h: number): string {
  if (h <= 0) return 'jamais'
  if (h % 24 === 0 && h >= 48) return `après ${h / 24} jours`
  return `après ${h} h`
}
