// Le mode autonome (src/lib/autonome.ts) : l'heure de fin se choisit en heure
// d'ISRAËL, quel que soit le fuseau de l'appareil ; « 9:00 » passé = demain.
import { verifie, bilan } from './_assert.ts'
import { prochaineHeure, heureIsrael, autonomeActif, chantiersPrenables, erreurReglage, estHeure, etatAutonome, texteArretVide, travailEnCours, ARRET_VIDE_CHOIX, ARRET_VIDE_DEFAUT } from '../src/lib/autonome.ts'

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

// 0031 : interrupteur, alerte « rien à prendre », extinction automatique (chantier 79ec70d6).
{
  const base = { autonome_jusqu_a: null, autonome_toujours: true, autonome_arret_vide_h: 3, autonome_vide_depuis: null, autonome_eteint_auto_at: null }
  verifie('allumé avec du travail prêt : aucune alerte', etatAutonome(base, 2, false, soir).alerte === null && etatAutonome(base, 2, false, soir).libelle === 'Autonome tout le temps')
  verifie('allumé sans chantier prêt MAIS un agent au travail : aucune alerte', etatAutonome(base, 0, true, soir).alerte === null)
  verifie('allumé, rien à prendre, pas encore constaté : « s’éteindra seul après 3 h »', /après 3 h/.test(etatAutonome(base, 0, false, soir).alerte ?? ''))
  const vide = { ...base, autonome_vide_depuis: '2026-09-29T19:30:00Z' } // 22 h 30 Israël
  verifie('rien depuis 22 h 30, 3 h : « s’éteindra seul vers 01:30 »', etatAutonome(vide, 0, false, soir).alerte === 'Rien à prendre : il s’éteindra seul vers 01:30.', etatAutonome(vide, 0, false, soir).alerte)
  verifie('délai dépassé : « au prochain passage »', /prochain passage/.test(etatAutonome({ ...vide, autonome_vide_depuis: '2026-09-29T10:00:00Z' }, 0, false, soir).alerte ?? ''))
  verifie('extinction « jamais » : l’alerte dit qu’il réveille pour rien', /réveille quand même/.test(etatAutonome({ ...base, autonome_arret_vide_h: 0 }, 0, false, soir).alerte ?? ''))
  const eteint = etatAutonome({ ...base, autonome_toujours: false, autonome_eteint_auto_at: '2026-09-29T19:30:00Z' }, 0, false, soir)
  verifie('éteint tout seul : pas d’alerte, la note dit l’heure', !eteint.actif && eteint.alerte === null && eteint.note === 'Éteint tout seul à 22:30 : plus rien à prendre.', eteint)
  verifie('éteint à la main : ni alerte ni note', (({ alerte, note }) => !alerte && !note)(etatAutonome({ ...base, autonome_toujours: false }, 0, false, soir)))
  verifie('texte de l’extinction', texteArretVide(3) === 's’éteint seul après 3 h sans rien à prendre' && texteArretVide(0) === 'ne s’éteint jamais seul')
  verifie('choix proposés : jamais, 1, 3, 6 h (3 par défaut)', ARRET_VIDE_CHOIX.join() === '0,1,3,6' && ARRET_VIDE_DEFAUT === 3)
  const C = (x: Record<string, unknown>) => ({ projet_id: 'p', etat: 'en_cours', archived_at: null, pris_par: 'agent/x', pris_jusqu_a: '2026-09-29T22:00:00Z', ...x }) as never
  verifie('travail : un chantier réservé en cours', travailEnCours([C({})], [], 'p', soir))
  verifie('pas de travail : réservation expirée, autre projet, archivé', !travailEnCours([C({ pris_jusqu_a: '2026-09-29T10:00:00Z' }), C({ projet_id: 'q' }), C({ archived_at: 'x' })], [], 'p', soir))
  verifie('travail : un agent vu il y a 10 min ; pas s’il est muet depuis 2 h', travailEnCours([], [{ projet_id: 'p', statut: 'en_cours', vu_at: '2026-09-29T20:20:00Z' } as never], 'p', soir)
    && !travailEnCours([], [{ projet_id: 'p', statut: 'en_cours', vu_at: '2026-09-29T18:30:00Z' } as never], 'p', soir))
}
bilan('verifier-autonome')
