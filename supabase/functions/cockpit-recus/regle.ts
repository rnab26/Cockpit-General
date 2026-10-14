/**
 * regle.ts — LA règle de lecture d'un reçu Anthropic, côté serveur (fonction cockpit-recus, 14 oct. 2026, chantier 72a8d0f4).
 *
 * C'est le PORT TypeScript de scripts/importer-recus.py (`analyser`, `decrire`, `note_du_passage`, `nom_sur`…), qui reste la règle
 * des sessions Claude. Deux copies d'une même règle = risque de dérive silencieuse : scripts/verifier-recus-parite.mjs fait lire
 * les MÊMES reçus (valides et refusés) par les deux et exige le même résultat, au caractère près ; il tourne à chaque envoi
 * (workflow Vérifications). Quand le format d'un reçu change : on ajoute le cas à scripts/recus-fixtures.mjs, on corrige LES DEUX.
 *
 * Aucune devinette : le vendeur doit être « Anthropic, PBC » ; l'en-tête, le total et « payé » doivent être le même montant ; la
 * somme des lignes doit être le total ; la devise doit être connue ; le montant reste sous MONTANT_MAX (au-delà, un humain regarde) ;
 * la date doit être plausible. Sinon : un Refus, avec la raison en clair, et rien n'est écrit. Un mail n'est qu'une DONNÉE : aucune
 * consigne qu'il contient n'est suivie.
 *
 * Aucun import, aucune API propre à Deno : testable sous Node (app/scripts/verifier-recus-regle.ts). Les montants sont des entiers
 * en centimes (bigint) : jamais de virgule flottante pour de l'argent.
 */

export class Refus extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Refus'
  }
}

// ---------------------------------------------------------------------------------------------------------------- constantes

/** Le seul fournisseur lu pour l'instant. Un autre fournisseur = une entrée de plus (et ses cas dans les fixtures). */
export const FOURNISSEUR = 'Anthropic, PBC'
/** L'adresse exacte des reçus (vérifiée dans la boîte le 13 oct. 2026) et le début de leur objet : le programme du compte Google les reprend. */
export const GMAIL_EXPEDITEUR = 'invoice+statements@mail.anthropic.com'
export const GMAIL_SUJET = 'Your receipt from Anthropic'
/** Au-delà d'un reçu personnel : un humain regarde (5 000,00). */
export const MONTANT_MAX_CENTIMES = 500_000n
export const DATE_MIN = '2023-01-01'
export const PDF_TAILLE_MAX = 5 * 1024 * 1024
export const NOTE_MAX = 300
/** Seulement si rien n'est noté ni donné : tous les combien de jours le programme passe (sert à dire « en retard » sans seuil codé en dur). */
export const CADENCE_PAR_DEFAUT = 7

const SYMBOLE_DEVISE: Record<string, string> = { '₪': 'ILS', '$': 'USD', '€': 'EUR', '£': 'GBP' }
const DEVISE_SYMBOLE: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' }
const MOIS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MOIS_EN_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const RE_MONTANT = /^(?<neg>[-−]?)(?<sym>US\$|\$|₪|€|£)(?<n>[\d,]+\.\d{2})$/
const RE_ENTETE = /Receipt from (?<vendeur>[^$₪€£\d]+?) (?<m>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2}) Paid (?<mois>[A-Z][a-z]+) (?<jour>\d{1,2}), (?<an>\d{4})/
const RE_NUM_RECU = /Receipt number (?<n>\d{4}-\d{4}-\d{4})/
const RE_NUM_RECU_BAS = /Receipt #(?<n>\d{4}-\d{4}-\d{4}) /
const RE_FACTURE = /Invoice number (?<n>[A-Z0-9]{4,12}-\d{3,6})/
const RE_LIEN = /Download invoice \((?<u>https:\/\/[^\s)]+)\)/
const RE_CORPS = /Receipt #\d{4}-\d{4}-\d{4} (?<corps>.+?) Total (?<total>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2}) Amount paid (?<paye>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2})/
const RE_PERIODE = /^(?<m1>[A-Z][a-z]{2}) (?<j1>\d{1,2})(?:, (?<a1>\d{4}))? ?[–-] ?(?<m2>[A-Z][a-z]{2}) (?<j2>\d{1,2}), (?<a2>\d{4}) /
const RE_LIGNE = /(?<libelle>.+?) Qty (?<qte>\d+) (?<m>[-−]?(?:US\$|\$|₪|€|£)[\d,]+\.\d{2})/y
const RE_LIBELLE_SUR = /^[\p{L}\p{N}_ ,.\-+()/&'’:%]{1,90}$/u
export const RE_FACTURE_SEULE = /^[A-Z0-9]{4,12}-\d{3,6}$/

// ------------------------------------------------------------------------------------------------------------------ types

export interface Ligne { libelle: string; quantite: number; montant: string }
/** Ce qu'un reçu lu dit : les mêmes champs que `importer-recus.py --analyser` (montants en texte « 289.00 », dates AAAA-MM-JJ). */
export interface Recu {
  fournisseur: string; recu: string; facture: string; date: string; montant: string; devise: string
  lignes: Ligne[]; periode: [string, string] | null; lien_facture: string | null; description: string
}

// -------------------------------------------------------------------------------------------------------------- utilitaires

/** Comme `repr()` de Python pour les textes simples : sert aux messages de refus, identiques à ceux de importer-recus.py. */
export function repr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === q) out += '\\' + q
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0')
    else out += ch
  }
  return q + out + q
}

export function normaliser(texte: string): string {
  const t = texte.replaceAll('͏', ' ').replaceAll('​', ' ').replaceAll(' ', ' ').replaceAll('﻿', ' ')
  return t.replace(/\s+/g, ' ').trim()
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function dateIso(a: number, m: number, j: number): string | null {
  const d = new Date(Date.UTC(a, m - 1, j))
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null
  return `${String(a).padStart(4, '0')}-${pad2(m)}-${pad2(j)}`
}

export function aujourdhuiIso(): string { return new Date().toISOString().slice(0, 10) }

/** Un jour de plus (AAAA-MM-JJ), en UTC. */
export function plusJours(iso: string, n: number): string {
  const [a, m, j] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j + n))
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** « 1,234.50 » -> 123450n. Exact : le motif garantit deux décimales. */
function enCentimes(n: string): bigint {
  const [entier = '', frac = ''] = n.replaceAll(',', '').split('.')
  return BigInt(entier || '0') * 100n + BigInt(frac)
}

/** 28900n -> « 289.00 » (même forme que `'%.2f' % Decimal` de l'outil Python). */
export function formaterCentimes(c: bigint): string {
  const neg = c < 0n
  const a = neg ? -c : c
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`
}

function lireMontant(brut: string): { c: bigint; devise: string } {
  const m = RE_MONTANT.exec(brut)
  if (!m?.groups) throw new Refus(`montant illisible : ${repr(brut.slice(0, 30))}`)
  const sym = m.groups.sym
  const devise = sym === 'US$' ? 'USD' : SYMBOLE_DEVISE[sym]
  if (!devise) throw new Refus(`devise inconnue : ${repr(sym)}`)
  const c = enCentimes(m.groups.n)
  return { c: m.groups.neg ? -c : c, devise }
}

function lireDateLongue(mois: string, jour: string, an: string): string {
  const num = MOIS_EN_LONG.indexOf(mois) + 1
  if (!num) throw new Refus(`mois inconnu : ${repr(mois)}`)
  const iso = dateIso(Number(an), num, Number(jour))
  if (!iso) throw new Refus(`date impossible : ${mois} ${jour} ${an}`)
  return iso
}

/** « Oct 2–Nov 2, 2026 » (ou avec deux années) -> [début, fin]. */
function lirePeriode(g: Record<string, string | undefined>): [string, string] {
  const a2 = Number(g.a2)
  const mois1 = MOIS_EN.indexOf(g.m1 ?? '') + 1
  const mois2 = MOIS_EN.indexOf(g.m2 ?? '') + 1
  if (!mois1 || !mois2) throw new Refus('période illisible')
  const a1 = g.a1 ? Number(g.a1) : (mois1 > mois2 ? a2 - 1 : a2)
  const d1 = dateIso(a1, mois1, Number(g.j1))
  const d2 = dateIso(a2, mois2, Number(g.j2))
  if (!d1 || !d2) throw new Refus('période impossible')
  return [d1, d2]
}

/** « 1 234,50 ₪ » (le signe n'est pas écrit : la phrase le dit). */
export function montantFr(c: bigint, devise: string): string {
  const a = c < 0n ? -c : c
  const entier = String(a / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${entier},${String(a % 100n).padStart(2, '0')} ${DEVISE_SYMBOLE[devise] ?? devise}`
}

export function jourFr(iso: string, avecAnnee: boolean): string {
  const [a, m, j] = iso.split('-').map(Number)
  return `${j} ${MOIS_FR[m - 1]}${avecAnnee ? ` ${a}` : ''}`
}

function periodeFr(d1: string, d2: string): string {
  if (d1.slice(0, 4) === d2.slice(0, 4)) return `${jourFr(d1, false)} au ${jourFr(d2, true)}`
  return `${jourFr(d1, true)} au ${jourFr(d2, true)}`
}

/** Le libellé du reçu, dit simplement. Ce qu'on ne connaît pas reste tel quel (déjà vérifié sûr par RE_LIBELLE_SUR). */
function libelleFr(libelle: string): string {
  const l = libelle.trim()
  let m = /^Max plan - (\d+x)$/.exec(l)
  if (m) return `Claude Max ${m[1]}`
  if (l === 'Claude Pro' || l === 'Claude Max') return l
  if (l === 'One-time credit purchase') return 'Crédit API Claude (achat unique)'
  m = /^Prepaid extra usage(?:, (?<offre>.+))?$/.exec(l)
  if (m) {
    let offre = m.groups?.offre
    if (offre === 'Individual plan') offre = 'abonnement individuel'
    return `Usage supplémentaire prépayé${offre ? ` (${offre})` : ''}`
  }
  m = /^Unused time on (?<p>.+?) after .+$/.exec(l)
  if (m) return `temps non utilisé sur ${m.groups?.p}`
  return l
}

function decrire(lignes: { libelle: string; c: bigint }[], periode: [string, string] | null, numRecu: string, devise: string): string {
  const positives = lignes.filter((l) => l.c > 0n)
  const negatives = lignes.filter((l) => l.c < 0n)
  const noms = positives.map((l) => libelleFr(l.libelle))
  const estAbonnement = noms.some((n) => n.startsWith('Claude Max') || n === 'Claude Pro')
  let base = noms.length ? noms.join(' + ') : 'Reçu Anthropic'
  if (estAbonnement) base = `Abonnement ${base}`
  if (periode) base += `, ${periodeFr(periode[0], periode[1])}`
  for (const l of negatives) base += ` (moins ${montantFr(l.c, devise)} : ${libelleFr(l.libelle)})`
  return `${base} · reçu ${numRecu}`.slice(0, 200)
}

// ----------------------------------------------------------------------------------------------------------------- lecture

/** Le texte brut d'un mail de reçu -> les champs, ou Refus. Aucune devinette : tout doit concorder. */
export function analyser(texte: string, aujourdhui: string = aujourdhuiIso()): Recu {
  const t = normaliser(texte)
  if (!t) throw new Refus('texte vide')
  const ent = RE_ENTETE.exec(t)
  if (!ent?.groups || ent.groups.vendeur.trim() !== FOURNISSEUR) throw new Refus(`ce n'est pas un reçu de « ${FOURNISSEUR} »`)
  const { c: montant, devise } = lireMontant(ent.groups.m)
  const jour = lireDateLongue(ent.groups.mois, ent.groups.jour, ent.groups.an)
  const r1 = RE_NUM_RECU.exec(t)
  const r2 = RE_NUM_RECU_BAS.exec(t)
  const fa = RE_FACTURE.exec(t)
  if (!r1?.groups || !r2?.groups || !fa?.groups) throw new Refus('numéro de reçu ou de facture introuvable')
  if (r1.groups.n !== r2.groups.n) throw new Refus('deux numéros de reçu différents dans le même mail')
  const corps = RE_CORPS.exec(t)
  if (!corps?.groups) throw new Refus('détail des lignes introuvable')
  const { c: total, devise: dTotal } = lireMontant(corps.groups.total)
  const { c: paye, devise: dPaye } = lireMontant(corps.groups.paye)
  if (!(dTotal === dPaye && dPaye === devise)) throw new Refus('devises différentes dans le même reçu')
  if (!(montant === total && total === paye)) {
    throw new Refus(`montant d'en-tête, total et « payé » ne concordent pas (${formaterCentimes(montant)} / ${formaterCentimes(total)} / ${formaterCentimes(paye)})`)
  }
  let reste = corps.groups.corps
  let periode: [string, string] | null = null
  const pm = RE_PERIODE.exec(reste)
  if (pm?.groups) {
    periode = lirePeriode(pm.groups)
    reste = reste.slice(pm[0].length)
  }
  const lignes: { libelle: string; quantite: number; c: bigint }[] = []
  let pos = 0
  while (pos < reste.length) {
    RE_LIGNE.lastIndex = pos
    const lm = RE_LIGNE.exec(reste)
    if (!lm?.groups) throw new Refus(`ligne non reconnue : ${repr(reste.slice(pos, pos + 60))}`)
    const lib = lm.groups.libelle.trim()
    if (!RE_LIBELLE_SUR.test(lib)) throw new Refus(`libellé inhabituel : ${repr(lib.slice(0, 60))}`)
    const { c, devise: dLigne } = lireMontant(lm.groups.m)
    if (dLigne !== devise) throw new Refus("devise d'une ligne différente du reçu")
    lignes.push({ libelle: lib, quantite: Number(lm.groups.qte), c })
    pos = RE_LIGNE.lastIndex
    while (pos < reste.length && reste[pos] === ' ') pos++
  }
  if (!lignes.length) throw new Refus('aucune ligne de facturation')
  const somme = lignes.reduce((s, l) => s + l.c, 0n)
  if (somme !== total) throw new Refus(`la somme des lignes (${formaterCentimes(somme)}) n'est pas le total (${formaterCentimes(total)})`)
  if (!(montant > 0n && montant <= MONTANT_MAX_CENTIMES)) throw new Refus(`montant hors limites (${formaterCentimes(montant)}) : à regarder à la main`)
  if (jour > plusJours(aujourdhui, 1) || jour < DATE_MIN) throw new Refus(`date invraisemblable (${jour})`)
  const lien = RE_LIEN.exec(t)
  return {
    fournisseur: FOURNISSEUR, recu: r1.groups.n, facture: fa.groups.n, date: jour, montant: formaterCentimes(montant), devise,
    lignes: lignes.map((l) => ({ libelle: l.libelle, quantite: l.quantite, montant: formaterCentimes(l.c) })), periode,
    lien_facture: lien?.groups?.u ?? null, description: decrire(lignes, periode, r1.groups.n, devise),
  }
}

// --------------------------------------------------------------------------------------------------- pièces jointes (PDF)

/** Base64 « normal » ou « URL » (celui de l'API Gmail) -> octets ; null si ce n'est pas du base64. */
export function decoderBase64(b64: string): Uint8Array | null {
  const propre = b64.replace(/\s+/g, '').replaceAll('-', '+').replaceAll('_', '/')
  if (!propre || !/^[A-Za-z0-9+/]*={0,2}$/.test(propre)) return null
  if (propre.includes('=') && propre.length % 4 !== 0) return null // un bourrage « = » incomplet n'est pas du base64
  const rempli = propre + '='.repeat((4 - (propre.length % 4)) % 4)
  try {
    const bin = atob(rempli)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Le nom que Stripe donne au PDF de la facture : « Invoice-<n° de facture>.pdf ». Le PDF doit porter le numéro du mail lu. */
export function nomPdfDeLaFacture(facture: string): string { return `Invoice-${facture}.pdf` }

export function nomSur(nom: string): string {
  let base = nom.normalize('NFD').replace(/[̀-ͯ]/g, '')
  base = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-+$/g, '')
  return (base || 'fichier').slice(-80)
}

export type VerdictPdf =
  | { genre: 'ok'; octets: Uint8Array; nom: string }
  | { genre: 'absent' }
  | { genre: 'refuse'; raison: string }

/** Parmi les pièces jointes reçues, celle de CETTE facture : bon nom, vrai PDF, taille raisonnable. Jamais une autre. */
export function lirePdf(pdfs: readonly { nom: string; base64: string }[], facture: string): VerdictPdf {
  if (!pdfs.length) return { genre: 'absent' }
  const attendu = nomPdfDeLaFacture(facture).toLowerCase()
  const p = pdfs.find((x) => x.nom.trim().toLowerCase() === attendu)
  if (!p) return { genre: 'refuse', raison: `aucune pièce jointe ne s'appelle « ${nomPdfDeLaFacture(facture)} »` }
  if (p.base64.length > Math.ceil(PDF_TAILLE_MAX * 4 / 3) + 16) return { genre: 'refuse', raison: 'le PDF est trop gros (5 Mo au plus)' }
  const octets = decoderBase64(p.base64)
  if (!octets) return { genre: 'refuse', raison: "le PDF n'est pas lisible (base64 invalide)" }
  if (octets.length > PDF_TAILLE_MAX) return { genre: 'refuse', raison: 'le PDF est trop gros (5 Mo au plus)' }
  const entete = String.fromCharCode(...octets.slice(0, 5))
  if (entete !== '%PDF-') return { genre: 'refuse', raison: "le fichier reçu n'est pas un PDF" }
  return { genre: 'ok', octets, nom: nomPdfDeLaFacture(facture) }
}

// ------------------------------------------------------------------------------------------------------------ le passage

export type StatutRecu = 'ajoute' | 'deja_la' | 'hors_periode' | 'pdf_joint' | 'a_ajouter' | 'refus' | 'erreur'
export type EtatPdf = 'depose' | 'absent' | 'deja' | 'refuse' | 'serait_depose' | 'serait_joint'
export const STATUTS_RECU: readonly StatutRecu[] = ['ajoute', 'deja_la', 'hors_periode', 'pdf_joint', 'a_ajouter', 'refus', 'erreur']
export const ETATS_PDF: readonly EtatPdf[] = ['depose', 'absent', 'deja', 'refuse', 'serait_depose', 'serait_joint']

/** Ce que la fonction a répondu pour UN reçu (le programme le rapporte tel quel à la fin du passage). */
export interface ResultatRecu {
  statut: StatutRecu
  facture?: string; montant?: string; devise?: string; date?: string
  pdf?: EtatPdf
  /** « mail du 2 oct. » : pour retrouver le mail en cause dans la note. */
  quoi?: string
  message?: string
}

/** Une phrase pour Raphaël (300 caractères au plus), la même que celle de importer-recus.py. */
export function noteDuPassage(resultats: readonly ResultatRecu[], echec?: string | null): { note: string; statut: 'ok' | 'echec' } {
  if (echec) return { note: `Le passage n'a pas pu avoir lieu : ${echec}`.slice(0, NOTE_MAX), statut: 'echec' }
  const ajoutes = resultats.filter((r) => r.statut === 'ajoute' || r.statut === 'a_ajouter')
  const joints = resultats.filter((r) => r.statut === 'pdf_joint')
  const deja = resultats.filter((r) => r.statut === 'deja_la').length
  const erreurs: string[] = []
  for (const r of resultats) {
    if (r.statut === 'refus' || r.statut === 'erreur') erreurs.push(`${r.quoi ?? 'un mail'} : ${r.message ?? 'illisible'}`)
    else if ((r.statut === 'ajoute' || r.statut === 'a_ajouter' || r.statut === 'pdf_joint' || r.statut === 'deja_la') && r.pdf === 'refuse') {
      erreurs.push(`${r.facture ?? r.quoi ?? 'un mail'} : ${r.message ?? 'PDF refusé'}`)
    }
  }
  const morceaux: string[] = []
  if (ajoutes.length) {
    const n = ajoutes.length
    const liste = ajoutes.map((a) => `${montantFr(enCentimes((a.montant ?? '0.00').replace('-', '')), a.devise ?? '')} (${jourFr(a.date ?? '2000-01-01', false)})`).join(', ')
    morceaux.push(`${n} facture${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} : ${liste}`)
    const sansPdf = ajoutes.filter((a) => a.pdf !== 'depose' && a.pdf !== 'serait_depose').map((a) => a.facture ?? '?')
    if (sansPdf.length) morceaux.push(`PDF à joindre à la main : ${sansPdf.join(', ')}`)
  }
  if (joints.length) {
    const n = joints.length
    morceaux.push(`PDF joint à ${n} facture${n > 1 ? 's' : ''} déjà présente${n > 1 ? 's' : ''} : ${joints.map((j) => j.facture ?? '?').join(', ')}`)
  }
  if (erreurs.length) {
    const n = erreurs.length
    morceaux.push(`${n} reçu${n > 1 ? 's' : ''} non lu${n > 1 ? 's' : ''} : ${erreurs.join(' ; ')}`)
  }
  if (!morceaux.length) morceaux.push(`Rien de nouveau${deja ? ` (${deja} déjà dans Coûts)` : ''}`)
  return { note: morceaux.join(' · ').slice(0, NOTE_MAX), statut: erreurs.length ? 'echec' : 'ok' }
}

/** La recherche Gmail du programme : l'expéditeur exact, l'objet, et un jour de marge (le n° de facture dédoublonne). */
export function requeteGmail(depuis: string): string {
  return `from:${GMAIL_EXPEDITEUR} subject:"${GMAIL_SUJET}" after:${plusJours(depuis, -1).replaceAll('-', '/')}`
}
