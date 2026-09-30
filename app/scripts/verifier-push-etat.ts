// Réglage des notifications push : ce que l'écran propose (lib/push.ts).
// node --experimental-strip-types app/scripts/verifier-push-etat.ts
import { verifie, bilan } from './_assert.ts'
import { etatPush, cleEnOctets, cleEnTexte } from '../src/lib/push.ts'

const base = { supporte: true, ios: false, standalone: false, cleServeur: true, permission: 'default' as const, abonne: false }
console.log('état des notifications')
verifie('possible : inactif', etatPush(base) === 'inactif')
verifie('abonné et autorisé : actif', etatPush({ ...base, permission: 'granted', abonne: true }) === 'actif')
verifie('abonné mais permission retirée : refusé', etatPush({ ...base, permission: 'denied', abonne: true }) === 'refuse')
verifie('permission bloquée : refusé (marche à suivre)', etatPush({ ...base, permission: 'denied' }) === 'refuse')
verifie('navigateur sans push : non supporté', etatPush({ ...base, supporte: false }) === 'non_supporte')
verifie('serveur sans clé : non configuré', etatPush({ ...base, cleServeur: false }) === 'non_configure')
verifie('iPhone hors appli : installer d\'abord', etatPush({ ...base, ios: true, supporte: false }) === 'ios_installer')
verifie('iPhone dans l\'appli installée : possible', etatPush({ ...base, ios: true, standalone: true }) === 'inactif')
const cle = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
verifie('clé VAPID : 65 octets, commence par 4', cleEnOctets(cle).length === 65 && cleEnOctets(cle)[0] === 4)
verifie('aller-retour base64url', cleEnTexte(cleEnOctets(cle).buffer as ArrayBuffer) === cle)
bilan('verifier-push-etat')
