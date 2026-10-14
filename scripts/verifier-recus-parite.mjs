// Parité du lecteur de reçus : Python (scripts/importer-recus.py, la règle des sessions Claude) et TypeScript
// (supabase/functions/cockpit-recus/regle.ts, la règle de la fonction serveur) lisent les MÊMES reçus et doivent rendre
// le même résultat, au caractère près (14 oct. 2026, chantier 72a8d0f4).
//   node --experimental-strip-types scripts/verifier-recus-parite.mjs        (hors ligne : ni base ni réseau, tourne à chaque envoi)
// Pourquoi : deux copies d'une règle d'argent dérivent en silence. Ici, un reçu lu autrement par l'une que par l'autre fait rougir ce banc.
// 1. les constantes (fournisseur, expéditeur, objet, plafond, date minimale, taille du PDF, cadence) ;
// 2. chaque reçu valide (scripts/recus-fixtures.mjs) : même JSON ; chaque reçu refusé : même message ;
// 3. les phrases (montant, jour, période, nom de fichier, requête Gmail, phrase du passage) ;
// 4. le programme du compte Google (app/src/google/recus-claude/Code.gs) : mêmes expéditeur et objet ;
// 5. les mots que l'écran montre (assistant d'installation, carte du prestataire) : aucun mot de développeur (scripts/clarte.py).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deepStrictEqual } from "node:assert";
import { CAS_VALIDES, CAS_REFUSES } from "./recus-fixtures.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT = join(RACINE, "scripts/importer-recus.py");
const regle = await import("../supabase/functions/cockpit-recus/regle.ts");

let total = 0, echecs = 0;
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? " — " + String(detail).slice(0, 600) : ""}`); } };
const dossier = mkdtempSync(join(tmpdir(), "cockpit-parite-"));
let n = 0;

function python(code, entree) {
  const r = spawnSync("python3", ["-I", "-c", `
import importlib.util, json, sys
s = importlib.util.spec_from_file_location('imp', ${JSON.stringify(IMPORT)}); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
data = json.loads(sys.stdin.read() or 'null')
${code}
`], { encoding: "utf8", input: JSON.stringify(entree ?? null) });
  if (r.status !== 0) throw new Error(`Python a échoué : ${r.stderr.slice(0, 400)}`);
  return JSON.parse(r.stdout);
}
function lirePython(texte) {
  const f = join(dossier, `${++n}.txt`);
  writeFileSync(f, texte);
  const r = spawnSync("python3", ["-I", IMPORT, "--analyser", f], { encoding: "utf8" });
  if (r.status === 0) return { json: JSON.parse(r.stdout) };
  return { refus: r.stderr.replace(/^Refusé : /, "").replace(/\n$/, ""), status: r.status };
}
function lireTs(texte) {
  try { return { json: JSON.parse(JSON.stringify(regle.analyser(texte))) }; }
  catch (e) { if (e instanceof regle.Refus) return { refus: e.message }; throw e; }
}
const egal = (a, b) => { try { deepStrictEqual(a, b); return true; } catch { return false; } };

try {
  console.log("1. Les constantes");
  const c = python(`print(json.dumps({'fournisseur': m.FOURNISSEUR, 'expediteur': m.GMAIL_EXPEDITEUR, 'sujet': m.GMAIL_SUJET, 'max': str(m.MONTANT_MAX), 'date_min': m.DATE_MIN.isoformat(), 'pdf': m.PDF_TAILLE_MAX, 'note': m.NOTE_MAX, 'cadence': m.CADENCE_PAR_DEFAUT}))`);
  verifie("fournisseur, expéditeur et objet des reçus", c.fournisseur === regle.FOURNISSEUR && c.expediteur === regle.GMAIL_EXPEDITEUR && c.sujet === regle.GMAIL_SUJET, JSON.stringify(c));
  verifie("plafond d'un reçu, jour minimal, taille du PDF, longueur de la note, cadence par défaut", BigInt(c.max) * 100n === regle.MONTANT_MAX_CENTIMES && c.date_min === regle.DATE_MIN && c.pdf === regle.PDF_TAILLE_MAX && c.note === regle.NOTE_MAX && c.cadence === regle.CADENCE_PAR_DEFAUT, JSON.stringify(c));

  console.log("2. Les mêmes reçus, la même lecture");
  for (const cas of CAS_VALIDES) {
    const py = lirePython(cas.texte), ts = lireTs(cas.texte);
    verifie(`lu pareil : ${cas.nom}`, py.json !== undefined && ts.json !== undefined && egal(py.json, ts.json), JSON.stringify({ py, ts }));
  }
  for (const cas of CAS_REFUSES) {
    const py = lirePython(cas.texte), ts = lireTs(cas.texte);
    verifie(`refusé pareil : ${cas.nom}`, py.refus !== undefined && ts.refus !== undefined && py.refus === ts.refus && py.refus.includes(cas.morceau), JSON.stringify({ py: py.refus, ts: ts.refus, attendu: cas.morceau }));
  }
  // la date du jour entre dans la règle (« demain toléré ») : les deux lecteurs doivent suivre la même
  const demain = regle.plusJours(regle.aujourdhuiIso(), 1), apresDemain = regle.plusJours(regle.aujourdhuiIso(), 2);
  const MOIS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const enAnglais = (iso) => { const [a, m, j] = iso.split("-").map(Number); return `${MOIS[m - 1]} ${j}, ${a}`; };
  const { recu } = await import("./recus-fixtures.mjs");
  for (const [nom, jour, lu] of [["demain (fuseau) : toléré", demain, true], ["après-demain : refusé", apresDemain, false]]) {
    const texte = recu({ montant: "289.00", date: enAnglais(jour), lignes: [["Max plan - 5x", "289.00"]] });
    const py = lirePython(texte), ts = lireTs(texte);
    verifie(`${nom} (les deux lecteurs)`, (py.json !== undefined) === lu && (ts.json !== undefined) === lu, JSON.stringify({ py, ts }));
  }

  console.log("3. Les phrases");
  const montants = [["289.00", "ILS"], ["5.60", "USD"], ["1234.50", "EUR"], ["1234567.89", "GBP"], ["0.05", "USD"], ["22.67", "ILS"], ["12.00", "CAD"]];
  const mf = python(`print(json.dumps([m.montant_fr(__import__('decimal').Decimal(a), d) for a, d in data]))`, montants);
  verifie("montant en français (espaces des milliers, virgule, symbole)", egal(mf, montants.map(([a, d]) => regle.montantFr(BigInt(a.replace(".", "")), d))), JSON.stringify(mf));
  const jours = [["2026-10-02", false], ["2026-01-15", true], ["2025-12-31", true], ["2026-09-30", false]];
  const jf = python(`print(json.dumps([m.jour_fr(__import__('datetime').date.fromisoformat(a), b) for a, b in data]))`, jours);
  verifie("jour en français, avec ou sans année", egal(jf, jours.map(([a, b]) => regle.jourFr(a, b))), JSON.stringify(jf));
  const noms = ["Invoice-DVBC0000-0006.pdf", "Reçu de février (n°2).pdf", "  espaces  et/slash.pdf", "...cachee", "é-à-ç.pdf", "A".repeat(120) + ".pdf", "日本語.pdf", ""];
  const ns = python(`print(json.dumps([m.nom_sur(a) for a in data]))`, noms);
  verifie("nom de fichier sûr (sans accents, espaces ni caractères spéciaux, 80 caractères au plus)", egal(ns, noms.map((a) => regle.nomSur(a))), JSON.stringify(ns));
  const requetes = ["2026-01-01", "2026-03-01", "2025-12-31", "2026-10-14"];
  const rg = python(`print(json.dumps([m.requete_gmail(__import__('datetime').date.fromisoformat(a)) for a in data]))`, requetes);
  verifie("recherche Gmail (expéditeur exact, objet, un jour de marge)", egal(rg, requetes.map((a) => regle.requeteGmail(a))), JSON.stringify(rg));

  // le lien « Download invoice » qu'on a le droit d'ouvrir : la même règle des deux côtés (sinon une session et la fonction ne téléchargeraient pas les mêmes adresses)
  const liens = [
    "https://pay.stripe.com/invoice/acct_1/live_2/pdf?s=em", "https://pay.stripe.com:443/invoice/acct_1/live_2/pdf",
    "http://pay.stripe.com/invoice/acct_1/live_2/pdf", "https://pay.stripe.com.exemple.test/invoice/acct_1/live_2/pdf",
    "https://pay.stripe.com@exemple.test/invoice/acct_1/live_2/pdf", "https://user:mdp@pay.stripe.com/invoice/acct_1/live_2/pdf",
    "https://user@pay.stripe.com/invoice/acct_1/live_2/pdf", "https://pay.stripe.com:8443/invoice/acct_1/live_2/pdf",
    "https://pay.stripe.com:abc/invoice/acct_1/live_2/pdf", "https://pay.stripe.com/receipt/acct_1", "https://pay.stripe.com/",
    "https://dashboard.stripe.com/receipts/invoices/TEST/pdf?s=em", "https://169.254.169.254/invoice/", "ftp://pay.stripe.com/invoice/x",
    "", "pas une adresse", "//pay.stripe.com/invoice/x", "https:///invoice/x",
  ];
  const lp = python(`print(json.dumps([m.lien_pdf_accepte(x) for x in data]))`, liens);
  verifie("lien du PDF acceptable : mêmes réponses (hôte exact, https, /invoice/, sans identifiant, sans port étranger)", egal(lp, liens.map((x) => regle.lienPdfAccepte(x))), JSON.stringify({ py: lp, ts: liens.map((x) => regle.lienPdfAccepte(x)) }));
  verifie(`…et la table est sensée (2 adresses acceptées sur ${liens.length} : l'adresse normale, et la même avec le port 443)`, liens.filter((x) => regle.lienPdfAccepte(x)).length === 2, liens.filter((x) => regle.lienPdfAccepte(x)).join(" "));

  // la phrase du passage : mêmes données des deux côtés
  const A = (montant, devise, date, facture, pdf) => ({ montant, devise, date, facture, pdf });
  const scenarios = [
    { nom: "rien de nouveau", ajoutes: [], deja: 0, erreurs: [] },
    { nom: "rien de nouveau, 2 déjà là", ajoutes: [], deja: 2, erreurs: [] },
    { nom: "une facture avec son PDF", ajoutes: [A("289.00", "ILS", "2026-10-02", "TESTAAAA-0006", "depose")], deja: 0, erreurs: [] },
    { nom: "deux factures, une sans PDF", ajoutes: [A("289.00", "ILS", "2026-10-02", "TESTAAAA-0006", "depose"), A("5.60", "USD", "2026-09-10", "TESTBBBB-0001", "absent")], deja: 1, erreurs: [] },
    { nom: "une erreur", ajoutes: [], deja: 0, erreurs: ["r3.txt : somme des lignes (299.00) n'est pas le total (289.00)"] },
    { nom: "deux erreurs et une facture", ajoutes: [A("1234.50", "EUR", "2026-09-10", "TESTCCCC-0001", "depose")], deja: 0, erreurs: ["a : un", "b : deux"] },
    { nom: "une longue note coupée à 300 caractères", ajoutes: [], deja: 0, erreurs: ["x : " + "mot ".repeat(120)] },
  ];
  const notesPy = python(`
from decimal import Decimal
from datetime import date
out = []
for sc in data:
    aj = [{'montant': Decimal(a['montant']), 'devise': a['devise'], 'date': date.fromisoformat(a['date']), 'facture': a['facture'], 'pdf': a['pdf']} for a in sc['ajoutes']]
    out.append(m.note_du_passage(aj, sc['deja'], 0, sc['erreurs']))
print(json.dumps(out))`, scenarios);
  scenarios.forEach((sc, i) => {
    const resultats = [
      ...sc.ajoutes.map((a) => ({ statut: "ajoute", ...a })),
      ...Array.from({ length: sc.deja }, () => ({ statut: "deja_la" })),
      ...sc.erreurs.map((e) => ({ statut: "refus", quoi: e.split(" : ")[0], message: e.split(" : ").slice(1).join(" : ") })),
    ];
    const note = regle.noteDuPassage(resultats).note;
    verifie(`phrase du passage : ${sc.nom}`, note === notesPy[i], JSON.stringify({ ts: note, py: notesPy[i] }));
  });
  verifie("une erreur met le battement en « echec », sinon « ok »", regle.noteDuPassage([{ statut: "refus", quoi: "x", message: "y" }]).statut === "echec" && regle.noteDuPassage([{ statut: "deja_la" }]).statut === "ok");
  verifie("un passage impossible : même phrase que --echec du lecteur Python", regle.noteDuPassage([], "Gmail inaccessible").note === "Le passage n'a pas pu avoir lieu : Gmail inaccessible");

  console.log("4. Le programme du compte Google");
  const programme = join(RACINE, "app/src/google/recus-claude/Code.gs");
  if (!existsSync(programme)) verifie("le programme existe (app/src/google/recus-claude/Code.gs)", false, "fichier absent");
  else {
    const src = readFileSync(programme, "utf8");
    const lire = (nom) => new RegExp(`const ${nom} = '([^']*)';`).exec(src)?.[1];
    verifie("même expéditeur que la règle (Python et TypeScript)", lire("EXPEDITEUR") === c.expediteur && lire("EXPEDITEUR") === regle.GMAIL_EXPEDITEUR, lire("EXPEDITEUR"));
    verifie("même objet que la règle (Python et TypeScript)", lire("SUJET") === c.sujet && lire("SUJET") === regle.GMAIL_SUJET, lire("SUJET"));
  }

  console.log("5. Les mots de l'écran (règle de clarté : aucun mot de développeur)");
  const { textesDeLAssistant, etatGoogle } = await import("../app/src/lib/recusGoogle.ts");
  const cle = (extra) => ({ id: "k", projet_id: "p", service_id: "s", fin: "ab12", created_at: "2026-10-14T11:00:00Z", revoquee_at: null, derniere_utilisation_at: null, utilisations: 0, programme_version: null, ...extra });
  const NOW = new Date("2026-10-14T12:00:00Z");
  const etats = [["aucune", null, 1], ["attente", cle(), 1], ["branché", cle({ derniere_utilisation_at: "2026-10-14T11:55:00Z", programme_version: 1 }), 1], ["périmé", cle({ derniere_utilisation_at: "2026-10-14T11:55:00Z", programme_version: 1 }), 2]]
    .flatMap(([nom, k, v]) => { const e = etatGoogle(k, v, NOW); return [{ nom: `carte ${nom} (titre)`, texte: e.titre }, { nom: `carte ${nom} (détail)`, texte: e.detail ?? "" }]; });
  const paires = [...textesDeLAssistant(), ...etats].flatMap((x) => [x.nom, x.texte]).join("\0") + "\0";
  const clair = spawnSync("python3", ["-I", join(RACINE, "scripts/clarte.py")], { input: paires, encoding: "utf8" });
  verifie("les textes de l'assistant et de la carte passent le contrôle de vocabulaire (scripts/clarte.py)", clair.status === 0, clair.stderr);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}
console.log(`\n${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
