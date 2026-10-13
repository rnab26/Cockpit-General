/**
 * Bulle flottante d'aide : les règles pures (testées par verifier-bulle-aide.ts).
 *
 *  - Allumée PAR DÉFAUT : seule une préférence explicitement `false` l'éteint
 *    (30 sept. 2026 : elle était éteinte par défaut, Raphaël ne la voyait pas).
 *  - Vue projet : le fil de CE projet. Vue « Tout » : le projet `cockpit`, sinon
 *    le projet dont le fil libre a reçu le dernier message, sinon le premier.
 */
import type { Message, Projet } from './types.ts'
import { aTesterDe, attenteAToi, demandesDe, type ElementAToi } from './entonnoir.ts'
import { cleFil, type NonLus } from './lecture.ts'
import { extrait } from './texte.ts'

export const cleBulle = (projetId: string) => `bulle_flottante_aide_${projetId}`

export const bulleActive = (prefs: Record<string, unknown>, projetId: string): boolean => prefs[cleBulle(projetId)] !== false

export function projetDeLaBulle(vueProjetId: string | null, projets: readonly Projet[], messages: readonly Pick<Message, 'projet_id' | 'chantier_id' | 'created_at'>[]): Projet | null {
  if (vueProjetId) return projets.find((p) => p.id === vueProjetId) ?? null
  const reels = projets.filter((p) => !p.slug.startsWith('test-'))
  const liste = reels.length ? reels : projets
  const cockpit = liste.find((p) => p.slug === 'cockpit')
  if (cockpit) return cockpit
  let meilleur: Projet | null = null
  let quand = ''
  for (const m of messages) {
    if (m.chantier_id || m.created_at <= quand) continue
    const p = liste.find((x) => x.id === m.projet_id)
    if (p) { meilleur = p; quand = m.created_at }
  }
  return meilleur ?? liste[0] ?? null
}

/** Les messages du fil libre du projet (sans chantier), dans l'ordre, sans les lignes de mécanique. */
export function filDeLaBulle<T extends Pick<Message, 'projet_id' | 'chantier_id' | 'kind' | 'created_at' | 'ou_en_est'>>(messages: readonly T[], projetId: string): T[] {
  return messages
    .filter((m) => m.projet_id === projetId && !m.chantier_id && !m.ou_en_est && (m.kind === 'info' || m.kind === 'constat' || m.kind === 'reponse' || m.kind === 'blocage'))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** « Sujet : … » en tête d'un message : le sujet (affiché en gras) et le reste. UNE règle, aussi lue par la conversation. */
export function sujetDe(corps: string | null): { sujet: string | null; reste: string | null } {
  const r = corps?.match(/^\s*Sujet\s*:\s*([^\n.]{1,80}?)\s*(?:\.\s*|\n|$)/i)
  return r ? { sujet: r[1], reste: corps!.slice(r[0].length) } : { sujet: null, reste: corps }
}

/** Qui parle, comme dans la conversation des chantiers (Claude / Toi / Raphaël / invité). */
export function auteurDe(m: { auteur_type: string; auteur: string; auteur_user?: string | null }, admin: boolean): string {
  return m.auteur_type === 'session' ? 'Claude' : m.auteur_type === 'proprietaire' ? (admin ? 'Toi' : 'Raphaël') : m.auteur_user ? `${m.auteur} · invité` : m.auteur
}

/**
 * Répondre à une question précise (comme WhatsApp) : la citation est écrite en tête du message, en ligne « > ».
 * Le message part tel quel dans le fil (Claude lit la citation) ; la bulle la redessine en encart.
 */
export const CITATION_MAX = 160
export function citer(texte: string, max = CITATION_MAX): string {
  const t = texte.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}
export function avecCitation(citation: string | null, reponse: string): string {
  const r = reponse.trim()
  return citation ? `> ${citer(citation)}\n${r}` : r
}
export function citationDe(corps: string | null): { citation: string | null; reste: string } {
  const r = (corps ?? '').match(/^>\s?([^\n]+)\n?/)
  return r ? { citation: r[1], reste: (corps ?? '').slice(r[0].length) } : { citation: null, reste: corps ?? '' }
}
/** Ce qu'on cite quand on touche « Répondre » : le passage sélectionné dans CE message, sinon son début (sans la ligne « Sujet »). */
export function aCiter(selection: string, corps: string): string {
  const s = selection.trim()
  if (s) return citer(s)
  const { sujet, reste } = sujetDe(citationDe(corps).reste)
  return citer(reste?.trim() || sujet || corps)
}

/** Commande vocale : la reconnaissance du navigateur (Chrome Android, Safari). Rien n'est enregistré par le cockpit. */
export function constructeurVoix(w: unknown): (new () => unknown) | null {
  const o = w as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown } | null
  return o?.SpeechRecognition ?? o?.webkitSpeechRecognition ?? null
}
export function messageVoix(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed': return 'Micro refusé : autorise le micro pour ce site (cadenas de la barre d’adresse › Autorisations › Micro), puis réessaie.'
    case 'no-speech': return 'Je n’ai rien entendu : rapproche-toi et réessaie.'
    case 'audio-capture': return 'Aucun micro trouvé sur cet appareil.'
    case 'network': return 'La reconnaissance vocale a besoin d’internet : réessaie dans un instant.'
    case 'aborted': return ''
    default: return `La reconnaissance vocale a échoué (${code}).`
  }
}
export const VOIX_NON_SUPPORTEE = 'La dictée vocale n’est pas disponible dans ce navigateur : utilise Chrome (Android ou ordinateur) ou Safari, ou le micro du clavier.'

/**
 * Les cartes « À faire ici » d'un chat : celles de « À toi de jouer » qu'on peut traiter dans la discussion.
 * UNE règle, lue par le chat (AFaireIci) ET par les pastilles de la liste / de la barre du bas : ce qui est
 * compté sur un chat est exactement ce qu'on y trouve en l'ouvrant. Les DEMANDES d'abord, les chantiers à
 * tester ensuite (13 oct. 2026 : 30 cartes de test passaient avant l'historique de la discussion).
 */
export function cartesAFaire(els: readonly ElementAToi[]): ElementAToi[] {
  // Une vérification montre déjà les questions de son chantier : pas de doublon.
  const verifies = new Set(els.filter((e) => e.type === 'a_verifier' && e.chantier).map((e) => e.chantier!.id))
  const gardees = els.filter((e) => {
    if (e.type === 'question' || e.type === 'action') return !!e.message && !(e.chantier && verifies.has(e.chantier.id))
    if (e.type === 'a_verifier' || e.type === 'a_cadrer') return !!e.chantier
    return e.type === 'fusion' && !!e.message
  })
  return [...demandesDe(gardees), ...aTesterDe(gardees)]
}

export interface NotifsChat { reponses: number; aFaire: number; aTester: number; total: number }

/**
 * Ce qui attend sur le chat d'UN projet : réponses de Claude non lues dans sa discussion + DEMANDES à traiter.
 * Les chantiers à tester sont comptés à part (`aTester`) et ne font PAS monter la pastille : un test n'est pas
 * une question de Claude. Le total de l'onglet « Discussions » est la somme des chats (jamais un autre compte :
 * avant, il comptait aussi les réponses des fils de chantiers, qu'aucun chat ne montre, et ne retombait pas à zéro).
 */
export function notifsChat(nonLus: ReadonlyMap<string, NonLus>, projetId: string, cartes: readonly ElementAToi[]): NotifsChat {
  const reponses = nonLus.get(cleFil(projetId, null))?.n ?? 0
  const aFaire = demandesDe(cartes).length
  return { reponses, aFaire, aTester: cartes.length - aFaire, total: reponses + aFaire }
}

/**
 * Le SUJET d'une carte ou d'une ligne « À toi », ce qu'on lit en premier (Raphaël, 13 oct. 2026 : « il n'y a pas
 * toujours les sujets, je suis obligé de lire les descriptifs sur les cartes »). Le titre du chantier ; sans
 * chantier, le « Sujet : … » du message, sinon sa première phrase — jamais « Question sur le projet » tout seul
 * quand le message dit de quoi il s'agit. `detail` = ce qui distingue la carte de ses voisines : pour une question ou
 * une action, le texte de la question (quatre questions d'un même chantier ne se ressemblent plus) ; sans chantier,
 * le reste du message (rien n'est perdu quand le sujet est coupé).
 */
export const SUJET_MAX = 80
export const DETAIL_MAX = 160
/** Deux textes qui disent la même chose (l'un est le début de l'autre, coupures « … » et blancs mis à part) : inutile de les afficher tous les deux. */
const normaliser = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[….\s]+$/, '')
export const memeTexte = (a: string, b: string): boolean => { const x = normaliser(a), y = normaliser(b); return !!x && !!y && (x.startsWith(y) || y.startsWith(x)) }
export function sujetEtDetail(e: Pick<ElementAToi, 'type' | 'chantier' | 'message'>): { sujet: string; detail: string | null } {
  const brut = citationDe(e.message?.corps ?? null).reste.trim()
  const titre = e.chantier?.titre?.replace(/\s+/g, ' ').trim()
  if (titre) {
    const question = (e.type === 'question' || e.type === 'action') && brut ? extrait(brut, DETAIL_MAX) : null
    return { sujet: titre, detail: question && !memeTexte(titre, question) ? question : null }
  }
  if (!brut) return { sujet: 'Question sur le projet', detail: null }
  const { sujet: balise, reste } = sujetDe(brut)
  if (balise) return { sujet: extrait(balise, SUJET_MAX), detail: reste?.trim() ? extrait(reste, DETAIL_MAX) : null }
  const m = /^([^\n]*?[.?!…])(?=\s|$)/.exec(brut)
  const premiere = (m ? m[1] : brut.split('\n')[0]).trim()
  const sujet = extrait(premiere, SUJET_MAX)
  const coupe = sujet !== premiere.replace(/\s+/g, ' ')
  const suite = brut.slice(premiere.length).trim()
  return { sujet, detail: coupe ? extrait(brut, DETAIL_MAX) : suite ? extrait(suite, DETAIL_MAX) : null }
}

/**
 * La deuxième ligne d'une carte : la question elle-même quand il y en a une, sinon ce qu'on attend de toi
 * (« Claude te pose une question », « livré, à tester »…). Si Claude a travaillé dessus depuis, l'alerte passe d'abord.
 */
export function detailDeCarte(e: Pick<ElementAToi, 'type' | 'chantier' | 'message' | 'avanceDepuis'>, now: Date): string {
  return e.avanceDepuis ? attenteAToi(e, now) : sujetEtDetail(e).detail ?? attenteAToi(e, now)
}
