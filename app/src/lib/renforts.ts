// Les RENFORTS (29 sept. 2026, migration 0024, décision D-10). Raphaël : « une
// option visible et bien distincte de tout le reste, au-dessus de tous les
// chantiers abandonnés, à l'arrêt ou libres […] : lancer une session par
// secteur, […] plusieurs agents dedans en même temps. 5 maximum par session
// […]. La règle : ne jamais se marcher dessus. »
//
// Tout ce qui se COMPTE vient de la base (etat_renforts : une seule règle,
// celle des sessions). Ce module ne fait que le dire en mots, et décider si le
// bouton est utilisable. Pur, vérifié par scripts/verifier-renforts.ts.
import { dateRelative } from './dates.ts'

export const SESSIONS_MAX = 4
export const AGENTS_MAX = 5

export type StatutRenfort = 'demande' | 'actif' | 'fini' | 'archive' | 'erreur'

export interface Renfort {
  id: string
  section_id: string | null
  section: string
  statut: StatutRenfort
  /** Tient encore sa section (demandé il y a moins de 3 h, ou signe de vie depuis moins de 3 h). */
  vivant: boolean
  session: string | null
  max_agents: number
  chantiers: number
  faits: number
  en_cours: number
  erreur: string | null
  created_at: string
  vu_at: string | null
  fini_at: string | null
  archive_at: string | null
}

export interface AttenteSection { section_id: string | null; section: string; n: number; ids: string[] }

export interface EtatRenforts {
  sessions_max: number
  agents_par_session: number
  /** Le projet a une session chef VIVANTE (0027 : vue depuis moins de 3 h) : c'est elle qui ouvre les sessions. */
  chef: boolean
  /** 0027 : le nom du projet, et la chef d'un autre projet qui ouvre à sa place quand il n'a pas de chef vivante. */
  projet?: string
  relais?: string | null
  relais_passage?: string | null
  chef_vu_at: string | null
  attente: AttenteSection[]
  renforts: Renfort[]
}

export interface ResultatDemande {
  demandes: { id: string; section: string; chantiers: number }[]
  vivants: number
  max: number
  agents: number
  raison: 'reglage_zero' | 'rien_en_attente' | 'plein' | null
}

export type CodeLigne = 'demande' | 'en_route' | 'termine' | 'erreur'

const heure = (iso: string) => { const d = new Date(iso); return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}` }

export interface SansChef { projet?: string; relais?: string | null; relais_passage?: string | null }

/** Sans chef vivante (0027) : « en attente : aucune session <projet> active », et qui l'ouvrira. */
export function attenteSansChef(o: SansChef): string {
  const debut = `en attente : aucune session ${o.projet ?? 'de ce projet'} active`
  if (!o.relais) return `${debut} · ouvre Claude Code sur ce projet et écris-lui un message pour qu’il l’ouvre`
  return `${debut} · la session chef de ${o.relais} l’ouvre à son prochain passage${o.relais_passage ? ` (vers ${heure(o.relais_passage)})` : ''}`
}

/** Une ligne de renfort, en mots : l'état, et le détail. */
export function ligneRenfort(r: Renfort, chef: boolean, now: Date, sansChef: SansChef = {}): { code: CodeLigne; etat: string; detail: string } {
  const pl = (n: number, un: string, plus: string) => `${n} ${n > 1 ? plus : un}`
  if (r.statut === 'erreur' || ((r.statut === 'demande' || r.statut === 'actif') && !r.vivant)) {
    return {
      code: 'erreur', etat: 'Erreur',
      detail: r.erreur ?? (r.statut === 'demande' ? 'Jamais ouvert : la session chef n’est pas passée en 3 h.' : 'Plus aucun signe de vie depuis 3 h.'),
    }
  }
  if (r.statut === 'demande') {
    return chef
      ? { code: 'demande', etat: 'Demande envoyée', detail: `la session chef l’ouvre à son prochain passage (au plus 1 h) · ${pl(r.chantiers, 'chantier', 'chantiers')}` }
      : { code: 'demande', etat: 'En attente', detail: attenteSansChef(sansChef) }
  }
  if (r.statut === 'actif') {
    const morceaux = [r.en_cours ? `${pl(r.en_cours, 'agent', 'agents')} au travail` : 'attend ses agents', `${pl(r.faits, 'chantier pris', 'chantiers pris')}`]
    if (r.vu_at) morceaux.push(`vu ${dateRelative(r.vu_at, now)}`)
    return { code: 'en_route', etat: 'En route', detail: morceaux.join(' · ') }
  }
  return {
    code: 'termine', etat: 'Terminé',
    detail: `${pl(r.faits, 'chantier pris', 'chantiers pris')}${r.statut === 'archive' ? ' · session fermée' : ' · fermeture de la session en cours'}`,
  }
}

/** Les renforts qui tiennent leur section (comptent dans la limite). */
export function renfortsEnRoute(e: Pick<EtatRenforts, 'renforts'>): Renfort[] {
  return e.renforts.filter((r) => (r.statut === 'demande' || r.statut === 'actif') && r.vivant)
}

/** Le bouton « Lancer des renforts » : utilisable ou non, et ce qu'il fera. */
export function boutonRenforts(e: EtatRenforts): { actif: boolean; aide: string; sections: number } {
  const enRoute = renfortsEnRoute(e).length
  const places = Math.max(0, e.sessions_max - enRoute)
  const sections = Math.min(places, e.attente.length)
  if (e.sessions_max === 0) return { actif: false, sections: 0, aide: 'Renforts éteints : règle le nombre de sessions (Réglages).' }
  if (!e.attente.length) return { actif: false, sections: 0, aide: enRoute ? 'Tout ce qui attend est déjà confié à un renfort.' : 'Rien n’attend : aucun renfort nécessaire.' }
  if (!places) return { actif: false, sections: 0, aide: `Déjà ${enRoute} renfort${enRoute > 1 ? 's' : ''} en route (maximum ${e.sessions_max}).` }
  return {
    actif: true, sections,
    aide: `${sections} session${sections > 1 ? 's' : ''} (une par section, la plus chargée d’abord), ${e.agents_par_session} agent${e.agents_par_session > 1 ? 's' : ''} au plus dans chacune.`,
  }
}

/** Le message après le clic : réussite (ce qui a été demandé) ou pourquoi rien. */
export function messageDemande(r: ResultatDemande): { ok: boolean; texte: string } {
  if (r.demandes.length) {
    const noms = r.demandes.map((d) => d.section).join(', ')
    return { ok: true, texte: `${r.demandes.length} renfort${r.demandes.length > 1 ? 's' : ''} demandé${r.demandes.length > 1 ? 's' : ''} : ${noms}. La session chef les ouvre à son prochain passage.` }
  }
  if (r.raison === 'reglage_zero') return { ok: false, texte: 'Renforts éteints (réglage à 0) : rien demandé.' }
  if (r.raison === 'plein') return { ok: false, texte: `Déjà ${r.vivants} renfort${r.vivants > 1 ? 's' : ''} en route (maximum ${r.max}) : rien de plus demandé.` }
  return { ok: false, texte: 'Rien n’attend : aucun renfort demandé.' }
}

/** Réglages valides (mêmes bornes que la base, regler_renforts). */
export function erreurReglageRenforts(sessions: number, agents: number): string | null {
  if (!Number.isInteger(sessions) || sessions < 0 || sessions > SESSIONS_MAX) return `Sessions de renfort : un nombre de 0 à ${SESSIONS_MAX}.`
  if (!Number.isInteger(agents) || agents < 1 || agents > AGENTS_MAX) return `Agents par session : un nombre de 1 à ${AGENTS_MAX}.`
  return null
}

/** Faut-il montrer le bloc ? (quelque chose attend, ou un renfort récent à suivre) */
export function blocUtile(e: Pick<EtatRenforts, 'attente' | 'renforts'>): boolean {
  return e.attente.length > 0 || e.renforts.length > 0
}
