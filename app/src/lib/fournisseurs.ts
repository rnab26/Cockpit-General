/**
 * Recherche des fournisseurs de factures (0084, chantier 07258fe5) : UNE source de règles pour le bloc « Fournisseurs de factures » de
 * l'écran Coûts — état de la demande, onglets, rapprochement avec les prestataires déjà créés.
 * Raphaël : « un bouton où j'appuie et ça va chercher tous les noms des fournisseurs où je suis susceptible d'avoir des factures, et
 * comme ça on actualise ». La recherche elle-même se fait dans une session Claude qui a Gmail (scripts/chercher-fournisseurs.py).
 */
import { dateRelative } from './dates.ts'
import { jourLisible, type Service } from './depenses.ts'

export type StatutRecherche = 'en_attente' | 'en_cours' | 'terminee' | 'echec' | 'annulee'
export type StatutFournisseur = 'nouveau' | 'suivi' | 'ignore'
export type Onglet = StatutFournisseur

export interface Recherche {
  id: string; projet_id: string; statut: StatutRecherche; demandee_par: string | null; demandee_at: string
  pris_par: string | null; pris_at: string | null; fini_at: string | null; trouves: number | null; nouveaux: number | null; note: string | null
}
export interface Fournisseur {
  id: string; projet_id: string; cle: string; nom: string; domaine: string; expediteur: string | null; mails: number
  premier_mail: string | null; dernier_mail: string | null; exemple_objet: string | null; lecteur: boolean
  statut: StatutFournisseur; service_id: string | null; recherche_id: string | null; created_at: string; updated_at: string
}

/** Au-delà de ce délai sans session, la demande en attente le dit (affichage seulement : rien n'est annulé tout seul). */
export const ATTENTE_LONGUE_H = 6

export const ONGLETS: readonly { valeur: Onglet; libelle: string }[] = [
  { valeur: 'nouveau', libelle: 'Nouveaux' }, { valeur: 'suivi', libelle: 'Suivis' }, { valeur: 'ignore', libelle: 'Ignorés' },
]

const entier = (v: unknown): number | null => { const n = typeof v === 'number' ? v : Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : Math.trunc(n) }
export function lireRecherche(r: Record<string, unknown>): Recherche {
  return { ...(r as unknown as Recherche), trouves: entier(r.trouves), nouveaux: entier(r.nouveaux) }
}
export function lireFournisseur(r: Record<string, unknown>): Fournisseur {
  return { ...(r as unknown as Fournisseur), mails: entier(r.mails) ?? 0, lecteur: r.lecteur === true }
}

export const demandeOuverte = (r: Pick<Recherche, 'statut'> | null): boolean => r !== null && (r.statut === 'en_attente' || r.statut === 'en_cours')

export type NiveauRecherche = 'aucune' | 'attente' | 'cours' | 'ok' | 'echec'
export interface EtatRecherche { niveau: NiveauRecherche; titre: string; detail: string | null; ouverte: boolean }

/** Ce que l'écran dit de la DERNIÈRE demande (null = jamais demandée). Une demande annulée se lit comme « rien en cours ». */
export function etatRecherche(r: Recherche | null, now: Date): EtatRecherche {
  const note = r?.note?.trim() || null
  if (r === null || r.statut === 'annulee') {
    return { niveau: 'aucune', titre: r ? `Dernière demande annulée ${dateRelative(r.fini_at ?? r.demandee_at, now)}.` : 'Aucune recherche faite.', detail: null, ouverte: false }
  }
  if (r.statut === 'en_attente') {
    const heures = (now.getTime() - Date.parse(r.demandee_at)) / 3_600_000
    return {
      niveau: 'attente', titre: `Demande envoyée ${dateRelative(r.demandee_at, now)}.`, ouverte: true,
      detail: heures > ATTENTE_LONGUE_H
        ? 'Toujours en attente : aucune session Claude avec Gmail ne l’a prise. Ouvre une session Claude qui a Gmail, ou annule la demande.'
        : 'Claude la traite dès qu’une session avec Gmail est ouverte.',
    }
  }
  if (r.statut === 'en_cours') return { niveau: 'cours', titre: `Claude cherche… (commencé ${dateRelative(r.pris_at ?? r.demandee_at, now)}).`, detail: null, ouverte: true }
  if (r.statut === 'echec') return { niveau: 'echec', titre: `La dernière recherche a échoué ${dateRelative(r.fini_at ?? r.demandee_at, now)}.`, detail: note, ouverte: false }
  return { niveau: 'ok', titre: `Dernière recherche : ${dateRelative(r.fini_at ?? r.demandee_at, now)}.`, detail: note, ouverte: false }
}

export function compterParStatut(l: readonly Fournisseur[]): Record<StatutFournisseur, number> {
  const c: Record<StatutFournisseur, number> = { nouveau: 0, suivi: 0, ignore: 0 }
  for (const f of l) c[f.statut] += 1
  return c
}
/** Un onglet : les plus fréquents d'abord (les nouveaux), puis par nom. */
export function dansOnglet(l: readonly Fournisseur[], onglet: Onglet): Fournisseur[] {
  return l.filter((f) => f.statut === onglet).sort((a, b) => b.mails - a.mails || a.nom.localeCompare(b.nom, 'fr'))
}

export function libelleMails(f: Pick<Fournisseur, 'mails' | 'dernier_mail'>): string {
  const n = `${f.mails} mail${f.mails > 1 ? 's' : ''}`
  const dernier = jourLisible(f.dernier_mail)
  return dernier ? `${n} · dernier le ${dernier}` : n
}

/** Comparaison de noms sans accents, majuscules ni ponctuation. */
export function nomNormalise(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
/** Un fournisseur dont le nom de marque diffère de celui du prestataire (Anthropic vend « Claude »). Domaine -> noms de prestataires possibles. */
export const ALIAS_PRESTATAIRES: Record<string, readonly string[]> = { 'anthropic.com': ['claude'] }

/** Le prestataire déjà créé pour ce fournisseur (même nom, ou alias connu), pour ne jamais en créer un deuxième. */
export function prestatairePour(f: Pick<Fournisseur, 'nom' | 'domaine'>, services: readonly Pick<Service, 'id' | 'nom' | 'archived_at'>[]): Pick<Service, 'id' | 'nom'> | null {
  const noms = new Set([nomNormalise(f.nom), ...(ALIAS_PRESTATAIRES[f.domaine] ?? []).map(nomNormalise)])
  return services.find((s) => !s.archived_at && noms.has(nomNormalise(s.nom))) ?? null
}
/** La devise la plus probable d'un nouveau prestataire (réglable ensuite avec son crayon) : un domaine israélien facture en shekels. */
export const deviseProbable = (f: Pick<Fournisseur, 'domaine'>): string => (/\.il$/.test(f.domaine) ? 'ILS' : 'USD')

// ---------------------------------------------------------------------------------------------------------- actions groupées
// Une liste de fournisseurs se trie à plusieurs : « Choisir plusieurs » coche des lignes, une barre en bas propose l'action de l'onglet.

export type ActionLot = 'suivre' | 'ignorer' | 'remettre'

/** Les actions groupées d'un onglet. « Suivis » n'en a pas : un fournisseur suivi est déjà un prestataire (on le gère dans Prestataires). */
export function actionsDuLot(onglet: Onglet): ActionLot[] {
  return onglet === 'nouveau' ? ['suivre', 'ignorer'] : onglet === 'ignore' ? ['remettre'] : []
}
/** Le statut que posent « Ignorer » et « Remettre » (« Suivre » crée ou relie un prestataire : il passe par sa propre règle). */
export const STATUT_APRES_LOT: Record<'ignorer' | 'remettre', StatutFournisseur> = { ignorer: 'ignore', remettre: 'nouveau' }

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`
/** Le texte d'un bouton de la barre : « Ignorer (3) ». */
export function libelleLot(action: ActionLot, n: number): string {
  return `${action === 'suivre' ? 'Suivre' : action === 'ignorer' ? 'Ignorer' : 'Remettre dans la liste'} (${n})`
}
/** Ce que dit le message après une action groupée réussie. */
export function phraseLot(action: 'ignorer' | 'remettre', n: number): string {
  return action === 'ignorer'
    ? `${pluriel(n, 'fournisseur ignoré', 'fournisseurs ignorés')} : ${n > 1 ? 'ils ne reviendront' : 'il ne reviendra'} pas dans « Nouveaux ».`
    : `${pluriel(n, 'fournisseur remis', 'fournisseurs remis')} dans « Nouveaux ».`
}
/** Après « Suivre » en lot : combien de prestataires créés, combien reliés à un prestataire déjà là, combien ont échoué. */
export function phraseSuivreLot(crees: number, relies: number, echecs: number): string {
  const faits = crees + relies
  const dit: string[] = []
  if (faits) {
    const detail = [crees ? pluriel(crees, 'prestataire créé', 'prestataires créés') : '', relies ? pluriel(relies, 'relié à un prestataire déjà là', 'reliés à des prestataires déjà là') : ''].filter(Boolean).join(', ')
    dit.push(`${pluriel(faits, 'fournisseur suivi', 'fournisseurs suivis')} (${detail}).`)
  }
  if (echecs) dit.push(`${pluriel(echecs, 'n’a pas pu être suivi', 'n’ont pas pu être suivis')} : ${echecs > 1 ? 'ils restent cochés' : 'il reste coché'}, touche « Suivre » pour réessayer.`)
  return dit.join(' ')
}
/** Ne garder cochés que les fournisseurs encore visibles (une ligne qui change d'onglet, ou disparaît, se décoche). Rend le MÊME ensemble si rien ne change. */
export function cochesVisibles(coches: ReadonlySet<string>, visibles: readonly Pick<Fournisseur, 'id'>[]): ReadonlySet<string> {
  const ids = new Set(visibles.map((f) => f.id))
  const gardes = [...coches].filter((id) => ids.has(id))
  return gardes.length === coches.size ? coches : new Set(gardes)
}
/** « Tout choisir » coche toute la liste ; quand tout est déjà coché, le bouton devient « Aucun ». */
export function toutChoisi(coches: ReadonlySet<string>, visibles: readonly Pick<Fournisseur, 'id'>[]): boolean {
  return visibles.length > 0 && visibles.every((f) => coches.has(f.id))
}
