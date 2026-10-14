/**
 * L'accueil simple (13 oct. 2026, Raphaël : « il y a encore trop d'informations […] fais au plus simple possible,
 * pour que je puisse faire travailler des gens sur le cockpit »). Les six boxes (compactes), puis trois blocs au lieu du
 * tableau, des pastilles et des quatre sections :
 *   À toi     — ce que Claude attend de toi (les DEMANDES : entonnoir.estDemande), cinq lignes au plus ;
 *               derrière, une ligne repliée « N livrés à tester » (jamais comptés « à répondre ») ;
 *   En cours  — ce sur quoi Claude travaille vraiment (avec sa barre), et ce qui attend une session ;
 *   Livré     — les derniers chantiers certifiés.
 * La vue PAR DÉFAUT est la vue détaillée : les boxes avec le nombre de chantiers, le tableau par section, les barres de
 * progression (« Ça avance tout seul », « Prêt à lancer »), les renforts, les réglages. Le 13 oct. j'avais mis l'accueil simple par
 * défaut sans qu'on me le demande et fait disparaître ces boxes et ces barres ; Raphaël : « j'en ai besoin ». L'accueil
 * simple reste à un toucher (« Vue simple »), retenu par appareil. Règles pures, vérifiées par scripts/verifier-vue-accueil.ts.
 */

export type VueAccueil = 'simple' | 'detaillee'

export const CLE_VUE_ACCUEIL = 'cockpit_accueil'
export const VUE_ACCUEIL_DEFAUT: VueAccueil = 'detaillee'
/** Événement qui prévient les écrans (l'accueil et le choix de vue) qu'elle a changé sur cet appareil. */
export const EVENEMENT_VUE_ACCUEIL = 'cockpit-accueil'

/** Lecture défensive : toute valeur inconnue (vide, ancienne, corrompue) donne la vue par défaut. */
export function lireVueAccueil(brut: unknown): VueAccueil {
  return brut === 'detaillee' ? 'detaillee' : brut === 'simple' ? 'simple' : VUE_ACCUEIL_DEFAUT
}

/** Combien de lignes chaque bloc montre avant « Voir les N autres » : le but est de ne jamais noyer l'écran. */
export const VISIBLES_ACCUEIL = { demandes: 5, enCours: 5, livre: 3, aTester: 5 } as const

/** « 1 livré à tester » / « 12 livrés à tester » : le libellé de la ligne repliée sous « À toi ». */
export function libelleATester(n: number): string {
  return `${n} livré${n > 1 ? 's' : ''} à tester`
}

/** « 1 chantier attend une session » / « 3 chantiers attendent une session » : la ligne sous « En cours ». */
export function libelleEnAttente(n: number): string {
  return n > 1 ? `${n} chantiers attendent une session` : `${n} chantier attend une session`
}

/**
 * « Personne ne travaille » ne doit pas mentir : quand des conversations ou des assistants travaillent mais qu'aucun chantier
 * n'a de barre, la phrase le dit (« Claude travaille sur ce projet (2 conversations), mais sans chantier précis »).
 * Rien (null) quand personne ne travaille vraiment.
 */
export function phraseSansChantier(r: { sessions: number; agents: number }, projet: boolean): string | null {
  const morceaux: string[] = []
  if (r.sessions > 0) morceaux.push(`${r.sessions} conversation${r.sessions > 1 ? 's' : ''}`)
  if (r.agents > 0) morceaux.push(`${r.agents} assistant${r.agents > 1 ? 's' : ''}`)
  return morceaux.length ? `Claude travaille ${projet ? 'sur ce projet ' : ''}(${morceaux.join(' · ')}), mais sans chantier précis.` : null
}
