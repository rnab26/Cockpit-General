// « Claude m'a répondu » : réponses non lues par fil (lib/lecture.ts).
// node --experimental-strip-types app/scripts/verifier-lecture.ts
import { verifie, bilan } from './_assert.ts'
import { reponsesNonLues, totalNonLus, nouveauLu, cleFil, lireLus } from '../src/lib/lecture.ts'

const m = (o: object) => ({ projet_id: 'P', chantier_id: 'C', auteur_type: 'session', kind: 'info', repond_a: 'x', created_at: '2026-09-30T10:00:00Z', ...o }) as never
const depuis = '2026-09-30T09:00:00Z'

console.log('réponses non lues')
verifie('une réponse de Claude est non lue', reponsesNonLues([m({})], {}, depuis).get('C')?.n === 1)
verifie('ligne automatique (sans repond_a) : pas une réponse', reponsesNonLues([m({ repond_a: null })], {}, depuis).size === 0)
verifie('message de Raphaël : pas une réponse', reponsesNonLues([m({ auteur_type: 'proprietaire' })], {}, depuis).size === 0)
verifie('avant « lu_depuis » : ancien historique ignoré', reponsesNonLues([m({ created_at: '2026-09-30T08:00:00Z' })], {}, depuis).size === 0)
verifie('lu après la réponse : rien', reponsesNonLues([m({})], { C: '2026-09-30T10:00:00Z' }, depuis).size === 0)
verifie('lu avant la réponse : non lue', reponsesNonLues([m({})], { C: '2026-09-30T09:30:00Z' }, depuis).size === 1)
const deux = reponsesNonLues([m({}), m({ created_at: '2026-09-30T10:05:00Z' }), m({ chantier_id: null })], {}, depuis)
verifie('compte par fil', deux.get('C')?.n === 2 && deux.get('projet:P')?.n === 1 && totalNonLus(deux) === 3)
verifie('cleFil', cleFil('P', null) === 'projet:P' && cleFil('P', 'C') === 'C')
verifie('lireLus tolère n\'importe quoi', Object.keys(lireLus(null)).length === 0 && Object.keys(lireLus([1])).length === 0 && lireLus({ a: '1', b: 2 }).a === '1')
verifie('nouveauLu : dernier message', nouveauLu([m({}), m({ created_at: '2026-09-30T10:05:00Z' })], 'C', {}) === '2026-09-30T10:05:00Z')
verifie('nouveauLu : déjà à jour → null', nouveauLu([m({})], 'C', { C: '2026-09-30T10:00:00Z' }) === null)
bilan('verifier-lecture')
