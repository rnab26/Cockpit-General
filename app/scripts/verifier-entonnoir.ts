// L'entonnoir « En ce moment / À toi / À lancer » (src/lib/entonnoir.ts),
// sur deux projets à la fois. Le premier cas rejoue la capture de Raphaël du
// 29 sept. 2026 : FacePro avec des barres « attente » à 85 %, personne dessus.
import { verifie, bilan } from './_assert.ts'
import { enCeMoment, aToi, grouperAToi, aLancer, enCoursSansNouvelles, estEnCoursSansNouvelles, compteursPresence, pastillesProjet, trierParPresence, presenceDe } from '../src/lib/entonnoir.ts'
import { MESSAGE_OU_CA_EN_EST } from '../src/lib/presence.ts'

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
  M('d-ou', 'fp', 'fp-objets', 'info', 7, { corps: MESSAGE_OU_CA_EN_EST }),
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
  verifie('à toi : ordre questions → à vérifier → à cadrer → bloqués',
    JSON.stringify([...new Set(types)]) === JSON.stringify(['question', 'a_verifier', 'a_cadrer', 'bloque']), types)
  verifie('à toi : les questions, la plus ancienne d’abord (elle attend depuis le plus longtemps)', t[0].message?.id === 'q-ancienne' && t[1].message?.id === 'q-recente')
  verifie('à toi : une question répondue n’y est pas', !t.some((e) => e.message?.id === 'q-repondue'))
  verifie('à toi : la question d’un chantier archivé n’y est pas', !t.some((e) => e.message?.id === 'q-archive'))
  verifie('à toi : la question de projet (sans chantier) y est, chantier null', t.some((e) => e.message?.id === 'q-ancienne' && e.chantier === null))
  const verifs = t.filter((e) => e.type === 'a_verifier').map((e) => e.chantier?.id)
  verifie('à toi : à vérifier, priorité haute d’abord puis le plus récent', JSON.stringify(verifs) === JSON.stringify(['ck-verif-haute', 'ck-verif', 'fp-verif']), verifs)
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
  verifie('à toi : la fusion proposée se place après les questions, avant « à vérifier »', ordreF.indexOf('fusion') === ordreF.indexOf('question') + 1 && ordreF.indexOf('fusion') < ordreF.indexOf('a_verifier'), ordreF)
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
  verifie('à lancer : « Demandé il y a … » retrouvé', fp.lignes.find((l) => l.c.id === 'fp-objets')?.demandeLe === il(7))
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

bilan('verifier-entonnoir')
