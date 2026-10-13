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
