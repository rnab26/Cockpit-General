// « Chantiers et GitHub » (0080) : les mots que l'écran affiche pour le rapprochement des chantiers avec GitHub (lib/rapprochement.ts).
// La règle elle-même (qui est livré, sur quelle preuve) est en base : verifier-base §57 et scripts/verifier-rapprochement.mjs.
// node --experimental-strip-types app/scripts/verifier-rapprochement.ts
import { verifie, bilan } from './_assert.ts'
import { phraseRapprochement, ROLE_RAPPROCHEMENT, type EtatRapprochement } from '../src/lib/rapprochement.ts'

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
verifie('date illisible : pas de plantage, ni « NaN »', !/NaN/.test(JSON.stringify(phraseRapprochement(etat({ rapproche_at: 'n\'importe quoi' }), now))))
bilan('verifier-rapprochement')
