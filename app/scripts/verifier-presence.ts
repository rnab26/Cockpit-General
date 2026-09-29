// La règle « quelqu'un travaille-t-il VRAIMENT ? » (src/lib/presence.ts).
// Le premier cas est la capture de Raphaël du 29 sept. 2026 : barres à 85 %
// reprises d'un visuel, badge « En cours », personne dessus.
import { verifie, bilan } from './_assert.ts'
import { presenceDe } from '../src/lib/entonnoir.ts'
import { presenceChantier, sessionsActives, consigneClaude, preuveDeVie, silenceMsDe, derniereDemandeOuCaEnEst, MESSAGE_OU_CA_EN_EST } from '../src/lib/presence.ts'

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
  verifie('…dit quoi faire (« Copier la consigne », ou écrire une précision)', /Copier la consigne/.test(p.tonAction ?? '') && /écris une précision/.test(p.tonAction ?? ''), p.tonAction)
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
// Retour de Raphaël, 29 sept. : un reporté ne disait pas qu'il n'y avait rien à faire.
{
  const p = presenceChantier(ch('reporte'), null, false, now)
  verifie('reporté : dit « rien à faire de ta part » et propose de le relancer', !!p.tonAction && /Rien à faire de ta part/.test(p.tonAction) && /relancer/.test(p.tonAction), p.tonAction)
}
verifie('à cadrer : « Écris-la ci-dessous »', /Écris-la ci-dessous/.test(presenceChantier(ch('a_cadrer'), null, false, now).tonAction ?? ''))
verifie('bloqué : « réponds ci-dessous »', /réponds ci-dessous/.test(presenceChantier(ch('bloque'), null, false, now).tonAction ?? ''))
// Le badge reste court (il tient sur une ligne de téléphone) : « pas encore examiné » passe dans le détail.
verifie('à trier sans personne le dit (dans le détail, badge court)', /pas encore examiné/.test(presenceChantier(ch('a_trier'), null, false, now).detail ?? '') && presenceChantier(ch('a_trier'), null, false, now).libelle === '⏸️ Personne dessus')
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
// 10. Le réglage « délai de silence » (préférence silence_minutes).
verifie('silence : défaut 15 min sans préférence', silenceMsDe(undefined) === 15 * 60_000)
verifie('silence : 5 et 60 min acceptés', silenceMsDe(5) === 5 * 60_000 && silenceMsDe(60) === 60 * 60_000)
verifie('silence : une valeur hors liste retombe sur 15 min', silenceMsDe(7) === 15 * 60_000 && silenceMsDe('n’importe quoi') === 15 * 60_000)
verifie('silence : un réglage à 5 min fait passer 6 min de silence en « silencieux »',
  presenceChantier(ch('en_cours', 'claude/x', dans(60)), act('en_cours', 6), false, now, silenceMsDe(5)).code === 'silencieux')
// 11. « Demander où ça en est » : la dernière demande du fil.
{
  const fil = [
    { corps: MESSAGE_OU_CA_EN_EST, created_at: il(30) },
    { corps: 'autre chose', created_at: il(1) },
    { corps: MESSAGE_OU_CA_EN_EST, created_at: il(5) },
  ]
  verifie('la dernière demande « où ça en est » est la plus récente', derniereDemandeOuCaEnEst(fil)?.created_at === il(5))
  verifie('aucune demande → null', derniereDemandeOuCaEnEst([{ corps: 'x', created_at: il(1) }]) === null)
}
// 12. Un AGENT vivant lié au chantier est une preuve de vie (règle dans sessions.ts, appliquée par presenceDe).
{
  const agent = { id: 't', session_id: 's', projet_id: 'p', tache_id: 't', type: 'agent', description: 'Refonte', sorte: null, statut: 'en_cours',
    chantier_id: 'c1', etape: 'Tests', pourcentage: 40, eta_secondes: null, progres_at: il(3), demarre_at: il(30), vu_at: il(3), fini_at: null } as never
  const c = { ...ch('en_cours'), id: 'c1' }
  const p = presenceDe(c, [], new Set(), now, 15 * 60_000, [agent]).presence
  verifie('agent signalé il y a 3 min sur le chantier → « 🟢 Un agent y travaille »', p.code === 'travaille' && p.libelle.includes('Un agent'), p)
  verifie('sans agent, le même chantier reste « Personne dessus »', presenceDe(c, [], new Set(), now, 15 * 60_000, []).presence.code === 'personne')
}
bilan('verifier-presence')
