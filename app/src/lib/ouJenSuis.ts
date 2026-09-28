// « Où j'en suis » : quatre nombres par section, pas cinq (leçon Jarvis :
// une cinquième colonne oblige à relire un tableau au lieu de lire une
// réponse). Bloqué / reporté ne compte nulle part, et une réservation
// expirée non plus — elle ressort à part, pour être libérée.
import type { Chantier, Message, Section } from './types.ts'
import { reservationValide } from './dates.ts'
import { dansFenetre, type Fenetre } from './fenetre.ts'

export interface QuatreNombres {
  pourToi: number   // questions/actions sans réponse + chantiers à vérifier
  bouge: number     // en cours, réservation valide
  dort: number      // libre / à trier / à cadrer, personne dessus
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

export function ouJenSuis(
  sections: readonly Section[],
  chantiers: readonly Chantier[],
  messages: readonly Pick<Message, 'chantier_id' | 'kind' | 'answered_at'>[],
  fenetre: Fenetre,
  now: Date = new Date(),
): { lignes: LigneOuJenSuis[]; total: QuatreNombres } {
  const attente = chantiersEnAttente(messages)
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
    if (c.etat === 'valide' && dansFenetre(c.valide_at, fenetre, now)) compte('livre')
    if (c.archived_at && c.etat !== 'valide') continue   // doublon ou archivé : hors jeu
    if (c.etat === 'valide') continue

    if (attente.has(c.id) || c.etat === 'a_verifier') compte('pourToi')
    if (c.etat === 'en_cours') {
      if (reservationValide(c.pris_jusqu_a, now)) compte('bouge')
      else compte('expirees')
    } else if (c.etat === 'libre' || c.etat === 'a_trier' || c.etat === 'a_cadrer') {
      if (!reservationValide(c.pris_jusqu_a, now)) compte('dort')
      else compte('bouge')  // réservé mais l'état n'a pas suivi : quelqu'un est dessus
    }
    // bloque / reporte : nulle part, volontairement.
  }
  // Les questions de projet (sans chantier) attendent aussi une réponse.
  const sansChantier = questionsSansChantier(messages)
  if (sansChantier) { ligne(null, null).nombres.pourToi += sansChantier; total.pourToi += sansChantier }

  // « Sans section » n'apparaît que si elle porte quelque chose.
  const lignes = [...parSection.values()].filter((l) => l.section !== null || Object.values(l.nombres).some((n) => n > 0))
  return { lignes, total }
}
