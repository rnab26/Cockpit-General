#!/usr/bin/env node
// Non-régression de la BASE du cockpit (schéma `cockpit`), sur la VRAIE base.
//
// À RELANCER après toute modification de :
//   - supabase/migrations/0001_cockpit_base.sql   (tables, triggers, fonctions, RLS, temps réel)
//   - supabase/migrations/0002_exec_sql_cockpit.sql (cockpit.exec_sql, search_path, droits)
//   - supabase/migrations/0003_membres_par_email.sql (ajouter_membre, membres_du_projet, moi)
//   - toute nouvelle migration supabase/migrations/000N_*.sql
//   - scripts/sql.sh (le chemin « session » vers exec_sql)
//   - le réglage PostgREST du projet (schémas exposés, `db_schema`)
//   - la publication `supabase_realtime` (tables du schéma cockpit)
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verifier-base.mjs
//
// Ce que ça prouve, avec des données CRÉÉES PUIS SUPPRIMÉES (projets
// `test-verif-<aléatoire>`, compte `test-verif-<aléatoire>@cockpit.local`) :
//   1. réservation atomique (deux sessions en même temps, une seule gagne)
//   2. trigger historique (chaque champ tracé, rien sur un update sans effet)
//   3. trigger suppression (la trace survit au chantier)
//   4. certifier_chantier   5. corriger_chantier   6. repondre_message
//   7. fusionner_chantiers  8. signaler_activite   9. marquer_vu (ne recule jamais)
//   10. RLS vue par un utilisateur MEMBRE (chemin navigateur, PostgREST + JWT)
//   11. RLS vue par un utilisateur NON membre
//   12. temps réel (WebSocket Phoenix, postgres_changes sur cockpit.chantiers)
//   13. exec_sql : le search_path est porté par la fonction (profil cockpit)
//   …
//   18. réponses de Raphaël reprises par la chef (0017), projets de test jamais servis
//   19. un chef PAR PROJET (0019) : la passe d'un projet ne sert jamais un autre projet
//
// Deux chemins, exprès : « session » (exec_sql en service_role, comme
// scripts/sql.sh) et « navigateur » (PostgREST avec la clé publique et un
// JWT utilisateur, comme l'app). Seul le second prouve la RLS.
//
// Node 22, aucune dépendance npm : fetch et WebSocket natifs.
// Rien n'est modifié hors des projets `test-verif-*` et du compte de test ;
// les projets réels (`cockpit`, `facepro`, …) ne sont jamais touchés.
// Le nettoyage tourne dans un `finally`, même si un contrôle plante.

import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL_ = process.env.SUPABASE_URL ?? "https://bexiyvmdbxcwxasgslxp.supabase.co";
const CLE_PUBLIQUE = "sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U";
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!CLE_SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY absente de l'environnement : signale-le à Raphaël.");
  process.exit(2);
}

// ------------------------------------------------------------- harnais
let total = 0, echecs = 0;
function verifie(nom, condition, detail) {
  total++;
  if (condition) { console.log(`  ✓ ${nom}`); return true; }
  echecs++;
  console.log(`  ✗ ${nom}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  return false;
}
function section(titre) { console.log(`\n${titre}`); }
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`;
const contient = (texte, morceau) => typeof texte === "string" && texte.includes(morceau);

// ------------------------------------------------ chemin « session » : exec_sql
async function execSql(query, { profil = "cockpit" } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: CLE_SERVICE,
    Authorization: `Bearer ${CLE_SERVICE}`,
  };
  if (profil) headers["Content-Profile"] = profil;
  const r = await fetch(`${URL_}/rest/v1/rpc/exec_sql`, { method: "POST", headers, body: JSON.stringify({ query }) });
  const texte = await r.text();
  let json;
  try { json = JSON.parse(texte); } catch { json = { ok: false, error: `HTTP ${r.status} : ${texte.slice(0, 300)}` }; }
  if (json && typeof json === "object" && "ok" in json) return json;
  return { ok: false, error: `réponse inattendue (HTTP ${r.status}) : ${texte.slice(0, 300)}` };
}
// Lignes attendues : lève si la base refuse.
async function sql(query) {
  const r = await execSql(query);
  if (!r.ok) throw new Error(`SQL refusé : ${r.error}\n  ${query.slice(0, 200)}`);
  return r.rows ?? [];
}
async function une(query) { return (await sql(query))[0] ?? null; }
// L'erreur (message français) qu'une requête renvoie, ou null si elle passe.
async function erreurDe(query) {
  const r = await execSql(query);
  return r.ok ? null : r.error;
}

// ------------------------------------------- chemin « navigateur » : PostgREST
async function rest(chemin, { methode = "GET", jwt, corps, prefer } = {}) {
  const headers = {
    apikey: CLE_PUBLIQUE,
    Authorization: `Bearer ${jwt}`,
    "Accept-Profile": "cockpit",
    "Content-Profile": "cockpit",
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL_}/rest/v1/${chemin}`, { method: methode, headers, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const texte = await r.text();
  let json = null;
  if (texte) { try { json = JSON.parse(texte); } catch { json = texte; } }
  return { status: r.status, json };
}
const rpcUtilisateur = (fn, args, jwt) => rest(`rpc/${fn}`, { methode: "POST", jwt, corps: args });

// ---------------------------------------------------------------- auth
async function authAdmin(chemin, methode = "GET", corps) {
  const r = await fetch(`${URL_}/auth/v1/${chemin}`, {
    method: methode,
    headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}`, "Content-Type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  return { status: r.status, json: texte ? JSON.parse(texte) : null };
}
async function creerCompte(email, motDePasse) {
  const r = await authAdmin("admin/users", "POST", { email, password: motDePasse, email_confirm: true });
  if (r.status >= 300 || !r.json?.id) throw new Error(`création du compte de test refusée (HTTP ${r.status}) : ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json.id;
}
async function connecter(email, motDePasse) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: CLE_PUBLIQUE, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: motDePasse }),
  });
  const json = await r.json();
  if (!json.access_token) throw new Error(`connexion du compte de test refusée (HTTP ${r.status}) : ${JSON.stringify(json).slice(0, 200)}`);
  return json.access_token;
}
async function supprimerCompte(id) {
  const r = await authAdmin(`admin/users/${id}`, "DELETE");
  return r.status < 300;
}

// ------------------------------------------------------------ nettoyage
// Ne supprime QUE des projets dont le slug commence par test-verif- (vérifié
// en base avant chaque delete) et les traces hors cascade qui en dépendent.
async function purgerProjetsDeTest(ids) {
  if (!ids.length) return;
  const liste = ids.map(q).join(",");
  const reels = await sql(`select id, slug from projets where id in (${liste}) and slug not like 'test-verif-%'`);
  if (reels.length) throw new Error(`REFUS : un id à purger n'est pas un projet de test : ${JSON.stringify(reels)}`);
  // La cascade emporte chantiers (→ trigger → supprimes), messages, activite,
  // membres, visites, ce_qui_marche. historique et supprimes n'ont pas de FK :
  // on les purge à la main, par les ids de chantiers passés dans supprimes.
  await sql(`delete from projets where id in (${liste}) and slug like 'test-verif-%'`);
  await sql(`delete from historique where chantier_id in (select chantier_id from supprimes where projet_id in (${liste}))`);
  await sql(`delete from supprimes where projet_id in (${liste})`);
}
async function purgerRestesDePassesPrecedentes() {
  const vieux = await sql(`select id, slug from projets where slug like 'test-verif-%'`);
  if (vieux.length) {
    console.log(`  (purge de ${vieux.length} projet(s) de test laissé(s) par une passe précédente : ${vieux.map((p) => p.slug).join(", ")})`);
    await purgerProjetsDeTest(vieux.map((p) => p.id));
  }
  const r = await authAdmin("admin/users?per_page=100&filter=test-verif-");
  const comptes = (r.json?.users ?? []).filter((u) => /^test-verif-[a-z0-9]+@cockpit\.local$/.test(u.email ?? ""));
  for (const u of comptes) {
    console.log(`  (purge du compte de test orphelin ${u.email})`);
    await supprimerCompte(u.id);
  }
}

// ------------------------------------------------------------- contrôles
const rand = randomUUID().slice(0, 8);
const SLUG_A = `test-verif-${rand}`;
const SLUG_B = `test-verif-${rand}-b`;
const EMAIL = `test-verif-${rand}@cockpit.local`;
const MOT_DE_PASSE = randomBytes(18).toString("base64url"); // jamais affiché
const P1 = randomUUID(), P2 = randomUUID();
let userId = null, jwt = null, ws = null;

async function creerChantier(projet, { titre = "Chantier de test", etat = "libre", visible = true, demande = null, origine = "proprietaire" } = {}) {
  const id = randomUUID();
  await sql(`insert into chantiers (id, projet_id, titre, etat, visible_utilisateurs, demande, origine)
             values (${q(id)}, ${q(projet)}, ${q(titre)}, ${q(etat)}, ${visible}, ${q(demande)}, ${q(origine)})`);
  return id;
}
async function creerMessage(projet, chantier, { kind = "info", corps = "message de test", options = null, auteur_type = "session" } = {}) {
  const id = randomUUID();
  await sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, options)
             values (${q(id)}, ${q(projet)}, ${q(chantier)}, 'verifier-base', ${q(auteur_type)}, ${q(kind)}, ${q(corps)}, ${options ? q(JSON.stringify(options)) + "::jsonb" : "null"})`);
  return id;
}
const chantier = (id) => une(`select * from chantiers where id = ${q(id)}`);
const reserver = (id, par, minutes = 30) => execSql(`select reserver_chantier(${q(id)}, ${q(par)}, ${minutes}) as ok`);
const valeur = (r, cle = "ok") => r.ok && r.rows?.[0]?.[cle];

async function controle1_reservation() {
  section("1. reserver_chantier / liberer_chantier — réservation atomique");
  const c = await creerChantier(P1, { titre: "Réservation", etat: "libre" });
  const [a, b] = await Promise.all([reserver(c, "session-a"), reserver(c, "session-b")]);
  const gagnants = [["session-a", valeur(a)], ["session-b", valeur(b)]].filter(([, ok]) => ok === true);
  verifie("deux réservations concurrentes : exactement une obtient true", gagnants.length === 1, { a: a.rows ?? a.error, b: b.rows ?? b.error });
  const gagnant = gagnants[0]?.[0] ?? "session-a";
  const perdant = gagnant === "session-a" ? "session-b" : "session-a";
  let l = await chantier(c);
  verifie("le chantier porte le gagnant et passe en_cours", l.pris_par === gagnant && l.etat === "en_cours" && l.pris_jusqu_a !== null, { pris_par: l.pris_par, etat: l.etat });
  verifie("le perdant ne l'obtient toujours pas tant que la réservation court", valeur(await reserver(c, perdant)) === false);
  verifie("le même appelant peut re-réserver (true)", valeur(await reserver(c, gagnant)) === true);
  await sql(`update chantiers set pris_jusqu_a = now() - interval '1 minute' where id = ${q(c)}`);
  verifie("réservation expirée : une autre session obtient true", valeur(await reserver(c, perdant)) === true);
  l = await chantier(c);
  verifie("…et le chantier porte désormais cette session", l.pris_par === perdant, l.pris_par);
  verifie("liberer_chantier par la mauvaise session → false", valeur(await execSql(`select liberer_chantier(${q(c)}, ${q(gagnant)}) as ok`)) === false);
  l = await chantier(c);
  verifie("…et rien n'a bougé", l.pris_par === perdant && l.etat === "en_cours");
  verifie("liberer_chantier par la bonne session → true", valeur(await execSql(`select liberer_chantier(${q(c)}, ${q(perdant)}) as ok`)) === true);
  l = await chantier(c);
  verifie("…etat repasse libre, réservation effacée", l.etat === "libre" && l.pris_par === null && l.pris_jusqu_a === null, { etat: l.etat, pris_par: l.pris_par });
  const t = await creerChantier(P1, { titre: "À trier réservé", etat: "a_trier" });
  await reserver(t, "session-a");
  verifie("un chantier a_trier réservé passe en_cours", (await chantier(t)).etat === "en_cours");
  const v = await creerChantier(P1, { titre: "À vérifier réservé", etat: "a_verifier" });
  verifie("réserver un chantier a_verifier : true, mais l'état ne bouge pas", valeur(await reserver(v, "session-a")) === true && (await chantier(v)).etat === "a_verifier");
  const arch = await creerChantier(P1, { titre: "Archivé", etat: "libre" });
  await sql(`update chantiers set archived_at = now() where id = ${q(arch)}`);
  verifie("un chantier archivé ne se réserve pas (false)", valeur(await reserver(arch, "session-a")) === false);
}

async function controle2_historique() {
  section("2. trigger historique — chaque changement tracé, rien d'inutile");
  const c = await creerChantier(P1, { titre: "Titre A", demande: "Demande A" });
  await attendre(50);
  await sql(`update chantiers set titre = 'Titre B' where id = ${q(c)}`);
  await sql(`update chantiers set demande = 'Demande B' where id = ${q(c)}`);
  let h = await sql(`select champ, ancienne, nouvelle, par from historique where chantier_id = ${q(c)} order by id`);
  verifie("deux updates (titre, demande) → deux lignes d'historique", h.length === 2, h);
  verifie("titre : ancienne/nouvelle justes", h[0]?.champ === "titre" && h[0]?.ancienne === "Titre A" && h[0]?.nouvelle === "Titre B", h[0]);
  verifie("demande : ancienne/nouvelle justes", h[1]?.champ === "demande" && h[1]?.ancienne === "Demande A" && h[1]?.nouvelle === "Demande B", h[1]);
  // Sans set_config, le trigger promet « inconnu ». Sur une connexion du pool
  // PostgREST qui a déjà servi certifier/corriger/fusionner (set_config local
  // à la transaction), current_setting(…, true) rend '' et non NULL : le
  // coalesce ne l'attrape pas → par = ''. Intermittent par nature (dépend de
  // la connexion servie) ; rouge = défaut du trigger, décrit dans le rapport.
  verifie("la colonne « par » vaut « inconnu » sans set_config (jamais une chaîne vide)", h.every((x) => x.par === "inconnu"), { par: h.map((x) => JSON.stringify(x.par)) });
  await sql(`update chantiers set titre = 'Titre B', demande = 'Demande B' where id = ${q(c)}`);
  h = await sql(`select count(*)::int as n from historique where chantier_id = ${q(c)}`);
  verifie("un update qui ne change rien n'écrit rien", h[0].n === 2, h[0]);
  let l = await chantier(c);
  verifie("updated_at a bougé (postérieur à created_at)", new Date(l.updated_at) > new Date(l.created_at), { created_at: l.created_at, updated_at: l.updated_at });
  verifie("livre_at encore nul avant « à vérifier »", l.livre_at === null);
  await sql(`update chantiers set etat = 'a_verifier' where id = ${q(c)}`);
  l = await chantier(c);
  verifie("passage à a_verifier pose livre_at", l.livre_at !== null, l.livre_at);
  const e = await une(`select ancienne, nouvelle from historique where chantier_id = ${q(c)} and champ = 'etat'`);
  verifie("…et l'historique trace le changement d'état", e?.ancienne === "libre" && e?.nouvelle === "a_verifier", e);
  const livre = l.livre_at;
  await sql(`update chantiers set notes = 'encore' where id = ${q(c)}`);
  verifie("un autre update ne redate pas livre_at", (await chantier(c)).livre_at === livre);
}

async function controle3_suppression() {
  section("3. trigger suppression — la trace survit au chantier");
  const c = await creerChantier(P1, { titre: "À supprimer", demande: "on l'efface" });
  await sql(`delete from chantiers where id = ${q(c)}`);
  const parti = await une(`select count(*)::int as n from chantiers where id = ${q(c)}`);
  verifie("le chantier a disparu", parti.n === 0);
  const s = await sql(`select chantier_id, projet_id, ligne, par from supprimes where chantier_id = ${q(c)}`);
  verifie("une ligne dans supprimes", s.length === 1, s.length);
  verifie("…avec la ligne complète en jsonb (id, titre, demande, projet)", s[0]?.ligne?.id === c && s[0]?.ligne?.titre === "À supprimer" && s[0]?.ligne?.demande === "on l'efface" && s[0]?.projet_id === P1, s[0]?.ligne);
}

async function controle4_certifier() {
  section("4. certifier_chantier — seul un chantier « à vérifier » se certifie");
  const c = await creerChantier(P1, { titre: "À certifier", etat: "libre" });
  const err = await erreurDe(`select certifier_chantier(${q(c)}, 'raphael')`);
  verifie("refusé sur un chantier libre, message lisible", contient(err, "n'est pas « à vérifier »"), err);
  await sql(`update chantiers set etat = 'a_verifier', pris_par = 'session-z', pris_jusqu_a = now() + interval '1 hour' where id = ${q(c)}`);
  const r = await execSql(`select certifier_chantier(${q(c)}, 'raphael')`);
  verifie("accepté sur a_verifier", r.ok, r.error);
  const l = await chantier(c);
  verifie("etat valide, valide_at, valide_par, archived_at posés, réservation levée",
    l.etat === "valide" && l.valide_at !== null && l.valide_par === "raphael" && l.archived_at !== null && l.pris_par === null,
    { etat: l.etat, valide_at: l.valide_at, valide_par: l.valide_par, archived_at: l.archived_at, pris_par: l.pris_par });
  const m = await sql(`select corps, auteur, auteur_type from messages where chantier_id = ${q(c)} and kind = 'constat'`);
  // Appel en service_role = en pratique la fonction serveur du module embarqué,
  // donc un utilisateur final ; l'admin connecté dans l'app signe « proprietaire »
  // (migration 0004). Une session ne certifie jamais.
  verifie("un message constat créé (texte par défaut)", m.length === 1 && m[0].corps === "Ça fonctionne, je certifie." && m[0].auteur === "raphael" && m[0].auteur_type === "utilisateur", m);
  const w = await sql(`select texte, par from ce_qui_marche where chantier_id = ${q(c)}`);
  verifie("une ligne ce_qui_marche (le titre)", w.length === 1 && w[0].texte === "À certifier" && w[0].par === "raphael", w);
  verifie("re-certifier un chantier déjà validé est refusé", contient(await erreurDe(`select certifier_chantier(${q(c)}, 'raphael')`), "n'est pas « à vérifier »"));
  const c2 = await creerChantier(P1, { titre: "Certifié avec mots", etat: "a_verifier" });
  await sql(`select certifier_chantier(${q(c2)}, 'raphael', 'Testé sur le téléphone')`);
  const m2 = await une(`select corps from messages where chantier_id = ${q(c2)} and kind = 'constat'`);
  const w2 = await une(`select texte from ce_qui_marche where chantier_id = ${q(c2)}`);
  verifie("avec des mots : le constat les porte, ce_qui_marche = « titre — mots »", m2?.corps === "Testé sur le téléphone" && w2?.texte === "Certifié avec mots — Testé sur le téléphone", { m2, w2 });
  return c;
}

async function controle5_corriger(certifie) {
  section("5. corriger_chantier — la demande grossit sur la même ligne, le chantier revient");
  const err = await erreurDe(`select corriger_chantier(${q(certifie)}, 'raphael', '   ')`);
  verifie("refusé sans mots (message lisible)", contient(err, "dis ce qui ne marche pas"), err);
  const avant = await chantier(certifie);
  const r = await execSql(`select corriger_chantier(${q(certifie)}, 'raphael', 'Le bouton ne répond pas')`);
  verifie("accepté sur un chantier valide avec des mots", r.ok, r.error);
  let l = await chantier(certifie);
  verifie("etat libre (aucune réservation en cours)", l.etat === "libre", l.etat);
  verifie("demande complétée : « Correction du » + les mots, l'ancienne demande conservée",
    contient(l.demande, "Correction du") && contient(l.demande, "Le bouton ne répond pas") && (avant.demande == null || contient(l.demande, avant.demande)), l.demande);
  verifie("archived_at, valide_at, valide_par remis à nul", l.archived_at === null && l.valide_at === null && l.valide_par === null, { archived_at: l.archived_at, valide_at: l.valide_at });
  const m = await une(`select corps from messages where chantier_id = ${q(certifie)} and kind = 'constat' and corps like 'Ça ne marche pas%'`);
  verifie("message constat « Ça ne marche pas : … »", m?.corps === "Ça ne marche pas : Le bouton ne répond pas", m);
  verifie("refusé sur un chantier libre (ni à vérifier ni validé)", contient(await erreurDe(`select corriger_chantier(${q(certifie)}, 'raphael', 'encore')`), "ni « à vérifier » ni « validé »"));
  // Le cas « une session le tient encore » : à vérifier + réservation valide.
  const c = await creerChantier(P1, { titre: "Livré, session dessus", etat: "a_verifier", demande: "demande initiale" });
  await reserver(c, "session-x", 60);
  await sql(`select corriger_chantier(${q(c)}, 'raphael', 'La couleur est fausse')`);
  l = await chantier(c);
  verifie("sur a_verifier avec une réservation valide → en_cours, la session le garde", l.etat === "en_cours" && l.pris_par === "session-x", { etat: l.etat, pris_par: l.pris_par });
  verifie("…demande complétée aussi", contient(l.demande, "demande initiale") && contient(l.demande, "La couleur est fausse"), l.demande);
  const h = await une(`select count(*)::int as n from historique where chantier_id = ${q(c)} and champ = 'etat' and par = 'raphael'`);
  verifie("l'historique porte « raphael » comme auteur (set_config dans la fonction)", h?.n === 1, h);
}

async function controle6_repondre() {
  section("6. repondre_message — questions et actions");
  const c = await creerChantier(P1, { titre: "Avec des questions" });
  const m1 = await creerMessage(P1, c, { kind: "question", corps: "Quelle option ?", options: [{ libelle: "Option A", recommande: true }, { libelle: "Option B" }] });
  await sql(`select repondre_message(${q(m1)}, 'raphael', 'Option A', 'plutôt A, mais pas trop vite')`);
  let m = await une(`select reponse, precision, answered_at, etat from messages where id = ${q(m1)}`);
  verifie("question : reponse + precision + answered_at", m.reponse === "Option A" && m.precision === "plutôt A, mais pas trop vite" && m.answered_at !== null, m);
  const m2 = await creerMessage(P1, c, { kind: "action", corps: "Dépose la clé" });
  await sql(`select repondre_message(${q(m2)}, 'raphael', 'Pas encore', null, 'pas_encore')`);
  m = await une(`select reponse, answered_at, etat from messages where id = ${q(m2)}`);
  verifie("action « pas_encore » : etat posé, answered_at reste nul", m.etat === "pas_encore" && m.answered_at === null && m.reponse === "Pas encore", m);
  await sql(`select repondre_message(${q(m2)}, 'raphael', 'Fait', 'clé déposée', 'fait')`);
  m = await une(`select reponse, precision, answered_at, etat from messages where id = ${q(m2)}`);
  verifie("action « fait » : answered_at posé", m.etat === "fait" && m.answered_at !== null && m.precision === "clé déposée", m);
  const m3 = await creerMessage(P1, c, { kind: "info", corps: "juste une info" });
  const err = await erreurDe(`select repondre_message(${q(m3)}, 'raphael', 'x')`);
  verifie("sur un message info → exception lisible", contient(err, "message introuvable ou pas une question"), err);
  verifie("sur un id inexistant → même exception", contient(await erreurDe(`select repondre_message(${q(randomUUID())}, 'raphael', 'x')`), "message introuvable ou pas une question"));
}

async function controle7_fusionner() {
  section("7. fusionner_chantiers — le doublon garde sa trace");
  const src = await creerChantier(P1, { titre: "Doublon X", demande: "demande du doublon" });
  const cible = await creerChantier(P1, { titre: "Original", demande: "demande originale" });
  const msg = await creerMessage(P1, src, { corps: "message du doublon" });
  const err = await erreurDe(`select fusionner_chantiers(${q(src)}, ${q(src)}, 'raphael')`);
  verifie("même id → exception « même chantier »", contient(err, "même chantier"), err);
  const r = await execSql(`select fusionner_chantiers(${q(src)}, ${q(cible)}, 'raphael', 'même sujet')`);
  verifie("fusion acceptée", r.ok, r.error);
  const m = await une(`select chantier_id from messages where id = ${q(msg)}`);
  verifie("le message du doublon a rejoint la cible", m?.chantier_id === cible, m);
  const s = await chantier(src);
  verifie("source archivée, doublon_de = cible, réservation effacée", s.archived_at !== null && s.doublon_de === cible && s.pris_par === null, { archived_at: s.archived_at, doublon_de: s.doublon_de });
  const t = await chantier(cible);
  verifie("demande de la cible complétée (titre du doublon, sa demande, la note)",
    contient(t.demande, "demande originale") && contient(t.demande, "Fusion du doublon « Doublon X »") && contient(t.demande, "demande du doublon") && contient(t.demande, "Note : même sujet"), t.demande);
  const info = await une(`select corps, kind from messages where chantier_id = ${q(cible)} and kind = 'info' and corps like 'Doublon fusionné%'`);
  verifie("message info « Doublon fusionné : « Doublon X » — même sujet »", info?.corps === "Doublon fusionné : « Doublon X » — même sujet", info);
}

async function controle8_activite() {
  section("8. signaler_activite — une ligne par (chantier, session)");
  const c = await creerChantier(P1, { titre: "En progression", etat: "en_cours" });
  const r1 = await execSql(`select pourcentage, eta_secondes, etape, statut from signaler_activite(${q(SLUG_A)}, ${q(c)}, 'session-p', 'étape 1', 10, 60)`);
  verifie("premier appel : ligne renvoyée (10 %, eta 60 s)", r1.ok && r1.rows?.[0]?.pourcentage === 10 && r1.rows?.[0]?.eta_secondes === 60 && r1.rows?.[0]?.etape === "étape 1", r1.rows ?? r1.error);
  await sql(`select signaler_activite(${q(SLUG_A)}, ${q(c)}, 'session-p', 'étape 2', 40)`);
  let a = await sql(`select pourcentage, eta_secondes, etape, statut, detail, demarre_at, updated_at from activite where chantier_id = ${q(c)} and session = 'session-p'`);
  verifie("second appel : toujours UNE ligne", a.length === 1, a.length);
  verifie("pourcentage mis à jour, eta null quand omis, étape remplacée", a[0]?.pourcentage === 40 && a[0]?.eta_secondes === null && a[0]?.etape === "étape 2", a[0]);
  verifie("updated_at a avancé, demarre_at non", new Date(a[0].updated_at) > new Date(a[0].demarre_at), a[0]);
  await sql(`select signaler_activite(${q(SLUG_A)}, ${q(c)}, 'session-p', 'étape 3', null, null, 'termine', 'fini')`);
  a = await une(`select pourcentage, statut, detail from activite where chantier_id = ${q(c)} and session = 'session-p'`);
  verifie("pourcentage omis : la valeur précédente est gardée ; statut et détail passent", a.pourcentage === 40 && a.statut === "termine" && a.detail === "fini", a);
  await sql(`select signaler_activite(${q(SLUG_A)}, ${q(c)}, 'session-q', 'autre session', 5)`);
  const n = await une(`select count(*)::int as n from activite where chantier_id = ${q(c)}`);
  verifie("une autre session sur le même chantier = une seconde ligne", n.n === 2, n);
  const err = await erreurDe(`select signaler_activite('projet-qui-nexiste-pas', ${q(c)}, 'session-p', 'x')`);
  verifie("projet inconnu → exception « projet inconnu : … »", contient(err, "projet inconnu : projet-qui-nexiste-pas"), err);
}

async function controle9_marquer_vu() {
  section("9. marquer_vu (chemin navigateur, RPC) — ne recule jamais");
  const r1 = await rpcUtilisateur("marquer_vu", { p_projet: P1 }, jwt);
  verifie("premier appel : un horodatage renvoyé", r1.status === 200 && typeof r1.json === "string", r1);
  const v = await une(`select vu_at from visites where user_id = ${q(userId)} and projet_id = ${q(P1)}`);
  verifie("la visite est bien celle de l'utilisateur (auth.uid())", v !== null && Math.abs(new Date(v.vu_at) - new Date(r1.json)) < 1000, { base: v?.vu_at, rpc: r1.json });
  await sql(`update visites set vu_at = now() + interval '1 day' where user_id = ${q(userId)} and projet_id = ${q(P1)}`);
  const futur = (await une(`select vu_at from visites where user_id = ${q(userId)} and projet_id = ${q(P1)}`)).vu_at;
  const r2 = await rpcUtilisateur("marquer_vu", { p_projet: P1 }, jwt);
  const apres = (await une(`select vu_at from visites where user_id = ${q(userId)} and projet_id = ${q(P1)}`)).vu_at;
  verifie("un vu_at déjà dans le futur n'est pas écrasé par un nouvel appel", new Date(apres).getTime() === new Date(futur).getTime(), { futur, apres });
  verifie("…et la fonction renvoie la valeur gardée, pas now()", r2.status === 200 && new Date(r2.json).getTime() === new Date(futur).getTime(), { renvoye: r2.json, futur });
}

async function controle10_rls_membre() {
  section("10. RLS, chemin navigateur, utilisateur MEMBRE du projet A");
  const visible = await creerChantier(P1, { titre: "Visible aux utilisateurs" });
  const cache = await creerChantier(P1, { titre: "Interne", visible: false });
  const autre = await creerChantier(P2, { titre: "Du projet B" });
  const liste = await rest(`chantiers?select=id,titre,projet_id&order=created_at`, { jwt });
  const ids = Array.isArray(liste.json) ? liste.json.map((c) => c.id) : [];
  verifie("liste des chantiers : HTTP 200", liste.status === 200, liste);
  verifie("voit le chantier visible de SON projet", ids.includes(visible));
  verifie("ne voit pas un chantier visible_utilisateurs=false", !ids.includes(cache));
  verifie("ne voit pas un chantier d'un autre projet", !ids.includes(autre));
  verifie("tout ce qu'il voit est du projet A", Array.isArray(liste.json) && liste.json.every((c) => c.projet_id === P1), liste.json?.filter?.((c) => c.projet_id !== P1));
  const titreOk = `Demande utilisateur ${rand}`;
  const ins = await rest("chantiers", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P1, titre: titreOk, origine: "utilisateur", etat: "a_trier", created_by: userId } });
  verifie("peut insérer un chantier origine=utilisateur, etat=a_trier (201, ligne renvoyée)", ins.status === 201 && ins.json?.[0]?.titre === titreOk, ins);
  const titreSession = `Pirate session ${rand}`;
  const insSession = await rest("chantiers", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P1, titre: titreSession, origine: "session", etat: "a_trier" } });
  const nSession = (await une(`select count(*)::int as n from chantiers where titre = ${q(titreSession)}`)).n;
  verifie("ne peut PAS insérer origine=session (refus RLS 42501, rien en base)", insSession.status >= 400 && insSession.json?.code === "42501" && nSession === 0, { status: insSession.status, json: insSession.json, enBase: nSession });
  const titreLibre = `Pirate libre ${rand}`;
  const insLibre = await rest("chantiers", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P1, titre: titreLibre, origine: "utilisateur", etat: "libre" } });
  const nLibre = (await une(`select count(*)::int as n from chantiers where titre = ${q(titreLibre)}`)).n;
  verifie("ne peut PAS insérer etat=libre (refus RLS, rien en base)", insLibre.status >= 400 && insLibre.json?.code === "42501" && nLibre === 0, { status: insLibre.status, json: insLibre.json, enBase: nLibre });
  const insB = await rest("chantiers", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P2, titre: `Pirate projet B ${rand}`, origine: "utilisateur", etat: "a_trier" } });
  verifie("ne peut PAS insérer dans un projet dont il n'est pas membre", insB.status >= 400 && insB.json?.code === "42501", insB);
  const upd = await rest(`chantiers?id=eq.${visible}`, { methode: "PATCH", jwt, prefer: "return=representation", corps: { titre: "titre piraté" } });
  const relu = await chantier(visible);
  verifie("ne peut PAS modifier le titre d'un chantier (zéro ligne, titre inchangé en base)", (upd.status < 300 ? Array.isArray(upd.json) && upd.json.length === 0 : true) && relu.titre === "Visible aux utilisateurs", { status: upd.status, json: upd.json, enBase: relu.titre });
  const del = await rest(`chantiers?id=eq.${visible}`, { methode: "DELETE", jwt, prefer: "return=representation" });
  verifie("ne peut PAS supprimer un chantier (zéro ligne, toujours en base)", (del.status < 300 ? Array.isArray(del.json) && del.json.length === 0 : true) && (await chantier(visible)) !== null, { status: del.status, json: del.json });
  const hist = await rest(`historique?select=id&limit=5`, { jwt });
  verifie("historique : liste vide (des lignes existent pourtant pour ce projet)", hist.status === 200 && Array.isArray(hist.json) && hist.json.length === 0, hist);
  const sup = await rest(`supprimes?select=id&limit=5`, { jwt });
  verifie("supprimes : liste vide", sup.status === 200 && Array.isArray(sup.json) && sup.json.length === 0, sup);
  const msgOk = await rest("messages", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P1, chantier_id: visible, auteur: "utilisateur test", auteur_type: "utilisateur", kind: "reponse", corps: "ma réponse" } });
  verifie("peut insérer un message auteur_type=utilisateur, kind=reponse", msgOk.status === 201 && msgOk.json?.[0]?.kind === "reponse", msgOk);
  const msgQ = await rest("messages", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P1, chantier_id: visible, auteur: "utilisateur test", auteur_type: "utilisateur", kind: "question", corps: "une question ?" } });
  verifie("ne peut PAS insérer un message kind=question (42501)", msgQ.status >= 400 && msgQ.json?.code === "42501", msgQ);
  const msgS = await rest("messages", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P1, chantier_id: visible, auteur: "x", auteur_type: "session", kind: "info", corps: "je me fais passer pour une session" } });
  verifie("ne peut PAS se faire passer pour une session (auteur_type=session, 42501)", msgS.status >= 400 && msgS.json?.code === "42501", msgS);
  await creerMessage(P1, cache, { corps: "message d'un chantier interne" });
  const msgs = await rest(`messages?select=id,chantier_id&chantier_id=eq.${cache}`, { jwt });
  verifie("ne voit pas les messages d'un chantier interne", msgs.status === 200 && Array.isArray(msgs.json) && msgs.json.length === 0, msgs);
  const moi = await rpcUtilisateur("moi", {}, jwt);
  verifie("rpc('moi') → admin:false, son e-mail, son user_id", moi.status === 200 && moi.json?.admin === false && moi.json?.email === EMAIL && moi.json?.user_id === userId, moi);
  const aCertifier = await creerChantier(P1, { titre: "À certifier par l'utilisateur", etat: "a_verifier" });
  const cert = await rpcUtilisateur("certifier_chantier", { p_id: aCertifier, p_par: "utilisateur test", p_mots: "ça marche chez moi" }, jwt);
  const lc = await chantier(aCertifier);
  verifie("rpc('certifier_chantier') MARCHE pour lui sur un chantier a_verifier visible (voulu : l'utilisateur final certifie)", cert.status < 300 && lc.etat === "valide" && lc.valide_par === "utilisateur test", { status: cert.status, json: cert.json, etat: lc.etat });
  const act = await rpcUtilisateur("signaler_activite", { p_projet: SLUG_A, p_chantier: aCertifier, p_session: "pirate", p_etape: "x" }, jwt);
  verifie("rpc('signaler_activite') REFUSÉ (execute révoqué pour authenticated, 42501)", act.status >= 400 && act.json?.code === "42501", act);
  const nAct = (await une(`select count(*)::int as n from activite where session = 'pirate'`)).n;
  verifie("…et rien n'a été écrit", nAct === 0);
  const memb = await rpcUtilisateur("ajouter_membre", { p_projet: P1, p_email: EMAIL }, jwt);
  verifie("rpc('ajouter_membre') refusé (« réservé aux admins »)", memb.status >= 400 && contient(memb.json?.message, "réservé aux admins"), memb);
  const mdp = await rpcUtilisateur("membres_du_projet", { p_projet: P1 }, jwt);
  verifie("rpc('membres_du_projet') ne lui livre aucun e-mail (liste vide, pas admin)", mdp.status === 200 && Array.isArray(mdp.json) && mdp.json.length === 0, mdp);
  const projets = await rest(`projets?select=slug,cle_embed`, { jwt });
  verifie("projets : voit le projet A (y compris sa cle_embed — à noter, voir rapport)", projets.status === 200 && projets.json?.some?.((p) => p.slug === SLUG_A), projets);
  return { cache };
}

async function controle11_rls_non_membre({ cache }) {
  section("11. RLS, chemin navigateur, utilisateur NON membre du projet B");
  const liste = await rest(`chantiers?select=id&projet_id=eq.${P2}`, { jwt });
  verifie("liste des chantiers du projet B : vide", liste.status === 200 && Array.isArray(liste.json) && liste.json.length === 0, liste);
  const projets = await rest(`projets?select=slug`, { jwt });
  const slugs = Array.isArray(projets.json) ? projets.json.map((p) => p.slug) : [];
  verifie("projets : le projet B n'apparaît pas, le projet A oui", !slugs.includes(SLUG_B) && slugs.includes(SLUG_A), slugs);
  verifie("projets : aucun projet réel n'apparaît (cockpit, facepro…)", slugs.every((s) => s.startsWith("test-verif-")), slugs);
  const sec = await rest(`sections?select=id&projet_id=eq.${P2}`, { jwt });
  verifie("sections du projet B : vide", sec.status === 200 && Array.isArray(sec.json) && sec.json.length === 0, sec);

  // Portée des fonctions security definer : rien dans leur code ne vérifie
  // que l'appelant est membre du projet (ni que le chantier lui est visible).
  // Un utilisateur authentifié qui connaît un uuid pourrait donc agir sur un
  // projet qui n'est pas le sien. Attendu : refus. Si ces contrôles sont
  // rouges, c'est un défaut du schéma, décrit dans le rapport — pas du script.
  console.log("  — portée des fonctions security definer (un utilisateur ne doit agir que chez lui) —");
  const cB = await creerChantier(P2, { titre: "À vérifier dans le projet B", etat: "a_verifier" });
  const certB = await rpcUtilisateur("certifier_chantier", { p_id: cB, p_par: "intrus" }, jwt);
  const lB = await chantier(cB);
  verifie("certifier_chantier sur un chantier du projet B (non membre) : refusé, état inchangé", certB.status >= 400 && lB.etat === "a_verifier", { status: certB.status, json: certB.json, etat: lB.etat, valide_par: lB.valide_par });
  const corrB = await rpcUtilisateur("corriger_chantier", { p_id: cB, p_par: "intrus", p_mots: "je casse tout" }, jwt);
  const lB2 = await chantier(cB);
  verifie("corriger_chantier sur le projet B (non membre) : refusé, demande inchangée", corrB.status >= 400 && !contient(lB2.demande, "je casse tout"), { status: corrB.status, json: corrB.json, etat: lB2.etat, demande: lB2.demande });
  const qB = await creerMessage(P2, cB, { kind: "question", corps: "question du projet B" });
  const repB = await rpcUtilisateur("repondre_message", { p_id: qB, p_par: "intrus", p_reponse: "réponse intruse" }, jwt);
  const mB = await une(`select reponse, answered_at from messages where id = ${q(qB)}`);
  verifie("repondre_message sur une question du projet B (non membre) : refusé, sans réponse en base", repB.status >= 400 && mB.reponse === null && mB.answered_at === null, { status: repB.status, json: repB.json, enBase: mB });
  const cB2 = await creerChantier(P2, { titre: "Second chantier du projet B" });
  const fusB = await rpcUtilisateur("fusionner_chantiers", { p_source: cB2, p_cible: cB, p_par: "intrus" }, jwt);
  const lB3 = await chantier(cB2);
  verifie("fusionner_chantiers dans le projet B (non membre) : refusé, rien d'archivé", fusB.status >= 400 && lB3.archived_at === null && lB3.doublon_de === null, { status: fusB.status, json: fusB.json, enBase: { archived_at: lB3.archived_at, doublon_de: lB3.doublon_de } });
  await sql(`update chantiers set etat = 'a_verifier' where id = ${q(cache)}`);
  const certCache = await rpcUtilisateur("certifier_chantier", { p_id: cache, p_par: "membre" }, jwt);
  const lCache = await chantier(cache);
  verifie("certifier_chantier sur un chantier INTERNE (visible_utilisateurs=false) de son projet : refusé", certCache.status >= 400 && lCache.etat === "a_verifier", { status: certCache.status, json: certCache.json, etat: lCache.etat });
  const vuB = await rpcUtilisateur("marquer_vu", { p_projet: P2 }, jwt);
  const nVuB = (await une(`select count(*)::int as n from visites where user_id = ${q(userId)} and projet_id = ${q(P2)}`)).n;
  verifie("marquer_vu sur le projet B (non membre) : aucune visite enregistrée", vuB.status >= 400 && nVuB === 0, { status: vuB.status, json: vuB.json, enBase: nVuB });
  const hB = await une(`select id from historique where chantier_id in (select id from chantiers where projet_id = ${q(P1)}) and champ = 'titre' limit 1`);
  const rest_ = await rpcUtilisateur("restaurer_champ", { p_historique: hB?.id ?? 0, p_par: "membre" }, jwt);
  verifie("restaurer_champ par un simple membre : refusé (restaurer est un geste d'admin)", rest_.status >= 400, { status: rest_.status, json: rest_.json, historique: hB?.id });

  // Pire : SANS AUCUN COMPTE. Les fonctions naissent avec EXECUTE pour PUBLIC
  // (défaut PostgreSQL), dont `anon` hérite : la clé publique seule suffit.
  console.log("  — sans compte du tout (rôle anon, clé publique seule) —");
  const anonLit = await rest(`chantiers?select=id&limit=1`, { jwt: CLE_PUBLIQUE });
  verifie("anon : lire chantiers refusé (aucun grant à anon)", anonLit.status >= 400 && anonLit.json?.code === "42501", anonLit);
  const cAnon = await creerChantier(P2, { titre: "À vérifier, visé par un anonyme", etat: "a_verifier" });
  const certAnon = await rpcUtilisateur("certifier_chantier", { p_id: cAnon, p_par: "anonyme" }, CLE_PUBLIQUE);
  const lAnon = await chantier(cAnon);
  verifie("anon : rpc('certifier_chantier') refusé, état inchangé", certAnon.status >= 400 && lAnon.etat === "a_verifier", { status: certAnon.status, json: certAnon.json, etat: lAnon.etat, valide_par: lAnon.valide_par });
  const qAnon = await creerMessage(P2, cAnon, { kind: "question", corps: "question visée par un anonyme" });
  const repAnon = await rpcUtilisateur("repondre_message", { p_id: qAnon, p_par: "anonyme", p_reponse: "réponse anonyme" }, CLE_PUBLIQUE);
  const mAnon = await une(`select reponse from messages where id = ${q(qAnon)}`);
  verifie("anon : rpc('repondre_message') refusé, sans réponse en base", repAnon.status >= 400 && mAnon.reponse === null, { status: repAnon.status, json: repAnon.json, enBase: mAnon });
  const cAnonLibre = await creerChantier(P2, { titre: "Libre, visé par un anonyme", etat: "libre" });
  const resAnon = await rpcUtilisateur("reserver_chantier", { p_id: cAnonLibre, p_par: "session-anonyme" }, CLE_PUBLIQUE);
  const lAnon2 = await chantier(cAnonLibre);
  verifie("anon : rpc('reserver_chantier') refusé, aucune réservation posée", resAnon.status >= 400 && lAnon2.pris_par === null, { status: resAnon.status, json: resAnon.json, pris_par: lAnon2.pris_par });
  const actAnon = await rpcUtilisateur("signaler_activite", { p_projet: SLUG_B, p_chantier: cAnon, p_session: "anonyme", p_etape: "x" }, CLE_PUBLIQUE);
  verifie("anon : rpc('signaler_activite') refusé", actAnon.status >= 400, { status: actAnon.status, json: actAnon.json });
}

async function controle12_realtime() {
  section("12. temps réel — postgres_changes sur cockpit.chantiers, vu par l'utilisateur");
  if (typeof globalThis.WebSocket !== "function") {
    verifie("WebSocket natif disponible dans ce Node (>= 22)", false, `process.version = ${process.version} : pas de globalThis.WebSocket, contrôle impossible`);
    return;
  }
  const evenements = [];
  let ref = 0;
  const topic = `realtime:verif-${rand}`;
  ws = new WebSocket(`${URL_.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${CLE_PUBLIQUE}&vsn=1.0.0`);
  const envoyer = (event, payload, t = topic) => ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++ref) }));
  const attendreMessage = (pred, ms, nom) => new Promise((resolve) => {
    const deja = evenements.find(pred);
    if (deja) return resolve(deja);
    const fin = setTimeout(() => { resolve(null); }, ms);
    const ecoute = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (pred(m)) { clearTimeout(fin); ws.removeEventListener("message", ecoute); resolve(m); }
    };
    ws.addEventListener("message", ecoute);
  });
  ws.addEventListener("message", (e) => { try { evenements.push(JSON.parse(e.data)); } catch {} });
  const ouvert = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 10000);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(true); });
    ws.addEventListener("error", () => { clearTimeout(t); resolve(false); });
  });
  if (!verifie("connexion WebSocket ouverte", ouvert)) return;
  const battement = setInterval(() => { try { envoyer("heartbeat", {}, "phoenix"); } catch {} }, 25000);
  try {
    envoyer("phx_join", {
      config: { broadcast: { self: false }, presence: { key: "" },
        postgres_changes: [{ event: "*", schema: "cockpit", table: "chantiers", filter: `projet_id=eq.${P1}` }] },
      access_token: jwt,
    });
    const reponseJoin = await attendreMessage((m) => m.topic === topic && m.event === "phx_reply", 10000);
    verifie("phx_join accepté (status ok)", reponseJoin?.payload?.status === "ok", reponseJoin?.payload);
    const abonne = await attendreMessage((m) => m.topic === topic && m.event === "system", 10000);
    if (!verifie("« Subscribed to PostgreSQL » reçu (SUBSCRIBED) sous 10 s", abonne?.payload?.status === "ok" && /subscribed/i.test(abonne?.payload?.message ?? ""), abonne?.payload ?? "rien reçu")) return;
    // Piège connu : le tout premier canal d'une connexion neuve peut rater une
    // écriture faite dans la seconde qui suit SUBSCRIBED.
    await attendre(1500);
    const idInsere = randomUUID();
    const promesse = attendreMessage((m) => m.topic === topic && m.event === "postgres_changes" && m.payload?.data?.type === "INSERT" && m.payload?.data?.record?.id === idInsere, 10000);
    await sql(`insert into chantiers (id, projet_id, titre) values (${q(idInsere)}, ${q(P1)}, 'Inséré pour le temps réel')`);
    const ev = await promesse;
    verifie("événement INSERT reçu sous 10 s, avec la ligne (titre, projet)", ev?.payload?.data?.record?.titre === "Inséré pour le temps réel" && ev?.payload?.data?.record?.projet_id === P1, ev ? { type: ev.payload?.data?.type, record: ev.payload?.data?.record?.titre } : "rien reçu");
    const idCache = randomUUID();
    const promesseCache = attendreMessage((m) => m.topic === topic && m.event === "postgres_changes" && m.payload?.data?.record?.id === idCache, 4000);
    await sql(`insert into chantiers (id, projet_id, titre, visible_utilisateurs) values (${q(idCache)}, ${q(P1)}, 'Interne, temps réel', false)`);
    verifie("un chantier interne (visible_utilisateurs=false) n'arrive PAS à l'utilisateur (RLS du temps réel)", (await promesseCache) === null);
    const promesseUpd = attendreMessage((m) => m.topic === topic && m.event === "postgres_changes" && m.payload?.data?.type === "UPDATE" && m.payload?.data?.record?.id === idInsere, 10000);
    await sql(`update chantiers set titre = 'Mis à jour pour le temps réel' where id = ${q(idInsere)}`);
    const up = await promesseUpd;
    verifie("événement UPDATE reçu avec l'ancienne ligne (replica identity full)", up?.payload?.data?.record?.titre === "Mis à jour pour le temps réel" && up?.payload?.data?.old_record?.titre === "Inséré pour le temps réel", up ? { record: up.payload?.data?.record?.titre, old: up.payload?.data?.old_record } : "rien reçu");
  } finally {
    clearInterval(battement);
    try { ws.close(); } catch {}
    ws = null;
  }
}

async function controle13_exec_sql() {
  section("13. exec_sql — le search_path est porté par la fonction du schéma cockpit");
  const avec = await execSql("select count(*)::int as n from projets");
  verifie("avec Content-Profile: cockpit → ok, lignes renvoyées", avec.ok && typeof avec.rows?.[0]?.n === "number" && avec.rows[0].n >= 1, avec);
  const sans = await execSql("select count(*)::int as n from projets", { profil: null });
  verifie("SANS profil → la même requête échoue (relation « projets » inexistante : c'est public.exec_sql)", sans.ok === false && /relation "projets" does not exist/.test(sans.error ?? ""), sans);
  const prefixe = await execSql("select count(*)::int as n from cockpit.projets", { profil: null });
  verifie("SANS profil mais avec le préfixe cockpit. → passe (même base, autre fonction)", prefixe.ok && prefixe.rows?.[0]?.n >= 1, prefixe);
  const util = await rpcUtilisateur("exec_sql", { query: "select 1" }, jwt);
  verifie("exec_sql avec un JWT utilisateur → refusé (42501, réservé à service_role)", util.status >= 400 && util.json?.code === "42501", util);
  const alias = await execSql("select 1 as t, 2 as b");
  verifie("piège documenté : une colonne « t » avale la ligne (rows = [1], pas [{t,b}]) — comportement à connaître, pas à corriger ici", alias.ok && JSON.stringify(alias.rows) === "[1]", alias.rows);
  const deuxInstr = await execSql("select 1 as a; select 2 as b");
  verifie("deux instructions dans un appel : exécutées sans lignes (rows null), comme documenté", deuxInstr.ok && deuxInstr.rows === null, deuxInstr);
}

async function controle14_sessions_agents_fusions() {
  section("14. sessions, agents (hook de suivi), rangement et fusions suggérées — 29 sept. 2026");
  const sid = `test-sess-${rand}`;
  const suivre = (ev) => execSql(`select suivre(${q(SLUG_A)}, ${q(JSON.stringify({ session_id: sid, ...ev }))}::jsonb) as r`);
  await suivre({ hook_event_name: "UserPromptSubmit", prompt: "Essai du suivi", branche: "claude/test" });
  let s = await une(`select * from sessions where id = ${q(sid)}`);
  verifie("UserPromptSubmit crée la session, tour en cours, sujet = début du message", s && s.tour_en_cours === true && s.sujet === "Essai du suivi" && s.branche === "claude/test", s);
  // Un agent se signale AVANT que le hook l'ait vu : ligne provisoire, puis ADOPTÉE (jamais dédoublée).
  const prov = await execSql(`select progression_tache(${q(SLUG_A)}, 'Mesurer les cheveux', 'Clip 3 sur 12', 25, 540, null, 'en_cours', ${q(sid)}) as id`);
  verifie("progression_tache avant le hook : ligne provisoire créée", prov.ok && prov.rows?.[0]?.id, prov);
  await suivre({ hook_event_name: "Stop", background_tasks: [
    { id: "aT1", type: "local_agent", status: "running", description: "Mesurer les cheveux", agent_type: "general-purpose" },
    { id: "bT2", type: "local_bash", status: "running", description: "Attendre la réplique", command: "until grep done" } ] });
  let t = await sql(`select tache_id, type, statut, etape, pourcentage, eta_secondes from taches where session_id = ${q(sid)} order by tache_id`);
  verifie("Stop : deux tâches, l'agent a adopté sa ligne provisoire (étape, %, reste conservés)",
    t.length === 2 && t[0].tache_id === "aT1" && t[0].type === "agent" && t[0].etape === "Clip 3 sur 12" && t[0].pourcentage === 25 && t[0].eta_secondes === 540 && t[1].type === "commande", t);
  s = await une(`select tour_en_cours from sessions where id = ${q(sid)}`);
  verifie("Stop : la session attend le prochain message (tour_en_cours = false)", s.tour_en_cours === false, s);
  await suivre({ hook_event_name: "Stop", background_tasks: [{ id: "aT1", type: "local_agent", status: "running", description: "Mesurer les cheveux" }] });
  t = await une(`select statut, fini_at is not null as fini from taches where session_id = ${q(sid)} and tache_id = 'bT2'`);
  verifie("une tâche absente de la liste suivante passe « terminée »", t.statut === "termine" && t.fini, t);
  await suivre({ hook_event_name: "SubagentStop", agent_id: "aT1" });
  t = await une(`select statut from taches where session_id = ${q(sid)} and tache_id = 'aT1'`);
  verifie("SubagentStop termine l'agent", t.statut === "termine", t);
  // Droits : un utilisateur (même membre) ne lit ni sessions ni tâches, n'appelle pas suivre.
  const lu = await rest(`taches?select=id&session_id=eq.${sid}`, { jwt });
  verifie("un membre ne voit AUCUNE tâche de session (RLS admin)", lu.status === 200 && Array.isArray(lu.json) && lu.json.length === 0, lu);
  const lu2 = await rest(`sessions?select=id&id=eq.${sid}`, { jwt });
  verifie("un membre ne voit AUCUNE session (RLS admin)", lu2.status === 200 && Array.isArray(lu2.json) && lu2.json.length === 0, lu2);
  const pirate = await rpcUtilisateur("suivre", { p_projet: SLUG_A, p: { session_id: "x", hook_event_name: "Stop" } }, jwt);
  verifie("suivre avec un JWT utilisateur → refusé (42501)", pirate.status >= 400 && pirate.json?.code === "42501", pirate);
  // Claude range : la section est créée si besoin.
  const c1 = await creerChantier(P1, { titre: "Mesure des cheveux longs" });
  const c2 = await creerChantier(P1, { titre: "Cheveux longs : mesure" });
  const r = await execSql(`select ranger_chantier(${q(c1)}, 'Rubrique neuve ${rand}', 'claude/test') as s`);
  const sec = await une(`select s.nom from chantiers c join sections s on s.id = c.section_id where c.id = ${q(c1)}`);
  verifie("ranger_chantier crée la section et y range le chantier", r.ok && sec?.nom === `Rubrique neuve ${rand}`, { r, sec });
  // Fusion SUGGÉRÉE : rien ne bouge tant que l'humain n'a pas tranché.
  const sug = await execSql(`select suggerer_fusion(${q(c2)}, ${q(c1)}, 'Même sujet', 'claude/test') as m`);
  const mid = sug.rows?.[0]?.m;
  verifie("suggerer_fusion crée un message « fusion » avec deux options", sug.ok && mid && (await une(`select kind, jsonb_array_length(options) as n from messages where id = ${q(mid)}`))?.n === 2, sug);
  const bis = await execSql(`select suggerer_fusion(${q(c2)}, ${q(c1)}, 'Même sujet', 'claude/test') as m`);
  verifie("la même suggestion n'est pas posée deux fois", bis.ok && bis.rows?.[0]?.m === null, bis);
  verifie("tant qu'il n'a pas tranché, rien n'est fusionné", (await chantier(c2)).doublon_de === null);
  const tr = await rpcUtilisateur("trancher_fusion", { p_message: mid, p_fusionner: true }, jwt);
  verifie("un membre NON admin ne peut pas trancher une fusion", tr.status >= 400 && (await chantier(c2)).doublon_de === null, tr);
  const ok = await execSql(`select trancher_fusion(${q(mid)}, true, 'Raphaël') as r`);
  const apres = await chantier(c2);
  const msg = await une(`select reponse, answered_at is not null as repondu from messages where id = ${q(mid)}`);
  verifie("« Fusionner » : le doublon est absorbé (doublon_de, archivé) et la suggestion est répondue",
    ok.ok && apres.doublon_de === c1 && apres.archived_at && msg.reponse === "Fusionner" && msg.repondu, { ok, apres, msg });
  const c3 = await creerChantier(P1, { titre: "Autre sujet" });
  const sug2 = await execSql(`select suggerer_fusion(${q(c3)}, ${q(c1)}, 'Peut-être', 'claude/test') as m`);
  await execSql(`select trancher_fusion(${q(sug2.rows[0].m)}, false, 'Raphaël') as r`);
  verifie("« Garder séparés » : rien n'est fusionné, la suggestion est close",
    (await chantier(c3)).doublon_de === null && (await une(`select reponse from messages where id = ${q(sug2.rows[0].m)}`)).reponse === "Garder séparés");
}

// ---------------------------------------------------- 16. médias (0013)
async function stockage(chemin, { methode = "GET", jwt: j, corps, type = "text/plain" } = {}) {
  const cle = j ? CLE_PUBLIQUE : CLE_SERVICE;
  const r = await fetch(`${URL_}/storage/v1/object/${chemin}`, {
    method: methode,
    headers: { apikey: cle, Authorization: `Bearer ${j ?? CLE_SERVICE}`, ...(corps !== undefined ? { "Content-Type": type } : {}) },
    body: corps,
  });
  const texte = await r.text();
  let json = null; try { json = JSON.parse(texte); } catch { json = texte; }
  return { status: r.status, json };
}
async function controle16_medias() {
  section("16. médias joints aux réponses (0013) — stockage privé, droits par projet et chantier");
  const b = await une(`select public, file_size_limit from storage.buckets where id = 'cockpit-medias'`);
  verifie("le bucket cockpit-medias existe, PRIVÉ, 50 Mo par fichier", b && b.public === false && Number(b.file_size_limit) === 52428800, b);
  const droits = await une(`select has_function_privilege('anon', 'cockpit.peut_lire_media(text)', 'execute') as anon_lit,
                                   has_function_privilege('authenticated', 'cockpit.peut_lire_media(text)', 'execute') as auth_lit,
                                   has_function_privilege('anon', 'cockpit.peut_deposer_media(text)', 'execute') as anon_depose`);
  verifie("fonctions de droit des médias : EXECUTE refusé à anon, donné à authenticated", droits.anon_lit === false && droits.anon_depose === false && droits.auth_lit === true, droits);
  const visible = await creerChantier(P1, { titre: "Médias : visible" });
  const cache = await creerChantier(P1, { titre: "Médias : interne", visible: false });
  const cheminOk = `${P1}/${visible}/${randomUUID()}-capture.txt`;
  const dep = await stockage(`cockpit-medias/${cheminOk}`, { methode: "POST", jwt, corps: "photo de test" });
  verifie("un membre dépose un média sur un chantier visible de SON projet", dep.status === 200, dep);
  const cheminProjet = `${P1}/projet/${randomUUID()}-note.txt`;
  const depP = await stockage(`cockpit-medias/${cheminProjet}`, { methode: "POST", jwt, corps: "niveau projet" });
  verifie("un membre dépose un média de niveau projet (dossier « projet »)", depP.status === 200, depP);
  const depCache = await stockage(`cockpit-medias/${P1}/${cache}/${randomUUID()}-x.txt`, { methode: "POST", jwt, corps: "x" });
  verifie("REFUSÉ sur un chantier interne (visible_utilisateurs=false)", depCache.status >= 400, depCache);
  const depB = await stockage(`cockpit-medias/${P2}/projet/${randomUUID()}-x.txt`, { methode: "POST", jwt, corps: "x" });
  verifie("REFUSÉ dans un projet dont il n'est pas membre", depB.status >= 400, depB);
  const depMal = await stockage(`cockpit-medias/pas-un-uuid/projet/x.txt`, { methode: "POST", jwt, corps: "x" });
  verifie("REFUSÉ sur un chemin mal formé (sans erreur SQL)", depMal.status >= 400 && !/invalid input syntax/i.test(JSON.stringify(depMal.json)), depMal);
  const lu = await stockage(`authenticated/cockpit-medias/${cheminOk}`, { jwt });
  verifie("il relit son média", lu.status === 200 && lu.json === "photo de test", lu);
  const cheminB = `${P2}/projet/${randomUUID()}-secret.txt`;
  await stockage(`cockpit-medias/${cheminB}`, { methode: "POST", corps: "secret B" });   // service_role, comme une session
  const luB = await stockage(`authenticated/cockpit-medias/${cheminB}`, { jwt });
  verifie("il ne lit PAS un média d'un autre projet", luB.status >= 400 && luB.json !== "secret B", luB);
  const cheminCache = `${P1}/${cache}/${randomUUID()}-interne.txt`;
  await stockage(`cockpit-medias/${cheminCache}`, { methode: "POST", corps: "interne" });
  const luCache = await stockage(`authenticated/cockpit-medias/${cheminCache}`, { jwt });
  verifie("il ne lit PAS un média d'un chantier interne", luCache.status >= 400 && luCache.json !== "interne", luCache);
  const luSession = await stockage(`authenticated/cockpit-medias/${cheminOk}`);
  verifie("une session (service_role, scripts/media.sh) lit le média", luSession.status === 200 && luSession.json === "photo de test", luSession);
  const suppr = await fetch(`${URL_}/storage/v1/object/cockpit-medias`, { method: "DELETE", headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [cheminOk] }) });
  const encore = await stockage(`authenticated/cockpit-medias/${cheminOk}`);
  verifie("un membre ne supprime PAS un média (réservé à l'admin)", encore.status === 200, { suppr: suppr.status, encore: encore.status });
  const medias = [{ chemin: cheminOk, nom: "capture.txt", type: "text/plain", taille: 13 }];
  const msg = await rest("messages", { methode: "POST", jwt, prefer: "return=representation", corps: { projet_id: P1, chantier_id: visible, auteur: "utilisateur test", auteur_type: "utilisateur", kind: "info", corps: "📎 1 fichier", medias } });
  verifie("il écrit un message qui porte ses médias (colonne medias)", msg.status === 201 && msg.json?.[0]?.medias?.[0]?.chemin === cheminOk, msg);
  const sansMedias = await une(`select medias from messages where projet_id = ${q(P1)} and medias = '[]'::jsonb limit 1`).catch(() => null);
  verifie("un message sans pièce jointe a medias = [] (jamais null)", (await une(`select count(*)::int as n from messages where medias is null`)).n === 0, sansMedias);
}

async function controle17_verifie_pour_moi() {
  section("17. « Je ne sais pas : vérifie pour moi » et verdict de Claude (0016)");
  const c = await creerChantier(P1, { titre: "À vérifier par Claude", etat: "a_verifier" });
  const dem = await rpcUtilisateur("demander_verification", { p_id: c, p_par: "utilisateur test", p_mots: "voici ce que j'ai vu" }, jwt);
  const l1 = await chantier(c);
  verifie("un membre demande « vérifie pour moi » sur un chantier à vérifier", dem.status < 300 && !!l1.verif_demandee_at, { dem, l1 });
  const pirate = await rpcUtilisateur("rendre_verdict", { p_id: c, p_par: "x", p_ok: true, p_texte: "je me certifie" }, jwt);
  verifie("un membre ne peut PAS rendre le verdict (réservé aux sessions, 42501)", pirate.status >= 400 && pirate.json?.code === "42501", pirate);
  await une(`select rendre_verdict(${q(c)}::uuid, 'session-test', true, 'Tout correspond') as r`);
  const l2 = await chantier(c);
  verifie("verdict « bon » : la demande est levée, le verdict est noté, il reste « à vérifier » pour le toucher humain", !l2.verif_demandee_at && l2.verdict_ok === true && l2.etat === "a_verifier", l2);
  const c2 = await creerChantier(P1, { titre: "Mauvais résultat", etat: "a_verifier" });
  await une(`select rendre_verdict(${q(c2)}::uuid, 'session-test', false, 'Il manque une section') as r`);
  const l3 = await chantier(c2);
  verifie("verdict « pas bon » : le chantier repart en correction (libre, demande complétée)", l3.etat === "libre" && /Il manque une section/.test(l3.demande ?? ""), l3);
  const hors = await rpcUtilisateur("demander_verification", { p_id: await creerChantier(P1, { titre: "Pas livré" }), p_par: "u" }, jwt);
  verifie("refusé sur un chantier qui n'est pas « à vérifier »", hors.status >= 400, hors);
}

async function controle15_limites_autonome() {
  section("15. limite d'usage (pause) et mode autonome (enchaînement) — 29 sept. 2026");
  const sid = `test-auto-${rand}`;
  const suivre = (ev) => execSql(`select suivre(${q(SLUG_A)}, ${q(JSON.stringify({ session_id: sid, ...ev }))}::jsonb) as r`);
  await suivre({ hook_event_name: "StopFailure", error: "rate_limit", error_details: "Resets 4am" });
  let s = await une(`select pause_raison, pause_detail from sessions where id = ${q(sid)}`);
  verifie("StopFailure rate_limit → session « en pause », détail gardé", s?.pause_raison === "rate_limit" && s.pause_detail === "Resets 4am", s);
  await suivre({ hook_event_name: "UserPromptSubmit", prompt: "on reprend" });
  s = await une(`select pause_raison from sessions where id = ${q(sid)}`);
  verifie("le signe de vie suivant lève la pause", s?.pause_raison === null, s);
  const suivant = () => execSql(`select prochain_chantier_autonome(${q(SLUG_A)}, ${q(sid)}, 'claude/nuit') as c`);
  const libre = await creerChantier(P1, { titre: "Libre pour la nuit", etat: "libre" });
  const cadrer = await creerChantier(P1, { titre: "À cadrer, jamais pris la nuit", etat: "a_cadrer" });
  let r = await suivant();
  verifie("mode éteint → rien n'est donné (la session s'arrête)", r.ok && r.rows?.[0]?.c === null, r);
  const pass = await execSql(`select regler_autonome(${q(SLUG_A)}, now() - interval '1 minute') as r`);
  verifie("une heure de fin passée est refusée", pass.ok === false, pass);
  const trop = await execSql(`select regler_autonome(${q(SLUG_A)}, now() + interval '30 hours') as r`);
  verifie("plus de 24 h d'affilée est refusé", trop.ok === false, trop);
  const util = await rpcUtilisateur("regler_autonome", { p_projet: SLUG_A, p_jusqu_a: new Date(Date.now() + 3600e3).toISOString() }, jwt);
  verifie("un membre non admin ne peut pas allumer le mode autonome", util.status >= 400, util);
  await execSql(`select regler_autonome(${q(SLUG_A)}, now() + interval '3 hours', 1) as r`);
  r = await suivant();
  const c = r.rows?.[0]?.c;
  const donne = c?.id ? await chantier(c.id) : null;
  verifie("mode allumé → un chantier LIBRE (le plus ancien) est donné et réservé pour la session",
    !!donne && donne.pris_par === "claude/nuit" && donne.etat === "en_cours" && donne.projet_id === P1 && c.id !== cadrer, { r, donne, libre });
  verifie("un chantier « à cadrer » n'est jamais donné", (await chantier(cadrer)).pris_par === null);
  await creerChantier(P1, { titre: "Deuxième libre", etat: "libre" });
  r = await suivant();
  verifie("le plafond par session (1 ici) arrête l'enchaînement", r.ok && r.rows?.[0]?.c === null, r);
  await execSql(`select regler_autonome(${q(SLUG_A)}, null) as r`);
  verifie("éteindre = null", (await une(`select autonome_jusqu_a from projets where id = ${q(P1)}`)).autonome_jusqu_a === null);
}

async function controle18_reponses_prises() {
  section("18. Une réponse de Raphaël est toujours reprise, même sans session (0017, scripts/chef.sh)");
  // Comme depuis l'app : answered_by = l'utilisateur qui répond (auth.uid()). Une
  // réponse notée par une session (answered_by null) vient de sa conversation (0018).
  const repondre = (mid, reponse) => sql(`update messages set reponse = ${q(reponse)}, answered_at = now(), answered_by = ${q(userId)} where id = ${q(mid)}`);
  const enAttente = async () => (await sql(`select chantier_id from reponses_sans_suite(${q(P1)})`)).map((r) => r.chantier_id);
  // Le cas signalé : un chantier « à vérifier », personne dessus, Raphaël répond.
  const c = await creerChantier(P1, { titre: "Test réponse prise (à vérifier)", etat: "a_verifier", demande: "demande de test" });
  const m = await creerMessage(P1, c, { kind: "question", corps: "Je lance le banc GPU de test ?", options: [{ libelle: "Oui, ~0,9 $" }, { libelle: "Non" }] });
  verifie("une question pas encore répondue n'est pas « sans suite »", !(await enAttente()).includes(c));
  await repondre(m, "Oui, ~0,9 $");
  verifie("répondue, personne dessus → « sans suite »", (await enAttente()).includes(c));
  // Retirée par Claude : jamais reprise.
  const cR = await creerChantier(P1, { titre: "Test question retirée", etat: "bloque" });
  const mR = await creerMessage(P1, cR, { kind: "question", corps: "Question dépassée ?" });
  await repondre(mR, "Retirée par Claude (test) : plus utile");
  // Tenu (réservation en cours) : c'est sa session qui la reçoit (hooks/suivi.sh).
  const cT = await creerChantier(P1, { titre: "Test tenu", etat: "en_cours" });
  const mT = await creerMessage(P1, cT, { kind: "question", corps: "Tenu ?" });
  await reserver(cT, "claude/tenu", 60);
  await repondre(mT, "Oui");
  // Déjà suivie : une session a écrit après la réponse.
  const cS = await creerChantier(P1, { titre: "Test déjà suivi", etat: "bloque" });
  const mS = await creerMessage(P1, cS, { kind: "question", corps: "Suivi ?" });
  await repondre(mS, "Oui");
  await attendre(50);
  await creerMessage(P1, cS, { kind: "info", corps: "Je m'en occupe." });
  // Notée par une session (repondre_message en service : answered_by null) : déjà prise (0018).
  const cN = await creerChantier(P1, { titre: "Test réponse notée par une session", etat: "bloque" });
  const mN = await creerMessage(P1, cN, { kind: "question", corps: "Notée par une session ?" });
  await sql(`select repondre_message(${q(mN)}, 'claude/test', 'Dit dans la conversation', null, null) as r`);
  const liste = await enAttente();
  verifie("une question RETIRÉE par Claude n'est jamais reprise", !liste.includes(cR), liste);
  verifie("une réponse notée par une SESSION (dite dans sa conversation) n'est pas « sans suite » (0018)", !liste.includes(cN), liste);
  verifie("un chantier TENU (réservation en cours) n'est pas repris par la chef", !liste.includes(cT), liste);
  // Le hook de démarrage passe SA branche : un chantier réservé à cette branche est le sien (0018).
  const pourBranche = async (br) => (await sql(`select chantier_id from reponses_sans_suite(${q(P1)}, ${q(br)})`)).map((r) => r.chantier_id);
  verifie("tenu par MA branche → « sans suite » pour moi (démarrage d'une session sur cette branche)", (await pourBranche("claude/tenu")).includes(cT));
  verifie("tenu par une AUTRE branche → pas pour moi", !(await pourBranche("claude/autre")).includes(cT));
  verifie("une réponse déjà SUIVIE d'un message de session n'est pas reprise", !liste.includes(cS), liste);
  // Projets de TEST jamais donnés par la chef (incident du 29/09 : deux chantiers
  // « test-web-… » réservés en plein parcours). On rejoue les VRAIES requêtes de
  // chef.sh (lecture seule) avec le projet de test en tête de file.
  const racineChef = dirname(dirname(fileURLToPath(import.meta.url)));
  const chefSh = (await import("node:fs")).readFileSync(join(racineChef, "scripts/chef.sh"), "utf8");
  verifie("reponses_sans_suite() tous projets n'inclut JAMAIS un projet de test", !(await sql(`select chantier_id from reponses_sans_suite()`)).some((r) => r.chantier_id === c));
  // Depuis 0019 (un chef par projet), chef.sh ne parcourt plus « tous les
  // projets » : il ne sert que le sien. La chef du cockpit ne voit donc jamais
  // un projet de test ; on rejoue sa requête « vérifie pour moi » pour le projet
  // cockpit, avec le chantier de test en tête de file.
  const reqVerif = chefSh.match(/un "(select c\.id, c\.titre, p\.slug[\s\S]*?limit 1)"/)?.[1];
  const cockpitId = (await une(`select id from projets where slug = 'cockpit'`))?.id;
  await sql(`update projets set autonome_toujours = true where id = ${q(P1)}`);
  const cV = await creerChantier(P1, { titre: "Test vérifie pour moi", etat: "a_verifier" });
  await sql(`update chantiers set verif_demandee_at = now() - interval '10 years' where id = ${q(cV)}`);
  const verifChef = reqVerif && cockpitId ? await sql(reqVerif.replaceAll("'$pid'", q(cockpitId))) : null;
  verifie("chef.sh ne parcourt plus tous les projets (0019) : aucune liste « select slug from projets »", !/select slug from projets where actif/.test(chefSh));
  verifie("chef.sh du cockpit : « vérifie pour moi » d'un projet de test jamais donné", !!verifChef && !verifChef.some((r) => r.id === cV), { trouvee: !!reqVerif, verifChef });
  await sql(`update projets set autonome_toujours = false where id = ${q(P1)}`);
  await sql(`update chantiers set verif_demandee_at = null where id = ${q(cV)}`);
  // Une question SANS chantier (niveau projet), répondue, que personne n'a suivie.
  const mP = randomUUID();
  await sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, reponse, answered_at, answered_by)
             values (${q(mP)}, ${q(P1)}, null, 'verifier-base', 'session', 'question', 'Installer le module de test ?', 'Seulement pour moi (admin)', now(), ${q(userId)})`);
  verifie("une question de PROJET (sans chantier) répondue est aussi « sans suite »", (await sql(`select message_id from reponses_sans_suite(${q(P1)})`)).some((r) => r.message_id === mP));
  const pirate = await rpcUtilisateur("reprendre_reponse", { p_branche: "agent/pirate" }, jwt);
  const pirate2 = await rpcUtilisateur("reponses_sans_suite", {}, jwt);
  verifie("un membre ne peut ni reprendre une réponse ni lister celles de tous les projets", pirate.status >= 400 && pirate2.status >= 400, { pirate, pirate2 });

  // scripts/chef.sh de bout en bout, sur le projet de test : un faux sql.sh
  // répond « tu es la chef, 0 agent, mode autonome éteint, aucun « vérifie pour
  // moi » » ; reprendre_reponse (borné au projet par chef.sh) va à la vraie base.
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const vrai = join(racine, "scripts/sql.sh");
  const dossier = mkdtempSync(join(tmpdir(), "chef-test-"));
  const faux = join(dossier, "sql.sh");
  writeFileSync(faux, [
    "#!/usr/bin/env bash",
    'if [ $# -gt 0 ]; then r="$1"; else r="$(cat)"; fi',
    'case "$r" in',
    `  *"left join chefs c on c.projet_id"*) echo '{"ok":true,"rows":[{"projet_id":"${P1}","slug":"${SLUG_A}","depot":"","session_id":"chef-test","max_agents":3,"agents":0,"autonome":false}]}' ;;`,
    `  *"update chefs set"*) echo '{"ok":true,"rows":null}' ;;`,
    `  *"verif_demandee_at is not null"*) echo '{"ok":true,"rows":[]}' ;;`,
    `  *) exec "${vrai}" "$r" ;;`,
    "esac", "",
  ].join("\n"), { mode: 0o755 });
  const chef = () => execFileSync("bash", [join(racine, "scripts/chef.sh")], { encoding: "utf8", env: { ...process.env, COCKPIT_SQL: faux, COCKPIT_PROJET: SLUG_A, CLAUDE_CODE_SESSION_ID: "chef-test" } });
  try {
    const sortie = chef();
    const l = await chantier(c);
    const fil = await sql(`select corps from messages where chantier_id = ${q(c)} and auteur_type = 'session' and kind = 'info'`);
    verifie("chef.sh donne une consigne d'agent : la question, la réponse, « Fais ce que cette réponse annonce »",
      sortie.includes(`SESSION CHEF de ${SLUG_A} : lance 2 agent`) && sortie.includes("Je lance le banc GPU de test ?") && sortie.includes("« Oui, ~0,9 $ »")
        && sortie.includes("Fais ce que cette réponse annonce") && sortie.includes(c), sortie);
    verifie("une réponse qui engage une dépense rappelle les barrières de budget", /DÉPENSE.*plafond de durée.*annulation automatique.*job par job/s.test(sortie), sortie);
    verifie("le chantier repart « en cours », réservé à la branche agent/reponse-… citée dans la consigne",
      l.etat === "en_cours" && /^agent\/reponse-/.test(l.pris_par ?? "") && sortie.includes(l.pris_par), l);
    verifie("le fil dit « Claude reprend ta réponse » (l'app le montre)", fil.some((f) => f.corps.startsWith("Claude reprend ta réponse « Oui, ~0,9 $ »")), fil);
    const qP = await une(`select chantier_id from messages where id = ${q(mP)}`);
    const cP = qP?.chantier_id ? await chantier(qP.chantier_id) : null;
    verifie("question de projet : un chantier INTERNE est ouvert, en cours, réservé à l'agent, la question y est rattachée, consigne donnée",
      !!cP && cP.etat === "en_cours" && cP.visible_utilisateurs === false && /^agent\/reponse-/.test(cP.pris_par ?? "") && sortie.includes("Installer le module de test ?")
        && sortie.includes("question de projet, sans chantier") && sortie.includes(cP.id), { cP, sortie });
    verifie("reprise UNE seule fois : la passe suivante ne la redonne pas", /^RIEN/.test(chef()));
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

// Deux projets NEUFS (C et D) : rien des sections précédentes dans leur file.
const P3 = randomUUID(), P4 = randomUUID();
const SLUG_C = `test-verif-${rand}-c`, SLUG_D = `test-verif-${rand}-d`;
async function controle19_chef_par_projet() {
  section("19. Un chef PAR PROJET (0019) : chaque projet dans sa propre session, jamais un chantier d'un autre projet");
  await sql(`insert into projets (id, slug, nom, autonome_toujours) values (${q(P3)}, ${q(SLUG_C)}, 'Projet de test C', true), (${q(P4)}, ${q(SLUG_D)}, 'Projet de test D', true)`);
  const prendre = (slug, s) => une(`select prendre_chef(${q(slug)}, ${q(s)}, 'agent/test', '') as r`);
  const estChef = async (slug, s) => (await une(`select est_chef(${q(slug)}, ${q(s)}) as c`)).c;
  await prendre(SLUG_C, "chef-c");
  await prendre(SLUG_D, "chef-d");
  verifie("deux projets ont chacun LEUR chef, en même temps", await estChef(SLUG_C, "chef-c") && await estChef(SLUG_D, "chef-d"));
  verifie("la chef de C n'est pas chef de D (et inversement)", !(await estChef(SLUG_D, "chef-c")) && !(await estChef(SLUG_C, "chef-d")));
  const r = (await prendre(SLUG_C, "chef-c2")).r;
  verifie("une nouvelle session de C prend la main sur C seulement (D garde sa chef)",
    r.change === true && r.ancienne === "chef-c" && await estChef(SLUG_C, "chef-c2") && await estChef(SLUG_D, "chef-d"), r);
  await prendre(SLUG_C, "chef-c");
  const e = await une(`select chef_existe(${q(SLUG_C)}) as c, chef_existe(${q(SLUG_A)}) as a`);
  verifie("chef_existe est par projet (C oui, A jamais pris : non → fonctionnement par session)", e.c === true && e.a === false, e);
  const pirate = await rpcUtilisateur("prendre_chef", { p_projet: SLUG_C, p_session: "pirate", p_branche: "x", p_distante: "" }, jwt);
  const lu = await rest(`chefs?select=projet_id`, { jwt });
  verifie("un membre ne peut ni prendre la main ni lire les chefs (service / admin seulement)",
    pirate.status >= 400 && Array.isArray(lu.json) && lu.json.length === 0, { pirate, lu });

  // Du travail dans les DEUX projets : un chantier libre, une réponse sans suite,
  // un « vérifie pour moi ».
  const libre = {}, rep = {}, verif = {};
  for (const [P, S] of [[P3, "C"], [P4, "D"]]) {
    libre[S] = await creerChantier(P, { titre: `Libre ${S}`, etat: "libre", demande: `travail ${S}` });
    rep[S] = await creerChantier(P, { titre: `Réponse ${S}`, etat: "bloque" });
    const m = await creerMessage(P, rep[S], { kind: "question", corps: `Question ${S} ?` });
    await sql(`update messages set reponse = 'Oui', answered_at = now(), answered_by = ${q(userId)} where id = ${q(m)}`);
    verif[S] = await creerChantier(P, { titre: `Vérif ${S}`, etat: "a_verifier" });
    await sql(`update chantiers set verif_demandee_at = now() where id = ${q(verif[S])}`);
  }
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const lancer = (projet, session, args = []) => execFileSync("bash", [join(racine, "scripts/chef.sh"), ...args],
    { encoding: "utf8", env: { ...process.env, COCKPIT_PROJET: projet, CLAUDE_CODE_SESSION_ID: session } });
  verifie("la chef de C lancée sur D : RIEN (elle ne dirige pas D)", /^RIEN — cette session n'est pas la session chef de /.test(lancer(SLUG_D, "chef-c")));
  verifie("--max règle le projet courant seulement", /pour .*: 8/.test(lancer(SLUG_C, "chef-c", ["--max", "8"]))
    && (await une(`select (select max_agents from chefs where projet_id = ${q(P3)}) as c, (select max_agents from chefs where projet_id = ${q(P4)}) as d`)).d === 3);
  const sortieC = lancer(SLUG_C, "chef-c");
  const idsD = [libre.D, rep.D, verif.D];
  verifie("la passe de C sert SES trois sortes de travail (réponse, chantier libre, vérifie pour moi)",
    sortieC.includes(`SESSION CHEF de ${SLUG_C}`) && sortieC.includes(rep.C) && sortieC.includes(libre.C) && sortieC.includes(verif.C), sortieC.slice(0, 600));
  verifie("la passe de C ne propose RIEN de D (ni chantier, ni réponse, ni vérif)", !idsD.some((id) => sortieC.includes(id)) && !sortieC.includes(SLUG_D), sortieC.slice(0, 600));
  const dIntacts = await sql(`select id, pris_par from chantiers where projet_id = ${q(P4)} and pris_par is not null`);
  verifie("aucun chantier de D n'a été réservé par la passe de C", dIntacts.length === 0, dIntacts);
  // Le hook Stop d'une session de D qui n'est pas sa chef : jamais bloquée, ni pilotée par la chef de C.
  const stop = (projet, session) => execFileSync("bash", [join(racine, "hooks/autonome.sh")],
    { encoding: "utf8", input: JSON.stringify({ hook_event_name: "Stop", session_id: session }), env: { ...process.env, COCKPIT_PROJET: projet, CLAUDE_PROJECT_DIR: racine } });
  verifie("hook Stop : la chef de C, dans une session de D, n'est ni bloquée ni pilotée", stop(SLUG_D, "chef-c").trim() === "");
  const sortieD = lancer(SLUG_D, "chef-d");
  verifie("la passe de D sert D, et rien de C", sortieD.includes(libre.D) && ![libre.C, rep.C, verif.C].some((id) => sortieD.includes(id)), sortieD.slice(0, 600));
  // Le hook de message : Raphaël écrit dans une session de D → elle devient chef de D, C garde la sienne.
  execFileSync("bash", [join(racine, "hooks/prompt-rappel.sh")],
    { encoding: "utf8", input: JSON.stringify({ session_id: "nouvelle-d", prompt: "fais ceci" }), env: { ...process.env, COCKPIT_PROJET: SLUG_D, CLAUDE_PROJECT_DIR: racine } });
  verifie("message de Raphaël dans une session de D → chef de D seulement (C inchangé)", await estChef(SLUG_D, "nouvelle-d") && await estChef(SLUG_C, "chef-c"));
}

// ------------------------------------------------------------------ main
console.log(`verifier-base — projets ${SLUG_A} / ${SLUG_B}, compte ${EMAIL}`);
const debut = Date.now();
try {
  await purgerRestesDePassesPrecedentes();
  await sql(`insert into projets (id, slug, nom) values (${q(P1)}, ${q(SLUG_A)}, 'Projet de test A'), (${q(P2)}, ${q(SLUG_B)}, 'Projet de test B')`);
  userId = await creerCompte(EMAIL, MOT_DE_PASSE);
  jwt = await connecter(EMAIL, MOT_DE_PASSE);
  await sql(`insert into membres (projet_id, user_id) values (${q(P1)}, ${q(userId)})`);
  const admin = await une(`select count(*)::int as n from admins where user_id = ${q(userId)}`);
  if (admin.n !== 0) throw new Error("le compte de test est admin : les contrôles RLS n'auraient aucun sens");

  const etapes = [
    controle1_reservation, controle2_historique, controle3_suppression,
    async () => { const c = await controle4_certifier(); await controle5_corriger(c); },
    controle6_repondre, controle7_fusionner, controle8_activite, controle9_marquer_vu,
    async () => { const ctx = await controle10_rls_membre(); await controle11_rls_non_membre(ctx); },
    controle12_realtime, controle13_exec_sql, controle14_sessions_agents_fusions, controle15_limites_autonome, controle16_medias, controle17_verifie_pour_moi,
    controle18_reponses_prises, controle19_chef_par_projet,
  ];
  for (const etape of etapes) {
    try { await etape(); }
    catch (e) { verifie(`${etape.name || "bloc"} : s'est terminé sans planter`, false, e.message); }
  }
} finally {
  section("nettoyage");
  try { if (ws) ws.close(); } catch {}
  const problemes = [];
  if (userId) { if (!(await supprimerCompte(userId))) problemes.push(`compte ${userId} non supprimé`); }
  try { await purgerProjetsDeTest([P1, P2, P3, P4]); } catch (e) { problemes.push(`projets : ${e.message}`); }
  // Les médias de test (0013) : le stockage n'est pas en cascade des projets.
  try {
    const noms = (await sql(`select coalesce(jsonb_agg(name), '[]'::jsonb) as noms from storage.objects where bucket_id = 'cockpit-medias' and (name like ${q(P1 + '/%')} or name like ${q(P2 + '/%')})`))[0]?.noms ?? [];
    if (noms.length) await fetch(`${URL_}/storage/v1/object/cockpit-medias`, { method: "DELETE", headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: noms }) });
    const reste = (await une(`select count(*)::int as n from storage.objects where bucket_id = 'cockpit-medias' and (name like ${q(P1 + '/%')} or name like ${q(P2 + '/%')})`)).n;
    if (reste) problemes.push(`${reste} média(s) de test non supprimé(s)`);
  } catch (e) { problemes.push(`médias : ${e.message}`); }
  const restes = await une(`select (select count(*) from projets where slug like 'test-verif-%')::int as projets,
                                   (select count(*) from supprimes where projet_id in (${q(P1)}, ${q(P2)}, ${q(P3)}, ${q(P4)}))::int as supprimes,
                                   (select count(*) from visites where user_id = ${q(userId)})::int as visites`).catch(() => null);
  const compte = await authAdmin(`admin/users?per_page=10&filter=${encodeURIComponent(EMAIL)}`).catch(() => null);
  const compteReste = (compte?.json?.users ?? []).some((u) => u.email === EMAIL);
  verifie("tout est supprimé : projets de test, traces supprimes/historique, visites, compte auth",
    problemes.length === 0 && restes && restes.projets === 0 && restes.supprimes === 0 && restes.visites === 0 && !compteReste,
    { problemes, restes, compteReste });
}
console.log(`\nverifier-base : ${total - echecs}/${total} en ${((Date.now() - debut) / 1000).toFixed(1)} s`);
process.exit(echecs ? 1 : 0);
