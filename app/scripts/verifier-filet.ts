// Filet de sécurité (src/lib/filet.ts, 0044) : la phrase de l'écran pour chaque état.
import { verifie, bilan } from './_assert.ts'
import { phraseFilet, type EtatFiletBase } from '../src/lib/filet.ts'

console.log('verifier-filet')
const base: EtatFiletBase = { statut: 'actif', projet_actif: true, plafond: 6, delai_min: 10, aujourdhui: 1, dernier_at: '2026-09-30T10:05:00Z',
  dernier_pourquoi: '2 message(s) sans réponse', attente: { n: 0, raisons: [] }, vivant: false }
const a = phraseFilet(base)
verifie('actif : dit « actif », l’heure et le pourquoi', a.ton === 'ok' && /actif/.test(a.titre) && /13:05/.test(a.titre) && /2 message/.test(a.titre), a)
verifie('actif sans réveil : « aucun réveil pour l’instant »', /aucun réveil pour l’instant/.test(phraseFilet({ ...base, dernier_at: null, dernier_pourquoi: null }).titre))
verifie('travail en attente, personne dessus : le dit', /personne dessus/.test(phraseFilet({ ...base, attente: { n: 2, raisons: ['2 chantier(s) prenable(s)'] } }).detail))
verifie('travail en attente, session vivante : le dit', /session s’en occupe/.test(phraseFilet({ ...base, vivant: true, attente: { n: 1, raisons: ['1 message(s) sans réponse'] } }).detail))
const s = phraseFilet({ ...base, statut: 'sans_jeton' })
verifie('sans jeton : « colle le jeton dans Réglages »', s.ton === 'alerte' && /colle le jeton dans Réglages/.test(s.titre), s)
verifie('plafond : dit le compte', /plafond atteint \(6\/6/.test(phraseFilet({ ...base, statut: 'plafond', aujourdhui: 6 }).titre))
verifie('éteint : alerte', phraseFilet({ ...base, statut: 'eteint' }).ton === 'alerte')
verifie('cron absent : alerte', /pg_cron/.test(phraseFilet({ ...base, statut: 'cron_absent' }).detail))
verifie('projet de test : neutre', phraseFilet({ ...base, statut: 'test' }).ton === 'neutre')
bilan('verifier-filet')
