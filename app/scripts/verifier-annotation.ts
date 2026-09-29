// Crayon sur une image jointe : node --experimental-strip-types app/scripts/verifier-annotation.ts
import { ajouterTrait, annulerGeste, DESSIN_VIDE, dimensionsSortie, largeurTrait, nomAnnote, toutEffacer, typeSortie, versImage, COULEURS_ANNOTATION, type Trait } from '../src/lib/annotation.ts'
let ok = 0, ko = 0
const verifie = (nom: string, cond: boolean, detail?: unknown) => { if (cond) ok++; else { ko++; console.log('✗', nom, detail ?? '') } }

verifie('3 à 4 couleurs', COULEURS_ANNOTATION.length >= 3 && COULEURS_ANNOTATION.length <= 4)
verifie('petite image : taille gardée', JSON.stringify(dimensionsSortie(1170, 2532)) === JSON.stringify({ largeur: 1170, hauteur: 2532 }) || dimensionsSortie(1170, 2532).hauteur === 2532)
const d = dimensionsSortie(4000, 3000)
verifie('grande photo : réduite à 2560 de large, proportions gardées', d.largeur === 2560 && d.hauteur === 1920, d)
verifie('portrait réduit', dimensionsSortie(3000, 6000).hauteur === 2560 && dimensionsSortie(3000, 6000).largeur === 1280)
verifie('dimensions jamais nulles', dimensionsSortie(0, 0).largeur === 1)
verifie('trait fin < trait épais', largeurTrait('fin', 1000, 800) < largeurTrait('epais', 1000, 800))
verifie('trait jamais sous 2 px', largeurTrait('fin', 10, 10) === 2)
verifie('trait proportionnel à l’image', largeurTrait('epais', 2000, 1000) === 2 * largeurTrait('epais', 1000, 500))
const p = versImage(150, 100, { left: 100, top: 50, width: 200, height: 100 }, 1000, 500)
verifie('toucher → point de l’image (affichage réduit)', p.x === 250 && p.y === 250, p)
const hors = versImage(0, 999, { left: 100, top: 50, width: 200, height: 100 }, 1000, 500)
verifie('toucher hors de l’image : borné au bord', hors.x === 0 && hors.y === 500, hors)

const t = (c: string): Trait => ({ couleur: c, epaisseur: 'fin', points: [{ x: 1, y: 1 }] })
let s = ajouterTrait(DESSIN_VIDE, t('a'))
s = ajouterTrait(s, t('b'))
verifie('deux traits', s.traits.length === 2)
verifie('un trait sans point est ignoré', ajouterTrait(s, { couleur: 'x', epaisseur: 'fin', points: [] }) === s)
verifie('annuler retire le dernier trait', annulerGeste(s).traits.map((x) => x.couleur).join() === 'a')
const e = toutEffacer(s)
verifie('tout effacer vide le dessin', e.traits.length === 0)
verifie('annuler après « tout effacer » rend les traits', annulerGeste(e).traits.length === 2)
verifie('tout effacer sur rien : aucun geste empilé', toutEffacer(DESSIN_VIDE) === DESSIN_VIDE)
verifie('annuler sur rien : sans effet', annulerGeste(DESSIN_VIDE) === DESSIN_VIDE)
verifie('annuler jusqu’au début', annulerGeste(annulerGeste(s)).traits.length === 0)

verifie('PNG reste PNG', typeSortie('image/png') === 'image/png')
verifie('photo JPEG → JPEG', typeSortie('image/jpeg') === 'image/jpeg' && typeSortie('image/heic') === 'image/jpeg')
verifie('WebP/GIF → PNG', typeSortie('image/webp') === 'image/png' && typeSortie('image/gif') === 'image/png')
verifie('nom annoté', nomAnnote('capture écran.png', 'image/png') === 'capture écran-annotee.png', nomAnnote('capture écran.png', 'image/png'))
verifie('nom annoté JPEG', nomAnnote('IMG_1.HEIC', 'image/jpeg') === 'IMG_1-annotee.jpg')
verifie('ré-annoter ne rallonge pas le nom', nomAnnote('a-annotee.png', 'image/png') === 'a-annotee.png')
verifie('nom sans extension', nomAnnote('photo', 'image/png') === 'photo-annotee.png')

console.log(`verifier-annotation : ${ok}/${ok + ko}`)
if (ko) process.exit(1)
