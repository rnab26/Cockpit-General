// Filet de sécurité (src/lib/filet.ts, 0044) : les mots de l'écran pour chaque état.
import { verifie, bilan } from './_assert.ts'
import { phraseFilet, detailsFilet, phraseReaction, dureeLisible, ROLE_FILET, type EtatFiletBase } from '../src/lib/filet.ts'

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
verifie('durées lisibles', dureeLisible(45) === '45 s' && dureeLisible(240) === '4 min' && dureeLisible(7800) === '2 h 10', [dureeLisible(45), dureeLisible(240), dureeLisible(7800)])
const rx = { jours: 7, messages: 12, repondus: 10, sans_reponse: 2, mediane_s: 240, p90_s: 900, pire_s: 3000, dernier_s: 60, plus_ancien_sans_reponse: null }
const pr = phraseReaction(rx)
verifie('réaction : médiane en titre, détail avec p90 et sans réponse', /^Réponse en 4 min/.test(pr.titre) && /15 min/.test(pr.detail) && /2 sans réponse/.test(pr.detail), pr)
verifie('réaction : rien à mesurer', /Pas encore/.test(phraseReaction({ ...rx, messages: 0 }).titre) && /Pas encore/.test(phraseReaction(null).titre))
verifie('réaction : messages mais aucune réponse', /Aucune réponse/.test(phraseReaction({ ...rx, repondus: 0, mediane_s: null }).titre))
bilan('verifier-filet')
