// Lien d'invitation : https://…/Cockpit-General/#invitation=<jeton>
// Dans le fragment (#) pour ne jamais partir vers un serveur ni dans un journal d'accès.
// Gardé sur l'appareil jusqu'à acceptation : il survit au détour par le mail de confirmation.

const CLE = 'cockpit.invitation'
const RE = /[#&]invitation=([a-f0-9]{32,128})/

export const lienInvitation = (jeton: string): string => `${location.origin}${location.pathname}#invitation=${jeton}`

/** À appeler au chargement : range le jeton de l'adresse, puis nettoie l'adresse. */
export function capterInvitation(): void {
  try {
    const m = RE.exec(location.hash)
    if (!m) return
    localStorage.setItem(CLE, m[1])
    history.replaceState(null, '', location.pathname + location.search)
  } catch { /* stockage indisponible : le lien devra être rouvert */ }
}
export function jetonEnAttente(): string | null {
  try { return localStorage.getItem(CLE) } catch { return null }
}
export function oublierInvitation(): void {
  try { localStorage.removeItem(CLE) } catch { /* rien */ }
}

export const LIBELLE_ROLE: Record<string, string> = { lecteur: 'Lecture seule', suggere: 'Suggère', utilisateur: 'Valide' }
export const AIDE_ROLE: Record<string, string> = {
  lecteur: 'Voit le projet et ses chantiers. Ne peut rien écrire.',
  suggere: 'Voit, écrit des demandes et des messages. Ne certifie ni ne corrige : c’est toi qui valides.',
  utilisateur: 'Comme « Suggère », et certifie, corrige et répond aux décisions sur les chantiers visibles.',
}

/** Les trois droits réglables personne par personne (migration 0059). Le rôle donne le modèle de départ. */
export type Droit = 'demandes' | 'messages' | 'valider'
export type Droits = Partial<Record<Droit, boolean>>
export const DROITS: { cle: Droit; libelle: string; aide: string }[] = [
  { cle: 'demandes', libelle: 'Créer des demandes', aide: 'Peut proposer un nouveau chantier ou correctif.' },
  { cle: 'messages', libelle: 'Écrire dans les fils', aide: 'Peut commenter et répondre sur les chantiers.' },
  { cle: 'valider', libelle: 'Valider', aide: 'Peut certifier, corriger et répondre aux décisions.' },
]
/** Ce que le modèle du rôle accorde (miroir de cockpit.droit_du_role ; le serveur reste seul juge). */
export const droitDuRole = (role: string, d: Droit): boolean => (d === 'valider' ? role === 'utilisateur' : role === 'suggere' || role === 'utilisateur')
/** Droit effectif : le réglage personnel, sinon le modèle du rôle. */
export const droitEffectif = (role: string, droits: Droits | null | undefined, d: Droit): boolean => droits?.[d] ?? droitDuRole(role, d)
/** Ne garde dans `droits` que ce qui DIFFÈRE du modèle (null = aucun écart). */
export function ecartsDuModele(role: string, voulu: Record<Droit, boolean>): Droits | null {
  const o: Droits = {}
  for (const { cle } of DROITS) if (voulu[cle] !== droitDuRole(role, cle)) o[cle] = voulu[cle]
  return Object.keys(o).length ? o : null
}
export const resumeDroits = (role: string, droits: Droits | null | undefined): string =>
  DROITS.filter(({ cle }) => droitEffectif(role, droits, cle)).map(({ libelle }) => libelle.toLowerCase()).join(', ') || 'voit seulement'
