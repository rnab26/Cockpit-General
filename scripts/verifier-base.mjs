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
    controle12_realtime, controle13_exec_sql,
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
  try { await purgerProjetsDeTest([P1, P2]); } catch (e) { problemes.push(`projets : ${e.message}`); }
  const restes = await une(`select (select count(*) from projets where slug like 'test-verif-%')::int as projets,
                                   (select count(*) from supprimes where projet_id in (${q(P1)}, ${q(P2)}))::int as supprimes,
                                   (select count(*) from visites where user_id = ${q(userId)})::int as visites`).catch(() => null);
  const compte = await authAdmin(`admin/users?per_page=10&filter=${encodeURIComponent(EMAIL)}`).catch(() => null);
  const compteReste = (compte?.json?.users ?? []).some((u) => u.email === EMAIL);
  verifie("tout est supprimé : projets de test, traces supprimes/historique, visites, compte auth",
    problemes.length === 0 && restes && restes.projets === 0 && restes.supprimes === 0 && restes.visites === 0 && !compteReste,
    { problemes, restes, compteReste });
}
console.log(`\nverifier-base : ${total - echecs}/${total} en ${((Date.now() - debut) / 1000).toFixed(1)} s`);
process.exit(echecs ? 1 : 0);
