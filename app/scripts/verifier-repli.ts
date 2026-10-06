// Replier tout / filtrer « À toi de jouer » : règles pures.
import { verifie, bilan } from './_assert.ts'
import { lireRepliees, basculerRepli, toutBasculer, toutEstReplie, comptesAToi, pastillesVisibles, filtreEffectif, filtrerAToi, SECTIONS_ACCUEIL, LIBELLE_FILTRE_A_TOI } from '../src/lib/repli.ts'

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
// Pastille « Actions » toujours visible (5 oct. 2026) : avant, `comptes.length > 1` la cachait avec UN seul type.
const T = (...t: string[]) => t.map((type) => ({ type })) as never[]
verifie('cause prouvée : une seule action = un seul type, la règle d’avant (> 1 type) la cachait', comptesAToi(T('action')).length === 1)
verifie('une seule action : pastilles visibles (Actions sort)', pastillesVisibles(T('action')))
verifie('plusieurs actions seules : visibles', pastillesVisibles(T('action', 'action')))
verifie('une action + une question : visibles', pastillesVisibles(T('question', 'action')))
verifie('un seul type (questions) : visibles (constamment tant qu’il y a à faire)', pastillesVisibles(T('question', 'question')))
verifie('zéro élément : masquées (l’état vide « Rien ne t’attend » s’affiche)', !pastillesVisibles([]))
verifie('zéro action mais deux autres types : visibles (règle générale inchangée)', pastillesVisibles(T('question', 'a_verifier')))
// Câblage de l'écran (verifier-web.mjs le joue en vrai quand l'environnement le permet ; ici, banc qui tourne toujours).
import { readFileSync } from 'node:fs'
const ecran = readFileSync(new URL('../src/components/TableauDeBord.tsx', import.meta.url), 'utf8')
verifie('écran : les pastilles passent par la règle unique pastillesVisibles (plus de seuil « comptes.length > 1 » dupliqué)', ecran.includes('pastillesVisibles(elements)') && !/comptes\.length\s*>\s*1/.test(ecran))
verifie('écran : une action se traite sur la ligne (Fait / Pas encore / Ça bloque → repondre_message, toast succès et échec), accueil comme vue projet (même SectionAToi)',
  ecran.includes('<ActionDirecte') && ecran.includes("rpc('repondre_message'") && ecran.includes('toast.succes') && ecran.includes('toast.erreur') && ['action-fait', 'action-pas-encore', 'action-bloque'].every((t) => ecran.includes(t)))
bilan('verifier-repli')
