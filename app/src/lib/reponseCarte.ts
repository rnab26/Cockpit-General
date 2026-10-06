/**
 * Répondre à une carte (question / action) ou écrire dans un fil : UNE règle
 * pour l'écran (chantier b287e60a, 5 oct. 2026).
 *
 * Raphaël : « je clique sur « Fait » ou j'envoie un message avec une pièce
 * jointe, ça ne s'actualise pas du tout tout de suite, donc je refais
 * plusieurs fois la même action — 10 fois ». Cause lue dans le code : après
 * l'écriture, l'écran rechargeait TOUT (6 tables, les messages par pages de
 * 1000) avant de bouger, et le bouton se réactivait AVANT ce rechargement :
 * pendant plusieurs secondes la carte était intacte et cliquable, et chaque
 * toucher posait une nouvelle réponse (et de nouveaux fichiers dans le fil).
 *
 * Désormais : la carte passe « répondue » TOUT DE SUITE (ces fonctions pures,
 * qui reproduisent ce que fait `repondre_message` côté base), puis UNE ligne est
 * relue (`ligneRelueValable` décide si on la croit), retour arrière si
 * l'écriture échoue, et un second toucher ne pose rien (`dejaRepondue`).
 */
import type { EtatAction, Message } from './types.ts'

/** Marque posée sur `answered_by` tant que la base n'a pas confirmé (remplacée par la ligne relue). */
export const REPONSE_LOCALE = 'local'

/** Ce que `repondre_message` écrit : même règle que la fonction SQL (0004) — une action « pas encore / ça bloque » reste ouverte. */
export function reponseOptimiste(m: Message, o: { reponse: string; precision?: string | null; etat?: EtatAction | null; maintenant: string }): Message {
  const etat = o.etat ?? m.etat
  return {
    ...m,
    reponse: o.reponse,
    precision: o.precision ?? m.precision,
    etat,
    answered_at: m.kind === 'action' && etat !== 'fait' ? m.answered_at : o.maintenant,
    // 0070 : la carte reste ouverte mais le retour est daté (c'est ce que Claude lit).
    retour_at: m.kind === 'action' && etat !== 'fait' ? o.maintenant : m.retour_at,
    answered_by: REPONSE_LOCALE,
  }
}

/** Le même geste a-t-il déjà été enregistré ? Alors un nouveau toucher ne pose rien. */
export function dejaRepondue(m: Message, o: { reponse: string; etat?: EtatAction | null }): boolean {
  if (m.reponse !== o.reponse) return false
  if (m.kind === 'action') return (o.etat ?? null) === m.etat
  return !!m.answered_at
}

/** Remplace la ligne de même id, ou l'ajoute à la fin (une ligne arrivée en direct a déjà pu la poser : jamais deux fois). */
export function remplacerLigne<T extends { id: string }>(liste: readonly T[], ligne: T): T[] {
  const i = liste.findIndex((x) => x.id === ligne.id)
  if (i < 0) return [...liste, ligne]
  const n = liste.slice()
  n[i] = ligne
  return n
}

/** Retire une ligne (retour arrière d'un envoi qui a échoué). */
export function retirerLigne<T extends { id: string }>(liste: readonly T[], id: string): T[] {
  return liste.filter((x) => x.id !== id)
}

/**
 * La ligne relue en base remplace l'affichage optimiste seulement si elle porte la réponse envoyée.
 * Hors ligne, la lecture peut revenir du cache (ancienne version) : on ne défait pas le geste de
 * l'écran, il est gardé sur l'appareil et part au retour du réseau (bandeau).
 */
export function ligneRelueValable(optimiste: Message, relue: Message | null | undefined): relue is Message {
  return !!relue && relue.id === optimiste.id && relue.reponse === optimiste.reponse
}

export type EtatEnvoi = 'repos' | 'envoi' | 'envoye' | 'echec'

/** Le libellé d'un bouton selon l'état de l'envoi : toujours dit, jamais un bouton muet. */
export function libelleEnvoi(etat: EtatEnvoi, repos: string): string {
  if (etat === 'envoi') return 'Envoi…'
  if (etat === 'envoye') return 'Envoyé ✓'
  return repos
}

/** Combien de temps « Envoyé ✓ » reste affiché. */
export const DUREE_ENVOYE_MS = 2500

/**
 * Où en est son retour sur une carte d'action restée ouverte (« Ça bloque », ou « Pas encore » avec un mot) —
 * même règle que `est_retour_carte` (0070). Avant : « Ça bloque » + son mot étaient enregistrés et rien ne
 * s'affichait, ni rien ne les lisait ; il le refaisait des dizaines de fois (chantier 0fec7563).
 *  - null : pas de retour à suivre ;
 *  - « attend » : enregistré, aucune session n'a encore écrit dans le fil depuis ;
 *  - « lu » : une session a écrit dans le fil du chantier depuis son retour.
 */
export type RetourCarte = { etat: 'attend' | 'lu'; depuis: string }
export function retourCarte(m: Message, fil: readonly Pick<Message, 'chantier_id' | 'auteur_type' | 'created_at'>[]): RetourCarte | null {
  if (m.kind !== 'action' || m.answered_at || !m.retour_at) return null
  const mot = !!(m.precision ?? '').trim() || (Array.isArray(m.medias) && m.medias.length > 0)
  if (!(m.etat === 'bloque' || (m.etat === 'pas_encore' && mot))) return null
  const lu = fil.some((x) => x.chantier_id === m.chantier_id && x.auteur_type === 'session' && x.created_at > m.retour_at!)
  return { etat: lu ? 'lu' : 'attend', depuis: m.retour_at }
}

/** La phrase affichée sous la carte pour ce retour. */
export function phraseRetourCarte(r: RetourCarte): string {
  return r.etat === 'lu'
    ? 'Claude a lu ton retour. La carte reste ici tant qu’il ne l’a pas fermée ou corrigée : si elle n’a pas lieu d’être, retire-la toi-même.'
    : 'Ton retour est enregistré : Claude le lira à son prochain passage (quelques minutes). Si la carte n’a pas lieu d’être, retire-la toi-même.'
}

/** La réponse que `retirer_carte` écrit (0070) : même texte à l'écran avant la confirmation de la base. */
export function reponseRetrait(par: string, motif: string): string {
  return `Retirée par ${par.trim() || 'Raphaël'} : ${motif.trim() || 'cette carte n’a pas lieu d’être'}`
}
