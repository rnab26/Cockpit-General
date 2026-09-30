/**
 * Marche à suivre d'une action manuelle (0033, chantier e9a7c360).
 *
 * Raphaël, 30 sept. 2026 : « à chaque fois il faut que j'aille chercher et ce
 * n'est pas assez précis. Il faut que Claude renvoie les liens précis et les
 * démarches précises pour faire simplement des copier-coller ». Posée par
 * `scripts/demander.sh --action --lien … --etape … --copier …` dans
 * `messages.marche`. Ici : la lecture défensive de ce que l'écran affiche
 * (seulement des liens https, rien de vide), sans React pour être testée par
 * `app/scripts/verifier-marche.ts`.
 */

export interface LienMarche { url: string; libelle: string }
export interface TexteACopier { libelle: string; texte: string }
export interface MarcheASuivre { liens: LienMarche[]; etapes: string[]; copier: TexteACopier[] }

const chaine = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Une adresse qu'on peut ouvrir sans risque : https, rien d'autre (pas de javascript:, data:, http:). */
export function lienSur(url: string): boolean {
  try { return new URL(url).protocol === 'https:' } catch { return false }
}

/** La marche d'un message, nettoyée ; null s'il n'y a rien à montrer. */
export function marcheDe(m: { marche?: unknown }): MarcheASuivre | null {
  const brut = m.marche
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null
  const o = brut as Record<string, unknown>
  const tab = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const liens = tab(o.liens)
    .map((l) => ({ url: chaine((l as LienMarche)?.url).trim(), libelle: chaine((l as LienMarche)?.libelle).trim() || 'Ouvrir la page' }))
    .filter((l) => lienSur(l.url))
  const etapes = tab(o.etapes).map((e) => chaine(e).trim()).filter(Boolean)
  const copier = tab(o.copier)
    .map((c) => ({ libelle: chaine((c as TexteACopier)?.libelle).trim() || 'Texte à coller', texte: chaine((c as TexteACopier)?.texte) }))
    .filter((c) => c.texte.trim() !== '')
  if (!liens.length && !etapes.length && !copier.length) return null
  return { liens, etapes, copier }
}

/** Le domaine affiché sous le bouton du lien : il voit où il va avant de toucher. */
export function domaineDe(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
