// Réglages des notifications : ce que l'écran affiche et le réglage qu'un geste fabrique (lib/notifications.ts).
// node --experimental-strip-types app/scripts/verifier-notifications.ts
import { verifie, bilan } from './_assert.ts'
import { avecProjet, avecTousProjets, avecType, lireReglages, projetVoulu, REGLAGES_VIDES, resume, tousLesProjetsVoulus, typeVoulu, type TypeNotif } from '../src/lib/notifications.ts'

const reponse: TypeNotif = { code: 'reponse', libelle: 'Claude a répondu', aide: '', defaut: true, emis: true, ordre: 1 }
const termine: TypeNotif = { code: 'termine', libelle: 'Chantier terminé', aide: '', defaut: false, emis: false, ordre: 4 }
const ids = ['a', 'b', 'c']
console.log('réglages des notifications')
verifie('rien de réglé : le défaut du catalogue', typeVoulu(reponse, REGLAGES_VIDES) === true && typeVoulu(termine, REGLAGES_VIDES) === false)
verifie('un choix explicite l\'emporte sur le défaut', typeVoulu(reponse, avecType(REGLAGES_VIDES, 'reponse', false)) === false)
verifie('tous les projets voulus par défaut', tousLesProjetsVoulus(ids, REGLAGES_VIDES))
const sansB = avecProjet(REGLAGES_VIDES, 'b', false)
verifie('couper un projet : lui seul', !projetVoulu('b', sansB) && projetVoulu('a', sansB) && !tousLesProjetsVoulus(ids, sansB))
verifie('rallumer un projet', projetVoulu('b', avecProjet(sansB, 'b', true)))
verifie('couper deux fois ne double pas', avecProjet(sansB, 'b', false).projets_coupes.length === 1)
verifie('« tous » coupe tout, puis rallume tout', avecTousProjets(REGLAGES_VIDES, ids, false).projets_coupes.length === 3 && avecTousProjets(sansB, ids, true).projets_coupes.length === 0)
verifie('lecture défensive : junk ignoré', JSON.stringify(lireReglages({ types: { x: 'oui', y: true }, projets_coupes: ['a', 3] })) === JSON.stringify({ types: { y: true }, projets_coupes: ['a'] }))
verifie('lecture d\'une ligne absente : réglage vide', JSON.stringify(lireReglages(null)) === JSON.stringify(REGLAGES_VIDES))
verifie('résumé : tout', resume([reponse, termine], ids, REGLAGES_VIDES).includes('sur tous les projets'))
verifie('résumé : un projet coupé', resume([reponse], ids, sansB).includes('2 projets sur 3'))
verifie('résumé : rien (type coupé)', resume([reponse], ids, avecType(REGLAGES_VIDES, 'reponse', false)).startsWith('Aucune notification'))
verifie('résumé : rien (projets coupés)', resume([reponse], ids, avecTousProjets(REGLAGES_VIDES, ids, false)).startsWith('Tous les projets sont coupés'))
verifie('un type non émis n\'est jamais annoncé', !resume([termine], ids, avecType(REGLAGES_VIDES, 'termine', true)).includes('terminé'))
bilan('verifier-notifications')
