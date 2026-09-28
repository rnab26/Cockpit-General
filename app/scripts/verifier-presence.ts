// La règle « quelqu'un travaille-t-il VRAIMENT ? » (src/lib/presence.ts).
// Le premier cas est la capture de Raphaël du 29 sept. 2026 : barres à 85 %
// reprises d'un visuel, badge « En cours », personne dessus.
import { verifie, bilan } from './_assert.ts'
import { presenceChantier, sessionsActives, consigneClaude, preuveDeVie } from '../src/lib/presence.ts'

const now = new Date('2026-09-29T01:04:00Z')
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const dans = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
const act = (statut: 'en_cours' | 'attente' | 'termine' | 'echec', minAgo: number, pct = 50) =>
  ({ statut, updated_at: il(minAgo), session: 'claude/x', pourcentage: pct, etape: 'Bacs' })
const ch = (etat: string, pris_par: string | null = null, pris_jusqu_a: string | null = null) =>
  ({ etat, pris_par, pris_jusqu_a, archived_at: null }) as any

console.log('verifier-presence')

// 1. La capture : en_cours, aucune réservation, barre « attente » vieille de 5 h.
{
  const p = presenceChantier(ch('en_cours'), act('attente', 300, 85), false, now)
  verifie('capture du 29/09 : « En cours » sans session = « Personne dessus »', p.code === 'personne', p)
  verifie('…barre GRISE (pas vive)', !p.barreVive)
  verifie('…propose de relancer', p.aRelancer)
  verifie('…dit le dernier avancement connu', /85 %/.test(p.detail ?? ''), p.detail)
  verifie('…dit quoi faire', /copie la consigne/.test(p.tonAction ?? ''))
}
// 2. Une vraie session, étape signalée il y a 2 min.
{
  const p = presenceChantier(ch('en_cours', 'claude/x', dans(60)), act('en_cours', 2), false, now)
  verifie('étape il y a 2 min = « Claude y travaille »', p.code === 'travaille', p)
  verifie('…barre vive, rien à relancer', p.barreVive && !p.aRelancer)
  verifie('…nomme la session', /claude\/x/.test(p.detail ?? ''))
}
// 3. Réservé, mais plus de signe depuis 40 min.
{
  const p = presenceChantier(ch('en_cours', 'claude/x', dans(60)), act('en_cours', 40), false, now)
  verifie('réservé + 40 min de silence = « Pris, mais silencieux »', p.code === 'silencieux', p)
  verifie('…barre grise et proposition de relance', !p.barreVive && p.aRelancer)
}
// 4. Le délai est un réglage : 60 min de tolérance → 40 min, c'est encore vivant.
verifie('le délai de silence est réglable', presenceChantier(ch('en_cours', 'claude/x', dans(60)), act('en_cours', 40), false, now, 60 * 60_000).code === 'travaille')
// 5. Réservation expirée : ce n'est plus « pris ».
verifie('réservation expirée, pas d’activité = « Personne dessus »', presenceChantier(ch('en_cours', 'claude/x', il(5)), null, false, now).code === 'personne')
// 6. Une étape récente mais « attente » (ou « termine ») n'est pas une preuve de vie.
verifie('statut « attente » récent n’est pas une preuve de vie', !preuveDeVie(act('attente', 1), now, 15 * 60_000))
verifie('statut « termine » récent n’est pas une preuve de vie', !preuveDeVie(act('termine', 1), now, 15 * 60_000))
// 7. Ce qui t'attend passe avant tout, même quand une session travaille.
{
  const p = presenceChantier(ch('en_cours', 'claude/x', dans(60)), act('en_cours', 1), true, now)
  verifie('question en attente = « Attend ta réponse », même session vivante', p.code === 'attend_toi', p)
  verifie('…et dit que Claude attend', /attend ta réponse/.test(p.detail ?? ''))
}
verifie('à vérifier = « À toi de vérifier » avec l’action', presenceChantier(ch('a_verifier'), null, false, now).tonAction?.includes('Comment vérifier') === true)
verifie('à cadrer = « À cadrer avec toi »', presenceChantier(ch('a_cadrer'), act('attente', 300), false, now).code === 'a_cadrer')
verifie('certifié = terminé, rien à faire', presenceChantier(ch('valide'), null, false, now).tonAction === null)
verifie('à trier sans personne le dit', /pas encore examiné/.test(presenceChantier(ch('a_trier'), null, false, now).libelle))
verifie('« libre » avec une barre à 90 % reste « Personne dessus »', presenceChantier(ch('libre'), act('attente', 300, 90), false, now).code === 'personne')
// 8. Le bandeau du haut.
verifie('bandeau : aucune session quand tout est vieux ou en attente', sessionsActives([act('attente', 1), act('en_cours', 300)], now).length === 0)
verifie('bandeau : une session vivante est comptée une fois',
  sessionsActives([act('en_cours', 1), { ...act('en_cours', 3), session: 'claude/x' }, { ...act('en_cours', 2), session: 'claude/y' }], now).join(',') === 'claude/x,claude/y')
// 9. La consigne à coller.
{
  const t = consigneClaude({ id: 'abc', titre: 'Objets — vidéo' }, 'facepro')
  verifie('consigne : nomme le chantier, le projet et l’id', t.includes('« Objets — vidéo »') && t.includes('facepro') && t.includes('abc'), t)
  verifie('consigne : demande la progression et « Comment vérifier »', t.includes('progression') && t.includes('Comment vérifier'))
}
bilan('verifier-presence')
