// L'entonnoir « En ce moment / À toi / À lancer » (src/lib/entonnoir.ts),
// sur deux projets à la fois. Le premier cas rejoue la capture de Raphaël du
// 29 sept. 2026 : FacePro avec des barres « attente » à 85 %, personne dessus.
import { verifie, bilan } from './_assert.ts'
import { enCeMoment, aToi, trierAToi, attenteAToi, GRACE_AVANCE_MS, grouperAToi, aLancer, enCoursSansNouvelles, estEnCoursSansNouvelles, compteursPresence, pastillesProjet, trierParPresence, presenceDe, caAvanceToutSeul, LIBELLE_COURT_PRESENCE, presenceEnMots, repriseReponse, PREFIXE_REPRISE, questionsOuvertesDe } from '../src/lib/entonnoir.ts'
import { tableauDeBord } from '../src/lib/tableauDeBord.ts'
import { MESSAGE_OU_CA_EN_EST, etatVerification } from '../src/lib/presence.ts'

const now = new Date('2026-09-29T01:04:00Z')
const SILENCE = 15 * 60_000
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const dans = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
const C = (id: string, projet: string, etat: string, extra: Record<string, unknown> = {}) => ({
  id, projet_id: projet, section_id: null, titre: id, etat, priorite: 'normale', archived_at: null,
  pris_par: null, pris_jusqu_a: null, updated_at: il(60), created_at: il(600), ...extra,
}) as never
const A = (id: string, projet: string, chantier: string | null, statut: string, minAgo: number, session = 'claude/s', pct = 50) => ({
  id, projet_id: projet, chantier_id: chantier, session, etape: 'étape', pourcentage: pct, eta_secondes: null, statut,
  detail: null, demarre_at: il(minAgo + 10), updated_at: il(minAgo),
}) as never
const M = (id: string, projet: string, chantier: string | null, kind: string, minAgo: number, extra: Record<string, unknown> = {}) => ({
  id, projet_id: projet, chantier_id: chantier, auteur: 's', auteur_type: 'session', kind, corps: `m ${id}`,
  pourquoi: null, options: null, reponse: null, precision: null, repond_a: null, etat: null, answered_at: null, answered_by: null,
  created_at: il(minAgo), ...extra,
}) as never

const chantiers = [
  // FacePro : la capture (en_cours sans réservation, barre « attente » 85 % vieille de 5 h)
  C('fp-bouche', 'fp', 'en_cours'),
  C('fp-objets', 'fp', 'libre', { priorite: 'haute' }),
  C('fp-verif', 'fp', 'a_verifier'),
  C('fp-silence', 'fp', 'en_cours', { pris_par: 'claude/y', pris_jusqu_a: dans(60) }),
  C('fp-vivant', 'fp', 'en_cours', { pris_par: 'claude/x', pris_jusqu_a: dans(60) }),
  C('fp-archive', 'fp', 'libre', { archived_at: il(10) }),
  // Cockpit
  C('ck-cadrer', 'ck', 'a_cadrer'),
  C('ck-bloque', 'ck', 'bloque'),
  C('ck-question', 'ck', 'libre'),
  C('ck-certifie', 'ck', 'valide'),
  C('ck-verif-haute', 'ck', 'a_verifier', { priorite: 'haute', updated_at: il(500) }),
  C('ck-verif', 'ck', 'a_verifier', { updated_at: il(1) }),
  C('ck-libre', 'ck', 'libre'),
]
const activites = [
  A('a1', 'fp', 'fp-bouche', 'attente', 300, 'claude/vieux', 85),
  A('a2', 'fp', 'fp-silence', 'en_cours', 40, 'claude/y'),
  A('a3', 'fp', 'fp-vivant', 'en_cours', 2, 'claude/x'),
  A('a3b', 'fp', 'fp-vivant', 'en_cours', 6, 'claude/x'),     // même session, étape plus ancienne
  A('a4', 'ck', null, 'en_cours', 1, 'claude/z'),              // une session sans chantier
  A('a5', 'ck', 'ck-cadrer', 'en_cours', 120, 'claude/ancien'), // en_cours mais vieille de 2 h
]
const messages = [
  M('q-recente', 'ck', 'ck-question', 'question', 5),
  M('q-ancienne', 'ck', null, 'action', 50),                   // question de projet, sans chantier
  M('q-repondue', 'ck', 'ck-question', 'question', 80, { answered_at: il(70) }),
  M('q-archive', 'fp', 'fp-archive', 'question', 3),          // chantier archivé : hors jeu
  M('b-vieux', 'ck', 'ck-bloque', 'blocage', 90),
  M('b-recent', 'ck', 'ck-bloque', 'blocage', 20),
  M('d-ou', 'fp', 'fp-objets', 'info', 130, { corps: MESSAGE_OU_CA_EN_EST, auteur_type: 'proprietaire' }), // périmée (> 2 h, 0023) : il reste « à lancer »
]

console.log('verifier-entonnoir')

// 1. En ce moment
{
  const l = enCeMoment(activites, chantiers, now, SILENCE)
  verifie('en ce moment : seulement les sessions vivantes (x et z), pas les vieilles ni les « attente »',
    l.map((x) => x.activite.session).sort().join(',') === 'claude/x,claude/z', l.map((x) => x.activite.session))
  verifie('en ce moment : une ligne par session, sa dernière étape', l.filter((x) => x.activite.session === 'claude/x').length === 1 && l.find((x) => x.activite.session === 'claude/x')?.activite.id === 'a3')
  verifie('en ce moment : la plus récente d’abord', l[0].activite.session === 'claude/z')
  verifie('en ce moment : le chantier est retrouvé, ou null sans chantier', l.find((x) => x.activite.session === 'claude/x')?.chantier?.id === 'fp-vivant' && l[0].chantier === null)
  verifie('en ce moment : filtré sur un projet', enCeMoment(activites, chantiers, now, SILENCE, 'fp').map((x) => x.activite.session).join(',') === 'claude/x')
  verifie('en ce moment : la capture du 29/09 (FacePro sans session) → personne', enCeMoment([activites[0]], chantiers, now, SILENCE).length === 0)
  verifie('en ce moment : le délai de silence compte (60 min → la session y revient)',
    enCeMoment(activites, chantiers, now, 60 * 60_000).some((x) => x.activite.session === 'claude/y'))
}

// 2. À toi
{
  const t = aToi(chantiers, messages)
  const types = t.map((e) => e.type)
  // 0022 (Raphaël : « je ne sais pas quelles sont les plus récentes et les plus vieilles ») : un seul tri, le plus récent en haut.
  const dates = t.map((e) => e.depuis)
  verifie('à toi : le plus récent en haut, tous types confondus', dates.every((d, i) => i === 0 || dates[i - 1] >= d), t.map((e) => `${e.cle} ${e.depuis}`))
  verifie('à toi : chaque élément dit depuis quand il attend', t.every((e) => !!e.depuis && !Number.isNaN(new Date(e.depuis).getTime())))
  verifie('à toi : tous les types y sont', ['question', 'a_verifier', 'a_cadrer', 'bloque'].every((x) => types.includes(x as never)), types)
  verifie('à toi : la question récente (5 min) avant l’ancienne (50 min)', t.findIndex((e) => e.message?.id === 'q-recente') < t.findIndex((e) => e.message?.id === 'q-ancienne'))
  const anciens = aToi(chantiers, messages, null, [], [], 'anciens')
  verifie('à toi : tri « plus anciens d’abord » : le plus vieux en haut', anciens.length === t.length && anciens.every((e, i) => i === 0 || anciens[i - 1].depuis <= e.depuis) && anciens[0].depuis < t[0].depuis, anciens.map((e) => e.cle))
  verifie('à toi : trierAToi garde tous les éléments', trierAToi(t, 'anciens').length === t.length)
  verifie('à toi : une question répondue n’y est pas', !t.some((e) => e.message?.id === 'q-repondue'))
  verifie('à toi : la question d’un chantier archivé n’y est pas', !t.some((e) => e.message?.id === 'q-archive'))
  verifie('à toi : la question de projet (sans chantier) y est, chantier null', t.some((e) => e.message?.id === 'q-ancienne' && e.chantier === null))
  const verifs = t.filter((e) => e.type === 'a_verifier').map((e) => e.chantier?.id)
  verifie('à toi : à vérifier, le plus récent d’abord (priorité n’écrase plus l’âge)', JSON.stringify(verifs) === JSON.stringify(['ck-verif', 'fp-verif', 'ck-verif-haute']), verifs)
  const b0 = t.find((e) => e.type === 'bloque')
  verifie('à toi : un bloqué attend depuis son dernier blocage', b0?.depuis === il(20), b0?.depuis)
  const b = t.find((e) => e.type === 'bloque')
  verifie('à toi : un bloqué porte son DERNIER message de blocage', b?.message?.id === 'b-recent')
  verifie('à toi : un certifié n’y est pas', !t.some((e) => e.chantier?.id === 'ck-certifie'))
  verifie('à toi : filtré sur FacePro, seulement FacePro', aToi(chantiers, messages, 'fp').every((e) => e.projetId === 'fp') && aToi(chantiers, messages, 'fp').length === 1)
  const g = grouperAToi(aToi(chantiers, messages, 'fp'))
  verifie('à toi groupé : seuls les groupes non vides', g.length === 1 && g[0].type === 'a_verifier')
  verifie('à toi : vide → rien', aToi([], []).length === 0 && grouperAToi([]).length === 0)
  // Suggestion de fusion (0008) : après les questions, avant « à vérifier » ; une fois tranchée, elle disparaît.
  const avecFusion = aToi(chantiers, [...messages, M('fu', 'ck', 'ck-libre', 'fusion', 30), M('fu-ok', 'ck', 'ck-libre', 'fusion', 40, { answered_at: il(35) })])
  const ordreF = [...new Set(avecFusion.map((e) => e.type))]
  const fu = avecFusion.find((e) => e.type === 'fusion')
  verifie('à toi : la fusion proposée se range à son âge (30 min), comme le reste', fu?.depuis === il(30) && avecFusion.indexOf(fu!) > avecFusion.findIndex((e) => e.message?.id === 'q-recente'), ordreF)
  verifie('à toi : une fusion déjà tranchée n’y est plus', avecFusion.filter((e) => e.type === 'fusion').length === 1)
}

// 3. À lancer
{
  const r = aLancer(chantiers, activites, messages, now, SILENCE, ['ck', 'fp'])
  verifie('à lancer : l’ordre des projets est celui demandé (ck avant fp)', r.map((g) => g.projetId).join(',') === 'ck,fp', r.map((g) => g.projetId))
  verifie('à lancer : l’autre ordre est respecté aussi', aLancer(chantiers, activites, messages, now, SILENCE, ['fp', 'ck']).map((g) => g.projetId).join(',') === 'fp,ck')
  const fp = r.find((g) => g.projetId === 'fp')!
  const ids = fp.lignes.map((l) => l.c.id)
  // 29 sept. : tout ce qui est « en cours » se voit au même endroit, « En ce moment ».
  verifie('à lancer : la capture (en_cours, barre 85 % figée) N’Y EST PLUS : elle est « en cours sans nouvelles »', !ids.includes('fp-bouche') && !ids.includes('fp-silence'), ids)
  verifie('à lancer : ce qui n’a pas commencé (libre, priorité haute) y est', ids.includes('fp-objets'))
  const sn = enCoursSansNouvelles(chantiers, activites, messages, now, SILENCE, ['ck', 'fp']).find((g) => g.projetId === 'fp')!
  const idsSn = sn.lignes.map((l) => l.c.id)
  verifie('en cours sans nouvelles : la silencieuse d’abord, puis la barre figée', JSON.stringify(idsSn) === JSON.stringify(['fp-silence', 'fp-bouche']), idsSn)
  verifie('en cours sans nouvelles : barre GRISE, jamais vive', sn.lignes.every((l) => !l.presence.barreVive))
  verifie('en cours sans nouvelles : un libre sans barre n’y est pas (il est « à lancer »)', !idsSn.includes('fp-objets'))
  verifie('estEnCoursSansNouvelles : silencieux oui, personne+en_cours oui, personne+libre non',
    estEnCoursSansNouvelles({ etat: 'libre' }, { code: 'silencieux' }) && estEnCoursSansNouvelles({ etat: 'en_cours' }, { code: 'personne' }) && !estEnCoursSansNouvelles({ etat: 'libre' }, { code: 'personne' }))
  verifie('à lancer : ni le vivant, ni l’à vérifier, ni l’archivé', !ids.includes('fp-vivant') && !ids.includes('fp-verif') && !ids.includes('fp-archive'))
  verifie('à lancer : « Demandé il y a … » retrouvé', fp.lignes.find((l) => l.c.id === 'fp-objets')?.demandeLe === il(130))
  const ck = r.find((g) => g.projetId === 'ck')
  verifie('à lancer : à cadrer, bloqué, question en attente et certifié n’y sont pas (ils sont « à toi » ou finis)',
    !!ck && ck.lignes.map((l) => l.c.id).join(',') === 'ck-libre', ck?.lignes.map((l) => l.c.id))
  verifie('à lancer : filtré sur un projet', aLancer(chantiers, activites, messages, now, SILENCE, [], 'ck').every((g) => g.projetId === 'ck'))
}

// 4. Compteurs d'une section et pastilles d'onglet
{
  const c = compteursPresence(['personne', 'travaille', 'personne', 'attend_toi'])
  verifie('compteurs : un par code présent, dans l’ordre de lecture (travaille, puis attend ta réponse, puis personne)',
    c.map((x) => `${x.code}${x.n}`).join(' ') === 'travaille1 attend_toi1 personne2', c)
  verifie('compteurs : vide → rien', compteursPresence([]).length === 0)
  const p = pastillesProjet(chantiers, messages, activites, [], [], now, SILENCE, 'fp')
  verifie('pastilles FacePro : 1 session vivante, 1 chose à toi', p.travaillent === 1 && p.aToi === 1, p)
  const tout = pastillesProjet(chantiers, messages, activites, [], [], now, SILENCE, null)
  verifie('pastilles « Tout » : additionne les projets', tout.travaillent === 2 && tout.aToi === aToi(chantiers, messages).length, tout)
}

// 5. Tri d'une liste de section par présence
{
  const liste = ['fp-bouche', 'fp-vivant', 'fp-verif', 'fp-silence'].map((id) => {
    const c = chantiers.find((x: { id: string }) => x.id === id)!
    return { c, presence: presenceDe(c, activites, new Set(), now, SILENCE).presence }
  })
  const ordre = trierParPresence(liste).map((x) => (x.c as { id: string }).id)
  verifie('tri : ce qui bouge, puis à vérifier, puis silencieux, puis personne', JSON.stringify(ordre) === JSON.stringify(['fp-vivant', 'fp-verif', 'fp-silence', 'fp-bouche']), ordre)
}

// 6. Une réponse de Raphaël sur un chantier que personne ne tient (0017) : elle se voit dans « Ça avance »
{
  const cs = [
    C('r-verif', 'ck', 'a_verifier'),
    C('r-bloque', 'ck', 'bloque'),
    C('r-libre', 'ck', 'libre'),
    C('r-reprise', 'ck', 'en_cours', { pris_par: 'agent/reponse-1', pris_jusqu_a: dans(170) }),
    C('r-expiree', 'ck', 'en_cours', { pris_par: 'agent/reponse-2', pris_jusqu_a: il(5), updated_at: il(200) }),
    C('r-suivie', 'ck', 'bloque'),
    C('r-retiree', 'ck', 'bloque'),
    C('r-vieille', 'ck', 'bloque'),
    C('r-valide', 'ck', 'valide'),
    C('r-notee', 'ck', 'bloque'),
  ]
  const ms = [
    M('rq1', 'ck', 'r-verif', 'question', 30, { reponse: 'Ce que je devais vérifier', answered_by: 'u', answered_at: il(20) }),
    M('rq2', 'ck', 'r-bloque', 'question', 60, { reponse: 'Oui, ~0,9 $', answered_by: 'u', answered_at: il(50) }),
    M('rq3', 'ck', 'r-libre', 'action', 60, { reponse: 'Fait', answered_by: 'u', answered_at: il(40) }),
    M('rq4', 'ck', 'r-reprise', 'question', 60, { reponse: 'Oui', answered_by: 'u', answered_at: il(30) }),
    M('ri4', 'ck', 'r-reprise', 'info', 10, { corps: `${PREFIXE_REPRISE} « Oui » : un assistant s’en occupe.` }),
    M('rq5', 'ck', 'r-expiree', 'question', 300, { reponse: 'Oui', answered_by: 'u', answered_at: il(290) }),
    M('ri5', 'ck', 'r-expiree', 'info', 200, { corps: `${PREFIXE_REPRISE} « Oui » : un assistant s’en occupe.` }),
    M('rq6', 'ck', 'r-suivie', 'question', 60, { reponse: 'Oui', answered_by: 'u', answered_at: il(50) }),
    M('ri6', 'ck', 'r-suivie', 'info', 40, { corps: 'Je m’en occupe.' }),
    M('rq7', 'ck', 'r-retiree', 'question', 60, { reponse: 'Retirée par Claude (x) : plus utile', answered_by: 'u', answered_at: il(50) }),
    M('rq8', 'ck', 'r-vieille', 'question', 60 * 24 * 9, { reponse: 'Oui', answered_by: 'u', answered_at: il(60 * 24 * 8) }),
    M('rq9', 'ck', 'r-valide', 'question', 60, { reponse: 'Oui', answered_by: 'u', answered_at: il(50) }),
    M('rq10', 'ck', 'r-notee', 'question', 60, { reponse: 'Dit dans la conversation', answered_at: il(50) }),
  ]
  const r = (id: string, acts: never[] = [], ts: never[] = []) => repriseReponse(cs.find((c: { id: string }) => c.id === id)!, ms, acts, ts, now)
  verifie('réponse sans suite sur un « à vérifier » (le cas du 29/09) → « attend »', r('r-verif') === 'attend')
  verifie('… sur un bloqué, et une action « Fait » sur un libre → « attend »', r('r-bloque') === 'attend' && r('r-libre') === 'attend')
  verifie('reprise par la chef (message « Claude reprend ta réponse », réservé) → « reprise »', r('r-reprise') === 'reprise')
  verifie('reprise mais réservation expirée → plus « reprise » (redevient « sans nouvelles », à relancer)', r('r-expiree') === null)
  verifie('suivie d’un message de session, retirée par Claude, vieille de 8 jours, ou chantier certifié → rien',
    r('r-suivie') === null && r('r-retiree') === null && r('r-vieille') === null && r('r-valide') === null)
  verifie('une réponse notée par une session (answered_by vide, dite dans sa conversation) → rien (0018)', r('r-notee') === null)
  verifie('une étape signalée après la réponse la suit aussi → rien', r('r-verif', [A('ra', 'ck', 'r-verif', 'en_cours', 5)]) === null)
  const ca = caAvanceToutSeul(cs, [], ms, [], [], now, SILENCE)
  const parId = new Map(ca.map((l) => [l.c.id, l]))
  verifie('« Ça avance » montre les réponses en attente et reprises, jamais les autres',
    ['r-verif', 'r-bloque', 'r-libre', 'r-reprise'].every((id) => parId.get(id)?.reprise) && !parId.has('r-suivie') && !parId.has('r-valide'), [...parId.keys()])
  verifie('… en mots simples, sans « Relancer » (pas vivant, pas « sans nouvelles »)',
    parId.get('r-verif')?.pourquoi === 'Ta réponse est reçue : Claude va la reprendre' && parId.get('r-reprise')?.pourquoi === 'Claude reprend ta réponse' && parId.get('r-verif')?.vivant === false)
  verifie('la réservation expirée reste « sans nouvelles » (à relancer)', parId.get('r-expiree')?.reprise == null && parId.get('r-expiree')?.pourquoi === 'Personne dessus', parId.get('r-expiree'))
  const lancer = aLancer(cs, [], ms, now, SILENCE, ['ck']).flatMap((g) => g.lignes.map((l) => l.c.id))
  verifie('un libre dont la réponse attend n’est PAS aussi « à lancer » (pas de doublon)', !lancer.includes('r-libre'), lancer)
}

// 7. « Vérifie pour moi » (29 sept., Raphaël : « je ne vois pas où ce chantier part ») :
// il sort de « À toi » et se voit dans « Ça avance tout seul », compté, sous UN nom partout.
{
  const cv = [
    C('v-demande', 'ck', 'a_verifier', { verif_demandee_at: il(3) }),
    C('v-a-toi', 'ck', 'a_verifier'),
    C('v-verdict', 'ck', 'a_verifier', { verif_demandee_at: null, verdict_at: il(1), verdict_ok: true }),
  ]
  const p = presenceDe(cv[0], [], new Set(), now, SILENCE).presence
  verifie('vérifie pour moi : présence « Claude vérifie pour toi », rien à faire', p.code === 'claude_verifie' && p.libelle === 'Claude vérifie pour toi' && /Rien à faire/.test(p.tonAction ?? ''), p)
  verifie('vérifie pour moi : même libellé court (liste, en-tête de conversation)', LIBELLE_COURT_PRESENCE.claude_verifie === 'Claude vérifie pour toi' && presenceEnMots(p, null) === 'Claude vérifie pour toi')
  const ilY = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  const fut = new Date(now.getTime() + 3_600_000).toISOString()
  verifie('vérifie pour moi : dit pourquoi ça attend (fraîche / pas encore prise / prise par X)',
    /quelques minutes/.test(etatVerification({ pris_par: null, pris_jusqu_a: null, verif_demandee_at: ilY(2) }, now))
    && /pas encore prise/.test(etatVerification({ pris_par: null, pris_jusqu_a: null, verif_demandee_at: ilY(90) }, now))
    && /prise par agent\/verif-1/.test(etatVerification({ pris_par: 'agent/verif-1', pris_jusqu_a: fut, verif_demandee_at: ilY(90) }, now)))
  const t = aToi(cv, [])
  verifie('vérifie pour moi : pas dans « À toi » ; les deux autres y sont', !t.some((e) => e.chantier?.id === 'v-demande') && t.length === 2, t.map((e) => e.chantier?.id))
  const l = caAvanceToutSeul(cv, [], [], [], [], now, SILENCE)
  const ligne = l.find((x) => x.c.id === 'v-demande')
  verifie('vérifie pour moi sans assistant vivant : ni barre ni vivant (30/09), en attente d’un assistant',
    l.length === 1 && !!ligne && !ligne.vivant && !ligne.activite && ligne.pourquoi === 'Vérification demandée : en attente d’un assistant', l)
  const tb = tableauDeBord({ chantiers: cv, messages: [], activites: [], sessions: [], taches: [] }, now, SILENCE, '7j', ['ck'])
  verifie('vérifie pour moi sans assistant : PAS dans « ça avance » (0), compté « en attente », pas dans « pour toi » (2)', tb.tuiles.caAvance === 0 && tb.tuiles.enPause === 1 && tb.tuiles.pourToi === 2, tb.tuiles)
  // Un agent de vérification vivant ne change pas le nom (il reste « Claude vérifie pour toi »), sa barre s'affiche.
  const agent = { id: 't1', projet_id: 'ck', chantier_id: 'v-demande', type: 'agent', statut: 'en_cours', vu_at: il(1), progres_at: il(1), pourcentage: 40, etape: 'compare à la source', description: 'vérif' } as never
  const la = caAvanceToutSeul(cv, [], [], [], [agent], now, SILENCE).find((x) => x.c.id === 'v-demande')
  verifie('vérifie pour moi + agent vivant : même nom, sa barre et son étape', la?.vivant === true && la?.presence.code === 'claude_verifie' && la.activite?.pourcentage === 40 && la.etape === 'compare à la source', la)
  // Le verdict rendu (verif_demandee_at remis à null) : de retour dans « À toi ».
  verifie('verdict rendu : de retour dans « À toi », hors de « Ça avance »', t.some((e) => e.chantier?.id === 'v-verdict') && !l.some((x) => x.c.id === 'v-verdict'))
  const ordre = trierParPresence([{ c: cv[1], presence: presenceDe(cv[1], [], new Set(), now, SILENCE).presence }, { c: cv[0], presence: p }]).map((x) => (x.c as { id: string }).id)
  verifie('tri : « Claude vérifie » avant « à vérifier »', ordre[0] === 'v-demande', ordre)
}

// 0022. « À toi » à jour (Raphaël, 29 sept. : « des requêtes d'il y a 12 h déjà réglées dans la session ») :
// tout élément sur lequel Claude a travaillé depuis est marqué et passe en bas ; reconfirmé, il redevient normal.
{
  const cs = [
    C('z-bloque', 'ck', 'bloque'),
    C('z-verif', 'ck', 'a_verifier', { livre_at: il(600) }),
    C('z-verif-grace', 'ck', 'a_verifier', { livre_at: il(300) }),
    C('z-cadrer-revu', 'ck', 'a_cadrer', { updated_at: il(900), a_toi_revu_at: il(10) }),
    C('z-question', 'ck', 'libre'),
  ]
  const ms = [
    M('zb', 'ck', 'z-bloque', 'blocage', 780),                // bloqué il y a 13 h…
    M('zb-apres', 'ck', 'z-bloque', 'info', 200),              // …et une session a travaillé dessus depuis
    M('zv-fin', 'ck', 'z-verif-grace', 'info', 299),           // le message de livraison lui-même (1 min après) : pas « avancé »
    M('zq', 'ck', 'z-question', 'question', 720),
    M('zq-conf', 'ck', 'z-question', 'question', 30),          // une autre question, récente
  ]
  const act = [A('za', 'ck', 'z-verif', 'en_cours', 100, 'claude/w')]
  const t = aToi(cs, ms, null, act)
  const el = (cle: string) => t.find((e) => e.cle === cle)!
  verifie('à jour : un bloqué suivi de travail → « avancé depuis »', el('bloque-z-bloque').avanceDepuis === il(200) && /travaillé dessus .* peut-être déjà réglé/.test(attenteAToi(el('bloque-z-bloque'), now)))
  verifie('à jour : un « à vérifier » retravaillé après la livraison → « avancé depuis »', el('a_verifier-z-verif').avanceDepuis === il(100))
  verifie(`à jour : le message de livraison (moins de ${GRACE_AVANCE_MS / 60_000} min après) ne compte pas`, !el('a_verifier-z-verif-grace').avanceDepuis)
  verifie('à jour : revu par une session (a_toi_revu_at) → son âge repart de là', el('a_cadrer-z-cadrer-revu').depuis === il(10) && !el('a_cadrer-z-cadrer-revu').avanceDepuis)
  const dep = t.map((e) => !!e.avanceDepuis)
  verifie('à jour : les « peut-être plus à jour » en bas de la liste', dep.indexOf(true) > dep.lastIndexOf(false), t.map((e) => e.cle))
  verifie('à jour : en bas aussi en tri « anciens »', (() => { const d = aToi(cs, ms, null, act, [], 'anciens').map((e) => !!e.avanceDepuis); return d.indexOf(true) > d.lastIndexOf(false) })())
  const conf = aToi(cs, ms.map((m) => (m as { id: string }).id === 'zb' ? { ...(m as object), created_at: il(150) } as never : m), null, act)
  verifie('à jour : un nouveau blocage après le travail → plus marqué', !conf.find((e) => e.cle === 'bloque-z-bloque')?.avanceDepuis)
  const q = t.find((e) => e.message?.id === 'zq')!
  verifie('à jour : une question confirmée (confirmee_at) a l’âge de sa confirmation', aToi(cs, ms.map((m) => (m as { id: string }).id === 'zq' ? { ...(m as object), confirmee_at: il(5) } as never : m)).find((e) => e.message?.id === 'zq')?.depuis === il(5) && q.depuis === il(720))
}

// Certifier ne ferme pas une question ouverte (0026) : « Ça marche » la montre d'abord.
{
  console.log('\nquestions ouvertes d’un chantier (certifier les montre d’abord)')
  const ms = [
    M('qo2', 'ck', 'cv', 'question', 10), M('qo1', 'ck', 'cv', 'action', 30),
    M('qr', 'ck', 'cv', 'question', 40, { answered_at: il(5), reponse: 'Oui' }),
    M('qret', 'ck', 'cv', 'question', 50, { answered_at: il(5), reponse: 'Retirée par Claude : plus utile' }),
    M('fu', 'ck', 'cv', 'fusion', 20), M('inf', 'ck', 'cv', 'info', 15), M('autre', 'ck', 'autre', 'question', 5),
  ]
  const ids = questionsOuvertesDe('cv', ms).map((m) => (m as { id: string }).id)
  verifie('questions ouvertes : question et action non répondues, la plus ancienne d’abord', JSON.stringify(ids) === '["qo1","qo2"]', ids)
  verifie('questions ouvertes : ni répondue, ni retirée, ni fusion, ni autre chantier', !ids.some((i) => ['qr', 'qret', 'fu', 'inf', 'autre'].includes(i)))
  verifie('questions ouvertes : aucune → on certifie directement', questionsOuvertesDe('rien', ms).length === 0)
  // Et une question d'un chantier CERTIFIÉ reste dans « À toi » (la base ne la ferme plus).
  // certifier_chantier pose aussi archived_at (« Fini ») : c'est le cas réel.
  const t = aToi([C('cv', 'ck', 'valide', { archived_at: il(1) }), C('ar', 'ck', 'libre', { archived_at: il(1) })],
    [M('qv', 'ck', 'cv', 'question', 10), M('qa', 'ck', 'ar', 'question', 10)])
  verifie('« À toi » : une question ouverte d’un chantier certifié (donc archivé « Fini ») y reste', t.some((e) => e.message?.id === 'qv'), t.map((e) => e.cle))
  verifie('« À toi » : celle d’un chantier archivé sans être certifié n’y est pas', !t.some((e) => e.message?.id === 'qa'))
}

bilan('verifier-entonnoir')
