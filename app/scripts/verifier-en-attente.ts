// « En attente » et « Plus de nouvelles » : une phrase claire par chantier, sans jargon (src/lib/enAttente.ts).
import { verifie, bilan } from './_assert.ts'
import { phraseAttente, phraseComplete, nomQui, projetAutonome } from '../src/lib/enAttente.ts'
import { situationSilence } from '../src/lib/silence.ts'

const now = new Date('2026-09-30T10:00:00Z')
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const dans = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
const JARGON = /renfort\/|[0-9a-f]{6}|réservé|abandonné|0 %/
const libre = { etat: 'libre' as const, pris_par: null, pris_jusqu_a: null, updated_at: il(500) }
const pris = { etat: 'en_cours' as const, pris_par: 'renfort/e8d57a/fdcf17', pris_jusqu_a: dans(60), updated_at: il(200) }
const ctx = (o: object = {}) => ({ now, abandonMin: 3, prochainPassage: dans(20) as string | null, autonome: false, ...o })

console.log('verifier-en-attente')
verifie('nom : un renfort se dit « assistant de renfort », jamais son identifiant', nomQui('renfort/e8d57a/fdcf17') === 'Un assistant de renfort' && nomQui(null) === 'Une session Claude')
{
  const p = phraseAttente(libre, null, ctx())
  verifie('libre, mode autonome éteint : un geste (Lancer), dit', p.aFaire && /Lancer/.test(p.suite), p)
}
{
  const p = phraseAttente(libre, null, ctx({ autonome: true }))
  verifie('libre, mode autonome allumé : repris tout seul à une heure, rien à faire', !p.aFaire && /vers \d\d:\d\d/.test(p.suite) && /Rien à faire/.test(phraseComplete(p)), p)
}
{
  const p = phraseAttente(libre, null, ctx({ autonome: true, prochainPassage: null }))
  verifie('autonome sans passage connu : dit qu’il sera repris, sans heure inventée', !p.aFaire && !/vers/.test(p.suite), p)
}
{
  const p = phraseAttente(pris, { updated_at: il(45) }, ctx())
  verifie('pris, muet depuis 45 min, chef programmée : arrêté, repris tout seul, rien à faire', !p.aFaire && /s’est arrêté/.test(p.quoi) && /repris tout seul vers/.test(p.suite) && !JARGON.test(phraseComplete(p)), p)
}
{
  const p = phraseAttente(pris, { updated_at: il(45) }, ctx({ prochainPassage: null }))
  verifie('pris, muet, aucune reprise programmée : un geste à faire', p.aFaire && /Lancer/.test(p.suite), p)
}
{
  const p = phraseAttente(pris, { updated_at: il(1) }, ctx())
  verifie('pris, 1 min de silence : on attend, avec l’heure limite', !p.aFaire && /Sans nouvelle d’ici \d\d:\d\d/.test(p.suite), p)
}
{
  const p = phraseAttente({ ...pris, pris_jusqu_a: il(10) }, null, ctx())
  verifie('en cours mais réservation finie : « plus personne », pas « réservé »', /plus personne/.test(p.quoi) && !JARGON.test(p.quoi), p)
}
{
  const s = situationSilence(pris, { updated_at: il(45), pourcentage: 0, etape: '' }, { now, prochainPassage: dans(20), demandeEnCours: false })
  verifie('carte « Plus de nouvelles » : aucun identifiant technique', !JARGON.test(`${s.ceQuiSePasse} ${s.consigne} ${s.qui}`), s)
}
verifie('projetAutonome : permanent, daté à venir, daté passé, absent', projetAutonome({ autonome_toujours: true }, now) && projetAutonome({ autonome_jusqu_a: dans(5) }, now) && !projetAutonome({ autonome_jusqu_a: il(5) }, now) && !projetAutonome(null, now))
bilan('verifier-en-attente')
