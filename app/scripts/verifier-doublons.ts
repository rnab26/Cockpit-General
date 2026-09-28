// Similarité de titres : mesurée sur les vrais titres du projet pilote.
import { verifie, bilan } from './_assert.ts'
import { normaliser, motsUtiles, jaccard, titresProches, pairesDoublons, clePaire } from '../src/lib/doublons.ts'

console.log('verifier-doublons')
verifie('normaliser retire accents, casse et ponctuation', normaliser('Écran central : projets, bacs !') === 'ecran central projets bacs')
verifie('les mots de 2 lettres et moins sont ignorés', !motsUtiles('un écran de la vue').has('un') && !motsUtiles('un écran de la vue').has('de') && motsUtiles('un écran de la vue').has('vue'))
verifie('titres identiques → 1', jaccard('Hook de démarrage', 'hook de demarrage') === 1)
verifie('titres sans rapport → 0', jaccard('Hook de démarrage', 'Script embarquable') === 0)
verifie('titre vide → 0, jamais NaN', jaccard('', 'Hook') === 0 && jaccard('de la', 'Hook') === 0)
// Les 15 vrais titres du projet cockpit : aucune paire ne doit dépasser 0,5.
const reels = [
  'Schéma cockpit dans la base centrale', 'Scripts des sessions : sql.sh, demander.sh, progression.sh',
  'Hook de démarrage paramétré par projet', 'Écran central : projets, bacs, cartes de chantier',
  'Questions à options, certifier / corriger, constat', 'Progression en direct par chantier',
  'Doublons côte à côte, sélection groupée, historique', 'Script embarquable cockpit-embed.js',
  'Fonction serveur cockpit-embed', 'Déploiement GitHub Pages et dépôt rnab26/cockpit',
  'brancher.sh : installer le cockpit sur un projet en une commande', 'Skill dotfiles réécrit pour pointer sur ce dépôt',
].map((titre, i) => ({ id: String(i), titre }))
const fausses = pairesDoublons(reels)
verifie('aucune fausse alerte sur les vrais titres du pilote (seuil 0,5)', fausses.length === 0, fausses.map((p) => [p.a.titre, p.b.titre, p.score]))
const avecDoublon = [...reels, { id: 'dup', titre: 'Hook de démarrage par projet (paramétré)' }]
const p = pairesDoublons(avecDoublon)
verifie('un vrai doublon est repéré, et un seul', p.length === 1 && p[0].a.id === '2' && p[0].b.id === 'dup', p)
verifie('une paire ignorée n’est plus proposée', pairesDoublons(avecDoublon, new Set([clePaire('dup', '2')])).length === 0)
verifie('clePaire est symétrique', clePaire('b', 'a') === clePaire('a', 'b'))
verifie('à la saisie (0,6) : « Hook de démarrage par projet » alerte', titresProches('Hook de démarrage par projet', reels).some((x) => x.id === '2'))
verifie('à la saisie (0,6) : « Hook » seul n’alerte pas', titresProches('Hook', reels).length === 0)
verifie('à la saisie : un titre sans mot utile ne renvoie rien', titresProches('un de la', reels).length === 0)
verifie('le score est trié décroissant', (() => { const r = titresProches('Fonction serveur cockpit-embed script', reels, 0.1); return r.every((x, i) => i === 0 || r[i - 1].score >= x.score) })())
bilan('verifier-doublons')
