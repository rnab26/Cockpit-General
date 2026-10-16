// « Classer sans test » (13 oct. 2026, migration 0079) : règles pures de lib/classerLivres.ts.
import { verifie, bilan } from './_assert.ts'
import { DELAIS_CLASSEMENT, idsAClasser, joursDeSaisie, libelleDelai, phraseClasses, titreConfirmation } from '../src/lib/classerLivres.ts'

console.log('verifier-classer-livres')

verifie('délais proposés : jamais, 3, 7, 14, 30 jours', JSON.stringify(DELAIS_CLASSEMENT) === JSON.stringify([null, 3, 7, 14, 30]))
verifie('libellés : « jamais », « 1 jour », « 7 jours »', libelleDelai(null) === 'jamais' && libelleDelai(undefined) === 'jamais' && libelleDelai(1) === '1 jour' && libelleDelai(7) === '7 jours')
verifie('saisie du choix : un entier de 1 à 90 est gardé, le reste (vide, texte, 0, 91, décimal) = jamais',
  joursDeSaisie('7') === 7 && joursDeSaisie('90') === 90 && joursDeSaisie('1') === 1 && ['', ' ', 'abc', '0', '91', '-3', '2.5'].every((x) => joursDeSaisie(x) === null))
const el = (type: string, id: string | null) => ({ type, chantier: id ? { id } : null }) as never
verifie('ids à classer : seulement les chantiers « à tester », un par chantier, jamais une question ni un élément sans chantier',
  JSON.stringify(idsAClasser([el('a_verifier', 'a'), el('a_verifier', 'b'), el('a_verifier', 'a'), el('question', 'c'), el('a_verifier', null), el('bloque', 'd')])) === JSON.stringify(['a', 'b']))
verifie('textes : singulier et pluriel', titreConfirmation(1) === 'Classer 1 chantier sans test ?' && titreConfirmation(56) === 'Classer 56 chantiers sans test ?'
  && phraseClasses(1) === '1 chantier classé sans test.' && phraseClasses(3) === '3 chantiers classés sans test.')

bilan('verifier-classer-livres')
