/**
 * Dépenses d'un projet (0052, chantier 41127de1) : UNE source de règles pour
 * l'écran « Coûts » — périodes, totaux, solde bas, résumé pour la compta.
 * Aucune conversion de devise : les totaux sont toujours PAR devise (un taux
 * inventé serait un faux chiffre).
 */
export type TypeDepense = 'facture' | 'consommation' | 'recharge'
export type StatutCompta = 'a_envoyer' | 'envoye' | 'sans_objet'
export type Periode = 'jour' | 'semaine' | 'mois' | 'annee'
export interface FichierDepense { chemin: string; nom: string; type: string; taille: number }

export interface Service {
  id: string; projet_id: string; nom: string; url_tableau: string | null; url_factures: string | null
  devise: string; solde: number | null; solde_at: string | null; seuil_alerte: number | null
  note: string | null; archived_at: string | null; created_at: string
}
export interface Depense {
  id: string; projet_id: string; service_id: string | null; date: string; montant: number; devise: string
  type: TypeDepense; description: string; reference: string | null; fichier: FichierDepense | null
  compta_statut: StatutCompta; compta_at: string | null; compta_par: string | null; compta_canal: string | null; created_at: string
}

export const PERIODES: readonly { valeur: Periode; libelle: string }[] = [
  { valeur: 'jour', libelle: 'Jour' }, { valeur: 'semaine', libelle: 'Semaine' }, { valeur: 'mois', libelle: 'Mois' }, { valeur: 'annee', libelle: 'Année' },
]
export const PERIODE_DEFAUT: Periode = 'mois'
export function estPeriode(v: unknown): v is Periode { return v === 'jour' || v === 'semaine' || v === 'mois' || v === 'annee' }

/** Les valeurs venues de la base (numeric arrive parfois en texte) : jamais NaN à l'écran. */
export function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
export function lireService(r: Record<string, unknown>): Service {
  return { ...(r as unknown as Service), solde: nombre(r.solde), seuil_alerte: nombre(r.seuil_alerte) }
}
export function lireDepense(r: Record<string, unknown>): Depense {
  return { ...(r as unknown as Depense), montant: nombre(r.montant) ?? 0 }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Lundi de la semaine d'une date AAAA-MM-JJ (semaine ISO, calcul en UTC : pas de décalage d'heure d'été). */
export function lundiDe(date: string): string {
  const [a, m, j] = date.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
/** La clé du paquet d'une date : jour, lundi de la semaine, « 2026-10 » ou « 2026 ». Triable. */
export function cleDePeriode(date: string, p: Periode): string {
  if (p === 'jour') return date
  if (p === 'semaine') return lundiDe(date)
  if (p === 'mois') return date.slice(0, 7)
  return date.slice(0, 4)
}
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
export function libellePeriode(cle: string, p: Periode): string {
  if (p === 'annee') return cle
  if (p === 'mois') { const [a, m] = cle.split('-').map(Number); return `${MOIS[m - 1]} ${a}` }
  const [a, m, j] = cle.split('-').map(Number)
  return p === 'jour' ? `${j} ${MOIS[m - 1]} ${a}` : `Semaine du ${j} ${MOIS[m - 1]} ${a}`
}

export type Totaux = Record<string, number>   // devise → somme
export function sommer(l: readonly Depense[]): Totaux {
  const t: Totaux = {}
  for (const d of l) t[d.devise] = Math.round(((t[d.devise] ?? 0) + d.montant) * 100) / 100
  return t
}
/** Une recharge de crédit est de l'argent mis de côté, pas une dépense : elle n'entre pas dans les totaux de coût. */
export const compteDansLeCout = (d: Depense) => d.type !== 'recharge'

export interface Paquet { cle: string; libelle: string; depenses: Depense[]; totaux: Totaux }
export function grouper(l: readonly Depense[], p: Periode): Paquet[] {
  const m = new Map<string, Depense[]>()
  for (const d of l) {
    const k = cleDePeriode(d.date, p)
    const liste = m.get(k) ?? []
    liste.push(d); m.set(k, liste)
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([cle, depenses]) => ({
    cle, libelle: libellePeriode(cle, p),
    depenses: depenses.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.created_at < b.created_at ? 1 : -1)),
    totaux: sommer(depenses.filter(compteDansLeCout)),
  }))
}
/** Total par service (les lignes sans service sous `null`), coûts seulement. */
export function parService(l: readonly Depense[]): Map<string | null, Totaux> {
  const m = new Map<string | null, Depense[]>()
  for (const d of l.filter(compteDansLeCout)) {
    const liste = m.get(d.service_id) ?? []
    liste.push(d); m.set(d.service_id, liste)
  }
  return new Map([...m.entries()].map(([k, v]) => [k, sommer(v)]))
}

export function formaterMontant(n: number, devise: string): string {
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: devise }).format(n) } catch { return `${n.toFixed(2)} ${devise}` }
}
export function formaterTotaux(t: Totaux): string {
  const e = Object.entries(t)
  return e.length ? e.map(([dev, n]) => formaterMontant(n, dev)).join(' + ') : '—'
}

/** Solde sous le seuil réglé : l'alerte de l'écran. Sans solde ou sans seuil : jamais d'alerte inventée. */
export function soldeBas(s: Pick<Service, 'solde' | 'seuil_alerte'>): boolean {
  return s.solde !== null && s.seuil_alerte !== null && s.solde <= s.seuil_alerte
}

export const STATUTS_COMPTA: Record<StatutCompta, string> = { a_envoyer: 'À envoyer', envoye: 'Envoyée à la compta', sans_objet: 'Sans objet' }
export const TYPES: Record<TypeDepense, string> = { facture: 'Facture', consommation: 'Consommation', recharge: 'Recharge de crédit' }

/** Ce qui peut partir à la compta : une facture pas encore envoyée. (Une consommation n'est pas une facture.) */
export const envoyable = (d: Depense) => d.type === 'facture' && d.compta_statut === 'a_envoyer'

/** Le résumé collé dans le message (e-mail / WhatsApp) : une ligne par facture, le total par devise. */
export function resumeCompta(l: readonly Depense[], services: readonly Service[], projetNom: string): string {
  const nom = new Map(services.map((s) => [s.id, s.nom]))
  const lignes = l.map((d) => `- ${d.date} · ${(d.service_id && nom.get(d.service_id)) || 'Sans prestataire'} · ${formaterMontant(d.montant, d.devise)}${d.reference ? ` · réf. ${d.reference}` : ''}${d.description ? ` · ${d.description}` : ''}${d.fichier ? '' : ' · (pas de pièce jointe)'}`)
  return `Factures du projet ${projetNom} (${l.length}) :\n${lignes.join('\n')}\nTotal : ${formaterTotaux(sommer(l))}`
}

export type Canal = 'email' | 'whatsapp' | 'autre'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function destinataireValide(canal: Canal | null, d: string | null): boolean {
  if (!canal) return false
  const v = (d ?? '').trim()
  if (canal === 'email') return EMAIL.test(v)
  if (canal === 'whatsapp') return v.replace(/[^\d]/g, '').length >= 8
  return v.length > 0
}
/** Lien de repli quand le partage de fichiers n'existe pas (ordinateur) : e-mail ou WhatsApp pré-rempli avec le résumé. Jamais d'envoi : c'est l'utilisateur qui appuie sur « envoyer ». */
export function lienDeRepli(canal: Canal | null, destinataire: string | null, sujet: string, texte: string): string | null {
  if (!destinataireValide(canal, destinataire)) return null
  const d = (destinataire ?? '').trim()
  if (canal === 'email') return `mailto:${d}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(texte)}`
  if (canal === 'whatsapp') return `https://wa.me/${d.replace(/[^\d]/g, '')}?text=${encodeURIComponent(texte)}`
  return null
}
