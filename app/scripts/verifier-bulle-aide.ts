// Bulle flottante d'aide : allumée par défaut, projet choisi en vue « Tout », fil libre.
import { verifie, bilan } from './_assert.ts'
import { aCiter, auteurDe, avecCitation, bulleActive, citationDe, citer, cleBulle, cartesAFaire, constructeurVoix, filDeLaBulle, notifsChat, messageVoix, projetDeLaBulle, sujetDe } from '../src/lib/bulleAide.ts'
import { estMessageLibre } from '../src/lib/discussion.ts'

console.log('verifier-bulle-aide')
const P = (id: string, slug: string) => ({ id, slug, nom: slug }) as any
const projets = [P('a', 'facepro'), P('b', 'cockpit'), P('t', 'test-x-1')]

// 1. Allumée par défaut ; seule une préférence explicitement false l'éteint.
verifie('clé par projet', cleBulle('a') === 'bulle_flottante_aide_a')
verifie('sans préférence : allumée', bulleActive({}, 'a'))
verifie('préférence true : allumée', bulleActive({ bulle_flottante_aide_a: true }, 'a'))
verifie('préférence false : éteinte', !bulleActive({ bulle_flottante_aide_a: false }, 'a'))
verifie('éteinte pour un projet seulement', bulleActive({ bulle_flottante_aide_a: false }, 'b'))

// 2. Quel projet ?
verifie('vue projet : ce projet', projetDeLaBulle('a', projets, [])?.id === 'a')
verifie('vue Tout : le projet cockpit', projetDeLaBulle(null, projets, [])?.id === 'b')
const sansCockpit = [P('a', 'facepro'), P('c', 'jarvis'), P('t', 'test-x-1')]
const ms = [
  { projet_id: 'a', chantier_id: null, created_at: '2026-09-30T10:00:00Z' },
  { projet_id: 'c', chantier_id: null, created_at: '2026-09-30T11:00:00Z' },
  { projet_id: 't', chantier_id: null, created_at: '2026-09-30T12:00:00Z' },
  { projet_id: 'a', chantier_id: 'x', created_at: '2026-09-30T13:00:00Z' },
]
verifie('vue Tout sans cockpit : dernier fil libre utilisé, jamais un test', projetDeLaBulle(null, sansCockpit, ms)?.id === 'c')
verifie('vue Tout sans message : premier projet', projetDeLaBulle(null, sansCockpit, [])?.id === 'a')
verifie('aucun projet : rien', projetDeLaBulle(null, [], []) === null)

// 3. Le fil : messages du projet, sans chantier, sans mécanique, dans l'ordre.
const m = (id: string, o: any) => ({ id, projet_id: 'b', chantier_id: null, kind: 'info', auteur_type: 'proprietaire', corps: 'x', created_at: `2026-09-30T10:0${id}:00Z`, ...o })
const fil = filDeLaBulle([m('3', { auteur_type: 'session' }), m('1', {}), m('2', { chantier_id: 'z' }), m('4', { projet_id: 'a' }), m('5', { ou_en_est: true }), m('6', { kind: 'question' })], 'b')
verifie('fil : 2 messages, ordre chronologique', fil.length === 2 && fil[0].id === '1' && fil[1].id === '3')

// 4. Un message tapé dans la bulle est un message libre (la chef / la session y répond).
verifie('message de la bulle = message libre', estMessageLibre({ ...m('1', {}), answered_at: null } as any, []))

// 5. Nom, sujet, citation, voix.
verifie('auteur : Claude / Toi / Raphaël / invité', auteurDe({ auteur_type: 'session', auteur: 'x' }, true) === 'Claude' && auteurDe({ auteur_type: 'proprietaire', auteur: 'x' }, true) === 'Toi' && auteurDe({ auteur_type: 'proprietaire', auteur: 'x' }, false) === 'Raphaël' && auteurDe({ auteur_type: 'utilisateur', auteur: 'Lea', auteur_user: 'u' }, false) === 'Lea · invité')
verifie('sujet extrait', sujetDe('Sujet : Les coûts. Voilà la suite')?.sujet === 'Les coûts' && sujetDe('Bonjour').sujet === null)
verifie('citation : aller-retour', citationDe(avecCitation('Veux-tu A ou B ?', 'A')).citation === 'Veux-tu A ou B ?' && citationDe(avecCitation('Veux-tu A ou B ?', 'A')).reste === 'A')
verifie('sans citation : corps inchangé', avecCitation(null, ' ok ') === 'ok' && citationDe('salut').citation === null)
verifie('citation longue coupée', citer('mot '.repeat(100)).length <= 160)
verifie('on cite la sélection, sinon le message sans sa ligne Sujet', aCiter('  B  ', 'tout') === 'B' && aCiter('', 'Sujet : Choix. Veux-tu A ou B ?') === 'Veux-tu A ou B ?')
verifie('un message cité reste un message libre', estMessageLibre({ ...m('9', {}), corps: '> Veux-tu A ?\nA', answered_at: null } as any, []))
verifie('voix : non supportée / supportée', constructeurVoix({}) === null && constructeurVoix({ webkitSpeechRecognition: class {} }) !== null)
verifie('voix : micro refusé dit où l’autoriser', messageVoix('not-allowed').includes('Micro') && messageVoix('aborted') === '' && messageVoix('zzz').includes('zzz'))

// Pastilles par chat : réponses libres non lues + cartes à faire ; le total de l'onglet = somme des chats.
const el = (type: string, id: string, chantierId: string | null, message = true) => ({ type, cle: id, projetId: 'a', chantier: chantierId ? { id: chantierId } : null, message: message ? {} : null }) as any
const cartes = cartesAFaire([el('question', 'q1', 'c1'), el('a_verifier', 'v1', 'c1'), el('question', 'q2', 'c2'), el('bloque', 'b', 'c3'), el('fusion', 'f', null), el('fusion', 'f2', null, false)])
verifie('cartes : une question d’un chantier à vérifier n’est pas comptée deux fois, un « bloque » n’est pas une carte', cartes.map((c: any) => c.cle).join() === 'v1,q2,f', cartes.map((c: any) => c.cle))
const nl = new Map([['projet:a', { n: 2, dernier: 'x' }], ['c9', { n: 5, dernier: 'x' }]])
verifie('notifs : réponses du fil libre + cartes, jamais les réponses d’un fil de chantier', JSON.stringify(notifsChat(nl, 'a', cartes)) === JSON.stringify({ reponses: 2, aFaire: 3, total: 5 }))
verifie('notifs : rien = zéro', notifsChat(new Map(), 'b', []).total === 0)

bilan()
