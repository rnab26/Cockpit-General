// Médias (0013) : chemin, contrôle des fichiers, libellés. node --experimental-strip-types app/scripts/verifier-medias.ts
import { cheminMedia, genreMedia, nomSur, refusMedias, resumeMedias, tailleLisible, mediasDe, MEDIAS_MAX_PAR_MESSAGE, TAILLE_MAX_MEDIA } from '../src/lib/medias.ts'
let ok = 0, ko = 0
const verifie = (nom: string, cond: boolean, detail?: unknown) => { if (cond) ok++; else { ko++; console.log('✗', nom, detail ?? '') } }

verifie('nom sans accents ni espaces', nomSur('Photo écran (1).PNG') === 'Photo-ecran-1-.PNG' || nomSur('Photo écran (1).PNG') === 'Photo-ecran-1.PNG', nomSur('Photo écran (1).PNG'))
verifie('nom vide → fichier', nomSur('###') === 'fichier')
verifie('nom long tronqué à 80', nomSur('a'.repeat(200) + '.jpg').length === 80)
verifie('chemin chantier', cheminMedia('P', 'C', 'X', 'a b.jpg') === 'P/C/X-a-b.jpg', cheminMedia('P', 'C', 'X', 'a b.jpg'))
verifie('chemin projet (sans chantier)', cheminMedia('P', null, 'X', 'a.pdf') === 'P/projet/X-a.pdf')
verifie('genre image', genreMedia('image/heic') === 'image')
verifie('genre vidéo', genreMedia('video/quicktime') === 'video')
verifie('genre pdf par extension', genreMedia('', 'devis.PDF') === 'pdf')
verifie('genre fichier', genreMedia('application/zip') === 'fichier')
verifie('taille Ko', tailleLisible(2048) === '2 Ko')
verifie('taille Mo', tailleLisible(3.5 * 1024 * 1024) === '3,5 Mo', tailleLisible(3.5 * 1024 * 1024))
verifie('refus : trop gros', /50 Mo/.test(refusMedias([{ name: 'v.mov', size: TAILLE_MAX_MEDIA + 1 }], 0) ?? ''))
verifie('refus : vide', /vide/.test(refusMedias([{ name: 'v.txt', size: 0 }], 0) ?? ''))
verifie('refus : trop nombreux', !!refusMedias([{ name: 'a', size: 1 }], MEDIAS_MAX_PAR_MESSAGE))
verifie('accepté', refusMedias([{ name: 'a.jpg', size: 1000 }], 2) === null)
verifie('médias absents → []', mediasDe({}).length === 0 && mediasDe({ medias: null }).length === 0)
const m = (type: string) => ({ chemin: 'x', nom: 'x', type, taille: 1 })
verifie('résumé', resumeMedias([m('image/jpeg'), m('image/png'), m('video/mp4')]) === '2 photos, 1 vidéo', resumeMedias([m('image/jpeg'), m('image/png'), m('video/mp4')]))
verifie('résumé vide', resumeMedias([]) === '')

console.log(`verifier-medias : ${ok}/${ok + ko}`)
if (ko) process.exit(1)
