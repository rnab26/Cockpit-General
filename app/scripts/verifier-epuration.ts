// Les cartes déjà traitées se retirent seules, et chaque ligne dit sa date (16 oct. 2026, migration 0092, chantier fe412d83).
// Raphaël : « pourquoi est-ce que je devrais faire une action manuelle ? […] Je veux vraiment que ce soit automatisé » et
// « j'ai pas la date ni l'horaire de quand ça date ». La RÈGLE du retrait est en base (verifier-base §59) ; ici, ce que l'écran
// en montre : la liste des cartes retirées seules, sa phrase, la date de chaque ligne de « Pour toi », le réglage du délai.
import { verifie, bilan } from './_assert.ts'
import { cartesRetireesSeules, delaiEpuration, delaiSaisi, depuisParChantier, ordrePourToi, phraseDelai, phraseRetirees, raisonRetrait, DELAI_EPURATION_DEFAUT_H, JOURS_RETIREES, PREFIXE_RETRAIT } from '../src/lib/epuration.ts'
import { ageEtHeure, dateRelative, heureLisible } from '../src/lib/dates.ts'
import type { Chantier, Message } from '../src/lib/types.ts'

const now = new Date('2026-10-16T09:00:00Z')
const il = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()
const carte = (id: string, extra: Partial<Message> = {}): Message => ({
  id, projet_id: 'p', chantier_id: 'c1', auteur: 'session', auteur_type: 'session', kind: 'question', corps: `Question ${id} ?`, pourquoi: null, options: null,
  reponse: `${PREFIXE_RETRAIT}restée 46 h sans réponse pendant que le projet avançait (29 livraisons depuis).`, precision: null, repond_a: null, etat: null,
  answered_at: il(1), answered_by: null, created_at: il(47), retiree_seule_at: il(1), epuration_exclue: false, ...extra,
}) as Message
const chantier = (id: string, extra: Partial<Chantier> = {}): Chantier => ({ id, projet_id: 'p', titre: `Chantier ${id}`, etat: 'en_cours', archived_at: null, ...extra }) as Chantier

console.log('verifier-epuration')

console.log('1. la raison est dite sans le préfixe de la base')
verifie('préfixe retiré', raisonRetrait(carte('a')) === 'restée 46 h sans réponse pendant que le projet avançait (29 livraisons depuis).')
verifie('une réponse sans préfixe (déclencheur « chantier archivé » de 0026) reste telle quelle', raisonRetrait({ reponse: 'Sans objet : chantier archivé.' }) === 'Sans objet : chantier archivé.')
verifie('aucune réponse : texte vide, jamais « null »', raisonRetrait({ reponse: null }) === '')

console.log('2. la liste « Retirées seules » : seulement ce que le cockpit a retiré tout seul, depuis 7 jours')
const cs = [chantier('c1'), chantier('c2'), chantier('arch', { archived_at: il(2), etat: 'reporte' }), chantier('cert', { archived_at: il(2), etat: 'valide' })]
const L = cartesRetireesSeules([
  carte('recente', { retiree_seule_at: il(0.2) }),
  carte('ancienne', { retiree_seule_at: il(30) }),
  carte('trop-vieille', { retiree_seule_at: il(JOURS_RETIREES * 24 + 5) }),
  carte('fermee-par-lui', { retiree_seule_at: null, reponse: 'Retirée par Raphaël : cette PR n’existe pas', answered_by: 'u' }),
  carte('remise', { epuration_exclue: true }),
  carte('rouverte', { answered_at: null, retiree_seule_at: null }),
  carte('chantier-archive', { chantier_id: 'arch' }),
  carte('chantier-certifie', { chantier_id: 'cert' }),
  carte('chantier-inconnu', { chantier_id: 'fantome' }),
  carte('sur-le-projet', { chantier_id: null }),
], cs, now)
const ids = L.map((c) => c.message.id)
verifie('la plus récente d’abord', ids[0] === 'recente' && ids.indexOf('recente') < ids.indexOf('ancienne'), ids)
verifie('retirées seules visibles : récente, ancienne, certifié, sur le projet', ['recente', 'ancienne', 'chantier-certifie', 'sur-le-projet'].every((i) => ids.includes(i)), ids)
verifie('jamais : plus de 7 jours, fermée par lui, remise, rouverte, chantier archivé ou plus visible', ['trop-vieille', 'fermee-par-lui', 'remise', 'rouverte', 'chantier-archive', 'chantier-inconnu'].every((i) => !ids.includes(i)), ids)
verifie('une carte du projet (sans chantier) n’a pas de chantier', L.find((c) => c.message.id === 'sur-le-projet')?.chantier === null)
verifie('la raison accompagne la carte', L[0].raison.startsWith('restée 46 h'))
verifie('même entrée = même ordre (déterministe)', JSON.stringify(cartesRetireesSeules([carte('x'), carte('y')], cs, now).map((c) => c.message.id)) === JSON.stringify(cartesRetireesSeules([carte('y'), carte('x')], cs, now).map((c) => c.message.id)))

console.log('3. la ligne « N cartes retirées seules »')
verifie('aucune : pas de ligne', phraseRetirees(0) === '')
verifie('une : singulier', phraseRetirees(1) === '1 carte retirée seule')
verifie('treize : pluriel', phraseRetirees(13) === '13 cartes retirées seules')

console.log('4. « Pour toi » : depuis quand ça t’attend (le plus récent par chantier), le plus récent en haut')
const els = [
  { chantier: chantier('c1'), depuis: il(46) }, { chantier: chantier('c1'), depuis: il(30) },      // deux choses sur c1 : la plus récente compte
  { chantier: chantier('c2'), depuis: il(5) }, { chantier: null, depuis: il(1) },                  // une question du projet n'a pas de chantier
]
const d = depuisParChantier(els)
verifie('un chantier à deux éléments : le plus récent', d.get('c1') === il(30) && d.get('c2') === il(5))
verifie('un élément sans chantier n’entre pas dans la liste des chantiers', d.size === 2)
const ordre = ordrePourToi([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], d)
verifie('c2 (il y a 5 h) avant c1 (il y a 30 h) ; un chantier sans date (c3) en dernier', ordre.map((x) => x.id).join() === 'c2,c1,c3', ordre)
verifie('sans aucune date : l’ordre d’origine est gardé', ordrePourToi([{ id: 'b' }, { id: 'a' }], new Map()).map((x) => x.id).join() === 'b,a')
const ligne = (iso: string) => `${dateRelative(iso, now)} · ${heureLisible(iso, now)}`
verifie('la date d’une ligne dit l’âge ET l’heure, comme « À toi de jouer »', /^il y a 2 j · /.test(ligne(il(46))) && /^il y a 5 h · \d{2}:\d{2}$/.test(ligne(il(5))), [ligne(il(46)), ligne(il(5))])

console.log('4 bis. l’âge ET l’heure, sans jamais se répéter')
verifie('aujourd’hui : « il y a 5 h · 04:00 »', /^il y a 5 h · \d{2}:\d{2}$/.test(ageEtHeure(il(5), now)), ageEtHeure(il(5), now))
verifie('hier : « hier 07:00 », jamais « hier · hier 07:00 »', /^hier \d{2}:\d{2}$/.test(ageEtHeure(il(26), now)), ageEtHeure(il(26), now))
verifie('il y a 2 jours : l’âge puis la date et l’heure (« il y a 2 j · 14 oct. 10:00 »)', /^il y a 2 j · \d{1,2} oct\. \d{2}:\d{2}$/.test(ageEtHeure(il(50), now)), ageEtHeure(il(50), now))
verifie('au-delà d’un mois : la date et l’heure, une seule fois', /^\d{1,2} \S+ \d{2}:\d{2}$/.test(ageEtHeure(il(24 * 40), now)) && !/·/.test(ageEtHeure(il(24 * 40), now)), ageEtHeure(il(24 * 40), now))
verifie('à l’instant : « à l’instant »', ageEtHeure(il(0), now) === 'à l’instant')
verifie('date manquante : vide', ageEtHeure(null, now) === '' && ageEtHeure(undefined, now) === '' && ageEtHeure('pas une date', now) === '')

console.log('5. le réglage : heures, 0 = jamais, comme la base (0 à 720)')
verifie('le défaut est celui de la base (24 h)', DELAI_EPURATION_DEFAUT_H === 24 && delaiEpuration({}) === 24 && delaiEpuration(null) === 24 && delaiEpuration(undefined) === 24)
verifie('la valeur du projet est lue', delaiEpuration({ epuration_delai_h: 72 }) === 72 && delaiEpuration({ epuration_delai_h: 0 }) === 0)
verifie('une valeur hors bornes retombe sur le défaut (jamais un NaN à l’écran)', delaiEpuration({ epuration_delai_h: 9999 }) === 24 && delaiEpuration({ epuration_delai_h: -3 }) === 24 && delaiEpuration({ epuration_delai_h: 1.5 }) === 24)
verifie('saisie : entier de 0 à 720', delaiSaisi('24') === 24 && delaiSaisi(' 0 ') === 0 && delaiSaisi('720') === 720)
verifie('saisie refusée : vide, texte, négatif, décimal, trop grand', ['', 'abc', '-1', '2,5', '2.5', '721', '1000'].every((t) => delaiSaisi(t) === null))
verifie('la phrase du réglage', phraseDelai(0) === 'jamais' && phraseDelai(24) === 'après 24 h' && phraseDelai(72) === 'après 3 jours' && phraseDelai(36) === 'après 36 h')

bilan('verifier-epuration')
