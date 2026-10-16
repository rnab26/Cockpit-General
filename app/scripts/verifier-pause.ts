// Interrupteur « Branché / En pause » d'un projet (16 oct. 2026, migration 0093, chantier 975118ca) : les règles d'affichage.
// La règle elle-même (rien ne démarre pour un projet en pause) est en base : scripts/verifier-pause.mjs.
import { verifie, bilan } from './_assert.ts'
import { enPause, groupesPause, phraseEnCours, phraseEtat, projetTravaille, resumePauses, PAUSE_ARRETE, PAUSE_GARDE } from '../src/lib/pause.ts'
import type { Chantier, Tache } from '../src/lib/types.ts'

const now = new Date('2026-10-16T09:00:00Z')
console.log('verifier-pause')

console.log('1. l’état : absent avant 0093 = branché, jamais confondu avec l’icône « une session a démarré »')
verifie('colonne absente = pas en pause', !enPause({}) && !enPause(null) && !enPause(undefined))
verifie('en_pause faux = pas en pause', !enPause({ en_pause: false }))
verifie('en_pause vrai = en pause', enPause({ en_pause: true }))

console.log('2. les deux groupes du menu (l’ordre reçu est gardé)')
const ps = [{ id: 'a', en_pause: false }, { id: 'b', en_pause: true }, { id: 'c' }, { id: 'd', en_pause: true }]
const g = groupesPause(ps)
verifie('branchés : a, c', g.branches.map((p) => p.id).join() === 'a,c')
verifie('en pause : b, d', g.enPause.map((p) => p.id).join() === 'b,d')
verifie('résumé : 2 branchés · 2 en pause', resumePauses(ps) === '2 branchés · 2 en pause', resumePauses(ps))
verifie('résumé sans pause : pas de « 0 en pause »', resumePauses([{ en_pause: false }]) === '1 branché')
verifie('liste vide : 0 branché, sans planter', resumePauses([]) === '0 branché' && groupesPause([]).enPause.length === 0)

console.log('3. les phrases, en mots simples')
verifie('branché : dit que Claude peut travailler', /Branché.*peuvent travailler/.test(phraseEtat({ en_pause: false } as never, now)))
const p1 = phraseEtat({ en_pause: true, pause_at: '2026-10-16T08:00:00Z', pause_par: 'r.nabet26@gmail.com', pause_raison: null } as never, now)
verifie('en pause : depuis quand, par qui, rien supprimé', /^En pause depuis .+ par r\.nabet26@gmail\.com : Claude ne travaille pas dessus\. Rien n’est supprimé\.$/.test(p1), p1)
verifie('en pause avec raison', /\(le temps de la démo\)/.test(phraseEtat({ en_pause: true, pause_at: null, pause_par: null, pause_raison: 'le temps de la démo' } as never, now)))
verifie('en pause sans date : pas de « depuis » vide', !/depuis/.test(phraseEtat({ en_pause: true, pause_at: null } as never, now)))
verifie('la confirmation dit ce qui s’arrête ET ce qui reste', PAUSE_ARRETE.length === 3 && /Rien n’est supprimé/.test(PAUSE_GARDE) && PAUSE_ARRETE.some((l) => /réveil/.test(l)) && PAUSE_ARRETE.some((l) => /chantier/.test(l)))
verifie('aucun jargon dans les phrases', ![...PAUSE_ARRETE, PAUSE_GARDE, p1].some((t) => /(hook|script|migration|rpc|endpoint|commit|branche )/i.test(t)))

console.log('4. le travail déjà en cours : il finit, rien de nouveau ne démarre')
const ch = (extra: Partial<Chantier>): Chantier => ({ id: 'c', projet_id: 'p', titre: 't', etat: 'en_cours', archived_at: null, pris_par: 'agent/x', pris_jusqu_a: '2026-10-16T12:00:00Z', ...extra }) as Chantier
verifie('un chantier en cours tenu : du travail', projetTravaille([ch({})], [], 'p', now))
verifie('un chantier d’un autre projet ne compte pas', !projetTravaille([ch({ projet_id: 'q' })], [], 'p', now))
verifie('réservation expirée : rien en cours', !projetTravaille([ch({ pris_jusqu_a: '2026-10-16T08:00:00Z' })], [], 'p', now))
const t = { projet_id: 'p', statut: 'en_cours', vu_at: '2026-10-16T08:55:00Z' } as Tache
verifie('un agent vivant : du travail', projetTravaille([], [t], 'p', now))
verifie('phrase : il va au bout', /va au bout, rien de nouveau ne démarre/.test(phraseEnCours(true)) && /Aucun travail en cours/.test(phraseEnCours(false)))

bilan('verifier-pause')
