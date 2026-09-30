// « Fusionner avec… » du menu ⋯ (src/lib/fusion.ts). La règle de ressemblance de la
// suggestion automatique est en base : scripts/verifier-fusion.mjs (cas positifs et négatifs).
import { verifie, bilan } from './_assert.ts'
import { candidatsFusion, texteConfirmationFusion } from '../src/lib/fusion.ts'

console.log('verifier-fusion')
const c = (id: string, titre: string, extra: object = {}) => ({ id, titre, projet_id: 'p1', etat: 'libre', ...extra })
const liste = [
  c('a', 'Ouverture de session'), c('b', 'Bouton décalé'), c('c', 'Écran d’accueil'),
  c('d', 'Ancien chantier', { archived_at: '2026-09-01' }), c('e', 'Certifié', { etat: 'valide' }),
  c('f', 'Déjà doublon', { doublon_de: 'a' }), c('g', 'Autre projet', { projet_id: 'p2' }),
]
const source = { id: 'a', projet_id: 'p1' }
const tous = candidatsFusion(liste, source)
verifie('candidats : même projet, ouverts, sans lui-même, triés par titre', tous.map((x) => x.id).join() === 'b,c', tous.map((x) => x.id))
verifie('recherche sans accent ni casse (« ECRAN »)', candidatsFusion(liste, source, 'ECRAN').map((x) => x.id).join() === 'c')
verifie('recherche sur plusieurs mots', candidatsFusion(liste, source, 'bouton dec').map((x) => x.id).join() === 'b')
verifie('recherche sans résultat : liste vide', candidatsFusion(liste, source, 'zzz').length === 0)
verifie('aucun autre chantier : liste vide', candidatsFusion([c('a', 'Seul')], source).length === 0)
const t = texteConfirmationFusion('Doublon', 'Gardé', 3)
verifie('confirmation : source archivée, cible gardée, messages', /« Doublon » est archivé/.test(t) && /« Gardé »/.test(t) && /3 messages/.test(t) && /Rien n’est supprimé/.test(t))
verifie('confirmation : un message, ou aucun', /1 message /.test(texteConfirmationFusion('a', 'b', 1)) && !/messages/.test(texteConfirmationFusion('a', 'b', 0)))
bilan('verifier-fusion')
