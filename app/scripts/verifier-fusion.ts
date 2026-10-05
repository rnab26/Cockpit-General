// « Fusionner avec… » du menu ⋯ (src/lib/fusion.ts). La règle de ressemblance de la
// suggestion automatique est en base : scripts/verifier-fusion.mjs (cas positifs et négatifs).
import { verifie, bilan } from './_assert.ts'
import { candidatsFusion, texteConfirmationFusion, lireProches, texteConfirmationCompleter, libelleCreer } from '../src/lib/fusion.ts'

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
// Création : compléter / fusionner / créer quand même (0060)
const lu = lireProches([{ id: 'x1', titre: 'Un', etat: 'libre', score: 0.9 }, { id: 2, titre: 'sans id texte' }, { id: 'x3', titre: '' }, null, 'bof', { id: 'x4', titre: 'Quatre', etat: 7, score: '0.7' }, { id: 'x5', titre: 'Cinq' }, { id: 'x6', titre: 'Six' }])
verifie('lireProches : écarte les lignes sans id ou sans titre, tolère un état/score absent, 3 au plus', lu.map((x) => x.id).join() === 'x1,x4,x5' && lu[1].etat === '' && lu[1].score === 0.7, lu)
verifie('lireProches : réponse absente ou invalide → liste vide (état vide, jamais un plantage)', lireProches(null).length === 0 && lireProches({}).length === 0 && lireProches(undefined).length === 0)
verifie('compléter : le texte dit que rien n’est créé et que le chantier est gardé', /« Gardé »/.test(texteConfirmationCompleter('Gardé')) && /Aucun nouveau chantier/.test(texteConfirmationCompleter('Gardé')))
verifie('bouton principal : « Créer » seul, « Créer quand même » dès qu’un chantier ressemble', libelleCreer(0) === 'Créer' && libelleCreer(2) === 'Créer quand même')
bilan('verifier-fusion')
