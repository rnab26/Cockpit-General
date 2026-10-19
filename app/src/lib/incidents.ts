// Le cockpit repère SEUL ce qui ne marche pas (19 oct. 2026, migration 0105, chantier 7cecd1f3).
// Raphaël : « Je veux que ce soit automatique […] je ne peux pas chaque fois que j'utilise le cockpit signaler tout ça. »
// La RÈGLE est en base (`cockpit.autocontrole_passe`, pg_cron toutes les 5 min, liste fermée de cas) : l'écran n'en recalcule aucune.
// Ici : seulement ce qu'il faut pour MONTRER la table `incidents` en UNE ligne (le plus ancien d'abord, panne avant « à savoir »),
// et pour régler les délais d'un projet (mêmes bornes que la base). Pur, vérifié par app/scripts/verifier-incidents.ts.
import type { Projet } from './types.ts'
import { ageEtHeure } from './dates.ts'

export type GraviteIncident = 'panne' | 'info'
export type CodeIncident =
  | 'reveil_refuse' | 'reveil_sans_effet' | 'attente_sans_reveil' | 'attente_reveil_eteint'
  | 'renfort_en_erreur' | 'session_sans_nouvelles' | 'cartes_non_retirees'

/** Une ligne de la table `incidents` (seulement les ouverts sont lus). `detail.geste` : le seul geste utile que la base propose. */
export interface Incident {
  id: string
  projet_id: string
  code: CodeIncident | string
  gravite: GraviteIncident | string
  cause: string
  detail: { geste?: string | null; raisons?: string[]; reveil_at?: string | null; session_url?: string | null; attend?: number; [k: string]: unknown } | null
  etat: 'ouvert' | 'resolu' | string
  depuis: string
  vu_at: string
}

/** Défauts des colonnes `projets.autocontrole_*` (comparés par verifier-base) ; bornes = celles de la contrainte et de `regler_autocontrole`. */
export const AUTOCONTROLE_DEFAUT = { delaiMin: 20, nettoyageMin: 60, gardeH: 6 } as const
export interface ReglageAutocontrole { delaiMin: number; nettoyageMin: number; gardeH: number }

export function reglageAutocontrole(p: Pick<Projet, 'autocontrole_delai_min' | 'autocontrole_nettoyage_min' | 'autocontrole_garde_h'> | null | undefined): ReglageAutocontrole {
  const ent = (v: unknown, def: number) => (typeof v === 'number' && Number.isInteger(v) ? v : def)
  return {
    delaiMin: ent(p?.autocontrole_delai_min, AUTOCONTROLE_DEFAUT.delaiMin),
    nettoyageMin: ent(p?.autocontrole_nettoyage_min, AUTOCONTROLE_DEFAUT.nettoyageMin),
    gardeH: ent(p?.autocontrole_garde_h, AUTOCONTROLE_DEFAUT.gardeH),
  }
}

/** Ce qu'il tape dans un champ : un entier, sinon null. */
export function entierSaisi(texte: string): number | null {
  const t = texte.trim()
  return /^\d{1,5}$/.test(t) ? Number(t) : null
}

/** La phrase qui dit pourquoi un réglage est refusé (mêmes bornes que la base), ou null s'il est bon. */
export function erreurAutocontrole(r: { delaiMin: number | null; nettoyageMin: number | null; gardeH: number | null }): string | null {
  if (r.delaiMin === null || r.delaiMin < 5 || r.delaiMin > 1440) return 'Délai avant d’alerter : un nombre de minutes entre 5 et 1440.'
  if (r.nettoyageMin === null || (r.nettoyageMin !== 0 && (r.nettoyageMin < 10 || r.nettoyageMin > 1440))) return 'Demandes sans suite : 0 (jamais) ou un nombre de minutes entre 10 et 1440.'
  if (r.gardeH === null || r.gardeH < 1 || r.gardeH > 168) return 'Durée d’une erreur de session : un nombre d’heures entre 1 et 168.'
  return null
}

export interface LigneIncident {
  /** L'incident mis en avant : la panne la plus ancienne ; s'il n'y a que des « à savoir », le plus ancien d'entre eux. */
  principal: Incident
  /** Début de la ligne : « Problème » pour une panne, « À savoir » pour un choix de Raphaël (réveil éteint). */
  prefixe: 'Problème' | 'À savoir'
  /** « Problème : du travail attend… » */
  texte: string
  /** « Trieur · depuis il y a 25 min · 18:12 » (le projet seulement quand l'écran en montre plusieurs). */
  meta: string
  /** Les autres incidents ouverts (montrés dans le détail, jamais en lignes de plus). */
  autres: Incident[]
  /** Le seul geste utile que la base propose, ou null. */
  geste: 'activer_session' | null
}

const rang = (i: Incident) => (i.gravite === 'info' ? 1 : 0)

/** Les incidents ouverts, rangés : pannes d'abord, puis du plus ancien au plus récent. */
export function ordreIncidents(incidents: readonly Incident[]): Incident[] {
  return incidents.filter((i) => i.etat === 'ouvert').sort((a, b) => rang(a) - rang(b) || a.depuis.localeCompare(b.depuis) || a.id.localeCompare(b.id))
}

/**
 * UNE ligne pour tout l'écran. `projetId` : la vue d'un projet ne montre que les siens. `nomsProjets` : seulement les projets que l'écran
 * connaît (un projet de test, ou supprimé, n'apparaît jamais). Aucun incident = null (rien à l'écran).
 */
export function ligneIncident(incidents: readonly Incident[], nomsProjets: ReadonlyMap<string, string>, projetId: string | null, now: Date): LigneIncident | null {
  const liste = ordreIncidents(incidents.filter((i) => nomsProjets.has(i.projet_id) && (!projetId || i.projet_id === projetId)))
  if (!liste.length) return null
  const [principal, ...autres] = liste
  const prefixe = principal.gravite === 'info' ? 'À savoir' : 'Problème'
  const avecProjet = !projetId && nomsProjets.size > 1
  const quand = ageEtHeure(principal.depuis, now)
  return {
    principal, prefixe, autres,
    texte: `${prefixe} : ${principal.cause}`,
    meta: [avecProjet ? nomsProjets.get(principal.projet_id) : null, quand ? `depuis ${quand}` : null].filter(Boolean).join(' · '),
    geste: principal.detail?.geste === 'activer_session' ? 'activer_session' : null,
  }
}
