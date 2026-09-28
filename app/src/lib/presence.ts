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

export type CodePresence =
  | 'travaille'      // 🟢 preuve de vie récente
  | 'silencieux'     // 🟡 réservé, mais plus rien depuis le délai
  | 'personne'       // ⏸ ouvert, personne dessus
  | 'attend_toi'     // 🔴 une question t'attend
  | 'a_verifier'     // 🧪 livré, à toi de vérifier
  | 'a_cadrer'       // 🗣️ à cadrer avec toi
  | 'bloque'         // ⛔
  | 'reporte'        // 💤
  | 'termine'        // ✅ certifié

export type Teinte = 'ok' | 'attention' | 'alerte' | 'info' | 'neutre'

export interface Presence {
  code: CodePresence
  /** La phrase, avec l'emoji, qui se lit sans rien déplier. */
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

  if (c.etat === 'valide') return { ...base, code: 'termine', libelle: '✅ Certifié', teinte: 'ok' }
  if (questionEnAttente) return { ...base, code: 'attend_toi', libelle: '🔴 Attend ta réponse', teinte: 'alerte',
    detail: vie ? `Claude attend ta réponse pour continuer (${activite!.session})` : null,
    tonAction: 'Déplie la carte et réponds à la question en rouge.' }
  if (c.etat === 'a_verifier') return { ...base, code: 'a_verifier', libelle: '🧪 À toi de vérifier', teinte: 'attention',
    tonAction: 'Déplie la carte, suis « Comment vérifier », puis certifie ou corrige.' }
  if (c.etat === 'a_cadrer') return { ...base, code: 'a_cadrer', libelle: '🗣️ À cadrer avec toi', teinte: 'info',
    detail: dernierAvancement(activite, now), aRelancer: true,
    tonAction: 'Une décision de ta part est nécessaire avant qu’une session s’y mette : écris-la dans le fil.' }
  if (c.etat === 'bloque') return { ...base, code: 'bloque', libelle: '⛔ Bloqué', teinte: 'alerte',
    detail: dernierAvancement(activite, now), tonAction: 'Lis le fil : il dit ce qui bloque.' }
  if (c.etat === 'reporte') return { ...base, code: 'reporte', libelle: '💤 Reporté', teinte: 'neutre', detail: dernierAvancement(activite, now) }

  if (vie) return { ...base, code: 'travaille', teinte: 'ok', barreVive: true,
    libelle: '🟢 Claude y travaille',
    detail: `${activite!.session} · ${dateRelative(activite!.updated_at, now) || 'à l’instant'}` }

  if (reserve) {
    const derniere = activite ? dateRelative(activite.updated_at, now) : null
    return { ...base, code: 'silencieux', teinte: 'attention', aRelancer: true,
      libelle: '🟡 Pris, mais silencieux',
      detail: `réservé par ${c.pris_par}${derniere ? ` · dernier signe ${derniere}` : ' · aucun avancement signalé'}`,
      tonAction: 'La session s’est peut-être arrêtée : demande où ça en est, ou relance-la.' }
  }

  return { ...base, code: 'personne', teinte: 'neutre', aRelancer: true,
    libelle: c.etat === 'a_trier' ? '⏸ Personne dessus · pas encore examiné' : '⏸ Personne dessus',
    detail: dernierAvancement(activite, now),
    tonAction: 'Rien n’avance tant qu’une session ne le reprend : copie la consigne et colle-la dans une session du projet.' }
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
