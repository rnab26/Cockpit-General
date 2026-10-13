// L'accueil simple (13 oct. 2026) : règles pures de lib/vueAccueil.ts.
import { verifie, bilan } from './_assert.ts'
import { CLE_VUE_ACCUEIL, VISIBLES_ACCUEIL, VUE_ACCUEIL_DEFAUT, libelleATester, libelleEnAttente, lireVueAccueil, phraseSansChantier } from '../src/lib/vueAccueil.ts'

console.log('verifier-vue-accueil')

// 13 oct. 2026, Raphaël : « pourquoi tu as supprimé mes box avec le nombre de chantiers et les barres de progression, j'en ai besoin » :
// l'écran avec les boxes, le tableau par section et les barres est la vue par défaut ; la vue simple se choisit, elle ne s'impose pas.
verifie('la vue détaillée (boxes, barres de progression) est la vue par défaut', VUE_ACCUEIL_DEFAUT === 'detaillee' && lireVueAccueil(null) === 'detaillee' && lireVueAccueil(undefined) === 'detaillee')
verifie('lecture défensive : « detaillee » et « simple » sont lues, tout le reste donne la vue par défaut',
  lireVueAccueil('detaillee') === 'detaillee' && lireVueAccueil('simple') === 'simple'
  && ['', 'DETAILLEE', 'detaillée', 'ancienne', 42, {}, true].every((x) => lireVueAccueil(x) === 'detaillee'))
verifie('la préférence vit sur l’appareil sous une clé stable (les bancs de la vue simple la posent)', CLE_VUE_ACCUEIL === 'cockpit_accueil')
verifie('chaque bloc limite ses lignes : cinq demandes, cinq en cours, trois livrés, cinq à tester',
  VISIBLES_ACCUEIL.demandes === 5 && VISIBLES_ACCUEIL.enCours === 5 && VISIBLES_ACCUEIL.livre === 3 && VISIBLES_ACCUEIL.aTester === 5)
verifie('« livrés à tester » : singulier et pluriel', libelleATester(1) === '1 livré à tester' && libelleATester(56) === '56 livrés à tester')
verifie('« attendent une session » : singulier et pluriel', libelleEnAttente(1) === '1 chantier attend une session' && libelleEnAttente(27) === '27 chantiers attendent une session')

verifie('« personne ne travaille » ne ment pas : des conversations sans chantier précis sont dites',
  phraseSansChantier({ sessions: 2, agents: 0 }, true) === 'Claude travaille sur ce projet (2 conversations), mais sans chantier précis.'
  && phraseSansChantier({ sessions: 1, agents: 3 }, false) === 'Claude travaille (1 conversation · 3 assistants), mais sans chantier précis.'
  && phraseSansChantier({ sessions: 0, agents: 1 }, true) === 'Claude travaille sur ce projet (1 assistant), mais sans chantier précis.'
  && phraseSansChantier({ sessions: 0, agents: 0 }, true) === null)

bilan('verifier-vue-accueil')
