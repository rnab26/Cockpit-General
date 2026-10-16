// La règle des reçus côté serveur (supabase/functions/cockpit-recus : regle.ts + traiter.ts), sans réseau ni base.
// node --experimental-strip-types app/scripts/verifier-recus-regle.ts
// 1. la lecture d'un reçu (mêmes cas que le lecteur Python : scripts/recus-fixtures.mjs ; l'accord entre les deux est prouvé par
//    scripts/verifier-recus-parite.mjs) ; 2. les pièces jointes ; 3. ce que la fonction FAIT d'un reçu, sur une base en mémoire :
//    pas de doublon, un PDF joint à une ligne qui n'en avait pas, un essai qui n'écrit rien, un échec d'écriture qui ne laisse pas de
//    fichier orphelin, jamais d'écriture hors du projet de la clé ; 4. la fin du passage (le battement) ; 5. les données reçues.
import { verifie, bilan } from './_assert.ts'
import { CAS_VALIDES, CAS_REFUSES, recu } from '../../scripts/recus-fixtures.mjs'
import { Refus, analyser, choisirPdf, decoderBase64, hoteStripe, lienPdfAccepte, lirePdf, noteDuPassage, nomAffichable, nomSur, pdfValide, plusJours } from '../../supabase/functions/cockpit-recus/regle.ts'
import {
  ErreurDonnees, texteBorne, traiterPassage, traiterRecu, validerCadence, validerResultats,
  type Battement, type Contexte, type DepenseExistante, type Fichier, type LienPdf, type Magasin, type NouvelleDepense,
} from '../../supabase/functions/cockpit-recus/traiter.ts'
import { SAUTS_MAX, pdfDuLienStripe, type Ouvrir } from '../../supabase/functions/cockpit-recus/lien.ts'

const AUJOURDHUI = '2026-10-14'

console.log('1. La lecture d’un reçu')
for (const cas of CAS_VALIDES as { nom: string; texte: string; attendu?: Record<string, unknown> }[]) {
  let r: Record<string, unknown> | null = null
  let erreur = ''
  try { r = analyser(cas.texte, AUJOURDHUI) as unknown as Record<string, unknown> } catch (e) { erreur = String(e) }
  const ok = r !== null && Object.entries(cas.attendu ?? {}).every(([k, v]) => JSON.stringify(r![k]) === JSON.stringify(v))
  verifie(`lu : ${cas.nom}`, ok, erreur || r)
}
for (const cas of CAS_REFUSES as { nom: string; texte: string; morceau: string }[]) {
  let message = ''
  try { analyser(cas.texte, AUJOURDHUI) } catch (e) { message = e instanceof Refus ? e.message : `PAS UN REFUS : ${e}` }
  verifie(`refusé : ${cas.nom}`, message.includes(cas.morceau), message)
}
verifie('un montant de 20 chiffres ne casse rien (calcul exact, refus du plafond)', (() => {
  try { analyser(recu({ sym: '$', montant: '99999999999999999999.99', lignes: [['One-time credit purchase', '99999999999999999999.99']] }), AUJOURDHUI); return false } catch (e) { return e instanceof Refus && e.message.includes('hors limites') }
})())
verifie('la même somme, mal additionnée d’un centime sur de gros chiffres : refusée', (() => {
  try { analyser(recu({ sym: '$', montant: '1,000.00', lignes: [['One-time credit purchase', '999.99']] }), AUJOURDHUI); return false } catch (e) { return e instanceof Refus && e.message.includes('somme des lignes') }
})())
verifie('le 5 000,00 exact passe, jamais plus', analyser(recu({ sym: '$', montant: '5,000.00', date: 'September 12, 2026', lignes: [['One-time credit purchase', '5,000.00']] }), AUJOURDHUI).montant === '5000.00')
verifie('un jour d’avance (fuseau) est toléré, deux jours non', (() => {
  const mois = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const en = (iso: string) => { const [a, m, j] = iso.split('-').map(Number); return `${mois[m - 1]} ${j}, ${a}` }
  const lire = (iso: string) => { try { analyser(recu({ montant: '289.00', date: en(iso), lignes: [['Max plan - 5x', '289.00']] }), AUJOURDHUI); return true } catch { return false } }
  return lire(plusJours(AUJOURDHUI, 1)) && !lire(plusJours(AUJOURDHUI, 2))
})())
verifie('plusJours passe les fins de mois et d’année', plusJours('2026-12-31', 1) === '2027-01-01' && plusJours('2026-03-01', -1) === '2026-02-28' && plusJours('2024-03-01', -1) === '2024-02-29')

console.log('2. Les pièces jointes')
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n')
const enBase64 = (o: Uint8Array) => btoa(String.fromCharCode(...o))
const enBase64Url = (o: Uint8Array) => enBase64(o).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
verifie('base64 normal et base64 « URL » sans bourrage (celui de Gmail) donnent les mêmes octets', (() => {
  const a = decoderBase64(enBase64(PDF)), b = decoderBase64(enBase64Url(PDF))
  return !!a && !!b && a.length === PDF.length && b.length === PDF.length && a.every((x, i) => x === PDF[i]) && b.every((x, i) => x === PDF[i])
})())
verifie('base64 invalide, vide ou avec des signes interdits : rien', decoderBase64('') === null && decoderBase64('***') === null && decoderBase64('AB=') === null && decoderBase64('<html>') === null)
const F = 'DVBC0000-0006'
const p = (nom: string, o: Uint8Array = PDF) => [{ nom, base64: enBase64Url(o) }]
verifie('aucune pièce jointe : « absent »', lirePdf([], F).genre === 'absent')
verifie('la pièce « Invoice-<n° de facture>.pdf » est prise (majuscules indifférentes)', lirePdf(p(`Invoice-${F}.pdf`), F).genre === 'ok' && lirePdf(p(`invoice-${F.toLowerCase()}.PDF`), F).genre === 'ok')
verifie('une pièce d’une AUTRE facture est refusée', lirePdf(p('Invoice-ZZZZ9999-0001.pdf'), F).genre === 'refuse')
verifie('le PDF du reçu (« Receipt-… ») n’est pas pris pour la facture', lirePdf(p('Receipt-1111-2222-3333.pdf'), F).genre === 'refuse')
{
  const r = lirePdf(p('Invoice-ZZZZ9999-0001.pdf'), F)
  verifie('le refus dit ce qui a été vu (le nom des pièces), pas seulement « refusé »', r.genre === 'refuse' && r.raison.includes(`ne porte le n° ${F}`) && r.raison.includes('Invoice-ZZZZ9999-0001.pdf'), r)
  const long = lirePdf([{ nom: '<script>alert(1)</script>' + 'x'.repeat(80) + '.pdf', base64: enBase64(PDF) }], F)
  verifie('…et ce nom est nettoyé et coupé avant d’aller dans la note (aucun signe de balise, 40 caractères au plus)', long.genre === 'refuse' && !long.raison.includes('<') && !long.raison.includes('>') && !long.raison.includes('alert(1)') && long.raison.length < 140, long)
}
// Chez Anthropic la facture s'appelle « Invoice-<n°>.pdf » (vu sur de vrais mails) ; on accepte aussi tout autre PDF dont le nom porte le n° de facture, et rien d'autre.
verifie('un nom qui contient le n° est pris, même s’il ne s’appelle pas « Invoice-… » (« Facture … », « anthropic-… »)',
  lirePdf(p(`Facture ${F}.pdf`), F).genre === 'ok' && lirePdf(p(`anthropic_${F}_facture.PDF`), F).genre === 'ok')
verifie('choisirPdf : la facture avant le reçu quand les deux portent le n°, jamais une pièce sans le n°, jamais un non-PDF', (() => {
  const noms = (...n: string[]) => n.map((nom) => ({ nom }))
  return choisirPdf(noms(`Receipt-${F}.pdf`, `Invoice-${F}.pdf`), F) === 1
    && choisirPdf(noms(`Invoice-${F}.pdf`, `Receipt-${F}.pdf`), F) === 0
    && choisirPdf(noms(`Receipt-${F}.pdf`), F) === 0
    && choisirPdf(noms('Receipt-1111-2222-3333.pdf', `Invoice-${F}.pdf`), F) === 1
    && choisirPdf(noms('Receipt-1111-2222-3333.pdf'), F) === -1
    && choisirPdf(noms(`Invoice-${F}.txt`, `Invoice-${F}.pdf.exe`), F) === -1
    && choisirPdf([], F) === -1
})())
verifie('choisirPdf : insensible à la casse et aux espaces autour du nom', choisirPdf([{ nom: `  INVOICE-${F.toLowerCase()}.PDF ` }], F) === 0)
verifie('une pièce dont le nom est celui de la facture mais qui n’est pas un PDF est refusée (le nom ne suffit pas)', lirePdf(p(`Invoice-${F}.pdf`, new TextEncoder().encode('GIF89a')), F).genre === 'refuse')
verifie('nomAffichable : lettres, chiffres, . _ - et espace seulement, 40 caractères au plus', nomAffichable('Facture n°12 (copie).pdf') === 'Facture n12 copie.pdf' && nomAffichable('é-ü.pdf') === 'é-ü.pdf' && nomAffichable('<b>x</b>\n\t') === 'bxb' && nomAffichable('a'.repeat(60)).length === 40 && nomAffichable('***') === '')
verifie('pdfValide : les mêmes règles pour une pièce jointe et pour un lien (en-tête %PDF-, 5 Mo)', pdfValide(PDF, F).genre === 'ok' && pdfValide(new TextEncoder().encode('<html>'), F).genre === 'refuse' && pdfValide(null, F).genre === 'refuse' && pdfValide(new Uint8Array(5 * 1024 * 1024 + 1), F).genre === 'refuse')
verifie('lienPdfAccepte : seul https://pay.stripe.com/invoice/… (pas un autre hôte, pas http, pas d’identifiant, pas d’autre chemin, pas d’autre port)',
  lienPdfAccepte('https://pay.stripe.com/invoice/acct_1/live_2/pdf?s=em')
  && !lienPdfAccepte('http://pay.stripe.com/invoice/acct_1/live_2/pdf')
  && !lienPdfAccepte('https://pay.stripe.com.exemple.test/invoice/acct_1/live_2/pdf')
  && !lienPdfAccepte('https://pay.stripe.com@exemple.test/invoice/acct_1/live_2/pdf')
  && !lienPdfAccepte('https://user:mdp@pay.stripe.com/invoice/acct_1/live_2/pdf')
  && !lienPdfAccepte('https://pay.stripe.com/receipt/acct_1')
  && !lienPdfAccepte('https://pay.stripe.com:8443/invoice/acct_1/live_2/pdf')
  && !lienPdfAccepte('https://dashboard.stripe.com/receipts/invoices/TEST/pdf?s=em')
  && !lienPdfAccepte('https://169.254.169.254/invoice/')
  && !lienPdfAccepte('') && !lienPdfAccepte(null) && !lienPdfAccepte(undefined) && !lienPdfAccepte('pas une adresse'))
verifie('hoteStripe : une redirection reste chez Stripe (stripe.com et ses sous-domaines), jamais ailleurs',
  hoteStripe('https://files.stripe.com/links/abc') && hoteStripe('https://stripe.com/x') && hoteStripe('https://invoice.stripe.com/i/acct_1')
  && !hoteStripe('https://evilstripe.com/x') && !hoteStripe('https://stripe.com.exemple.test/x') && !hoteStripe('http://files.stripe.com/x')
  && !hoteStripe('https://files.stripe.com@exemple.test/x') && !hoteStripe('https://files.stripe.com:8443/x') && !hoteStripe('') && !hoteStripe('pas une adresse'))
verifie('un fichier qui n’est pas un PDF est refusé', (() => { const r = lirePdf(p(`Invoice-${F}.pdf`, new TextEncoder().encode('<html>pas un pdf</html>')), F); return r.genre === 'refuse' && r.raison.includes("pas un PDF") })())
verifie('un PDF trop gros (plus de 5 Mo) est refusé sans être décodé', (() => { const r = lirePdf([{ nom: `Invoice-${F}.pdf`, base64: 'A'.repeat(7_500_000) }], F); return r.genre === 'refuse' && r.raison.includes('trop gros') })())
verifie('un contenu en base64 illisible est refusé', lirePdf([{ nom: `Invoice-${F}.pdf`, base64: '!!!' }], F).genre === 'refuse')
verifie('nom de fichier sûr', nomSur('Reçu de février (n°2).pdf') === 'Recu-de-fevrier-n-2-.pdf'.replace('-.pdf', '.pdf') || nomSur('Reçu de février (n°2).pdf').endsWith('.pdf'))

console.log('3. Ce que la fonction fait d’un reçu (base en mémoire)')
interface Ligne { id: string; fichier: Fichier | null; type: string; projet_id: string; reference: string }
/** `lien` : ce que répondrait Stripe au téléchargement du lien « Download invoice » (sans lui, le magasin ne sait pas télécharger de lien). */
function fabrique(projetId = 'projet-A', lien?: (adresse: string) => Promise<LienPdf>) {
  const lignes: Ligne[] = []
  const fichiers = new Map<string, number>()
  const battements: { service: string; b: Battement }[] = []
  const appels = { deposer: 0, retirer: 0, inserer: 0, joindre: 0, battement: 0, lien: 0 }
  const adresses: string[] = []
  const pannes = { inserer: false, joindre: false, joindreFaux: false, deposer: false }
  const mag: Magasin = {
    ...(lien ? { async pdfDuLien(a: string): Promise<LienPdf> { appels.lien++; adresses.push(a); return lien(a) } } : {}),
    async depenseParReference(pid: string, ref: string): Promise<DepenseExistante | null> {
      const l = lignes.find((x) => x.projet_id === pid && x.reference === ref)
      return l ? { id: l.id, fichier: l.fichier, type: l.type } : null
    },
    async deposer(chemin: string, octets: Uint8Array) { appels.deposer++; if (pannes.deposer) throw new Error('stockage en panne'); fichiers.set(chemin, octets.length) },
    async retirer(chemin: string) { appels.retirer++; fichiers.delete(chemin) },
    async inserer(d: NouvelleDepense) {
      appels.inserer++
      if (pannes.inserer) throw new Error('insertion refusée')
      lignes.push({ id: `L${lignes.length + 1}`, fichier: d.fichier, type: d.type, projet_id: d.projet_id, reference: d.reference })
      recus.push(d)
    },
    async joindre(id: string, f: Fichier) {
      appels.joindre++
      if (pannes.joindre) throw new Error('mise à jour refusée')
      if (pannes.joindreFaux) return false
      const l = lignes.find((x) => x.id === id)
      if (!l || l.fichier) return false
      l.fichier = f
      return true
    },
    async battement(service: string, b: Battement) { appels.battement++; battements.push({ service, b }) },
  }
  const recus: NouvelleDepense[] = []
  const ctx: Contexte = { projetId, serviceId: 'service-A', depuis: '2026-01-01', cadenceActuelle: null, aujourdhui: AUJOURDHUI, maintenant: () => '2026-10-14T08:00:00.000Z', erreurInterne: () => { internes++ } }
  let internes = 0
  return { mag, lignes, fichiers, appels, adresses, pannes, ctx, battements, recus, internes: () => internes }
}
const T1 = recu({ montant: '289.00', periode: 'Oct 2–Nov 2, 2026', lignes: [['Max plan - 5x', '289.00']], numFact: F, numRecu: '1111-0000-0001' })
const T2 = recu({ sym: '$', montant: '5.60', date: 'September 10, 2026', lignes: [['One-time credit purchase', '5.60']], numFact: 'DVBC0000-0007', numRecu: '1111-0000-0002' })
const entree = (texte: string, pdfs: { nom: string; base64: string }[] = [], essai = false) => ({ texte, pdfs, essai })

{
  const b = fabrique()
  const r = await traiterRecu(b.ctx, entree(T1), b.mag)
  verifie('un reçu neuf sans PDF : ajouté, « PDF absent », une seule ligne, aucun fichier', r.statut === 'ajoute' && r.pdf === 'absent' && b.lignes.length === 1 && b.fichiers.size === 0 && b.appels.deposer === 0, r)
  verifie('la ligne est une « facture » du bon projet et du bon prestataire, avec la référence, le montant, la devise, la date, la description', b.recus[0].type === 'facture' && b.recus[0].projet_id === 'projet-A' && b.recus[0].service_id === 'service-A'
    && b.recus[0].reference === F && b.recus[0].montant === '289.00' && b.recus[0].devise === 'ILS' && b.recus[0].date === '2026-10-02' && b.recus[0].fichier === null
    && b.recus[0].description === 'Abonnement Claude Max 5x, 2 oct. au 2 nov. 2026 · reçu 1111-0000-0001', b.recus[0])
  const r2 = await traiterRecu(b.ctx, entree(T1), b.mag)
  verifie('le même reçu une 2e fois : « déjà là », rien d’écrit', r2.statut === 'deja_la' && b.lignes.length === 1 && b.appels.inserer === 1, r2)
}
{
  const b = fabrique()
  const r = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  const f = b.recus[0]?.fichier
  verifie('un reçu neuf AVEC son PDF : ajouté, PDF déposé, fichier rangé sous <projet>/depenses/<uuid>-Invoice-<facture>.pdf',
    r.statut === 'ajoute' && r.pdf === 'depose' && !!f && /^projet-A\/depenses\/[0-9a-f-]{36}-Invoice-DVBC0000-0006\.pdf$/.test(f.chemin) && f.nom === `Invoice-${F}.pdf` && f.type === 'application/pdf' && f.taille === PDF.length && b.fichiers.has(f.chemin), { r, f })
  const r2 = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('renvoyé une 2e fois avec son PDF : « déjà là, PDF déjà joint », ni 2e ligne ni 2e fichier', r2.statut === 'deja_la' && r2.pdf === 'deja' && b.lignes.length === 1 && b.fichiers.size === 1 && b.appels.deposer === 1, r2)
}
{
  const b = fabrique()
  await traiterRecu(b.ctx, entree(T1), b.mag)
  const r = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('une ligne déjà là SANS PDF reçoit le PDF quand le mail en porte un (les anciennes factures retrouvent le leur)', r.statut === 'pdf_joint' && r.pdf === 'depose' && b.lignes.length === 1 && !!b.lignes[0].fichier && b.fichiers.size === 1, r)
  const r2 = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('…et une seule fois', r2.statut === 'deja_la' && b.fichiers.size === 1 && b.appels.joindre === 1, r2)
}
{
  const b = fabrique()
  await traiterRecu(b.ctx, entree(T1), b.mag)
  const r = await traiterRecu(b.ctx, entree(T1), b.mag)
  verifie('une ligne sans PDF et un mail sans PDF : rien à faire', r.statut === 'deja_la' && r.pdf === 'absent' && b.appels.deposer === 0 && b.appels.joindre === 0, r)
}
{
  const b = fabrique()
  const r = await traiterRecu(b.ctx, entree(T1, p('Invoice-ZZZZ9999-0001.pdf')), b.mag)
  verifie('un PDF qui n’est pas celui de la facture : la ligne est ajoutée SANS lui, et le refus est dit', r.statut === 'ajoute' && r.pdf === 'refuse' && /ne porte le n°/.test(r.message ?? '') && b.fichiers.size === 0 && b.lignes.length === 1, r)
  const note = noteDuPassage([r]).note
  verifie('…ce refus passe le battement en « echec » (visible dans Coûts)', noteDuPassage([r]).statut === 'echec' && note.includes(F), note)
}
{
  const b = fabrique()
  const r = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`, new TextEncoder().encode('MZ pas un pdf')) ), b.mag)
  verifie('un « PDF » qui n’en est pas un n’est jamais rangé', r.pdf === 'refuse' && b.fichiers.size === 0 && b.recus[0].fichier === null, r)
}
{
  const b = fabrique()
  const avant = JSON.stringify([...b.fichiers])
  const r1 = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`), true), b.mag)
  verifie('ESSAI, reçu neuf : « à ajouter », PDF « serait déposé », RIEN d’écrit', r1.statut === 'a_ajouter' && r1.pdf === 'serait_depose' && b.appels.inserer + b.appels.deposer + b.appels.joindre + b.appels.battement === 0 && b.lignes.length === 0 && JSON.stringify([...b.fichiers]) === avant, r1)
  await traiterRecu(b.ctx, entree(T1), b.mag)
  const r2 = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`), true), b.mag)
  verifie('ESSAI, ligne sans PDF : « PDF joint » (serait joint), RIEN d’écrit', r2.statut === 'pdf_joint' && r2.pdf === 'serait_joint' && b.appels.deposer === 0 && b.appels.joindre === 0 && b.lignes[0].fichier === null, r2)
}
{
  const b = fabrique()
  b.ctx.depuis = '2026-10-03'
  const r = await traiterRecu(b.ctx, entree(T1), b.mag)
  verifie('un reçu d’avant la date de départ est laissé de côté (l’historique s’ajoute à part)', r.statut === 'hors_periode' && b.lignes.length === 0 && /avant le 2026-10-03/.test(r.message ?? ''), r)
  b.ctx.depuis = '2026-10-02'
  verifie('…le jour même, il est pris', (await traiterRecu(b.ctx, entree(T1), b.mag)).statut === 'ajoute')
}
{
  const b = fabrique()
  const r = await traiterRecu(b.ctx, entree(recu({ montant: '289.00', lignes: [['Max plan - 5x', '289.00'], ['Extra', '10.00']] })), b.mag)
  verifie('un reçu qui ne concorde pas : « refus » avec la raison en clair, rien d’écrit', r.statut === 'refus' && /somme des lignes/.test(r.message ?? '') && b.appels.inserer === 0, r)
  const r2 = await traiterRecu(b.ctx, entree('Bonjour, voici ma facture : 100 euros.'), b.mag)
  verifie('un texte étranger : « refus »', r2.statut === 'refus' && b.lignes.length === 0, r2)
}
{
  const b = fabrique()
  b.pannes.inserer = true
  const r = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('l’ajout échoue : « erreur » sans détail technique, le PDF déjà déposé est retiré (aucun fichier orphelin), l’erreur est journalisée côté serveur', r.statut === 'erreur' && !/refusée/.test(r.message ?? '') && b.fichiers.size === 0 && b.appels.retirer === 1 && b.internes() === 1 && b.lignes.length === 0, r)
  b.pannes.inserer = false
  const r2 = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('…et le passage suivant réessaie et réussit (rien n’a été à moitié écrit)', r2.statut === 'ajoute' && b.lignes.length === 1 && b.fichiers.size === 1, r2)
}
{
  const b = fabrique()
  await traiterRecu(b.ctx, entree(T1), b.mag)
  b.pannes.joindre = true
  const r = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('la mise à jour du PDF échoue : « erreur », fichier retiré, la ligne reste telle quelle', r.statut === 'erreur' && b.fichiers.size === 0 && b.lignes[0].fichier === null && b.internes() === 1, r)
  b.pannes.joindre = false
  b.pannes.joindreFaux = true
  const r2 = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('un autre passage a joint un PDF entre-temps (course) : le nôtre est retiré, rien n’est écrasé', r2.statut === 'deja_la' && b.fichiers.size === 0, r2)
}
{
  const b = fabrique()
  b.pannes.deposer = true
  const r = await traiterRecu(b.ctx, entree(T2, p('Invoice-DVBC0000-0007.pdf')), b.mag)
  verifie('le stockage est en panne : « erreur », aucune ligne sans son PDF n’est écrite à moitié', r.statut === 'erreur' && b.lignes.length === 0, r)
}
{
  const a = fabrique('projet-A'), c = fabrique('projet-B')
  await traiterRecu(a.ctx, entree(T1), a.mag)
  verifie('une même facture dans un autre projet n’est pas « déjà là » (la clé ne voit que son projet)', (await traiterRecu(c.ctx, entree(T1), c.mag)).statut === 'ajoute' && a.lignes.length === 1 && c.lignes.length === 1)
  const toutes = [...a.recus, ...c.recus]
  verifie('chaque écriture porte le projet et le prestataire de SA clé, jamais ceux de la requête', toutes.every((d) => d.service_id === 'service-A') && a.recus.every((d) => d.projet_id === 'projet-A') && c.recus.every((d) => d.projet_id === 'projet-B'))
}

// Le lien « Download invoice » du mail : un secours quand la pièce jointe manque. Il expire (valable à 11 jours, expiré à 33, vu le 13 oct.) :
// son échec ne doit JAMAIS rougir la carte du prestataire (sinon chaque vieille facture le ferait à chaque passage, pour toujours).
console.log('3 bis. Le lien « Download invoice » en secours de la pièce jointe')
const LIEN_BON = 'https://pay.stripe.com/invoice/acct_TEST/live_TEST/pdf?s=em'
{
  const b = fabrique('projet-A', async () => ({ octets: PDF }))
  const r = await traiterRecu(b.ctx, entree(T1), b.mag)
  const f = b.recus[0]?.fichier
  verifie('sans pièce jointe, le PDF du lien est pris : ligne ajoutée AVEC son PDF, rangé sous <projet>/depenses/…/Invoice-<facture>.pdf',
    r.statut === 'ajoute' && r.pdf === 'depose' && !!f && f.nom === `Invoice-${F}.pdf` && b.fichiers.has(f.chemin) && b.appels.lien === 1 && b.adresses[0] === LIEN_BON, { r, f })
  verifie('…et la note du passage ne parle pas de PDF manquant', !/PDF à joindre/.test(noteDuPassage([r]).note) && noteDuPassage([r]).statut === 'ok')
}
{
  const b = fabrique('projet-A', async () => ({ octets: new TextEncoder().encode('%PDF-1.7 autre') }))
  const r = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  verifie('la pièce jointe du mail passe AVANT le lien : le lien n’est même pas ouvert', r.pdf === 'depose' && b.appels.lien === 0 && b.fichiers.size === 1, r)
}
{
  const b = fabrique('projet-A', async () => ({ octets: PDF }))
  const r = await traiterRecu(b.ctx, entree(T1, p('Invoice-ZZZZ9999-0001.pdf')), b.mag)
  verifie('une pièce jointe d’une AUTRE facture + un lien valable : le PDF du lien est pris (la pièce fausse n’est jamais rangée)', r.statut === 'ajoute' && r.pdf === 'depose' && b.fichiers.size === 1 && b.appels.lien === 1, r)
}
for (const [nom, reponse] of [
  ['lien expiré', async (): Promise<LienPdf> => ({ raison: 'lien expiré' })],
  ['refusé par Stripe', async (): Promise<LienPdf> => ({ raison: 'PDF refusé par Stripe (HTTP 403)' })],
  ['Stripe injoignable (l’appel lève une erreur)', async (): Promise<LienPdf> => { throw new Error('connexion coupée') }],
  ['réponse qui n’est pas un PDF (page de connexion)', async (): Promise<LienPdf> => ({ octets: new TextEncoder().encode('<html>Sign in</html>') })],
  ['réponse vide', async (): Promise<LienPdf> => ({ octets: new Uint8Array(0) })],
  ['PDF de plus de 5 Mo', async (): Promise<LienPdf> => ({ octets: new Uint8Array(5 * 1024 * 1024 + 1) })],
] as [string, () => Promise<LienPdf>][]) {
  const b = fabrique('projet-A', reponse)
  const r = await traiterRecu(b.ctx, entree(T1), b.mag)
  const n = noteDuPassage([r])
  verifie(`${nom}, sans pièce jointe : la facture est ajoutée, « PDF à joindre à la main », la carte reste VERTE (pas d’échec)`,
    r.statut === 'ajoute' && r.pdf === 'absent' && r.message === undefined && b.fichiers.size === 0 && b.recus[0].fichier === null && n.statut === 'ok' && n.note.includes(`PDF à joindre à la main : ${F}`), { r, n })
}
{
  const b = fabrique('projet-A', async () => ({ raison: 'lien expiré' }))
  const r = await traiterRecu(b.ctx, entree(T1, p('Invoice-ZZZZ9999-0001.pdf')), b.mag)
  verifie('une pièce jointe fausse ET un lien qui échoue : le refus de la pièce jointe reste dit (c’est une vraie anomalie, la carte le montre)', r.statut === 'ajoute' && r.pdf === 'refuse' && /ne porte le n°/.test(r.message ?? '') && noteDuPassage([r]).statut === 'echec', r)
}
{
  const b = fabrique('projet-A', async () => ({ octets: PDF }))
  const faux = T1.replace(LIEN_BON, 'https://exemple.test/invoice/acct_TEST/live_TEST/pdf')
  const r = await traiterRecu(b.ctx, entree(faux), b.mag)
  verifie('un lien qui n’est pas celui de Stripe n’est JAMAIS ouvert par la fonction (le texte du mail ne choisit pas où elle va)', faux !== T1 && b.appels.lien === 0 && r.pdf === 'absent' && b.fichiers.size === 0, { r, appels: b.appels })
  const sans = fabrique('projet-A', async () => ({ octets: PDF }))
  const r2 = await traiterRecu(sans.ctx, entree(recu({ montant: '289.00', periode: 'Oct 2–Nov 2, 2026', lignes: [['Max plan - 5x', '289.00']], numFact: F, numRecu: '1111-0000-0001' }).replace(/Download invoice \([^)]*\) /, '')), sans.mag)
  verifie('un mail sans lien « Download invoice » : rien à ouvrir, « PDF absent »', sans.appels.lien === 0 && r2.pdf === 'absent', r2)
}
{
  const b = fabrique('projet-A', async () => ({ octets: PDF }))
  await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  const avant = b.appels.lien
  const r = await traiterRecu(b.ctx, entree(T1), b.mag)
  verifie('une ligne qui a déjà son PDF : « déjà là », AUCUN téléchargement du lien', r.statut === 'deja_la' && r.pdf === 'deja' && b.appels.lien === avant, r)
}
{
  const b = fabrique('projet-A', async () => ({ octets: PDF }))
  await traiterRecu(b.ctx, entree(T1), b.mag) // le lien sert déjà : on le coupe pour poser une ligne SANS PDF
  b.lignes[0].fichier = null
  b.fichiers.clear()
  const r = await traiterRecu(b.ctx, entree(T1), b.mag)
  verifie('une ligne déjà là SANS PDF reçoit celui du lien (les anciennes factures dont le lien vit encore retrouvent leur PDF)', r.statut === 'pdf_joint' && r.pdf === 'depose' && !!b.lignes[0].fichier && b.fichiers.size === 1, r)
}
{
  const b = fabrique('projet-A', async () => ({ octets: PDF }))
  const r = await traiterRecu(b.ctx, entree(T1, [], true), b.mag)
  verifie('ESSAI avec un lien valable : « serait déposé », rien d’écrit (la lecture du lien n’écrit rien)', r.statut === 'a_ajouter' && r.pdf === 'serait_depose' && b.appels.inserer + b.appels.deposer + b.appels.joindre + b.appels.battement === 0 && b.lignes.length === 0, r)
}

console.log('3 ter. Le téléchargement du lien (faux réseau) : seulement Stripe, redirections une à une, taille et délai bornés')
{
  const reponse = (corps: BodyInit | null, init: ResponseInit = {}) => new Response(corps, init)
  const faux = (table: Record<string, () => Response>) => {
    const vus: { adresse: string; redirect: string; entetes: string[] }[] = []
    const ouvrir: Ouvrir = async (adresse, o) => {
      vus.push({ adresse, redirect: o.redirect, entetes: Object.keys(o.headers) })
      const f = table[adresse]
      if (!f) throw new Error('adresse non prévue : ' + adresse)
      return f()
    }
    return { ouvrir, vus }
  }
  const L = 'https://pay.stripe.com/invoice/acct_1/live_2/pdf?s=em'
  const va = (adresse: string) => () => reponse(null, { status: 302, headers: { location: adresse } })
  const raison = (r: Awaited<ReturnType<typeof pdfDuLienStripe>>) => ('raison' in r ? r.raison : '')

  let f = faux({ [L]: () => reponse(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } }) })
  let r = await pdfDuLienStripe(L, f.ouvrir)
  verifie('un lien qui rend un PDF : les octets, une seule requête, redirections « manuelles », aucun en-tête d’identité (seulement « accept »)', 'octets' in r && r.octets.length === PDF.length && f.vus.length === 1 && f.vus[0].redirect === 'manual' && JSON.stringify(f.vus[0].entetes) === '["accept"]', { r, vus: f.vus })

  f = faux({ [L]: va('https://files.stripe.com/v1/files/abc'), 'https://files.stripe.com/v1/files/abc': () => reponse(PDF, { status: 200 }) })
  r = await pdfDuLienStripe(L, f.ouvrir)
  verifie('une redirection vers files.stripe.com est suivie (chez Stripe, en https)', 'octets' in r && f.vus.map((v) => v.adresse).join(' > ') === `${L} > https://files.stripe.com/v1/files/abc`, { r, vus: f.vus })

  f = faux({ [L]: va('/invoice/autre/pdf'), 'https://pay.stripe.com/invoice/autre/pdf': () => reponse(PDF, { status: 200 }) })
  r = await pdfDuLienStripe(L, f.ouvrir)
  verifie('une redirection relative reste sur le même site Stripe', 'octets' in r && f.vus.length === 2, { r, vus: f.vus })

  for (const [nom, cible] of [['un autre site', 'https://exemple.test/x'], ['un retour en http', 'http://files.stripe.com/x'], ['un site qui ressemble à Stripe', 'https://stripe.com.exemple.test/x'], ['une adresse à identifiant (stripe.com@…)', 'https://files.stripe.com@exemple.test/x'], ['un autre port', 'https://files.stripe.com:8443/x']] as [string, string][]) {
    f = faux({ [L]: va(cible), [cible]: () => reponse(PDF, { status: 200 }) })
    r = await pdfDuLienStripe(L, f.ouvrir)
    verifie(`une redirection vers ${nom} est refusée et l’autre adresse n’est JAMAIS ouverte`, raison(r) === 'redirection hors de Stripe refusée' && f.vus.length === 1, { r, vus: f.vus })
  }
  f = faux({ [L]: () => reponse(null, { status: 302 }) })
  verifie('une redirection sans adresse est refusée', raison(await pdfDuLienStripe(L, f.ouvrir)) === 'redirection sans adresse')

  // 4 redirections au plus : 4 passent, la 5e est refusée
  const chaine = (n: number, fin: () => Response) => {
    const adresses = [L, ...Array.from({ length: n }, (_, i) => `https://files.stripe.com/etape-${i + 1}`)]
    const table: Record<string, () => Response> = {}
    adresses.forEach((a, i) => { table[a] = i < n ? va(adresses[i + 1]) : fin })
    return faux(table)
  }
  f = chaine(SAUTS_MAX, () => reponse(PDF, { status: 200 }))
  r = await pdfDuLienStripe(L, f.ouvrir)
  verifie(`${SAUTS_MAX} redirections de suite puis le PDF : accepté (${SAUTS_MAX + 1} requêtes)`, 'octets' in r && f.vus.length === SAUTS_MAX + 1, { r, n: f.vus.length })
  f = chaine(SAUTS_MAX + 1, () => reponse(PDF, { status: 200 }))
  r = await pdfDuLienStripe(L, f.ouvrir)
  verifie(`${SAUTS_MAX + 1} redirections de suite : refusé « trop de redirections », jamais plus de ${SAUTS_MAX + 1} requêtes`, raison(r) === 'trop de redirections' && f.vus.length === SAUTS_MAX + 1, { r, n: f.vus.length })

  // refus de Stripe
  for (const [status, corps, attendu] of [[404, '{}', 'PDF refusé par Stripe (HTTP 404)'], [400, '{"error":{"message":"Multi region routing target not found."}}', 'PDF refusé par Stripe (HTTP 400)'], [403, '{"error":"This invoice link has EXPIRED"}', 'lien expiré'], [500, 'oups', 'PDF refusé par Stripe (HTTP 500)']] as [number, string, string][]) {
    f = faux({ [L]: () => reponse(corps, { status }) })
    verifie(`Stripe répond ${status} : « ${attendu} »`, raison(await pdfDuLienStripe(L, f.ouvrir)) === attendu)
  }
  f = faux({ [L]: () => reponse('x'.repeat(5_000_000) + 'expired', { status: 410 }) })
  verifie('une page d’erreur énorme n’est lue que sur ses premiers octets (le mot « expired » tout au bout ne compte pas)', raison(await pdfDuLienStripe(L, f.ouvrir)) === 'PDF refusé par Stripe (HTTP 410)')

  // taille
  f = faux({ [L]: () => reponse(PDF, { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } }) })
  verifie('une taille annoncée de plus de 5 Mo est refusée avant toute lecture', raison(await pdfDuLienStripe(L, f.ouvrir)).includes('trop gros'))
  {
    let tires = 0, annule = false
    const flux = new ReadableStream<Uint8Array>({
      pull(c) { tires++; if (tires > 20) { c.close(); return } c.enqueue(new Uint8Array(1024 * 1024)) },
      cancel() { annule = true },
    })
    f = faux({ [L]: () => reponse(flux, { status: 200 }) })
    verifie('sans taille annoncée, la lecture s’arrête à 5 Mo : refusé, le flux est annulé (pas de lecture jusqu’au bout)', raison(await pdfDuLienStripe(L, f.ouvrir)).includes('trop gros') && annule && tires <= 8, { tires, annule })
  }
  f = faux({ [L]: () => reponse(null, { status: 200 }) })
  verifie('une réponse 200 vide : « réponse vide »', raison(await pdfDuLienStripe(L, f.ouvrir)) === 'réponse vide')

  // réseau et délai
  f = { ouvrir: async () => { throw new Error('connexion coupée') }, vus: [] }
  verifie('le réseau échoue : « téléchargement impossible », rien ne lève', raison(await pdfDuLienStripe(L, f.ouvrir)) === 'téléchargement impossible')
  {
    const lent: Ouvrir = (_a, o) => new Promise((_ok, ko) => { o.signal.addEventListener('abort', () => ko(o.signal.reason)) })
    const debut = Date.now()
    const garde = setTimeout(() => {}, 4000) // le minuteur de AbortSignal.timeout ne retient pas le processus : sans cela Node s'arrête avant l'échéance (en vrai, la requête en cours le retient)
    const rr = await pdfDuLienStripe(L, lent, 40)
    clearTimeout(garde)
    verifie('un site qui ne répond jamais : le délai coupe (40 ms ici, 25 s en vrai) et la raison est « téléchargement impossible »', raison(rr) === 'téléchargement impossible' && Date.now() - debut < 3000, { rr, ms: Date.now() - debut })
  }

  // adresses refusées d'emblée : aucune requête
  for (const mauvais of ['https://exemple.test/invoice/x', 'http://pay.stripe.com/invoice/x', 'https://pay.stripe.com/receipt/x', 'https://user@pay.stripe.com/invoice/x', '', 'pas une adresse']) {
    f = faux({})
    const rr = await pdfDuLienStripe(mauvais, f.ouvrir)
    verifie(`adresse de départ refusée sans aucune requête : « ${mauvais} »`, raison(rr).startsWith('lien du PDF inattendu') && f.vus.length === 0, { rr, vus: f.vus })
  }

  // un 200 qui n'est pas un PDF (page de connexion) : les octets sont rendus, c'est pdfValide qui refuse
  f = faux({ [L]: () => reponse('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
  r = await pdfDuLienStripe(L, f.ouvrir)
  verifie('une page web rendue à la place du PDF : les octets passent, et la règle commune (pdfValide) les refuse', 'octets' in r && pdfValide(r.octets, F).genre === 'refuse')
}

console.log('4. La fin du passage (le battement)')
{
  const b = fabrique()
  const ajoute = await traiterRecu(b.ctx, entree(T1, p(`Invoice-${F}.pdf`)), b.mag)
  const s = await traiterPassage(b.ctx, { resultats: [ajoute], echec: null, cadenceJours: 7, essai: false }, b.mag)
  verifie('un passage réussi écrit « ok », sa phrase, la cadence et l’heure', s.statut === 'ok' && s.battement === 'ecrit' && b.battements.length === 1 && b.battements[0].service === 'service-A'
    && b.battements[0].b.import_statut === 'ok' && b.battements[0].b.import_cadence_jours === 7 && b.battements[0].b.import_at === '2026-10-14T08:00:00.000Z'
    && b.battements[0].b.import_note === '1 facture ajoutée : 289,00 ₪ (2 oct.)', b.battements)
  const s2 = await traiterPassage(b.ctx, { resultats: [], echec: 'Gmail inaccessible', cadenceJours: null, essai: false }, b.mag)
  verifie('un passage impossible est noté « echec » avec sa raison, la cadence reste celle de la fois d’avant ou 7', s2.statut === 'echec' && b.battements[1].b.import_note === "Le passage n'a pas pu avoir lieu : Gmail inaccessible" && b.battements[1].b.import_cadence_jours === 7)
  b.ctx.cadenceActuelle = 14
  await traiterPassage(b.ctx, { resultats: [], echec: null, cadenceJours: null, essai: false }, b.mag)
  verifie('sans cadence donnée, la cadence déjà notée est gardée (14)', b.battements[2].b.import_cadence_jours === 14 && b.battements[2].b.import_note === 'Rien de nouveau')
  const avant = b.appels.battement
  const s3 = await traiterPassage(b.ctx, { resultats: [ajoute], echec: null, cadenceJours: 7, essai: true }, b.mag)
  verifie('ESSAI : la phrase est calculée mais RIEN n’est écrit', s3.battement === 'non_ecrit_essai' && b.appels.battement === avant && s3.note.length > 0)
}
verifie('cadence : 1 à 90 jours entiers, sinon rien', validerCadence(7) === 7 && validerCadence(1) === 1 && validerCadence(90) === 90 && validerCadence(0) === null && validerCadence(91) === null && validerCadence(7.5) === null && validerCadence('7') === null && validerCadence(undefined) === null)

console.log('5. Les données reçues du programme')
const ok = validerResultats([{ statut: 'ajoute', facture: F, montant: '289.00', devise: 'ILS', date: '2026-10-02', pdf: 'depose', quoi: 'mail du 2 oct.', message: 'ok' }])
verifie('un résultat bien formé est gardé tel quel', ok.length === 1 && ok[0].facture === F && ok[0].montant === '289.00' && ok[0].pdf === 'depose')
verifie('rien, ou une liste vide : aucun résultat', validerResultats(undefined).length === 0 && validerResultats(null).length === 0 && validerResultats([]).length === 0)
verifie('un statut inconnu est refusé (400)', (() => { try { validerResultats([{ statut: 'invente' }]); return false } catch (e) { return e instanceof ErreurDonnees } })())
verifie('autre chose qu’une liste, ou plus de 200 résultats : refusé', (() => { try { validerResultats('x'); return false } catch (e) { if (!(e instanceof ErreurDonnees)) return false } try { validerResultats(Array.from({ length: 201 }, () => ({ statut: 'deja_la' }))); return false } catch (e) { return e instanceof ErreurDonnees } })())
const sale = validerResultats([{ statut: 'refus', facture: 'pas une facture', montant: '12,5', devise: 'euro', date: '2026-13-45', pdf: 'peut-être', quoi: 'x'.repeat(500), message: 'ligne 1\nligne 2\u0007' }])[0]
verifie('les champs mal formés sont écartés, les textes nettoyés et coupés', sale.facture === undefined && sale.montant === undefined && sale.devise === undefined && sale.date === undefined && sale.pdf === undefined && (sale.quoi ?? '').length === 80 && sale.message === 'ligne 1 ligne 2', sale)
verifie('texteBorne : pas de caractères de commande, 200 au plus, vide = rien', texteBorne('a\u0000b', 50) === 'a b' && texteBorne('x'.repeat(300), 200)!.length === 200 && texteBorne('   ', 50) === undefined && texteBorne(12, 50) === undefined)

bilan('verifier-recus-regle')
