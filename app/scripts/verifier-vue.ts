// Vue mobile / ordinateur / auto (src/lib/vue.ts).
import { verifie, bilan } from './_assert.ts'
import { lireVue, viewportDe, estVue, VIEWPORT_BASE, VIEWPORT_APPLI, LARGEUR_ORDINATEUR } from '../src/lib/vue.ts'

console.log('verifier-vue')
verifie('défaut = auto (rien en stockage, valeur inconnue)', lireVue(null) === 'auto' && lireVue('tablette') === 'auto' && lireVue(3) === 'auto')
verifie('valeurs valides retenues', lireVue('mobile') === 'mobile' && lireVue('ordinateur') === 'ordinateur' && estVue('auto'))
verifie('auto : viewport de l’appareil ; mobile : le même sans zoom (application)', viewportDe('auto') === VIEWPORT_BASE && viewportDe('mobile') === VIEWPORT_APPLI && /maximum-scale=1/.test(VIEWPORT_APPLI) && /device-width/.test(VIEWPORT_APPLI))
verifie('ordinateur : viewport fixe large', viewportDe('ordinateur').includes(`width=${LARGEUR_ORDINATEUR}`) && !viewportDe('ordinateur').includes('device-width'))
import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const bloc = css.slice(css.indexOf('Vue « mobile » forcée'))
verifie('colonne 430 px seulement sur écran à souris (jamais sur un téléphone)', /@media \(pointer: fine\) and \(min-width: 431px\)\s*\{[^]*html\.vue-mobile #root \{ max-width: 430px/.test(bloc))
verifie('aucune règle vue-mobile hors de ce @media', !/^html\.vue-mobile/m.test(bloc))
for (const f of ['Cockpit', 'EnTete', 'BarreSelection']) verifie(`${f} : plus large sur grand écran`, readFileSync(new URL(`../src/components/${f}.tsx`, import.meta.url), 'utf8').includes('max-w-3xl lg:max-w-5xl'))
verifie('auto + tactile : sans zoom ; auto à la souris : zoom gardé ; ordinateur inchangé', viewportDe('auto', true) === VIEWPORT_APPLI && viewportDe('auto', false) === VIEWPORT_BASE && viewportDe('ordinateur', true).startsWith('width=1280'))
bilan('verifier-vue')
