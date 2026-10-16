/**
 * traiter.ts — ce que la fonction cockpit-recus FAIT d'un reçu et d'un passage, sans rien savoir de la base (14 oct. 2026, chantier 72a8d0f4).
 *
 * Toute écriture passe par un `Magasin` donné par l'appelant : index.ts lui donne la vraie base (Supabase) ; les tests de
 * app/scripts/verifier-recus-regle.ts lui donnent une base en mémoire, ce qui permet de prouver SANS réseau : pas de doublon,
 * un PDF joint à une ligne qui n'en avait pas, un essai qui n'écrit rien, un PDF suspect refusé, un échec d'écriture qui ne laisse
 * pas de fichier orphelin. La règle de lecture elle-même est dans regle.ts (port de scripts/importer-recus.py).
 *
 * Idempotent : le programme du compte Google peut renvoyer le même reçu chaque semaine, rien n'est jamais ajouté deux fois ; une
 * ligne déjà là SANS PDF reçoit le PDF quand le mail en porte un (c'est ainsi que les anciennes factures retrouvent leur PDF).
 */
import {
  CADENCE_PAR_DEFAUT, ETATS_PDF, RE_FACTURE_SEULE, Refus, STATUTS_RECU, analyser, lienPdfAccepte, lirePdf, noteDuPassage, nomPdfDeLaFacture, nomSur, pdfValide,
  type EtatPdf, type Recu, type ResultatRecu, type StatutRecu, type VerdictPdf,
} from './regle.ts'

/** Une donnée de la requête qui n'a pas la bonne forme (HTTP 400) : le message est écrit pour la personne qui lit le journal du programme. */
export class ErreurDonnees extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurDonnees'
  }
}

export interface Fichier { chemin: string; nom: string; type: string; taille: number }
export interface DepenseExistante { id: string; fichier: unknown | null; type: string }
export interface NouvelleDepense {
  projet_id: string; service_id: string; date: string; montant: string; devise: string
  type: 'facture'; description: string; reference: string; fichier: Fichier | null
}
export interface Battement { import_at: string; import_statut: 'ok' | 'echec'; import_note: string; import_cadence_jours: number }

/** Toute l'écriture de la fonction. `joindre` rend faux si la ligne avait déjà un fichier (rien n'est écrasé). */
export type LienPdf = { octets: Uint8Array } | { raison: string }

export interface Magasin {
  /** Le PDF du lien « Download invoice » du mail (facultatif : sans lui, seule la pièce jointe sert). Ne lève jamais : la raison est rendue. */
  pdfDuLien?(lien: string): Promise<LienPdf>
  depenseParReference(projetId: string, reference: string): Promise<DepenseExistante | null>
  deposer(chemin: string, octets: Uint8Array): Promise<void>
  retirer(chemin: string): Promise<void>
  inserer(d: NouvelleDepense): Promise<void>
  joindre(id: string, fichier: Fichier): Promise<boolean>
  battement(serviceId: string, b: Battement): Promise<void>
}

/** Ce que la clé a ouvert : lu de la base, JAMAIS de la requête. */
export interface Contexte {
  projetId: string
  serviceId: string
  /** Jour de départ (AAAA-MM-JJ) : les reçus plus anciens sont laissés de côté (l'historique s'ajoute à part, avec l'accord de Raphaël). */
  depuis: string
  cadenceActuelle: number | null
  /** Pour les tests : « aujourd'hui » et l'heure du battement. */
  aujourdhui?: string
  maintenant?: () => string
  /** Une erreur d'écriture inattendue : le détail va au journal du serveur, jamais dans la réponse. */
  erreurInterne?: (e: unknown) => void
}

export interface EntreeRecu { texte: string; pdfs: { nom: string; base64: string }[]; essai: boolean }
export interface SortieRecu extends ResultatRecu {
  recu?: string
  description?: string
}

/** Un reçu : le lit, le range (une seule fois), joint son PDF. Un refus de la règle est une réponse normale, pas une panne. */
export async function traiterRecu(ctx: Contexte, entree: EntreeRecu, mag: Magasin): Promise<SortieRecu> {
  let r: Recu
  try {
    r = analyser(entree.texte, ctx.aujourdhui)
  } catch (e) {
    if (e instanceof Refus) return { statut: 'refus', message: e.message }
    throw e
  }
  const base = { facture: r.facture, recu: r.recu, montant: r.montant, devise: r.devise, date: r.date, description: r.description }
  if (r.date < ctx.depuis) return { statut: 'hors_periode', ...base, message: `avant le ${ctx.depuis} (historique : à part)` }

  try {
    const existante = await mag.depenseParReference(ctx.projetId, r.facture)
    // Une ligne qui a déjà son PDF n'en veut pas un deuxième : aucun travail de PDF, aucun téléchargement.
    if (existante?.fichier) return { statut: 'deja_la', ...base, pdf: 'deja' }
    const pdf = await verdictPdf(entree.pdfs, r, mag)
    const messagePdf = pdf.genre === 'refuse' ? { message: pdf.raison } : {}
    if (existante) {
      if (pdf.genre !== 'ok') return { statut: 'deja_la', ...base, pdf: pdf.genre === 'refuse' ? 'refuse' : 'absent', ...messagePdf }
      if (existante.type !== 'facture') return { statut: 'deja_la', ...base, pdf: 'absent' }
      if (entree.essai) return { statut: 'pdf_joint', ...base, pdf: 'serait_joint' }
      const f = fichierDe(ctx, r.facture, pdf.octets.length)
      await mag.deposer(f.chemin, pdf.octets)
      let mis = false
      try { mis = await mag.joindre(existante.id, f) } catch (e) { await mag.retirer(f.chemin).catch(() => {}); throw e }
      if (!mis) { await mag.retirer(f.chemin).catch(() => {}); return { statut: 'deja_la', ...base, pdf: 'deja' } }
      return { statut: 'pdf_joint', ...base, pdf: 'depose' }
    }

    if (entree.essai) return { statut: 'a_ajouter', ...base, pdf: pdf.genre === 'ok' ? 'serait_depose' : pdf.genre === 'refuse' ? 'refuse' : 'absent', ...messagePdf }
    let fichier: Fichier | null = null
    if (pdf.genre === 'ok') {
      fichier = fichierDe(ctx, r.facture, pdf.octets.length)
      await mag.deposer(fichier.chemin, pdf.octets)
    }
    try {
      await mag.inserer({
        projet_id: ctx.projetId, service_id: ctx.serviceId, date: r.date, montant: r.montant, devise: r.devise, type: 'facture',
        description: r.description, reference: r.facture, fichier,
      })
    } catch (e) {
      if (fichier) await mag.retirer(fichier.chemin).catch(() => {})
      throw e
    }
    return { statut: 'ajoute', ...base, pdf: fichier ? 'depose' : pdf.genre === 'refuse' ? 'refuse' : 'absent', ...messagePdf }
  } catch (e) {
    ctx.erreurInterne?.(e)
    return { statut: 'erreur', ...base, message: "l'enregistrement a échoué : le prochain passage réessaiera" }
  }
}

/**
 * Le PDF d'un reçu : la pièce jointe du MÊME mail d'abord (elle ne périme jamais) ; à défaut le lien « Download invoice » du mail, tant qu'il
 * est valable (il expire : valable à 11 jours, expiré à 33, constaté le 13 oct. 2026). Les deux passent par la même règle (pdfValide).
 * Le lien est un secours : son échec (expiré, refusé, pas un PDF) ne rend JAMAIS la situation pire — le verdict reste celui de la pièce jointe
 * (« absent » = « PDF à joindre à la main », normal pour une vieille facture ; « refusé » seulement si une pièce jointe était là et fausse).
 * Sans cela, chaque vieille facture au lien expiré rougirait la carte du prestataire à chaque passage, pour toujours.
 */
async function verdictPdf(pdfs: { nom: string; base64: string }[], r: Recu, mag: Magasin): Promise<VerdictPdf> {
  const piece = lirePdf(pdfs, r.facture)
  if (piece.genre === 'ok') return piece
  if (!mag.pdfDuLien || !lienPdfAccepte(r.lien_facture)) return piece
  let l: LienPdf
  try {
    l = await mag.pdfDuLien(r.lien_facture!)
  } catch {
    return piece
  }
  if ('octets' in l) {
    const v = pdfValide(l.octets, r.facture)
    if (v.genre === 'ok') return v
  }
  return piece
}

function fichierDe(ctx: Contexte, facture: string, taille: number): Fichier {
  const nom = nomPdfDeLaFacture(facture)
  return { chemin: `${ctx.projetId}/depenses/${crypto.randomUUID()}-${nomSur(nom)}`, nom, type: 'application/pdf', taille }
}

// ------------------------------------------------------------------------------------------------------------ le passage

export interface EntreePassage { resultats: ResultatRecu[]; echec: string | null; cadenceJours: number | null; essai: boolean }

const MAX_RESULTATS = 200
const RE_MONTANT_SEUL = /^\d{1,9}\.\d{2}$/
const RE_DEVISE_SEULE = /^[A-Z]{3}$/
const RE_DATE_SEULE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Un texte court venu du programme : sans caractères de commande, coupé, ou rien. */
export function texteBorne(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  // deno-lint-ignore no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return t ? t.slice(0, max) : undefined
}

/** La liste des résultats que le programme rapporte (il les a reçus de CETTE fonction) : forme vérifiée, rien d'autre n'est gardé. */
export function validerResultats(brut: unknown): ResultatRecu[] {
  if (brut === undefined || brut === null) return []
  if (!Array.isArray(brut)) throw new ErreurDonnees('La liste des résultats est illisible.')
  if (brut.length > MAX_RESULTATS) throw new ErreurDonnees(`${MAX_RESULTATS} résultats au plus par passage.`)
  return brut.map((x, i): ResultatRecu => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    if (!(STATUTS_RECU as readonly unknown[]).includes(o.statut)) throw new ErreurDonnees(`Le résultat n° ${i + 1} n'a pas un statut connu.`)
    const facture = typeof o.facture === 'string' && RE_FACTURE_SEULE.test(o.facture) ? o.facture : undefined
    const montant = typeof o.montant === 'string' && RE_MONTANT_SEUL.test(o.montant) ? o.montant : undefined
    const devise = typeof o.devise === 'string' && RE_DEVISE_SEULE.test(o.devise) ? o.devise : undefined
    const date = typeof o.date === 'string' && RE_DATE_SEULE.test(o.date) ? o.date : undefined
    const pdf = (ETATS_PDF as readonly unknown[]).includes(o.pdf) ? (o.pdf as EtatPdf) : undefined
    return { statut: o.statut as StatutRecu, facture, montant, devise, date, pdf, quoi: texteBorne(o.quoi, 80), message: texteBorne(o.message, 200) }
  })
}

export function validerCadence(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 90 ? v : null
}

/** La fin d'un passage : ce que le programme a fait est dit à Raphaël sur la carte du prestataire (le « battement »). */
export async function traiterPassage(ctx: Contexte, entree: EntreePassage, mag: Magasin) {
  const { note, statut } = noteDuPassage(entree.resultats, entree.echec)
  const cadence = entree.cadenceJours ?? ctx.cadenceActuelle ?? CADENCE_PAR_DEFAUT
  if (!entree.essai) {
    await mag.battement(ctx.serviceId, { import_at: ctx.maintenant ? ctx.maintenant() : new Date().toISOString(), import_statut: statut, import_note: note, import_cadence_jours: cadence })
  }
  return { statut, note, cadence_jours: cadence, essai: entree.essai, battement: entree.essai ? 'non_ecrit_essai' : 'ecrit' }
}
