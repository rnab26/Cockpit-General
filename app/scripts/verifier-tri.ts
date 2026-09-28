// L'ordre d'urgence d'un bac : humain attendu > à vérifier > en cours >
// bloqué > libre > à trier > à cadrer > reporté ; puis priorité haute d'abord.
import { verifie, bilan } from './_assert.ts'
import { trierChantiers, rangUrgence } from '../src/lib/tri.ts'

const c = (id: string, etat: string, priorite = 'normale', updated_at = '2026-09-28T10:00:00Z') =>
  ({ id, etat, priorite, updated_at, titre: id }) as never
const liste = [
  c('reporte', 'reporte'), c('a_cadrer', 'a_cadrer'), c('a_trier', 'a_trier'), c('libre', 'libre'),
  c('bloque', 'bloque'), c('en_cours', 'en_cours'), c('a_verifier', 'a_verifier'), c('question', 'libre'),
]
console.log('verifier-tri')
const ordre = trierChantiers(liste, new Set(['question'])).map((x: { id: string }) => x.id)
verifie('ordre complet d’urgence', JSON.stringify(ordre) === JSON.stringify(['question','a_verifier','en_cours','bloque','libre','a_trier','a_cadrer','reporte']), ordre)
verifie('une question en attente passe devant tout (rang 0)', rangUrgence({ etat: 'reporte' }, true) === 0)
const prio = trierChantiers([c('normale', 'libre', 'normale'), c('haute', 'libre', 'haute'), c('basse', 'libre', 'basse')], new Set())
  .map((x: { id: string }) => x.id)
verifie('à état égal, priorité haute d’abord', JSON.stringify(prio) === JSON.stringify(['haute','normale','basse']), prio)
const mixte = trierChantiers([c('libre-haute', 'libre', 'haute'), c('en-cours-basse', 'en_cours', 'basse')], new Set())
  .map((x: { id: string }) => x.id)
verifie('l’état prime sur la priorité', mixte[0] === 'en-cours-basse', mixte)
const recent = trierChantiers([c('vieux', 'libre', 'normale', '2026-09-01T00:00:00Z'), c('recent', 'libre', 'normale', '2026-09-28T00:00:00Z')], new Set())
  .map((x: { id: string }) => x.id)
verifie('à égalité, le plus récemment touché d’abord', recent[0] === 'recent', recent)
verifie('le tri ne modifie pas la liste d’origine', liste[0].id === 'reporte')
bilan('verifier-tri')
