// Le tableau de bord (modèle A choisi par Raphaël le 29 sept. 2026 : « vas-y
// fais A + D ») : quatre tuiles et trois listes, pour TOUS les projets ou un
// seul. Les tuiles sont les LONGUEURS des listes, rien d'autre : le nombre
// qu'on touche et la liste qu'on voit ne peuvent pas diverger.
//   pour toi   = « À toi de jouer »        (entonnoir.aToi)
//   ça avance  = « Ça avance tout seul »   (entonnoir.caAvanceToutSeul, présence honnête)
//   en pause   = « Prêt à lancer »         (entonnoir.aLancer : personne dessus, pas commencé)
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
  horsChantier: LigneHorsChantier[]
  pretALancer: LigneALancer[]
  fini: Chantier[]
  /** Le détail par session (replié sous « Ça avance tout seul ») et son résumé chiffré. */
  travail: QuiTravaille[]
  resume: Resume
  tuiles: { pourToi: number; caAvance: number; enPause: number; fini: number }
}

export function tableauDeBord(
  d: Donnees, now: Date, silenceMs: number, fenetre: Fenetre, ordreProjets: readonly string[], projetId: string | null = null,
): TableauDeBord {
  const elements = aToi(d.chantiers, d.messages, projetId)
  const caAvance = caAvanceToutSeul(d.chantiers, d.activites, d.messages, d.sessions, d.taches, now, silenceMs, projetId)
  const travail = quiTravaille(d.sessions, d.taches, d.activites, d.chantiers, now, silenceMs, ordreProjets, projetId)
  const pretALancer = aLancer(d.chantiers, d.activites, d.messages, now, silenceMs, ordreProjets, projetId, d.taches).flatMap((g) => g.lignes)
  const fini = d.chantiers.filter((c) => (!projetId || c.projet_id === projetId) && estFiniDans(c, fenetre, now))
    .sort((a, b) => (b.valide_at ?? '').localeCompare(a.valide_at ?? ''))
  return {
    aToi: elements, caAvance, horsChantier: horsChantier(travail), pretALancer, fini, travail, resume: resumeTravail(travail),
    tuiles: { pourToi: elements.length, caAvance: caAvance.length, enPause: pretALancer.length, fini: fini.length },
  }
}

/** Ce que le tableau par section doit compter en « ça avance » / « en pause » : les mêmes chantiers que les listes. */
export function classesDe(t: Pick<TableauDeBord, 'caAvance' | 'pretALancer'>): { bouge: Set<string>; dort: Set<string> } {
  return { bouge: new Set(t.caAvance.map((l) => l.c.id)), dort: new Set(t.pretALancer.map((l) => l.c.id)) }
}
