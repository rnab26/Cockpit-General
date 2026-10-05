/**
 * Où l'on en était (projet, onglet, fil ouvert, défilement), gardé sur l'appareil pour
 * le retrouver quand le navigateur a vidé l'appli pendant qu'on était ailleurs (lien d'une
 * carte « À toi » ouvert sur GitHub, puis retour : le téléphone libère la page et la recharge,
 * ce qui renvoyait à l'accueil). Une seule règle de lecture.
 */
export interface EtatEcran {
  /** Slug du projet affiché, ou null pour « Tout » (l'accueil). */
  slug: string | null
  onglet: 'travail' | 'reglages' | 'couts'
  conversation: { projetId: string; chantierId: string | null } | null
  scrollY: number
  at: number
}

export const CLE_ETAT_ECRAN = 'cockpit_etat_ecran'
/** Au-delà, on repart de l'accueil : un état de la veille ne doit pas surprendre. */
export const VALIDITE_ETAT_ECRAN_MS = 2 * 3600_000

const ONGLETS = ['travail', 'reglages', 'couts']

export function lireEtatEcran(brut: string | null, maintenant: number): EtatEcran | null {
  if (!brut) return null
  try {
    const o = JSON.parse(brut) as Partial<EtatEcran> | null
    if (!o || typeof o !== 'object' || typeof o.at !== 'number') return null
    if (maintenant - o.at > VALIDITE_ETAT_ECRAN_MS || o.at > maintenant + 60_000) return null
    const c = o.conversation
    const conversation = c && typeof c.projetId === 'string' && (c.chantierId === null || typeof c.chantierId === 'string')
      ? { projetId: c.projetId, chantierId: c.chantierId } : null
    return {
      slug: typeof o.slug === 'string' ? o.slug : null,
      onglet: ONGLETS.includes(o.onglet as string) ? (o.onglet as EtatEcran['onglet']) : 'travail',
      conversation,
      scrollY: typeof o.scrollY === 'number' && o.scrollY > 0 && Number.isFinite(o.scrollY) ? Math.round(o.scrollY) : 0,
      at: o.at,
    }
  } catch { return null }
}

/** L'état sauvé ne vaut que si le lien ouvert ne vise pas un autre projet. */
export function etatCoherent(e: EtatEcran | null, slugDuLien: string | null): EtatEcran | null {
  if (!e) return null
  return !slugDuLien || slugDuLien === e.slug ? e : null
}

export function sauverEtatEcran(e: EtatEcran): void {
  try { localStorage.setItem(CLE_ETAT_ECRAN, JSON.stringify(e)) } catch { /* stockage indisponible : on perd seulement la reprise */ }
}
export function chargerEtatEcran(): EtatEcran | null {
  try { return lireEtatEcran(localStorage.getItem(CLE_ETAT_ECRAN), Date.now()) } catch { return null }
}
