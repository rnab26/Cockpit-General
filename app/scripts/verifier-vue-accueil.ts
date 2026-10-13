// L'accueil simple (13 oct. 2026) : règles pures de lib/vueAccueil.ts.
import { verifie, bilan } from './_assert.ts'
import { CLE_VUE_ACCUEIL, VISIBLES_ACCUEIL, VUE_ACCUEIL_DEFAUT, libelleATester, libelleEnAttente, lireVueAccueil } from '../src/lib/vueAccueil.ts'

console.log('verifier-vue-accueil')

verifie('la vue simple est la vue par défaut', VUE_ACCUEIL_DEFAUT === 'simple' && lireVueAccueil(null) === 'simple' && lireVueAccueil(undefined) === 'simple')
verifie('lecture défensive : « detaillee » et « simple » sont lues, tout le reste donne la vue par défaut',
  lireVueAccueil('detaillee') === 'detaillee' && lireVueAccueil('simple') === 'simple'
  && ['', 'DETAILLEE', 'detaillée', 'ancienne', 42, {}, true].every((x) => lireVueAccueil(x) === 'simple'))
verifie('la préférence vit sur l’appareil sous une clé stable (les bancs la posent pour garder l’ancien accueil)', CLE_VUE_ACCUEIL === 'cockpit_accueil')
verifie('chaque bloc limite ses lignes : cinq demandes, cinq en cours, trois livrés, cinq à tester',
  VISIBLES_ACCUEIL.demandes === 5 && VISIBLES_ACCUEIL.enCours === 5 && VISIBLES_ACCUEIL.livre === 3 && VISIBLES_ACCUEIL.aTester === 5)
verifie('« livrés à tester » : singulier et pluriel', libelleATester(1) === '1 livré à tester' && libelleATester(56) === '56 livrés à tester')
verifie('« attendent une session » : singulier et pluriel', libelleEnAttente(1) === '1 chantier attend une session' && libelleEnAttente(27) === '27 chantiers attendent une session')

bilan('verifier-vue-accueil')
