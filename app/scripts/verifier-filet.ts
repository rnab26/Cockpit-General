// Filet de sécurité (src/lib/filet.ts, 0044) : les mots de l'écran pour chaque état.
import { verifie, bilan } from './_assert.ts'
import { phraseFilet, detailsFilet, dureeCourte, phraseReponse, phraseChef, ROLE_FILET, type EtatFiletBase } from '../src/lib/filet.ts'

console.log('verifier-filet')
const base: EtatFiletBase = { statut: 'actif', projet_actif: true, plafond: 6, delai_min: 10, aujourdhui: 1, dernier_at: '2026-09-30T10:05:00Z',
  dernier_pourquoi: '2 message(s) sans réponse', attente: { n: 0, raisons: [] }, vivant: false }
const att = { n: 2, raisons: ['2 chantier(s) prenable(s)'] }
verifie('rôle : une phrase en français courant, sans jargon', /réveillé tout seul/.test(ROLE_FILET) && !/jeton|plafond|délai/i.test(ROLE_FILET))
const a = phraseFilet(base)
verifie('rien n’attend : « Tout est en ordre » + heure du dernier réveil', a.ton === 'ok' && a.titre === 'Tout est en ordre' && /13:05/.test(a.detail), a)
verifie('rien n’attend, jamais réveillé : pas d’heure', !/réveil à/.test(phraseFilet({ ...base, dernier_at: null, dernier_pourquoi: null }).detail))
const w = phraseFilet({ ...base, attente: att })
verifie('travail en attente, personne dessus : « En attente » et le délai', w.ton === 'attente' && /^En attente/.test(w.titre) && /après 10 min/.test(w.detail), w)
verifie('travail en attente, session vivante : le dit', /session s’en occupe/.test(phraseFilet({ ...base, vivant: true, attente: att }).titre))
const s = phraseFilet({ ...base, statut: 'sans_jeton' })
verifie('sans jeton : bloqué + bouton « Coller le jeton »', s.ton === 'alerte' && /^Bloqué/.test(s.titre) && s.action?.code === 'jeton' && /Coller le jeton/.test(s.action.libelle), s)
const p = phraseFilet({ ...base, statut: 'plafond', aujourdhui: 6 })
verifie('plafond : « Bloqué : 6 réveils » + bouton limite', /^Bloqué : 6 réveils/.test(p.titre) && p.action?.code === 'plafond', p)
const e = phraseFilet({ ...base, statut: 'eteint' })
verifie('éteint : alerte + bouton Rallumer', e.ton === 'alerte' && e.action?.code === 'rallumer', e)
verifie('cron absent : bloqué, sans bouton', /^Bloqué/.test(phraseFilet({ ...base, statut: 'cron_absent' }).titre) && !phraseFilet({ ...base, statut: 'cron_absent' }).action)
verifie('coupé pour tous : bloqué, dit la commande', /filet-global oui/.test(phraseFilet({ ...base, statut: 'global_eteint' }).detail))
verifie('projet de test : neutre', phraseFilet({ ...base, statut: 'test' }).ton === 'neutre')
for (const st of ['actif', 'eteint', 'global_eteint', 'cron_absent', 'sans_jeton', 'plafond'] as const) {
  const ph = phraseFilet({ ...base, statut: st, attente: att })
  verifie(`premier niveau sans jargon (${st})`, !/pg_cron|plafond atteint|délai/i.test(ph.titre), ph.titre)
}
const d = detailsFilet({ ...base, attente: att }).join(' | ')
verifie('détails : dernier réveil, ce qui attend, compte du jour, délai', /Dernier réveil : 13:05/.test(d) && /Ce qui attend/.test(d) && /1 sur 6/.test(d) && /10 min/.test(d), d)
// 0071 : délai réel de réponse et chef muette, en mots.
verifie('durées lisibles', dureeCourte(45) === '45 s' && dureeCourte(240) === '4 min' && dureeCourte(7800) === '2 h 10' && dureeCourte(null) === '—')
const rep = { n: 5, repondus: 4, en_attente: 1, attente_depuis_s: 600, mediane_s: 240, p90_s: 900, dernier_s: 30 }
const pr = phraseReponse(rep)
verifie('phrase de réponse : médiane, dernière, attente', /4 min/.test(pr) && /30 s/.test(pr) && /1 message\(s\) attendent depuis 10 min/.test(pr), pr)
verifie('aucun message : pas de phrase', phraseReponse({ ...rep, n: 0 }) === '' && phraseReponse(null) === '')
verifie('chef muette : dit pourquoi ; chef qui répond : rien', /pleine/.test(phraseChef({ repond: false, raison: 'jetons' })) && /ne réagit pas/.test(phraseChef({ repond: false, raison: 'sans_passe' })) && phraseChef({ repond: true, raison: 'ok' }) === '')
const d2 = detailsFilet({ ...base, attente: att, cadence_min: 1, reveil_ecart_min: 5, chef_reactif_min: 5, reponse: rep, chef: { repond: false, raison: 'jetons' } }).join(' | ')
verifie('détails : cadence, délai de réponse, chef pleine', /toutes les 1 min/.test(d2) && /Réponse en 4 min/.test(d2) && /pleine/.test(d2), d2)
bilan('verifier-filet')
