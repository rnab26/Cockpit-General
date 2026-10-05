/**
 * File d'attente des écritures (5 oct. 2026, chantier 5b68a493).
 *
 * Raphaël : « toutes les données survivent, même sans wifi, même cache vidé,
 * même plus de crédit Claude : enregistrées, récupérées à la prochaine
 * connexion ». Règle UNIQUE ici (pure, testée par verifier-file-attente.ts) :
 * quelles requêtes on garde quand le réseau tombe, comment on les range, et
 * quoi faire de la réponse du serveur au renvoi. Le stockage (IndexedDB) et le
 * `fetch` vivent dans fileAttenteStockage.ts / fetchResilient.ts.
 *
 * Principe : une écriture qui n'a pas pu partir n'est JAMAIS perdue ni
 * affichée comme réussie : elle est gardée sur l'appareil, l'écran le dit
 * (bandeau), et elle repart dans l'ordre dès que le réseau revient. Une
 * écriture que le serveur REFUSE n'est jamais jetée en silence : elle reste
 * visible (copier / réessayer / abandonner après confirmation).
 */

export type StatutElement = 'attente' | 'refuse'

export interface ElementFile {
  id: string
  ajoute: number
  /** Utilisateur qui a écrit : le renvoi n'a lieu que sous son compte. */
  uid: string | null
  methode: string
  url: string
  entetes: [string, string][]
  corps: CorpsStocke | null
  essais: number
  statut: StatutElement
  raison?: string
  /** Phrase lisible pour le bandeau (« Message dans un fil »). */
  resume: string
  /** Contenu texte lisible, pour « Copier » : jamais un secret. */
  apercu: string
}

export type CorpsStocke =
  | { type: 'texte'; v: string }
  | { type: 'blob'; v: Blob }
  | { type: 'formdata'; v: [string, string | Blob][] }

/** RPC qui LISENT (ou qui n'ont aucun sens hors ligne) : jamais mises en file. */
// Toute RPC de LECTURE appelée par l'app doit figurer ici : sinon elle serait prise pour une écriture
// (gardée hors ligne, réponse fabriquée) au lieu d'être servie du cache (regression 0058 : projets_visibles).
const RPC_LECTURE = /^(etat_|prochain_|membres_|moi$|est_|peut_|chef_|file_|ressemblance|candidat_|reveiller_reportes$|a_toi_a_revoir$|projets_visibles$|invitations_du_projet$|invitation_info$|journal_invites$|chantiers_proches_creation$)/
/** RPC dont les arguments sont un secret : jamais écrits sur l'appareil. */
const RPC_SECRETES = new Set(['regler_reveil_immediat'])
/** Tables sans valeur à rejouer (appareil, préférence jetable). */
const TABLES_IGNOREES = new Set(['push_abonnements'])

export interface Cible { genre: 'rpc' | 'table' | 'stockage' | 'autre'; nom: string }

export function cibleDe(url: string): Cible {
  const m = /\/rest\/v1\/rpc\/([^/?]+)/.exec(url)
  if (m) return { genre: 'rpc', nom: decodeURIComponent(m[1]) }
  const t = /\/rest\/v1\/([^/?]+)/.exec(url)
  if (t) return { genre: 'table', nom: decodeURIComponent(t[1]) }
  const s = /\/storage\/v1\/object\/([^?]+)/.exec(url)
  if (s) return { genre: 'stockage', nom: decodeURIComponent(s[1]) }
  return { genre: 'autre', nom: '' }
}

/** Faut-il garder cette requête quand elle ne peut pas partir ? */
export function aGarder(methode: string, url: string): boolean {
  const m = methode.toUpperCase()
  if (m !== 'POST' && m !== 'PATCH' && m !== 'PUT' && m !== 'DELETE') return false
  const c = cibleDe(url)
  if (c.genre === 'rpc') return !RPC_LECTURE.test(c.nom) && !RPC_SECRETES.has(c.nom)
  if (c.genre === 'table') return !TABLES_IGNOREES.has(c.nom)
  if (c.genre === 'stockage') return m === 'POST' || m === 'PUT'
  return false
}

/**
 * Une requête de lecture dont on garde la dernière réponse pour le hors ligne :
 * lecture d'une table, ou RPC de LECTURE (le profil `moi`, les états d'écran).
 * `reveiller_reportes` écrit un peu : jamais servi du cache.
 */
export function aMettreEnCache(methode: string, url: string): boolean {
  const m = methode.toUpperCase()
  const c = cibleDe(url)
  if (m === 'GET') return c.genre === 'table'
  return m === 'POST' && c.genre === 'rpc' && RPC_LECTURE.test(c.nom) && c.nom !== 'reveiller_reportes'
}

const LIBELLES_TABLES: Record<string, string> = {
  messages: 'Message dans un fil', chantiers: 'Chantier', sections: 'Section', projets: 'Projet',
  membres: 'Membre du projet', preferences: 'Préférence',
}
export function resumeDe(methode: string, url: string): string {
  const c = cibleDe(url)
  if (c.genre === 'rpc') return `Action « ${c.nom.replace(/_/g, ' ')} »`
  if (c.genre === 'stockage') return 'Fichier joint'
  if (c.genre === 'table') {
    const base = LIBELLES_TABLES[c.nom] ?? `Table ${c.nom}`
    const verbe = methode.toUpperCase() === 'DELETE' ? 'suppression' : methode.toUpperCase() === 'POST' ? 'ajout' : 'modification'
    return `${base} (${verbe})`
  }
  return `${methode} ${url}`
}

/**
 * Un renvoi ne doit jamais DOUBLER une ligne si la première tentative était
 * arrivée sans que la réponse revienne : on fixe l'identifiant côté appareil
 * pour les ajouts dans `messages` et `chantiers` (colonne `id` uuid), le
 * doublon revient alors en 409 (clé déjà prise), traité comme « déjà fait ».
 */
export function avecIdentifiant(url: string, methode: string, texte: string | null, genererId: () => string): string | null {
  if (texte == null || methode.toUpperCase() !== 'POST') return texte
  const c = cibleDe(url)
  if (c.genre !== 'table' || (c.nom !== 'messages' && c.nom !== 'chantiers')) return texte
  try {
    const v = JSON.parse(texte) as unknown
    const pose = (o: unknown) => (o && typeof o === 'object' && !Array.isArray(o) && !('id' in (o as object)) ? { id: genererId(), ...(o as object) } : o)
    return JSON.stringify(Array.isArray(v) ? v.map(pose) : pose(v))
  } catch { return texte }
}

export type Issue = 'fait' | 'reessayer' | 'refuse'

/** Que faire d'une réponse du serveur au renvoi. */
export function classerReponse(status: number): Issue {
  if (status >= 200 && status < 300) return 'fait'
  if (status === 409) return 'fait' // clé déjà prise : la première tentative était arrivée
  if (status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) return 'reessayer'
  return 'refuse'
}

/** Une réponse du serveur à l'ÉCRITURE directe (réseau présent) qu'on traite comme une panne réseau. */
export function estPanneServeur(status: number): boolean {
  return status === 502 || status === 503 || status === 504
}

/**
 * Réponse fabriquée quand l'écriture est gardée : assez fidèle pour que
 * supabase-js ne lève pas d'erreur (la vérité, « en attente », est dite par le
 * bandeau). Aucun faux identifiant de serveur n'est inventé : on renvoie ce
 * que l'appelant avait envoyé.
 */
export function reponseGardee(methode: string, url: string, texte: string | null, prefer: string): { status: number; corps: string | null } {
  const c = cibleDe(url)
  if (c.genre === 'rpc') return { status: 200, corps: 'null' }
  if (c.genre === 'stockage') return { status: 200, corps: JSON.stringify({ Key: c.nom, Id: '' }) }
  if (methode.toUpperCase() === 'POST') {
    if (/return=representation/.test(prefer) && texte) {
      try { const v = JSON.parse(texte) as unknown; return { status: 201, corps: JSON.stringify(Array.isArray(v) ? v : [v]) } } catch { /* repli */ }
    }
    return { status: 201, corps: null }
  }
  if (/return=representation/.test(prefer)) return { status: 200, corps: '[]' }
  return { status: 204, corps: null }
}

/** Un texte lisible du contenu, pour « Copier » (l'en-tête Authorization n'est jamais gardé). */
export function apercuDe(texte: string | null, genre: Cible['genre']): string {
  if (genre === 'stockage') return '(fichier joint, gardé sur cet appareil)'
  if (!texte) return ''
  return texte.length > 4000 ? texte.slice(0, 4000) + '…' : texte
}

/** Phrase du bandeau, une seule règle pour tous les états. */
export function phraseBandeau(o: { attente: number; refuses: number; horsLigne: boolean; envoi: boolean }): { niveau: 'info' | 'attention' | 'erreur'; texte: string } | null {
  const { attente, refuses, horsLigne, envoi } = o
  if (refuses > 0) return { niveau: 'erreur', texte: refuses === 1 ? '1 envoi refusé par le serveur : il est gardé, rien n’est perdu.' : `${refuses} envois refusés par le serveur : ils sont gardés, rien n’est perdu.` }
  if (attente > 0) {
    const n = attente === 1 ? '1 élément' : `${attente} éléments`
    if (envoi) return { niveau: 'info', texte: `Envoi de ${n} en cours…` }
    return { niveau: 'attention', texte: `${n} enregistré${attente > 1 ? 's' : ''} sur cet appareil, ${attente > 1 ? 'envoyés' : 'envoyé'} au retour du réseau.` }
  }
  if (horsLigne) return { niveau: 'attention', texte: 'Hors ligne : tu vois les dernières données reçues. Ce que tu écris est gardé et envoyé au retour du réseau.' }
  return null
}

/** Pause entre deux tentatives d'envoi (ms), croissante, plafonnée. */
export function delaiReessai(essais: number): number {
  return Math.min(30_000 * Math.pow(2, Math.max(0, essais - 1)), 15 * 60_000)
}
