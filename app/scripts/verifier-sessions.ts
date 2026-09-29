// « Qui travaille » : sessions Claude Code et leurs tâches (agents, commandes),
// src/lib/sessions.ts, migration 0008. La règle d'or : une barre seulement
// quand l'agent a signalé son avancement ; jamais un chiffre inventé.
import { verifie, bilan } from './_assert.ts'
import { sessionActive, quiTravaille, titreSession, libellePause, resumeTravail, resteTache, vueTache, agentVivantDuChantier, presenceAvecAgent, dureeLisible, libelleTache } from '../src/lib/sessions.ts'
import { presenceDe } from '../src/lib/entonnoir.ts'
import { presenceChantier } from '../src/lib/presence.ts'

const now = new Date('2026-09-29T10:00:00Z')
const SILENCE = 15 * 60_000
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const S = (id: string, projet: string, extra: Record<string, unknown> = {}) => ({
  id, projet_id: projet, branche: null, sujet: null, tour_en_cours: false, demarre_at: il(120), vu_at: il(1), fin_at: null,
  pause_raison: null, pause_at: null, pause_detail: null, relances: 0, ...extra,
}) as never
const T = (id: string, session: string, projet: string, extra: Record<string, unknown> = {}) => ({
  id, session_id: session, projet_id: projet, tache_id: id, type: 'agent', description: `desc ${id}`, sorte: null, statut: 'en_cours',
  chantier_id: null, etape: null, pourcentage: null, eta_secondes: null, progres_at: null, demarre_at: il(30), vu_at: il(2), fini_at: null, ...extra,
}) as never
const A = (session: string, projet: string, chantier: string | null, minAgo: number) => ({
  id: `a-${session}`, projet_id: projet, chantier_id: chantier, session, etape: 'étape', pourcentage: 40, eta_secondes: null, statut: 'en_cours',
  detail: null, demarre_at: il(minAgo + 5), updated_at: il(minAgo),
}) as never
const C = (id: string, projet: string, etat = 'en_cours') => ({ id, projet_id: projet, titre: `titre ${id}`, etat, pris_par: null, pris_jusqu_a: null, archived_at: null, priorite: 'normale', updated_at: il(60) }) as never

console.log('verifier-sessions')

// 1. Quand une session est-elle active ?
{
  const t: never[] = []
  verifie('signe récent (1 min) → active', sessionActive(S('s', 'p'), t, now, SILENCE))
  verifie('finie (fin_at) → jamais active', !sessionActive(S('s', 'p', { fin_at: il(1) }), t, now, SILENCE))
  verifie('silence de 40 min, pas de tour, pas de tâche → inactive', !sessionActive(S('s', 'p', { vu_at: il(40) }), t, now, SILENCE))
  verifie('répond depuis 25 min (tour en cours) → active', sessionActive(S('s', 'p', { vu_at: il(25), tour_en_cours: true }), t, now, SILENCE))
  verifie('« tour en cours » figé depuis 45 min → plus active', !sessionActive(S('s', 'p', { vu_at: il(45), tour_en_cours: true }), t, now, SILENCE))
  verifie('muette 40 min mais un agent en cours vu il y a 20 min → active', sessionActive(S('s', 'p', { vu_at: il(40) }), [T('t', 's', 'p', { vu_at: il(20) })], now, SILENCE))
  verifie('…mais pas si la tâche n’a pas été vue depuis 3 h', !sessionActive(S('s', 'p', { vu_at: il(40) }), [T('t', 's', 'p', { vu_at: il(180) })], now, SILENCE))
  verifie('le délai de silence est le réglage (60 min → 40 min de silence reste active)', sessionActive(S('s', 'p', { vu_at: il(40) }), t, now, 60 * 60_000))
}

// 2. Une tâche : barre seulement si signalée, temps restant recalculé.
{
  const muette = vueTache(T('m', 's', 'p'), [], now)
  verifie('tâche sans signalement : pas de barre (pourcentage null)', !muette.signale && muette.pourcentage === null && muette.reste === null)
  verifie('…et sa durée se lit (« 30 min »)', muette.duree === '30 min', muette.duree)
  const parlante = vueTache(T('p', 's', 'p', { progres_at: il(2), pourcentage: 60, eta_secondes: 600, etape: 'Tests' }), [], now)
  verifie('tâche signalée : barre à 60 %', parlante.signale && parlante.pourcentage === 60)
  verifie('temps restant recalculé depuis le signalement (10 min − 2 min → ~8 min)', parlante.reste === '~8 min', parlante.reste)
  verifie('temps restant dépassé → inconnu, jamais négatif', resteTache({ eta_secondes: 60, progres_at: il(5) }, now) === null)
  verifie('eta 0 ou absent → inconnu', resteTache({ eta_secondes: 0, progres_at: il(1) }, now) === null && resteTache({ eta_secondes: null, progres_at: il(1) }, now) === null)
  verifie('libellés : « 🤖 Agent : … » / « ⚙️ Commande : … »', libelleTache({ type: 'agent', description: 'Évaluer', sorte: null, tache_id: 'x' }) === 'Agent : Évaluer'
    && libelleTache({ type: 'commande', description: null, sorte: 'npm test', tache_id: 'x' }) === 'Commande : npm test')
  verifie('libellé d’une ligne provisoire : sans « prov: »', libelleTache({ type: 'agent', description: null, sorte: null, tache_id: 'prov:Refonte' }) === 'Agent : Refonte')
  verifie('durées lisibles', dureeLisible(45_000) === '45 s' && dureeLisible(65 * 60_000) === '1 h 05')
  verifie('la tâche retrouve son chantier', vueTache(T('c', 's', 'p', { chantier_id: 'ch' }), [C('ch', 'p')], now).chantier?.titre === 'titre ch')
}

// 3. Le tableau « qui travaille », par projet.
{
  const sessions = [
    S('s1', 'p1', { sujet: 'Refonte de l’accueil', tour_en_cours: true, branche: 'claude/accueil' }),
    S('s2', 'p1', { vu_at: il(40) }),                        // muette, sans tâche → absente
    S('s3', 'p2', { vu_at: il(3), branche: 'claude/x' }),
    S('s4', 'p2', { fin_at: il(1) }),                        // finie → absente
  ]
  const taches = [
    T('a1', 's1', 'p1', { progres_at: il(1), pourcentage: 50, eta_secondes: 1200 }),
    T('a2', 's1', 'p1'),
    T('c1', 's1', 'p1', { type: 'commande', description: 'npm run build' }),
    T('f1', 's1', 'p1', { statut: 'termine', fini_at: il(3) }),   // finie il y a 3 min : repliée
    T('f2', 's1', 'p1', { statut: 'termine', fini_at: il(30) }),  // finie il y a 30 min : disparue
  ]
  const activites = [A('claude/accueil', 'p1', 'ch1', 1), A('claude/seule', 'p2', 'ch2', 2), A('claude/vieille', 'p2', 'ch3', 120)]
  const q = quiTravaille(sessions, taches, activites, [C('ch1', 'p1')], now, SILENCE, ['p2', 'p1'])
  verifie('groupes dans l’ordre des projets demandé (p2 puis p1)', q.map((g) => g.projetId).join(',') === 'p2,p1')
  const p1 = q.find((g) => g.projetId === 'p1')!
  verifie('p1 : une seule session active (la muette sans tâche n’y est pas)', p1.sessions.length === 1 && p1.sessions[0].session.id === 's1')
  const v = p1.sessions[0]
  verifie('libellé « 💬 Session <sujet> » et « répond en ce moment »', v.titre === 'Session Refonte de l’accueil' && v.etat === 'répond en ce moment')
  verifie('ses tâches en cours : 3, celle qui a signalé d’abord', v.taches.length === 3 && v.taches[0].tache.id === 'a1')
  verifie('une tâche finie depuis 3 min reste (repliée), celle d’il y a 30 min disparaît', v.finies.length === 1 && v.finies[0].tache.id === 'f1')
  verifie('la barre de chantier de sa branche lui est rattachée', v.activites.length === 1 && v.activites[0].session === 'claude/accueil')
  const p2 = q.find((g) => g.projetId === 'p2')!
  verifie('p2 : session sans sujet → sa branche ; « attend ton prochain message »', p2.sessions[0].titre === 'Session claude/x' && p2.sessions[0].etat === 'attend ton prochain message')
  verifie('p2 : la barre vivante sans session suivie reste visible à part ; la vieille (2 h) non',
    p2.activitesSeules.length === 1 && p2.activitesSeules[0].session === 'claude/seule')
  const r = resumeTravail(q)
  verifie('résumé : « 3 sessions · 2 agents · 1 commande en cours »', r.texte === '3 sessions · 2 agents · 1 commande en cours', r.texte)
  verifie('session du mode autonome : « 🤖 Session autonome », pas sa longue consigne', titreSession({ id: 'x', sujet: 'Tu es la SESSION AUTONOME du projet cockpit…', branche: null }) === 'Session autonome')
  verifie('session sans sujet ni branche : « Session sans nom (…) », jamais l’id nu', titreSession({ id: '26486ea7-9936-5198', sujet: null, branche: null }) === 'Session sans nom (26486ea7)')
  verifie('filtré sur un projet', quiTravaille(sessions, taches, activites, [], now, SILENCE, [], 'p1').length === 1)
  verifie('personne → aucun groupe, résumé « 0 session en cours »', quiTravaille([], [], [], [], now, SILENCE, []).length === 0 && resumeTravail([]).sessions === 0)
}

// 4. Un agent vivant compte comme preuve de vie d'un chantier.
{
  const ch = C('ch', 'p')
  const vivant = T('ag', 's', 'p', { chantier_id: 'ch', progres_at: il(2), pourcentage: 30, etape: 'Tests' })
  verifie('agent signalé il y a 2 min, lié au chantier → trouvé', agentVivantDuChantier([vivant], 'ch', now, SILENCE)?.id === 'ag')
  verifie('agent jamais signalé → pas une preuve de vie', agentVivantDuChantier([T('m', 's', 'p', { chantier_id: 'ch' })], 'ch', now, SILENCE) === null)
  verifie('agent signalé il y a 40 min → plus une preuve de vie', agentVivantDuChantier([T('v', 's', 'p', { chantier_id: 'ch', progres_at: il(40) })], 'ch', now, SILENCE) === null)
  verifie('une commande (pas un agent) ne compte pas', agentVivantDuChantier([T('c', 's', 'p', { chantier_id: 'ch', progres_at: il(1), type: 'commande' })], 'ch', now, SILENCE) === null)
  const p = presenceDe(ch, [], new Set(), now, SILENCE, [vivant])
  verifie('« Personne dessus » + agent vivant → « 🟢 Un agent y travaille », barre vive', p.presence.code === 'travaille' && p.presence.libelle === 'Un agent y travaille' && p.presence.barreVive, p.presence)
  verifie('…la barre montre l’avancement de l’agent (30 %)', p.activite?.pourcentage === 30)
  verifie('…et il n’y a plus rien à relancer', !p.presence.aRelancer)
  const q = presenceAvecAgent(presenceChantier({ etat: 'a_verifier', pris_par: null, pris_jusqu_a: null, archived_at: null } as never, null, false, now), vivant, now)
  verifie('ce qui t’attend (à vérifier) passe avant l’agent', q.code === 'a_verifier')
  verifie('agent sans pourcentage : présence verte, mais pas de barre inventée', presenceDe(ch, [], new Set(), now, SILENCE, [T('np', 's', 'p', { chantier_id: 'ch', progres_at: il(1) })]).presence.barreVive === false)
}

// 5. Pause sur limite (0010) : visible, en français, jamais comptée comme « au travail ».
{
  const pausee = S('sp', 'p', { vu_at: il(90), pause_raison: 'rate_limit', pause_at: il(80), pause_detail: 'resets 4am' })
  verifie('pause sur limite depuis 80 min → encore affichée (active)', sessionActive(pausee, [], now, SILENCE))
  verifie('pause vieille de 7 h → plus affichée', !sessionActive(S('sv', 'p', { vu_at: il(430), pause_raison: 'rate_limit', pause_at: il(420) }), [], now, SILENCE))
  const q = quiTravaille([pausee], [T('tp', 'sp', 'p', { progres_at: il(1), pourcentage: 20 })], [], [], now, SILENCE, [])
  const v = q[0].sessions[0]
  verifie('« ⏸️ En pause — limite d’usage atteinte (reprend toute seule quand la limite se lève) »', v.etat === 'En pause — limite d’usage atteinte (reprend toute seule quand la limite se lève)' && v.pause === v.etat, v.etat)
  verifie('…avec le détail en petit', v.pauseDetail === 'resets 4am')
  verifie('…et pas comptée « au travail » (ni ses agents)', resumeTravail(q).sessions === 0 && resumeTravail(q).agents === 0 && resumeTravail(q).enPause === 1 && /1 en pause/.test(resumeTravail(q).texte), resumeTravail(q))
  verifie('raison inconnue : dite quand même', libellePause('quota_bizarre') === 'En pause — arrêt (quota_bizarre)' && libellePause('overloaded').includes('surchargés'))
}
bilan('verifier-sessions')
