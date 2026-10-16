// « Chantiers et GitHub » (0080) : les mots que l'écran affiche pour le rapprochement des chantiers avec GitHub (lib/rapprochement.ts).
// La règle elle-même (qui est livré, sur quelle preuve) est en base : verifier-base §57 et scripts/verifier-rapprochement.mjs.
// node --experimental-strip-types app/scripts/verifier-rapprochement.ts
import { verifie, bilan } from './_assert.ts'
import { avecCourant, CHOIX_PASSAGE_MIN, CHOIX_TRACE_H, libelleHeures, libelleMinutes, phraseRapprochement, ROLE_RAPPROCHEMENT, derniersPassages, libelleRegle, phraseConfirmationAnnulation, statutPassage, type EtatRapprochement, type PassageAuto } from '../src/lib/rapprochement.ts'

const now = new Date('2026-10-13T12:00:00Z').getTime()
const il = (heures: number) => new Date(now - heures * 3600_000).toISOString()
const etat = (e: Partial<EtatRapprochement>): EtatRapprochement => ({ rapproche_at: il(1), auto: true, livres_24h: 0, livres_total: 0, ...e })

console.log('rapprochement GitHub : les mots de l\'écran')
verifie('le rôle dit ce que ça fait ET ce que ça ne fait jamais', /livré, à vérifier/.test(ROLE_RAPPROCHEMENT) && /Jamais « validé »/.test(ROLE_RAPPROCHEMENT))

const eteint = phraseRapprochement(etat({ auto: false }), now)
verifie('éteint : dit « éteint » et que rien ne se met à jour d\'après GitHub', eteint.ton === 'eteint' && /Éteint/.test(eteint.titre) && /GitHub/.test(eteint.detail))
verifie('éteint : même sans jamais être passé', phraseRapprochement(etat({ auto: false, rapproche_at: null }), now).ton === 'eteint')

const jamais = phraseRapprochement(etat({ rapproche_at: null }), now)
verifie('jamais passé : dit quand aura lieu le premier passage', jamais.ton === 'attente' && /Pas encore passé/.test(jamais.titre) && /ouverture d’une session/.test(jamais.detail))

const frais = phraseRapprochement(etat({ rapproche_at: il(0.2) }), now)
verifie('passé il y a peu : « À jour » + quand', frais.ton === 'ok' && /^À jour : dernier passage/.test(frais.titre) && /il y a 12 min/.test(frais.titre), frais.titre)

const vieux = phraseRapprochement(etat({ rapproche_at: il(30) }), now)
verifie('pas passé depuis plus de 6 h : « Dernier passage … », pas « À jour »', vieux.ton === 'attente' && /^Dernier passage/.test(vieux.titre) && !/À jour/.test(vieux.titre), vieux.titre)
verifie('… et dit comment il se refait', /ouverture d’une session/.test(vieux.detail))
verifie('exactement 6 h : encore « À jour » (la limite est au-delà)', phraseRapprochement(etat({ rapproche_at: il(6) }), now).ton === 'ok')
verifie('juste après 6 h : « Dernier passage »', phraseRapprochement(etat({ rapproche_at: il(6.1) }), now).ton === 'attente')

verifie('rien à rattraper : une phrase, pas un zéro', /Rien à rattraper pour l’instant/.test(frais.detail))
verifie('rien depuis 24 h mais un historique : le total est donné', /Rien à rattraper ces dernières 24 h \(5 au total depuis le début\)/.test(phraseRapprochement(etat({ livres_total: 5 }), now).detail))
verifie('un chantier passé tout seul : singulier', /^1 chantier passé « livré » tout seul ces dernières 24 h\.$/.test(phraseRapprochement(etat({ livres_24h: 1, livres_total: 1 }), now).detail))
verifie('plusieurs : pluriel', /^4 chantiers passés « livré » tout seul ces dernières 24 h\.$/.test(phraseRapprochement(etat({ livres_24h: 4, livres_total: 9 }), now).detail))
verifie('le compte est dit aussi quand le passage est ancien', /3 chantiers passés/.test(phraseRapprochement(etat({ rapproche_at: il(30), livres_24h: 3 }), now).detail))

const rate = phraseRapprochement(etat({ rapproche_at: null, erreur: 'clone impossible : dépôt injoignable', erreur_at: il(2) }), now)
verifie('un passage qui a ÉCHOUÉ se dit (jamais « pas encore passé ») : cause, quand, et qu\'il réessaie', rate.ton === 'erreur' && /a échoué/.test(rate.titre) && /clone impossible/.test(rate.detail) && /il y a 2 h/.test(rate.detail) && /réessaie/.test(rate.detail), rate)
verifie('… même après un bon passage plus ancien', phraseRapprochement(etat({ rapproche_at: il(30), erreur: 'x', erreur_at: il(1) }), now).ton === 'erreur')
verifie('… mais un bon passage PLUS RÉCENT l\'emporte (l\'erreur est périmée)', phraseRapprochement(etat({ rapproche_at: il(1), erreur: 'x', erreur_at: il(5) }), now).ton === 'ok')
verifie('éteint : l\'échec n\'est pas montré (le passage n\'a plus lieu)', phraseRapprochement(etat({ auto: false, erreur: 'x', erreur_at: il(1) }), now).ton === 'eteint')
verifie('une cause très longue est coupée', phraseRapprochement(etat({ rapproche_at: null, erreur: 'y'.repeat(300), erreur_at: il(1) }), now).detail.length < 330)
// Réglages généraux (0081) : l'interrupteur général et les deux délais.
const general = phraseRapprochement(etat({ global: false }), now)
verifie('interrupteur GÉNÉRAL éteint : « Éteint pour tous les projets », même si le projet est allumé', general.ton === 'eteint' && /tous les projets/.test(general.titre) && /Demande à Claude/.test(general.detail), general)
verifie('… et il l\'emporte sur un échec ou un bon passage', phraseRapprochement(etat({ global: false, erreur: 'x', erreur_at: il(1), rapproche_at: null }), now).ton === 'eteint')
verifie('allumé (ou inconnu) : rien ne change', phraseRapprochement(etat({ global: true }), now).ton === 'ok' && phraseRapprochement(etat({}), now).ton === 'ok')
verifie('libellés des heures : 1 heure, 4 heures, 1 jour, 2 jours', [1, 4, 24, 48].map(libelleHeures).join(' | ') === '1 heure | 4 heures | 1 jour | 2 jours', [1, 4, 24, 48].map(libelleHeures))
verifie('libellés des minutes : 20 minutes, 1 heure, 3 heures, 90 minutes', [20, 60, 180, 90].map(libelleMinutes).join(' | ') === '20 minutes | 1 heure | 3 heures | 90 minutes', [20, 60, 180, 90].map(libelleMinutes))
verifie('les choix par défaut contiennent les valeurs par défaut du serveur (4 h, 20 min)', CHOIX_TRACE_H.includes(4) && CHOIX_PASSAGE_MIN.includes(20))
verifie('une valeur posée ailleurs (6 h) reste choisissable : le sélecteur ne ment jamais', avecCourant(CHOIX_TRACE_H, 6).join(',') === '1,2,4,6,8,24', avecCourant(CHOIX_TRACE_H, 6))
verifie('… sans doublon, et sans valeur quand elle est inconnue', avecCourant(CHOIX_TRACE_H, 4).join(',') === '1,2,4,8,24' && avecCourant(CHOIX_TRACE_H, undefined).join(',') === '1,2,4,8,24')
verifie('date illisible : pas de plantage, ni « NaN »', !/NaN/.test(JSON.stringify(phraseRapprochement(etat({ rapproche_at: 'n\'importe quoi' }), now))))
console.log('rapprochement GitHub : derniers passages et « Annuler »')
const passage = (p: Partial<PassageAuto>): PassageAuto => ({ id: 'p1', chantier_id: 'c1', regle: 'jalon', preuve: 'x', url: null, at: il(2), annule_at: null, etat_avant: 'en_cours', chantier: { titre: 'Accueil', etat: 'a_verifier', archived_at: null }, ...p })
verifie('un chantier encore « à vérifier » s’annule', statutPassage(passage({})) === 'annulable')
verifie('un passage déjà annulé ne propose plus rien', statutPassage(passage({ annule_at: il(1) })) === 'annule')
verifie('certifié, corrigé, archivé ou supprimé : rien à défaire', ['valide', 'en_cours'].every((e) => statutPassage(passage({ chantier: { titre: 'a', etat: e, archived_at: null } })) === 'traite') && statutPassage(passage({ chantier: { titre: 'a', etat: 'a_verifier', archived_at: il(1) } })) === 'traite' && statutPassage(passage({ chantier: null })) === 'traite')
verifie('la confirmation dit le chantier et l’état retrouvé', /« Accueil » redeviendra « en cours »/.test(phraseConfirmationAnnulation(passage({}))) && /prêt à lancer/.test(phraseConfirmationAnnulation(passage({ etat_avant: 'libre' }))))
verifie('règles lisibles, une règle inconnue reste affichée', libelleRegle('branche') === 'branche du chantier fusionnée' && libelleRegle('autre') === 'autre')
verifie('les plus récents d’abord, bornés', derniersPassages([passage({ id: 'a', at: il(5) }), passage({ id: 'b', at: il(1) }), passage({ id: 'c', at: il(3) })], 2).map((p) => p.id).join() === 'b,c')
bilan('verifier-rapprochement')
