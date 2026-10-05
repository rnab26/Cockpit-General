// Lien profond d'une notification : le fragment ramène au bon fil.
// node --experimental-strip-types app/scripts/verifier-lien-notification.ts
import { verifie, bilan } from './_assert.ts'
import { lireLienFil, lienFil } from '../src/lib/lienNotification.ts'

const P = '11111111-2222-3333-4444-555555555555', C = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
console.log('lien de notification')
verifie('fil d\'un chantier', JSON.stringify(lireLienFil(`#fil=${P}:${C}`)) === JSON.stringify({ projetId: P, chantierId: C }))
verifie('fil du projet', JSON.stringify(lireLienFil(`#fil=${P}`)) === JSON.stringify({ projetId: P, chantierId: null }))
verifie('aller-retour', JSON.stringify(lireLienFil(lienFil('https://x/y/', P, C))) === JSON.stringify({ projetId: P, chantierId: C }))
verifie('à côté de projet=', lireLienFil(`#projet=cockpit&fil=${P}:${C}`)?.chantierId === C)
verifie('rien', lireLienFil('') === null && lireLienFil('#projet=cockpit') === null)
verifie('identifiant bidon refusé', lireLienFil('#fil=abc') === null)
bilan('verifier-lien-notification')
