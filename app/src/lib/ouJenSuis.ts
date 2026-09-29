// « Où j'en suis » : quatre nombres par section, pas cinq (leçon Jarvis :
// une cinquième colonne oblige à relire un tableau au lieu de lire une
// réponse). « Pour toi » est EXACTEMENT la liste « À toi » de l'entonnoir
// (questions, fusions, à vérifier, à cadrer, bloqués) : le nombre du tableau,
// la pastille de l'onglet et le bloc « À toi » ne peuvent pas diverger
// (29 sept. : 12 dans le tableau contre 14 sur l'onglet, pour le même projet).
// Reporté ne compte nulle part, et une réservation expirée non plus — elle
// ressort à part, pour être libérée.
import type { Chantier, Message, Section } from './types.ts'
import { reservationValide } from './dates.ts'
import { dansFenetre, type Fenetre } from './fenetre.ts'
import { aToi } from './entonnoir.ts'

export interface QuatreNombres {
  pourToi: number   // les éléments de « À toi » (entonnoir.aToi)
  bouge: number     // en cours, réservation valide
  dort: number      // libre / à trier, personne dessus
  livre: number     // certifié dans la fenêtre
  expirees: number  // en cours mais réservation expirée : à libérer
}

export interface LigneOuJenSuis {
  section: Section | null   // null = « Sans section »
  nombres: QuatreNombres
  ids: { pourToi: string[]; bouge: string[]; dort: string[]; livre: string[]; expirees: string[] }
}

const vide = (): QuatreNombres => ({ pourToi: 0, bouge: 0, dort: 0, livre: 0, expirees: 0 })

/** Les chantiers qui portent au moins une question/action sans réponse. */
export function chantiersEnAttente(messages: readonly Pick<Message, 'chantier_id' | 'kind' | 'answered_at'>[]): Set<string> {
  const s = new Set<string>()
  for (const m of messages) {
    if ((m.kind === 'question' || m.kind === 'action') && !m.answered_at && m.chantier_id) s.add(m.chantier_id)
  }
  return s
}

export function questionsSansChantier(messages: readonly Pick<Message, 'chantier_id' | 'kind' | 'answered_at'>[]): number {
  return messages.filter((m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at && !m.chantier_id).length
}

/** « Fini » : certifié dans la fenêtre choisie, archivé ou non. La règle unique des tuiles et du tableau. */
export function estFiniDans(c: Pick<Chantier, 'etat' | 'valide_at'>, fenetre: Fenetre, now: Date = new Date()): boolean {
  return c.etat === 'valide' && dansFenetre(c.valide_at, fenetre, now)
}

/**
 * `classes` (tableau de bord, 29 sept. 2026) : quand l'écran connaît déjà
 * « ça avance » et « en pause » (tableauDeBord.ts, présence comprise), le
 * tableau par section compte EXACTEMENT ces chantiers-là — les tuiles et le
 * détail ne peuvent pas diverger. Sans `classes`, la règle d'avant (réservation).
 */
export function ouJenSuis(
  sections: readonly Section[],
  chantiers: readonly Chantier[],
  messages: readonly Message[],
  fenetre: Fenetre,
  now: Date = new Date(),
  classes?: { bouge: ReadonlySet<string>; dort: ReadonlySet<string> },
): { lignes: LigneOuJenSuis[]; total: QuatreNombres } {
  const parSection = new Map<string | null, LigneOuJenSuis>()
  const ligne = (id: string | null, section: Section | null) => {
    let l = parSection.get(id)
    if (!l) {
      l = { section, nombres: vide(), ids: { pourToi: [], bouge: [], dort: [], livre: [], expirees: [] } }
      parSection.set(id, l)
    }
    return l
  }
  const ordre = [...sections].sort((a, b) => a.position - b.position || a.nom.localeCompare(b.nom, 'fr'))
  for (const s of ordre) ligne(s.id, s)
  const total = vide()
  const sectionsConnues = new Set(sections.map((s) => s.id))

  for (const c of chantiers) {
    const sid = c.section_id && sectionsConnues.has(c.section_id) ? c.section_id : null
    const l = ligne(sid, sid ? ordre.find((s) => s.id === sid)! : null)
    const compte = (k: keyof QuatreNombres) => { l.nombres[k]++; total[k]++; l.ids[k].push(c.id) }

    // Livré : un certifié dans la fenêtre, archivé ou non.
    if (estFiniDans(c, fenetre, now)) compte('livre')
    if (c.archived_at && c.etat !== 'valide') continue   // doublon ou archivé : hors jeu
    if (c.etat === 'valide') continue

    if (classes) {
      if (classes.bouge.has(c.id)) compte('bouge')
      else if (classes.dort.has(c.id)) compte('dort')
      // La réservation expirée reste signalée à part (note sous le tableau), même si la ligne « avance » la montre.
      if (c.etat === 'en_cours' && !reservationValide(c.pris_jusqu_a, now)) compte('expirees')
      continue
    }

    if (c.etat === 'en_cours') {
      if (reservationValide(c.pris_jusqu_a, now)) compte('bouge')
      else compte('expirees')
    } else if (c.etat === 'libre' || c.etat === 'a_trier') {
      if (!reservationValide(c.pris_jusqu_a, now)) compte('dort')
      else compte('bouge')  // réservé mais l'état n'a pas suivi : quelqu'un est dessus
    }
    // à cadrer / bloqué : dans « pour toi » (ci-dessous) ; reporté : nulle part, volontairement.
  }
  // « Pour toi » : un par élément de « À toi » ; la liste derrière le nombre donne ses chantiers.
  for (const e of aToi(chantiers, messages)) {
    const sid = e.chantier?.section_id && sectionsConnues.has(e.chantier.section_id) ? e.chantier.section_id : null
    const l = ligne(sid, sid ? ordre.find((s) => s.id === sid)! : null)
    l.nombres.pourToi++; total.pourToi++
    if (e.chantier && !l.ids.pourToi.includes(e.chantier.id)) l.ids.pourToi.push(e.chantier.id)
  }

  // « Sans section » n'apparaît que si elle porte quelque chose.
  const lignes = [...parSection.values()].filter((l) => l.section !== null || Object.values(l.nombres).some((n) => n > 0))
  return { lignes, total }
}
