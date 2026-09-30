/**
 * Notification push du téléphone (30 sept. 2026, chantier bff5a8cf) : « à régler
 * dans les paramètres pour savoir quand on est en dehors de l'application ».
 * Une seule règle décide ce que l'écran des Réglages propose (testée dans
 * verifier-push-etat.ts) ; le navigateur, l'abonnement et la base vivent dans
 * hooks/usePush.ts.
 *
 *  - non_supporte : ce navigateur n'a ni service worker ni Push ;
 *  - ios_installer : iPhone/iPad hors appli installée — Safari ne donne le push
 *    qu'à une appli posée sur l'écran d'accueil ;
 *  - non_configure : le serveur n'a pas (encore) de clé push ;
 *  - refuse : la permission est bloquée dans le navigateur (elle ne se
 *    redemande pas depuis l'appli : marche à suivre) ;
 *  - actif : cet appareil est abonné ; inactif : il peut l'être.
 */
export type EtatPush = 'non_supporte' | 'ios_installer' | 'non_configure' | 'refuse' | 'actif' | 'inactif'

export function etatPush(o: { supporte: boolean; ios: boolean; standalone: boolean; cleServeur: boolean; permission: NotificationPermission | 'absente'; abonne: boolean }): EtatPush {
  if (o.ios && !o.standalone) return 'ios_installer'
  if (!o.supporte) return 'non_supporte'
  if (!o.cleServeur) return 'non_configure'
  if (o.permission === 'denied') return 'refuse'
  if (o.abonne && o.permission === 'granted') return 'actif'
  return 'inactif'
}

/** La clé publique VAPID (base64url) au format attendu par `pushManager.subscribe`. */
export function cleEnOctets(base64url: string): Uint8Array {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** Les deux clés d'un abonnement, en base64url (le format de `web-push`). */
export function cleEnTexte(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  let s = ''
  for (const o of new Uint8Array(buf)) s += String.fromCharCode(o)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const TEXTE_REFUSE = [
  'Ouvre les réglages du site dans ton navigateur (Chrome : le cadenas à gauche de l’adresse › Autorisations).',
  'Mets « Notifications » sur « Autoriser ».',
  'Reviens ici et touche « Activer sur cet appareil ».',
]
