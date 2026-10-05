// Le fil = une discussion (0025) : ordre, carte à choisir en dernier, réponse attendue.
// node --experimental-strip-types app/scripts/verifier-discussion.ts
import { verifie, bilan } from './_assert.ts'
import { separerChat, attenteReponse, derniereAction, estMessageLibre, filLie, ordreDuFil, DELAI_PRISE_MS } from '../src/lib/discussion.ts'
import type { Message } from '../src/lib/types.ts'

const T0 = Date.parse('2026-09-29T14:00:00Z')
const t = (min: number) => new Date(T0 + min * 60_000).toISOString()
let n = 0
const msg = (o: Partial<Message>): Message => ({
  id: `m${++n}`, projet_id: 'P', chantier_id: 'C', auteur: 'x', auteur_type: 'proprietaire', kind: 'info', corps: 'Bonjour',
  pourquoi: null, options: null, reponse: null, precision: null, repond_a: null, etat: null, answered_at: null, answered_by: null,
  created_at: t(0), medias: [], ...o,
})
const claude = (min: number, corps = 'Réponse de Claude') => msg({ auteur_type: 'session', created_at: t(min), corps })
const moi = (min: number, corps = 'Je n’ai pas compris ta demande', o: Partial<Message> = {}) => msg({ created_at: t(min), corps, ...o })

console.log('ordre du fil')
const q = msg({ auteur_type: 'session', kind: 'question', corps: 'Version courte ?', created_at: t(1) })
const f = [moi(5, 'Pourquoi ?'), q, claude(3), msg({ auteur_type: 'session', kind: 'fusion', corps: 'Fusion', created_at: t(2) }), moi(0, 'Au début')]
const o = ordreDuFil(f)
verifie('historique chronologique, le plus récent en bas', o.historique.map((m) => m.corps).join('|') === 'Au début|Réponse de Claude|Pourquoi ?', o.historique.map((m) => m.corps))
verifie('la question ouverte et la fusion proposée vont TOUT EN BAS (après mon dernier message)', o.aChoisir.map((m) => m.kind).join('|') === 'question|fusion', o.aChoisir)
const repondue = { ...q, answered_at: t(4), reponse: 'Oui' }
verifie('une question répondue reste à sa place dans l’historique', ordreDuFil([repondue, moi(5)]).historique[0].id === q.id && ordreDuFil([repondue]).aChoisir.length === 0)

console.log('message libre (même règle que cockpit.est_message_libre)')
verifie('mon message « Écrire à Claude » attend une réponse', estMessageLibre(moi(0), []))
verifie('un utilisateur final aussi', estMessageLibre(moi(0, 'x', { auteur_type: 'utilisateur' }), []))
verifie('un message de Claude, non', !estMessageLibre(claude(0), []))
verifie('« Ça ne marche pas : … » (Corriger) attend une réponse', estMessageLibre(moi(0, 'Ça ne marche pas : le bouton', { kind: 'constat' }), []))
verifie('« Ça fonctionne, je certifie » non (bouton, servi ailleurs)', !estMessageLibre(moi(0, 'Ça fonctionne, je certifie.', { kind: 'constat' }), []))
verifie('« vérifie pour moi » non (un agent rend un verdict)', !estMessageLibre(moi(0, 'Je ne sais pas dire si c’est bon : vérifie pour moi.', { kind: 'constat' }), []))
verifie('« Où ça en est ? » non (sa propre voie)', !estMessageLibre(moi(0, 'Où ça en est', { ou_en_est: true }), []))
verifie('fusion de doublon non', !estMessageLibre(moi(0, 'Doublon fusionné : « X »'), []))
verifie('écrit dans une session Claude (0027) : non, la session y a déjà répondu', !estMessageLibre(moi(0, 'Ajoute un filtre', { via_session: true }), []))
verifie('… et il ne déclenche pas « réponse en attente »', attenteReponse([claude(0), moi(1, 'Ajoute un filtre', { via_session: true })], { maintenant: T0 + 5 * 60_000, sessionTient: true, prochainPassage: null }) === null)
const qr = msg({ auteur_type: 'session', kind: 'question', created_at: t(0), answered_at: t(10) })
const media = { chemin: 'a', nom: 'a.png', type: 'image/png', taille: 1 }
verifie('les photos jointes à une réponse de question : servies avec la réponse', !estMessageLibre(moi(10.5, '1 photo', { medias: [media] }), [qr]))
verifie('une photo envoyée seule, plus tard : elle attend une réponse', estMessageLibre(moi(30, '1 photo', { medias: [media] }), [qr]))

console.log('réponse attendue')
const M = T0 + 20 * 60_000
const base = { maintenant: M, sessionTient: false, prochainPassage: null }
verifie('rien écrit → rien n’attend', attenteReponse([claude(0)], base) === null)
verifie('Claude a répondu après mon message → rien n’attend', attenteReponse([moi(1), claude(2)], base) === null)
verifie('une étape ne compte pas, seul un message de Claude : sans lui, ça attend', attenteReponse([claude(0), moi(1)], base)?.nombre === 1)
const deux = attenteReponse([claude(0), moi(1), moi(3)], base)
verifie('deux messages sans réponse : depuis le premier', deux?.nombre === 2 && deux.depuis === t(1), deux)
verifie('personne, aucune chef → « ouvre Claude Code sur ce projet »', deux?.etat === 'personne' && /ouvre Claude Code/.test(deux.detail), deux)
const att = attenteReponse([moi(1)], { ...base, prochainPassage: t(68) })
verifie('une chef a un réveil → « Prochain passage de Claude vers … »', att?.etat === 'attente' && /Prochain passage de Claude vers \d+ h 08/.test(att.detail), att)
verifie('réveil déjà passé → « dans l’heure »', /dans l’heure/.test(attenteReponse([moi(1)], { ...base, prochainPassage: t(10) })?.detail ?? ''))
const tard = attenteReponse([moi(1)], { maintenant: T0 + 45 * 60_000, sessionTient: false, prochainPassage: t(68) })
verifie('sans réponse depuis 30 min malgré un « prochain passage » → on dit que le réveil a échoué', tard?.etat === 'personne' && /n’a pas abouti/.test(tard.detail), tard)
verifie('une session tient le chantier → elle le verra à son prochain pas', attenteReponse([moi(1)], { ...base, sessionTient: true })?.etat === 'session')
verifie('remis à la session (reçu) → « Claude a reçu ton message »', attenteReponse([moi(1, 'x', { recu_at: t(2), recu_par: 'claude/x' })], base)?.titre === 'Claude a reçu ton message')
const prise = attenteReponse([moi(1, 'x', { recu_at: t(2), recu_par: 'agent/message-1' })], base)
verifie('pris par un assistant → « Un assistant prépare la réponse »', prise?.etat === 'prise' && /assistant prépare/.test(prise.detail), prise)
const vieille = attenteReponse([moi(1, 'x', { recu_at: t(2), recu_par: 'agent/message-1' })], { ...base, maintenant: T0 + DELAI_PRISE_MS + 3 * 60_000 })
verifie('assistant sans réponse depuis 2 h → plus « prise » (redonné, comme en base)', vieille?.etat === 'personne', vieille)
verifie('« Ça fonctionne » seul n’attend rien', attenteReponse([moi(1, 'Ça fonctionne, je certifie.', { kind: 'constat' })], base) === null)

console.log('fil lié (0033 : « il faudrait aussi X » → nouveau chantier, bouton « Ouvrir le fil »)')
const liste = [{ id: 'C', titre: 'Origine' }, { id: 'N', titre: 'Export PDF' }]
verifie('un message relié à un autre chantier → ce chantier', filLie({ chantier_id: 'C', chantier_lie: 'N' }, liste)?.titre === 'Export PDF')
verifie('sans lien → rien', filLie({ chantier_id: 'C', chantier_lie: null }, liste) === null && filLie({ chantier_id: 'C' }, liste) === null)
verifie('un lien vers le fil lui-même → rien (pas de bouton inutile)', filLie({ chantier_id: 'C', chantier_lie: 'C' }, liste) === null)
verifie('un chantier supprimé ou hors de vue → rien (pas de bouton mort)', filLie({ chantier_id: 'C', chantier_lie: 'X' }, liste) === null)

console.log('dernière action réelle')
const da = derniereAction('C', [claude(3, 'Sujet : tri. Fait.'), moi(9, 'Et moi'), msg({ auteur_type: 'session', kind: 'question', created_at: t(20), corps: 'Question ?' })],
  [{ chantier_id: 'C', etape: 'Tests en cours', updated_at: t(7) }, { chantier_id: 'X', etape: 'Autre', updated_at: t(30) }], [{ chantier_id: 'C', etape: null, progres_at: t(40) }])
verifie('la plus récente action de Claude sur CE chantier (étape > message ancien ; ni ma parole, ni une question, ni un autre chantier)', da?.texte === 'Tests en cours' && da.quand === t(7), da)
verifie('sans rien de réel : null, jamais inventé', derniereAction('C', [moi(1)], [], []) === null)

// Champ d'action : les actions déjà faites sortent du chat, les autres messages y restent.
const sc = separerChat([{ kind: 'action' }, { kind: 'question' }, { kind: 'info' }, { kind: 'action' }])
verifie('séparer le chat : 2 actions faites hors du chat, 2 messages gardés', sc.faites.length === 2 && sc.chat.length === 2 && sc.chat.every((x) => x.kind !== 'action'))

bilan('verifier-discussion')
