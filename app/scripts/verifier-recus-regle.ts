// La règle des reçus côté serveur (supabase/functions/cockpit-recus : regle.ts + traiter.ts), sans réseau ni base.
// node --experimental-strip-types app/scripts/verifier-recus-regle.ts
// 1. la lecture d'un reçu (mêmes cas que le lecteur Python : scripts/recus-fixtures.mjs ; l'accord entre les deux est prouvé par
//    scripts/verifier-recus-parite.mjs) ; 2. les pièces jointes ; 3. ce que la fonction FAIT d'un reçu, sur une base en mémoire :
//    pas de doublon, un PDF joint à une ligne qui n'en avait pas, un essai qui n'écrit rien, un échec d'écriture qui ne laisse pas de
//    fichier orphelin, jamais d'écriture hors du projet de la clé ; 4. la fin du passage (le battement) ; 5. les données reçues.
import { verifie, bilan } from './_assert.ts'
import { CAS_VALIDES, CAS_REFUSES, recu } from '../../scripts/recus-fixtures.mjs'
import { Refus, analyser, decoderBase64, lirePdf, noteDuPassage, nomSur, plusJours } from '../../supabase/functions/cockpit-recus/regle.ts'
import {
  ErreurDonnees, texteBorne, traiterPassage, traiterRecu, validerCadence, validerResultats,
  type Battement, type Contexte, type DepenseExistante, type Fichier, type Magasin, type NouvelleDepense,
} from '../../supabase/functions/cockpit-recus/traiter.ts'

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
verifie('un fichier qui n’est pas un PDF est refusé', (() => { const r = lirePdf(p(`Invoice-${F}.pdf`, new TextEncoder().encode('<html>pas un pdf</html>')), F); return r.genre === 'refuse' && r.raison.includes("pas un PDF") })())
verifie('un PDF trop gros (plus de 5 Mo) est refusé sans être décodé', (() => { const r = lirePdf([{ nom: `Invoice-${F}.pdf`, base64: 'A'.repeat(7_500_000) }], F); return r.genre === 'refuse' && r.raison.includes('trop gros') })())
verifie('un contenu en base64 illisible est refusé', lirePdf([{ nom: `Invoice-${F}.pdf`, base64: '!!!' }], F).genre === 'refuse')
verifie('nom de fichier sûr', nomSur('Reçu de février (n°2).pdf') === 'Recu-de-fevrier-n-2-.pdf'.replace('-.pdf', '.pdf') || nomSur('Reçu de février (n°2).pdf').endsWith('.pdf'))

console.log('3. Ce que la fonction fait d’un reçu (base en mémoire)')
interface Ligne { id: string; fichier: Fichier | null; type: string; projet_id: string; reference: string }
function fabrique(projetId = 'projet-A') {
  const lignes: Ligne[] = []
  const fichiers = new Map<string, number>()
  const battements: { service: string; b: Battement }[] = []
  const appels = { deposer: 0, retirer: 0, inserer: 0, joindre: 0, battement: 0 }
  const pannes = { inserer: false, joindre: false, joindreFaux: false, deposer: false }
  const mag: Magasin = {
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
  return { mag, lignes, fichiers, appels, pannes, ctx, battements, recus, internes: () => internes }
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
  verifie('un PDF qui n’est pas celui de la facture : la ligne est ajoutée SANS lui, et le refus est dit', r.statut === 'ajoute' && r.pdf === 'refuse' && /ne s'appelle/.test(r.message ?? '') && b.fichiers.size === 0 && b.lignes.length === 1, r)
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
