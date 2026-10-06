// Le tableau de bord (modèle A choisi par Raphaël le 29 sept. 2026 : « vas-y
// fais A + D ») : quatre tuiles et trois listes, pour TOUS les projets ou un
// seul. Les tuiles sont les LONGUEURS des listes, rien d'autre : le nombre
// qu'on touche et la liste qu'on voit ne peuvent pas diverger.
//   pour toi   = « À toi de jouer »        (entonnoir.aToi)
//   ça avance  = « Ça avance tout seul »   (entonnoir.caAvanceToutSeul, SEULEMENT ce qui a une
//                preuve de vie : session ou assistant qui travaille vraiment — Raphaël, 30 sept. :
//                « sinon c'est de la fausse information »)
//   à lancer   = « Prêt à lancer » + « Sans session dessus » (en cours, mais personne ne travaille) ; clé interne `enPause`
//   de côté    = chantiers mis de côté ou reportés (état « reporte », pas abandonnés) : ils n'étaient listés nulle part
//   fini       = certifiés dans la période (ouJenSuis.estFiniDans)
// Pur, vérifié par scripts/verifier-tableau-de-bord.ts.
import type { Activite, Chantier, Message, SessionClaude, Tache } from './types.ts'
import { aToi, aLancer, caAvanceToutSeul, horsChantier, type ElementAToi, type LigneALancer, type LigneCaAvance, type LigneHorsChantier } from './entonnoir.ts'
import { estFiniDans } from './ouJenSuis.ts'
import { quiTravaille, resumeTravail, type QuiTravaille, type Resume } from './sessions.ts'
import type { Fenetre } from './fenetre.ts'

export interface Donnees {
  chantiers: readonly Chantier[]
  messages: readonly Message[]
  activites: readonly Activite[]
  sessions: readonly SessionClaude[]
  taches: readonly Tache[]
}

export interface TableauDeBord {
  aToi: ElementAToi[]
  caAvance: LigneCaAvance[]
  /** En cours (ou réponse à reprendre) mais AUCUNE preuve de vie : jamais compté dans « ça avance », compté « en pause ». */
  sansSession: LigneCaAvance[]
  horsChantier: LigneHorsChantier[]
  pretALancer: LigneALancer[]
  fini: Chantier[]
  /** Mis de côté ou reportés (6 oct. 2026) : volontairement hors du travail, mais retrouvables d'un toucher. */
  deCote: Chantier[]
  /** Le détail par session (replié sous « Ça avance tout seul ») et son résumé chiffré. */
  travail: QuiTravaille[]
  resume: Resume
  tuiles: { pourToi: number; caAvance: number; enPause: number; deCote: number; fini: number }
}

export function tableauDeBord(
  d: Donnees, now: Date, silenceMs: number, fenetre: Fenetre, ordreProjets: readonly string[], projetId: string | null = null,
): TableauDeBord {
  const elements = aToi(d.chantiers, d.messages, projetId, d.activites, d.taches)
  const lignes = caAvanceToutSeul(d.chantiers, d.activites, d.messages, d.sessions, d.taches, now, silenceMs, projetId)
  const caAvance = lignes.filter((l) => l.vivant)
  const sansSession = lignes.filter((l) => !l.vivant)
  const travail = quiTravaille(d.sessions, d.taches, d.activites, d.chantiers, now, silenceMs, ordreProjets, projetId)
  const pretALancer = aLancer(d.chantiers, d.activites, d.messages, now, silenceMs, ordreProjets, projetId, d.taches).flatMap((g) => g.lignes)
  const fini = d.chantiers.filter((c) => (!projetId || c.projet_id === projetId) && estFiniDans(c, fenetre, now))
    .sort((a, b) => (b.valide_at ?? '').localeCompare(a.valide_at ?? ''))
  const deCote = d.chantiers.filter((c) => c.etat === 'reporte' && !c.archived_at && (!projetId || c.projet_id === projetId))
    .sort((a, b) => (a.reporte_jusqu_a ?? '9').localeCompare(b.reporte_jusqu_a ?? '9') || b.updated_at.localeCompare(a.updated_at))
  return {
    aToi: elements, caAvance, sansSession, horsChantier: horsChantier(travail), pretALancer, fini, deCote, travail, resume: resumeTravail(travail),
    tuiles: { pourToi: elements.length, caAvance: caAvance.length, enPause: pretALancer.length + sansSession.length, deCote: deCote.length, fini: fini.length },
  }
}

/** Ce que le tableau par section doit compter en « ça avance » / « en pause » : les mêmes chantiers que les listes. */
export function classesDe(t: Pick<TableauDeBord, 'caAvance' | 'sansSession' | 'pretALancer'>): { bouge: Set<string>; dort: Set<string> } {
  return { bouge: new Set(t.caAvance.map((l) => l.c.id)), dort: new Set([...t.pretALancer, ...t.sansSession].map((l) => l.c.id)) }
}
