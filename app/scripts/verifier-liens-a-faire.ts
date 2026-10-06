// Liens directs de « À faire de ton côté » (src/lib/liensAFaire.ts, chantier 2be961b8).
import { verifie, bilan } from './_assert.ts'
import { liensAFaire } from '../src/lib/liensAFaire.ts'

console.log('verifier-liens-a-faire')
verifie('rien à faire : aucun lien', liensAFaire([], null).length === 0 && liensAFaire([{}, { marche: null }], '').length === 0)
const pr = { marche: { liens: [{ url: 'https://github.com/rnab26/Cockpit-General/pull/115', libelle: 'Ouvrir la PR #115' }], etapes: ['x'], copier: [] } }
verifie('le lien d’une carte est repris, avec son libellé', liensAFaire([pr])[0]?.libelle === 'Ouvrir la PR #115')
verifie('deux cartes, même adresse : une seule fois', liensAFaire([pr, pr]).length === 1)
const l = liensAFaire([], '1. Ouvre https://rnab26.github.io/Cockpit-General/. 2. Touche « Ça marche » (voir https://a.b/c).')
verifie('adresses des étapes : repérées, ponctuation finale retirée', l.length === 2 && l[0].url === 'https://rnab26.github.io/Cockpit-General/' && l[1].url === 'https://a.b/c')
verifie('http et javascript: jamais', liensAFaire([{ marche: { liens: [{ url: 'http://a.b' }, { url: 'javascript:x' }] } }], 'http://a.b/x').length === 0)
bilan('verifier-liens-a-faire')
