// « Nouvelle version en ligne » (30 sept. 2026, Raphaël : « comment faire pour
// que les correctifs prennent sans recharger la page ? »). Les DONNÉES
// arrivent en direct (temps réel) ; le CODE de l'app, lui, reste celui du
// chargement tant que la page vit — une appli installée peut rester ouverte
// des jours. Chaque construction grave son numéro (commit) dans l'app ET dans
// `version.json` à côté (vite.config.ts, une seule source) ; l'app relit ce
// fichier et propose de se mettre à jour d'un toucher.

/** Relecture pendant que l'app est ouverte ; en plus, à chaque retour sur l'app. */
export const INTERVALLE_VERSION_MS = 5 * 60_000

/** Vrai quand le site sert une autre version que celle qui tourne. Jamais en développement ni sur une lecture vide. */
export function nouvelleVersion(courante: string, lue: unknown): boolean {
  if (!courante || courante === 'dev') return false
  const v = lue && typeof lue === 'object' ? (lue as { version?: unknown }).version : null
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== 'dev' && v.trim() !== courante
}
