// Replier tout / filtrer « À toi de jouer » : règles pures.
import { verifie, bilan } from './_assert.ts'
import { lireRepliees, basculerRepli, toutBasculer, toutEstReplie, comptesAToi, filtreEffectif, filtrerAToi, SECTIONS_ACCUEIL, LIBELLE_FILTRE_A_TOI } from '../src/lib/repli.ts'

console.log('verifier-repli')
verifie('préférence absente ou invalide : rien de replié', lireRepliees(undefined).size === 0 && lireRepliees('x').size === 0 && lireRepliees({}).size === 0)
verifie('clés inconnues ignorées', lireRepliees(['a-toi', 'nimporte', 3]).size === 1)
const un = new Set(lireRepliees(['a-toi']))
verifie('basculer replie puis déplie', basculerRepli(new Set(), 'a-toi').join() === 'a-toi' && basculerRepli(un, 'a-toi').length === 0)
verifie('tout replier quand rien ne l’est', toutBasculer(new Set()).length === SECTIONS_ACCUEIL.length)
verifie('tout replier quand une partie l’est', toutBasculer(un).length === SECTIONS_ACCUEIL.length)
verifie('tout déplier quand tout l’est', toutBasculer(new Set(SECTIONS_ACCUEIL)).length === 0 && toutEstReplie(new Set(SECTIONS_ACCUEIL)))
verifie('une partie repliée n’est pas « tout replié »', !toutEstReplie(un))

const el = [{ type: 'question' }, { type: 'question' }, { type: 'a_verifier' }, { type: 'bloque' }] as never[]
verifie('comptes par type, types absents omis, ordre d’urgence', JSON.stringify(comptesAToi(el)) === JSON.stringify([{ type: 'question', n: 2 }, { type: 'a_verifier', n: 1 }, { type: 'bloque', n: 1 }]))
verifie('pastille Actions : comptée et filtrable, entre Questions et Fusions', JSON.stringify(comptesAToi([{ type: 'a_verifier' }, { type: 'action' }, { type: 'question' }] as never[]).map((x) => x.type)) === JSON.stringify(['question', 'action', 'a_verifier']) && filtreEffectif('action', [{ type: 'action' }] as never[]) === 'action' && LIBELLE_FILTRE_A_TOI.action === 'Actions')
verifie('filtre valide gardé', filtreEffectif('a_verifier', el) === 'a_verifier')
verifie('filtre sans élément : pas de filtre (jamais une liste vide cachée)', filtreEffectif('fusion', el) === null)
verifie('filtre inconnu ou absent : pas de filtre', filtreEffectif('zzz', el) === null && filtreEffectif(undefined, el) === null)
verifie('filtrer', filtrerAToi(el, 'question').length === 2 && filtrerAToi(el, null).length === 4)
bilan('verifier-repli')
