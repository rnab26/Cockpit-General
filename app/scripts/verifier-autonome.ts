// Le mode autonome (src/lib/autonome.ts) : l'heure de fin se choisit en heure
// d'ISRAËL, quel que soit le fuseau de l'appareil ; « 9:00 » passé = demain.
import { verifie, bilan } from './_assert.ts'
import { prochaineHeure, heureIsrael, autonomeActif, chantiersPrenables, erreurReglage, estHeure } from '../src/lib/autonome.ts'

console.log('verifier-autonome')
// 29 sept. 2026, 23 h 30 à Jérusalem (été : UTC+3) = 20 h 30 UTC.
const soir = new Date('2026-09-29T20:30:00Z')
const f = prochaineHeure('09:00', soir)
verifie('à 23 h 30 (Israël), « 09:00 » = demain 9 h Israël = 06:00 UTC', f.toISOString() === '2026-09-30T06:00:00.000Z', f.toISOString())
verifie('…et se relit « 09:00 »', heureIsrael(f) === '09:00')
const matin = new Date('2026-09-30T03:00:00Z') // 6 h Israël
verifie('à 6 h (Israël), « 09:00 » = aujourd’hui 9 h', prochaineHeure('09:00', matin).toISOString() === '2026-09-30T06:00:00.000Z')
verifie('à 6 h, « 05:00 » = demain (jamais le passé)', prochaineHeure('05:00', matin).getTime() > matin.getTime())
// Hiver : UTC+2 (décembre).
verifie('en hiver, « 09:00 » Israël = 07:00 UTC', prochaineHeure('09:00', new Date('2026-12-10T20:00:00Z')).toISOString() === '2026-12-11T07:00:00.000Z')
verifie('estHeure : « 09:00 » oui, « 9h » et « 25:00 » non', estHeure('09:00') && !estHeure('9h') && !estHeure('25:00'))
verifie('allumé = heure de fin future', autonomeActif({ autonome_jusqu_a: '2026-09-30T06:00:00Z' }, soir) && !autonomeActif({ autonome_jusqu_a: '2026-09-29T06:00:00Z' }, soir) && !autonomeActif({ autonome_jusqu_a: null }, soir))
verifie('allumé « tout le temps » (0011), même sans heure', autonomeActif({ autonome_jusqu_a: null, autonome_toujours: true }, soir))
{
  const il = (min: number) => new Date(soir.getTime() - min * 60_000).toISOString()
  let n = 0
  const C = (etat: string, x: Record<string, unknown> = {}) => ({ id: `c${n++}`, projet_id: 'p', etat, archived_at: null, doublon_de: null, pris_par: null, pris_jusqu_a: null, updated_at: il(120), ...x }) as never
  const liste = [C('libre'), C('libre', { pris_par: 's', pris_jusqu_a: '2026-09-29T22:00:00Z' }), C('libre', { pris_par: 's', pris_jusqu_a: '2026-09-29T10:00:00Z' }),
    C('a_cadrer'), C('bloque'), C('reporte'), C('a_verifier'), C('libre', { archived_at: 'x' }), C('libre', { doublon_de: 'y' }), C('libre', { projet_id: 'autre' })]
  verifie('prenables : libres non réservés (ou réservation expirée) — jamais à cadrer, bloqué, reporté, à vérifier', chantiersPrenables(liste, 'p', soir) === 2)
  verifie('prenables : « pas encore trié » aussi (0011)', chantiersPrenables([C('a_trier')], 'p', soir) === 1)
  const abandonne = C('en_cours', { id: 'ab' })
  verifie('prenables : en cours ABANDONNÉ (fiche immobile 2 h, aucun signe de vie)', chantiersPrenables([abandonne], 'p', soir) === 1)
  verifie('…mais pas s’il a bougé depuis moins d’1 h', chantiersPrenables([C('en_cours', { updated_at: il(20) })], 'p', soir) === 0)
  verifie('…ni avec une barre vivante (< 30 min)', chantiersPrenables([abandonne], 'p', soir, [{ chantier_id: 'ab', statut: 'en_cours', updated_at: il(10), session: 'b' }]) === 0)
  verifie('…ni avec un agent vu il y a 10 min', chantiersPrenables([abandonne], 'p', soir, [], [{ chantier_id: 'ab', statut: 'en_cours', vu_at: il(10) }]) === 0)
  verifie('…ni si une session vivante du projet l’a fait avancer en dernier',
    chantiersPrenables([abandonne], 'p', soir, [{ chantier_id: 'ab', statut: 'termine', updated_at: il(90), session: 'claude/x' }], [], [{ projet_id: 'p', fin_at: null, vu_at: il(5), branche: 'claude/x' }]) === 0)
}
verifie('réglage : le passé est refusé en clair', erreurReglage(new Date(soir.getTime() - 1000), 8, soir) === 'L’heure de fin doit être dans le futur.')
verifie('réglage : plus de 24 h refusé', erreurReglage(new Date(soir.getTime() + 25 * 3600_000), 8, soir) === 'Pas plus de 24 h d’affilée.')
verifie('réglage : plafond 1-50', erreurReglage(f, 0, soir) !== null && erreurReglage(f, 51, soir) !== null && erreurReglage(f, 8, soir) === null)
bilan('verifier-autonome')
