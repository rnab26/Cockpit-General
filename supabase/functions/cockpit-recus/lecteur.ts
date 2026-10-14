/**
 * LE LECTEUR DE REÇUS ANTHROPIC côté serveur (chantier 72a8d0f4, 14 oct. 2026).
 *
 * Même règle que `scripts/importer-recus.py` (`analyser`, `decrire`) : lecture DÉTERMINISTE du texte d'un mail, refus de tout
 * ce qui est incohérent, aucune devinette. Deux copies, assumées (une fonction serveur ne lance pas Python) : le banc
 * `scripts/verifier-recus-fonction.mjs` les fait tourner sur les MÊMES reçus et refuse qu'elles divergent. Toute évolution se
 * fait dans les deux, banc rouge sinon. Pur : aucun import Deno, se teste sous Node.
 */
export class Refus extends Error {}

export const FOURNISSEUR = 'Anthropic, PBC'
export const MONTANT_MAX_CENTS = 500000 // 5 000 : au-delà d'un reçu personnel, un humain regarde
const DATE_MIN = '2023-01-01'
const SYMBOLE_DEVISE: Record<string, string> = { '₪': 'ILS', '$': 'USD', '€': 'EUR', '£': 'GBP' }
const DEVISE_SYMBOLE: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' }
const MOIS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MOIS_EN_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const M = '(?:US\\$|\\$|₪|€|£)'
const RE_MONTANT = /^([-−]?)(US\$|\$|₪|€|£)([\d,]+\.\d{2})$/
const RE_ENTETE = new RegExp(`Receipt from ([^$₪€£\\d]+?) ([-−]?${M}[\\d,]+\\.\\d{2}) Paid ([A-Z][a-z]+) (\\d{1,2}), (\\d{4})`)
const RE_NUM_RECU = /Receipt number (\d{4}-\d{4}-\d{4})/
const RE_NUM_RECU_BAS = /Receipt #(\d{4}-\d{4}-\d{4}) /
const RE_FACTURE = /Invoice number ([A-Z0-9]{4,12}-\d{3,6})/
const RE_LIEN = /Download invoice \((https:\/\/[^\s)]+)\)/
const RE_CORPS = new RegExp(`Receipt #\\d{4}-\\d{4}-\\d{4} (.+?) Total ([-−]?${M}[\\d,]+\\.\\d{2}) Amount paid ([-−]?${M}[\\d,]+\\.\\d{2})`)
const RE_PERIODE = /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))? ?[–-] ?([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) /
const RE_LIGNE = new RegExp(`(.+?) Qty (\\d+) ([-−]?${M}[\\d,]+\\.\\d{2})`, 'y')
const RE_LIBELLE_SUR = /^[\p{L}\p{N}_ ,.\-+()/&'’:%]{1,90}$/u

export interface Ligne { libelle: string; quantite: number; montant: string }
export interface Recu {
  fournisseur: string; recu: string; facture: string; date: string; montant: string; devise: string
  lignes: Ligne[]; periode: [string, string] | null; lien_facture: string | null; description: string
}

const iso = (a: number, m: number, j: number) => `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`
function dateValide(a: number, m: number, j: number): boolean {
  const d = new Date(Date.UTC(a, m - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j
}

export function normaliser(texte: string): string {
  return texte.replace(/[͏​ ﻿]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** « 1,234.50 » -> centimes (entier). Le signe suit le « − » du reçu. */
function lireMontant(brut: string): { cents: number; devise: string } {
  const m = RE_MONTANT.exec(brut)
  if (!m) throw new Refus(`montant illisible : ${JSON.stringify(brut.slice(0, 30))}`)
  const devise = m[2] === 'US$' ? 'USD' : SYMBOLE_DEVISE[m[2]]
  if (!devise) throw new Refus(`devise inconnue : ${m[2]}`)
  const [ent, dec] = m[3].replace(/,/g, '').split('.')
  const cents = Number(ent) * 100 + Number(dec)
  return { cents: m[1] ? -cents : cents, devise }
}
export const enDecimal = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`

function lireDateLongue(mois: string, jour: string, an: string): string {
  const num = MOIS_EN_LONG.indexOf(mois) + 1
  if (!num) throw new Refus(`mois inconnu : ${JSON.stringify(mois)}`)
  if (!dateValide(Number(an), num, Number(jour))) throw new Refus(`date impossible : ${mois} ${jour} ${an}`)
  return iso(Number(an), num, Number(jour))
}

function lirePeriode(m: RegExpExecArray): [string, string] {
  const a2 = Number(m[6])
  const mois1 = MOIS_EN.indexOf(m[1]) + 1, mois2 = MOIS_EN.indexOf(m[4]) + 1
  if (!mois1 || !mois2) throw new Refus('période illisible')
  const a1 = m[3] ? Number(m[3]) : (mois1 > mois2 ? a2 - 1 : a2)
  if (!dateValide(a1, mois1, Number(m[2])) || !dateValide(a2, mois2, Number(m[5]))) throw new Refus('période impossible')
  return [iso(a1, mois1, Number(m[2])), iso(a2, mois2, Number(m[5]))]
}

export function montantFr(cents: number, devise: string): string {
  const a = Math.abs(cents)
  const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${ent},${String(a % 100).padStart(2, '0')} ${DEVISE_SYMBOLE[devise] ?? devise}`
}
export function jourFr(d: string, avecAnnee: boolean): string {
  const [a, m, j] = d.split('-').map(Number)
  return `${j} ${MOIS_FR[m - 1]}${avecAnnee ? ` ${a}` : ''}`
}
function periodeFr(d1: string, d2: string): string {
  return d1.slice(0, 4) === d2.slice(0, 4) ? `${jourFr(d1, false)} au ${jourFr(d2, true)}` : `${jourFr(d1, true)} au ${jourFr(d2, true)}`
}

function libelleFr(libelle: string): string {
  const l = libelle.trim()
  let m = /^Max plan - (\d+x)$/.exec(l)
  if (m) return `Claude Max ${m[1]}`
  if (l === 'Claude Pro' || l === 'Claude Max') return l
  if (l === 'One-time credit purchase') return 'Crédit API Claude (achat unique)'
  m = /^Prepaid extra usage(?:, (.+))?$/.exec(l)
  if (m) {
    const offre = m[1] === 'Individual plan' ? 'abonnement individuel' : m[1]
    return `Usage supplémentaire prépayé${offre ? ` (${offre})` : ''}`
  }
  m = /^Unused time on (.+?) after .+$/.exec(l)
  if (m) return `temps non utilisé sur ${m[1]}`
  return l
}

function decrire(lignes: { libelle: string; cents: number }[], periode: [string, string] | null, numRecu: string, devise: string): string {
  const noms = lignes.filter((l) => l.cents > 0).map((l) => libelleFr(l.libelle))
  const abonnement = noms.some((n) => n.startsWith('Claude Max') || n === 'Claude Pro')
  let base = noms.length ? noms.join(' + ') : 'Reçu Anthropic'
  if (abonnement) base = `Abonnement ${base}`
  if (periode) base += `, ${periodeFr(periode[0], periode[1])}`
  for (const l of lignes.filter((x) => x.cents < 0)) base += ` (moins ${montantFr(l.cents, devise)} : ${libelleFr(l.libelle)})`
  return `${base} · reçu ${numRecu}`.slice(0, 200)
}

/** Le texte brut d'un mail de reçu -> les champs, ou Refus. `aujourdhui` = AAAA-MM-JJ (tests). */
export function analyser(texte: string, aujourdhui?: string): Recu {
  const auj = aujourdhui ?? new Date().toISOString().slice(0, 10)
  const t = normaliser(texte)
  if (!t) throw new Refus('texte vide')
  const ent = RE_ENTETE.exec(t)
  if (!ent || ent[1].trim() !== FOURNISSEUR) throw new Refus(`ce n'est pas un reçu de « ${FOURNISSEUR} »`)
  const { cents: montant, devise } = lireMontant(ent[2])
  const jour = lireDateLongue(ent[3], ent[4], ent[5])
  const r1 = RE_NUM_RECU.exec(t), r2 = RE_NUM_RECU_BAS.exec(t), fa = RE_FACTURE.exec(t)
  if (!r1 || !r2 || !fa) throw new Refus('numéro de reçu ou de facture introuvable')
  if (r1[1] !== r2[1]) throw new Refus('deux numéros de reçu différents dans le même mail')
  const corps = RE_CORPS.exec(t)
  if (!corps) throw new Refus('détail des lignes introuvable')
  const tot = lireMontant(corps[2]), paye = lireMontant(corps[3])
  if (!(tot.devise === paye.devise && paye.devise === devise)) throw new Refus('devises différentes dans le même reçu')
  if (!(montant === tot.cents && tot.cents === paye.cents)) {
    throw new Refus(`montant d'en-tête, total et « payé » ne concordent pas (${enDecimal(montant)} / ${enDecimal(tot.cents)} / ${enDecimal(paye.cents)})`)
  }
  let reste = corps[1], periode: [string, string] | null = null
  const pm = RE_PERIODE.exec(reste)
  if (pm) { periode = lirePeriode(pm); reste = reste.slice(pm[0].length) }
  const lignes: { libelle: string; quantite: number; cents: number }[] = []
  let pos = 0
  while (pos < reste.length) {
    RE_LIGNE.lastIndex = pos
    const lm = RE_LIGNE.exec(reste)
    if (!lm) throw new Refus(`ligne non reconnue : ${JSON.stringify(reste.slice(pos, pos + 60))}`)
    const lib = lm[1].trim()
    if (!RE_LIBELLE_SUR.test(lib)) throw new Refus(`libellé inhabituel : ${JSON.stringify(lib.slice(0, 60))}`)
    const l = lireMontant(lm[3])
    if (l.devise !== devise) throw new Refus("devise d'une ligne différente du reçu")
    lignes.push({ libelle: lib, quantite: Number(lm[2]), cents: l.cents })
    pos = RE_LIGNE.lastIndex
    while (pos < reste.length && reste[pos] === ' ') pos++
  }
  if (!lignes.length) throw new Refus('aucune ligne de facturation')
  const somme = lignes.reduce((s, l) => s + l.cents, 0)
  if (somme !== tot.cents) throw new Refus(`la somme des lignes (${enDecimal(somme)}) n'est pas le total (${enDecimal(tot.cents)})`)
  if (!(montant > 0 && montant <= MONTANT_MAX_CENTS)) throw new Refus(`montant hors limites (${enDecimal(montant)}) : à regarder à la main`)
  const demain = new Date(Date.parse(`${auj}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  if (jour > demain || jour < DATE_MIN) throw new Refus(`date invraisemblable (${jour})`)
  const lien = RE_LIEN.exec(t)
  return {
    fournisseur: FOURNISSEUR, recu: r1[1], facture: fa[1], date: jour, montant: enDecimal(montant), devise,
    lignes: lignes.map((l) => ({ libelle: l.libelle, quantite: l.quantite, montant: enDecimal(l.cents) })),
    periode, lien_facture: lien ? lien[1] : null, description: decrire(lignes, periode, r1[1], devise),
  }
}

/** Le PDF d'un reçu : celui dont le nom porte le n° de facture (« Invoice-XXXX-0001.pdf »), sinon l'unique PDF du mail. */
export function choisirPdf(facture: string, pdfs: { nom: string }[]): number {
  const porte = pdfs.map((p, i) => ({ i, p })).filter(({ p }) => p.nom.includes(facture))
  if (porte.length) {
    const inv = porte.find(({ p }) => /invoice|facture/i.test(p.nom))
    return (inv ?? porte[0]).i
  }
  return pdfs.length === 1 ? 0 : -1
}

/** Seul `https://pay.stripe.com/invoice/…` se télécharge ; une redirection ne sort jamais de *.stripe.com. */
export function lienPdfAccepte(lien: string | null): boolean {
  try {
    const u = new URL(lien ?? '')
    return u.protocol === 'https:' && u.hostname === 'pay.stripe.com' && u.pathname.startsWith('/invoice/')
  } catch { return false }
}
export function hoteStripe(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'stripe.com' || u.hostname.endsWith('.stripe.com')) } catch { return false }
}

export function nomSur(nom: string): string {
  let base = nom.normalize('NFD').replace(/[̀-ͯ]/g, '')
  base = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-+$/g, '')
  return (base || 'fichier').slice(-80)
}

export function noteDuPassage(ajoutes: { montant: string; devise: string; date: string; facture: string; pdf: string }[], deja: number, erreurs: string[]): string {
  const morceaux: string[] = []
  if (ajoutes.length) {
    const s = ajoutes.length > 1 ? 's' : ''
    const liste = ajoutes.map((a) => `${montantFr(Math.round(Number(a.montant) * 100), a.devise)} (${jourFr(a.date, false)})`).join(', ')
    morceaux.push(`${ajoutes.length} facture${s} ajoutée${s} : ${liste}`)
    const sans = ajoutes.filter((a) => a.pdf !== 'depose').map((a) => a.facture)
    if (sans.length) morceaux.push(`PDF à joindre à la main : ${sans.join(', ')}`)
  }
  if (erreurs.length) {
    const s = erreurs.length > 1 ? 's' : ''
    morceaux.push(`${erreurs.length} reçu${s} non lu${s} : ${erreurs.join(' ; ')}`)
  }
  if (!morceaux.length) morceaux.push(`Rien de nouveau${deja ? ` (${deja} déjà dans Coûts)` : ''}`)
  return morceaux.join(' · ').slice(0, 300)
}
