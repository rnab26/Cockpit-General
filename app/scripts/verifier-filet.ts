// Filet de sécurité (src/lib/filet.ts, 0044) : les mots de l'écran pour chaque état.
import { verifie, bilan } from './_assert.ts'
import { phraseFilet, detailsFilet, phraseChef, phraseReaction, dureeLisible, ROLE_FILET, type EtatFiletBase } from '../src/lib/filet.ts'
import { LIBELLE_LANCER } from '../src/lib/traiter.ts'

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
// 0082 : « aucune session chef » n'est pas « jeton manquant » (constaté sur le moteur : le jeton existait, le dernier réveil avait reçu HTTP 200).
const sc = phraseFilet({ ...base, statut: 'sans_chef', attente: att })
verifie('aucune session chef + du travail qui attend : bloqué, dit la vraie raison, jamais « jeton »', sc.ton === 'alerte' && /^Bloqué : aucune session chef/.test(sc.titre) && /^En attente : 2 chantier\(s\) prenable\(s\)\. Rien ne se lance tout seul/.test(sc.detail) && !/jeton/i.test(sc.titre + sc.detail), sc)
verifie('… et le geste est d\'ouvrir une session (jamais « Coller le jeton »)', sc.action?.code === 'session' && sc.action.libelle === LIBELLE_LANCER && !/jeton/i.test(sc.action.libelle), sc.action)
const sc0 = phraseFilet({ ...base, statut: 'sans_chef' })
verifie('aucune session chef mais rien n\'attend : pas d\'alarme, pas de bouton, le dit', sc0.ton === 'ok' && sc0.titre === 'Tout est en ordre' && /aucune session chef/.test(sc0.detail) && !sc0.action, sc0)
verifie('« sans jeton » reste inchangé (cible sans jeton, ou aucun jeton configuré)', /Il manque le jeton du réveil/.test(s.detail) && s.action?.code === 'jeton')
const p = phraseFilet({ ...base, statut: 'plafond', aujourdhui: 6 })
verifie('plafond : « Bloqué : 6 réveils » + bouton limite', /^Bloqué : 6 réveils/.test(p.titre) && p.action?.code === 'plafond', p)
const e = phraseFilet({ ...base, statut: 'eteint' })
verifie('éteint : alerte + bouton Rallumer', e.ton === 'alerte' && e.action?.code === 'rallumer', e)
verifie('cron absent : bloqué, sans bouton', /^Bloqué/.test(phraseFilet({ ...base, statut: 'cron_absent' }).titre) && !phraseFilet({ ...base, statut: 'cron_absent' }).action)
verifie('coupé pour tous : bloqué, dit la commande', /filet-global oui/.test(phraseFilet({ ...base, statut: 'global_eteint' }).detail))
verifie('projet de test : neutre', phraseFilet({ ...base, statut: 'test' }).ton === 'neutre')
for (const st of ['actif', 'eteint', 'global_eteint', 'cron_absent', 'sans_chef', 'sans_jeton', 'plafond'] as const) {
  const ph = phraseFilet({ ...base, statut: st, attente: att })
  verifie(`premier niveau sans jargon (${st})`, !/pg_cron|plafond atteint|délai/i.test(ph.titre), ph.titre)
}
const d = detailsFilet({ ...base, attente: att }).join(' | ')
verifie('détails : dernier réveil, ce qui attend, compte du jour, délai', /Dernier réveil : 13:05/.test(d) && /Ce qui attend/.test(d) && /1 sur 6/.test(d) && /10 min/.test(d), d)
// 0071 : délai réel de réponse et chef muette, en mots.
verifie('chef muette : dit pourquoi ; chef qui répond : rien', /pleine/.test(phraseChef({ repond: false, raison: 'jetons' })) && /ne réagit pas/.test(phraseChef({ repond: false, raison: 'sans_passe' })) && phraseChef({ repond: true, raison: 'ok' }) === '')
const d2 = detailsFilet({ ...base, attente: att, cadence_min: 1, reveil_ecart_min: 5, chef_reactif_min: 5, chef: { repond: false, raison: 'jetons' } }).join(' | ')
verifie('détails : cadence, chef pleine', /toutes les 1 min/.test(d2) && /pleine/.test(d2), d2)
verifie('durées lisibles', dureeLisible(45) === '45 s' && dureeLisible(240) === '4 min' && dureeLisible(7800) === '2 h 10', [dureeLisible(45), dureeLisible(240), dureeLisible(7800)])
const rx = { jours: 7, messages: 12, repondus: 10, sans_reponse: 2, mediane_s: 240, p90_s: 900, pire_s: 3000, dernier_s: 60, plus_ancien_sans_reponse: null }
const pr = phraseReaction(rx)
verifie('réaction : médiane en titre, détail avec p90 et sans réponse', /^Réponse en 4 min/.test(pr.titre) && /15 min/.test(pr.detail) && /2 sans réponse/.test(pr.detail), pr)
verifie('réaction : rien à mesurer', /Pas encore/.test(phraseReaction({ ...rx, messages: 0 }).titre) && /Pas encore/.test(phraseReaction(null).titre))
verifie('réaction : messages mais aucune réponse', /Aucune réponse/.test(phraseReaction({ ...rx, repondus: 0, mediane_s: null }).titre))
bilan('verifier-filet')
