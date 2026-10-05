// Vue mobile / ordinateur / auto (src/lib/vue.ts).
import { verifie, bilan } from './_assert.ts'
import { lireVue, viewportDe, estVue, VIEWPORT_BASE, LARGEUR_ORDINATEUR } from '../src/lib/vue.ts'

console.log('verifier-vue')
verifie('défaut = auto (rien en stockage, valeur inconnue)', lireVue(null) === 'auto' && lireVue('tablette') === 'auto' && lireVue(3) === 'auto')
verifie('valeurs valides retenues', lireVue('mobile') === 'mobile' && lireVue('ordinateur') === 'ordinateur' && estVue('auto'))
verifie('auto et mobile : viewport de l’appareil', viewportDe('auto') === VIEWPORT_BASE && viewportDe('mobile') === VIEWPORT_BASE)
verifie('ordinateur : viewport fixe large', viewportDe('ordinateur').includes(`width=${LARGEUR_ORDINATEUR}`) && !viewportDe('ordinateur').includes('device-width'))
bilan('verifier-vue')
