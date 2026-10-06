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
  /** 0040 : 'auto' = ouvert par la chef toute seule ; file et seuil = ce qui l'a déclenché. */
  origine?: 'manuel' | 'auto'
  file?: number | null
  seuil?: number | null
  /** 0053 : demande en attente d'ouverture parce qu'un frein d'usage est actif (fin du frein). Le délai de 3 h ne court qu'après. */
  frein_jusqu_a?: string | null
  erreur_at?: string | null
  created_at: string
  vu_at: string | null
  fini_at: string | null
  archive_at: string | null
}

/** 0040 : LA règle de la file, calculée par la base (file_renforts). L'écran la lit, ne la recalcule pas. */
export interface EtatAuto {
  actif: boolean
  seuil: number
  /** Le seuil n'est pas réglé : il vaut « agents par session ». */
  seuil_defaut: boolean
  file: number
  niveau: NiveauSaturation | null
  /** Pourquoi rien ne s'ouvrirait tout seul (null = ça s'ouvre au prochain passage de la chef). */
  bloque: 'eteint' | 'reglage_zero' | 'frein' | 'plein' | null
  vivants: number
  max: number
}

export interface AttenteSection { section_id: string | null; section: string; n: number; ids: string[] }

export interface EtatRenforts {
  sessions_max: number
  agents_par_session: number
  /** Le projet a une session chef VIVANTE (0028 : vue depuis moins de 3 h) : c'est elle qui ouvre les sessions. */
  chef: boolean
  /** 0028 : le nom du projet, et la chef d'un autre projet qui ouvre à sa place quand il n'a pas de chef vivante. */
  projet?: string
  relais?: string | null
  relais_passage?: string | null
  auto?: EtatAuto
  /** 0053 : fin du frein d'usage actif (null = pas de frein). */
  frein_jusqu_a?: string | null
  /** 0053 : les lignes en erreur s'effacent seules après ce nombre d'heures (0 = jamais). */
  erreurs_efface_h?: number
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

/** Sans chef vivante (0028) : « en attente : aucune session <projet> active », et qui l'ouvrira. */
export function attenteSansChef(o: SansChef): string {
  const debut = `en attente : aucune session ${o.projet ?? 'de ce projet'} active`
  if (!o.relais) return `${debut} · ouvre Claude Code sur ce projet et écris-lui un message pour qu’il l’ouvre`
  return `${debut} · la session chef de ${o.relais} l’ouvre à son prochain passage${o.relais_passage ? ` (vers ${heure(o.relais_passage)})` : ''}`
}

/** Une ligne de renfort, en mots : l'état, et le détail. */
export function ligneRenfort(r: Renfort, chef: boolean, now: Date, sansChef: SansChef = {}): { code: CodeLigne; etat: string; detail: string } {
  const pl = (n: number, un: string, plus: string) => `${n} ${n > 1 ? plus : un}`
  // 0053 : un frein d'usage actif retient la demande ; ce n'est PAS une erreur (le délai de 3 h ne court qu'après sa fin).
  if (r.statut === 'demande' && r.frein_jusqu_a && new Date(r.frein_jusqu_a) > now) {
    return { code: 'demande', etat: 'En attente', detail: `en attente : frein d’usage jusqu’à ${heure(r.frein_jusqu_a)} · s’ouvre seul ensuite · ${pl(r.chantiers, 'chantier', 'chantiers')}` }
  }
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

export type NiveauSaturation = 'proche' | 'sature'

/**
 * Alerte « une session approche la saturation ». Le niveau, la file et le seuil viennent de la base
 * (etat_renforts.auto, migration 0040) : une seule règle, celle que la chef applique pour ouvrir.
 * `geste` = Raphaël doit agir (auto éteinte, ou renforts à 0). Sinon c'est une INFORMATION : l'automatisme
 * est en route, ou tout est déjà ouvert (« plein ») : on le dit, on ne demande rien.
 */
export function alerteSaturation(e: EtatRenforts): { niveau: NiveauSaturation; titre: string; conseil: string; geste: boolean } | null {
  const a = e.auto
  if (!a || !a.niveau) return null
  const file = `${a.file} chantier${a.file > 1 ? 's' : ''} en file (seuil ${a.seuil})`
  const etat = a.niveau === 'sature' ? 'Session saturée' : 'Session bientôt saturée'
  const renf = (n: number) => `${n} renfort${n > 1 ? 's' : ''}`
  if (a.bloque === 'reglage_zero') return { niveau: a.niveau, geste: true, titre: `${etat} : ${file}.`, conseil: 'Les renforts sont éteints : règle le nombre de sessions (Réglages) pour qu’ils s’ouvrent seuls.' }
  if (a.bloque === 'eteint') return { niveau: a.niveau, geste: true, titre: `${etat} : ${file}.`, conseil: 'L’ouverture automatique est éteinte (Réglages) : allume-la, ou touche « Lancer des renforts » ci-dessous.' }
  if (a.bloque === 'plein') return { niveau: a.niveau, geste: false, titre: `Maximum de renforts atteint : ${a.vivants} demandé${a.vivants > 1 ? 's' : ''} ou actif${a.vivants > 1 ? 's' : ''} sur ${a.max}.`, conseil: `${file}. Dès qu’une place se libère, un nouveau renfort s’ouvre tout seul au prochain passage de la chef. Rien à faire (pour en avoir davantage : monte le maximum dans Réglages).` }
  if (a.bloque === 'frein') return { niveau: a.niveau, geste: false, titre: `${etat} : ${file}.`, conseil: `Un frein d’usage est actif${e.frein_jusqu_a ? ` jusqu’à ${heure(e.frein_jusqu_a)}` : ''} : l’ouverture automatique reprend seule à sa fin. Rien à faire.` }
  return { niveau: a.niveau, geste: false, titre: `${etat} : ${file}.`, conseil: `Automatique : la session chef ouvre un renfort toute seule à son prochain passage (${renf(a.vivants)} déjà en route sur ${a.max}). Rien à faire.` }
}

/** Une ligne de réglage lisible : ce que fait l'ouverture automatique, et pourquoi elle ne ferait rien. */
export function libelleAuto(a: EtatAuto | undefined, frein?: string | null): string {
  if (!a) return 'Ouverture automatique : état indisponible.'
  if (!a.actif) return 'Ouverture automatique éteinte : les renforts ne s’ouvrent que sur ton bouton.'
  const base = `Ouverture automatique allumée : dès 1 chantier en attente, par paquets (une session par paquet de chantiers). File actuelle : ${a.file}.`
  if (a.bloque === 'reglage_zero') return `${base} Bloquée : sessions de renfort à 0.`
  if (a.bloque === 'frein') return `${base} En pause : frein d’usage actif${frein ? ` jusqu’à ${heure(frein)}` : ''}.`
  if (a.bloque === 'plein') return `${base} Maximum de renforts atteint.`
  return base
}

/** Erreur de saisie du seuil (vide = défaut), mêmes bornes que la base. */
export function erreurSeuilAuto(texte: string): string | null {
  if (texte.trim() === '') return null
  const n = Number(texte)
  return Number.isInteger(n) && n >= 1 && n <= 20 ? null : 'Seuil de la file : un nombre de 1 à 20 (vide = agents par session).'
}

/** « ouvert automatiquement à 14 h 32 parce que… » : null pour un renfort demandé à la main. */
export function origineRenfort(r: Renfort): string | null {
  if (r.origine !== 'auto') return null
  const pourquoi = r.file != null ? `${r.file} chantier${r.file > 1 ? 's' : ''} attendaient` : 'des chantiers attendaient'
  return `ouvert automatiquement à ${heure(r.created_at)} parce que ${pourquoi}`
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

/** Un renfort fini (« Terminé ») : plus rien à suivre, il ne va que dans l'historique. */
export function renfortTermine(r: Renfort): boolean {
  return r.statut !== 'demande' && r.statut !== 'actif' && r.statut !== 'erreur'
}

/**
 * UNE règle de l'écran Renforts : la liste ne montre que ce qui est vivant (en route, en attente) et les
 * vraies erreurs (avec « Relancer ») ; les renforts terminés vont dans « Historique (N) », replié.
 * L'ordre de la base est gardé. Rien n'est supprimé.
 */
export function partagerRenforts(renforts: Renfort[]): { visibles: Renfort[]; historique: Renfort[]; libelleHistorique: string } {
  const historique = renforts.filter(renfortTermine)
  return { visibles: renforts.filter((r) => !renfortTermine(r)), historique, libelleHistorique: `Historique (${historique.length})` }
}

/** Faut-il montrer le bloc ? (quelque chose attend, ou un renfort à suivre : un renfort terminé n'en est plus un) */
export function blocUtile(e: Pick<EtatRenforts, 'attente' | 'renforts'>): boolean {
  return e.attente.length > 0 || e.renforts.some((r) => !renfortTermine(r))
}

/** Économie des modèles (0035) : ce que la base porte (etat_modeles) et les libellés de l'écran. */
export type ModeleClaude = 'haiku' | 'sonnet' | 'opus'
export type EffortClaude = 'bas' | 'moyen' | 'eleve'
export interface EtatModeles {
  modele_code: ModeleClaude
  modele_leger: ModeleClaude
  effort: EffortClaude
  agents: number
  revue_h: number
  frein: { actif: boolean; raison?: string; jusqu_a?: string | null }
  /** Bascule automatique selon l'usage (0037) : palier 0 à 3, modèles réellement utilisés maintenant. */
  bascule_auto?: boolean
  palier?: number
  palier_raison?: string | null
  /** Réglages de la bascule (0045) : seuil du plein gaz en %, Haiku autorisé en dernier recours. */
  bascule_seuil_pct?: number
  bascule_haiku?: boolean
  /** Fenêtre d'usage mesurée (rate_limit_info) : type, remise à zéro, part écoulée. Jamais un % d'usage : il n'existe pas. */
  fenetre?: { type: string; reset_at: string | null; ecoule_pct: number | null } | null
  effectifs?: { modele_code: ModeleClaude; modele_leger: ModeleClaude; effort: EffortClaude; palier: number }
}
export const MODELES: { valeur: ModeleClaude; nom: string; aide: string }[] = [
  { valeur: 'haiku', nom: 'Haiku', aide: 'dernier recours' },
  { valeur: 'sonnet', nom: 'Sonnet', aide: 'équilibré' },
  { valeur: 'opus', nom: 'Opus', aide: 'le plus cher' },
]
export const EFFORTS: { valeur: EffortClaude; nom: string }[] = [
  { valeur: 'bas', nom: 'Bas' }, { valeur: 'moyen', nom: 'Moyen' }, { valeur: 'eleve', nom: 'Élevé' },
]
export const AGENTS_PARALLELE_MAX = 8
/** Mêmes bornes que regler_modeles (base). */
export function erreurReglageModeles(agents: number, revueH: number): string | null {
  if (!Number.isInteger(agents) || agents < 1 || agents > AGENTS_PARALLELE_MAX) return `Agents en parallèle : un nombre de 1 à ${AGENTS_PARALLELE_MAX}.`
  if (!Number.isInteger(revueH) || revueH < 1 || revueH > 168) return 'Revue « À toi » : de 1 à 168 heures.'
  return null
}
/** Même borne que regler_fermeture (0038) : minutes de grâce avant de fermer une session finie. */
export function erreurReglageFermeture(min: number): string | null {
  if (!Number.isInteger(min) || min < 0 || min > 1440) return 'Fermeture des sessions : de 0 à 1440 minutes.'
  return null
}
/** Mêmes bornes que regler_bascule_seuils (base). */
export function erreurSeuilBascule(seuil: number): string | null {
  if (!Number.isInteger(seuil) || seuil < 10 || seuil > 90) return 'Seuil du plein gaz : de 10 à 90 %.'
  return null
}
const NOM_FENETRE: Record<string, string> = { five_hour: 'fenêtre de 5 h', seven_day: 'fenêtre de 7 jours', seven_day_opus: 'fenêtre de 7 jours (Opus)', seven_day_sonnet: 'fenêtre de 7 jours (Sonnet)' }
/** Ce que dit l'écran de la bascule (0045) : l'effort d'abord, le modèle ensuite, Haiku en dernier ; jamais un nombre d'agents. */
export function libelleBascule(e: Pick<EtatModeles, 'bascule_auto' | 'palier' | 'palier_raison' | 'effectifs' | 'bascule_seuil_pct' | 'fenetre'>): string {
  if (e.bascule_auto === false) return 'Bascule automatique éteinte : les modèles réglés ci-dessus servent toujours.'
  const p = e.palier ?? 0
  const seuil = e.bascule_seuil_pct ?? 50
  const f = e.fenetre
  const fen = f ? ` ${NOM_FENETRE[f.type] ?? f.type}${f.ecoule_pct != null ? ` écoulée à ${Math.round(f.ecoule_pct)} %` : ''}.` : ''
  if (p === 0 || !e.effectifs) return `Bascule automatique : plein gaz, les modèles et l’effort réglés servent (rythme surveillé à partir de ${seuil} % de la fenêtre d’usage).${fen}`
  const nom = (m: ModeleClaude) => MODELES.find((x) => x.valeur === m)?.nom ?? m
  const effort = EFFORTS.find((x) => x.valeur === e.effectifs?.effort)?.nom.toLowerCase() ?? e.effectifs.effort
  const etape = p === 1 ? 'effort réduit d’abord' : p === 2 ? 'effort bas et modèle plus léger' : 'limite proche : Haiku en dernier recours'
  return `Bascule automatique, palier ${p} sur 3, ${etape} (${e.palier_raison ?? 'usage élevé'}) : code ${nom(e.effectifs.modele_code)}, lecture ${nom(e.effectifs.modele_leger)}, effort ${effort}. Le nombre d’agents ne change pas ; retour au plein gaz à la remise à zéro de la fenêtre ou dès que l’usage se calme.`
}
export function libelleFrein(f: EtatModeles['frein']): string {
  if (!f.actif) return 'Aucun frein : les agents travaillent normalement.'
  return `Frein posé à la main (${f.raison ?? 'sans raison'}) : 1 agent à la fois, aucune revue, aucun nouveau renfort.`
}

/** 0053 : une ligne en erreur se relance (nouvelle demande de la même section). Jamais une demande retenue par le frein. */
export function peutRelancer(l: { code: CodeLigne }): boolean {
  return l.code === 'erreur'
}

export function erreurEffacement(h: number): string | null {
  return Number.isInteger(h) && h >= 0 && h <= 168 ? null : 'Effacement des erreurs : un nombre d’heures de 0 (jamais) à 168.'
}
