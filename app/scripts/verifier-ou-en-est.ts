// « Où ça en est ? » qui se suit (src/lib/ouEnEst.ts, migration 0023) : les
// états d'une demande, la file d'attente, pas de doublon, et sa place dans
// l'entonnoir (« Ça avance tout seul », plus dans « Prêt à lancer »).
// Rejoue la demande de Raphaël du 29 sept. 2026 : « on ne voit pas de
// différence […] qu'on ne pollue pas les sessions en cliquant 10 fois ».
import { verifie, bilan } from './_assert.ts'
import { etatOuEnEst, etapesOuEnEst, ouEnEstVisible, chantierTenu, DELAI_OU_EN_EST_MS, PREFIXE_ASSISTANT_POINT } from '../src/lib/ouEnEst.ts'
import { MESSAGE_OU_CA_EN_EST, derniereDemandeOuCaEnEst } from '../src/lib/presence.ts'
import { caAvanceToutSeul, aLancer, enCoursSansNouvelles } from '../src/lib/entonnoir.ts'
import { REMANENCE_FIN_MS } from '../src/lib/activite.ts'

const now = new Date('2026-09-29T18:00:00Z')
const SILENCE = 15 * 60_000
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const C = (id: string, etat = 'libre', extra: Record<string, unknown> = {}) => ({
  id, projet_id: 'p', section_id: null, titre: id, etat, priorite: 'normale', archived_at: null,
  pris_par: null, pris_jusqu_a: null, updated_at: il(300), created_at: il(600), ...extra,
}) as never
const M = (id: string, chantier: string, minAgo: number, extra: Record<string, unknown> = {}) => ({
  id, projet_id: 'p', chantier_id: chantier, auteur: 'r', auteur_type: 'proprietaire', kind: 'info', corps: MESSAGE_OU_CA_EN_EST,
  pourquoi: null, options: null, reponse: null, precision: null, repond_a: null, etat: null, answered_at: null, answered_by: null,
  created_at: il(minAgo), ou_en_est: true, recu_at: null, recu_par: null, ...extra,
}) as never
const S = (id: string, chantier: string, minAgo: number, extra: Record<string, unknown> = {}) =>
  M(id, chantier, minAgo, { auteur: 'agent/x', auteur_type: 'session', corps: `réponse ${id}`, ou_en_est: false, ...extra })
const A = (chantier: string, minAgo: number) => ({
  id: `a-${chantier}`, projet_id: 'p', chantier_id: chantier, session: 'claude/s', etape: 'tests', pourcentage: 60, eta_secondes: null,
  statut: 'en_cours', detail: null, demarre_at: il(minAgo + 30), updated_at: il(minAgo),
}) as never
const ch = { id: 'c1', projet_id: 'p' }

console.log('États d’une demande')
verifie('jamais demandé : rien à suivre', etatOuEnEst(ch, [], false, now) === null)
let e = etatOuEnEst(ch, [M('d', 'c1', 1)], true, now)!
verifie('quelqu’un y travaille : « Envoyée », en attente, étape 1', e.code === 'envoyee' && e.enAttente && e.etape === 1, e)
e = etatOuEnEst(ch, [M('d', 'c1', 1)], false, now)!
verifie('personne dessus : « En file d’attente », position 1', e.code === 'file' && e.position === 1 && e.enAttente && /file d’attente/.test(e.libelle), e)
e = etatOuEnEst(ch, [M('d', 'c1', 3, { recu_at: il(2), recu_par: 'claude/s' })], true, now)!
verifie('le hook l’a remise à la session : « Reçue par Claude »', e.code === 'recue' && e.enAttente && /^Reçue par Claude/.test(e.libelle), e)
e = etatOuEnEst(ch, [M('d', 'c1', 30, { recu_at: il(20), recu_par: `${PREFIXE_ASSISTANT_POINT}123` })], false, now)!
verifie('la chef a lancé un assistant : « Un assistant de Claude regarde »', e.code === 'prise' && e.enAttente && /assistant/.test(e.libelle), e)
e = etatOuEnEst(ch, [M('d', 'c1', 30, { recu_at: il(20) }), S('r', 'c1', 2, { repond_a: 'd' })], false, now)!
verifie('une session répond : « Réponse arrivée », plus en attente, étape 3', e.code === 'repondue' && !e.enAttente && e.etape === 3 && e.reponse?.id === 'r', e)
e = etatOuEnEst(ch, [M('d', 'c1', 30), S('autre', 'c1', 5)], false, now)!
verifie('n’importe quel message de session après la demande vaut réponse (même règle que la base)', e.code === 'repondue', e)
e = etatOuEnEst(ch, [S('avant', 'c1', 40), M('d', 'c1', 30)], false, now)!
verifie('un message de session AVANT la demande ne répond pas', e.code === 'file', e)
e = etatOuEnEst(ch, [M('d', 'c1', DELAI_OU_EN_EST_MS / 60_000 + 1)], false, now)!
verifie('sans réponse après 2 h : périmée, on peut redemander', e.code === 'sans_reponse' && !e.enAttente && /redemander/.test(e.libelle), e)
verifie('délai = 2 h (même valeur que cockpit.delai_ou_en_est, 0023)', DELAI_OU_EN_EST_MS === 2 * 3600_000)
e = etatOuEnEst(ch, [M('vieille', 'c1', 200), S('r', 'c1', 190), M('d', 'c1', 1)], false, now)!
verifie('une nouvelle demande après une réponse : c’est elle qu’on suit', e.code === 'file' && e.demande.id === 'd', e)
e = etatOuEnEst(ch, [M('d', 'c1', 1, { ou_en_est: undefined, auteur_type: 'proprietaire' })], false, now)!
verifie('demande d’avant 0023 (reconnue à son texte) suivie aussi', e?.code === 'file')
verifie('le texte seul écrit par une SESSION n’est pas une demande', etatOuEnEst(ch, [M('d', 'c1', 1, { ou_en_est: false, auteur_type: 'session' })], false, now) === null)
verifie('derniereDemandeOuCaEnEst suit la même règle', derniereDemandeOuCaEnEst([M('d1', 'c1', 9), M('d2', 'c1', 3)] as never[])?.id === 'd2' as never)

console.log('\nFile d’attente du projet')
const file = [M('a', 'c0', 20), M('b', 'c2', 10), M('d', 'c1', 5), M('z', 'c3', 1)]
verifie('position = demandes plus anciennes encore en file + 1', etatOuEnEst(ch, file, false, now)?.position === 3)
verifie('le libellé dit le rang (« 3ᵉ »)', /3ᵉ/.test(etatOuEnEst(ch, file, false, now)!.libelle))
verifie('une demande reçue, répondue ou périmée ne compte pas dans la file', etatOuEnEst(ch, [
  M('a', 'c0', 20, { recu_at: il(19) }), M('b', 'c2', 10), S('rb', 'c2', 8), M('v', 'c4', 200), M('d', 'c1', 5)], false, now)?.position === 1)
verifie('un chantier tenu (le hook lui remet) ne compte pas dans la file', etatOuEnEst(ch, [M('a', 'c0', 20), M('d', 'c1', 5)], false, now, (id) => id === 'c0')?.position === 1)
verifie('une autre demande d’un AUTRE projet ne compte pas', etatOuEnEst(ch, [M('a', 'c0', 20, { projet_id: 'q' }), M('d', 'c1', 5)], false, now)?.position === 1)

console.log('\nFrise et visibilité')
verifie('frise : Envoyée → Reçue → Réponse', etapesOuEnEst({ code: 'recue', position: null }).join('>') === 'Envoyée>Reçue>Réponse')
verifie('frise en file : 2ᵉ étape « En file »', etapesOuEnEst({ code: 'file', position: 2 })[1] === 'En file')
verifie('frise assistant : 2ᵉ étape « Assistant »', etapesOuEnEst({ code: 'prise', position: null })[1] === 'Assistant')
const rep = etatOuEnEst(ch, [M('d', 'c1', 30), S('r', 'c1', 2)], false, now)
verifie('réponse arrivée : visible un quart d’heure', ouEnEstVisible(rep, now))
verifie('puis plus visible (REMANENCE_FIN_MS)', !ouEnEstVisible(rep, new Date(now.getTime() + REMANENCE_FIN_MS)))
verifie('périmée : plus visible', !ouEnEstVisible(etatOuEnEst(ch, [M('d', 'c1', 130)], false, now), now))
verifie('chantierTenu : une étape récente en cours', chantierTenu('c1', [A('c1', 2)], [], now, SILENCE) && !chantierTenu('c1', [A('c1', 60)], [], now, SILENCE))

console.log('\nDans l’entonnoir : « ça repart dans les trucs à traiter »')
const chantiers = [C('libre'), C('muet', 'en_cours'), C('vivant', 'en_cours'), C('rien')]
const messages = [M('d1', 'libre', 3), M('d2', 'muet', 2), M('d3', 'vivant', 1)]
const act = [A('vivant', 1)]
const ca = caAvanceToutSeul(chantiers, act, messages, [], [], now, SILENCE)
const ligne = (id: string) => ca.find((l) => l.c.id === id)
verifie('un « libre » demandé passe dans « Ça avance tout seul », en file', ligne('libre')?.ouEnEst?.code === 'file' && ligne('libre')?.vivant === false, ligne('libre'))
verifie('… et quitte « Prêt à lancer » (pas de doublon)', !aLancer(chantiers, act, messages, now, SILENCE, ['p']).flatMap((g) => g.lignes).some((l) => l.c.id === 'libre'))
verifie('un « en cours sans nouvelles » demandé : suivi, plus « sans nouvelles »', ligne('muet')?.ouEnEst?.enAttente === true
  && !enCoursSansNouvelles(chantiers, act, messages, now, SILENCE, ['p']).flatMap((g) => g.lignes).some((l) => l.c.id === 'muet'))
verifie('le libellé de la ligne = l’état de la demande', ligne('libre')?.pourquoi === ligne('libre')?.ouEnEst?.libelle)
verifie('un chantier vivant garde sa ligne vivante, avec « Envoyée »', ligne('vivant')?.vivant === true && ligne('vivant')?.ouEnEst?.code === 'envoyee', ligne('vivant'))
verifie('position dans la file : le plus ancien d’abord (muet 2 min, libre 3 min)', ligne('libre')?.ouEnEst?.position === 1 && ligne('muet')?.ouEnEst?.position === 2)
verifie('jamais demandé, personne dessus : reste « à lancer »', !ligne('rien') && aLancer(chantiers, act, messages, now, SILENCE, ['p']).flatMap((g) => g.lignes).some((l) => l.c.id === 'rien'))
const apres = [...messages, S('r1', 'libre', 1)]
const ca2 = caAvanceToutSeul(chantiers, act, apres, [], [], now, SILENCE)
verifie('réponse arrivée : la ligne dit « Réponse arrivée »', ca2.find((l) => l.c.id === 'libre')?.ouEnEst?.code === 'repondue')
const tard = new Date(now.getTime() + REMANENCE_FIN_MS + 60_000)
verifie('un quart d’heure après la réponse : retour dans « Prêt à lancer »', aLancer(chantiers, [], apres, tard, SILENCE, ['p']).flatMap((g) => g.lignes).some((l) => l.c.id === 'libre'))

bilan('verifier-ou-en-est')
