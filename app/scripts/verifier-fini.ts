// Chantier 3cea6ae9 (30 sept. 2026, Raphaël : « je ne vois pas à quelle heure
// ils ont fini […] ni dans l'ordre chronologique […] certifiés
// automatiquement ? […] que les correctifs prennent sans recharger ») :
// l'heure lisible, « Certifié par toi à HH:MM · livré … », l'ordre de la liste
// « fini », et la règle « nouvelle version en ligne ».
import { verifie, bilan } from './_assert.ts'
import { heureLisible } from '../src/lib/dates.ts'
import { ordreListe, quandFini } from '../src/lib/ouJenSuis.ts'
import { nouvelleVersion } from '../src/lib/version.ts'

const now = new Date('2026-09-30T12:39:00')  // heure LOCALE
const iso = (s: string) => new Date(s).toISOString()

verifie('heure du jour : « 12:17 »', heureLisible(iso('2026-09-30T12:17:00'), now) === '12:17', heureLisible(iso('2026-09-30T12:17:00'), now))
verifie('la veille : « hier 23:53 »', heureLisible(iso('2026-09-29T23:53:00'), now) === 'hier 23:53', heureLisible(iso('2026-09-29T23:53:00'), now))
verifie('avant : le jour et l’heure', /^28 sept\.? 09:05$/.test(heureLisible(iso('2026-09-28T09:05:00'), now)), heureLisible(iso('2026-09-28T09:05:00'), now))
verifie('minuit et une : « 00:01 »', heureLisible(iso('2026-09-30T00:01:00'), now) === '00:01')
verifie('vide ou invalide : rien', heureLisible(null, now) === '' && heureLisible('pas une date', now) === '')

const C = (id: string, extra: Record<string, unknown>) => ({ id, etat: 'valide', valide_at: null, valide_par: null, livre_at: null, updated_at: '', ...extra }) as never
const moi = 'R.Nabet26@gmail.com'
const parMoi = C('a', { valide_at: iso('2026-09-30T12:17:00'), valide_par: 'r.nabet26@gmail.com', livre_at: iso('2026-09-29T23:53:00') })
verifie('certifié par moi : « Certifié par toi à 12:17 · livré hier 23:53 »', quandFini(parMoi, moi, now) === 'Certifié par toi à 12:17 · livré hier 23:53', quandFini(parMoi, moi, now))
verifie('certifié par un autre : son nom, jamais « toi »', quandFini(C('b', { valide_at: iso('2026-09-30T11:00:00'), valide_par: 'marc@exemple.fr' }), moi, now) === 'Certifié par marc à 11:00')
verifie('certifié hier sans auteur connu : « Certifié hier 03:12 »', quandFini(C('c', { valide_at: iso('2026-09-29T03:12:00') }), moi, now) === 'Certifié hier 03:12')
verifie('pas certifié : rien', quandFini(C('d', { etat: 'a_verifier', valide_at: null }), moi, now) === null)

// Ordre : le plus récemment CERTIFIÉ en haut, même si un autre a été modifié après.
const liste = [
  C('vieux-mais-retouche', { valide_at: iso('2026-09-30T01:35:00'), updated_at: iso('2026-09-30T12:30:00') }),
  C('recent', { valide_at: iso('2026-09-30T12:17:00'), updated_at: iso('2026-09-30T12:17:00') }),
  C('milieu', { valide_at: iso('2026-09-30T11:46:00'), updated_at: iso('2026-09-30T11:46:00') }),
]
verifie('« fini » : ordre de certification, le plus récent en haut', ordreListe(liste, true).map((c: { id: string }) => c.id).join() === 'recent,milieu,vieux-mais-retouche', ordreListe(liste, true).map((c: { id: string }) => c.id))
verifie('les autres listes : dernière modification d’abord (inchangé)', ordreListe(liste, false).map((c: { id: string }) => c.id)[0] === 'vieux-mais-retouche')

verifie('nouvelle version : autre commit en ligne', nouvelleVersion('abc123', { version: 'def456' }))
verifie('même version : rien', !nouvelleVersion('abc123', { version: 'abc123' }))
verifie('en développement : jamais', !nouvelleVersion('dev', { version: 'def456' }))
verifie('lecture vide ou cassée : rien', !nouvelleVersion('abc123', null) && !nouvelleVersion('abc123', { version: '' }) && !nouvelleVersion('abc123', '<html>') && !nouvelleVersion('abc123', { version: 'dev' }))

bilan('verifier-fini')
