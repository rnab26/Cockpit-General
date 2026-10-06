// Répondre à une carte : mise à jour immédiate, un seul envoi, retour arrière (lib/reponseCarte.ts, chantier b287e60a).
// node --experimental-strip-types app/scripts/verifier-reponse-carte.ts
import { verifie, bilan } from './_assert.ts'
import { reponseOptimiste, dejaRepondue, remplacerLigne, retirerLigne, ligneRelueValable, libelleEnvoi, REPONSE_LOCALE, retourCarte, phraseRetourCarte, reponseRetrait } from '../src/lib/reponseCarte.ts'

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

console.log('« Ça bloque » : le retour est daté, suivi, et la carte peut être retirée (0070, chantier 0fec7563)')
const rb = reponseOptimiste(a, { reponse: 'Ça bloque', etat: 'bloque', precision: 'la PR 60 n\'existe pas', maintenant: T })
verifie('« Ça bloque » : la carte reste ouverte et le retour est daté', rb.answered_at === null && rb.retour_at === T && rb.etat === 'bloque')
verifie('« Fait » ne date aucun retour', rf.retour_at === undefined || rf.retour_at === null)
const filVide: never[] = []
verifie('retour « Ça bloque » sans réponse de session : « attend »', retourCarte(rb, filVide)?.etat === 'attend')
const filLu = [{ chantier_id: 'C', auteur_type: 'session', created_at: '2026-10-05T10:06:00Z' }] as never
verifie('une session a écrit depuis dans le fil : « lu »', retourCarte(rb, filLu)?.etat === 'lu')
const filAutre = [{ chantier_id: 'AUTRE', auteur_type: 'session', created_at: '2026-10-05T10:06:00Z' }] as never
verifie('un message d\'un AUTRE chantier ne compte pas', retourCarte(rb, filAutre)?.etat === 'attend')
const filAvant = [{ chantier_id: 'C', auteur_type: 'session', created_at: '2026-10-05T10:01:00Z' }] as never
verifie('un message de session d\'AVANT son retour ne compte pas', retourCarte(rb, filAvant)?.etat === 'attend')
verifie('« Pas encore » seul : rien à suivre (un simple état)', retourCarte(rp, filVide) === null)
verifie('« Pas encore » avec un mot : à suivre', retourCarte(reponseOptimiste(a, { reponse: 'Pas encore', etat: 'pas_encore', precision: 'j\'attends', maintenant: T }), filVide)?.etat === 'attend')
verifie('carte fermée (« Fait »), question, ou rien : pas de retour', retourCarte(rf, filVide) === null && retourCarte(rq, filVide) === null && retourCarte(a, filVide) === null)
verifie('la phrase dit qui fait quoi, et que la carte se retire', /Claude le lira/.test(phraseRetourCarte({ etat: 'attend', depuis: T })) && /retire-la toi-même/.test(phraseRetourCarte({ etat: 'lu', depuis: T })))
verifie('réponse de retrait : même texte que la base (« Retirée par … : motif »)', reponseRetrait('Raphaël', ' cette PR n\'existe pas ') === 'Retirée par Raphaël : cette PR n\'existe pas')
verifie('retrait sans motif : une phrase par défaut', /^Retirée par Raphaël : /.test(reponseRetrait('', '')))
bilan('verifier-reponse-carte')
