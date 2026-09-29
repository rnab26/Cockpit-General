// Mettre de côté / reporter / abandonner (src/lib/reporter.ts, 0027).
import { verifie, bilan } from './_assert.ts'
import { CHOIX_REPORT, dateDeReport, dateSaisie, texteReporte } from '../src/lib/reporter.ts'

console.log('verifier-reporter')
const now = new Date(2026, 8, 29, 22, 30)
const d1 = dateDeReport(1, now)
verifie('demain = le 30 sept. à 9 h (heure locale)', d1.getDate() === 30 && d1.getMonth() === 8 && d1.getHours() === 9 && d1.getMinutes() === 0)
verifie('dans une semaine = le 6 oct.', (() => { const d = dateDeReport(7, now); return d.getDate() === 6 && d.getMonth() === 9 })())
verifie('4 choix, du plus proche au plus loin', CHOIX_REPORT.length === 4 && CHOIX_REPORT.every((c, i, a) => i === 0 || c.jours > a[i - 1].jours))
verifie('date saisie lisible et future : 9 h ce jour-là', (() => { const d = dateSaisie('2026-10-15', now); return !!d && d.getDate() === 15 && d.getHours() === 9 })())
verifie('date saisie passée, illisible ou à plus d’un an : refusée', dateSaisie('2026-09-01', now) === null && dateSaisie('15/10/2026', now) === null && dateSaisie('2028-01-01', now) === null)
verifie('pas reporté : rien à dire', texteReporte({ etat: 'libre', reporte_jusqu_a: null, archived_at: null }, now) === null)
verifie('mis de côté sans date', /Mis de côté/.test(texteReporte({ etat: 'reporte', reporte_jusqu_a: null, archived_at: null }, now) ?? ''))
verifie('reporté : la date, et qu’il revient tout seul', (() => { const t = texteReporte({ etat: 'reporte', reporte_jusqu_a: new Date(2026, 9, 6, 9).toISOString(), archived_at: null }, now) ?? ''; return /Reporté au 6 octobre/.test(t) && /revient tout seul/.test(t) })())
verifie('date passée : revient au prochain passage', /prochain passage/.test(texteReporte({ etat: 'reporte', reporte_jusqu_a: new Date(2026, 8, 29, 9).toISOString(), archived_at: null }, now) ?? ''))
verifie('abandonné : comment le reprendre', /Abandonné/.test(texteReporte({ etat: 'reporte', reporte_jusqu_a: null, archived_at: now.toISOString() }, now) ?? ''))
bilan('verifier-reporter')
