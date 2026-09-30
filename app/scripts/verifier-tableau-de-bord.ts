// Le tableau de bord (modèle A, 29 sept. 2026) : les quatre tuiles sont les
// longueurs des trois listes (+ fini), « Ça avance tout seul » est une ligne
// par CHANTIER avec la présence honnête, et le tableau par section compte les
// mêmes chantiers que les tuiles (une seule règle).
import { verifie, bilan } from './_assert.ts'
import { tableauDeBord, classesDe } from '../src/lib/tableauDeBord.ts'
import { attenteAToi, presenceEnMots, VERBE_A_TOI } from '../src/lib/entonnoir.ts'
import { ouJenSuis } from '../src/lib/ouJenSuis.ts'
import { nomSession } from '../src/lib/sessions.ts'
import { presenceChantier } from '../src/lib/presence.ts'

const now = new Date('2026-09-29T09:00:00Z')
const SILENCE = 15 * 60_000
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const dans = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
const C = (id: string, etat: string, extra: Record<string, unknown> = {}) => ({
  id, projet_id: 'p', section_id: 'S', titre: id, etat, priorite: 'normale', archived_at: null, jalons: null,
  pris_par: null, pris_jusqu_a: null, valide_at: null, updated_at: il(60), created_at: il(600), ...extra,
}) as never
const A = (id: string, chantier: string | null, minAgo: number, session: string, pct = 50, eta: number | null = null) => ({
  id, projet_id: 'p', chantier_id: chantier, session, etape: `étape ${id}`, pourcentage: pct, eta_secondes: eta, statut: 'en_cours',
  detail: null, demarre_at: il(minAgo + 10), updated_at: il(minAgo),
}) as never
const S = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projet_id: 'p', branche: null, sujet: null, tour_en_cours: false, demarre_at: il(120), vu_at: il(1), fin_at: null,
  pause_raison: null, pause_at: null, pause_detail: null, relances: 0, ...extra,
}) as never
const T = (id: string, session: string, chantier: string | null, extra: Record<string, unknown> = {}) => ({
  id, session_id: session, projet_id: 'p', tache_id: id, type: 'agent', description: `agent ${id}`, sorte: null, statut: 'en_cours',
  chantier_id: chantier, etape: null, pourcentage: null, eta_secondes: null, progres_at: null, demarre_at: il(20), vu_at: il(1), fini_at: null, ...extra,
}) as never
const M = (id: string, chantier: string | null, kind: string, extra: Record<string, unknown> = {}) => ({
  id, projet_id: 'p', chantier_id: chantier, auteur: 's', auteur_type: 'session', kind, corps: `m ${id}`, pourquoi: null, options: null,
  reponse: null, precision: null, repond_a: null, etat: null, answered_at: null, answered_by: null, created_at: il(30), ...extra,
}) as never

const chantiers = [
  C('vivant', 'en_cours', { pris_par: 'claude/auto-abc123', pris_jusqu_a: dans(60) }),
  C('agent-pct', 'en_cours'),
  C('agent-muet', 'en_cours'),
  C('silencieux', 'en_cours', { pris_par: 'claude/x', pris_jusqu_a: dans(60) }),
  C('personne', 'en_cours'),
  C('libre', 'libre'),
  C('a-trier', 'a_trier'),
  C('question', 'libre'),
  C('verif-en-ligne', 'a_verifier', { jalons: { en_ligne: { at: il(10), detail: null } } }),
  C('verif-sans-jalon', 'a_verifier'),
  C('cadrer', 'a_cadrer'),
  C('bloque', 'bloque'),
  C('reporte', 'reporte'),
  C('fini', 'valide', { valide_at: il(30) }),
  C('fini-vieux', 'valide', { valide_at: il(60 * 24 * 3) }),
  C('archive', 'libre', { archived_at: il(5) }),
  // FacePro, 29 sept. : des agents travaillent sur un chantier qui attend AUSSI Raphaël.
  C('agent-question', 'en_cours', { pris_par: 'claude/levers', pris_jusqu_a: dans(60) }),
  C('agent-bloque', 'bloque', { pris_par: 'claude/talons', pris_jusqu_a: dans(60) }),
  // 0015 : agent listé en cours par une session VIVANTE, sans étape depuis 40 min.
  C('agent-sans-etape', 'en_cours'),
  // 0016 : « vérifie pour moi » en cours (hors « à toi »), puis verdict « c'est bon ».
  C('verif-demandee', 'a_verifier', { verif_demandee_at: il(5) }),
  // 30 sept. (3f879a19) : « vérifie pour moi » demandé, MAIS aucun assistant dessus = il attend Claude.
  C('verif-agent', 'a_verifier', { verif_demandee_at: il(5) }),
  C('verif-verdict', 'a_verifier', { verdict_at: il(2), verdict_ok: true, verdict_texte: 'OK' }),
]
const activites = [
  A('a1', 'vivant', 1, 'claude/auto-abc123', 60, 2700),
  A('a2', 'agent-muet', 300, 'claude/vieille', 85),       // vieille barre : ne doit pas passer pour vivante
  A('a3', 'silencieux', 120, 'claude/x', 30),
  A('a4', 'libre', 300, 'claude/ancien', 20),
]
const sessions = [
  S('s-auto', { branche: 'claude/auto-abc123', sujet: 'Tu es la SESSION AUTONOME du projet cockpit…' }),
  S('s-hors', { branche: 'claude/hors-xyz789', sujet: 'Ranger la doc', tour_en_cours: true }),
  S('s-pause', { sujet: 'Longue mesure', vu_at: il(90), pause_raison: 'rate_limit', pause_at: il(80) }),
  S('s-agents', { branche: 'claude/agents' }),
]
const taches = [
  T('t1', 's-agents', 'agent-pct', { pourcentage: 5, eta_secondes: 3360, etape: 'fusion main + preuves', progres_at: il(1) }),
  T('t2', 's-agents', 'agent-muet', { etape: 'lecture du code', progres_at: il(2) }),
  T('t3', 's-agents', 'agent-question', { pourcentage: 35, etape: 'diagnostic', progres_at: il(2) }),
  T('t4', 's-agents', 'agent-bloque', { pourcentage: 20, etape: 'banc objets', progres_at: il(3) }),
  T('t6', 's-agents', 'verif-agent', { pourcentage: 40, etape: 'compare à la source', progres_at: il(1) }),
  T('t5', 's-agents', 'agent-sans-etape', { etape: 'lecture', progres_at: il(40), vu_at: il(1) }),
]
const messages = [
  M('q', 'question', 'question'),
  M('q2', 'agent-question', 'question'),
  M('b', 'bloque', 'blocage', { corps: 'Il manque la clé RunPod dans les variables d’environnement du projet' }),
]
const d = { chantiers, messages, activites, sessions, taches }

console.log('verifier-tableau-de-bord')
const t = tableauDeBord(d, now, SILENCE, 'aujourdhui', ['p'], null)
const ids = (l: { c: { id: string } }[]) => l.map((x) => x.c.id)

// 1. Les tuiles = les longueurs des listes
verifie('tuiles = longueurs des listes (pour toi, ça avance, en pause, fini)',
  t.tuiles.pourToi === t.aToi.length && t.tuiles.caAvance === t.caAvance.length && t.tuiles.enPause === t.pretALancer.length + t.sansSession.length && t.tuiles.fini === t.fini.length, t.tuiles)
verifie('pour toi : 2 questions, à vérifier ×3, à cadrer, 2 bloqués (8) — sans le « vérifie pour moi » en cours', t.tuiles.pourToi === 8 && !t.aToi.some((e) => e.chantier?.id === 'verif-demandee'), t.aToi.map((e) => e.cle))
verifie('0016 : après le verdict « c’est bon », la ligne dit de confirmer d’un toucher', /c’est bon, confirme/.test(attenteAToi(t.aToi.find((e) => e.chantier?.id === 'verif-verdict')!, now)))
verifie('fini : seulement le certifié du jour', t.fini.map((c) => c.id).join(',') === 'fini', t.fini.map((c) => c.id))

// 2. Ça avance tout seul : par chantier, présence honnête
const ca = new Map([...t.caAvance, ...t.sansSession].map((l) => [l.c.id, l]))
verifie('ça avance : vivant, cinq agents, « Claude vérifie pour toi », silencieux, personne — ni libre, ni reporté, ni archivé',
  ['vivant', 'agent-pct', 'agent-muet', 'agent-question', 'agent-bloque', 'agent-sans-etape', 'verif-demandee', 'verif-agent', 'silencieux', 'personne'].every((id) => ca.has(id)) && t.caAvance.length + t.sansSession.length === 10, ids([...t.caAvance, ...t.sansSession]))
// 30 sept. 2026, Raphaël (chantier 3f879a19) : « il y a 10 choses qui avancent alors qu'elles sont à l'arrêt […]
// dans ce qui avance uniquement quand il y a une barre active […] sinon c'est de la fausse information. »
verifie('« ça avance » = SEULEMENT ce qui a une preuve de vie ; silencieux et personne dessus sont dans « sans session », comptés « en pause »',
  t.caAvance.length === 7 && t.caAvance.every((l) => l.vivant) && ids(t.sansSession).join(',') === 'verif-demandee,silencieux,personne' && t.sansSession.every((l) => !l.vivant)
  && t.tuiles.caAvance === 7 && t.tuiles.enPause === t.pretALancer.length + 3, { ca: ids(t.caAvance), sans: ids(t.sansSession), tuiles: t.tuiles })
verifie('« vérifie pour moi » AVEC un assistant dessus : dans « ça avance », vivant, sous le nom « Claude vérifie pour toi »',
  ca.get('verif-agent')?.vivant === true && ca.get('verif-agent')?.qui === 'Claude vérifie pour toi' && ca.get('verif-agent')?.presence.code === 'claude_verifie', ca.get('verif-agent'))
// Cas de Raphaël (30 sept., 14:37) : « le 8e chantier en cours n'a pas de barre, il attend un retour de Claude, donc ne travaille pas ».
verifie('« vérifie pour moi » SANS personne dessus : « en attente de Claude », dans en attente, jamais dans « ça avance », sans barre',
  ca.get('verif-demandee')?.vivant === false && !t.caAvance.some((l) => l.c.id === 'verif-demandee') && t.sansSession.some((l) => l.c.id === 'verif-demandee')
  && /^En attente de Claude/.test(ca.get('verif-demandee')?.pourquoi ?? '') && ca.get('verif-demandee')?.activite === null, ca.get('verif-demandee'))
verifie('0015 : un agent sans étape depuis 40 min mais listé en cours par une session vivante reste « en cours »', ca.get('agent-sans-etape')?.vivant === true, ca.get('agent-sans-etape'))
const qDepassee = t.aToi.find((e) => e.cle === 'q-q2'), qNeuve = t.aToi.find((e) => e.cle === 'q-q')
verifie('0015 : une question que du travail a suivie est marquée « Claude a avancé depuis », pas une question sans suite',
  !!qDepassee?.avanceDepuis && /travaillé dessus/.test(attenteAToi(qDepassee!, now)) && !qNeuve?.avanceDepuis, [qDepassee?.avanceDepuis, qNeuve?.avanceDepuis])
verifie('un agent vivant sur un chantier qui attend ta réponse (ou bloqué) est dans « ça avance » ET dans « à toi »',
  ca.get('agent-question')?.vivant && ca.get('agent-bloque')?.vivant && ca.get('agent-question')?.activite?.pourcentage === 35
  && t.aToi.some((e) => e.chantier?.id === 'agent-question') && t.aToi.some((e) => e.chantier?.id === 'agent-bloque'), [ca.get('agent-question'), ca.get('agent-bloque')])
verifie('ordre : les vivants d’abord (Claude qui vérifie après ceux qui codent), puis silencieux, puis personne',
  t.caAvance[6].c.id === 'verif-agent' && ids(t.sansSession).join(',') === 'verif-demandee,silencieux,personne', ids([...t.caAvance, ...t.sansSession]))
const v = ca.get('vivant')!
verifie('mode autonome : « Claude, en autonomie », sa barre et son étape', v.vivant && v.qui === 'Claude, en autonomie' && v.activite?.pourcentage === 60 && v.etape === 'étape a1', v)
const ap = ca.get('agent-pct')!
verifie('assistant qui a signalé un % : « 1 assistant de Claude », sa barre (5 %), son étape', ap.vivant && ap.qui === '1 assistant de Claude' && ap.activite?.pourcentage === 5 && ap.etape === 'fusion main + preuves', ap)
const am = ca.get('agent-muet')!
verifie('agent vivant SANS % : vivant, mais AUCUNE barre (pas la vieille de 85 %)', am.vivant && am.activite === null && am.etape === 'lecture du code', am)
verifie('réservé mais muet : « Plus de nouvelles », dit pourquoi, barre grise d’avant', !ca.get('silencieux')!.vivant && ca.get('silencieux')!.pourquoi === 'Plus de nouvelles' && ca.get('silencieux')!.activite?.pourcentage === 30)
verifie('en cours sans personne : « Personne dessus »', ca.get('personne')!.pourquoi === 'Personne dessus')

// 3. Prêt à lancer
verifie('prêt à lancer : libre et à trier, pas la question en attente ni l’en cours', ids(t.pretALancer).sort().join(',') === 'a-trier,libre', ids(t.pretALancer))

// 4. Hors chantier
const hc = t.horsChantier.map((h) => h.texte)
verifie('hors chantier : la session qui répond sans chantier', hc.includes('Claude travaille sur autre chose (« Ranger la doc »)'), hc)
verifie('hors chantier : la session en pause le dit, sans emoji', hc.some((x) => x.startsWith('Claude (« Longue mesure ») en pause — limite d’usage atteinte')), hc)
verifie('hors chantier : ni la session autonome (elle est sur « vivant »), ni celle des agents', !hc.some((x) => /autonome/.test(x)) && t.horsChantier.length === 2, hc)

// 5. Le tableau par section compte les MÊMES chantiers que les tuiles
const r = ouJenSuis([{ id: 'S', nom: 'S', position: 0, projet_id: 'p', cle: 'S', description: null, created_at: '' }], chantiers, messages, 'aujourdhui', now, classesDe(t))
verifie('tableau par section = tuiles (pour toi, ça avance, en pause, fini)',
  r.total.pourToi === t.tuiles.pourToi && r.total.bouge === t.tuiles.caAvance && r.total.dort === t.tuiles.enPause && r.total.livre === t.tuiles.fini, { total: r.total, tuiles: t.tuiles })
verifie('filtré sur un projet inconnu : tout à zéro', Object.values(tableauDeBord(d, now, SILENCE, 'aujourdhui', ['p'], 'autre').tuiles).every((n) => n === 0))

// 6. En mots simples
const el = (id: string) => t.aToi.find((e) => e.chantier?.id === id)!
verifie('question → « Claude te pose une question » · Répondre', attenteAToi(el('question'), now) === 'Claude te pose une question' && VERBE_A_TOI.question === 'Répondre')
verifie('à vérifier en ligne → « en ligne, à tester » · Tester', attenteAToi(el('verif-en-ligne'), now) === 'en ligne, à tester' && VERBE_A_TOI.a_verifier === 'Tester')
verifie('à vérifier sans jalon → « livré, à tester »', attenteAToi(el('verif-sans-jalon'), now) === 'livré, à tester')
verifie('à cadrer → « ta décision avant de coder » · Décider', attenteAToi(el('cadrer'), now) === 'ta décision avant de coder' && VERBE_A_TOI.a_cadrer === 'Décider')
verifie('bloqué → « bloqué : <ce qui bloque> » · Débloquer', attenteAToi(el('bloque'), now).startsWith('bloqué : Il manque la clé RunPod') && VERBE_A_TOI.bloque === 'Débloquer')
verifie('fusion → Trancher', VERBE_A_TOI.fusion === 'Trancher')
verifie('en-tête : « Claude y travaille — 60 % »', presenceEnMots(v.presence, v.activite) === 'Claude y travaille — 60 %')
verifie('en-tête : « Un agent y travaille », sans % inventé', presenceEnMots(am.presence, am.activite) === 'Un agent y travaille')
verifie('en-tête : « personne dessus »', presenceEnMots(presenceChantier(chantiers[5], null, false, now), null) === 'personne dessus')
verifie('aucun emoji dans les mots de l’écran', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test([...hc, ...t.aToi.map((e) => attenteAToi(e, now)), ...t.caAvance.concat(t.sansSession).map((l) => `${l.qui} ${l.pourquoi ?? ''} ${l.presence.libelle}`)].join(' ')))

// 7. Le nom court d'une session
verifie('nom de session : autonome / sujet coupé / branche sans claude/ / jamais l’id nu',
  nomSession({ id: 'x', sujet: 'Tu es la SESSION AUTONOME du projet', branche: 'b' }) === 'autonome'
  && nomSession({ id: 'x', sujet: 'Une phrase beaucoup trop longue pour tenir sur la ligne', branche: null }).endsWith('…')
  && nomSession({ id: 'x', sujet: null, branche: 'claude/ecran-a-plus-d-qldenz' }) === 'ecran-a-plus-d'
  && nomSession({ id: '26486ea7-99', sujet: null, branche: null }) === 'sans nom (26486ea7)')

bilan('verifier-tableau-de-bord')
