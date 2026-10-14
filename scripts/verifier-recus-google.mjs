// Reçus Claude par le programme du compte Google (migration 0087, fonction cockpit-recus, programme app/src/google/recus-claude) :
// la porte, de bout en bout, sur un projet jetable `test-recusgoogle-…` (14 oct. 2026, chantier 72a8d0f4).
//   node --experimental-strip-types scripts/verifier-recus-google.mjs            la fonction DÉPLOYÉE (celle que Raphaël utilisera)
//   DENO=/chemin/deno node --experimental-strip-types scripts/verifier-recus-google.mjs --local   la fonction lancée ici avec Deno,
//        contre la vraie base : sert avant tout déploiement (npm install deno ; `deno check supabase/functions/cockpit-recus/index.ts`)
//   COCKPIT_RECUS_URL=… pour viser une autre adresse.
// 1. la clé : créée par un admin seulement, montrée une fois (la base n'en garde que l'empreinte), UNE active par prestataire, révocable ;
// 2. la porte : sans clé, clé inconnue ou révoquée, mauvaise méthode, requête illisible, trop grosse : refus en clair ;
// 3. un reçu : ajouté une seule fois, PDF rangé, PDF joint à une ligne qui n'en avait pas, PDF suspect refusé, refus de la règle, essai sans
//    aucune écriture, avant la date de départ ; le battement (dernier passage, échec, essai) ;
// 4. LE PROGRAMME lui-même (Code.gs + appsscript.json, tels que Raphaël les collera) exécuté contre un faux Gmail : il ne lit que l'expéditeur
//    voulu, n'envoie jamais le contenu d'un autre mail, ne fait que des GET sur Gmail, n'écrit rien dans Gmail, ne montre jamais la clé,
//    programme UN seul passage du dimanche, remonte ses échecs ; et ce qu'il envoie arrive vraiment dans Coûts ;
// 5. aucun reste : ligne, prestataire, clé, projet et fichiers sont supprimés à la fin.
// Aucune donnée réelle : reçus FICTIFS (scripts/recus-fixtures.mjs). Ne vise jamais un vrai projet.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import vm from "node:vm";
import { lancerFonctionLocale, projetsDeTestAbandonnes, purgerProjetsDeTest } from "./bancs.mjs";
import { recu } from "./recus-fixtures.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = join(RACINE, "scripts/sql.sh");
const REF = "bexiyvmdbxcwxasgslxp", API = `https://${REF}.supabase.co`, CLE_PUBLIQUE = "sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U";
const URL_BASE = (process.env.SUPABASE_URL || API).replace(/\/$/, "");
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SR) { console.error("SUPABASE_SERVICE_ROLE_KEY absente."); process.exit(2); }
const EMAIL = process.env.COCKPIT_TEST_EMAIL ?? "test-cockpit@cockpit.local";
const LOCAL = process.argv.includes("--local");
const PREFIXE = "test-recusgoogle-";
const SLUG = `${PREFIXE}${randomUUID().slice(0, 8)}`, P = randomUUID(), S1 = randomUUID(), S2 = randomUUID();
const PROGRAMME = join(RACINE, "app/src/google/recus-claude/Code.gs"), REGLAGES = join(RACINE, "app/src/google/recus-claude/appsscript.json");

let total = 0, echecs = 0;
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? " — " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 700) : ""}`); } };
const q = (s) => s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`;
function sql(requete) {
  const r = spawnSync(SQL, [requete], { encoding: "utf8" });
  let j; try { j = JSON.parse(r.stdout || "{}"); } catch { j = { ok: false, error: r.stdout + r.stderr }; }
  if (!j.ok) throw new Error(`SQL refusé : ${j.error ?? r.stderr}\n  ${requete.slice(0, 200)}`);
  return j.rows ?? [];
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------------------------- la fonction (déployée ou locale)
let serveur = null, FONCTION = process.env.COCKPIT_RECUS_URL || `${URL_BASE}/functions/v1/cockpit-recus`;
const arreter = () => { try { serveur?.arreter(); } catch { /* déjà arrêté */ } };

async function appel(corps, { cle, methode = "POST", brut, entetes = {} } = {}) {
  const h = { "content-type": "application/json", ...entetes };
  if (cle) h["x-cockpit-key"] = cle;
  const r = await fetch(FONCTION, { method: methode, headers: h, body: methode === "GET" ? undefined : (brut ?? JSON.stringify(corps)) });
  let json = null; const texte = await r.text(); try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
  return { code: r.status, json, texte };
}

// ------------------------------------------------------------------------------------------------ une session d'administrateur
async function sessionAdmin() {
  const h = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
  const lien = await (await fetch(`${API}/auth/v1/admin/generate_link`, { method: "POST", headers: h, body: JSON.stringify({ type: "magiclink", email: EMAIL }) })).json();
  const ses = await (await fetch(`${API}/auth/v1/verify`, { method: "POST", headers: { apikey: CLE_PUBLIQUE, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: lien.hashed_token ?? lien.properties?.hashed_token }) })).json();
  if (!ses.access_token) throw new Error("connexion de l'administrateur de test impossible");
  return ses.access_token;
}
async function rpc(nom, args, jeton) {
  const r = await fetch(`${API}/rest/v1/rpc/${nom}`, { method: "POST", headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${jeton ?? CLE_PUBLIQUE}`, "Content-Type": "application/json", "Content-Profile": "cockpit" }, body: JSON.stringify(args) });
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { code: r.status, json };
}
async function stockage(methode, chemin) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/cockpit-medias/${chemin.split("/").map(encodeURIComponent).join("/")}`, { method: methode, headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  return { code: r.status, debut: methode === "GET" ? Buffer.from(await r.arrayBuffer()).subarray(0, 8).toString("latin1") : "" };
}

// ---------------------------------------------------------------------------------------------------------------- les fixtures
function pdf(texte) {
  return Buffer.from(`%PDF-1.4\n% ${texte}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, "latin1");
}
const b64url = (b) => Buffer.from(b).toString("base64url");
const ASSET = (nom, buf) => ({ nom, buf, base64: b64url(buf) });
const MAX5 = [["Max plan - 5x", "289.00"]];
const recuP = (num, extra = {}) => recu({ montant: "289.00", periode: "Oct 2–Nov 2, 2026", lignes: MAX5, numFact: `TESTRG${String(num).padStart(4, "0")}-0001`, numRecu: `2222-0000-${String(num).padStart(4, "0")}`, ...extra });

const dossiers = [];
let purges = 0;
async function purgerRestes() {
  const vieux = await projetsDeTestAbandonnes(sql, PREFIXE);
  for (const v of vieux) for (const f of sql(`select fichier->>'chemin' c from depenses where projet_id = ${q(v.id)} and fichier is not null`)) await stockage("DELETE", f.c);
  if (vieux.length) { await purgerProjetsDeTest(async (x) => sql(x), vieux.map((v) => v.id), PREFIXE); purges = vieux.length; }
}
const depenses = () => sql(`select id, reference, montant::text m, devise, type, service_id, projet_id, date::text d, description, fichier, compta_statut from depenses where projet_id = ${q(P)} order by reference`);
const objets = () => sql(`select name from storage.objects where bucket_id = 'cockpit-medias' and name like ${q(P + "/depenses/%")} order by name`).map((r) => r.name);
const service = (id) => sql(`select import_depuis::text depuis, import_cadence_jours cad, import_at::text at, import_statut st, import_note note, (now() - import_at) < interval '3 minutes' recent from services where id = ${q(id)}`)[0];
const cleDb = (id) => sql(`select id, empreinte, fin, service_id, projet_id, revoquee_at::text rev, derniere_utilisation_at::text der, utilisations, programme_version v from cles_import where id = ${q(id)}`)[0];

// ======================================================================================================================= banc
try {
  if (LOCAL) { serveur = await lancerFonctionLocale(RACINE, "cockpit-recus", URL_BASE); FONCTION = serveur.url; console.log(`(fonction lancée ici avec Deno : ${FONCTION})`); }
  else console.log(`(fonction visée : ${FONCTION})`);
  await purgerRestes();
  sql(`insert into projets (id, slug, nom, depot) values (${q(P)}, ${q(SLUG)}, 'Test reçus Google', 'rnab26/test-recus-google')`);
  sql(`insert into services (id, projet_id, nom, devise, import_depuis) values (${q(S1)}, ${q(P)}, 'Claude', 'ILS', '2026-01-01'), (${q(S2)}, ${q(P)}, 'Claude (programme)', 'ILS', '2026-01-01')`);
  const jeton = await sessionAdmin();

  console.log("1. La clé");
  const anon = await rpc("creer_cle_import", { p_service: S1 });
  verifie("sans connexion, créer une clé est refusé", anon.code === 401 || anon.code === 403, anon);
  const a = await rpc("creer_cle_import", { p_service: S1 }, jeton);
  const K1 = a.json;
  verifie("un administrateur crée une clé : « cki_ » + 64 caractères hexadécimaux, rendue en clair", a.code === 200 && /^cki_[0-9a-f]{64}$/.test(K1 ?? ""), a);
  const id1 = sql(`select id from cles_import where service_id = ${q(S1)} and revoquee_at is null`)[0]?.id;
  const l1 = cleDb(id1);
  verifie("la base ne garde que l'empreinte (sha256) et les 4 derniers caractères, jamais la clé", l1.empreinte === sha256(K1) && l1.fin === K1.slice(-4) && !JSON.stringify(l1).includes(K1)
    && sql(`select count(*)::int n from cles_import where to_jsonb(cles_import)::text like ${q("%" + K1 + "%")}`)[0].n === 0, l1);
  verifie("l'empreinte de la base est celle de cockpit.hacher_jeton (la même que la fonction calcule)", sql(`select cockpit.hacher_jeton(${q(K1)}) h`)[0].h === sha256(K1));
  const b = await rpc("creer_cle_import", { p_service: S1 }, jeton);
  const K1b = b.json;
  verifie("une nouvelle clé REMPLACE l'ancienne : l'ancienne est révoquée, une seule reste active", /^cki_/.test(K1b) && K1b !== K1 && cleDb(id1).rev !== null
    && sql(`select count(*)::int n from cles_import where service_id = ${q(S1)} and revoquee_at is null`)[0].n === 1);
  const inconnu = await rpc("creer_cle_import", { p_service: randomUUID() }, jeton);
  verifie("un prestataire inconnu est refusé en clair", inconnu.code >= 400 && /prestataire inconnu/.test(JSON.stringify(inconnu.json)), inconnu);
  const lecture = await fetch(`${API}/rest/v1/cles_import?select=*`, { headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${CLE_PUBLIQUE}`, "Accept-Profile": "cockpit" } });
  verifie("un visiteur sans connexion ne lit aucune clé", lecture.status === 401 || lecture.status === 403 || (await lecture.json()).length === 0);
  const ecriture = await fetch(`${API}/rest/v1/cles_import`, { method: "POST", headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", "Content-Profile": "cockpit" }, body: JSON.stringify({ projet_id: P, service_id: S1, empreinte: sha256("x"), fin: "xxxx" }) });
  verifie("même un administrateur n'écrit pas dans la table en direct : seules les deux fonctions créent et révoquent", ecriture.status === 401 || ecriture.status === 403, ecriture.status);
  const K = K1b, idK = sql(`select id from cles_import where service_id = ${q(S1)} and revoquee_at is null`)[0].id;

  console.log("2. La porte");
  let r = await appel({ action: "etat" });
  verifie("sans clé : 401 en clair", r.code === 401 && r.json?.ok === false && /Clé manquante/.test(r.json.erreur), r);
  r = await appel({ action: "etat" }, { cle: "n'importe quoi" });
  verifie("clé mal formée : 401, aucune lecture de la base", r.code === 401 && /Clé inconnue/.test(r.json?.erreur ?? ""), r);
  r = await appel({ action: "etat" }, { cle: "cki_" + "0".repeat(64) });
  verifie("clé bien formée mais inconnue : 401", r.code === 401 && /Clé inconnue/.test(r.json?.erreur ?? ""), r);
  r = await appel({ action: "etat" }, { cle: K1 });
  verifie("clé remplacée (révoquée) : 401 qui dit quoi faire", r.code === 401 && /remplacée ou révoquée/.test(r.json?.erreur ?? ""), r);
  r = await appel({ action: "etat", cle: K });
  verifie("la clé peut aussi venir du corps de la requête", r.code === 200 && r.json?.ok === true, r);
  r = await appel(null, { cle: K, methode: "GET" });
  verifie("GET : 405", r.code === 405, r);
  r = await appel(null, { cle: K, brut: "ceci n'est pas du JSON" });
  verifie("corps illisible : 400", r.code === 400 && /JSON valide/.test(r.json?.erreur ?? ""), r);
  r = await appel(null, { cle: K, brut: "[1,2]" });
  verifie("un tableau au lieu d'un objet : 400", r.code === 400, r);
  r = await appel({ action: "n-importe-quoi" }, { cle: K });
  verifie("action inconnue : 400", r.code === 400 && /Action inconnue/.test(r.json?.erreur ?? ""), r);
  r = await appel({}, { cle: K });
  verifie("action absente : 400", r.code === 400 && /champ « action »/.test(r.json?.erreur ?? ""), r);
  r = await appel({ action: "recu" }, { cle: K });
  verifie("reçu sans texte : 400", r.code === 400 && /texte du reçu/.test(r.json?.erreur ?? ""), r);
  r = await appel({ action: "recu", texte: "x".repeat(200_001) }, { cle: K });
  verifie("texte de plus de 200 000 caractères : 413", r.code === 413, r);
  r = await appel({ action: "recu", texte: recuP(1), pdfs: "pas une liste" }, { cle: K });
  verifie("pièces jointes qui ne sont pas une liste : 400", r.code === 400, r);
  r = await appel({ action: "recu", texte: recuP(1), pdfs: [1, 2, 3, 4].map((i) => ({ nom: `Invoice-${i}.pdf`, base64: "AAAA" })) }, { cle: K });
  verifie("plus de 3 pièces jointes : 400", r.code === 400 && /3 pièces jointes/.test(r.json?.erreur ?? ""), r);
  r = await appel({ action: "recu", texte: recuP(1), pdfs: [{ nom: "Invoice-x.pdf" }] }, { cle: K });
  verifie("une pièce sans contenu : 400", r.code === 400, r);
  r = await appel({ action: "passage", resultats: [{ statut: "invente" }] }, { cle: K });
  verifie("un résultat de passage au statut inconnu : 400", r.code === 400 && /statut connu/.test(r.json?.erreur ?? ""), r);
  r = await appel({ action: "passage", resultats: "x" }, { cle: K });
  verifie("des résultats qui ne sont pas une liste : 400", r.code === 400, r);
  if (LOCAL) {
    r = await appel({ action: "recu", texte: "x", pad: "y".repeat(8 * 1024 * 1024 + 10_000) }, { cle: K });
    verifie("une requête de plus de 8 Mo : 413", r.code === 413, r.code);
  } else console.log("  (corps de plus de 8 Mo : rejoué avec --local seulement ; sur la fonction déployée la plateforme laisse une requête refusée d'avance suspendue puis rend 503 : mesuré le 14 oct., sans importance pour un reçu de 7 Mo au plus)");
  r = await appel({ action: "etat", pad: "y".repeat(7 * 1024 * 1024) }, { cle: K });
  verifie("une requête de 7 Mo (un PDF de 5 Mo en base64 et son texte) est acceptée", r.code === 200 && r.json?.ok === true, r.code);
  verifie("aucune de ces requêtes refusées n'a écrit quoi que ce soit dans Coûts", depenses().length === 0 && objets().length === 0);

  r = await appel({ action: "etat", version: 1 }, { cle: K });
  verifie("« etat » dit le projet, le prestataire, le jour de départ, la cadence", r.code === 200 && r.json.projet === "Test reçus Google" && r.json.prestataire === "Claude" && r.json.depuis === "2026-01-01" && r.json.cadence_jours === null && r.json.dernier_passage === null, r);
  let cl = cleDb(idK);
  verifie("le dernier contact de la clé est noté, avec la version du programme (l'app s'en sert)", cl.der !== null && cl.utilisations >= 1 && cl.v === 1, cl);

  console.log("3. Un reçu");
  const R1 = recuP(1), R2 = recu({ sym: "$", montant: "5.60", date: "September 10, 2026", lignes: [["One-time credit purchase", "5.60"]], numFact: "TESTRG0002-0001", numRecu: "2222-0000-0002" });
  const R3 = recuP(3, { lignes: [["Max plan - 5x", "289.00"], ["Extra", "10.00"]] });
  const A1 = ASSET("Invoice-TESTRG0001-0001.pdf", pdf("facture 1")), A2 = ASSET("Invoice-TESTRG0002-0001.pdf", pdf("facture 2"));
  r = await appel({ action: "recu", texte: R1, pdfs: [{ nom: A1.nom, base64: A1.base64 }, { nom: "Receipt-2222-0000-0001.pdf", base64: b64url(pdf("reçu 1")) }] }, { cle: K });
  verifie("reçu neuf avec son PDF (et le PDF du reçu, ignoré) : ajouté, PDF rangé", r.code === 200 && r.json.statut === "ajoute" && r.json.pdf === "depose" && r.json.facture === "TESTRG0001-0001" && r.json.montant === "289.00" && r.json.devise === "ILS" && r.json.date === "2026-10-02", r);
  let lignes = depenses();
  const l1d = lignes.find((x) => x.reference === "TESTRG0001-0001");
  verifie("en base : une « facture » du bon projet et du bon prestataire, montant, devise, date, description, à envoyer à la compta", lignes.length === 1 && l1d.type === "facture" && l1d.projet_id === P && l1d.service_id === S1 && l1d.m === "289.00" && l1d.devise === "ILS" && l1d.d === "2026-10-02"
    && l1d.description === "Abonnement Claude Max 5x, 2 oct. au 2 nov. 2026 · reçu 2222-0000-0001" && l1d.compta_statut === "a_envoyer", lignes);
  const f1 = l1d?.fichier;
  verifie("le fichier est rangé sous <projet>/depenses/<uuid>-Invoice-<facture>.pdf avec nom, type et taille", /^[0-9a-f-]{36}\/depenses\/[0-9a-f-]{36}-Invoice-TESTRG0001-0001\.pdf$/.test(f1?.chemin ?? "") && f1.chemin.startsWith(`${P}/`) && f1.nom === A1.nom && f1.type === "application/pdf" && f1.taille === A1.buf.length, f1);
  const lu = f1 ? await stockage("GET", f1.chemin) : { code: 0, debut: "" };
  verifie("il existe vraiment dans le stockage privé et c'est un PDF ; un seul fichier (celui de la facture, pas celui du reçu)", lu.code === 200 && lu.debut.startsWith("%PDF") && objets().length === 1, { lu, objets: objets() });

  r = await appel({ action: "recu", texte: R1, pdfs: [{ nom: A1.nom, base64: A1.base64 }] }, { cle: K });
  verifie("le même reçu une 2e fois : « déjà là », PDF déjà joint, rien de plus (ni ligne ni fichier)", r.json.statut === "deja_la" && r.json.pdf === "deja" && depenses().length === 1 && objets().length === 1, r);

  r = await appel({ action: "recu", texte: R2 }, { cle: K });
  verifie("reçu neuf sans PDF : ajouté, « PDF absent »", r.json.statut === "ajoute" && r.json.pdf === "absent" && r.json.devise === "USD" && depenses().find((x) => x.reference === "TESTRG0002-0001").fichier === null, r);
  r = await appel({ action: "recu", texte: R2, pdfs: [{ nom: A2.nom, base64: A2.base64 }] }, { cle: K });
  const l2d = depenses().find((x) => x.reference === "TESTRG0002-0001");
  verifie("la ligne déjà là SANS PDF reçoit le PDF du mail : « PDF joint »", r.json.statut === "pdf_joint" && r.json.pdf === "depose" && l2d.fichier?.nom === A2.nom && objets().length === 2 && depenses().length === 2, r);
  r = await appel({ action: "recu", texte: R2, pdfs: [{ nom: A2.nom, base64: A2.base64 }] }, { cle: K });
  verifie("…et une seule fois", r.json.statut === "deja_la" && objets().length === 2, r);

  r = await appel({ action: "recu", texte: R3 }, { cle: K });
  verifie("un reçu dont la somme est fausse : « refus » avec la raison, rien d'écrit", r.code === 200 && r.json.statut === "refus" && /somme des lignes/.test(r.json.message) && depenses().length === 2, r);
  r = await appel({ action: "recu", texte: "Bonjour, voici ma facture." }, { cle: K });
  verifie("un texte qui n'est pas un reçu : « refus »", r.json.statut === "refus" && depenses().length === 2, r);

  const R4 = recuP(4);
  r = await appel({ action: "recu", texte: R4, pdfs: [{ nom: "Invoice-AUTRE0000-0001.pdf", base64: A1.base64 }] }, { cle: K });
  verifie("un PDF d'une autre facture : la ligne est ajoutée SANS lui, le refus est dit", r.json.statut === "ajoute" && r.json.pdf === "refuse" && /ne s'appelle/.test(r.json.message) && objets().length === 2, r);
  const R5 = recuP(5);
  r = await appel({ action: "recu", texte: R5, pdfs: [{ nom: "Invoice-TESTRG0005-0001.pdf", base64: b64url(Buffer.from("MZ ceci n'est pas un pdf")) }] }, { cle: K });
  verifie("un « PDF » qui n'en est pas un n'est jamais rangé", r.json.statut === "ajoute" && r.json.pdf === "refuse" && objets().length === 2, r);

  const avantEssai = depenses().length, objetsAvant = objets().length, serviceAvant = service(S1);
  const R6 = recuP(6);
  r = await appel({ action: "recu", texte: R6, pdfs: [{ nom: "Invoice-TESTRG0006-0001.pdf", base64: A1.base64 }], essai: true }, { cle: K });
  verifie("ESSAI sur un reçu neuf : « à ajouter », PDF « serait déposé », RIEN n'est écrit", r.json.statut === "a_ajouter" && r.json.pdf === "serait_depose" && depenses().length === avantEssai && objets().length === objetsAvant, r);
  r = await appel({ action: "recu", texte: R4, pdfs: [{ nom: "Invoice-TESTRG0004-0001.pdf", base64: A1.base64 }], essai: true }, { cle: K });
  verifie("ESSAI sur une ligne sans PDF : « serait joint », RIEN n'est écrit", r.json.statut === "pdf_joint" && r.json.pdf === "serait_joint" && objets().length === objetsAvant, r);

  sql(`update services set import_depuis = '2026-10-03' where id = ${q(S1)}`);
  r = await appel({ action: "etat" }, { cle: K });
  verifie("le jour de départ du prestataire est celui que la clé voit (réglable dans Coûts)", r.json.depuis === "2026-10-03", r);
  const R7 = recu({ sym: "$", montant: "9.00", date: "September 10, 2026", lignes: [["One-time credit purchase", "9.00"]], numFact: "TESTRG0007-0001", numRecu: "2222-0000-0007" });
  r = await appel({ action: "recu", texte: R7 }, { cle: K });
  verifie("un reçu d'avant le jour de départ est laissé de côté (l'historique s'ajoute à part)", r.json.statut === "hors_periode" && /avant le 2026-10-03/.test(r.json.message) && !depenses().some((x) => x.reference === "TESTRG0007-0001"), r);
  sql(`update services set import_depuis = '2026-01-01' where id = ${q(S1)}`);

  console.log("   le battement");
  const resultatsBons = [{ statut: "ajoute", facture: "TESTRG0001-0001", montant: "289.00", devise: "ILS", date: "2026-10-02", pdf: "depose", quoi: "mail du 2026-10-02" }, { statut: "deja_la" }];
  r = await appel({ action: "passage", resultats: resultatsBons, cadence_jours: 7, essai: true }, { cle: K });
  verifie("ESSAI du passage : la phrase est calculée, RIEN n'est écrit sur la carte du prestataire", r.json.battement === "non_ecrit_essai" && r.json.note === "1 facture ajoutée : 289,00 ₪ (2 oct.)" && service(S1).at === serviceAvant.at, { r: r.json, avant: serviceAvant, apres: service(S1) });
  r = await appel({ action: "passage", resultats: resultatsBons, cadence_jours: 7 }, { cle: K });
  let sv = service(S1);
  verifie("un passage écrit « ok », sa phrase, la cadence 7 et l'heure, sur la carte du prestataire", r.json.statut === "ok" && sv.st === "ok" && sv.cad === 7 && sv.recent === true && sv.note === "1 facture ajoutée : 289,00 ₪ (2 oct.)", { r: r.json, sv });
  r = await appel({ action: "passage", resultats: [{ statut: "refus", quoi: "mail du 2026-10-05", message: "somme des lignes (299.00) n'est pas le total (289.00)" }] }, { cle: K });
  sv = service(S1);
  verifie("un reçu refusé met le passage en « echec » avec la raison (visible dans Coûts) ; la cadence déjà notée est gardée", r.json.statut === "echec" && sv.st === "echec" && /1 reçu non lu : mail du 2026-10-05 : somme des lignes/.test(sv.note) && sv.cad === 7, sv);
  r = await appel({ action: "passage", resultats: [], echec: "Gmail inaccessible" }, { cle: K });
  sv = service(S1);
  verifie("un passage impossible est noté « echec » avec sa raison", sv.st === "echec" && sv.note === "Le passage n'a pas pu avoir lieu : Gmail inaccessible", sv);
  r = await appel({ action: "passage", resultats: [] }, { cle: K });
  verifie("rien de nouveau : « Rien de nouveau », « ok »", service(S1).st === "ok" && service(S1).note === "Rien de nouveau");
  r = await appel({ action: "passage", resultats: [{ statut: "refus", quoi: "x".repeat(500), message: "ligne 1\nligne 2" }] }, { cle: K });
  verifie("les textes envoyés par le programme sont coupés et nettoyés (la note reste sous 300 caractères)", service(S1).note.length <= 300 && !service(S1).note.includes("\n"), service(S1).note);

  console.log("4. Le programme du compte Google, exécuté contre un faux Gmail");
  const BOITE = [];
  const source = readFileSync(PROGRAMME, "utf8"), reglages = JSON.parse(readFileSync(REGLAGES, "utf8"));
  const { programmeAvecCle, versionDuProgramme } = await import("../app/src/lib/recusGoogle.ts");
  // -- le programme et ses réglages, lus comme Google les lira
  verifie("les réglages Google sont du JSON valide, en V8, fuseau d'Israël", reglages.runtimeVersion === "V8" && reglages.timeZone === "Asia/Jerusalem");
  verifie("autorisations demandées à Google : lecture des mails (readonly), appels extérieurs, programmation du passage — RIEN d'autre (ni envoi, ni suppression, ni accès complet)",
    JSON.stringify([...reglages.oauthScopes].sort()) === JSON.stringify(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/script.external_request", "https://www.googleapis.com/auth/script.scriptapp"].sort()), reglages.oauthScopes);
  const urlCockpit = /const URL_COCKPIT = '([^']+)';/.exec(source)?.[1], urlGmail = /const GMAIL = '([^']+)';/.exec(source)?.[1];
  verifie("Google ne laisse le programme parler qu'à Gmail et au cockpit (liste du fichier de réglages) : les deux adresses du programme y figurent", Array.isArray(reglages.urlFetchWhitelist) && reglages.urlFetchWhitelist.length === 2
    && reglages.urlFetchWhitelist.every((p) => p.startsWith("https://")) && [urlCockpit, urlGmail + "/messages"].every((u) => reglages.urlFetchWhitelist.some((p) => u.startsWith(p))), { urlCockpit, urlGmail });
  verifie("le programme n'utilise aucun service Google d'écriture ou de lecture directe (ni GmailApp, MailApp, DriveApp, SpreadsheetApp, DocumentApp, CalendarApp, ni la liste des appels autres que Gmail et le cockpit)", !/\b(GmailApp|MailApp|DriveApp|SpreadsheetApp|DocumentApp|CalendarApp|ContactsApp|FormApp|SitesApp|Session|PropertiesService|CacheService|LockService)\b/.test(source));
  verifie("tout appel à Gmail est un GET (aucun POST, PUT, PATCH ou DELETE vers Gmail dans le code)", !/UrlFetchApp\.fetch\(GMAIL[^)]*(post|put|patch|delete)/i.test(source) && (source.match(/method: 'get'/g) ?? []).length === 1 && (source.match(/method: 'post'/g) ?? []).length === 1);
  verifie("le programme porte sa marque de clé exactement une fois ; sa version est lisible", source.split(`'__CLE__'`).length === 2 && versionDuProgramme(source) === 1);
  verifie("sans clé posée, le programme refuse de tourner", (() => {
    const ctx = fabriqueContexte(source, { cle: null });
    try { ctx.run("installer()"); return false; } catch (e) { return /n'a pas sa clé/.test(String(e.message)); }
  })());

  // -- le faux Gmail
  const messageGmail = ({ id, de, sujet, texte, html, pdfs = [], date }) => {
    const texteParts = [];
    if (texte !== undefined) texteParts.push({ partId: "0.0", mimeType: "text/plain", filename: "", headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }], body: { size: texte.length, data: b64url(texte) } });
    if (html !== undefined) texteParts.push({ partId: "0.1", mimeType: "text/html", filename: "", body: { size: html.length, data: b64url(html) } });
    return {
      id, threadId: id, labelIds: ["INBOX"], internalDate: String(Date.parse(date)),
      payload: {
        partId: "", mimeType: "multipart/mixed", filename: "", headers: [{ name: "From", value: de }, { name: "To", value: "moi@example.com" }, { name: "Subject", value: sujet }, { name: "Date", value: date }],
        body: { size: 0 },
        parts: [{ partId: "0", mimeType: "multipart/alternative", filename: "", body: { size: 0 }, parts: texteParts },
          ...pdfs.map((p, i) => ({ partId: String(i + 1), mimeType: "application/pdf", filename: p.nom, body: { attachmentId: `att-${id}-${i}`, size: p.buf.length } }))],
      },
      pdfsParId: Object.fromEntries(pdfs.map((p, i) => [`att-${id}-${i}`, p.base64])),
    };
  };
  const ANTHROPIC = "Anthropic, PBC <invoice+statements@mail.anthropic.com>";
  const SUJ = (n) => `Your receipt from Anthropic, PBC #${n}`;
  const html = (texte) => "<html><head><style>td{color:red}</style></head><body>" + texte.split(/(?<=\)) |(?<=\.) (?=[A-Z])/).map((m) => `<table><tr><td>${m.replace(/&/g, "&amp;")}</td></tr></table>`).join("") + "</body></html>";
  const M = {
    m1: messageGmail({ id: "m1", de: ANTHROPIC, sujet: SUJ("2222-0000-0101"), date: "2026-10-02T18:42:39Z", texte: recuP(101, { numRecu: "2222-0000-0101" }), pdfs: [ASSET("Invoice-TESTRG0101-0001.pdf", pdf("programme 1")), ASSET("Receipt-2222-0000-0101.pdf", pdf("reçu 101"))] }),
    m2: messageGmail({ id: "m2", de: ANTHROPIC, sujet: SUJ("2222-0000-0102"), date: "2026-09-10T08:00:00Z", texte: recu({ sym: "$", montant: "5.60", date: "September 10, 2026", lignes: [["One-time credit purchase", "5.60"]], numFact: "TESTRG0102-0001", numRecu: "2222-0000-0102" }) }),
    m3: messageGmail({ id: "m3", de: '"invoice+statements@mail.anthropic.com" <evil@example.com>', sujet: SUJ("2222-0000-0103"), date: "2026-10-03T08:00:00Z", texte: recuP(103, { numRecu: "2222-0000-0103", apres: " MARQUEUR-SECRET-M3" }) }),
    m4: messageGmail({ id: "m4", de: ANTHROPIC, sujet: SUJ("2222-0000-0104"), date: "2026-10-04T08:00:00Z", texte: recuP(104, { numRecu: "2222-0000-0104", lignes: [["Max plan - 5x", "289.00"], ["Extra", "10.00"]] }) }),
    m5: messageGmail({ id: "m5", de: ANTHROPIC, sujet: SUJ("2222-0000-0105"), date: "2026-10-05T08:00:00Z", html: html(recuP(105, { numRecu: "2222-0000-0105" })) }),
  };
  verifie("(le faux Gmail est fidèle : un mail à parties emboîtées, texte brut + HTML, deux PDF en pièces jointes à récupérer à part)", M.m1.payload.parts.length === 3 && M.m1.payload.parts[0].parts.length === 1 && M.m1.payload.parts[1].body.attachmentId === "att-m1-0");
  BOITE.push(M.m1, M.m2, M.m3, M.m4, M.m5);

  const idsDe = (msgs) => msgs.map((m) => ({ id: m.id, threadId: m.threadId }));
  function fabriqueContexte(src, { cle, boite = BOITE, gmailHs = null, everyWeeksRefuse = false }) {
    const sortie = { requetes: [], logs: [], declencheurs: [], supprimes: [], appelsCockpit: [] };
    const manifest = reglages;
    const prefixes = manifest.urlFetchWhitelist;
    const fetch = (url, params = {}) => {
      const methode = String(params.method ?? "get").toLowerCase();
      sortie.requetes.push({ url, methode, entetes: params.headers ?? {} });
      if (!prefixes.some((p) => url.startsWith(p))) throw new Error(`Google refuserait cette adresse (urlFetchWhitelist) : ${url}`);
      if (url.startsWith("https://gmail.googleapis.com/")) {
        if (methode !== "get") throw new Error("ÉCRITURE VERS GMAIL : " + methode + " " + url);
        if (gmailHs) return { getResponseCode: () => gmailHs, getContentText: () => JSON.stringify({ error: { code: gmailHs, message: "Request had insufficient authentication scopes." } }) };
        const u = new URL(url);
        const chemin = u.pathname.replace("/gmail/v1/users/me", "");
        const rep = (o) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(o) });
        if (chemin === "/messages") return rep({ messages: idsDe(boite), resultSizeEstimate: boite.length });
        let m = /^\/messages\/([^/]+)$/.exec(chemin);
        if (m) {
          const msg = boite.find((x) => x.id === m[1]);
          if (!msg) return { getResponseCode: () => 404, getContentText: () => "{}" };
          const format = u.searchParams.get("format");
          const { pdfsParId: _ignore, ...propre } = msg;
          if (format === "metadata") {
            const voulus = u.searchParams.getAll("metadataHeaders").map((x) => x.toLowerCase());
            return rep({ id: msg.id, threadId: msg.threadId, internalDate: msg.internalDate, labelIds: msg.labelIds, payload: { headers: msg.payload.headers.filter((h) => voulus.includes(h.name.toLowerCase())) } });
          }
          if (format !== "full") throw new Error("format inattendu : " + format);
          return rep(propre);
        }
        m = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(chemin);
        if (m) {
          const msg = boite.find((x) => x.id === m[1]);
          const data = msg?.pdfsParId?.[m[2]];
          return data === undefined ? { getResponseCode: () => 404, getContentText: () => "{}" } : rep({ size: data.length, data });
        }
        throw new Error("appel Gmail inattendu : " + url);
      }
      if (url === urlCockpit) {
        if (methode !== "post") throw new Error("le cockpit ne reçoit que des POST");
        const rr = spawnSync("curl", ["-sS", "-m", "90", "-X", "POST", "-H", "content-type: application/json", "-H", `x-cockpit-key: ${params.headers?.["x-cockpit-key"] ?? ""}`, "--data-binary", "@-", "-w", "\n__CODE__%{http_code}", FONCTION], { input: params.payload, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
        const [corps, code] = rr.stdout.split("\n__CODE__");
        sortie.appelsCockpit.push({ corps: JSON.parse(params.payload), code: Number(code), reponse: corps });
        return { getResponseCode: () => Number(code), getContentText: () => corps };
      }
      throw new Error("adresse inattendue : " + url);
    };
    const declencheur = { fonction: null, etapes: [] };
    const baseTrigger = (nom) => {
      const t = { fonction: nom, etapes: [] };
      const b = { timeBased: () => { t.etapes.push("timeBased"); return b; }, everyWeeks: (n) => { if (everyWeeksRefuse) throw new Error("Google refuse everyWeeks (simulé)"); t.etapes.push(["everyWeeks", n]); return b; }, onWeekDay: (j) => { t.etapes.push(["onWeekDay", j]); return b; }, atHour: (h) => { t.etapes.push(["atHour", h]); return b; }, create: () => { sortie.declencheurs.push(t); return { getHandlerFunction: () => nom, _t: t }; } };
      return b;
    };
    void declencheur;
    const base64Octets = (s) => Array.from(Buffer.from(s, "base64url"), (o) => (o > 127 ? o - 256 : o));
    const env = {
      Logger: { log: (x) => sortie.logs.push(String(x)) },
      UrlFetchApp: { fetch },
      ScriptApp: {
        getOAuthToken: () => "jeton-oauth-factice", getProjectTriggers: () => sortie.declencheurs.map((t) => ({ getHandlerFunction: () => t.fonction, _t: t })),
        deleteTrigger: (t) => { const i = sortie.declencheurs.indexOf(t._t); if (i >= 0) sortie.declencheurs.splice(i, 1); sortie.supprimes.push(t._t.fonction); },
        newTrigger: baseTrigger, WeekDay: { SUNDAY: "SUNDAY", MONDAY: "MONDAY" },
      },
      Utilities: { base64DecodeWebSafe: base64Octets, newBlob: (octets) => ({ getDataAsString: () => Buffer.from(octets.map((o) => o & 0xff)).toString("utf8") }) },
    };
    const contexte = vm.createContext(env);
    const posee = cle ? programmeAvecCle(src, cle) : src;
    vm.runInContext(posee, contexte, { filename: "Code.gs" });
    return { sortie, run: (code) => vm.runInContext(code, contexte) };
  }

  const aD = await rpc("creer_cle_import", { p_service: S2 }, jeton);
  const K2 = aD.json;
  const prog = fabriqueContexte(source, { cle: K2 });
  const rowsAvant = depenses().length, objetsAvant2 = objets().length;
  prog.run("installer()");
  let lg = prog.sortie.logs.join("\n");
  verifie("installer() programme UN passage « passage », chaque semaine, le dimanche, vers 7 h", prog.sortie.declencheurs.length === 1 && prog.sortie.declencheurs[0].fonction === "passage"
    && JSON.stringify(prog.sortie.declencheurs[0].etapes) === JSON.stringify(["timeBased", ["everyWeeks", 1], ["onWeekDay", "SUNDAY"], ["atHour", 7]]), prog.sortie.declencheurs);
  const repli = fabriqueContexte(source, { cle: K2, everyWeeksRefuse: true });
  repli.run("programmer_()");
  verifie("si Google refuse la forme « toutes les semaines », la forme classique « le dimanche à 7 h » est programmée (un seul passage)", repli.sortie.declencheurs.length === 1 && JSON.stringify(repli.sortie.declencheurs[0].etapes) === JSON.stringify(["timeBased", ["onWeekDay", "SUNDAY"], ["atHour", 7]]), repli.sortie.declencheurs);
  const reqGmail = prog.sortie.requetes.filter((x) => x.url.startsWith("https://gmail.googleapis.com/"));
  const listeGmail = reqGmail.find((x) => new URL(x.url).pathname.endsWith("/messages"));
  const regle = await import("../supabase/functions/cockpit-recus/regle.ts");
  verifie("la recherche Gmail est celle de la règle : expéditeur exact, objet, un jour de marge (même chaîne que le lecteur Python et TypeScript)", decodeURIComponent(new URL(listeGmail.url).searchParams.get("q")) === regle.requeteGmail("2026-01-01"), listeGmail?.url);
  verifie("le programme ne fait que des GET vers Gmail, avec le jeton Google, et ne lui envoie jamais la clé du cockpit", reqGmail.length > 0 && reqGmail.every((x) => x.methode === "get" && x.entetes.Authorization === "Bearer jeton-oauth-factice" && !JSON.stringify(x).includes(K2)));
  const reqCockpit = prog.sortie.requetes.filter((x) => x.url === urlCockpit);
  verifie("le cockpit reçoit la clé dans un en-tête, jamais le jeton Google", reqCockpit.length > 0 && reqCockpit.every((x) => x.methode === "post" && x.entetes["x-cockpit-key"] === K2 && !JSON.stringify(x.entetes).includes("jeton-oauth-factice")));
  verifie("un mail dont l'ADRESSE n'est pas la bonne (nom d'affichage trompeur) est reconnu avant d'être lu : son contenu n'est jamais demandé à Gmail", !reqGmail.some((x) => /\/messages\/m3(\?|$|\/)/.test(x.url) && x.url.includes("format=full")) && reqGmail.some((x) => x.url.includes("/messages/m3?format=metadata")), reqGmail.map((x) => x.url));
  verifie("…ni envoyé au cockpit", !JSON.stringify(prog.sortie.appelsCockpit).includes("MARQUEUR-SECRET-M3") && !JSON.stringify(prog.sortie.appelsCockpit).includes("TESTRG0103"));
  verifie("seules les pièces « Invoice-….pdf » sont récupérées (jamais le PDF du reçu)", !reqGmail.some((x) => x.url.includes("att-m1-1")) && reqGmail.some((x) => x.url.includes("/attachments/att-m1-0")));
  const recus = prog.sortie.appelsCockpit.filter((x) => x.corps.action === "recu");
  verifie("quatre mails d'Anthropic envoyés (le cinquième, d'un autre expéditeur, non)", recus.length === 4, recus.map((x) => x.corps.texte.slice(0, 20)));
  verifie("chaque appel porte la version du programme", prog.sortie.appelsCockpit.every((x) => x.corps.version === 1));
  const apres = depenses();
  const ligneProg = (ref) => apres.find((x) => x.reference === ref);
  verifie("dans Coûts : les 3 reçus valides sont ajoutés (dont celui lu dans un mail HTML), le reçu faux ne l'est pas, celui du faux expéditeur non plus", apres.length === rowsAvant + 3 && !!ligneProg("TESTRG0101-0001") && !!ligneProg("TESTRG0102-0001") && !!ligneProg("TESTRG0105-0001") && !ligneProg("TESTRG0104-0001") && !ligneProg("TESTRG0103-0001"), apres.map((x) => x.reference));
  verifie("la facture du mail 1 a son PDF (rangé dans le stockage, c'est un vrai PDF) ; les autres n'en ont pas", ligneProg("TESTRG0101-0001")?.fichier?.nom === "Invoice-TESTRG0101-0001.pdf" && objets().length === objetsAvant2 + 1 && !ligneProg("TESTRG0102-0001").fichier && !ligneProg("TESTRG0105-0001").fichier
    && (await stockage("GET", ligneProg("TESTRG0101-0001").fichier.chemin)).debut.startsWith("%PDF"));
  sv = service(S2);
  verifie("la carte du prestataire dit : 3 factures ajoutées, les PDF à joindre à la main, 1 reçu non lu (en « echec », visible)", sv.st === "echec" && /^3 factures ajoutées : /.test(sv.note) && /PDF à joindre à la main : TESTRG0102-0001, TESTRG0105-0001/.test(sv.note) && /1 reçu non lu : mail du 2026-10-04 : la somme des lignes/.test(sv.note) && sv.cad === 7 && sv.recent === true, sv);
  verifie("le journal du programme est lisible et ne montre jamais la clé", lg.includes("Cockpit joint : projet « Test reçus Google », prestataire « Claude (programme) »") && lg.includes("Passage terminé : 3 factures ajoutées") && !lg.includes(K2) && !prog.sortie.logs.some((l) => l.includes("cki_")), lg);
  verifie("le mail refusé est dit en clair dans le journal", /mail du 2026-10-04 : REFUSÉ — la somme des lignes/.test(lg) && /mail du 2026-10-03 : pas un reçu d'Anthropic, ignoré/.test(lg), lg);

  prog.sortie.logs.length = 0;
  prog.run("installer()");
  verifie("installer() relancé ne double pas le passage du dimanche (l'ancien est supprimé, un seul reste)", prog.sortie.declencheurs.length === 1 && prog.sortie.supprimes.length === 1);
  verifie("…et rien n'est ajouté une 2e fois", depenses().length === rowsAvant + 3 && objets().length === objetsAvant2 + 1);
  prog.sortie.logs.length = 0; prog.sortie.appelsCockpit.length = 0;
  const atAvant = service(S2).at, rowsAvant2 = depenses().length;
  prog.run("essai()");
  lg = prog.sortie.logs.join("\n");
  verifie("essai() : tout est dit « déjà dans Coûts », RIEN n'est écrit (ni ligne, ni fichier, ni carte)", depenses().length === rowsAvant2 && service(S2).at === atAvant && /Essai terminé \(rien n'a été écrit dans Coûts\)/.test(lg) && prog.sortie.appelsCockpit.filter((x) => x.corps.action === "recu").every((x) => x.corps.essai === true), lg);
  const contact = cleDb(sql(`select id from cles_import where service_id = ${q(S2)} and revoquee_at is null`)[0].id);
  verifie("le cockpit sait que le programme est venu (date du dernier contact, version 1) : l'app le montre", contact.der !== null && contact.v === 1 && contact.utilisations >= 3, contact);

  // -- un PDF qui arrive plus tard sur une ligne déjà là
  M.m2.payload.parts.push({ partId: "9", mimeType: "application/pdf", filename: "Invoice-TESTRG0102-0001.pdf", body: { attachmentId: "att-m2-late", size: 120 } });
  M.m2.pdfsParId = { "att-m2-late": pdf("tard").toString("base64url") };
  prog.sortie.logs.length = 0;
  prog.run("passage()");
  lg = prog.sortie.logs.join("\n");
  verifie("passage() : le PDF d'un mail qui l'a gagné plus tard est joint à la ligne déjà présente", ligneProg !== null && depenses().find((x) => x.reference === "TESTRG0102-0001")?.fichier?.nom === "Invoice-TESTRG0102-0001.pdf" && /PDF joint à 1 facture déjà présente : TESTRG0102-0001/.test(service(S2).note), service(S2).note);

  // -- un PDF trop gros n'est même pas téléchargé
  M.m5.payload.parts.push({ partId: "8", mimeType: "application/pdf", filename: "Invoice-TESTRG0105-0001.pdf", body: { attachmentId: "att-gros", size: 6 * 1024 * 1024 } });
  M.m5.pdfsParId = { "att-gros": "AAAA" };
  prog.sortie.requetes.length = 0;
  prog.run("passage()");
  verifie("un PDF de plus de 5 Mo n'est même pas téléchargé : la ligne reste sans fichier (elle ne perd rien, rien n'est déposé)", !prog.sortie.requetes.some((x) => x.url.includes("att-gros")) && depenses().find((x) => x.reference === "TESTRG0105-0001")?.fichier === null, prog.sortie.requetes.map((x) => x.url));

  // -- les pannes
  const panne = fabriqueContexte(source, { cle: K2, gmailHs: 403 });
  let erreurPanne = null;
  try { panne.run("passage()"); } catch (e) { erreurPanne = String(e.message); }
  sv = service(S2);
  verifie("Gmail refuse (autorisation manquante) : le programme le dit à la carte du prestataire (« echec » avec la raison et quoi faire) et l'exécution apparaît en échec chez Google", sv.st === "echec" && /Le passage n'a pas pu avoir lieu : Gmail a répondu 403 — relance installer\(\) et accepte la lecture de tes mails/.test(sv.note) && /Gmail a répondu 403/.test(erreurPanne ?? ""), { sv, erreurPanne });
  verifie("…sans avoir rien écrit dans Coûts", depenses().length === rowsAvant + 3);
  await rpc("revoquer_cle_import", { p_cle: sql(`select id from cles_import where service_id = ${q(S2)} and revoquee_at is null`)[0].id }, jeton);
  const revoque = fabriqueContexte(source, { cle: K2 });
  let erreurRevoque = null;
  try { revoque.run("passage()"); } catch (e) { erreurRevoque = String(e.message); }
  verifie("clé révoquée : le programme s'arrête avec le message du cockpit (« remplacée ou révoquée… »), rien n'est lu dans Gmail", /remplacée ou révoquée/.test(erreurRevoque ?? "") && !revoque.sortie.requetes.some((x) => x.url.startsWith("https://gmail.googleapis.com/")), { erreurRevoque });
  verifie("…et après révocation il ne reste aucune clé active pour ce prestataire", sql(`select count(*)::int n from cles_import where service_id = ${q(S2)} and revoquee_at is null`)[0].n === 0);

  console.log("5. Nettoyage");
} finally {
  try {
    const fichiers = sql(`select fichier->>'chemin' c from depenses where projet_id = ${q(P)} and fichier is not null`);
    for (const f of fichiers) await stockage("DELETE", f.c);
    await purgerProjetsDeTest(async (x) => sql(x), [P], PREFIXE);
    const restes = sql(`select (select count(*) from depenses where projet_id = ${q(P)})::int d, (select count(*) from services where projet_id = ${q(P)})::int s, (select count(*) from cles_import where projet_id = ${q(P)})::int c, (select count(*) from projets where id = ${q(P)})::int p`)[0];
    verifie("aucun reste : ni ligne, ni prestataire, ni clé, ni projet de test", restes.d === 0 && restes.s === 0 && restes.c === 0 && restes.p === 0, restes);
    const noms = fichiers.map((f) => q(f.c)).join(", ");
    const gardes = noms ? sql(`select count(*)::int n from storage.objects where bucket_id = 'cockpit-medias' and name in (${noms})`)[0].n : 0;
    verifie("aucun reste : les fichiers déposés sont supprimés du stockage", fichiers.length > 0 && gardes === 0, `${fichiers.length} déposé(s), ${gardes} encore présent(s)`);
    if (purges) console.log(`  (purge de ${purges} projet(s) de test d'une passe précédente)`);
  } catch (x) { console.log("  (nettoyage : " + x.message + ")"); }
  arreter();
}
console.log(`\n${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
