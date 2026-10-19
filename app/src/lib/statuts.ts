/**
 * Statuer un chantier (« Ça marche », « Ça ne marche pas », « Claude vérifie », mettre de côté, abandonner, relancer) :
 * UNE ligne à l'écran qui change TOUT DE SUITE, comme une carte qui passe « répondue » (reponseCarte.ts).
 *
 * Raphaël (19 oct. 2026, chantier fa297cc4) : « lorsque je statue une tâche […] elle ne repart pas bien dans les compteurs,
 * logiquement elle est censée se retirer d'un compteur et se déplacer dans la bonne section ». Cause lue dans le code :
 * ces gestes écrivaient en base puis attendaient une relecture réseau (jusqu'à deux passages de six tables) avant que
 * les compteurs bougent ; seules les cartes de question/action étaient posées à l'écran sur-le-champ.
 *
 * Ces fonctions pures reproduisent, ligne pour ligne, ce que font les fonctions de la base (certifier_chantier 0004,
 * poser_verification 0056, mettre_de_cote / abandonner_chantier 0028). `updated_at` n'est JAMAIS touché ici : il sert de
 * curseur à la lecture incrémentale (deltaDonnees.ts), la vraie ligne le posera. Si l'écriture échoue, l'écran remet
 * la ligne d'avant ; sinon la vraie ligne (direct ou relecture) remplace celle-ci.
 */
import type { Chantier } from './types.ts'

/** `certifier_chantier` : « à vérifier » → validé, archivé (« Fini »), libéré. Une autre étape ne change rien. */
export function apresCertification(c: Chantier, par: string, maintenant: string): Chantier {
  if (c.etat !== 'a_verifier') return c
  return { ...c, etat: 'valide', valide_at: maintenant, valide_par: par, archived_at: c.archived_at ?? maintenant, pris_par: null, pris_jusqu_a: null }
}

/** `poser_verification` : le chantier reste « à vérifier » mais Claude juge : il quitte « à tester » pour « ça avance ». */
export function apresVerificationDemandee(c: Chantier, maintenant: string): Chantier {
  if (c.etat !== 'a_verifier' || c.archived_at) return c
  return { ...c, verif_demandee_at: maintenant, verdict_ok: null, verdict_texte: null, verdict_at: null }
}

/** `mettre_de_cote` : reporté (avec date, il revient seul), plus réservé, plus archivé. */
export function apresMiseDeCote(c: Chantier, jusqua: string | null): Chantier {
  return { ...c, etat: 'reporte', reporte_jusqu_a: jusqua, pris_par: null, pris_jusqu_a: null, archived_at: null }
}

/** `abandonner_chantier` : archivé, sans date de retour. */
export function apresAbandon(c: Chantier, maintenant: string): Chantier {
  return { ...c, etat: 'reporte', reporte_jusqu_a: null, pris_par: null, pris_jusqu_a: null, archived_at: maintenant }
}

/** « Relancer maintenant » : libre, prêt à être pris (« Pour Claude »). */
export function apresRelance(c: Chantier): Chantier {
  return { ...c, etat: 'libre', reporte_jusqu_a: null, archived_at: null }
}
