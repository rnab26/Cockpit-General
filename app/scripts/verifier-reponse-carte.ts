// Répondre à une carte : mise à jour immédiate, un seul envoi, retour arrière (lib/reponseCarte.ts, chantier b287e60a).
// node --experimental-strip-types app/scripts/verifier-reponse-carte.ts
import { verifie, bilan } from './_assert.ts'
import { reponseOptimiste, dejaRepondue, remplacerLigne, retirerLigne, ligneRelueValable, libelleEnvoi, REPONSE_LOCALE } from '../src/lib/reponseCarte.ts'

const base = { id: 'M1', projet_id: 'P', chantier_id: 'C', auteur: 'claude', auteur_type: 'session', kind: 'question', corps: 'Q ?', pourquoi: null, options: null,
  reponse: null, precision: null, repond_a: null, etat: null, answered_at: null, answered_by: null, created_at: '2026-10-05T10:00:00Z' }
const q = base as never
const a = { ...base, kind: 'action' } as never
const T = '2026-10-05T10:05:00Z'

console.log('mise à jour immédiate (même règle que repondre_message)')
const rq = reponseOptimiste(q, { reponse: 'Option A', maintenant: T })
verifie('question : répondue tout de suite', rq.reponse === 'Option A' && rq.answered_at === T && rq.answered_by === REPONSE_LOCALE)
const rf = reponseOptimiste(a, { reponse: 'Fait', etat: 'fait', maintenant: T })
verifie('action « Fait » : répondue', rf.answered_at === T && rf.etat === 'fait')
const rp = reponseOptimiste(a, { reponse: 'Pas encore', etat: 'pas_encore', maintenant: T })
verifie('action « Pas encore » : reste ouverte, mais l\'état est posé', rp.answered_at === null && rp.etat === 'pas_encore' && rp.reponse === 'Pas encore')
verifie('précision conservée si non donnée', reponseOptimiste({ ...base, precision: 'avant' } as never, { reponse: 'x', maintenant: T }).precision === 'avant')
verifie('l\'original n\'est pas modifié', (q as { answered_at: unknown }).answered_at === null)

console.log('idempotence : un deuxième toucher ne pose rien')
verifie('question déjà répondue pareil : refusé', dejaRepondue(rq, { reponse: 'Option A' }))
verifie('question : une AUTRE réponse passe', !dejaRepondue(rq, { reponse: 'Option B' }))
verifie('question jamais répondue : passe', !dejaRepondue(q, { reponse: 'Option A' }))
verifie('action « Pas encore » deux fois : refusé', dejaRepondue(rp, { reponse: 'Pas encore', etat: 'pas_encore' }))
verifie('action : « Pas encore » puis « Fait » : passe', !dejaRepondue(rp, { reponse: 'Fait', etat: 'fait' }))
verifie('action « Fait » deux fois : refusé', dejaRepondue(rf, { reponse: 'Fait', etat: 'fait' }))

console.log('lignes')
const l = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
verifie('remplacer', remplacerLigne(l, { id: 'b', v: 9 }).map((x) => x.v).join() === '1,9')
verifie('ajouter si absente, jamais deux fois', remplacerLigne(l, { id: 'c', v: 3 }).length === 3 && remplacerLigne(remplacerLigne(l, { id: 'c', v: 3 }), { id: 'c', v: 4 }).length === 3)
verifie('retirer (retour arrière)', retirerLigne(l, 'a').length === 1 && retirerLigne(l, 'zzz').length === 2)

console.log('ligne relue : on ne croit qu\'une ligne qui porte la réponse')
verifie('relue avec la réponse : acceptée', ligneRelueValable(rq, { ...rq, answered_by: 'uid' }))
verifie('relue ancienne (cache hors ligne) : ignorée, le geste reste à l\'écran', !ligneRelueValable(rq, q))
verifie('rien relu : ignorée', !ligneRelueValable(rq, null))

console.log('libellés du bouton')
verifie('envoi / envoyé / repos', libelleEnvoi('envoi', 'Fait') === 'Envoi…' && libelleEnvoi('envoye', 'Fait') === 'Envoyé ✓' && libelleEnvoi('repos', 'Fait') === 'Fait' && libelleEnvoi('echec', 'Fait') === 'Fait')
bilan('verifier-reponse-carte')
