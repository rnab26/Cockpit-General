// « Est-ce que quelqu'un travaille VRAIMENT sur ce chantier, et que dois-je
// faire ? » — la seule question que Raphaël se pose en ouvrant le cockpit.
//
// Né le 29 sept. 2026, capture à l'appui : sur FacePro, des barres orange à
// 85 %, 50 %, 35 % et trois badges « En cours »… alors qu'AUCUNE session
// n'était dessus (barres reprises de son visuel du 27/09). Ses mots : « je
// vois des barres de progression, mais j'arrive pas à voir si elles sont en
// train de travailler réellement ou pas […] je ne sais pas comment les
// relancer ou questionner l'état de ce chantier ».
//
// D'où UNE règle, pure, lue par la carte, le bandeau du haut et les tests :
// « travaille » exige une PREUVE DE VIE récente (une étape signalée par
// progression.sh depuis moins de `silenceMs`). La colonne `etat` ne suffit
// jamais à dire que quelqu'un travaille : elle dit où en est le chantier, pas
// qui est dessus.
import type { Activite, Chantier } from './types.ts'
import { dateRelative } from './dates.ts'

export const SILENCE_DEFAUT_MIN = 15
/** Les choix du réglage « délai avant de considérer une session comme silencieuse » (préférence `silence_minutes`). */
export const SILENCES_MIN = [5, 10, 15, 30, 60] as const
export const CLE_PREF_SILENCE = 'silence_minutes'

/** Le délai de silence en ms, lu dans la préférence ; une valeur inconnue retombe sur le défaut. */
export function silenceMsDe(valeur: unknown): number {
  const n = typeof valeur === 'string' ? Number(valeur) : valeur
  return ((SILENCES_MIN as readonly unknown[]).includes(n) ? (n as number) : SILENCE_DEFAUT_MIN) * 60_000
}

export type CodePresence =
  | 'travaille'      // preuve de vie récente
  | 'silencieux'     // réservé, mais plus rien depuis le délai
  | 'personne'       // ouvert, personne dessus
  | 'attend_toi'     // une question t'attend
  | 'a_verifier'     // livré, à toi de vérifier
  | 'a_cadrer'       // à cadrer avec toi
  | 'bloque'         // bloqué
  | 'reporte'        // mis de côté exprès
  | 'termine'        // certifié

export type Teinte = 'ok' | 'attention' | 'alerte' | 'info' | 'neutre'

export interface Presence {
  code: CodePresence
  /** La phrase qui se lit sans rien déplier (sans emoji : l'icône vient de l'écran). */
  libelle: string
  /** Le complément (qui, depuis quand, dernier avancement connu). */
  detail: string | null
  teinte: Teinte
  /** Barre colorée et animée seulement si quelqu'un avance VRAIMENT. */
  barreVive: boolean
  /** Proposer « Copier la consigne pour Claude » et « Demander où ça en est ». */
  aRelancer: boolean
  /** Ce que Raphaël doit faire, en une phrase, ou null s'il n'a rien à faire. */
  tonAction: string | null
}

type C = Pick<Chantier, 'etat' | 'pris_par' | 'pris_jusqu_a' | 'archived_at'>
type A = Pick<Activite, 'statut' | 'updated_at' | 'session' | 'pourcentage' | 'etape'>

const ms = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(t) ? null : t
}

/** Une ligne d'activité est une preuve de vie si elle est « en cours » et récente. */
export function preuveDeVie(a: A | null | undefined, now: Date, silenceMs: number): boolean {
  if (!a || a.statut !== 'en_cours') return false
  const t = ms(a.updated_at)
  return t !== null && now.getTime() - t < silenceMs
}

function dernierAvancement(a: A | null | undefined, now: Date): string | null {
  if (!a) return null
  const quand = dateRelative(a.updated_at, now)
  return `dernier avancement connu : ${a.pourcentage} %${quand ? ` (${quand})` : ''}${a.etape ? ` — ${a.etape}` : ''}`
}

export function presenceChantier(
  c: C,
  activite: A | null,
  questionEnAttente: boolean,
  now: Date = new Date(),
  silenceMs: number = SILENCE_DEFAUT_MIN * 60_000,
): Presence {
  const vie = preuveDeVie(activite, now, silenceMs)
  const reserve = !!c.pris_par && (ms(c.pris_jusqu_a) ?? 0) > now.getTime()
  const base = { barreVive: false, aRelancer: false, detail: null as string | null, tonAction: null as string | null }

  if (c.etat === 'valide') return { ...base, code: 'termine', libelle: 'Certifié', teinte: 'ok' }
  if (questionEnAttente) return { ...base, code: 'attend_toi', libelle: 'Attend ta réponse', teinte: 'alerte',
    detail: vie ? `Claude attend ta réponse pour continuer (${activite!.session})` : null,
    tonAction: 'Claude attend ta réponse : réponds à la question en rouge ci-dessous.' }
  if (c.etat === 'a_verifier') return { ...base, code: 'a_verifier', libelle: 'À toi de vérifier', teinte: 'attention',
    tonAction: 'C’est livré : suis « Comment vérifier » ci-dessous, puis dis si ça fonctionne.' }
  if (c.etat === 'a_cadrer') return { ...base, code: 'a_cadrer', libelle: 'À cadrer avec toi', teinte: 'info',
    detail: dernierAvancement(activite, now), aRelancer: true,
    tonAction: 'Claude a besoin de ta décision avant de commencer. Écris-la ci-dessous.' }
  if (c.etat === 'bloque') return { ...base, code: 'bloque', libelle: 'Bloqué', teinte: 'alerte',
    detail: dernierAvancement(activite, now), tonAction: 'Lis ce qui bloque dans le fil, puis réponds ci-dessous.' }
  // Retour de Raphaël, 29 sept. : un chantier reporté, fil vide, et rien ne disait qu'il n'avait RIEN à faire.
  if (c.etat === 'reporte') return { ...base, code: 'reporte', libelle: 'Reporté', teinte: 'neutre', detail: dernierAvancement(activite, now),
    tonAction: 'Mis de côté exprès. Rien à faire de ta part, sauf si tu veux le relancer.' }

  if (vie) return { ...base, code: 'travaille', teinte: 'ok', barreVive: true,
    libelle: 'Claude y travaille',
    detail: `${activite!.session} · ${dateRelative(activite!.updated_at, now) || 'à l’instant'}` }

  if (reserve) {
    const derniere = activite ? dateRelative(activite.updated_at, now) : null
    return { ...base, code: 'silencieux', teinte: 'attention', aRelancer: true,
      libelle: 'Pris, mais silencieux',
      detail: `réservé par ${c.pris_par}${derniere ? ` · dernier signe ${derniere}` : ' · aucun avancement signalé'}`,
      tonAction: 'La session s’est peut-être arrêtée : demande où ça en est, ou relance-la.' }
  }

  return { ...base, code: 'personne', teinte: 'neutre', aRelancer: true,
    libelle: 'Personne dessus',
    detail: [c.etat === 'a_trier' ? 'pas encore examiné' : null, dernierAvancement(activite, now)].filter(Boolean).join(' · ') || null,
    tonAction: 'Personne dessus. Relance-le avec « Copier la consigne », ou écris une précision ci-dessous.' }
}

/** Le bandeau du haut : qui travaille en ce moment, vraiment. */
export function sessionsActives(activites: readonly A[], now: Date = new Date(), silenceMs: number = SILENCE_DEFAUT_MIN * 60_000): string[] {
  return [...new Set(activites.filter((a) => preuveDeVie(a, now, silenceMs)).map((a) => a.session))]
}

/** La phrase à coller dans une session Claude Code du projet pour qu'elle reprenne ce chantier. */
export function consigneClaude(c: Pick<Chantier, 'id' | 'titre'>, projetSlug: string): string {
  return `Reprends le chantier « ${c.titre} » du cockpit (projet ${projetSlug}, id ${c.id}). `
    + `Lis sa demande et son fil, réserve-le, signale ta progression à chaque étape avec cockpit-progression.sh, `
    + `pose tes questions dans le cockpit, et termine en « à vérifier » avec les étapes « Comment vérifier ».`
}

/** Le message écrit dans le fil par « Demander où ça en est ». */
export const MESSAGE_OU_CA_EN_EST = 'Raphaël demande : où en est ce chantier ? Qu’est-ce qui est fait, qu’est-ce qui reste, qu’est-ce qui bloque ?'

/** La dernière demande « où ça en est » du fil d'un chantier (pour afficher « Demandé il y a … » au lieu d'en empiler). */
export function derniereDemandeOuCaEnEst<M extends { corps: string; created_at: string }>(fil: readonly M[]): M | null {
  let res: M | null = null
  for (const m of fil) if (m.corps === MESSAGE_OU_CA_EN_EST && (!res || m.created_at > res.created_at)) res = m
  return res
}
