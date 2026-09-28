// Quatre nombres par section : bouge / dort / pour toi / livré. Bloqué,
// reporté et réservation expirée ne comptent nulle part.
import { verifie, bilan } from './_assert.ts'
import { ouJenSuis } from '../src/lib/ouJenSuis.ts'
import { debutFenetre, dansFenetre } from '../src/lib/fenetre.ts'

const now = new Date('2026-09-28T15:00:00')  // heure LOCALE
const iso = (d: Date) => d.toISOString()
const plusTard = iso(new Date(now.getTime() + 3600_000))
const avant = iso(new Date(now.getTime() - 3600_000))
const S = (id: string, position: number) => ({ id, nom: id, position, projet_id: 'p', cle: id, description: null, created_at: '' })
const C = (id: string, etat: string, extra: Record<string, unknown> = {}) => ({
  id, etat, projet_id: 'p', section_id: 'A', titre: id, priorite: 'normale', archived_at: null,
  pris_par: null, pris_jusqu_a: null, valide_at: null, updated_at: '', created_at: '', ...extra,
}) as never
const sections = [S('B', 2), S('A', 1)]
const chantiers = [
  C('bouge', 'en_cours', { pris_par: 's', pris_jusqu_a: plusTard }),
  C('expiree', 'en_cours', { pris_par: 's', pris_jusqu_a: avant }),
  C('dort-libre', 'libre'),
  C('dort-trier', 'a_trier'),
  C('dort-cadrer', 'a_cadrer'),
  C('reserve-libre', 'libre', { pris_par: 's', pris_jusqu_a: plusTard }),
  C('a-verifier', 'a_verifier'),
  C('question', 'libre'),
  C('bloque', 'bloque'),
  C('reporte', 'reporte'),
  C('livre-aujourdhui', 'valide', { valide_at: iso(new Date('2026-09-28T01:30:00')), archived_at: avant }),
  C('livre-hier', 'valide', { valide_at: iso(new Date('2026-09-27T23:30:00')), archived_at: avant }),
  C('doublon', 'libre', { archived_at: avant, section_id: 'B' }),
  C('sans-section', 'libre', { section_id: null }),
  C('section-inconnue', 'libre', { section_id: 'Z' }),
]
const messages = [
  { chantier_id: 'question', kind: 'question', answered_at: null },
  { chantier_id: 'dort-libre', kind: 'question', answered_at: '2026-09-28T10:00:00Z' }, // répondue : ne compte pas
  { chantier_id: null, kind: 'action', answered_at: null },                            // question de projet
]

console.log('verifier-ou-jen-suis')
const r = ouJenSuis(sections, chantiers, messages, 'aujourdhui', now)
const A = r.lignes.find((l) => l.section?.id === 'A')!
verifie('les sections suivent leur position (A avant B)', r.lignes[0].section?.id === 'A' && r.lignes[1].section?.id === 'B')
verifie('bouge = en cours avec réservation valide + réservé sans état en_cours', A.nombres.bouge === 2, A.nombres)
verifie('une réservation expirée ne bouge pas et ne dort pas : elle ressort à part', A.nombres.expirees === 1 && !A.ids.dort.includes('expiree') && !A.ids.bouge.includes('expiree'))
verifie('dort = libre / à trier / à cadrer sans réservation (la question répondue compte comme dort)',
  A.nombres.dort === 4 && ['dort-libre','dort-trier','dort-cadrer','question'].every((id) => A.ids.dort.includes(id)), A.ids.dort)
verifie('pour toi = question en attente + à vérifier', A.nombres.pourToi === 2 && A.ids.pourToi.includes('question') && A.ids.pourToi.includes('a-verifier'), A.ids.pourToi)
verifie('bloqué et reporté ne comptent nulle part', !Object.values(A.ids).flat().includes('bloque') && !Object.values(A.ids).flat().includes('reporte'))
verifie('livré aujourd’hui : minuit LOCAL (01h30 compte, 23h30 la veille non)', A.nombres.livre === 1 && A.ids.livre[0] === 'livre-aujourdhui', A.ids.livre)
const r7 = ouJenSuis(sections, chantiers, messages, '7j', now)
verifie('fenêtre 7 jours : hier compte', r7.lignes.find((l) => l.section?.id === 'A')!.nombres.livre === 2)
const B = r.lignes.find((l) => l.section?.id === 'B')!
verifie('un doublon archivé ne compte nulle part', Object.values(B.nombres).every((n) => n === 0))
const sans = r.lignes.find((l) => l.section === null)!
verifie('« Sans section » regroupe sans section ET section inconnue, plus la question de projet',
  sans.nombres.dort === 2 && sans.nombres.pourToi === 1, sans.nombres)
verifie('le total additionne toutes les lignes', r.total.dort === 6 && r.total.pourToi === 3 && r.total.bouge === 2 && r.total.livre === 1, r.total)
const rien = ouJenSuis(sections, [C('x', 'libre')], [], 'aujourdhui', now)
verifie('« Sans section » n’apparaît pas quand elle est vide', !rien.lignes.some((l) => l.section === null))
verifie('debutFenetre aujourd’hui = minuit local', debutFenetre('aujourdhui', now).getHours() === 0 && debutFenetre('aujourdhui', now).getDate() === 28)
verifie('debutFenetre 30 jours = 29 jours avant, à minuit', debutFenetre('30j', now).getTime() === new Date('2026-08-30T00:00:00').getTime())
verifie('dansFenetre refuse une date future lointaine', !dansFenetre(iso(new Date(now.getTime() + 86400_000)), '30j', now))
bilan('verifier-ou-jen-suis')
