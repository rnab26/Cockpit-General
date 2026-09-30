// Déplacer un chantier vers un autre projet (src/lib/deplacer.ts, 0036).
import { verifie, bilan } from './_assert.ts'
import { projetsCibles, texteConfirmationDeplacement } from '../src/lib/deplacer.ts'

console.log('verifier-deplacer')
const ps = [
  { id: '1', slug: 'facepro', nom: 'FacePro' }, { id: '2', slug: 'cockpit', nom: 'Cockpit' },
  { id: '3', slug: 'test-web-ab12', nom: 'Test' }, { id: '4', slug: 'vieux', nom: 'Vieux', actif: false }, { id: '5', slug: 'alpha', nom: 'Alpha' },
]
const c = projetsCibles(ps, '1')
verifie('cibles : pas le projet actuel, pas de test, pas d’éteint, triés par nom', c.map((p) => p.slug).join() === 'alpha,cockpit', c)
verifie('aucun autre projet : liste vide', projetsCibles([ps[0]], '1').length === 0)
const t = texteConfirmationDeplacement('Bouton trop petit', 'FacePro', 'Cockpit', 3, 'Correctifs')
verifie('confirmation : titre, départ, arrivée, messages, section', /Bouton trop petit/.test(t) && /FacePro/.test(t) && /3 messages/.test(t) && /« Correctifs »/.test(t))
verifie('confirmation : sans message ni section', /pas encore de message/.test(texteConfirmationDeplacement('x', 'A', 'B', 0, null)) && /sans section/.test(texteConfirmationDeplacement('x', 'A', 'B', 0, null)))
bilan('verifier-deplacer')
