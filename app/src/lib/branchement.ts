// « Ce projet est-il VRAIMENT branché au cockpit ? » — en une ligne, avec la preuve.
//
// Raphaël, 29 sept. 2026 : « sur FacePro, je n'arrive pas à voir si c'est
// branché réellement […] s'il prend réellement les demandes de mes sessions ».
// Trois preuves lues en base (migration 0012), jamais supposées :
//   - branchement_vu_at : le dernier démarrage de session qui a exécuté le hook
//     du cockpit dans ce projet ;
//   - branchement_maj(_at) : la dernière mise à jour automatique faite au démarrage ;
//   - embed_vu_at : le dernier appel du module embarqué depuis le site du projet.
import { dateRelative } from './dates.ts'
import type { SessionClaude } from './types.ts'

export interface PreuvesBranchement {
  branchement_vu_at?: string | null
  branchement_maj_at?: string | null
  embed_vu_at?: string | null
}

export interface LigneBranchement { texte: string; teinte: 'ok' | 'attention' | 'neutre' }

const JOUR = 24 * 3600_000

/**
 * Le cockpit est-il installé sur la branche PRINCIPALE du dépôt ? (14 oct. 2026, Raphaël : « pourquoi les projets ne sont pas
 * branchés ? ») Une session ne se connecte que si les hooks sont dans ce qu'elle ouvre : sur Melissa Nabet, le branchement du
 * 29 sept. était resté sur une branche de travail, jamais fusionné sur `main` ; chaque session ouverte sur `main` démarrait donc
 * sans cockpit, et l'écran disait seulement « Plus aucune session depuis 15 j », sans la cause. On la LIT : le fichier de
 * réglages des hooks de `main` (lecture anonyme, dépôts publics) porte la variable COCKPIT_PROJET quand le cockpit y est installé.
 */
export type CockpitSurMain = 'present' | 'absent' | 'inconnu'
export const SIGNATURE_COCKPIT = 'COCKPIT_PROJET'

export interface LectureReglagesMain {
  /** Code HTTP de la lecture de `.claude/settings.json` sur la branche principale (0 : lecture impossible). */
  statut: number
  texte: string | null
  /** Seulement après un 404 : le dépôt répond-il à GitHub sans compte (public) ? null : on ne sait pas. */
  depotPublic: boolean | null
}

/** « absent » seulement quand on est SÛR : un dépôt privé répond aussi 404, et on ne devine jamais. */
export function lireCockpitSurMain(l: LectureReglagesMain): CockpitSurMain {
  if (l.statut === 200 && l.texte !== null) return l.texte.includes(SIGNATURE_COCKPIT) ? 'present' : 'absent'
  if (l.statut === 404 && l.depotPublic === true) return 'absent'
  return 'inconnu'
}

/**
 * Le même propriétaire que le moteur ? Un dépôt d'autrui (voies « invisible » ou « branches » de brancher.sh) n'a, par choix, pas
 * le cockpit sur sa branche principale : y dire « pas installé » serait faux.
 */
export function memeProprietaire(depot: string | null | undefined, reference: string | null | undefined): boolean {
  const proprio = (d?: string | null) => (d ?? '').split('/')[0].trim().toLowerCase()
  return !!proprio(depot) && proprio(depot) === proprio(reference)
}

export interface ContexteBranchement {
  /** Les sessions du projet (admin) : il faut une VRAIE session, comme pour l'icône (estBranche). Absent : la règle d'avant (membre). */
  sessions?: readonly Pick<SessionClaude, 'demarre_at' | 'vu_at' | 'fin_at'>[]
  surMain?: CockpitSurMain | null
}

export function etatBranchement(p: PreuvesBranchement, chantiersDeSessions: number, now: Date = new Date(), ctx: ContexteBranchement = {}): LigneBranchement[] {
  const lignes: LigneBranchement[] = []
  const t = (iso?: string | null) => (iso ? new Date(iso).getTime() : NaN)
  const vu = t(p.branchement_vu_at)
  let branche = false
  if (Number.isNaN(vu)) {
    lignes.push({ texte: 'Aucune session Claude n’a encore démarré avec le cockpit dans ce projet', teinte: 'attention' })
  } else {
    const quand = dateRelative(p.branchement_vu_at!, now) || 'à l’instant'
    const recent = now.getTime() - vu < JOUR
    // La MÊME règle que l'icône « branché » : un démarrage récent du hook ne suffit pas, il faut une vraie session (13 oct. 2026).
    const reelle = ctx.sessions === undefined || ctx.sessions.some((s) => sessionReelle(s, now))
    // Une vraie session vivante prouve le branchement même si le dernier DÉMARRAGE date de plus de 24 h (Mélissa : 2 sessions vivantes, démarrées il y a 3 j).
    const vivante = ctx.sessions !== undefined && ctx.sessions.some((s) => sessionReelle(s, now))
    branche = (recent && reelle) || vivante
    if (recent && !reelle && !vivante) {
      lignes.push({ texte: `Le cockpit a répondu ${quand}, mais aucune vraie session n’a encore tourné dans ce projet (un essai à la main ne compte pas)`, teinte: 'attention' })
    } else {
      lignes.push({
        texte: `${recent || vivante ? 'Sessions branchées' : 'Plus aucune session depuis'} — dernier démarrage ${quand} · ${chantiersDeSessions} chantier${chantiersDeSessions > 1 ? 's' : ''} ouvert${chantiersDeSessions > 1 ? 's' : ''} depuis les sessions`,
        teinte: recent || vivante ? 'ok' : 'attention',
      })
    }
  }
  // La cause, quand on peut la lire. « Pas sur main » se dit même si une session vient de se brancher : elle tournait sur une branche
  // de travail qui a le cockpit, et la prochaine session ouverte sur main n'en aura pas.
  if (ctx.surMain === 'absent') {
    lignes.push({ texte: 'Le cockpit n’est pas installé sur la branche principale (main) du dépôt : une session qui démarre dessus ne s’y connecte pas. Pour l’installer, dis « branche le cockpit » dans une session ouverte sur ce dépôt.', teinte: 'attention' })
  } else if (!branche && ctx.surMain === 'present') {
    lignes.push({ texte: 'Le cockpit est bien installé sur la branche principale : la prise s’allume dès qu’une vraie session démarre dans ce projet.', teinte: 'neutre' })
  }
  if (!branche && ctx.surMain !== 'absent') {
    // Le remède, dit une fois (16 oct. 2026 : « comment y remédier, je ne comprends pas »).
    lignes.push({ texte: 'Pour le brancher : ouvre une session Claude Code sur le dépôt de ce projet et dis « branche le cockpit » ; la prise s’allume au démarrage de la session suivante.', teinte: 'attention' })
  }
  const maj = t(p.branchement_maj_at)
  if (!Number.isNaN(maj) && now.getTime() - maj < JOUR) {
    lignes.push({ texte: `Mis à jour automatiquement ${dateRelative(p.branchement_maj_at!, now) || 'à l’instant'} (nouvelle version du cockpit)`, teinte: 'neutre' })
  }
  const site = t(p.embed_vu_at)
  lignes.push(Number.isNaN(site)
    ? { texte: 'Module du site : pas encore installé (les utilisateurs du site ne peuvent pas encore envoyer de demande)', teinte: 'neutre' }
    : { texte: `Module du site : vu ${dateRelative(p.embed_vu_at!, now) || 'à l’instant'}`, teinte: 'ok' })
  return lignes
}

/**
 * Icône « branché » de la liste des projets : vrai seulement sur une PREUVE
 * récente (une session a démarré avec le hook dans les 24 h), jamais supposé.
 * Même seuil que la ligne « Sessions branchées » d'etatBranchement.
 */
export function estBranche(p: PreuvesBranchement, now: Date = new Date(), sessions?: readonly Pick<SessionClaude, 'demarre_at' | 'vu_at' | 'fin_at'>[]): boolean {
  const vu = p.branchement_vu_at ? new Date(p.branchement_vu_at).getTime() : NaN
  if (sessions !== undefined && sessions.some((s) => sessionReelle(s, now))) return true
  if (Number.isNaN(vu) || now.getTime() - vu >= JOUR) return false
  // Avec la liste des sessions du projet (admin) : il faut AUSSI une vraie session. Le 13 oct. 2026, trois « démarrages »
  // de 0 s (préchauffage du conteneur, branche main, déduit) posaient `branchement_vu_at` : l'icône restait verte
  // alors que la session de Raphaël, ouverte sur deux dépôts, n'avait aucun hook et n'existait pas en base.
  return sessions === undefined || sessions.some((s) => sessionReelle(s, now))
}

/** Une VRAIE session : encore vivante, ou qui a duré au moins 2 minutes ; vue dans les dernières 24 h. Un « démarrage » de 0 s ne prouve rien. */
export const DUREE_REELLE_MS = 2 * 60_000
export function sessionReelle(s: Pick<SessionClaude, 'demarre_at' | 'vu_at' | 'fin_at'>, now: Date = new Date()): boolean {
  const vu = new Date(s.vu_at).getTime()
  if (Number.isNaN(vu) || now.getTime() - vu >= JOUR) return false
  if (!s.fin_at) return true
  return new Date(s.fin_at).getTime() - new Date(s.demarre_at).getTime() >= DUREE_REELLE_MS
}
