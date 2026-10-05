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
