// Interrupteur « Branché / En pause » d'un projet (16 oct. 2026, migration 0093, chantier 975118ca).
// Raphaël : « un bouton Branché / En pause. En pause = aucune session ni agent ne travaille sur ce projet […] mais rien n'est
// supprimé ni perdu ; on peut le rallumer d'un toucher. » La RÈGLE est en base (`projets.en_pause`, `cockpit.projet_en_pause`) ;
// ici, seulement ce que l'écran en dit. ATTENTION : « branché » (l'icône prise, lib/branchement.ts) = une session a démarré
// récemment ; « en pause » = un réglage voulu. Deux choses différentes, jamais mélangées.
import type { Chantier, Projet, Tache } from './types.ts'
import { travailEnCours } from './autonome.ts'
import { ageEtHeure } from './dates.ts'

/** Vrai si le projet est mis en pause par Raphaël. Une colonne absente (avant 0093) = pas en pause. */
export function enPause(p: Pick<Projet, 'en_pause'> | null | undefined): boolean {
  return !!p?.en_pause
}

/** Les projets du menu en deux groupes : ceux qui travaillent, ceux qui sont en pause (l'ordre reçu est gardé dans chaque groupe). */
export function groupesPause<T extends Pick<Projet, 'en_pause'>>(projets: readonly T[]): { branches: T[]; enPause: T[] } {
  return { branches: projets.filter((p) => !enPause(p)), enPause: projets.filter((p) => enPause(p)) }
}

/** Phrase de l'état, en mots simples, sous l'interrupteur. */
export function phraseEtat(p: Pick<Projet, 'en_pause' | 'pause_at' | 'pause_par' | 'pause_raison'>, now: Date = new Date()): string {
  if (!enPause(p)) return 'Branché : les sessions et agents de Claude peuvent travailler sur ce projet.'
  const quand = p.pause_at ? ` depuis ${ageEtHeure(p.pause_at, now)}` : ''
  const qui = p.pause_par ? ` par ${p.pause_par}` : ''
  const raison = p.pause_raison ? ` (${p.pause_raison})` : ''
  return `En pause${quand}${qui}${raison} : Claude ne travaille pas dessus. Rien n’est supprimé.`
}

/** Ce qu'une pause arrête et ce qu'elle laisse : le texte de la confirmation. */
export const PAUSE_ARRETE = [
  'plus aucune session chef, aucun agent ni renfort ne démarre',
  'aucun réveil automatique',
  'aucun chantier n’est pris tout seul (mode autonome compris)',
]
export const PAUSE_GARDE = 'Rien n’est supprimé : chantiers, discussions, réglages restent tels quels. Tu rallumes d’un toucher.'

/** Phrase sur le travail déjà en cours : il finit, rien de nouveau ne démarre. */
export function phraseEnCours(enCours: boolean): string {
  return enCours
    ? 'Du travail est en cours sur ce projet : il va au bout, rien de nouveau ne démarre ensuite.'
    : 'Aucun travail en cours sur ce projet en ce moment.'
}

/** Du travail est-il en cours (même règle que le mode autonome : `travailEnCours`) ? */
export function projetTravaille(chantiers: readonly Chantier[], taches: readonly Tache[], projetId: string, now: Date = new Date()): boolean {
  return travailEnCours(chantiers, taches, projetId, now)
}

/** Résumé de la liste en une ligne : « 3 branchés · 1 en pause ». */
export function resumePauses(projets: readonly Pick<Projet, 'en_pause'>[]): string {
  const g = groupesPause(projets)
  const b = `${g.branches.length} branché${g.branches.length > 1 ? 's' : ''}`
  return g.enPause.length ? `${b} · ${g.enPause.length} en pause` : b
}
