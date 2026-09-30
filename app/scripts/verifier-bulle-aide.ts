// Bulle flottante d'aide : allumée par défaut, projet choisi en vue « Tout », fil libre.
import { verifie, bilan } from './_assert.ts'
import { bulleActive, cleBulle, filDeLaBulle, projetDeLaBulle } from '../src/lib/bulleAide.ts'
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

bilan()
