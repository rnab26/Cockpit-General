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
//   21. aucun reste de banc de test (« [TEST… ») dans un projet RÉEL
//   22. correctifs rangés tout seuls (0021)
//   23. « À toi » à jour (0022)
//   24. « où ça en est ? » (0023)
//   25. renforts (0024) : une session par section, exclusivité, jamais deux renforts sur un chantier
//   26. fil en discussion (0025)
//   27. certifier garde une question ouverte (0026), sa réponse reprise sans rouvrir le certifié
//   28. ses messages dans une session arrivent dans le fil du chantier (0027), internes, jamais « à répondre »
//   29. session et cockpit synchronisés (0028) : de côté / reporter / abandonner, chef relais, réveil immédiat
//   30. agents fantômes (0030) : une ligne provisoire finit toujours, la chef ne se croit plus pleine
//   31. « il faudrait aussi X » dans un fil (0033) : chantier créé prêt à lancer, rangé, fils reliés
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
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGE_RESTE_MIN, projetsDeTestAbandonnes, restesDansLesVraisProjets } from "./bancs.mjs";

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
  // Seulement les passes ABANDONNÉES (> AGE_RESTE_MIN min) : jamais le projet
  // ni le compte d'une passe vivante (verifier-reponses, un autre agent).
  const vieux = await projetsDeTestAbandonnes(sql, "test-verif-");
  if (vieux.length) {
    console.log(`  (purge de ${vieux.length} projet(s) de test laissé(s) par une passe précédente : ${vieux.map((p) => p.slug).join(", ")})`);
    await purgerProjetsDeTest(vieux.map((p) => p.id));
  }
  const r = await authAdmin("admin/users?per_page=100&filter=test-verif-");
  const limite = Date.now() - AGE_RESTE_MIN * 60_000;
  const comptes = (r.json?.users ?? []).filter((u) => /^test-verif-[a-z0-9]+@cockpit\.local$/.test(u.email ?? "") && Date.parse(u.created_at) < limite);
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

  // 0031 : sans crédit perdu — le passage constate, et s'éteint seul après le délai réglé sans rien à prendre.
  const constat = async () => (await une(`select constater_autonome(${q(SLUG_A)}) as r`)).r;
  const proj = () => une(`select autonome_toujours, autonome_jusqu_a, autonome_vide_depuis, autonome_eteint_auto_at, autonome_arret_vide_h from projets where id = ${q(P1)}`);
  verifie("constat, mode éteint → « eteint », rien ne bouge", (await constat()) === "eteint");
  await sql(`update chantiers set archived_at = now() where projet_id = ${q(P1)} and archived_at is null and etat in ('libre','a_trier','en_cours')`);
  const trop24 = await execSql(`select regler_autonome(${q(SLUG_A)}, null, null, true, 30) as r`);
  verifie("extinction automatique hors 0-24 h refusée", trop24.ok === false, trop24);
  await execSql(`select regler_autonome(${q(SLUG_A)}, null, null, true, 2) as r`);
  verifie("allumé « tout le temps » avec extinction à 2 h : réglage gardé", (await proj()).autonome_arret_vide_h === 2);
  verifie("rien à prendre → « vide », l'heure du premier constat est notée", (await constat()) === "vide" && !!(await proj()).autonome_vide_depuis);
  const cTravail = await creerChantier(P1, { titre: "Test constat : travail prêt", etat: "libre" });
  verifie("un chantier prêt → « travail », le compteur repart à zéro", (await constat()) === "travail" && (await proj()).autonome_vide_depuis === null);
  await sql(`update chantiers set archived_at = now() where id = ${q(cTravail)}`);
  await constat();
  await sql(`update projets set autonome_vide_depuis = now() - interval '3 hours' where id = ${q(P1)}`);
  verifie("rien depuis plus que le délai → « eteint_auto »", (await constat()) === "eteint_auto");
  const pe = await proj();
  verifie("éteint tout seul : plus « tout le temps », heure d'extinction notée", pe.autonome_toujours === false && pe.autonome_jusqu_a === null && !!pe.autonome_eteint_auto_at, pe);
  const msgAuto = await une(`select corps, chantier_id from messages where projet_id = ${q(P1)} and auteur = 'cockpit' and corps like 'Mode autonome éteint tout seul%' order by created_at desc limit 1`);
  verifie("le fil du projet le dit (message sans chantier)", !!msgAuto && msgAuto.chantier_id === null && /depuis 2 h/.test(msgAuto.corps), msgAuto);
  await execSql(`select regler_autonome(${q(SLUG_A)}, null, null, true, 0) as r`);
  verifie("rallumé à la main : l'extinction automatique est effacée", (await proj()).autonome_eteint_auto_at === null);
  await constat();
  await sql(`update projets set autonome_vide_depuis = now() - interval '30 hours' where id = ${q(P1)}`);
  verifie("extinction « jamais » (0) : reste allumé même vide depuis 30 h", (await constat()) === "vide" && (await proj()).autonome_toujours === true);
  const pirateConstat = await rpcUtilisateur("constater_autonome", { p_projet: SLUG_A }, jwt);
  verifie("constater_autonome : réservé aux sessions (un membre est refusé)", pirateConstat.status >= 400, pirateConstat);
  await execSql(`select regler_autonome(${q(SLUG_A)}, null) as r`);
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
      /SESSION CHEF de \S+ : lance [23] agent/.test(sortie) && sortie.includes(`SESSION CHEF de ${SLUG_A}`) && sortie.includes("Je lance le banc GPU de test ?") && sortie.includes("« Oui, ~0,9 $ »")
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
    // 0025 : la place libre restante peut servir un message libre du projet (« Répondre : … ») ;
    // ce qui compte ici : aucune des deux RÉPONSES n'est redonnée.
    const s2 = chef();
    verifie("reprise UNE seule fois : la passe suivante ne la redonne pas", /^RIEN/.test(s2) || !s2.includes("Fais ce que cette réponse annonce"), s2.slice(0, 600));
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

async function controle20_images_session() {
  section("20. Claude MONTRE une image (0020) : question, « Comment vérifier », fil — vrais scripts");
  const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dossier = mkdtempSync(join(tmpdir(), "verif-images-"));
  const png = join(dossier, "écran test.png");
  writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const txt = join(dossier, "notes.txt"); writeFileSync(txt, "pas une image");
  const env = { ...process.env, COCKPIT_PROJET: SLUG_A, COCKPIT_SESSION: "verifier-base" };
  const lancer = (script, args) => {
    try { return { code: 0, sortie: execFileSync("bash", [join(racine, "scripts", script), ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { code: e.status ?? 1, sortie: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  };
  const nMessages = async () => (await une(`select count(*)::int as n from messages where projet_id = ${q(P1)}`)).n;
  try {
    const c = await creerChantier(P1, { titre: "Images de test", etat: "en_cours" });
    const opts = ["--option", "Bleu|Le bouton devient bleu.|recommande", "--option", "Vert|Le bouton devient vert."];
    // Refus AVANT toute écriture.
    const avant = await nMessages();
    const rType = lancer("demander.sh", ["--chantier", c, "--question", "Quelle couleur ?", "--pourquoi", "Test.", ...opts, "--image", txt]);
    const rAbsent = lancer("demander.sh", ["--chantier", c, "--question", "Quelle couleur ?", "--pourquoi", "Test.", ...opts, "--image", join(dossier, "absent.png")]);
    const rTrop = lancer("demander.sh", ["--chantier", c, "--question", "Quelle couleur ?", "--pourquoi", "Test.", ...opts, ...Array(5).fill(["--image", png]).flat()]);
    verifie("demander.sh --image REFUSE un fichier qui n'est pas une image, absent, ou plus de 4, sans rien écrire",
      rType.code === 2 && rAbsent.code === 2 && rTrop.code === 2 && (await nMessages()) === avant, { rType, rAbsent, rTrop });
    // Question avec image.
    const rQ = lancer("demander.sh", ["--chantier", c, "--question", "Quelle couleur pour ce bouton ?", "--pourquoi", "Test.", ...opts, "--image", png]);
    const qm = await une(`select id, medias from messages where chantier_id = ${q(c)} and kind = 'question' order by created_at desc limit 1`);
    const m0 = qm?.medias?.[0];
    verifie("demander.sh --image : la question porte l'image (messages.medias, chemin du chantier, image/png)",
      rQ.code === 0 && qm?.medias?.length === 1 && m0.chemin.startsWith(`${P1}/${c}/`) && m0.type === "image/png" && m0.nom === "écran test.png" && m0.taille > 0, { rQ, qm });
    const luMembre = m0 ? await stockage(`authenticated/cockpit-medias/${m0.chemin}`, { jwt }) : null;
    verifie("un MEMBRE du projet lit l'image déposée par la session (droits du chantier)", luMembre?.status === 200, luMembre?.status);
    const luAnon = m0 ? await fetch(`${URL_}/storage/v1/object/authenticated/cockpit-medias/${m0.chemin}`, { headers: { apikey: CLE_PUBLIQUE } }) : null;
    verifie("un visiteur anonyme ne la lit PAS (stockage privé)", luAnon && luAnon.status >= 400, luAnon?.status);
    const depAnon = await fetch(`${URL_}/storage/v1/object/cockpit-medias/${P1}/${c}/${randomUUID()}-x.png`, { method: "POST", headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${CLE_PUBLIQUE}`, "Content-Type": "image/png" }, body: "x" });
    verifie("un visiteur anonyme ne DÉPOSE pas dans cockpit-medias", depAnon.status >= 400, depAnon.status);
    // « Comment vérifier » avec image.
    const rP0 = lancer("progression.sh", ["--chantier", c, "--etape", "en cours", "--image", png]);
    verifie("progression.sh --image hors --termine est refusé (il n'accompagne que « Comment vérifier »)", rP0.code === 2, rP0);
    const rP = lancer("progression.sh", ["--chantier", c, "--termine", "Livré (test)", "--verifier", "1. Ouvre la carte. 2. Tu dois voir un bouton bleu.", "--pas-en-ligne", "test", "--image", png]);
    const l = await chantier(c);
    verifie("progression.sh --termine … --image : chantiers.verifier_medias porte l'image, le chantier passe « à vérifier »",
      rP.code === 0 && l.etat === "a_verifier" && l.verifier_medias?.length === 1 && l.verifier_medias[0].chemin.startsWith(`${P1}/${c}/`), { rP: rP.sortie.slice(0, 400), l: { etat: l.etat, vm: l.verifier_medias } });
    const vu = await rest(`chantiers?id=eq.${c}&select=verifier_medias`, { jwt });
    verifie("le membre lit verifier_medias par l'API (ce que l'app affiche)", vu.status === 200 && vu.json?.[0]?.verifier_medias?.length === 1, vu);
    await sql(`update chantiers set etat = 'en_cours' where id = ${q(c)}`);
    lancer("progression.sh", ["--chantier", c, "--termine", "Relivré (test)", "--verifier", "1. Ouvre la carte.", "--pas-en-ligne", "test"]);
    verifie("un nouveau --termine SANS image efface les anciennes (périmées)", ((await chantier(c)).verifier_medias ?? []).length === 0);
    // Fil.
    const rE = lancer("media.sh", ["--envoyer", "--chantier", c, "--texte", "Voici l'écran actuel.", "--image", png, "--image", png]);
    const fm = await une(`select corps, auteur_type, kind, medias from messages where chantier_id = ${q(c)} and kind = 'info' and auteur_type = 'session' order by created_at desc limit 1`);
    verifie("media.sh --envoyer : un message de Claude dans le fil, avec ses 2 images",
      rE.code === 0 && fm?.corps === "Voici l'écran actuel." && fm.medias?.length === 2, { rE, fm });

    // §31 (0033, chantier e9a7c360) : une ACTION porte sa marche à suivre — lien exact, étapes, texte à copier.
    section("31. Une action manuelle porte sa marche à suivre (0033) : lien exact, étapes numérotées, texte à copier, jamais un secret");
    const act = ["--action", "--chantier", c, "--question", "Ajoute la clé dans les réglages", "--pourquoi", "Test."];
    const avantA = await nMessages();
    const rSans = lancer("demander.sh", [...act, "--etape", "Touche « New »"]);
    const rSansEt = lancer("demander.sh", [...act, "--lien", "https://github.com/settings/tokens|Jetons"]);
    const rAccueil = lancer("demander.sh", [...act, "--lien", "https://github.com/|GitHub", "--etape", "a"]);
    const rSecret = lancer("demander.sh", [...act, "--lien", "https://github.com/settings/tokens|Jetons", "--etape", "a", "--copier", "Clé|sk-ant-api03-abcdefghijklmnopqrstuvwxyz"]);
    const rBarre = lancer("demander.sh", [...act, "--lien", "https://github.com/settings/tokens|Jetons", "--etape", "a", "--copier", "texte sans libellé"]);
    verifie("demander.sh --action REFUSE sans lien, sans étape, un lien vers la page d'accueil, un secret à copier, un texte sans libellé — sans rien écrire",
      [rSans, rSansEt, rAccueil, rSecret, rBarre].every((r) => r.code === 2) && /--lien/.test(rSans.sortie) && (await nMessages()) === avantA,
      { rSans, rSansEt, rAccueil, rSecret, rBarre });
    const rA = lancer("demander.sh", [...act, "--lien", "https://github.com/settings/secrets/actions/new|Ouvrir les secrets", "--etape", "1. Dans « Name », colle le nom ci-dessous",
      "--etape", "Touche « Add secret »", "--copier", "Nom du secret|RUNPOD_API_KEY", "--image", png]);
    const am = await une(`select marche, medias from messages where chantier_id = ${q(c)} and kind = 'action' order by created_at desc limit 1`);
    verifie("demander.sh --action : messages.marche porte le lien, les étapes (sans numéro recopié) et le texte à copier, plus la capture",
      rA.code === 0 && am?.marche?.liens?.[0]?.url === "https://github.com/settings/secrets/actions/new" && am.marche.liens[0].libelle === "Ouvrir les secrets"
        && am.marche.etapes?.length === 2 && am.marche.etapes[0] === "Dans « Name », colle le nom ci-dessous"
        && am.marche.copier?.[0]?.texte === "RUNPOD_API_KEY" && am.medias?.length === 1, { rA, am });
    const rTel = lancer("demander.sh", [...act, "--sans-lien", "Geste sur le téléphone", "--etape", "Ouvre l'APK reçue"]);
    verifie("demander.sh --action --sans-lien \"pourquoi\" : accepté quand aucune page n'existe", rTel.code === 0, rTel);
    const lu = await rest(`messages?chantier_id=eq.${c}&kind=eq.action&select=marche&order=created_at.desc&limit=1`, { jwt });
    verifie("le membre lit messages.marche par l'API (ce que l'app affiche)", lu.status === 200 && Array.isArray(lu.json?.[0]?.marche?.etapes), lu);
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

async function controle24_ou_en_est() {
  section("24. « Où ça en est ? » (0023) : une seule demande en attente, droits, file, péremption, même délai que l'app");
  // Chemin navigateur : un MEMBRE du projet A (non admin) touche le bouton.
  const c = await creerChantier(P1, { titre: "Test où ça en est" });
  const r1 = await rpcUtilisateur("demander_ou_en_est", { p_chantier: c, p_par: "membre" }, jwt);
  verifie("un membre demande : HTTP 200, une demande neuve", r1.status === 200 && r1.json?.deja === false && !!r1.json?.id, r1);
  const m = await une(`select ou_en_est, auteur_type, kind, recu_at from messages where id = ${q(r1.json?.id)}`);
  verifie("la demande est marquée ou_en_est, écrite par l'utilisateur, jamais reçue encore", m?.ou_en_est === true && m.auteur_type === "utilisateur" && m.kind === "info" && m.recu_at === null, m);
  const r2 = await rpcUtilisateur("demander_ou_en_est", { p_chantier: c, p_par: "membre" }, jwt);
  verifie("deuxième toucher : la même demande rendue, rien d'écrit", r2.json?.deja === true && r2.json?.id === r1.json?.id, r2);
  // Dix touchers à la fois (double clic, deux appareils) : une seule ligne.
  const c2 = await creerChantier(P1, { titre: "Test dix touchers" });
  await Promise.all(Array.from({ length: 10 }, () => rpcUtilisateur("demander_ou_en_est", { p_chantier: c2, p_par: "membre" }, jwt)));
  verifie("dix touchers simultanés : UNE seule demande en base", (await une(`select count(*)::int as n from messages where chantier_id = ${q(c2)} and ou_en_est`)).n === 1);
  // Droits.
  const cB = await creerChantier(P2, { titre: "Test où ça en est, projet B" });
  const rB = await rpcUtilisateur("demander_ou_en_est", { p_chantier: cB, p_par: "pirate" }, jwt);
  verifie("non membre du projet : refusé (42501), rien d'écrit", rB.status >= 400 && rB.json?.code === "42501" && (await une(`select count(*)::int as n from messages where chantier_id = ${q(cB)}`)).n === 0, rB);
  const cI = await creerChantier(P1, { titre: "Test interne", visible: false });
  const rI = await rpcUtilisateur("demander_ou_en_est", { p_chantier: cI, p_par: "membre" }, jwt);
  verifie("chantier interne (invisible aux utilisateurs) : refusé", rI.status >= 400 && rI.json?.code === "42501", rI);
  for (const [fn, args] of [["prendre_ou_en_est", { p_branche: "agent/pirate", p_projet_id: P1 }], ["marquer_ou_en_est_recu", { p_ids: [r1.json?.id], p_par: "pirate" }],
    ["repondre_ou_en_est", { p_chantier: c, p_auteur: "pirate", p_texte: "faux" }], ["ou_en_est_sans_suite", { p_projet_id: P1 }]]) {
    const r = await rpcUtilisateur(fn, args, jwt);
    verifie(`${fn} : interdit à un utilisateur (sessions seulement)`, r.status >= 400, { status: r.status, json: r.json });
  }
  verifie("rien n'a été marqué reçu ni répondu par ces appels", (await une(`select recu_at from messages where id = ${q(r1.json?.id)}`)).recu_at === null
    && (await une(`select count(*)::int as n from messages where chantier_id = ${q(c)} and auteur_type = 'session'`)).n === 0);
  // Un chantier tenu (étape récente) n'est pas servi par la chef : sa session la reçoit par le hook.
  const cT = await creerChantier(P1, { titre: "Test tenu, où ça en est", etat: "en_cours" });
  await sql(`select signaler_activite(${q(SLUG_A)}, ${q(cT)}, 'claude/tenu-oe', 'au travail', 40, null, 'en_cours', null)`);
  await sql(`select demander_ou_en_est(${q(cT)}, 'Raphaël') as r`);
  const file = (await sql(`select chantier_id from ou_en_est_sans_suite(${q(P1)})`)).map((x) => x.chantier_id);
  verifie("sans personne dessus → dans la file de la chef, la plus ancienne d'abord", file[0] === c && file.includes(c2), file);
  verifie("tenu (étape en cours récente) → jamais dans la file de la chef", !file.includes(cT), file);
  verifie("tous projets (sans projet nommé) : jamais un projet de test", !(await sql(`select chantier_id from ou_en_est_sans_suite()`)).some((x) => x.chantier_id === c));
  // Péremption : sans réponse après le délai, on peut redemander.
  await sql(`update messages set created_at = now() - cockpit.delai_ou_en_est() - interval '1 minute' where id = ${q(r1.json?.id)}`);
  const r3 = await rpcUtilisateur("demander_ou_en_est", { p_chantier: c, p_par: "membre" }, jwt);
  verifie("périmée (> délai, sans réponse) : un toucher crée une nouvelle demande", r3.json?.deja === false && r3.json?.id !== r1.json?.id, r3);
  // Même délai que l'app (une seule règle, deux endroits : on les compare).
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const ts = (await import("node:fs")).readFileSync(join(racine, "app/src/lib/ouEnEst.ts"), "utf8");
  const m2 = ts.match(/DELAI_OU_EN_EST_MS = (\d+) \* 3600_000/);
  const base = (await une(`select extract(epoch from cockpit.delai_ou_en_est())::int as s`)).s;
  verifie("délai de l'app (DELAI_OU_EN_EST_MS) = délai de la base (delai_ou_en_est)", !!m2 && Number(m2[1]) * 3600 === base, { app: m2?.[1], base });
  const cV = await creerChantier(P1, { titre: "Test certifié", etat: "valide" });
  verifie("chantier certifié : rien à demander (refusé)", (await rpcUtilisateur("demander_ou_en_est", { p_chantier: cV, p_par: "membre" }, jwt)).status >= 400);
}

// 25. Chaque fil est une discussion (0025, chantier 450afa9e, Raphaël : « je
// pose des questions du type "je n'ai pas compris ta demande" et je n'ai pas
// de retour »). Un message libre attend une RÉPONSE ÉCRITE de Claude ; même
// règle dans l'app (lib/discussion.ts) et en base (est_message_libre).
async function controle26_fil_discussion() {
  section("26. Fil en discussion (0025) : un message libre attend une réponse écrite, même règle que l'app, droits");
  const c = await creerChantier(P1, { titre: "Test discussion", etat: "a_verifier" });
  const ins = async (o) => {
    const id = randomUUID();
    await sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, ou_en_est, medias, created_at, answered_at)
      values (${q(id)}, ${q(P1)}, ${q(o.chantier === undefined ? c : o.chantier)}, 'verifier-base', ${q(o.auteur_type ?? "proprietaire")}, ${q(o.kind ?? "info")}, ${q(o.corps)},
              ${o.ou_en_est ? "true" : "false"}, ${o.medias ? q(JSON.stringify(o.medias)) + "::jsonb" : "'[]'::jsonb"},
              now() - make_interval(secs => ${o.il_y_a ?? 0}), ${o.repondue_il_y_a != null ? `now() - make_interval(secs => ${o.repondue_il_y_a})` : "null"})`);
    return id;
  };
  // Un jeu de lignes couvrant chaque cas de la règle.
  const media = [{ chemin: "x/y.png", nom: "y.png", type: "image/png", taille: 1 }];
  await ins({ auteur_type: "session", kind: "question", corps: "Version courte ?", il_y_a: 900, repondue_il_y_a: 600 });
  await ins({ corps: "Je n'ai pas compris ta demande", il_y_a: 800 });
  await ins({ auteur_type: "utilisateur", corps: "Et pour moi ?", il_y_a: 790 });
  await ins({ auteur_type: "session", corps: "Réponse de Claude", il_y_a: 700 });
  await ins({ kind: "constat", corps: "Ça ne marche pas : le bouton", il_y_a: 650 });
  await ins({ kind: "constat", corps: "Ça fonctionne, je certifie.", il_y_a: 640 });
  await ins({ kind: "constat", corps: "Je ne sais pas dire si c’est bon : vérifie pour moi.", il_y_a: 630 });
  await ins({ corps: "Raphaël demande : où en est ce chantier ?", ou_en_est: true, il_y_a: 620 });
  await ins({ corps: "Doublon fusionné : « X »", il_y_a: 610 });
  await ins({ corps: "1 photo", medias: media, il_y_a: 590 }); // jointe à la réponse à la question (10 s après)
  await ins({ corps: "1 photo plus tard", medias: media, il_y_a: 60 });
  const lignes = await sql(`select m.id, m.auteur_type, m.kind, m.corps, m.ou_en_est, m.medias, m.chantier_id,
      to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
      to_char(m.answered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as answered_at,
      cockpit.est_message_libre(m) as libre_base from messages m where m.chantier_id = ${q(c)} order by m.created_at`);
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const { estMessageLibre } = await import(join(racine, "app/src/lib/discussion.ts"));
  const ecarts = lignes.filter((m) => estMessageLibre(m, lignes) !== m.libre_base).map((m) => ({ corps: m.corps, base: m.libre_base }));
  verifie(`même règle « message libre » dans l'app et en base (${lignes.length} lignes, chaque cas)`, lignes.length === 11 && ecarts.length === 0, ecarts);
  verifie("« je n'ai pas compris », Corriger, une photo seule : attendent une réponse ; boutons, où ça en est, doublon, photo de réponse : non",
    lignes.filter((m) => m.libre_base).map((m) => m.corps).join("|") === "Je n'ai pas compris ta demande|Et pour moi ?|Ça ne marche pas : le bouton|1 photo plus tard", lignes.filter((m) => m.libre_base).map((m) => m.corps));

  // Une étape ne suffit pas : il faut un message de Claude dans le fil.
  let sr = (await sql(`select * from messages_sans_reponse(${q(P1)}, null)`)).find((r) => r.chantier_id === c);
  verifie("sans réponse écrite depuis « Ça ne marche pas » : le fil est dans messages_sans_reponse (depuis son plus ancien)",
    !!sr && sr.nombre === 2 && (await une(`select corps from messages where id = ${q(sr.message_id)}`)).corps === "Ça ne marche pas : le bouton", sr);
  await sql(`select signaler_activite(${q(SLUG_A)}, ${q(c)}, 'claude/etape-seule', 'je travaille', 30, null, 'en_cours', null)`);
  await sql(`update chantiers set pris_par = null, pris_jusqu_a = null where id = ${q(c)}`);
  sr = (await sql(`select * from messages_sans_reponse(${q(P1)}, null)`)).find((r) => r.chantier_id === c);
  verifie("une simple étape signalée ne compte PAS comme une réponse", !!sr, sr);
  // Tenu par une AUTRE session vivante : c'est elle qui répond (hook), pas la chef.
  await sql(`insert into sessions (id, projet_id, branche, vu_at) values ('test-disc-${rand}', ${q(P1)}, 'claude/tient-disc', now())
             on conflict (id) do update set vu_at = now(), fin_at = null`);
  await sql(`update chantiers set pris_par = 'claude/tient-disc', pris_jusqu_a = now() + interval '30 minutes' where id = ${q(c)}`);
  verifie("tenu par une autre session vivante : pas dans la file de la chef",
    !(await sql(`select chantier_id from messages_sans_reponse(${q(P1)}, null)`)).some((r) => r.chantier_id === c));
  verifie("… mais la session qui le tient le voit à son démarrage (sa branche)",
    (await sql(`select chantier_id from messages_sans_reponse(${q(P1)}, 'claude/tient-disc')`)).some((r) => r.chantier_id === c));
  // La réponse : repondre_dans_fil (progression.sh --point) le sort de la liste, rattachée à son dernier message.
  const idRep = (await une(`select repondre_dans_fil(null, ${q(c)}, 'claude/tient-disc', 'Je regarde le bouton.') as id`)).id;
  const rep = await une(`select auteur_type, kind, repond_a, (select corps from messages where id = r.repond_a) as a from messages r where id = ${q(idRep)}`);
  verifie("repondre_dans_fil : un message de session, rattaché à la demande « où ça en est » en attente (sinon au dernier message)",
    rep?.auteur_type === "session" && rep.a === "Raphaël demande : où en est ce chantier ?", rep);
  verifie("après la réponse : plus rien n'attend dans ce fil",
    !(await sql(`select chantier_id from messages_sans_reponse(${q(P1)}, 'claude/tient-disc')`)).some((r) => r.chantier_id === c));
  // Un « Où ça en est ? » en attente : la réponse s'y rattache, et il est marqué reçu (0023 passe par la même fonction).
  const cO = await creerChantier(P1, { titre: "Test discussion, où ça en est", etat: "en_cours" });
  const dem = (await une(`select demander_ou_en_est(${q(cO)}, 'Raphaël') as r`)).r;
  const r2 = (await une(`select repondre_ou_en_est(${q(cO)}, 'claude/x', 'Fait : tout. Reste : rien.') as r`)).r;
  const lie = await une(`select m.repond_a, d.recu_at from messages m join messages d on d.id = ${q(dem.id)} where m.id = ${q(r2.id)}`);
  verifie("repondre_ou_en_est passe par repondre_dans_fil : rattachée à la demande, demande reçue", r2.demande === dem.id && lie?.repond_a === dem.id && !!lie.recu_at, { r2, lie });
  const cL = await creerChantier(P1, { titre: "Test discussion, sans demande", etat: "en_cours" });
  await ins({ chantier: cL, corps: "Premier", il_y_a: 20 });
  await ins({ chantier: cL, corps: "Dernier", il_y_a: 10 });
  const idL = (await une(`select repondre_dans_fil(null, ${q(cL)}, 'claude/x', 'Vu.') as id`)).id;
  verifie("sans « où ça en est » en attente : rattachée à son DERNIER message du fil",
    (await une(`select (select corps from messages where id = r.repond_a) as a from messages r where id = ${q(idL)}`))?.a === "Dernier");
  // Droits : tout est réservé aux sessions, sauf le prochain passage (lecture, membres).
  for (const [fn, args] of [["messages_sans_reponse", { p_projet_id: P1 }], ["reprendre_message", { p_branche: "agent/pirate", p_projet_id: P1 }],
    ["marquer_messages_recus", { p_ids: [idRep], p_par: "pirate" }], ["repondre_dans_fil", { p_projet: SLUG_A, p_chantier: c, p_auteur: "pirate", p_texte: "faux" }]]) {
    const r = await rpcUtilisateur(fn, args, jwt);
    verifie(`${fn} : interdit à un utilisateur (sessions seulement)`, r.status >= 400, { status: r.status, json: r.json });
  }
  await sql(`insert into chefs (projet_id, session_id, actif, reveil_trigger, reveil_minute) values (${q(P1)}, 'test-disc-${rand}', true, 'trig_test', 8)
             on conflict (projet_id) do update set reveil_trigger = 'trig_test', reveil_minute = 8, actif = true, session_id = excluded.session_id`);
  const pp = await rpcUtilisateur("prochain_passage_chef", { p_projet_id: P1 }, jwt);
  const quand = pp.json ? new Date(pp.json) : null;
  verifie("prochain_passage_chef : un membre lit le prochain réveil (minute 8, dans l'heure qui vient)",
    pp.status === 200 && !!quand && quand.getUTCMinutes() === 8 && quand > new Date() && quand - new Date() <= 3600_000, pp);
  const ppB = await rpcUtilisateur("prochain_passage_chef", { p_projet_id: P2 }, jwt);
  verifie("prochain_passage_chef : rien pour un projet dont il n'est pas membre", ppB.status === 200 && ppB.json === null, ppB);
  await sql(`delete from chefs where projet_id = ${q(P1)} and reveil_trigger = 'trig_test'`);
  await sql(`delete from sessions where id = 'test-disc-${rand}'`);
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
    && (await une(`select (select max_agents from chefs where projet_id = ${q(P3)}) as c, (select max_agents from chefs where projet_id = ${q(P4)}) as d`)).d === 2);
  const sortieC = lancer(SLUG_C, "chef-c");
  verifie("la consigne de la chef donne le modèle de chaque agent (Sonnet, jamais Haiku au plein gaz) et le frein", /\[model: sonnet\]/.test(sortieC) && !/\[model: haiku\]/.test(sortieC) && /rate_limit_info/.test(sortieC), sortieC.slice(0, 400));
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
  verifie("la passe de D sert D (2 places : réponse + vérification, prioritaire depuis 0046, avant le code libre), et rien de C", (sortieD.includes(libre.D) || sortieD.includes(verif.D)) && ![libre.C, rep.C, verif.C].some((id) => sortieD.includes(id)), sortieD.slice(0, 600));
  // Le hook de message : Raphaël écrit dans une session de D → elle devient chef de D, C garde la sienne.
  execFileSync("bash", [join(racine, "hooks/prompt-rappel.sh")],
    { encoding: "utf8", input: JSON.stringify({ session_id: "nouvelle-d", prompt: "fais ceci" }), env: { ...process.env, COCKPIT_PROJET: SLUG_D, CLAUDE_PROJECT_DIR: racine } });
  verifie("message de Raphaël dans une session de D → chef de D seulement (C inchangé)", await estChef(SLUG_D, "nouvelle-d") && await estChef(SLUG_C, "chef-c"));

  // La ROUTINE de réveil (30 sept.) : /fire ouvre une NOUVELLE session. Son prompt
  // (chef.sh --texte-routine) ne fait pas d'elle la chef par le hook de message, et
  // --releve : chef vivante → seulement ce qui attend ; chef morte → elle la remplace.
  const texteRoutine = lancer(SLUG_D, "x", ["--texte-routine"]);
  verifie("--texte-routine : dépôt absent → une ligne ; sinon chef.sh --releve",
    /n'est pas cloné ici/.test(texteRoutine) && texteRoutine.includes(`COCKPIT_PROJET=${SLUG_D} scripts/chef.sh --releve`), texteRoutine);
  execFileSync("bash", [join(racine, "hooks/prompt-rappel.sh")],
    { encoding: "utf8", input: JSON.stringify({ session_id: "fire-d", prompt: texteRoutine }), env: { ...process.env, COCKPIT_PROJET: SLUG_D, CLAUDE_PROJECT_DIR: racine } });
  verifie("le prompt de la routine ne fait pas de la session ouverte par /fire la chef (hook de message)", await estChef(SLUG_D, "nouvelle-d") && !(await estChef(SLUG_D, "fire-d")));
  const rep2 = await creerChantier(P4, { titre: "Réponse D2", etat: "bloque" });
  const m2 = await creerMessage(P4, rep2, { kind: "question", corps: "Question D2 ?" });
  await sql(`update messages set reponse = 'Oui', answered_at = now(), answered_by = ${q(userId)} where id = ${q(m2)}`);
  const libre2 = await creerChantier(P4, { titre: "Libre D2", etat: "libre", demande: "travail D2" });
  const releve = lancer(SLUG_D, "fire-d", ["--releve"]);
  verifie("--releve, chef vivante : RELÈVE qui sert la réponse en attente, pas le chantier libre, et ne vole pas la chef",
    releve.includes(`RELÈVE de ${SLUG_D}`) && releve.includes(rep2) && !releve.includes(libre2) && await estChef(SLUG_D, "nouvelle-d"), releve.slice(0, 600));
  await sql(`update chefs set vu_at = now() - interval '4 hours' where projet_id = ${q(P4)}`);
  const releve2 = lancer(SLUG_D, "fire-d2", ["--releve"]);
  verifie("--releve, chef morte : la session ouverte par /fire devient chef et fait la passe, sans toucher au réveil",
    await estChef(SLUG_D, "fire-d2") && releve2.includes("devient la SESSION CHEF") && releve2.includes(`SESSION CHEF de ${SLUG_D}`) && !/delete_trigger/.test(releve2), releve2.slice(0, 600));
  verifie("--releve dans la session chef : la passe normale", !/^RIEN — cette session n'est pas/.test(lancer(SLUG_D, "fire-d2", ["--releve"])));
}

// Un projet NEUF (F) pour les renforts : ses sections et ses chantiers seulement.
const P6 = randomUUID();
const SLUG_F = `test-verif-${rand}-f`;
async function controle25_renforts() {
  section("25. Renforts (0024) : une session par section, exclusivité par section, jamais deux renforts sur un chantier, projets de test jamais servis");
  await sql(`insert into projets (id, slug, nom, depot) values (${q(P6)}, ${q(SLUG_F)}, 'Projet de test F', 'rnab26/test-inexistant')`);
  const S1 = randomUUID(), S2 = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S1)}, ${q(P6)}, 'Écran', 1), (${q(S2)}, ${q(P6)}, 'Base', 2)`);
  const enSection = async (sec, titre, etat = "libre") => { const id = await creerChantier(P6, { titre, etat, demande: `travail ${titre}` }); if (sec) await sql(`update chantiers set section_id = ${q(sec)} where id = ${q(id)}`); return id; };
  const e1 = [await enSection(S1, "E1 a"), await enSection(S1, "E1 b"), await enSection(S1, "E1 c", "a_trier")];
  const b1 = await enSection(S2, "B1 libre");
  const b2 = await enSection(S2, "B2 vérif", "a_verifier");
  await sql(`update chantiers set verif_demandee_at = now() where id = ${q(b2)}`);
  const sans = await enSection(null, "Sans section libre");
  const cadrer = await enSection(S1, "E1 à cadrer", "a_cadrer");
  const aTester = await enSection(S2, "B à tester par Raphaël", "a_verifier");

  // Réglages : bornes en base (0 à 4 sessions, 1 à 5 agents).
  verifie("regler_renforts refuse 5 sessions et 6 agents (bornes : 0 à 4, 1 à 5)",
    !!(await erreurDe(`select regler_renforts(${q(SLUG_F)}, 5, 3)`)) && !!(await erreurDe(`select regler_renforts(${q(SLUG_F)}, 2, 6)`)));
  await sql(`select regler_renforts(${q(SLUG_F)}, 2, 2)`);
  const regl = await une(`select max_renforts, agents_par_renfort from chefs where projet_id = ${q(P6)}`);
  verifie("regler_renforts pose le réglage du projet (2 sessions, 2 agents), sans chef", regl?.max_renforts === 2 && regl?.agents_par_renfort === 2, regl);

  // L'attente par section : ce qui n'attend pas Raphaël seulement.
  const etat0 = (await une(`select etat_renforts(${q(SLUG_F)}) as e`)).e;
  // Un projet supprimé pendant que l'écran l'affiche : null, jamais une erreur (400 répétés dans l'app).
  verifie("etat_renforts d'un projet qui n'existe plus : null, pas une erreur",
    (await une(`select etat_renforts(${q(`test-verif-${rand}-disparu`)}) is null as ok`)).ok === true);
  const parSec = Object.fromEntries(etat0.attente.map((a) => [a.section, a]));
  verifie("attente : Écran 3 (libres + pas trié), Base 2 (libre + vérifie pour moi), Sans section 1",
    parSec["Écran"]?.n === 3 && parSec["Base"]?.n === 2 && parSec["Sans section"]?.n === 1 && etat0.attente.length === 3, etat0.attente);
  const tousIds = etat0.attente.flatMap((a) => a.ids);
  verifie("attente : jamais « à cadrer » ni « à tester » (ils attendent Raphaël)", !tousIds.includes(cadrer) && !tousIds.includes(aTester), tousIds);

  // Le bouton : une demande par section, la plus chargée d'abord, dans la limite.
  const d1 = (await une(`select demander_renforts(${q(SLUG_F)}) as d`)).d;
  verifie("demander_renforts : 2 demandes (Écran puis Base), la limite de 2 sessions respectée",
    d1.demandes.length === 2 && d1.demandes[0].section === "Écran" && d1.demandes[1].section === "Base" && d1.raison === null, d1);
  const d2 = (await une(`select demander_renforts(${q(SLUG_F)}) as d`)).d;
  verifie("deuxième clic : aucune nouvelle demande, raison « plein »", d2.demandes.length === 0 && d2.raison === "plein", d2);
  const rE = (await une(`select id from renforts where projet_id = ${q(P6)} and section_id = ${q(S1)}`)).id;
  const rB = (await une(`select id from renforts where projet_id = ${q(P6)} and section_id = ${q(S2)}`)).id;
  const doublon = await erreurDe(`insert into renforts (projet_id, section_id, prefixe) values (${q(P6)}, ${q(S1)}, 'renfort/doublon')`);
  verifie("une section = un seul renfort vivant (index unique)", !!doublon, doublon);
  const pr = await une(`select max_agents from renforts where id = ${q(rE)}`);
  verifie("chaque demande porte le réglage d'agents (2)", pr.max_agents === 2, pr);

  // Exclusivité : tant qu'un renfort tient une section, personne d'autre n'y prend.
  const prenAutre = (await sql(`select id from chantiers_prenables(${q(P6)}, 'agent/autre')`)).map((r) => r.id);
  verifie("chantiers_prenables d'une autre branche : rien dans Écran ni Base, le « sans section » oui",
    prenAutre.length === 1 && prenAutre[0] === sans, prenAutre);
  const verifAutre = (await sql(`select id from verifs_prenables(${q(P6)}, null)`)).map((r) => r.id);
  verifie("verifs_prenables (passe de la chef) : la vérif de Base n'est plus à elle", !verifAutre.includes(b2), verifAutre);

  // Projets de test : jamais servis à une chef.
  const aOuvrir = (await une(`select renforts_a_ouvrir(${q(SLUG_F)}) as r`)).r;
  const aOuvrirTest = (await une(`select renforts_a_ouvrir(${q(SLUG_F)}, true) as r`)).r;
  verifie("renforts_a_ouvrir : un projet de test ne donne RIEN à ouvrir (aucune vraie session)", aOuvrir.ouvrir.length === 0 && aOuvrir.archiver.length === 0, aOuvrir);
  verifie("renforts_a_ouvrir (mode test) : les 2 demandes, avec dépôt et agents", aOuvrirTest.ouvrir.length === 2 && aOuvrirTest.ouvrir[0].depot === "rnab26/test-inexistant" && aOuvrirTest.ouvrir[0].agents === 2, aOuvrirTest);
  const cockpitOuvrir = (await une(`select renforts_a_ouvrir('cockpit') as r`)).r;
  verifie("renforts_a_ouvrir du projet cockpit : aucune demande d'un projet de test", ![rE, rB].some((id) => JSON.stringify(cockpitOuvrir).includes(id)), cockpitOuvrir);

  // La chef note la session : actif.
  verifie("renfort_session : demande → actif", (await une(`select renfort_session(${q(rE)}, 'session_test_e') as ok`)).ok === true
    && (await une(`select statut from renforts where id = ${q(rE)}`)).statut === "actif");
  verifie("renfort_session ne se rejoue pas (déjà noté)", (await une(`select renfort_session(${q(rE)}, 'session_autre') as ok`))?.ok == null);

  // Le renfort prend SES chantiers, autant que de places (2), chacun à sa branche.
  const p1 = (await une(`select prochain_renfort(${q(rE)}) as r`)).r;
  const pris1 = p1.chantiers.map((c) => c.id);
  verifie("prochain_renfort : 2 chantiers (réglage 2 agents), tous de la section Écran",
    p1.etat === "chantiers" && pris1.length === 2 && pris1.every((id) => e1.includes(id)), p1);
  const branches = await sql(`select id, pris_par, etat from chantiers where id in (${pris1.map(q).join(",")})`);
  const prefixe = (await une(`select prefixe from renforts where id = ${q(rE)}`)).prefixe;
  verifie("chaque chantier réservé à SA branche <prefixe>/…, en cours", branches.every((b) => b.pris_par.startsWith(prefixe + "/") && b.etat === "en_cours")
    && new Set(branches.map((b) => b.pris_par)).size === 2, branches);
  const p2 = (await une(`select prochain_renfort(${q(rE)}) as r`)).r;
  verifie("places pleines : « attends » (2 en cours), rien de plus", p2.etat === "attends" && p2.en_cours === 2 && p2.chantiers.length === 0, p2);

  // L'autre renfort (Base) : sa section seulement, vérif comprise ; jamais un chantier d'Écran.
  await sql(`select renfort_session(${q(rB)}, 'session_test_b')`);
  const pb = (await une(`select prochain_renfort(${q(rB)}) as r`)).r;
  const prisB = pb.chantiers.map((c) => c.id).sort();
  verifie("le renfort Base prend B1 et la vérif B2 (marquée vérif), rien d'Écran",
    prisB.length === 2 && prisB.includes(b1) && prisB.includes(b2) && pb.chantiers.find((c) => c.id === b2)?.verif === true && !prisB.some((id) => e1.includes(id)), pb);
  const volB = await une(`select reserver_chantier(${q(pris1[0])}, ${q((await une(`select prefixe from renforts where id = ${q(rB)}`)).prefixe + "/vol")}, 60) as ok`);
  verifie("jamais deux renforts sur un même chantier : Base ne peut pas réserver un chantier tenu par Écran", volB.ok === false, volB);
  const tenus = await sql(`select pris_par from chantiers where projet_id = ${q(P6)} and pris_par like 'renfort/%' and pris_jusqu_a > now()`);
  verifie("aucun chantier tenu deux fois (une branche par chantier)", tenus.length === 4 && new Set(tenus.map((t) => t.pris_par)).size === 4, tenus);

  // Un agent finit : une place se libère → le chantier suivant ; puis tout fini → « fini ».
  await sql(`update chantiers set etat = 'a_verifier' where id = ${q(pris1[0])}`);
  const p3 = (await une(`select prochain_renfort(${q(rE)}) as r`)).r;
  const reste = e1.find((id) => !pris1.includes(id));
  verifie("une place libre → le 3e chantier d'Écran (le « pas trié »)", p3.etat === "chantiers" && p3.chantiers.length === 1 && p3.chantiers[0].id === reste && p3.chantiers[0].etat_avant === "a_trier", p3);
  await sql(`update chantiers set etat = 'a_verifier' where id in (${e1.map(q).join(",")})`);
  const p4 = (await une(`select prochain_renfort(${q(rE)}) as r`)).r;
  const fini = await une(`select statut, faits, fini_at from renforts where id = ${q(rE)}`);
  verifie("section vide et plus rien en cours → FINI, 3 chantiers faits", p4.etat === "fini" && fini.statut === "fini" && fini.faits === 3 && !!fini.fini_at, { p4, fini });
  await sql(`update renforts set fini_at = now() - interval '1 hour' where id = ${q(rE)}`); // 0038 : après le délai de grâce du projet
  const arch = (await une(`select renforts_a_ouvrir(${q(SLUG_F)}, true) as r`)).r.archiver;
  verifie("la chef voit le renfort fini à archiver (avec sa session)", arch.some((a) => a.id === rE && a.session === "session_test_e"), arch);
  verifie("renfort_archive : fini → archivé", (await une(`select renfort_archive(${q(rE)}) as ok`)).ok === true
    && (await une(`select statut from renforts where id = ${q(rE)}`)).statut === "archive");

  // Un renfort muet depuis 3 h rend sa section, et l'erreur se voit.
  await sql(`update renforts set vu_at = now() - interval '4 hours', created_at = now() - interval '5 hours' where id = ${q(rB)}`);
  await une(`select demander_renforts(${q(SLUG_F)}) as d`);
  const mort = await une(`select statut, erreur from renforts where id = ${q(rB)}`);
  const verifLibre = (await sql(`select id from verifs_prenables(${q(P6)}, null)`)).length;
  verifie("renfort muet depuis 3 h → « erreur » visible, il ne tient plus sa section", mort.statut === "erreur" && /signe de vie/.test(mort.erreur ?? "") && verifLibre === 0, { mort, verifLibre });
  const etat1 = (await une(`select etat_renforts(${q(SLUG_F)}) as e`)).e;
  verifie("etat_renforts montre l'erreur et le fini (24 h)", etat1.renforts.some((r) => r.id === rB && r.statut === "erreur") && etat1.renforts.some((r) => r.id === rE && r.statut === "archive"), etat1.renforts);
  const nouv = etat1.renforts.find((r) => r.statut === "demande");
  if (nouv) {
    verifie("renfort_erreur : l'ouverture ratée se voit (texte gardé)", (await une(`select renfort_erreur(${q(nouv.id)}, 'create_session refusé') as ok`)).ok === true
      && (await une(`select erreur from renforts where id = ${q(nouv.id)}`)).erreur === "create_session refusé");
  } else verifie("une nouvelle demande a suivi le clic (sections rendues)", false, etat1);
  await sql(`select regler_renforts(${q(SLUG_F)}, 0, 2)`);
  const zero = (await une(`select demander_renforts(${q(SLUG_F)}) as d`)).d;
  verifie("réglage à 0 : aucune demande, raison « reglage_zero »", zero.demandes.length === 0 && zero.raison === "reglage_zero", zero);

  // Droits : un membre (non admin) ne voit ni ne demande rien ; les fonctions de session lui sont fermées.
  await sql(`insert into membres (projet_id, user_id) values (${q(P6)}, ${q(userId)}) on conflict do nothing`);
  const mEtat = await rpcUtilisateur("etat_renforts", { p_projet: SLUG_F }, jwt);
  const mDem = await rpcUtilisateur("demander_renforts", { p_projet: SLUG_F }, jwt);
  const mProch = await rpcUtilisateur("prochain_renfort", { p_renfort: rB }, jwt);
  const mLit = await rest(`renforts?select=id&projet_id=eq.${P6}`, { jwt });
  const aProch = await rpcUtilisateur("renforts_a_ouvrir", { p_projet: SLUG_F }, CLE_PUBLIQUE);
  verifie("un membre : etat_renforts / demander_renforts refusés, prochain_renfort fermé, table renforts vide",
    mEtat.status >= 400 && mDem.status >= 400 && mProch.status >= 400 && Array.isArray(mLit.json) && mLit.json.length === 0, { mEtat, mDem, mProch, mLit });
  verifie("anon : renforts_a_ouvrir refusé", aProch.status >= 400, aProch);

  // Les scripts de bout en bout, dans une copie jetable (sa propre marque .git).
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const copie = mkdtempSync(join(tmpdir(), "renfort-test-"));
  try {
    execFileSync("git", ["init", "-q", copie]);
    execFileSync("ln", ["-s", join(racine, "scripts"), join(copie, "scripts")]);
    execFileSync("ln", ["-s", join(racine, "hooks"), join(copie, "hooks")]);
    await sql(`select regler_renforts(${q(SLUG_F)}, 1, 1)`);
    await sql(`update renforts set statut = 'erreur' where projet_id = ${q(P6)} and statut in ('demande', 'actif')`);
    const s3 = await enSection(S1, "E1 d");
    const dd = (await une(`select demander_renforts(${q(SLUG_F)}) as d`)).d;
    const rid = dd.demandes[0]?.id;
    const env = { ...process.env, COCKPIT_PROJET: SLUG_F, CLAUDE_PROJECT_DIR: copie };
    const renfort = (args) => execFileSync("bash", [join(copie, "scripts/renfort.sh"), ...args], { encoding: "utf8", env, cwd: copie });
    renfort(["--session", rid, "session_test_script"]);
    execFileSync("bash", [join(copie, "hooks/prompt-rappel.sh")], { encoding: "utf8", env, cwd: copie,
      input: JSON.stringify({ session_id: "session-renfort-p", prompt: "[cockpit-renfort] Tu es un RENFORT du cockpit" }) });
    verifie("la consigne d'ouverture « [cockpit-renfort] … » ne rend pas la session chef (avant même la marque)",
      (await une(`select est_chef(${q(SLUG_F)}, 'session-renfort-p') as c`)).c === false);
    const out = renfort(["--suivant", rid]);
    const marque = execFileSync("cat", [join(copie, ".git/cockpit-renfort")], { encoding: "utf8" }).trim();
    verifie("renfort.sh --suivant : consigne « RENFORT : lance 1 agent », le chantier d'Écran, sa branche, la marque posée",
      out.startsWith("RENFORT : lance 1 agent") && out.includes(s3) && out.includes("--suivant " + rid) && marque === rid, out.slice(0, 500));
    execFileSync("bash", [join(copie, "hooks/prompt-rappel.sh")], { encoding: "utf8", env, cwd: copie,
      input: JSON.stringify({ session_id: "session-renfort-e", prompt: "fais ceci" }) });
    const devenu = await une(`select est_chef(${q(SLUG_F)}, 'session-renfort-e') as c`);
    verifie("une session renfort (marque posée) ne devient JAMAIS chef, même sur un message", devenu.c === false, devenu);
    const stop = execFileSync("bash", [join(copie, "hooks/autonome.sh")], { encoding: "utf8", env, cwd: copie,
      input: JSON.stringify({ hook_event_name: "Stop", session_id: "session-renfort-e" }) });
    verifie("hook Stop d'un renfort qui attend son agent : ne bloque pas, ne prend rien d'autre", stop.trim() === "", stop);
    await sql(`update chantiers set etat = 'a_verifier' where id = ${q(s3)}`);
    const fin = renfort(["--suivant", rid]);
    verifie("renfort.sh --suivant, section vide : « FINI »", fin.startsWith("FINI"), fin);
    // Consigne de la chef : faux sql.sh qui répond « tu es la chef, 3/3 agents » et une demande à ouvrir.
    const faux = join(copie, "faux-sql.sh");
    writeFileSync(faux, [
      "#!/usr/bin/env bash", 'if [ $# -gt 0 ]; then r="$1"; else r="$(cat)"; fi', 'case "$r" in',
      `  *"left join chefs c on c.projet_id"*) echo '{"ok":true,"rows":[{"projet_id":"${P6}","slug":"${SLUG_F}","depot":"rnab26/test-inexistant","session_id":"chef-f","max_agents":3,"agents":3,"autonome":false}]}' ;;`,
      `  *"update chefs set"*) echo '{"ok":true,"rows":null}' ;;`,
      `  *"renforts_a_ouvrir"*) echo '{"ok":true,"rows":[{"r":{"ouvrir":[{"id":"${rid}","section":"Écran","chantiers":3,"agents":2,"slug":"${SLUG_F}","depot":"rnab26/test-inexistant"}],"archiver":[{"id":"${rB}","session":"session_test_b","section":"Base","statut":"fini"}]}}]}' ;;`,
      `  *) echo '{"ok":true,"rows":[]}' ;;`, "esac", "",
    ].join("\n"), { mode: 0o755 });
    const chef = execFileSync("bash", [join(racine, "scripts/chef.sh")], { encoding: "utf8", env: { ...env, COCKPIT_SQL: faux, CLAUDE_CODE_SESSION_ID: "chef-f" } });
    verifie("chef.sh, aucune place d'agent : les gestes de renfort, et PAS « RIEN » (défaut du brouillon corrigé)",
      !chef.startsWith("RIEN") && chef.includes(`Renfort · ${SLUG_F} · Écran — ne pas toucher`) && chef.includes('"cockpit-renfort"')
        && chef.includes("[cockpit-renfort]") && chef.includes(`--session ${rid}`) && chef.includes('archive_session("session_test_b")') && chef.includes(`--archive ${rB}`), chef);
  } finally { rmSync(copie, { recursive: true, force: true }); }
}

// 21. Aucun banc ne laisse rien dans un projet RÉEL (29 sept. 2026 : « [TEST
// verifier-embed …] tri des clients » dans le cockpit de Raphaël, qui ne savait
// pas s'il devait y répondre). Les bancs travaillent dans des projets `test-…`
// (scripts/bancs.mjs) ; ce contrôle rougit si une ligne « [TEST… » vit ailleurs.
// 23. « À toi » toujours à jour (0022, Raphaël : « des requêtes d'il y a 12 h déjà
// répondues dans la session ; ça se marche dessus »). Projet NEUF (E) : rien des autres sections.
const P5 = randomUUID(), SLUG_E = `test-verif-${rand}-e`;
async function controle23_a_toi_a_jour() {
  section("23. « À toi » à jour (0022) : sans objet retiré seul, revue des vieux et des dépassés, vrais scripts");
  await sql(`insert into projets (id, slug, nom) values (${q(P5)}, ${q(SLUG_E)}, 'Projet de test E')`);
  const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
  const env = { ...process.env, COCKPIT_PROJET: SLUG_E, COCKPIT_SESSION: "verifier-base" };
  const lancer = (script, args) => {
    try { return { code: 0, sortie: execFileSync("bash", [join(racine, "scripts", script), ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { code: e.status ?? 1, sortie: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  };
  const ilYa = (h) => `now() - interval '${h} hours'`;
  const message = (id) => une(`select answered_at, reponse, confirmee_at from messages where id = ${q(id)}`);
  const revoir = async () => (await une(`select a_toi_a_revoir(${q(P5)}) as l`)).l ?? [];

  // 1. Sans objet : les fusions qui citent un chantier certifié ou archivé se ferment seules ;
  //    ses questions ouvertes seulement à l'archivage (0026 : certifier les GARDE, voir §27).
  const cc = await creerChantier(P5, { titre: "Certifié bientôt", etat: "a_verifier" });
  const cAutre = await creerChantier(P5, { titre: "Autre sujet", etat: "libre" });
  const qc = await creerMessage(P5, cc, { kind: "question", corps: "On garde le bleu ?" });
  const fu = await une(`select suggerer_fusion(${q(cAutre)}, ${q(cc)}, 'test', 'verifier-base') as id`);
  await sql(`select certifier_chantier(${q(cc)}, 'raphael')`);
  const mq = await message(qc), mf = await message(fu.id);
  verifie("certifié → sa question ouverte RESTE ouverte (0026 : elle peut porter sur la suite)",
    !mq.answered_at && mq.reponse === null, mq);
  verifie("certifié → la fusion proposée qui le cite est « sans objet »", !!mf.answered_at && /^Sans objet/.test(mf.reponse ?? ""), mf);
  const ca = await creerChantier(P5, { titre: "Archivé bientôt", etat: "bloque" });
  const qa = await creerMessage(P5, ca, { kind: "action", corps: "Colle la clé" });
  const qRep = await creerMessage(P5, ca, { kind: "question", corps: "Déjà répondue" });
  await sql(`update messages set answered_at = now() - interval '1 hour', reponse = 'Oui' where id = ${q(qRep)}`);
  await sql(`update chantiers set archived_at = now() where id = ${q(ca)}`);
  const ma = await message(qa), mr = await message(qRep);
  verifie("archivé → son action ouverte est retirée ; une réponse déjà donnée n'est pas touchée",
    /^Retirée automatiquement : chantier archivé/.test(ma.reponse ?? "") && mr.reponse === "Oui", { ma, mr });

  // 2. a_toi_a_revoir : la même règle que l'app (lib/entonnoir.ts).
  const cQ = await creerChantier(P5, { titre: "Couleur du bouton d'accueil", etat: "libre" });
  const qVieille = await creerMessage(P5, cQ, { kind: "question", corps: "Bleu ou vert ?" });
  await sql(`update messages set created_at = ${ilYa(13)} where id = ${q(qVieille)}`);
  const qNeuve = await creerMessage(P5, cQ, { kind: "question", corps: "Et la taille ?" });
  const cB = await creerChantier(P5, { titre: "Envoi des factures clients", etat: "bloque" });
  const b = await creerMessage(P5, cB, { kind: "blocage", corps: "Il manque la clé" });
  await sql(`update messages set created_at = ${ilYa(1)} where id = ${q(b)}`);
  await creerMessage(P5, cB, { kind: "info", corps: "Clé trouvée dans l'autre session" });
  const cV = await creerChantier(P5, { titre: "Page de connexion", etat: "a_verifier" });
  await sql(`update chantiers set livre_at = ${ilYa(1)} where id = ${q(cV)}`);
  const fin = await creerMessage(P5, cV, { kind: "info", corps: "Livré" });
  await sql(`update messages set created_at = ${ilYa(1)} + interval '1 minute' where id = ${q(fin)}`);
  const cTenu = await creerChantier(P5, { titre: "Tenu par une session", etat: "bloque" });
  await sql(`update chantiers set pris_par = 'claude/x', pris_jusqu_a = now() + interval '1 hour' where id = ${q(cTenu)}`);
  const bT = await creerMessage(P5, cTenu, { kind: "blocage", corps: "Attend une clé" });
  await sql(`update messages set created_at = ${ilYa(20)} where id = ${q(bT)}`);
  // Un UPDATE remet updated_at à maintenant (trigger tracer_chantier) : le vieux « à cadrer » naît vieux.
  const cD1 = randomUUID();
  await sql(`insert into chantiers (id, projet_id, titre, etat, created_at, updated_at) values (${q(cD1)}, ${q(P5)}, 'Export des factures en PDF', 'a_cadrer', ${ilYa(30)}, ${ilYa(30)})`);
  const cD2 = await creerChantier(P5, { titre: "Export PDF des factures", etat: "a_verifier" });
  let l = await revoir();
  const par = (id) => l.find((e) => e.id === id);
  verifie("revue : une question de plus de 12 h y est, la question récente non", !!par(qVieille) && par(qVieille).heures >= 12 && !par(qNeuve), l.map((e) => e.id));
  verifie("revue : un bloqué suivi de travail y est, avec « avancé depuis »", !!par(cB)?.avance_depuis, par(cB));
  verifie("revue : le message de livraison (1 min après) ne compte pas comme « avancé »", !par(cV));
  verifie("revue : un chantier qu'une session tient encore n'y est pas (c'est à elle)", !par(cTenu) && (await sql(`select 1 from chantiers where id = ${q(cTenu)} and pris_jusqu_a > now()`)).length === 1);
  verifie("revue : un vieux « à cadrer » y est (30 h)", par(cD1)?.heures >= 29, par(cD1));
  verifie("revue : le doublon probable est signalé (« proche »)", par(cD1)?.proche?.id === cD2, par(cD1)?.proche);
  const refus = await rpcUtilisateur("a_toi_a_revoir", { p_projet: P5 }, jwt);
  verifie("a_toi_a_revoir : refusée à un utilisateur connecté (service seulement)", refus.status >= 400, refus.status);

  // 3. Les gestes de la revue, par les vrais scripts.
  const rC = lancer("demander.sh", ["--confirmer", cD1]);
  const vu = await chantier(cD1);
  l = await revoir();
  verifie("demander.sh --confirmer <chantier> : a_toi_revu_at posé, il quitte la revue", rC.code === 0 && !!vu.a_toi_revu_at && !par(cD1), { rC, a: vu.a_toi_revu_at });
  const cR13 = randomUUID(), cR25 = randomUUID();
  for (const [id, h] of [[cR13, 13], [cR25, 25]])
    await sql(`insert into chantiers (id, projet_id, titre, etat, created_at, updated_at, a_toi_revu_at) values (${q(id)}, ${q(P5)}, 'Confirmé il y a ${h} h', 'a_cadrer', ${ilYa(30)}, ${ilYa(30)}, ${ilYa(h)})`);
  l = await revoir();
  verifie("revue : un élément confirmé il y a 13 h ne revient pas (24 h, 0034) ; confirmé il y a 25 h, si", !par(cR13) && !!par(cR25), l.map((e) => e.titre));
  const rD = lancer("demander.sh", ["--debloquer", cB, "Clé trouvée"]);
  const db = await chantier(cB);
  const dm = await une(`select corps from messages where chantier_id = ${q(cB)} order by created_at desc limit 1`);
  verifie("demander.sh --debloquer : « libre », message dans le fil", rD.code === 0 && db.etat === "libre" && dm.corps === "Plus bloqué : Clé trouvée", { rD, etat: db.etat, dm });
  const rD2 = lancer("demander.sh", ["--debloquer", cQ, "x"]);
  verifie("demander.sh --debloquer refuse un chantier qui n'est pas bloqué", rD2.code === 1, rD2);
  const rR = lancer("demander.sh", ["--retirer", qVieille, "Déjà répondu dans la session"]);
  verifie("demander.sh --retirer : la vieille question quitte la revue", rR.code === 0 && !(await revoir()).some((e) => e.id === qVieille), rR);
  await sql(`update messages set created_at = ${ilYa(14)} where id = ${q(qNeuve)}`);
  const ap = lancer("revue-a-toi.sh", ["--apercu"]);
  verifie("revue-a-toi.sh --apercu : la consigne cite l'élément et les gestes, sans rien marquer",
    ap.code === 0 && ap.sortie.includes(qNeuve) && ap.sortie.includes("--retirer") && ap.sortie.includes("--suggerer-fusion")
      && (await une(`select revue_a_toi_at from projets where id = ${q(P5)}`)).revue_a_toi_at === null, ap.sortie.slice(0, 300));
  const r1 = lancer("revue-a-toi.sh", []), r2 = lancer("revue-a-toi.sh", []);
  verifie("revue-a-toi.sh : une revue, puis « déjà revu » pendant 24 h (0035)", r1.code === 0 && !r1.sortie.startsWith("RIEN") && r2.sortie.startsWith("RIEN") && /moins de 24 h/.test(r2.sortie), { r1: r1.sortie.slice(0, 120), r2: r2.sortie });
}

async function controle21_aucun_reste_de_test() {
  section("21. aucun reste de test dans un projet réel");
  const r = await restesDansLesVraisProjets(sql);
  verifie("aucun chantier, message, étape, session ou tâche « [TEST… » dans un projet réel", r.total === 0, r);
  verifie("la règle « projet de test » des bancs = cockpit.projet_de_test (base)",
    (await une(`select projet_de_test('test-embed-x') and projet_de_test('test-web-x') and projet_de_test('test-verif-x') and not projet_de_test('cockpit') and not projet_de_test('testeur') as ok`)).ok === true);
}

// 22. Section « Correctifs » rangée toute seule (0021, chantier ea21b577).
// La règle elle-même (table de cas) : scripts/verifier-correctifs.mjs.
async function controle22_correctifs() {
  section("22. Correctifs : un correctif visuel est rangé tout seul, à la création, par toutes les voies (0021)");
  const secDe = async (id) => (await une(`select s.nom from chantiers c left join sections s on s.id = c.section_id where c.id = ${q(id)}`))?.nom ?? null;
  const avant = (await une(`select count(*)::int as n from sections where projet_id = ${q(P2)} and cle = 'correctifs'`)).n;
  const c1 = await creerChantier(P2, { titre: "Bouton décalé sur mobile" });
  verifie("session (SQL) : « Bouton décalé sur mobile » → section Correctifs, créée si besoin", avant === 0 && await secDe(c1) === "Correctifs");
  const c2 = await creerChantier(P2, { titre: "Texte qui déborde de la carte" });
  verifie("un deuxième correctif réutilise la MÊME section (pas de doublon)", await secDe(c2) === "Correctifs"
    && (await une(`select count(*)::int as n from sections where projet_id = ${q(P2)} and cle = 'correctifs'`)).n === 1);
  const c3 = await creerChantier(P2, { titre: "Nouvelle fonctionnalité : export", demande: "avec un joli design" });
  verifie("un gros chantier n'y va pas (reste sans section, la session le range)", await secDe(c3) === null);
  const c4 = await creerChantier(P2, { titre: "Problème page panier", demande: "le texte déborde", origine: "utilisateur" });
  verifie("utilisateur final (module embarqué) : la demande décrit un défaut visuel → Correctifs", await secDe(c4) === "Correctifs");
  const sid = (await une(`select ranger_chantier(${q(c1)}, 'Application', 'claude/test') as s`)).s;
  await sql(`update chantiers set titre = 'Bouton décalé sur mobile (bis)' where id = ${q(c1)}`);
  verifie("la session corrige le tri avec --ranger, et une mise à jour ne le défait pas", sid && await secDe(c1) === "Application");
  // Un membre (non admin) crée depuis l'app : il n'a pas le droit d'écrire dans sections, le trigger le fait pour lui.
  const cree = await rest("chantiers", { methode: "POST", jwt, prefer: "return=representation",
    corps: { projet_id: P1, titre: "Couleurs illisibles en mode sombre", etat: "a_trier", origine: "utilisateur" } });
  const cm = cree.json?.[0]?.id;
  verifie("app, membre non admin : son correctif est rangé dans Correctifs du projet A", cree.status === 201 && cm && await secDe(cm) === "Correctifs", cree);
  // Chantiers ouverts existants sans section : rangés d'un appel, jamais un chantier déjà rangé ni un certifié.
  // « Existants » : créés avant 0021, donc sans section. Le trigger ne joue qu'à l'insertion :
  // on les crée puis on leur retire la section (jamais de désactivation du trigger, table partagée).
  const e1 = await creerChantier(P2, { titre: "Marges trop grandes", etat: "libre" });
  const e2 = await creerChantier(P2, { titre: "Police trop petite", etat: "valide" });
  const e3 = await creerChantier(P2, { titre: "Espacement des tuiles", etat: "libre" });
  await sql(`update chantiers set section_id = null where id in (${q(e1)}, ${q(e2)}, ${q(e3)})`);
  await sql(`select ranger_chantier(${q(e3)}, 'Écran', 'claude/test') as s`);
  const ranges = (await sql(`select ranger_correctifs(${q(SLUG_B)}, 'claude/test') as id`)).map((r) => r.id);
  verifie("ranger_correctifs : l'ouvert sans section est rangé ; le certifié et le déjà rangé ne bougent pas",
    ranges.length === 1 && ranges[0] === e1 && await secDe(e1) === "Correctifs" && await secDe(e2) === null && await secDe(e3) === "Écran", ranges);
  const pirate = await rpcUtilisateur("ranger_correctifs", { p_projet: SLUG_A }, jwt);
  verifie("ranger_correctifs avec un JWT de membre non admin → refusé", pirate.status >= 400, pirate);
  const anon = await rest("rpc/section_correctifs", { methode: "POST", jwt, corps: { p_projet: P1 } });
  verifie("section_correctifs n'est pas appelable par un utilisateur", anon.status >= 400, anon);
}

// 27. Certifier ne fait plus disparaître une question ouverte (0026, 29 sept. 2026 :
// la question 876ad67b sur le « réveil immédiat » fermée seule en certifiant 450afa9e).
// Projet NEUF (G) : reprendre_reponse ne sert que lui.
const P7 = randomUUID(), SLUG_G = `test-verif-${rand}-g`;
async function controle27_question_gardee() {
  section("27. Certifier garde une question ouverte (0026) ; sa réponse est reprise sans rouvrir le certifié");
  await sql(`insert into projets (id, slug, nom) values (${q(P7)}, ${q(SLUG_G)}, 'Projet de test G')`);
  const message = (id) => une(`select chantier_id, answered_at, reponse from messages where id = ${q(id)}`);
  const cc = await creerChantier(P7, { titre: "Fil en discussion", etat: "a_verifier" });
  const cAutre = await creerChantier(P7, { titre: "Même sujet ailleurs", etat: "libre" });
  const qo = await creerMessage(P7, cc, { kind: "question", corps: "Je réveille Claude tout de suite quand tu écris ?" });
  const ac = await creerMessage(P7, cc, { kind: "action", corps: "Crée le jeton de la routine" });
  const fu = await une(`select suggerer_fusion(${q(cAutre)}, ${q(cc)}, 'test', 'verifier-base') as id`);
  await sql(`select certifier_chantier(${q(cc)}, 'raphael')`);
  const [mq, ma, mf] = [await message(qo), await message(ac), await message(fu.id)];
  verifie("certifié : la question ET l'action ouvertes restent ouvertes, sur le chantier certifié",
    !mq.answered_at && !ma.answered_at && mq.chantier_id === cc && (await chantier(cc)).etat === "valide", { mq, ma });
  verifie("certifié : la fusion qui le cite est toujours « sans objet »", !!mf.answered_at && /^Sans objet : chantier certifié/.test(mf.reponse ?? ""), mf);
  // Il répond plus tard, depuis l'app (answered_by = lui) : sa réponse est reprise.
  await sql(`update messages set reponse = 'Oui, tout de suite', answered_at = now(), answered_by = ${q(userId)} where id = ${q(qo)}`);
  const sansSuite = await sql(`select message_id, chantier_id from reponses_sans_suite(${q(P7)})`);
  verifie("réponse sur un chantier CERTIFIÉ : « sans suite » (plus écartée)", sansSuite.some((r) => r.message_id === qo), sansSuite);
  const br = `agent/reponse-verif-${rand}`;
  const rp = (await une(`select reprendre_reponse(${q(br)}, ${q(P7)}) as r`)).r;
  const suite = rp?.id ? await chantier(rp.id) : null;
  const apres = await chantier(cc);
  verifie("reprise : un chantier « Suite de ta réponse » neuf, en cours, réservé à l'agent",
    !!suite && suite.id !== cc && suite.etat === "en_cours" && suite.pris_par === br && /^Suite de ta réponse/.test(suite.titre)
      && /Sur le chantier certifié « Fil en discussion »/.test(suite.demande ?? ""), { rp, suite });
  verifie("reprise : le chantier certifié n'est JAMAIS rouvert ni réservé", apres.etat === "valide" && apres.pris_par === null, apres);
  verifie("reprise : la question suit dans le nouveau chantier ; l'action ouverte reste sur le certifié",
    (await message(qo)).chantier_id === rp?.id && (await message(ac)).chantier_id === cc);
  const note = await une(`select corps from messages where chantier_id = ${q(cc)} and auteur_type = 'session' and kind = 'info' order by created_at desc limit 1`);
  verifie("reprise : le fil du certifié dit où ça continue", /continue dans le chantier « Suite de ta réponse/.test(note?.corps ?? ""), note);
  verifie("reprise : rien de plus à reprendre ensuite (pas de boucle)", (await une(`select reprendre_reponse(${q(br + "-2")}, ${q(P7)}) as r`)).r === null);
  // La revue de « À toi » voit aussi l'action gardée (le certifié est archivé « Fini »).
  await sql(`update messages set created_at = now() - interval '13 hours' where id = ${q(ac)}`);
  const revue = (await une(`select a_toi_a_revoir(${q(P7)}) as l`)).l ?? [];
  verifie("a_toi_a_revoir : l'action gardée sur le certifié y est (plus de 12 h)", revue.some((e) => e.id === ac), revue.map((e) => e.id));
  // Archiver sans certifier (le sujet est abandonné) ferme toujours une question ouverte.
  const cAr = await creerChantier(P7, { titre: "Abandonné", etat: "libre" });
  const qAr = await creerMessage(P7, cAr, { kind: "question", corps: "Plus utile ?" });
  await sql(`update chantiers set archived_at = now() where id = ${q(cAr)}`);
  verifie("archivé sans certifier : sa question ouverte est retirée (sans objet)", /^Retirée automatiquement : chantier archivé/.test((await message(qAr)).reponse ?? ""));
  const droits = await une(`select has_function_privilege('anon', 'cockpit.reprendre_reponse(text,uuid)', 'execute') as a,
                                   has_function_privilege('authenticated', 'cockpit.reponses_sans_suite(uuid,text)', 'execute') as b,
                                   has_function_privilege('authenticated', 'cockpit.retirer_sans_objet()', 'execute') as c`);
  verifie("droits : ni anon ni un utilisateur connecté n'exécutent ces fonctions", droits && !droits.a && !droits.b && !droits.c, droits);
}

// ------------------------------------------------------------------ 37
async function controle37_accuse_action() {
  section("37. « Fait » à une carte d'ACTION ne lance rien (0041) : une règle, lue par reponses_sans_suite et donc par reprendre_reponse");
  const marche = JSON.stringify({ liens: [{ url: "https://example.com/pr/1", libelle: "La PR" }], etapes: ["Clique sur « Merge »"] });
  const repondre = (id, reponse, precision = null) => sql(`update messages set reponse = ${q(reponse)}, precision = ${precision ? q(precision) : "null"}, answered_at = now(), answered_by = ${q(userId)} where id = ${q(id)}`);
  const carte = async (c, corps) => { const id = await creerMessage(P1, c, { kind: "action", corps }); await sql(`update messages set marche = ${q(marche)}::jsonb where id = ${q(id)}`); return id; };
  const cAcc = await creerChantier(P1, { titre: "Chantier livré, PR à fusionner", etat: "a_verifier" });
  const aFait = await carte(cAcc, "Fusionne la PR 1 : test");
  const cPrec = await creerChantier(P1, { titre: "Action avec précision", etat: "a_verifier" });
  const aPrec = await carte(cPrec, "Fusionne la PR 2 : test");
  const cMed = await creerChantier(P1, { titre: "Action avec capture", etat: "a_verifier" });
  const aMed = await carte(cMed, "Fusionne la PR 3 : test");
  const cLong = await creerChantier(P1, { titre: "Action au texte long", etat: "a_verifier" });
  const aLong = await carte(cLong, "Fusionne la PR 4 : test");
  const cQ = await creerChantier(P1, { titre: "Question ordinaire", etat: "a_verifier" });
  const qOrd = await creerMessage(P1, cQ, { kind: "question", corps: "Quelle couleur ?" });
  const cSans = await creerChantier(P1, { titre: "Action sans marche à suivre", etat: "a_verifier" });
  const aSans = await creerMessage(P1, cSans, { kind: "action", corps: "Ancienne carte sans marche" });
  await repondre(aFait, "Fait");
  await repondre(aPrec, "Fait", "Mais la CI est rouge, regarde");
  await repondre(aMed, "ok");
  await sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, medias) values (${q(P1)}, ${q(cMed)}, 'raphael', 'utilisateur', 'info', 'Image jointe', ${q(JSON.stringify([{ chemin: `${P1}/${cMed}/x.png`, nom: "x.png", type: "image/png", taille: 1 }]))}::jsonb)`);
  await repondre(aLong, "Fait, mais le bouton Merge est grisé et je ne sais pas pourquoi, peux-tu regarder ?");
  await repondre(qOrd, "Bleu");
  await repondre(aSans, "Fait");
  const servis = (await sql(`select message_id from reponses_sans_suite(${q(P1)})`)).map((r) => r.message_id);
  verifie("« Fait » à une carte d'action (marche à suivre) : NON servie", !servis.includes(aFait), servis);
  verifie("« Fait » : la règle en base (est_accuse_action) le reconnaît, une seule règle",
    (await une(`select est_accuse_action(m) as a from messages m where id = ${q(aFait)}`)).a === true);
  verifie("question ordinaire répondue : toujours servie", servis.includes(qOrd), servis);
  verifie("action avec une précision : servie", servis.includes(aPrec), servis);
  verifie("action avec un média joint : servie", servis.includes(aMed), servis);
  verifie("action avec un vrai texte : servie", servis.includes(aLong), servis);
  verifie("ancienne carte SANS marche à suivre : règle inchangée (servie)", servis.includes(aSans), servis);
  for (let i = 0; i < 8; i++) { const r = (await une(`select reprendre_reponse(${q(`agent/accuse-verif-${rand}-${i}`)}, ${q(P1)}) as r`)).r; if (!r) break; }
  const acc = await chantier(cAcc);
  verifie("reprise : le chantier de la carte « Fait » reste « à vérifier », non réservé", acc.etat === "a_verifier" && acc.pris_par === null, acc);
  verifie("reprise : aucun chantier « Suite de ta réponse » ne cite la carte « Fait »",
    (await une(`select count(*)::int as n from chantiers where projet_id = ${q(P1)} and demande like '%Fusionne la PR 1 : test%'`)).n === 0);
  verifie("reprise : les autres réponses ont bien été reprises (précision, question)",
    (await chantier(cPrec)).etat === "en_cours" && (await chantier(cQ)).etat === "en_cours");
  verifie("droits : ni anon ni un utilisateur connecté n'exécutent est_accuse_action",
    !(await une(`select has_function_privilege('anon', 'cockpit.est_accuse_action(cockpit.messages)', 'execute') or has_function_privilege('authenticated', 'cockpit.est_accuse_action(cockpit.messages)', 'execute') as a`)).a);
}

// ------------------------------------------------------------------ 28
async function controle28_messages_de_session() {
  section("28. Ses messages dans une SESSION arrivent dans le fil du chantier (0027), jamais comme « à répondre », jamais chez un utilisateur");
  const br = `claude/sess-verif-${rand}`, sid = `test-sess-${rand}`;
  const cTenu = await creerChantier(P1, { titre: "Test messages de session, tenu", etat: "en_cours" });
  const cAutre = await creerChantier(P1, { titre: "Test messages de session, autre branche", etat: "en_cours" });
  await sql(`update chantiers set pris_par = ${q(br)}, pris_jusqu_a = now() + interval '30 minutes' where id = ${q(cTenu)}`);
  await sql(`update chantiers set pris_par = 'claude/une-autre', pris_jusqu_a = now() + interval '30 minutes' where id = ${q(cAutre)}`);
  const n = (await une(`select consigner_message_session(${q(SLUG_A)}, ${q(sid)}, ${q(br)}, 'Fais le bouton plus grand, ma clé sk-ant-abcdefghijklmnopqrst') as n`)).n;
  // 0029 : plus de dépôt « partout où la session tient un chantier ».
  verifie("gardé en attente, déposé dans AUCUN fil tant que la session ne le rattache pas (0029)",
    n === 1 && (await une(`select count(*)::int as n from messages where chantier_id in (${q(cTenu)}, ${q(cAutre)})`)).n === 0);
  const rat = (c, depuis) => une(`select rattacher_messages_session(${q(SLUG_A)}, ${q(sid)}, ${q(c)}::uuid, ${depuis ? `now() - interval '${depuis}'` : "null"}) as n`);
  const nr = (await rat(cTenu, "1 minute")).n;
  const fil = await sql(`select m.id, m.auteur_type, m.kind, m.corps, m.via_session, m.recu_at, m.chantier_id, m.medias, m.ou_en_est,
      to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at, null as answered_at,
      cockpit.est_message_libre(m) as libre_base from messages m where m.chantier_id = ${q(cTenu)}`);
  verifie("rattaché (chantier.sh --ouvrir / progression.sh --point) : dans le fil de CE chantier, « via la session », côté Raphaël",
    nr === 1 && fil.length === 1 && fil[0].via_session === true && fil[0].auteur_type === "proprietaire" && fil[0].kind === "info", { nr, fil });
  verifie("un secret évident est masqué avant d'entrer en base", fil[0]?.corps === "Fais le bouton plus grand, ma clé [secret masqué]", fil[0]?.corps);
  verifie("jamais dans le fil d'un autre chantier (même tenu par une autre session)",
    (await une(`select count(*)::int as n from messages where chantier_id = ${q(cAutre)}`)).n === 0);
  verifie("rattaché deux fois : une seule ligne dans le fil", (await rat(cTenu, "1 minute")).n === 0
    && (await une(`select count(*)::int as n from messages where chantier_id = ${q(cTenu)}`)).n === 1);
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const { estMessageLibre } = await import(join(racine, "app/src/lib/discussion.ts"));
  verifie("pas un « message libre » qui attend une réponse : ni en base, ni dans l'app (même règle)",
    fil[0]?.libre_base === false && estMessageLibre(fil[0], fil) === false, fil[0]);
  verifie("pas dans la file des messages sans réponse (la session a répondu dans la session)",
    !(await sql(`select chantier_id from messages_sans_reponse(${q(P1)}, ${q(br)})`)).some((r) => r.chantier_id === cTenu));
  // Un sujet = un fil : le même message, rattaché à un 2e chantier du même tour, y va aussi, à son heure.
  await sql(`update messages_session_attente set created_at = now() - interval '2 minutes' where session_id = ${q(sid)}`);
  const idNeuf = randomUUID();
  await sql(`insert into chantiers (id, projet_id, titre, etat, origine, pris_par, pris_jusqu_a) values (${q(idNeuf)}, ${q(P1)}, 'Test messages de session, ouvert après', 'en_cours', 'session', ${q(br)}, now() + interval '30 minutes')`);
  verifie("chantier pris par la branche (mode autonome, réservation) : AUCUN message rattaché tout seul (0029)",
    (await une(`select count(*)::int as n from messages where chantier_id = ${q(idNeuf)}`)).n === 0);
  await rat(idNeuf, "5 minutes");
  const neuf = await sql(`select corps, created_at < now() - interval '1 minute' as a_son_heure from messages where chantier_id = ${q(idNeuf)}`);
  verifie("rattaché à un 2e chantier du même tour : il le rejoint aussi, à l'heure où il l'a écrit",
    neuf.length === 1 && neuf[0].a_son_heure === true && /bouton plus grand/.test(neuf[0].corps), neuf);
  const cRepris = await creerChantier(P1, { titre: "Test messages de session, repris", etat: "libre" });
  await reserver(cRepris, br);
  verifie("chantier réservé ensuite (reserver_chantier) : rien de rattaché tout seul",
    (await une(`select count(*)::int as n from messages where chantier_id = ${q(cRepris)} and via_session`)).n === 0);
  const cTard = await creerChantier(P1, { titre: "Test messages de session, trop tard", etat: "libre" });
  verifie("un message écrit AVANT le début du tour ne rejoint pas le fil",
    (await rat(cTard, "30 seconds")).n === 0);
  await sql(`update messages_session_attente set created_at = now() - interval '20 minutes' where session_id = ${q(sid)}`);
  verifie("sans début de tour : seulement un message des 15 dernières minutes",
    (await rat(cTard, null)).n === 0);
  verifie("rien de vide : un message blanc n'est pas déposé",
    (await une(`select consigner_message_session(${q(SLUG_A)}, ${q(sid)}, ${q(br)}, '   ') as n`)).n === 0);
  // Interne : un utilisateur membre du projet ne le lit jamais (le chantier lui est pourtant visible).
  const lu = await rest(`messages?select=id,via_session&chantier_id=eq.${cTenu}`, { jwt });
  verifie("un utilisateur membre ne lit pas ce que Raphaël écrit dans ses sessions (RLS)", lu.status === 200 && Array.isArray(lu.json) && lu.json.length === 0, lu);
  const r = await rpcUtilisateur("consigner_message_session", { p_projet: SLUG_A, p_session: "x", p_branche: "x", p_texte: "faux" }, jwt);
  verifie("consigner_message_session : interdit à un utilisateur (sessions seulement)", r.status >= 400, { status: r.status });
  const r2 = await rpcUtilisateur("rattacher_messages_session", { p_projet: SLUG_A, p_session: "x", p_chantier: cTenu, p_depuis: null }, jwt);
  verifie("rattacher_messages_session : interdit à un utilisateur (sessions seulement)", r2.status >= 400, { status: r2.status });
  const attente = await rest(`messages_session_attente?select=id`, { jwt });
  verifie("la file d'attente n'est pas lisible par un utilisateur", attente.status >= 400 || (Array.isArray(attente.json) && attente.json.length === 0), attente);
  await sql(`delete from messages_session_attente where session_id = ${q(sid)}`);
}
// ------------------------------------------------------------------ 29
const P8 = randomUUID(), SLUG_H = `test-verif-${rand}-h`;
const RACINE_DEPOT = dirname(dirname(fileURLToPath(import.meta.url)));
async function controle29_synchro() {
  section("29. Session et cockpit synchronisés (0028) : de côté / reporter / abandonner, chef relais, réveil immédiat");
  await sql(`insert into projets (id, slug, nom, depot) values (${q(P8)}, ${q(SLUG_H)}, 'Projet de test H', 'rnab26/test-inexistant')`);
  const message = (id) => une(`select * from messages where id = ${q(id)}`);
  // --- de côté, reporter, abandonner
  const c1 = await creerChantier(P8, { titre: "À mettre de côté", etat: "en_cours" });
  await sql(`update chantiers set pris_par = 'agent/x', pris_jusqu_a = now() + interval '1 hour' where id = ${q(c1)}`);
  await sql(`select mettre_de_cote(${q(c1)}, null, null)`);
  const a1 = await chantier(c1);
  verifie("mettre_de_cote : « reporte », sans date, réservation libérée", a1.etat === "reporte" && a1.reporte_jusqu_a === null && a1.pris_par === null, a1);
  const l1 = await une(`select corps, kind, auteur_type from messages where chantier_id = ${q(c1)} order by created_at desc limit 1`);
  verifie("mettre_de_cote : une ligne « Mis de côté. » dans le fil (constat, n'attend pas de réponse)", l1?.corps === "Mis de côté." && l1.kind === "constat", l1);
  verifie("cette ligne n'est pas un « message sans réponse »", !(await sql(`select chantier_id from messages_sans_reponse(${q(P8)})`)).some((r) => r.chantier_id === c1));
  verifie("reporter à une date passée : refusé", !!(await erreurDe(`select mettre_de_cote(${q(c1)}, now() - interval '1 day', null)`)));
  await sql(`select mettre_de_cote(${q(c1)}, now() + interval '3 days', 'plus tard')`);
  verifie("reporter à une date : reporte_jusqu_a posé", !!(await chantier(c1)).reporte_jusqu_a);
  await sql(`update chantiers set reporte_jusqu_a = now() - interval '1 minute' where id = ${q(c1)}`);
  const n = (await une(`select reveiller_reportes(${q(P8)}) as n`)).n;
  const a2 = await chantier(c1);
  verifie("reveiller_reportes : la date passée → « libre » (Prêt à lancer), une ligne dans le fil", n === 1 && a2.etat === "libre" && a2.reporte_jusqu_a === null, { n, a2 });
  const c2 = await creerChantier(P8, { titre: "À abandonner", etat: "libre" });
  await sql(`select abandonner_chantier(${q(c2)}, 'plus utile')`);
  const a3 = await chantier(c2);
  verifie("abandonner_chantier : archivé, « reporte », ligne « Abandonné : plus utile »", !!a3.archived_at && a3.etat === "reporte"
    && (await une(`select corps from messages where chantier_id = ${q(c2)} order by created_at desc limit 1`))?.corps === "Abandonné : plus utile", a3);
  const refus = await rpcUtilisateur("mettre_de_cote", { p_id: c2, p_jusqu_a: null, p_raison: null }, jwt);
  verifie("un utilisateur non admin ne peut pas mettre de côté (refus)", refus.status >= 400, refus.status);
  // Le vrai script de session (chantier.sh --de-cote / --abandonner).
  const c3 = await creerChantier(P8, { titre: "Par la session", etat: "libre" });
  const loin = spawnSync("bash", [join(RACINE_DEPOT, "scripts/chantier.sh"), "--projet", SLUG_H, "--de-cote", c3, "--jusqu-au", "2099-01-01"], { encoding: "utf8", env: { ...process.env } });
  verifie("chantier.sh --de-cote … --jusqu-au 2099 : refusé, raison dite (la base borne à un an)", loin.status === 1 && /un an au plus/.test(loin.stderr) && !(await chantier(c3)).reporte_jusqu_a, { status: loin.status, err: loin.stderr });
  execFileSync("bash", [join(RACINE_DEPOT, "scripts/chantier.sh"), "--projet", SLUG_H, "--de-cote", c3], { encoding: "utf8", env: { ...process.env } });
  const a4 = await chantier(c3);
  const l4 = await une(`select auteur_type from messages where chantier_id = ${q(c3)} order by created_at desc limit 1`);
  verifie("chantier.sh --de-cote (session) : mis de côté, la ligne est signée de la session", a4.etat === "reporte" && l4?.auteur_type === "session", { a4, l4 });

  // --- chef vivante, relais
  await sql(`insert into chefs (projet_id, session_id, actif, vu_at) values (${q(P8)}, 'test-relais-${rand}', true, now())`);
  verifie("chef_vivante : vue à l'instant → oui", (await une(`select chef_vivante(${q(P8)}) as v`)).v === true);
  await sql(`update chefs set vu_at = now() - interval '4 hours' where projet_id = ${q(P8)}`);
  verifie("chef_vivante : muette depuis 4 h (et pas de session) → non", (await une(`select chef_vivante(${q(P8)}) as v`)).v === false);
  const S = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S)}, ${q(P8)}, 'Écran', 1)`);
  const cl = await creerChantier(P8, { titre: "Libre à renforcer", etat: "libre" });
  await sql(`update chantiers set section_id = ${q(S)} where id = ${q(cl)}`);
  const rid = randomUUID();
  await sql(`insert into renforts (id, projet_id, section_id, prefixe, chantiers) values (${q(rid)}, ${q(P8)}, ${q(S)}, 'renfort/testh', 1)`);
  const cm = await creerChantier(P8, { titre: "Fil avec une question", etat: "libre" });
  await creerMessage(P8, cm, { kind: "info", corps: "Deux sujets : le bouton, et la couleur", auteur_type: "proprietaire" });
  const rel = (await une(`select relais_a_servir('cockpit', ${q(SLUG_H)}) as r`)).r;
  const moi = rel.find((x) => x.slug === SLUG_H);
  verifie("relais_a_servir (mode test) : le projet sans chef vivante, son renfort à ouvrir et UNE session à ouvrir",
    !!moi && moi.renforts.ouvrir.some((o) => o.id === rid) && moi.ouvrir_session === true && moi.messages >= 1, rel);
  await sql(`select noter_ouverture(${q(SLUG_H)}, 'session_test_relais', null, 'cockpit')`);
  const rel2 = (await une(`select relais_a_servir('cockpit', ${q(SLUG_H)}) as r`)).r.find((x) => x.slug === SLUG_H);
  verifie("après noter_ouverture : plus de session à ouvrir avant 1 h (le renfort reste)", !!rel2 && rel2.ouvrir_session === false && rel2.renforts.ouvrir.length === 1, rel2);
  const relVrai = (await une(`select relais_a_servir('cockpit') as r`)).r;
  verifie("relais_a_servir réel : jamais un projet de test", !JSON.stringify(relVrai).includes("test-verif-"), relVrai.map((x) => x.slug));
  verifie("relais_a_servir d'un projet qui n'est PAS la chef relais : rien", (await une(`select relais_a_servir(${q(SLUG_H)}) as r`)).r.length === 0);
  const er = (await une(`select etat_renforts(${q(SLUG_H)}) as e`)).e;
  const relaisAttendu = (await une(`select p.slug from projets p where p.id = chef_relais()`))?.slug ?? null;
  verifie("etat_renforts : chef = vivante (non), projet nommé, relais = la chef relais du moment", er.chef === false && er.projet === "Projet de test H" && (er.relais ?? null) === null, { er, relaisAttendu });
  // La consigne du relais (chef.sh --relais-texte) : create_session, renfort.sh --session, chef.sh --ouverture ; jamais le travail.
  const texte = execFileSync("bash", [join(RACINE_DEPOT, "scripts/chef.sh"), "--relais-texte"], { input: JSON.stringify(rel), encoding: "utf8" }).toString();
  verifie("consigne du relais : create_session du renfort + renfort.sh --session, et session [cockpit-relais] + --ouverture",
    texte.includes(`--session ${rid}`) && texte.includes("[cockpit-renfort]") && texte.includes("[cockpit-relais]") && texte.includes(`--ouverture ${SLUG_H}`) && /Ne lui réponds PAS d’ici/.test(texte), texte.slice(0, 400));

  // --- réveil immédiat
  const regl = (await une(`select regler_reveil_immediat(${q(SLUG_H)}, 'https://api.anthropic.com/v1/claude_code/routines/trig_01VERIFBASE/fire', 'sk-ant-oat01-faux-jeton-verifier-base') as r`)).r;
  verifie("regler_reveil_immediat : l'identifiant trig_… lu dans l'adresse", regl.trigger === "trig_01VERIFBASE", regl);
  verifie("adresse ou jeton illisible : refusé", !!(await erreurDe(`select regler_reveil_immediat(${q(SLUG_H)}, 'https://exemple.com/x', 'sk-ant-oat01-faux-jeton-verifier-base')`))
    && !!(await erreurDe(`select regler_reveil_immediat(${q(SLUG_H)}, 'trig_01VERIFBASE', 'motdepasse')`)));
  const ligne = await une(`select to_jsonb(r) as j from reveils_immediats r where projet_id = ${q(P8)}`);
  const etatR = (await une(`select etat_reveil_immediat(${q(SLUG_H)}) as e`)).e;
  verifie("le jeton n'est QUE dans le coffre : ni dans la table, ni dans l'état montré à l'app",
    !JSON.stringify(ligne).includes("faux-jeton") && !JSON.stringify(etatR).includes("faux-jeton") && etatR.configure === true, { ligne, etatR });
  verifie("il est bien dans le coffre (Vault)", (await une(`select count(*)::int as n from vault.decrypted_secrets where name = ${q("cockpit_reveil_" + P8)} and decrypted_secret like 'sk-ant-oat01-faux%'`)).n === 1);
  // Un message libre de Raphaël → le trigger réveille (projet de test : lui-même, jamais la chef du cockpit).
  const avant = await une(`select dernier_at from reveils_immediats where projet_id = ${q(P8)}`);
  await creerMessage(P8, cm, { kind: "info", corps: "Encore une question", auteur_type: "proprietaire" });
  const apres = await une(`select dernier_at, dernier_request, dernier_raison from reveils_immediats where projet_id = ${q(P8)}`);
  verifie("message de Raphaël → réveil envoyé (trigger), noté avec sa requête", !avant.dernier_at && !!apres.dernier_at && !!apres.dernier_request && /message/.test(apres.dernier_raison ?? ""), apres);
  verifie("un deuxième réveil dans les 5 min : « trop_tot »", (await une(`select reveiller_chef(${q(P8)}, ${q(cm)}, 'message') as r`)).r === "trop_tot");
  await sql(`insert into sessions (id, projet_id, branche, vu_at) values ('test-reveil-${rand}', ${q(P8)}, 'claude/tient-reveil', now())`);
  await sql(`update chantiers set pris_par = 'claude/tient-reveil', pris_jusqu_a = now() + interval '1 hour' where id = ${q(cm)}`);
  verifie("une session vivante tient le chantier : pas de réveil (« session_tient »)", (await une(`select reveiller_chef(${q(P8)}, ${q(cm)}, 'message') as r`)).r === "session_tient");
  const pp = (await une(`select prochain_passage_chef(${q(P8)}) as prochain, now() as n`));
  verifie("prochain passage annoncé dans ~3 min après un réveil", !!pp?.prochain && Date.parse(pp.prochain) - Date.parse(pp.n) <= 181_000, pp);
  // pg_net a vraiment appelé l'API des routines (faux jeton → 401 attendu).
  let st = null;
  for (let i = 0; i < 10 && !st?.statut; i++) { await attendre(1000); st = (await une(`select etat_reveil_immediat(${q(SLUG_H)}) as e`)).e; }
  verifie("l'appel part vraiment vers api.anthropic.com (faux jeton : 401 authentication_error)", st?.statut === 401 && /authentication_error/.test(st?.erreur ?? ""), st);
  const droits = await une(`select has_function_privilege('authenticated', 'cockpit.reveiller_chef(uuid,uuid,text)', 'execute') as a,
                                    has_function_privilege('anon', 'cockpit.relais_a_servir(text,text)', 'execute') as b,
                                    has_function_privilege('authenticated', 'cockpit.noter_ouverture(text,text,text,text)', 'execute') as c,
                                    has_function_privilege('anon', 'cockpit.regler_reveil_immediat(text,text,text)', 'execute') as d`);
  verifie("droits : ni anon ni un utilisateur connecté ne réveillent ni ne relaient", droits && !droits.a && !droits.b && !droits.c && !droits.d, droits);
  const refusR = await rpcUtilisateur("regler_reveil_immediat", { p_projet: SLUG_H, p_adresse: "trig_01X", p_jeton: "sk-ant-oat01-faux-jeton-utilisateur" }, jwt);
  const vueR = await rest(`reveils_immediats?select=projet_id`, { jwt });
  verifie("un utilisateur non admin : ne règle pas le réveil, ne voit pas la table", refusR.status >= 400 && Array.isArray(vueR.json) && vueR.json.length === 0, { r: refusR.status, v: vueR.json });
  verifie("retirer_reveil_immediat : ligne et jeton effacés du coffre", (await une(`select retirer_reveil_immediat(${q(SLUG_H)}) as ok`)).ok === true
    && (await une(`select count(*)::int as n from vault.secrets where name = ${q("cockpit_reveil_" + P8)}`)).n === 0);
  // Un projet supprimé en cascade n'y laisse pas de jeton (trigger).
  await sql(`select regler_reveil_immediat(${q(SLUG_H)}, 'trig_01VERIFBASE', 'sk-ant-oat01-faux-jeton-verifier-base')`);
  await sql(`delete from reveils_immediats where projet_id = ${q(P8)}`);
  verifie("ligne supprimée (cascade d'un projet) : le jeton quitte le coffre", (await une(`select count(*)::int as n from vault.secrets where name = ${q("cockpit_reveil_" + P8)}`)).n === 0);
}

// ------------------------------------------------------------------ main
console.log(`verifier-base — projets ${SLUG_A} / ${SLUG_B}, compte ${EMAIL}`);
const debut = Date.now();
// ------------------------------------- 30. agents fantômes (0030)
async function controle30_agents_fantomes() {
  section("30. Agents fantômes (0030) : une ligne provisoire finit toujours, la chef ne se croit plus pleine, réglages illisibles signalés");
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const sid = `test-prov-${rand}`;
  const prov = (desc, chantier = null) => une(`select progression_tache(${q(SLUG_A)}, ${q(desc)}, 'Étape', 10, null, ${chantier ? `${q(chantier)}::uuid` : "null"}, 'en_cours', ${q(sid)}) as id`);
  const statut = async (desc) => (await une(`select statut from taches where session_id = ${q(sid)} and tache_id = ${q("prov:" + desc)}`))?.statut;
  const actifs = async () => (await une(`select agents_actifs(${q(sid)}, ${q(P1)}) as n`)).n;
  const vieillir = (desc, min) => sql(`update taches set progres_at = now() - interval '${min} minutes', demarre_at = now() - interval '${min + 5} minutes', vu_at = now() - interval '${min} minutes' where session_id = ${q(sid)} and tache_id = ${q("prov:" + desc)}`);
  const chef = (env = {}) => {
    try { return execFileSync("bash", [join(racine, "scripts/chef.sh")], { encoding: "utf8", cwd: racine, env: { ...process.env, COCKPIT_PROJET: SLUG_A, CLAUDE_CODE_SESSION_ID: sid, ...env }, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  };
  await une(`select prendre_chef(${q(SLUG_A)}, ${q(sid)}, 'agent/test', '') as r`);
  await sql(`update chefs set max_agents = 3 where projet_id = ${q(P1)}`);
  for (const d of ["Fantôme 1", "Fantôme 2", "Fantôme 3"]) await prov(d);
  verifie("trois agents qui viennent de signaler une étape comptent (agents_actifs = 3)", (await actifs()) === 3);
  const plein = chef();
  verifie("chef.sh : « 3 agent(s) travaillent déjà » tant qu'ils signalent", plein.includes("3 agent(s) travaillent déjà"), plein.slice(0, 300));
  // Le cas du 30 sept. : plus aucun signal depuis 50 min, alors que la SESSION vit (trigger 0015).
  for (const d of ["Fantôme 1", "Fantôme 2", "Fantôme 3"]) await vieillir(d, 50);
  await sql(`update sessions set vu_at = now() where id = ${q(sid)}`);
  verifie("la session vit : une ligne provisoire muette depuis 50 min passe « arrêtée » (le trigger ne la garde plus en vie)",
    (await statut("Fantôme 1")) === "arrete" && (await statut("Fantôme 3")) === "arrete", await sql(`select tache_id, statut, vu_at from taches where session_id = ${q(sid)}`));
  const sortie = chef();
  verifie("chef.sh ne se croit plus pleine : 0 agent, places libres", (await actifs()) === 0 && !sortie.includes("travaillent déjà"), sortie.slice(0, 300));
  // Le trigger rafraîchit les VRAIES tâches, pas les provisoires.
  await execSql(`select suivre(${q(SLUG_A)}, ${q(JSON.stringify({ session_id: sid, hook_event_name: "SubagentStart", agent_id: "aVrai", agent_type: "general-purpose" }))}::jsonb)`);
  await prov("Vivant");
  await sql(`update taches set vu_at = now() - interval '10 minutes' where session_id = ${q(sid)} and tache_id in ('aVrai', 'prov:Vivant')`);
  await sql(`update sessions set vu_at = now() + interval '1 second' where id = ${q(sid)}`);
  const v = await sql(`select tache_id, statut, vu_at > now() - interval '1 minute' as frais from taches where session_id = ${q(sid)} and tache_id in ('aVrai', 'prov:Vivant') order by tache_id`);
  verifie("session vivante : la vraie tâche est rafraîchie, la provisoire non (mais reste en cours : étape récente)",
    v.length === 2 && v[0].tache_id === "aVrai" && v[0].frais === true && v[1].frais === false && v[1].statut === "en_cours", v);
  // 0048 : une vraie ligne MUETTE (ni étape ni chantier) et une provisoire sont le même agent (descriptions différentes).
  verifie("0048 : la vraie ligne muette + la provisoire récente = UN seul agent (doublon)", (await actifs()) === 1);
  await sql(`update taches set progres_at = now() where session_id = ${q(sid)} and tache_id = 'aVrai'`);
  verifie("agents_actifs = 2 quand la vraie ligne a signalé elle-même (deux agents distincts)", (await actifs()) === 2);
  await sql(`update taches set progres_at = null where session_id = ${q(sid)} and tache_id = 'aVrai'`);
  await execSql(`select suivre(${q(SLUG_A)}, ${q(JSON.stringify({ session_id: sid, hook_event_name: "SubagentStart", agent_id: "aVrai2", agent_type: "general-purpose" }))}::jsonb)`);
  verifie("0048 : deux vraies lignes muettes + une provisoire = 2 agents (pas 3)", (await actifs()) === 2);
  // Commandes de fond (wait, until, tests) : jamais comptées comme des agents.
  for (const [id, type] of [["bcmd1", "commande"], ["bcmd2", "autre"]])
    await sql(`insert into taches (session_id, projet_id, tache_id, type, description, statut) values (${q(sid)}, ${q(P1)}, ${q(id)}, ${q(type)}, 'wait tests', 'en_cours')`);
  verifie("0048 : les commandes de fond (commande / autre) ne comptent pas comme agents", (await actifs()) === 2);
  await sql(`update taches set statut = 'termine', fini_at = now() where session_id = ${q(sid)} and tache_id in ('aVrai2', 'bcmd1', 'bcmd2')`);
  await vieillir("Vivant", 46);
  verifie("au-delà de delai_tache_prov() (45 min) sans étape, agents_actifs la ferme et ne la compte plus",
    (await actifs()) === 1 && (await statut("Vivant")) === "arrete");
  // L'agent qui finit SON chantier ferme sa ligne provisoire (vrai progression.sh).
  const c = await creerChantier(P1, { titre: "Chantier d'agent fantôme", etat: "en_cours" });
  await prov("Finisseur", c);
  const env = { ...process.env, COCKPIT_PROJET: SLUG_A, COCKPIT_SESSION: "agent/test-prov", CLAUDE_CODE_SESSION_ID: sid };
  try {
    execFileSync("bash", [join(racine, "scripts/progression.sh"), "--chantier", c, "--pas-en-ligne", "banc de test", "--termine", "Fini : test", "--verifier", "1. Rien à voir."],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { verifie("progression.sh --termine a tourné", false, `${e.stdout ?? ""}${e.stderr ?? ""}`); }
  verifie("progression.sh --chantier X --termine ferme la ligne provisoire de SA session sur X", (await statut("Finisseur")) === "termine");
  // Droits : réservé aux sessions.
  const pirate = await rpcUtilisateur("agents_actifs", { p_session: sid, p_projet: P1 }, jwt);
  const pirate2 = await rpcUtilisateur("clore_taches_prov_perimees", { p_session: sid }, jwt);
  verifie("agents_actifs / clore_taches_prov_perimees avec un JWT utilisateur → refusés", pirate.status >= 400 && pirate2.status >= 400, { pirate, pirate2 });
  // Réglages illisibles (la cause du 30 sept.) : la chef le dit en tête de sa passe.
  const dossier = mkdtempSync(join(tmpdir(), "reglages-casses-"));
  try {
    execFileSync("mkdir", ["-p", join(dossier, ".claude")]);
    writeFileSync(join(dossier, ".claude/settings.json"), '{"env": {}}\n{"permissions": {}}\n');
    verifie("chef.sh : .claude/settings.json invalide (deux objets collés) → ALERTE « aucun hook du projet ne tourne »",
      /^ALERTE — .*AUCUN hook du projet ne tourne/m.test(chef({ CLAUDE_PROJECT_DIR: dossier })));
    verifie("chef.sh : réglages valides → pas d'alerte", !chef({ CLAUDE_PROJECT_DIR: racine }).includes("ALERTE —"));
    const vrais = spawnSync("python3", ["-c", "import json,sys; json.load(open(sys.argv[1]))", join(racine, ".claude/settings.json")]);
    verifie("le .claude/settings.json du dépôt est du JSON valide", vrais.status === 0, String(vrais.stderr));
  } finally { rmSync(dossier, { recursive: true, force: true }); }
}

// 37. PR à fusionner : une carte « À toi » par PR, sans doublon, retirée à la fusion (script réel, état donné par --etat, sans GitHub).
const P10 = randomUUID(), SLUG_J = `test-verif-${rand}-j`;
async function controle37_pr_a_fusionner() {
  section("37. PR à fusionner : une carte par numéro de PR (lien + 2 gestes), sans doublon, retirée quand la PR est fusionnée, gardée si elle reste ouverte");
  const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
  await sql(`insert into projets (id, slug, nom, depot) values (${q(P10)}, ${q(SLUG_J)}, 'Projet de test J', 'rnab26/test-inexistant')`);
  const env = { ...process.env, COCKPIT_PROJET: SLUG_J, COCKPIT_SESSION: "verifier-base" };
  const lancer = (args) => {
    try { return { code: 0, sortie: execFileSync("bash", [join(racine, "scripts/pr-a-fusionner.sh"), ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { code: e.status ?? 1, sortie: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  };
  const cartes = async (n) => await sql(`select corps, marche, answered_at from messages where projet_id = ${q(P10)} and kind = 'action' and left(corps, ${`Fusionne la PR #${n} :`.length}) = ${q(`Fusionne la PR #${n} :`)}`);
  const a1 = lancer(["7", "--etat", "open", "--titre", "Ajoute le tri des clients"]);
  const a2 = lancer(["7", "--etat", "open", "--titre", "Ajoute le tri des clients"]);
  const c7 = await cartes(7);
  verifie("poser 2 fois la PR #7 = UNE seule carte « À toi »", a1.code === 0 && a2.code === 0 && c7.length === 1 && c7[0].answered_at === null, { a1, a2, c7 });
  const m = c7[0]?.marche;
  verifie("la carte porte le lien exact de la PR et les 2 gestes (Merge, Confirm)",
    m?.liens?.[0]?.url === "https://github.com/rnab26/test-inexistant/pull/7" && m.etapes?.length === 2 && /Merge pull request/.test(m.etapes[0]) && /Confirm merge/.test(m.etapes[1]), m);
  verifie("règle de clarté : question de 140 caractères au plus, avec le titre de la PR", c7[0]?.corps.length <= 140 && contient(c7[0]?.corps, "tri des clients"), c7[0]?.corps);
  const longue = lancer(["9", "--etat", "open", "--titre", "x".repeat(300)]);
  const c9 = await cartes(9);
  verifie("un titre de PR très long est raccourci à 140 caractères au lieu d'être refusé", longue.code === 0 && c9.length === 1 && c9[0].corps.length <= 140, { longue, n: c9[0]?.corps.length });
  lancer(["70", "--etat", "open"]);
  verifie("la PR #70 ne se confond pas avec la #7 (clé = numéro exact)", (await cartes(70)).length === 1 && (await cartes(7)).length === 1);
  const enCours = lancer(["9", "--etat", "open"]);
  verifie("une PR restée ouverte garde sa carte à la réconciliation", enCours.code === 0 && (await cartes(9)).filter((c) => c.answered_at === null).length === 1, enCours);
  const f = lancer(["7", "--fermee"]);
  const apres = await cartes(7);
  verifie("--fermee retire la carte de la PR #7 (répondue, plus dans « À toi »)", f.code === 0 && apres.length === 1 && apres[0].answered_at !== null, { f, apres });
  const mrg = lancer(["70", "--etat", "merged"]);
  const restantes = await sql(`select corps from messages where projet_id = ${q(P10)} and kind = 'action' and answered_at is null order by corps`);
  verifie("--etat merged retire la #70 ; seule la #9 (ouverte) reste à Raphaël", mrg.code === 0 && restantes.length === 1 && contient(restantes[0].corps, "#9 :"), { mrg, restantes });
  const re = lancer(["7", "--etat", "open"]);
  verifie("une carte déjà retirée n'est pas reposée", re.code === 0 && (await cartes(7)).length === 1, re);
  const inconnue = lancer(["12", "--fermee"]);
  const mauvais = lancer(["abc"]);
  verifie("--fermee sur une PR sans carte : sans erreur, rien créé ; un numéro invalide est refusé", inconnue.code === 0 && (await cartes(12)).length === 0 && mauvais.code === 2, { inconnue, mauvais });
}

// 38. PR sans conflit : la carte « À toi » n'arrive que si la PR est propre (script réel, propreté donnée par --merge-state / --ci, sans GitHub).
async function controle38_pr_propre() {
  section("38. PR propre seulement : conflit / CI en cours / CI en échec / brouillon = pas de carte ; carte existante devenue en conflit = retirée ; reposée quand la PR redevient propre");
  const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
  await sql(`insert into projets (id, slug, nom, depot) values (${q(P10)}, ${q(SLUG_J)}, 'Projet de test J', 'rnab26/test-inexistant') on conflict (id) do nothing`);
  const env = { ...process.env, COCKPIT_PROJET: SLUG_J, COCKPIT_SESSION: "verifier-base" };
  const lancer = (args) => {
    try { return { code: 0, sortie: execFileSync("bash", [join(racine, "scripts/pr-a-fusionner.sh"), ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { code: e.status ?? 1, sortie: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  };
  const cartes = async (n) => await sql(`select answered_at, reponse from messages where projet_id = ${q(P10)} and kind = 'action' and left(corps, ${`Fusionne la PR #${n} :`.length}) = ${q(`Fusionne la PR #${n} :`)}`);
  const ouvertes = async (n) => (await cartes(n)).filter((c) => c.answered_at === null).length;

  const propre = lancer(["201", "--etat", "open", "--merge-state", "clean", "--titre", "PR propre"]);
  verifie("PR propre (clean) : la carte est posée", propre.code === 0 && (await ouvertes(201)) === 1, propre);
  const conflit = lancer(["202", "--etat", "open", "--merge-state", "dirty", "--titre", "PR en conflit"]);
  verifie("PR en conflit (dirty) : AUCUNE carte, et le script dit pourquoi", conflit.code === 0 && (await cartes(202)).length === 0 && /PAS PRÊTE.*conflit/.test(conflit.sortie), conflit);
  const cours = lancer(["203", "--etat", "open", "--merge-state", "unstable", "--ci", "cours"]);
  verifie("CI en cours : pas de carte, « CI en cours » dit", cours.code === 0 && (await cartes(203)).length === 0 && /CI en cours/.test(cours.sortie), cours);
  const echec = lancer(["204", "--etat", "open", "--merge-state", "unstable", "--ci", "echec"]);
  verifie("CI en échec : pas de carte, « CI en échec » dit", echec.code === 0 && (await cartes(204)).length === 0 && /CI en échec/.test(echec.sortie), echec);
  const instable = lancer(["205", "--etat", "open", "--merge-state", "unstable", "--ci", "ok"]);
  verifie("unstable sans échec de CI : la carte est posée", instable.code === 0 && (await ouvertes(205)) === 1, instable);
  const brouillon = lancer(["206", "--etat", "open", "--merge-state", "draft"]);
  const calcul = lancer(["207", "--etat", "open", "--merge-state", "unknown"]);
  const retard = lancer(["208", "--etat", "open", "--merge-state", "behind"]);
  verifie("brouillon, calcul en cours (unknown), en retard sur main (behind) : pas de carte",
    [206, 207, 208].every(() => true) && (await cartes(206)).length + (await cartes(207)).length + (await cartes(208)).length === 0 && brouillon.code === 0 && calcul.code === 0 && retard.code === 0, { brouillon, calcul, retard });

  // Carte existante, PR devenue en conflit : retirée (répondue), puis reposée quand la PR redevient propre.
  const devenue = lancer(["201", "--etat", "open", "--merge-state", "dirty"]);
  const apres = await cartes(201);
  verifie("carte existante + PR devenue en conflit : la carte est retirée (répondue « pas prête »)", devenue.code === 0 && (await ouvertes(201)) === 0 && apres.length === 1 && /pas prête/.test(apres[0].reponse ?? ""), { devenue, apres });
  const propreDeNouveau = lancer(["201", "--etat", "open", "--merge-state", "clean", "--titre", "PR propre"]);
  const finale = await cartes(201);
  verifie("la PR redevient propre : UNE nouvelle carte est posée (l'ancienne, retirée par le script, ne bloque pas)", propreDeNouveau.code === 0 && (await ouvertes(201)) === 1 && finale.length === 2, { propreDeNouveau, finale });
  const deux = lancer(["201", "--etat", "open", "--merge-state", "clean"]);
  verifie("re-appeler une PR propre ne pose pas de doublon", deux.code === 0 && (await ouvertes(201)) === 1, deux);
  const ferme = lancer(["201", "--fermee"]);
  verifie("--fermee retire toujours la carte", ferme.code === 0 && (await ouvertes(201)) === 0, ferme);
  const mauvaisCi = lancer(["209", "--etat", "open", "--ci", "peut-etre"]);
  verifie("--ci invalide refusé", mauvaisCi.code === 2, mauvaisCi);
}

// 38 bis. scripts/prochaine-migration.sh : 1 + le plus grand numéro vu dans la copie ET sur les branches distantes.
async function controle38_prochaine_migration() {
  section("38 bis. Prochaine migration : numéro libre = max des fichiers locaux et des branches distantes + 1");
  const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
  const tmp = mkdtempSync(join(tmpdir(), "prochaine-migration-"));
  const g = (cwd, ...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const origine = join(tmp, "origine.git"), copie = join(tmp, "copie"), autre = join(tmp, "autre");
    g(tmp, "init", "-q", "--bare", origine);
    g(tmp, "clone", "-q", origine, copie);
    execFileSync("mkdir", ["-p", join(copie, "scripts"), join(copie, "supabase/migrations")]);
    execFileSync("cp", [join(racine, "scripts/prochaine-migration.sh"), join(copie, "scripts/")]);
    for (const f of ["0001_a.sql", "0007_b.sql", "0012_c.sql"]) writeFileSync(join(copie, "supabase/migrations", f), "-- x\n");
    g(copie, "add", "-A"); g(copie, "commit", "-q", "-m", "base"); g(copie, "push", "-q", "origin", "HEAD:main");
    const lancer = (args = []) => execFileSync("bash", [join(copie, "scripts/prochaine-migration.sh"), ...args], { encoding: "utf8", cwd: copie, stdio: ["ignore", "pipe", "pipe"] }).trim();
    verifie("numéro suivant = 0013 quand les fichiers vont jusqu'à 0012", lancer() === "0013", lancer());
    verifie("--nom donne le chemin complet", lancer(["--nom", "essai"]) === "supabase/migrations/0013_essai.sql", lancer(["--nom", "essai"]));
    // Un autre agent pousse une branche avec 0013 et 0014, pas encore fusionnée dans main.
    g(tmp, "clone", "-q", origine, autre);
    g(autre, "switch", "-q", "-c", "agent/autre");
    execFileSync("mkdir", ["-p", join(autre, "supabase/migrations")]);
    for (const f of ["0013_x.sql", "0014_y.sql"]) writeFileSync(join(autre, "supabase/migrations", f), "-- y\n");
    g(autre, "add", "-A"); g(autre, "commit", "-q", "-m", "autre"); g(autre, "push", "-q", "origin", "agent/autre");
    verifie("la migration d'un agent pas encore fusionnée (branche distante 0014) est comptée : suivant = 0015", lancer() === "0015", lancer());
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// 36. Déplacer un chantier vers un autre projet (0038).
async function controle36_deplacer_chantier() {
  section("36. Déplacer un chantier vers un autre projet (0038) : le chantier, son fil, sa section, sa réservation, ses médias");
  const c = await creerChantier(P1, { titre: "Écrit par erreur au mauvais endroit", etat: "en_cours" });
  const doublon = await creerChantier(P1, { titre: "Autre chantier resté", etat: "libre" });
  await sql(`update chantiers set pris_par = 'agent/x', pris_jusqu_a = now() + interval '1 hour', doublon_de = ${q(doublon)} where id = ${q(c)}`);
  await une(`select ranger_chantier(${q(c)}::uuid, 'Ventes zorglub', 'verifier-base') as s`);
  const m = await creerMessage(P1, c, { kind: "question", corps: "Quelle couleur ?", options: [{ id: "a", libelle: "Bleu" }] });
  await sql(`update messages set medias = ${q(JSON.stringify([{ chemin: `${P1}/${c}/x-photo.png`, nom: "photo.png", type: "image/png", taille: 1 }]))}::jsonb where id = ${q(m)}`);
  await sql(`insert into activite (projet_id, chantier_id, session, etape) values (${q(P1)}, ${q(c)}, 'test', 'étape')`);

  verifie("vers le même projet : refusé, raison dite", /déjà dans/.test((await erreurDe(`select deplacer_chantier(${q(c)}, ${q(SLUG_A)})`)) ?? ""));
  verifie("vers un projet inconnu : refusé", /projet inconnu/.test((await erreurDe(`select deplacer_chantier(${q(c)}, 'test-nexiste-pas')`)) ?? ""));
  verifie("chantier inconnu : refusé", /introuvable/.test((await erreurDe(`select deplacer_chantier(${q(randomUUID())}, ${q(SLUG_B)})`)) ?? ""));

  const r = await une(`select deplacer_chantier(${q(c)}, ${q(SLUG_B)}) as r`);
  const a = await chantier(c);
  verifie("le chantier est dans le projet cible, réservation libérée, lien « doublon de » coupé", a.projet_id === P2 && a.pris_par === null && a.pris_jusqu_a === null && a.doublon_de === null, a);
  const sec = await une(`select nom, projet_id from sections where id = ${q(a.section_id)}`);
  verifie("section « Ventes zorglub » recréée dans le projet cible", sec?.nom === "Ventes zorglub" && sec.projet_id === P2, sec);
  const reste = await une(`select (select count(*) from messages where chantier_id = ${q(c)} and projet_id <> ${q(P2)})::int as m, (select count(*) from activite where chantier_id = ${q(c)} and projet_id <> ${q(P2)})::int as a`);
  verifie("messages et activité ont suivi (aucune ligne restée dans l'ancien projet)", reste.m === 0 && reste.a === 0 && r.r.messages >= 1, { reste, r });
  const l = await une(`select corps, kind from messages where chantier_id = ${q(c)} order by created_at desc limit 1`);
  verifie("une ligne « Déplacé de … vers … » (constat) dans le fil", l?.kind === "constat" && /^Déplacé de « .* » vers « .* »\./.test(l.corps), l);
  const autre = await une(`select projet_id from chantiers where id = ${q(doublon)}`);
  verifie("l'autre chantier n'a pas bougé", autre.projet_id === P1);
  verifie("les médias restent cités par le message (chemin inchangé)", (await une(`select medias->0->>'chemin' as ch from messages where id = ${q(m)}`)).ch === `${P1}/${c}/x-photo.png`);
  await sql(`select deplacer_chantier(${q(c)}, ${q(SLUG_A)})`);
  verifie("retour possible : redéplacé dans le projet d'origine", (await chantier(c)).projet_id === P1);
}

// 38. « Vérifie pour moi » sans retour (0046) : priorité sur le code, la section d'un renfort ne la garde que 10 min, jamais un certifié/archivé, le relais ouvre une session, --verifs la sert.
async function controle38_verif_sans_retour() {
  section("38. Vérifie pour moi servi (0046) : priorité, renfort de section limité à 10 min, certifié/archivé jamais, relais, --verifs");
  const S = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S)}, ${q(P9)}, 'VERIF Section', 8)`);
  const v = await creerChantier(P9, { titre: "VERIF à juger", etat: "a_verifier" });
  const code = await creerChantier(P9, { titre: "VERIF du code libre", etat: "libre" });
  await sql(`update chantiers set section_id = ${q(S)} where id in (${q(v)}, ${q(code)})`);
  const R = randomUUID();
  await sql(`insert into renforts (id, projet_id, section_id, prefixe, statut, vu_at) values (${q(R)}, ${q(P9)}, ${q(S)}, 'renfort/vv0046', 'actif', now())`);
  const verifs = async (par = null) => (await sql(`select id from verifs_prenables(${q(P9)}, ${par ? q(par) : "null"})`)).map((r) => r.id);
  await sql(`update chantiers set verif_demandee_at = now() where id = ${q(v)}`);
  verifie("demande fraîche, renfort vivant sur sa section : le renfort la prend, pas la chef", (await verifs("renfort/vv0046/")).includes(v) && !(await verifs()).includes(v));
  await sql(`update chantiers set verif_demandee_at = now() - interval '11 minutes' where id = ${q(v)}`);
  verifie("au-delà de 10 min : n'importe qui la prend (le renfort muet ne la garde plus)", (await verifs()).includes(v));
  const rf = (await une(`select prochain_renfort(${q(R)}) as r`)).r;
  verifie("prochain_renfort sert la vérification AVANT le chantier de code libre", rf.chantiers?.[0]?.id === v && rf.chantiers[0].verif === true, rf);
  verifie("la vérification est réservée : plus prenable par la passe", !(await verifs()).includes(v));
  await sql(`update chantiers set pris_par = null, pris_jusqu_a = null, etat = 'valide' where id = ${q(v)}`);
  verifie("un chantier certifié n'est jamais servi", !(await verifs()).includes(v));
  await sql(`update chantiers set etat = 'a_verifier', archived_at = now() where id = ${q(v)}`);
  verifie("un chantier archivé n'est jamais servi", !(await verifs()).includes(v));
  await sql(`update chantiers set archived_at = null where id = ${q(v)}`);
  await sql(`update renforts set statut = 'fini' where id = ${q(R)}`);
  // Relais : projet sans chef vivante + vérification en attente → ouvrir une session.
  const rel = (await une(`select relais_a_servir('cockpit', ${q(SLUG_I)}) as r`)).r.find((x) => x.slug === SLUG_I);
  verifie("relais_a_servir : projet sans chef vivante + vérification en attente → une session à ouvrir (verifs ≥ 1)", rel?.ouvrir_session === true && rel.verifs >= 1, rel);
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const chefSh = (args) => execFileSync("bash", [join(racine, "scripts/chef.sh"), ...args], { encoding: "utf8", env: { ...process.env, COCKPIT_PROJET: SLUG_I, CLAUDE_CODE_SESSION_ID: "relais-test" } });
  const o1 = chefSh(["--verifs"]);
  const res = await une(`select pris_par from chantiers where id = ${q(v)}`);
  verifie("chef.sh --verifs : consigne « Vérifier » avec le verdict, chantier réservé à agent/verif-…", /Vérifier : VERIF à juger/.test(o1) && /--pas-bon/.test(o1) && /^agent\/verif-/.test(res.pris_par ?? ""), o1.slice(0, 300));
  const o2 = chefSh(["--verifs"]);
  verifie("--verifs relancé : RIEN (déjà réservée), pas de doublon", /^RIEN/.test(o2.trim()), o2.slice(0, 200));
  await sql(`update chantiers set verif_demandee_at = null, verdict_ok = true, verdict_at = now(), pris_par = null, pris_jusqu_a = null where id = ${q(v)}`);
  verifie("verdict rendu : plus servie", !(await verifs()).includes(v));
}

// 37. Traité sans attendre (0043) : une réservation sans signe de vie est libérée, une seule règle.
async function controle37_traite_sans_attendre() {
  section("37. Traité sans attendre (0043) : réservation sans signe de vie libérée, renfort muet rendu, agent vivant intouché");
  // Vieillit une fiche de test sans toucher au trigger des autres (session_replication_role local à cet appel).
  const vieillir = (id, min) => sql(`set local session_replication_role = replica; update chantiers set updated_at = now() - interval '${min} minutes' where id = ${q(id)}`);
  const reserver = (id, par, min = 60) => sql(`update chantiers set pris_par = ${q(par)}, pris_jusqu_a = now() + interval '${min} minutes' where id = ${q(id)}`);
  const prenables = async (par = null) => (await sql(`select id from chantiers_prenables(${q(P9)}, ${par ? q(par) : "null"})`)).map((r) => r.id);

  const mort = await creerChantier(P9, { titre: "TRAITÉ Point mort", etat: "libre" });
  const vivant = await creerChantier(P9, { titre: "TRAITÉ Agent vivant", etat: "libre" });
  const frais = await creerChantier(P9, { titre: "TRAITÉ Réservation fraîche", etat: "libre" });
  const codeur = await creerChantier(P9, { titre: "TRAITÉ Code sans étape", etat: "en_cours" });
  for (const [id, par] of [[mort, "agent/message-mort"], [vivant, "agent/message-vivant"], [frais, "agent/message-frais"], [codeur, "agent/code-mort"]]) await reserver(id, par);
  const sid = `test-traite-${rand}`;
  await sql(`insert into sessions (id, projet_id, branche, vu_at) values (${q(sid)}, ${q(P9)}, 'claude/traite', now())`);
  await sql(`insert into taches (session_id, projet_id, tache_id, type, chantier_id, statut, vu_at) values (${q(sid)}, ${q(P9)}, 't1', 'agent', ${q(vivant)}, 'en_cours', now())`);
  await vieillir(mort, 45); await vieillir(vivant, 45); await vieillir(codeur, 45);
  // Une demande de Raphaël sur le chantier au point mort, prise par l'agent mort : elle doit revenir à servir.
  const m = await creerMessage(P9, mort, { kind: "info", corps: "peux-tu regarder ça ?", auteur_type: "proprietaire" });
  await sql(`update messages set recu_par = 'agent/message-mort', recu_at = now() - interval '40 minutes' where id = ${q(m)}`);

  const avant = await prenables();
  verifie("avant balayage : la réservation d'un agent mort (libre, 45 min de silence) bloque encore le chantier", !avant.includes(mort), avant);
  const n = (await une(`select liberer_silencieux(${q(SLUG_I)}) as n`)).n;
  const apres = await prenables();
  verifie("après balayage : le chantier au point mort est prenable ET le chantier en cours sans étape aussi", n >= 1 && apres.includes(mort) && apres.includes(codeur), { n, apres });
  verifie("un agent qui travaille (tâche vivante) garde son chantier, une réservation fraîche aussi", !apres.includes(vivant) && !apres.includes(frais), apres);
  const f = await chantier(mort);
  verifie("la fiche dit qui, depuis combien, quand (libere_de / libere_apres_min / libere_at), sans rien écrire dans le fil",
    f.libere_de === "agent/message-mort" && f.libere_apres_min >= 44 && !!f.libere_at
      && (await une(`select count(*)::int as n from messages where chantier_id = ${q(mort)} and auteur_type = 'session'`)).n === 0, f);
  verifie("le message que l'agent mort avait pris est de nouveau à servir (recu_at remis à zéro)", (await une(`select recu_at from messages where id = ${q(m)}`)).recu_at === null);
  const n2 = (await une(`select liberer_silencieux(${q(SLUG_I)}) as n`)).n;
  verifie("repasser ne libère rien de plus (une fois par réservation)", n2 === 0, n2);
  verifie("liberer_silencieux : refusé à un membre connecté", (await rpcUtilisateur("liberer_silencieux", { p_projet: SLUG_I }, jwt)).status >= 400);

  // Renfort : muet depuis 100 min avec un chantier abandonné → sa section est rendue ; signe de vie récent → elle reste tenue.
  const S = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S)}, ${q(P9)}, 'TRAITÉ Section', 9)`);
  const rc = await creerChantier(P9, { titre: "TRAITÉ Section de renfort", etat: "libre" });
  const rcode = await creerChantier(P9, { titre: "TRAITÉ Chantier du renfort", etat: "en_cours" });
  await sql(`update chantiers set section_id = ${q(S)} where id in (${q(rc)}, ${q(rcode)})`);
  const R = randomUUID();
  await sql(`insert into renforts (id, projet_id, section_id, prefixe, statut, vu_at) values (${q(R)}, ${q(P9)}, ${q(S)}, 'renfort/tt0041', 'actif', now() - interval '100 minutes')`);
  await reserver(rcode, "renfort/tt0041/aaaaaa", 120);
  await vieillir(rcode, 90);
  const vRenfort = async () => (await une(`select renfort_vivant(r) as v from renforts r where id = ${q(R)}`)).v;
  verifie("renfort muet depuis 100 min, son chantier sans signe : plus « vivant », sa section est rendue", (await vRenfort()) === false && (await prenables()).includes(rc));
  await sql(`update renforts set vu_at = now() where id = ${q(R)}`);
  verifie("le même renfort avec un signe de vie récent : vivant, sa section reste à lui", (await vRenfort()) === true && !(await prenables()).includes(rc));
  await sql(`update renforts set statut = 'fini' where id = ${q(R)}`);
}

// 39. Délai « sans signe de vie » réglable (0046) : une source, défaut 3 min, agent vivant intouché, mort repris.
async function controle39_delai_sans_signe() {
  section("39. Délai sans signe de vie réglable (0046) : défaut 3 min, une source, borné 1-120, agent vivant intouché, agent mort repris");
  const vieillir = (id, min) => sql(`set local session_replication_role = replica; update chantiers set updated_at = now() - interval '${min} minutes' where id = ${q(id)}`);
  const reserver = (id, par) => sql(`update chantiers set pris_par = ${q(par)}, pris_jusqu_a = now() + interval '60 minutes' where id = ${q(id)}`);
  const sans = async (id) => (await une(`select sans_signe_de_vie(c) as v from chantiers c where id = ${q(id)}`)).v;
  const regler = (min) => sql(`select regler_sans_signe(${q(SLUG_I)}, ${min})`);

  // Une seule source : défaut de la colonne = défaut de l'écran (silence.ts), plus aucune constante « 30 minutes » dans les règles.
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const ts = (await import("node:fs")).readFileSync(join(racine, "app/src/lib/silence.ts"), "utf8");
  const mts = ts.match(/DELAI_ABANDON_MIN = (\d+)/);
  const col = await une(`select column_default as d from information_schema.columns where table_schema = 'cockpit' and table_name = 'projets' and column_name = 'delai_sans_signe_min'`);
  verifie("défaut de l'écran (DELAI_ABANDON_MIN) = défaut de la colonne (3)", !!mts && String(col?.d) === mts[1] && mts[1] === "3", { app: mts?.[1], base: col?.d });
  const inconnu = await une(`select extract(epoch from cockpit.delai_signe(null))::int as s`);
  verifie("projet inconnu : le repli est le même défaut (3 min)", inconnu.s === 180, inconnu);
  const restes = await sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cockpit' and p.proname in ('sans_signe_de_vie','renfort_vivant','messages_sans_reponse','reponses_sans_suite','ou_en_est_sans_suite','prendre_ou_en_est','constater_autonome','reveiller_chef','relais_a_servir','filet_vivant') and pg_get_functiondef(p.oid) ilike '%30 minutes%'`);
  verifie("aucune de ces règles n'écrit encore « 30 minutes » en dur", restes.length === 0, restes);

  // Bornes et droits.
  verifie("regler_sans_signe refuse 0 et 121, accepte 1 et 120",
    !!(await erreurDe(`select regler_sans_signe(${q(SLUG_I)}, 0)`)) && !!(await erreurDe(`select regler_sans_signe(${q(SLUG_I)}, 121)`))
      && !(await erreurDe(`select regler_sans_signe(${q(SLUG_I)}, 1)`)) && !(await erreurDe(`select regler_sans_signe(${q(SLUG_I)}, 120)`)));
  await regler(3);
  verifie("le projet garde son défaut (3) une fois remis", (await une(`select delai_sans_signe_min as m from projets where id = ${q(P9)}`)).m === 3);
  verifie("delai_signe : refusé à un membre connecté (règle interne)", (await rpcUtilisateur("delai_signe", { p_projet: P9 }, jwt)).status >= 400);

  // La règle avec 3 puis 10 min. Vivant = la session (branche du chantier) a un signe récent ; mort = rien depuis le délai.
  const sid = `test-delai-${rand}`;
  await sql(`insert into sessions (id, projet_id, branche, vu_at) values (${q(sid)}, ${q(P9)}, 'agent/delai-vivant', now() - interval '1 minute')`);
  const vivant = await creerChantier(P9, { titre: "DÉLAI Agent vivant qui code en silence", etat: "en_cours" });
  const mort = await creerChantier(P9, { titre: "DÉLAI Agent mort", etat: "en_cours" });
  const frais = await creerChantier(P9, { titre: "DÉLAI Attribué à l'instant", etat: "libre" });
  await reserver(vivant, "agent/delai-vivant"); await reserver(mort, "agent/delai-mort");
  await vieillir(vivant, 20); await vieillir(mort, 20); await vieillir(frais, 500);
  verifie("délai 3 min : agent dont la session a battu il y a 1 min = intouché ; agent muet depuis 20 min = sans signe", (await sans(vivant)) === false && (await sans(mort)) === true);
  await reserver(frais, "agent/delai-frais");
  verifie("le CADENAS compte dès l'attribution : un vieux chantier attribué à l'instant n'est pas « sans signe » (fiche touchée par la réservation)", (await sans(frais)) === false);
  await vieillir(frais, 4);
  verifie("délai 3 min : sans aucun signe depuis 4 min, il l'est", (await sans(frais)) === true);
  await regler(10);
  verifie("délai 10 min : 4 min de silence ne libère plus, 20 min si", (await sans(frais)) === false && (await sans(mort)) === true);
  await sql(`update sessions set vu_at = now() - interval '5 minutes' where id = ${q(sid)}`);
  const a10 = await sans(vivant);
  await regler(3);
  const a3 = await sans(vivant);
  verifie("un signe de session vieux de 5 min garde l'agent vivant à 10 min de délai, plus à 3 min (le réglage est bien lu)", a10 === false && a3 === true, { a10, a3 });

  // Le balayage lit la même règle : à 3 min, le mort est libéré, le vivant (signe de 1 min) non.
  await sql(`update sessions set vu_at = now() - interval '1 minute' where id = ${q(sid)}`);
  await sql(`select liberer_silencieux(${q(SLUG_I)})`);
  const fin = async (id) => new Date((await chantier(id)).pris_jusqu_a).getTime();
  verifie("liberer_silencieux (délai 3 min) : le mort est libéré, l'agent vivant garde sa réservation", (await fin(mort)) <= Date.now() && (await fin(vivant)) > Date.now());

  // Un renfort vu il y a 5 min : muet à 3 min de délai, vivant à 10 (même règle que le chantier).
  const S = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S)}, ${q(P9)}, 'DÉLAI Section', 10)`);
  const R = randomUUID();
  await sql(`insert into renforts (id, projet_id, section_id, prefixe, statut, vu_at) values (${q(R)}, ${q(P9)}, ${q(S)}, 'renfort/tt0046', 'actif', now() - interval '5 minutes')`);
  const vR = async () => (await une(`select renfort_vivant(r) as v from renforts r where id = ${q(R)}`)).v;
  verifie("renfort vu il y a 5 min : muet à 3 min de délai", (await vR()) === false);
  await regler(10);
  verifie("…vivant à 10 min de délai (renfort_vivant lit le réglage du projet)", (await vR()) === true);
  await regler(3);
  await sql(`update renforts set statut = 'fini' where id = ${q(R)}`);
}

// 37. Suggestion automatique de fusion (0042) : une carte « À toi » par paire, jamais un projet de test, seuil réglable.
async function controle37_fusion_auto() {
  section("37. Fusion suggérée toute seule (0042) : une règle, une carte par paire, seuil et interrupteur réglables, jamais un projet de test");
  const nCartes = async (chantierId) => (await une(`select count(*)::int as n from messages where kind = 'fusion' and chantier_id = ${q(chantierId)}`)).n;
  const ancien = await creerChantier(P1, { titre: "Ouverture de session et agents de renfort", etat: "libre" });
  const nouveau = await creerChantier(P1, { titre: "Ouverture des sessions et des agents de renfort", etat: "libre" });
  const loin = await creerChantier(P1, { titre: "Couleur du bouton d'envoi", etat: "libre" });

  verifie("projet de test : le trigger ne pose AUCUNE carte (même pour deux titres très proches)", (await nCartes(ancien)) === 0 && (await nCartes(nouveau)) === 0);
  const regle = await une(`select cockpit.ressemblance_fusion('Ouverture de session et agents de renfort', 'Ouverture des sessions et des agents de renfort') as s`);
  verifie("la règle voit ces deux titres proches (score >= seuil par défaut 0,65)", regle.s >= 0.65, regle);
  const seuil = await une(`select fusion_auto, fusion_seuil from projets where id = ${q(P1)}`);
  verifie("réglages par défaut : fusion_auto oui, seuil 0,65", seuil.fusion_auto === true && Math.abs(seuil.fusion_seuil - 0.65) < 1e-6, seuil);

  const carte = (await une(`select fusion_auto_pour(${q(nouveau)}, true) as id`)).id;
  const m = carte ? await une(`select kind, chantier_id, options->0->>'source' as source, options->0->>'cible' as cible, options->0->>'libelle' as lib, answered_at from messages where id = ${q(carte)}`) : null;
  verifie("mode test : UNE carte « fusion » posée dans le fil du chantier GARDÉ (l'ancien), source = le nouveau, en attente", !!m && m.kind === "fusion" && m.chantier_id === ancien && m.source === nouveau && m.cible === ancien && m.lib === "Fusionner" && m.answered_at === null, m);
  verifie("une seule carte par paire : repasser n'en pose pas d'autre", (await une(`select fusion_auto_pour(${q(nouveau)}, true) as id`)).id === null && (await nCartes(ancien)) === 1);
  verifie("le chantier sans rapport n'a aucun candidat", (await une(`select fusion_auto_pour(${q(loin)}, true) as id`)).id === null);
  const sugg = await une(`select suggerer_fusion(${q(ancien)}, ${q(nouveau)}, 'x', 'verifier-base') as id`);
  verifie("la suggestion d'une session dans l'autre sens ne double pas la carte (même paire)", sugg.id === null && (await nCartes(ancien)) === 1);

  // Refusée : plus jamais reproposée.
  await sql(`select trancher_fusion(${q(carte)}, false, 'test')`);
  verifie("« Garder séparés » : la paire n'est plus jamais reproposée",
    (await une(`select fusion_auto_pour(${q(nouveau)}, true) as id`)).id === null && (await nCartes(ancien)) === 1);

  // Seuil, interrupteur, états exclus, droits.
  const a2 = await creerChantier(P1, { titre: "Alerte saturation des renforts de session", etat: "libre" });
  await sql(`select regler_fusion(${q(SLUG_A)}, true, 1)`);
  verifie("seuil réglé à 1 : plus de candidat (le seuil est bien lu en base)", (await une(`select fusion_auto_pour(${q(a2)}, true) as id`)).id === null);
  await sql(`select regler_fusion(${q(SLUG_A)}, true, 0.65)`);
  await sql(`select regler_fusion(${q(SLUG_A)}, false, null)`);
  verifie("interrupteur éteint : aucune carte", (await une(`select fusion_auto_pour(${q(a2)}, true) as id`)).id === null);
  await sql(`select regler_fusion(${q(SLUG_A)}, true, null)`);
  verifie("regler_fusion refuse un seuil de 0,1 ou 2", !!(await erreurDe(`select regler_fusion(${q(SLUG_A)}, true, 0.1)`)) && !!(await erreurDe(`select regler_fusion(${q(SLUG_A)}, true, 2)`)));
  const b1 = await creerChantier(P1, { titre: "Migration de la table des factures clients", etat: "libre" });
  const b2 = await creerChantier(P1, { titre: "Migration table factures clients", etat: "libre" });
  await sql(`update chantiers set archived_at = now() where id = ${q(b1)}`);
  verifie("un chantier archivé n'est jamais candidat", (await une(`select fusion_auto_pour(${q(b2)}, true) as id`)).id === null);
  await sql(`update chantiers set archived_at = null, etat = 'valide' where id = ${q(b1)}`);
  verifie("un chantier certifié n'est jamais candidat", (await une(`select fusion_auto_pour(${q(b2)}, true) as id`)).id === null);
  await sql(`update chantiers set etat = 'libre' where id = ${q(b1)}`);
  await sql(`update chantiers set archived_at = now() where id = ${q(b2)}`);
  verifie("un chantier archivé n'a pas de carte non plus (source archivée)", (await une(`select fusion_auto_pour(${q(b2)}, true) as id`)).id === null);
  await sql(`update chantiers set archived_at = null where id = ${q(b2)}`);

  // Accepter = la fusion existante.
  const c2 = (await une(`select fusion_auto_pour(${q(b2)}, true) as id`)).id;
  await sql(`select trancher_fusion(${q(c2)}, true, 'test')`);
  const f = await chantier(b2);
  verifie("« Fusionner » : le nouveau est archivé comme doublon de l'ancien (fusionner_chantiers, inchangée)", !!f.archived_at && f.doublon_de === b1, f);
  const droits = await une(`select has_function_privilege('authenticated', 'cockpit.fusion_auto_pour(uuid, boolean)', 'execute') as a, has_function_privilege('anon', 'cockpit.candidat_fusion(uuid, boolean)', 'execute') as b, has_function_privilege('authenticated', 'cockpit.poser_carte_fusion(uuid, uuid, text, text, text)', 'execute') as c`);
  verifie("droits : ni l'app ni le public ne posent une carte à la main", !droits.a && !droits.b && !droits.c, droits);
}

// 33. Un chantier né dans le fil d'un autre (0033) : créé, rangé, relié, sans rien arracher.
// Un projet NEUF (I) pour l'ouverture automatique des renforts.
const P9 = randomUUID(), SLUG_I = `test-verif-${rand}-i`;
// 38. Renforts en échec (0044) : pause 30 min, puis 3 h après 2 échecs de suite ; statut d'usage inconnu = aucun changement.
const P11E = randomUUID(), SLUG_KE = `test-verif-${rand}-ke`;
async function controle38_renforts_echecs() {
  section("38. Renforts en échec (0044) : pause 30 min, 3 h après 2 échecs de suite, une seule ligne claire ; usage inconnu sans effet sur les modèles");
  await sql(`insert into projets (id, slug, nom, depot) values (${q(P11E)}, ${q(SLUG_KE)}, 'Projet de test K', 'rnab26/test-inexistant')`);
  const S1 = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S1)}, ${q(P11E)}, 'Objets', 1)`);
  for (const t of ["PAUSE 1", "PAUSE 2", "PAUSE 3"]) { const id = await creerChantier(P11E, { titre: t, etat: "libre", demande: `travail ${t}` }); await sql(`update chantiers set section_id = ${q(S1)} where id = ${q(id)}`); }
  await sql(`select regler_renforts(${q(SLUG_KE)}, 2, 3)`);
  const pause = async () => (await une(`select renforts_pause(${q(P11E)}, ${q(S1)}) as p`)).p;
  const nb = async () => (await une(`select count(*)::int as n from renforts where projet_id = ${q(P11E)}`)).n;
  verifie("sans historique : pas de pause", (await pause()).pause === false);
  const echec = (min, erreur = "scripts/cockpit-renfort.sh not found") => sql(`insert into renforts (projet_id, section_id, prefixe, statut, erreur, faits, created_at, vu_at) values (${q(P11E)}, ${q(S1)}, 'renfort/${randomUUID().slice(0, 6)}', 'erreur', ${q(erreur)}, 0, now() - interval '${min} minutes', now() - interval '${min - 2} minutes')`);
  await echec(10);
  let p = await pause();
  verifie("un échec en 2 min il y a 10 min : pause, 1 échec, cause reprise", p.pause === true && p.echecs === 1 && /not found/.test(p.cause), p);
  await sql(`select renforts_a_ouvrir(${q(SLUG_KE)}, true)`);
  verifie("pendant la pause, l'ouverture automatique ne recrée RIEN pour cette section", (await nb()) === 1);
  const msgs = async () => await sql(`select corps from messages where projet_id = ${q(P11E)} and corps like 'Renfort %en pause%'`);
  const m = await msgs();
  verifie("UNE ligne claire dans le fil : « Renfort … Objets : 1 échec, en pause jusqu'à HHhMM ; cause : … »", m.length === 1 && /Objets : 1 échec, en pause jusqu’à \d\dh\d\d ; cause : scripts/.test(m[0].corps), m);
  await sql(`select renforts_a_ouvrir(${q(SLUG_KE)}, true)`);
  verifie("repasser n'empile pas la ligne", (await msgs()).length === 1);
  await sql(`delete from renforts where projet_id = ${q(P11E)}`);
  await echec(40);
  verifie("échec vieux de 40 min : la pause de 30 min est finie", (await pause()).pause === false);
  await sql(`select renforts_a_ouvrir(${q(SLUG_KE)}, true)`);
  verifie("pause finie : un nouveau renfort peut s'ouvrir", (await nb()) === 2);
  await sql(`update renforts set statut = 'erreur', erreur = 'cockpit central unreachable', faits = 0, created_at = now() - interval '35 minutes', vu_at = now() - interval '33 minutes' where projet_id = ${q(P11E)} and statut = 'demande'`);
  p = await pause();
  verifie("2 échecs de suite : pause de 3 h (pas 30 min), 2 échecs", p.pause === true && p.echecs === 2 && new Date(p.jusqu_a) - Date.now() > 2 * 3600e3, p);
  const avant = await nb();
  await sql(`select renforts_a_ouvrir(${q(SLUG_KE)}, true)`);
  verifie("après 2 échecs de suite : rien de recréé", (await nb()) === avant);
  await sql(`insert into renforts (projet_id, section_id, prefixe, statut, faits, created_at, vu_at, fini_at) values (${q(P11E)}, ${q(S1)}, 'renfort/${randomUUID().slice(0, 6)}', 'fini', 2, now() - interval '20 minutes', now() - interval '5 minutes', now() - interval '5 minutes')`);
  verifie("un renfort qui a travaillé (faits > 0) remet le compteur à zéro", (await pause()).pause === false);

  // Usage : « status » (l’aide prise à la lettre) est refusé par le script avant toute écriture (sinon palier 3 = tout en Haiku).
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const avantP = (await une(`select palier from chefs where projet_id = ${q(P11E)}`))?.palier ?? null;
  const cli = spawnSync("bash", [join(racine, "scripts/chef.sh"), "--usage", "status"], { encoding: "utf8", env: { ...process.env, COCKPIT_PROJET: SLUG_KE } });
  const apresP = (await une(`select palier from chefs where projet_id = ${q(P11E)}`))?.palier ?? null;
  verifie("… et le palier du projet n’a pas bougé", apresP === avantP, { avantP, apresP });
  verifie("chef.sh --usage status : refusé côté script, avant toute écriture", cli.status === 2 && /inconnu/.test(cli.stderr), { status: cli.status, se: cli.stderr });
}

async function controle35_renforts_auto() {
  section("35. Renforts ouverts tout seuls (0040) : une seule règle, seuil réglable, interrupteur, frein, maximum, jamais un projet de test, origine visible");
  await sql(`insert into projets (id, slug, nom, depot) values (${q(P9)}, ${q(SLUG_I)}, 'Projet de test I', 'rnab26/test-inexistant')`);
  const S1 = randomUUID(), S2 = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S1)}, ${q(P9)}, 'Écran', 1), (${q(S2)}, ${q(P9)}, 'Base', 2)`);
  const enSection = async (sec, titre, etat = "libre") => { const id = await creerChantier(P9, { titre, etat, demande: `travail ${titre}` }); await sql(`update chantiers set section_id = ${q(sec)} where id = ${q(id)}`); return id; };
  const ids = [await enSection(S1, "AUTO Écran 1"), await enSection(S1, "AUTO Écran 2"), await enSection(S1, "AUTO Écran 3"), await enSection(S2, "AUTO Base 1"), await enSection(S2, "AUTO Base 2")];
  const cadrer = await enSection(S1, "AUTO à cadrer", "a_cadrer");
  const etat = async () => (await une(`select etat_renforts(${q(SLUG_I)}) as e`)).e;
  const vivants = async () => (await une(`select count(*)::int as n from renforts where projet_id = ${q(P9)} and statut in ('demande', 'actif')`)).n;

  await sql(`select regler_renforts(${q(SLUG_I)}, 2, 3)`);
  let e = await etat();
  verifie("la règle est en base : file 5 (jamais « à cadrer »), seuil 3 = agents par session (défaut), niveau « proche », rien ne bloque",
    e.auto?.file === 5 && e.auto.seuil === 3 && e.auto.seuil_defaut === true && e.auto.niveau === "proche" && e.auto.bloque === null && e.auto.actif === true
      && !e.attente.flatMap((a) => a.ids).includes(cadrer), e.auto);
  verifie("regler_renforts_auto refuse un seuil de 0 ou 21", !!(await erreurDe(`select regler_renforts_auto(${q(SLUG_I)}, true, 0)`)) && !!(await erreurDe(`select regler_renforts_auto(${q(SLUG_I)}, true, 21)`)));

  // Un projet de test n'est jamais servi (aucune vraie session) : rien n'est posé.
  const sansTest = (await une(`select renforts_a_ouvrir(${q(SLUG_I)}) as r`)).r;
  verifie("projet de test : renforts_a_ouvrir ne pose ni n'ouvre RIEN", sansTest.ouvrir.length === 0 && (await vivants()) === 0, sansTest);

  // Mode test : la file (5) atteint le seuil (3) → UN renfort, sur la section la plus chargée ; ce qui reste (2) < 3 : rien de plus.
  const a1 = (await une(`select renforts_a_ouvrir(${q(SLUG_I)}, true) as r`)).r;
  const r1 = await sql(`select id, origine, file_declenchement, seuil_declenchement, section_id, max_agents, statut from renforts where projet_id = ${q(P9)}`);
  verifie("la file atteint le seuil : UN renfort automatique, sur Écran (la plus chargée), avec la file (5) et le seuil (3) du moment, 3 agents",
    r1.length === 1 && r1[0].origine === "auto" && r1[0].file_declenchement === 5 && r1[0].seuil_declenchement === 3 && r1[0].section_id === S1 && r1[0].max_agents === 3 && a1.ouvrir.length === 1, { r1, a1 });
  await sql(`select renforts_a_ouvrir(${q(SLUG_I)}, true)`);
  verifie("repasser ne double rien (une section = un renfort, le reste de la file est sous le seuil)", (await vivants()) === 1);
  e = await etat();
  const ligne = e.renforts.find((r) => r.id === r1[0].id);
  verifie("etat_renforts dit l'origine : « auto », file 5, seuil 3 (l'écran écrit « ouvert automatiquement à HH h MM parce que… »)", ligne?.origine === "auto" && ligne.file === 5 && ligne.seuil === 3, ligne);
  const noMan = (await une(`select demander_renforts(${q(SLUG_I)}) as d`)).d;
  const manuels = await sql(`select origine from renforts where projet_id = ${q(P9)} and origine = 'manuel'`);
  verifie("le bouton manuel reste manuel (origine « manuel »)", noMan.demandes.length === 1 && manuels.length === 1, noMan);

  // Interrupteur, frein, réglage à 0, maximum : chacun bloque, et l'écran le sait (bloque).
  await sql(`update renforts set statut = 'erreur', faits = 1 where projet_id = ${q(P9)} and statut in ('demande', 'actif')`);
  await sql(`select regler_renforts_auto(${q(SLUG_I)}, false, null)`);
  await sql(`select renforts_a_ouvrir(${q(SLUG_I)}, true)`);
  verifie("interrupteur éteint : rien ne s'ouvre seul, bloque = eteint", (await vivants()) === 0 && (await etat()).auto.bloque === "eteint");
  await sql(`select regler_renforts_auto(${q(SLUG_I)}, true, null)`);
  await sql(`select freiner(${q(SLUG_I)}, 2, 'verifier-base')`);
  await sql(`select renforts_a_ouvrir(${q(SLUG_I)}, true)`);
  verifie("frein actif : rien ne s'ouvre seul, bloque = frein", (await vivants()) === 0 && (await etat()).auto.bloque === "frein");
  await sql(`select freiner(${q(SLUG_I)}, 0)`);
  await sql(`select regler_renforts(${q(SLUG_I)}, 0, 3)`);
  await sql(`select renforts_a_ouvrir(${q(SLUG_I)}, true)`);
  verifie("renforts réglés à 0 : rien ne s'ouvre seul, bloque = reglage_zero", (await vivants()) === 0 && (await etat()).auto.bloque === "reglage_zero");

  // Seuil réglé haut : la file (5) ne l'atteint pas → rien. Seuil 1 + maximum 1 : un seul renfort, jamais plus que le maximum.
  await sql(`select regler_renforts(${q(SLUG_I)}, 1, 3)`);
  await sql(`select regler_renforts_auto(${q(SLUG_I)}, true, 6)`);
  await sql(`select renforts_a_ouvrir(${q(SLUG_I)}, true)`);
  const haut = (await etat()).auto;
  verifie("seuil 6 > file 5 : rien ne s'ouvre, seuil_defaut = false, niveau nul", (await vivants()) === 0 && haut.seuil === 6 && haut.seuil_defaut === false && haut.niveau === null, haut);
  await sql(`select regler_renforts_auto(${q(SLUG_I)}, true, 1)`);
  await sql(`select renforts_a_ouvrir(${q(SLUG_I)}, true)`);
  verifie("seuil 1, maximum 1 : un seul renfort (le maximum jamais dépassé), ensuite bloque = plein", (await vivants()) === 1 && (await etat()).auto.bloque === "plein");

  // Droits : un membre non admin ne règle ni ne lit la règle.
  await sql(`insert into membres (projet_id, user_id) values (${q(P9)}, ${q(userId)}) on conflict do nothing`);
  const mReg = await rpcUtilisateur("regler_renforts_auto", { p_projet: SLUG_I, p_actif: false, p_seuil: null }, jwt);
  const mFile = await rpcUtilisateur("file_renforts", { p_projet_id: P9 }, jwt);
  const mAuto = await rpcUtilisateur("renforts_auto", { p_projet_id: P9 }, CLE_PUBLIQUE);
  verifie("un membre / anon : regler_renforts_auto refusé, file_renforts et renforts_auto fermés", mReg.status >= 400 && mFile.status >= 400 && mAuto.status >= 400, { mReg, mFile, mAuto });
}

async function controle33_depuis_un_fil() {
  section("33. « Il faudrait aussi X » dans un fil (0033) : chantier créé prêt à lancer, rangé, fils reliés, rien d'arraché — vrai chantier.sh");
  const sess = `agent/test-depuis-${rand}`;
  const lancer = (args) => spawnSync("bash", [join(RACINE_DEPOT, "scripts/chantier.sh"), "--projet", SLUG_A, "--session", sess, ...args], { encoding: "utf8", env: { ...process.env, COCKPIT_TOUR: "/nonexistent" } });
  const src = await creerChantier(P1, { titre: "Quadrant des ventes régionales", etat: "en_cours" });
  await une(`select ranger_chantier(${q(src)}::uuid, 'Ventes zorglub', 'verifier-base') as s`);
  const msgR = await creerMessage(P1, src, { corps: "il faudrait aussi un export pdf des factures fournisseurs", auteur_type: "proprietaire" });
  const avant = (await sql(`select message_id from messages_sans_reponse(${q(P1)}::uuid)`)).map((r) => r.message_id);
  verifie("avant : son message attend une réponse (messages_sans_reponse)", avant.includes(msgR), avant);

  const r1 = lancer(["--ouvrir", "Export pdf des factures fournisseurs", "--demande", "il faudrait aussi un export pdf des factures fournisseurs", "--depuis", src, "--reponse", "C’est noté : nouveau chantier, prêt à lancer."]);
  verifie("chantier.sh --depuis : « Nouveau chantier … prêt à lancer, non réservé, rangé dans « Ventes zorglub » »", r1.status === 0 && /prêt à lancer, non réservé, rangé dans « Ventes zorglub »/.test(r1.stdout), { status: r1.status, out: r1.stdout, err: r1.stderr });
  const nouveau = (await une(`select id from chantiers where projet_id = ${q(P1)} and titre = 'Export pdf des factures fournisseurs'`))?.id;
  const n = nouveau ? await chantier(nouveau) : null;
  const secN = n ? (await une(`select nom from sections where id = ${q(n.section_id)}`))?.nom : null;
  verifie("le nouveau chantier est LIBRE (Prêt à lancer), non réservé, origine session, dans la section du fil d'origine",
    n && n.etat === "libre" && n.pris_par === null && n.origine === "session" && secN === "Ventes zorglub", { n, secN });
  const rep = await une(`select * from messages where chantier_id = ${q(src)} and auteur_type = 'session' order by created_at desc limit 1`);
  verifie("fil d'origine : SA réponse, reliée au nouveau fil (chantier_lie) et à son message (repond_a)",
    rep && rep.corps === "C’est noté : nouveau chantier, prêt à lancer." && rep.chantier_lie === nouveau && rep.repond_a === msgR, rep);
  const apres = (await sql(`select message_id from messages_sans_reponse(${q(P1)}::uuid)`)).map((r) => r.message_id);
  verifie("après : son message a sa réponse (plus dans messages_sans_reponse)", !apres.includes(msgR), apres);
  const retour = await une(`select * from messages where chantier_id = ${q(nouveau)} order by created_at limit 1`);
  verifie("nouveau fil : « Chantier ouvert depuis le fil « … » », relié au fil d'origine",
    retour && retour.chantier_lie === src && contient(retour.corps, "Chantier ouvert depuis le fil « Quadrant des ventes régionales »"), retour);
  verifie("le chantier d'origine n'a pas bougé (état)", (await chantier(src)).etat === "en_cours");

  // Le sujet existe déjà et quelqu'un le tient : on COMPLÈTE, on n'arrache rien.
  await sql(`update chantiers set etat = 'en_cours', pris_par = 'autre-session', pris_jusqu_a = now() + interval '1 hour' where id = ${q(nouveau)}`);
  const r2 = lancer(["--ouvrir", "Export pdf des factures fournisseurs", "--demande", "et en csv aussi", "--depuis", src]);
  const n2 = await chantier(nouveau);
  verifie("même sujet déjà ouvert : demande AJOUTÉE, état et réservation intacts", r2.status === 0 && /demande ajoutée/.test(r2.stdout)
    && n2.etat === "en_cours" && n2.pris_par === "autre-session" && contient(n2.demande, "Ajouté depuis le fil « Quadrant des ventes régionales »") && contient(n2.demande, "et en csv aussi"), { out: r2.stdout, err: r2.stderr, n2 });
  const rep2 = await une(`select * from messages where chantier_id = ${q(src)} and auteur_type = 'session' order by created_at desc limit 1`);
  verifie("réponse par défaut dans le fil d'origine : « ajouté au chantier « … », qui existait déjà », avec le lien", rep2 && rep2.chantier_lie === nouveau && contient(rep2.corps, "qui existait déjà"), rep2);

  // Un chantier certifié n'est jamais rouvert : c'en est un nouveau.
  const fini = await creerChantier(P1, { titre: "Relance automatique des impayés", etat: "valide" });
  await sql(`update chantiers set archived_at = now() where id = ${q(fini)}`);
  const r3 = lancer(["--ouvrir", "Relance automatique des impayés", "--demande", "refaire la relance des impayés", "--depuis", src]);
  const neufs = await sql(`select id, etat from chantiers where projet_id = ${q(P1)} and titre = 'Relance automatique des impayés' order by created_at`);
  verifie("sujet d'un chantier certifié : un NOUVEAU chantier, le certifié reste certifié", r3.status === 0 && neufs.length === 2 && neufs.some((x) => x.id === fini && x.etat === "valide") && neufs.some((x) => x.id !== fini && x.etat === "libre"), { out: r3.stdout, err: r3.stderr, neufs });

  // Section donnée, correctif visuel rangé tout seul, sujet = le fil lui-même refusé.
  const r4 = lancer(["--ouvrir", "Tableau de bord des marges", "--demande", "un tableau des marges", "--depuis", src, "--section", "Finance zorglub"]);
  const c4 = await une(`select c.etat, s.nom from chantiers c left join sections s on s.id = c.section_id where c.projet_id = ${q(P1)} and c.titre = 'Tableau de bord des marges'`);
  verifie("--section : rangé dans la section donnée (créée si besoin)", r4.status === 0 && c4?.nom === "Finance zorglub", { out: r4.stdout, err: r4.stderr, c4 });
  const titreCorr = "Bouton trop petit sur téléphone";
  const estCorr = (await une(`select est_correctif(${q(titreCorr)}, 'bouton trop petit', 'session') as v`)).v;
  lancer(["--ouvrir", titreCorr, "--demande", "le bouton est trop petit", "--depuis", src]);
  const c5 = await une(`select s.nom from chantiers c left join sections s on s.id = c.section_id where c.projet_id = ${q(P1)} and c.titre = ${q(titreCorr)}`);
  verifie("correctif visuel né d'un fil : rangé dans « Correctifs » (0021), pas dans la section du fil", estCorr === true && c5?.nom === "Correctifs", { estCorr, c5 });
  const r6 = lancer(["--ouvrir", "Quadrant des ventes régionales", "--demande", "le quadrant des ventes", "--depuis", src]);
  verifie("sujet = le chantier du fil lui-même : refusé, raison dite", r6.status === 1 && /ressemble au chantier de ce fil/.test(r6.stderr), { status: r6.status, err: r6.stderr });

  // Depuis la « Discussion du projet » (aucun chantier) : même geste, réponse dans le fil du projet.
  const msgP = await creerMessage(P1, null, { corps: "et aussi un annuaire des transporteurs", auteur_type: "proprietaire" });
  const r7 = lancer(["--ouvrir", "Annuaire des transporteurs", "--demande", "et aussi un annuaire des transporteurs", "--depuis", "projet"]);
  const c7 = await une(`select id, etat, pris_par from chantiers where projet_id = ${q(P1)} and titre = 'Annuaire des transporteurs'`);
  const rep7 = await une(`select * from messages where projet_id = ${q(P1)} and chantier_id is null and auteur_type = 'session' order by created_at desc limit 1`);
  verifie("--depuis projet : créé prêt à lancer ; réponse dans la discussion du projet, reliée, qui répond à son message",
    r7.status === 0 && c7?.etat === "libre" && c7.pris_par === null && rep7?.chantier_lie === c7.id && rep7.repond_a === msgP, { out: r7.stdout, err: r7.stderr, c7, rep7 });

  const pirate = await rpcUtilisateur("ouvrir_depuis_fil", { p_source: src, p_titre: "Pirate", p_demande: "x", p_auteur: "x" }, jwt);
  const pirate2 = await rpcUtilisateur("trouver_chantier", { p_projet: SLUG_A, p_titre: "x", p_demande: "x" }, jwt);
  verifie("ouvrir_depuis_fil / trouver_chantier avec un JWT utilisateur → refusés", pirate.status >= 400 && pirate2.status >= 400, { pirate, pirate2 });
}

async function controle32_economie_modeles() {
  section("32. Économie des modèles (0035) : modèle de code / de lecture, effort, frein d'usage, revue « À toi » une fois par jour");
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const sid = `test-eco-${rand}`;
  const chef = (env = {}) => {
    try { return execFileSync("bash", [join(racine, "scripts/chef.sh"), ...(env.ARGS ?? [])], { encoding: "utf8", cwd: racine, env: { ...process.env, COCKPIT_PROJET: SLUG_A, CLAUDE_CODE_SESSION_ID: sid, ...env }, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  };
  await sql(`delete from chefs where projet_id = ${q(P1)}`);
  const d = await une(`select etat_modeles(${q(SLUG_A)}) as e`);
  verifie("défauts : code sonnet, lecture sonnet (Haiku en dernier), effort moyen, 2 agents, revue 24 h, pas de frein",
    d.e.modele_code === "sonnet" && d.e.modele_leger === "sonnet" && d.e.effort === "moyen" && d.e.agents === 2 && d.e.revue_h === 24 && d.e.frein.actif === false, d.e);
  const mauvais = await sql(`select regler_modeles(${q(SLUG_A)}, 'gpt', 'haiku', 'moyen') as r`).then(() => "accepté", (e) => e.message);
  verifie("un modèle inconnu est refusé", /Modèle de code/.test(String(mauvais)), mauvais);
  const cli = chef({ ARGS: ["--modeles", "opus", "haiku", "eleve", "4"] });
  const e2 = (await une(`select etat_modeles(${q(SLUG_A)}) as e`)).e;
  verifie("chef.sh --modeles : réglages enregistrés", /Modèles de/.test(cli) && e2.modele_code === "opus" && e2.effort === "eleve" && e2.agents === 4, { cli, e2 });
  chef({ ARGS: ["--modeles", "sonnet", "haiku", "moyen", "2"] });
  // La chef donne le modèle de chaque agent et l'effort.
  await une(`select prendre_chef(${q(SLUG_A)}, ${q(sid)}, 'agent/test', '') as r`);
  await sql(`update projets set autonome_toujours = true where id = ${q(P1)}`);
  for (const t of ["Eco un", "Eco deux"]) await creerChantier(P1, { titre: t, etat: "libre", demande: "test" });
  const normal = chef();
  verifie("chef.sh : chaque agent porte son modèle (code = sonnet) et l'effort est dit", /━━ Agent « [^»]+ » \[model: sonnet\]/.test(normal) && /effort de raisonnement — moyen/.test(normal), normal.slice(0, 1200));
  await sql(`update chantiers set etat = 'libre', pris_par = null, pris_jusqu_a = null where projet_id = ${q(P1)} and titre like 'Eco %'`);
  // Bascule (0037) : une session arrêtée sur la limite d'usage -> palier 3 : modèles descendus, MAIS le nombre d'agents ne bouge pas.
  await sql(`insert into sessions (id, projet_id, sujet, vu_at, pause_raison, pause_at) values (${q("pause-" + sid)}, ${q(P1)}, 'pause test', now(), 'rate_limit', now()) on conflict (id) do update set pause_raison = 'rate_limit', pause_at = now()`);
  const f = (await une(`select frein_actif(${q(P1)}) as f, palier_actif(${q(P1)}) as p`));
  verifie("une session en pause « rate_limit » = palier 3, sans frein d'agents", f.p === 3 && f.f.actif === false, f);
  const bas = chef();
  verifie("palier 3 : tous les agents en haiku, nombre d'agents inchangé (2), bascule dite",
    /BASCULE d’usage : palier 3/.test(bas) && !/\[model: sonnet\]/.test(bas) && (bas.match(/━━ Agent « /g) ?? []).length === 2 && !/FREIN d’usage/.test(bas), bas.slice(0, 1200));
  await sql(`delete from sessions where id = ${q("pause-" + sid)}`);
  chef({ ARGS: ["--frein", "2", "test du frein"] });
  verifie("chef.sh --frein 2 : frein posé à la main, puis levé par --frein 0",
    (await une(`select frein_actif(${q(P1)}) as f`)).f.actif === true && (chef({ ARGS: ["--frein", "0"] }), (await une(`select frein_actif(${q(P1)}) as f`)).f.actif === false));
  // Bascule par mesure d'usage : monte tout de suite, plafonne à haiku, interrupteur.
  // Échelle 0045 : effort d'abord, modèle ensuite, Haiku en dernier ; rythme = temps écoulé de la fenêtre (rate_limit_info n'a AUCUN %).
  const pal = async (st, pct, type = null, resetsDans = null) => (await une(`select bascule_usage(${q(SLUG_A)}, ${q(st)}, ${pct ?? "null"}, null, ${type ? q(type) : "null"}, ${resetsDans == null ? "null" : `extract(epoch from now() + interval '${resetsDans} minutes')::bigint`}) as e`)).e;
  const raz = () => sql(`update chefs set palier = 0, palier_at = null, palier_reset_at = null where projet_id = ${q(P1)}`);
  chef({ ARGS: ["--modeles", "opus", "sonnet", "eleve", "2"] });
  let e = await pal("allowed", null, "five_hour", 200);
  verifie("palier 0 : plein gaz, les modèles et l'effort réglés (opus/sonnet, élevé)", e.palier === 0 && e.effectifs.modele_code === "opus" && e.effectifs.modele_leger === "sonnet" && e.effectifs.effort === "eleve", e.effectifs);
  await raz();
  // Fenêtre de 5 h écoulée à 20 % (reset dans 240 min) : avertissement = on brûle trop vite → palier 2 ; effort bas, opus → sonnet, jamais sous sonnet.
  e = await pal("allowed_warning", null, "five_hour", 240);
  verifie("avertissement tôt dans la fenêtre : palier 2, effort bas, code opus → sonnet, lecture sonnet (jamais Haiku)", e.palier === 2 && e.effectifs.modele_code === "sonnet" && e.effectifs.modele_leger === "sonnet" && e.effectifs.effort === "bas" && e.fenetre?.type === "five_hour", e);
  await raz();
  e = await pal("allowed_warning", null, "five_hour", 100);
  verifie("avertissement après 50 % de la fenêtre : palier 1 = effort d'un cran plus bas, modèles inchangés", e.palier === 1 && e.effectifs.effort === "moyen" && e.effectifs.modele_code === "opus", e.effectifs);
  await raz();
  e = await pal("allowed_warning", null, "five_hour", 20);
  verifie("avertissement dans les 10 % finaux : palier 0, on consomme le crédit avant la remise à zéro", e.palier === 0 && e.effectifs.effort === "eleve", e);
  await raz();
  e = await pal("allowed", 40, "seven_day", 60 * 24 * 3);
  verifie("pourcentage sous le seuil (40 < 50) : palier 0", e.palier === 0, e);
  await raz();
  e = await pal("allowed", 90, "seven_day", 60 * 24 * 3);
  verifie("90 % à 57 % de la fenêtre de 7 jours (avance > 15 pts) : palier 2, pas Haiku", e.palier === 2 && e.effectifs.modele_code === "sonnet" && e.effectifs.effort === "bas", e);
  await raz();
  e = await pal("rejected", null, "five_hour", 120);
  verifie("limite atteinte (rejected) : palier 3, Haiku, effort bas", e.palier === 3 && e.effectifs.modele_code === "haiku" && e.effectifs.modele_leger === "haiku" && e.effectifs.effort === "bas", e);
  await sql(`update chefs set bascule_haiku = false where projet_id = ${q(P1)}`);
  verifie("Haiku non autorisé pour le projet : palier 3 reste sur Sonnet", (await une(`select etat_modeles(${q(SLUG_A)}) as e`)).e.effectifs.modele_code === "sonnet");
  const rs = await une(`select regler_bascule_seuils(${q(SLUG_A)}, 70, true) as e`);
  verifie("réglage par projet : seuil 70 % enregistré, Haiku de nouveau autorisé", rs.e.bascule_seuil_pct === 70 && rs.e.bascule_haiku === true && rs.e.effectifs.modele_code === "haiku", rs.e);
  const seuilMauvais = await sql(`select regler_bascule_seuils(${q(SLUG_A)}, 5, true) as r`).then(() => "accepté", (er) => er.message);
  verifie("un seuil hors 10 à 90 est refusé", /Seuil du plein gaz/.test(String(seuilMauvais)), seuilMauvais);
  await sql(`update chefs set bascule_seuil_pct = 50, bascule_haiku = true where projet_id = ${q(P1)}`);
  await raz();
  e = await pal("allowed_warning", null, "five_hour", 240);
  await sql(`update chefs set palier_reset_at = now() - interval '1 minute' where projet_id = ${q(P1)}`);
  verifie("nouvelle fenêtre (resetsAt passé) : retour au plein gaz", (await une(`select etat_modeles(${q(SLUG_A)}) as e`)).e.palier === 0);
  await raz();
  e = await pal("allowed", 90, "seven_day", 60 * 24 * 3);
  e = await pal("allowed", 5);
  verifie("pas de yo-yo : une mesure calme juste après ne redescend pas le palier", e.palier === 2, e);
  await sql(`update chefs set palier_at = now() - interval '31 minutes' where projet_id = ${q(P1)}`);
  e = await pal("allowed", 5);
  verifie("après 30 min de calme le palier redescend à 0", e.palier === 0, e);
  const ligne = chef({ ARGS: ["--usage", "rejected", "--fenetre", "five_hour", "--reset", String(Math.floor(Date.now() / 1000) + 7200)] });
  verifie("chef.sh --usage <status> --fenetre --reset : dit le palier, les modèles et l'effort à utiliser", /palier 3 sur 3/.test(ligne) && /code = haiku/.test(ligne) && /effort = bas/.test(ligne) && /nombre d’agents ne change pas/.test(ligne), ligne);
  chef({ ARGS: ["--bascule", "off"] });
  verifie("bascule off : retour aux modèles réglés malgré la mesure", (await une(`select etat_modeles(${q(SLUG_A)}) as e`)).e.effectifs.modele_code === "opus");
  chef({ ARGS: ["--bascule", "on"] });
  await sql(`update chefs set palier = 0, palier_at = null where projet_id = ${q(P1)}`);
  chef({ ARGS: ["--modeles", "sonnet", "haiku", "moyen", "2"] });
  const fh = (await sql(`select column_default from information_schema.columns where table_schema = 'cockpit' and table_name = 'projets' and column_name = 'revue_a_toi_delai_h'`))[0];
  verifie("revue « À toi » : une fois par jour par défaut (revue_a_toi_delai_h = 24)", /24/.test(fh?.column_default ?? ""), fh);
  const pirate = await rpcUtilisateur("freiner", { p_projet: SLUG_A, p_heures: 1, p_raison: "x" }, jwt);
  verifie("freiner / regler_modeles refusés à un membre non admin", pirate.status >= 400, pirate);
  await sql(`update projets set autonome_toujours = false where id = ${q(P1)}`);
}

// 34. Sessions qui se ferment seules (0038) : réglage, sessions relais finies, renforts finis après le délai, pas de réveil pour rien.
async function controle34_fermeture_sessions() {
  section("34. Sessions qui se ferment seules (0038) : réglage, relais finis, renforts finis après le délai, pas de réveil pour rien");
  const racine = dirname(dirname(fileURLToPath(import.meta.url)));
  const chef = (args) => {
    try { return execFileSync("bash", [join(racine, "scripts/chef.sh"), ...args], { encoding: "utf8", cwd: racine, env: { ...process.env, COCKPIT_PROJET: SLUG_A }, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  };
  const d = (await une(`select etat_fermeture(${q(SLUG_A)}) as e`)).e;
  verifie("défauts : fermeture automatique, 10 minutes de grâce", d.auto === true && d.delai_min === 10, d);
  const mauvais = await sql(`select regler_fermeture(${q(SLUG_A)}, true, 5000) as r`).then(() => "accepté", (e) => e.message);
  verifie("un délai hors 0-1440 est refusé", /1440/.test(String(mauvais)), mauvais);
  const cli = chef(["--fermeture", "oui", "15"]);
  verifie("chef.sh --fermeture : réglage enregistré", /oui, 15 min/.test(cli) && (await une(`select etat_fermeture(${q(SLUG_A)}) as e`)).e.delai_min === 15, cli);
  chef(["--fermeture", "oui", "10"]);
  // Session relais : finie seulement si rien ne l'attend.
  const oid = randomUUID();
  await sql(`insert into ouvertures (id, projet_id, session_distante, created_at) values (${q(oid)}, ${q(P1)}, 'session_test_fermeture', now() - interval '1 hour')`);
  const finie = async () => (await une(`select ouverture_finie(${q(oid)}) as f`)).f;
  await sql(`delete from messages where projet_id = ${q(P1)} and auteur_type in ('proprietaire', 'utilisateur') and kind in ('info', 'constat', 'reponse')`); // les messages de test des sections précédentes
  await sql(`delete from messages where projet_id = ${q(P1)} and kind in ('question', 'action') and answered_at is null`);
  await sql(`update chantiers set etat = 'libre', pris_par = null, pris_jusqu_a = null where projet_id = ${q(P1)} and etat = 'en_cours'`);
  verifie("relais ouvert depuis plus que le délai, rien en attente : à fermer", await finie() === true);
  verifie("… et listé par ouvertures_a_fermer", JSON.stringify((await une(`select ouvertures_a_fermer(${q(SLUG_A)}) as r`)).r).includes(oid));
  const qid = randomUUID();
  await sql(`insert into messages (id, projet_id, auteur, auteur_type, kind, corps) values (${q(qid)}, ${q(P1)}, 'session', 'session', 'question', 'Test fermeture ?')`);
  verifie("une question posée depuis son ouverture sans réponse : PAS fermée", await finie() === false);
  await sql(`delete from messages where id = ${q(qid)}`);
  const ch = randomUUID();
  await sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, pris_jusqu_a) values (${q(ch)}, ${q(P1)}, 'Fermeture test', 'x', 'en_cours', 'agent/x', now() + interval '1 hour')`);
  verifie("un chantier en cours réservé : PAS fermée", await finie() === false);
  await sql(`delete from chantiers where id = ${q(ch)}`);
  await sql(`update projets set fermeture_delai_min = 120 where id = ${q(P1)}`);
  verifie("délai de grâce plus long que l'âge de la session : PAS fermée", await finie() === false);
  await sql(`update projets set fermeture_delai_min = 10, fermeture_auto = false where id = ${q(P1)}`);
  verifie("fermeture automatique éteinte : jamais fermée", await finie() === false);
  await sql(`update projets set fermeture_auto = true where id = ${q(P1)}`);
  verifie("chef.sh --ouverture-archive la note archivée, puis plus jamais proposée",
    /archivée/.test(chef(["--ouverture-archive", oid])) && await finie() === false);
  await sql(`delete from ouvertures where id = ${q(oid)}`);
  // Renfort fini : archivé seulement après le délai de grâce.
  const rid = randomUUID();
  await sql(`insert into renforts (id, projet_id, prefixe, statut, session_distante, fini_at) values (${q(rid)}, ${q(P1)}, 'renfort/tf0', 'fini', 'session_test_renfort', now())`);
  const dans = async () => JSON.stringify((await une(`select renforts_a_ouvrir(${q(SLUG_A)}, true) as r`)).r.archiver).includes(rid);
  verifie("renfort fini à l'instant : pas encore archivé (délai de grâce)", await dans() === false);
  await sql(`update renforts set fini_at = now() - interval '1 hour' where id = ${q(rid)}`);
  verifie("renfort fini depuis plus que le délai : à archiver", await dans() === true);
  await sql(`update projets set fermeture_auto = false where id = ${q(P1)}`);
  verifie("fermeture automatique éteinte : le renfort fini n'est plus proposé", await dans() === false);
  await sql(`update projets set fermeture_auto = true where id = ${q(P1)}`);
  await sql(`delete from renforts where id = ${q(rid)}`);
  // Pas de réveil (session neuve) quand il n'y a rien à servir.
  const vide = `test-ferm-${rand}`;
  const pv = randomUUID();
  await sql(`insert into projets (id, slug, nom) values (${q(pv)}, ${q(vide)}, 'Projet de test fermeture')`);
  const r1 = (await une(`select reveiller_chef(${q(pv)}, null, 'message') as r`)).r;
  verifie("réveil immédiat sans message ni réponse à servir : aucune session ouverte (rien_a_servir)", r1 === "rien_a_servir", r1);
  await sql(`delete from projets where id = ${q(pv)}`);
}

const P11 = randomUUID(), SLUG_K = `test-verif-${rand}-k`;
async function controle38_filet_securite() {
  section("38. Filet de sécurité (0044) : du travail attend + personne de vivant = un réveil journalisé ; sinon rien");
  await sql(`insert into projets (id, slug, nom) values (${q(P11)}, ${q(SLUG_K)}, 'Projet de test filet')`);
  const passe = async (test = true, simuler = true) => (await une(`select filet_passe(${q(SLUG_K)}, ${simuler}, ${test}) as r`)).r[0]?.resultat;
  const journal = async () => (await une(`select count(*)::int as n from filet_reveils where projet_id = ${q(P11)}`)).n;
  const vieux = (min) => sql(`insert into messages (projet_id, auteur, auteur_type, kind, corps, created_at) values (${q(P11)}, 'Raphaël', 'proprietaire', 'info', 'Peux-tu regarder ça ?', now() - interval '${min} minutes')`);
  // Le cron existe, actif, toutes les 3 minutes ; les fonctions ne sont pas ouvertes au public.
  const cron = await une(`select active, schedule from cron.job where jobname = 'cockpit-filet-securite'`).catch(() => null);
  verifie("pg_cron : le job cockpit-filet-securite existe, actif, toutes les 3 minutes", cron?.active === true && cron.schedule === "*/3 * * * *", cron);
  const droits = await une(`select has_function_privilege('anon', 'cockpit.filet_passe(text,boolean,boolean)', 'execute') as anon,
    has_function_privilege('authenticated', 'cockpit.filet_passe(text,boolean,boolean)', 'execute') as auth,
    has_function_privilege('authenticated', 'cockpit.reveiller_chef(uuid,uuid,text)', 'execute') as reveil,
    has_function_privilege('service_role', 'cockpit.filet_passe(text,boolean,boolean)', 'execute') as srv`);
  verifie("filet_passe et reveiller_chef : réservés au service (ni anon ni authenticated)", !droits.anon && !droits.auth && !droits.reveil && droits.srv, droits);
  verifie("rien n'attend : aucun réveil", await passe() === "rien_en_attente" && await journal() === 0);
  await vieux(1);
  verifie("travail arrivé il y a 1 min : on laisse la chef et les hooks d'abord (trop_recent)", await passe() === "trop_recent" && await journal() === 0);
  await sql(`delete from messages where projet_id = ${q(P11)}`);
  await vieux(30);
  verifie("projet de test sans p_test : jamais réveillé", await passe(false, true) === "projet_de_test" && await journal() === 0);
  const sid = `test-filet-${rand}`;
  await sql(`insert into sessions (id, projet_id, branche, vu_at) values (${q(sid)}, ${q(P11)}, 'claude/vivante-filet', now())`);
  verifie("travail en attente + session vivante : aucun réveil", await passe() === "session_vivante" && await journal() === 0);
  await sql(`delete from sessions where id = ${q(sid)}`);
  await sql(`update projets set filet_actif = false where id = ${q(P11)}`);
  verifie("interrupteur du projet éteint : aucun réveil", await passe() === "eteint" && await journal() === 0);
  await sql(`update projets set filet_actif = true where id = ${q(P11)}`);
  verifie("travail en attente depuis 30 min + personne de vivant : un réveil journalisé", await passe() === "simule" && await journal() === 1);
  const j = await une(`select pourquoi, resultat from filet_reveils where projet_id = ${q(P11)}`);
  verifie("… avec son pourquoi", /1 message\(s\) sans réponse/.test(j.pourquoi) && j.resultat === "simule", j);
  verifie("deux passes rapprochées : un seul réveil (anti-rafale 5 min)", await passe() === "trop_tot" && await journal() === 1);
  await sql(`update filet_reveils set at = now() - interval '10 minutes' where projet_id = ${q(P11)}`);
  await sql(`update projets set filet_plafond_jour = 1 where id = ${q(P11)}`);
  verifie("plafond du jour atteint : aucun réveil de plus", await passe() === "plafond" && await journal() === 1);
  await sql(`update projets set filet_plafond_jour = 2 where id = ${q(P11)}`);
  verifie("plafond relevé et 5 min passées : le réveil repart", await passe() === "simule" && await journal() === 2);
  // Sans jeton : le vrai chemin (sans simulation) n'appelle rien et ne journalise rien.
  await sql(`delete from filet_reveils where projet_id = ${q(P11)}`);
  const r = await passe(true, false);
  verifie("sans jeton : rien n'est appelé, rien n'est journalisé (pas_configure)", r === "pas_configure" && await journal() === 0, r);
  // Réglages : bornes, et la ligne d'écran.
  const mauvais = await sql(`select regler_filet(${q(SLUG_K)}, null, 99, null) as r`).then(() => "accepté", (e) => e.message);
  verifie("plafond hors 0-48 refusé", /48/.test(String(mauvais)), mauvais);
  const e = (await une(`select etat_filet(${q(SLUG_K)}) as e`)).e;
  verifie("etat_filet d'un projet de test : statut « test », jamais un réveil promis", e.statut === "test" && e.plafond === 2, e);
  // Le vrai cron ne touche jamais un projet de test.
  const vraie = await une(`select filet_passe() as r`);
  verifie("filet_passe() sans argument : le projet de test n'est pas réveillé", !JSON.stringify(vraie.r).includes(SLUG_K) || vraie.r.find((x) => x.projet === SLUG_K)?.resultat === "projet_de_test", vraie.r);
  const reel = await une(`select count(*)::int as n from filet_reveils f join projets p on p.id = f.projet_id where f.simule and p.slug not like 'test-%'`);
  verifie("aucun réveil simulé sur un vrai projet", reel.n === 0, reel);
}

// 40. Libération automatique (0050) : le job pg_cron libère seul un chantier tenu par une session morte, jamais un vivant, jamais un projet de test au vrai cron.
const PLB = randomUUID(), SLUG_LB = `test-verif-${rand}-lb`;
async function controle40_liberation_auto() {
  section("40. Libération automatique (0050) : pg_cron toutes les 3 min libère le chantier d'une session morte, une seule règle");
  await sql(`insert into projets (id, slug, nom) values (${q(PLB)}, ${q(SLUG_LB)}, 'Projet de test libération')`);
  const cron = await une(`select active, schedule from cron.job where jobname = 'cockpit-liberation-auto'`).catch(() => null);
  verifie("pg_cron : le job cockpit-liberation-auto existe, actif, toutes les 3 minutes", cron?.active === true && cron.schedule === "*/3 * * * *", cron);
  const droits = await une(`select has_function_privilege('anon', 'cockpit.liberation_passe(text,boolean)', 'execute') as anon, has_function_privilege('authenticated', 'cockpit.liberer_silencieux_coeur(text)', 'execute') as coeur, has_function_privilege('service_role', 'cockpit.liberation_passe(text,boolean)', 'execute') as srv`);
  verifie("liberation_passe / liberer_silencieux_coeur : réservés au service", !droits.anon && !droits.coeur && droits.srv, droits);
  const mort = await creerChantier(PLB, { titre: "LIBÉRATION Session morte", etat: "en_cours" });
  const frais = await creerChantier(PLB, { titre: "LIBÉRATION Réservation fraîche", etat: "en_cours" });
  await sql(`update chantiers set pris_par = 'agent/mort', pris_jusqu_a = now() + interval '60 minutes' where id in (${q(mort)}, ${q(frais)})`);
  await sql(`set local session_replication_role = replica; update chantiers set updated_at = now() - interval '45 minutes' where id = ${q(mort)}`);
  const tenu = async (id) => (await une(`select pris_jusqu_a > now() as encore from chantiers where id = ${q(id)}`)).encore;
  const vraie = await une(`select liberation_passe() as r`);
  verifie("liberation_passe() sans argument : le projet de test n'est pas touché", await tenu(mort) === true && !JSON.stringify(vraie.r).includes(SLUG_LB), vraie.r);
  await sql(`update projets set liberation_auto = false where id = ${q(PLB)}`);
  const eteint = (await une(`select liberation_passe(${q(SLUG_LB)}, true) as r`)).r[0]?.resultat;
  verifie("interrupteur du projet éteint : rien n'est libéré", eteint === "eteint" && await tenu(mort) === true, eteint);
  await sql(`update projets set liberation_auto = true where id = ${q(PLB)}`);
  const r = (await une(`select liberation_passe(${q(SLUG_LB)}, true) as r`)).r[0];
  verifie("passe : le chantier de la session morte est libéré, la réservation fraîche reste tenue", r?.resultat === "libere" && r.n === 1 && await tenu(mort) === false && await tenu(frais) === true, r);
  verifie("la fiche dit qui (libere_de)", (await une(`select libere_de from chantiers where id = ${q(mort)}`)).libere_de === "agent/mort");
  const refus = await rpcUtilisateur("liberation_passe", { p_slug: SLUG_LB, p_test: true }, jwt);
  verifie("liberation_passe : refusée à un membre connecté", refus.status >= 400, refus.status);
}

// 42. Renforts : un frein d'usage ne met pas une demande en erreur (0053) ; erreurs effaçables, relançables.
const PRE = randomUUID(), SLUG_RE = `test-verif-${rand}-re`;
async function controle42_renforts_frein_erreurs() {
  section("42. Renforts et frein d'usage (0053) : demande retenue sans erreur, 3 h comptées après la levée, erreurs effaçables seules ou d'un geste, relance");
  await sql(`insert into projets (id, slug, nom, depot) values (${q(PRE)}, ${q(SLUG_RE)}, 'Projet de test renforts', 'rnab26/test-inexistant')`);
  const S = randomUUID();
  await sql(`insert into sections (id, projet_id, nom, position) values (${q(S)}, ${q(PRE)}, 'Écran', 1)`);
  const c1 = await creerChantier(PRE, { titre: "FREIN Chantier un", etat: "libre", demande: "travail" });
  await sql(`update chantiers set section_id = ${q(S)} where id = ${q(c1)}`);
  await sql(`select regler_renforts(${q(SLUG_RE)}, 2, 3)`);
  const ligne = async () => (await une(`select r.statut, r.erreur, renfort_vivant(r) as vivant from renforts r where r.projet_id = ${q(PRE)} and r.efface_at is null order by r.created_at desc limit 1`));
  const etat = async () => (await une(`select etat_renforts(${q(SLUG_RE)}) as e`)).e;
  // frein actif 2 h, demande vieille de 4 h : ni expirée ni en erreur
  await sql(`insert into renforts (projet_id, section_id, prefixe, statut, chantiers, created_at) values (${q(PRE)}, ${q(S)}, 'renfort/frein1', 'demande', 1, now() - interval '4 hours')`);
  await sql(`update chefs set frein_jusqu_a = now() + interval '2 hours', frein_raison = 'test' where projet_id = ${q(PRE)}`);
  await sql(`select renforts_expirer(${q(PRE)})`);
  let l = await ligne();
  verifie("frein actif : une demande de 4 h reste « demande », vivante, sans erreur", l.statut === "demande" && l.vivant === true && !l.erreur, l);
  let e = await etat();
  verifie("etat_renforts : la demande porte frein_jusqu_a, et l'état global aussi", !!e.renforts[0].frein_jusqu_a && !!e.frein_jusqu_a, e.renforts[0]);
  await sql(`update chefs set frein_jusqu_a = now() - interval '1 hour' where projet_id = ${q(PRE)}`);
  await sql(`select renforts_expirer(${q(PRE)})`);
  l = await ligne();
  verifie("frein levé il y a 1 h : la demande reste vivante (3 h comptées depuis la levée)", l.statut === "demande" && l.vivant === true, l);
  await sql(`update chefs set frein_jusqu_a = now() - interval '4 hours' where projet_id = ${q(PRE)}`);
  await sql(`select renforts_expirer(${q(PRE)})`);
  l = await ligne();
  verifie("3 h écoulées APRÈS la levée : vraie erreur « Jamais ouvert »", l.statut === "erreur" && /Jamais ouvert/.test(l.erreur), l);
  const datee = await une(`select erreur_at is not null as ok from renforts where projet_id = ${q(PRE)} and prefixe = 'renfort/frein1'`);
  verifie("l'erreur est datée (erreur_at posé par le trigger)", datee.ok === true);
  e = await etat();
  verifie("l'erreur récente est affichée", e.renforts.some((r) => r.statut === "erreur"), e.renforts);
  await sql(`select regler_renforts_erreurs(${q(SLUG_RE)}, 6)`);
  await sql(`update renforts set erreur_at = now() - interval '7 hours' where projet_id = ${q(PRE)} and statut = 'erreur'`);
  e = await etat();
  verifie("plus vieille que le délai réglé (6 h) : masquée seule", e.erreurs_efface_h === 6 && !e.renforts.some((r) => r.statut === "erreur"), e.renforts);
  await sql(`select regler_renforts_erreurs(${q(SLUG_RE)}, 0)`);
  e = await etat();
  verifie("délai 0 = jamais effacée seule : l'erreur revient", e.renforts.some((r) => r.statut === "erreur"), e.renforts);
  const refuse = await sql(`select regler_renforts_erreurs(${q(SLUG_RE)}, 999)`).then(() => false, () => true);
  verifie("délai hors bornes (999) refusé", refuse === true);
  const rel = await une(`select relancer_renfort(r.id) as r from renforts r where r.projet_id = ${q(PRE)} and r.statut = 'erreur' and r.efface_at is null limit 1`);
  const apres = await etat();
  verifie("Relancer : une nouvelle demande pour la section, l'ancienne n'est plus affichée", rel.r.chantiers === 1 && apres.renforts.length === 1 && apres.renforts[0].statut === "demande", apres.renforts);
  const bad = await une(`select relancer_renfort(r.id) as r from renforts r where r.projet_id = ${q(PRE)} and r.statut = 'demande' and r.efface_at is null limit 1`).then(() => false, () => true);
  verifie("Relancer une demande saine est refusé", bad === true);
  await sql(`update renforts set created_at = now() - interval '9 hours' where projet_id = ${q(PRE)} and statut = 'demande'`);
  await sql(`update chefs set frein_jusqu_a = null where projet_id = ${q(PRE)}`);
  await sql(`select renforts_expirer(${q(PRE)})`);
  const n = (await une(`select effacer_erreurs_renforts(${q(SLUG_RE)}) as n`)).n;
  const total = (await une(`select count(*)::int as n from renforts where projet_id = ${q(PRE)}`)).n;
  verifie("Effacer les erreurs : lignes masquées, aucune supprimée", n >= 1 && (await etat()).renforts.length === 0 && total >= 2, { n, total });
  const droits = await une(`select has_function_privilege('anon', 'cockpit.effacer_erreurs_renforts(text)', 'execute') as a1, has_function_privilege('anon', 'cockpit.relancer_renfort(uuid)', 'execute') as a2, has_function_privilege('anon', 'cockpit.renfort_demande_depuis(cockpit.renforts)', 'execute') as a3`);
  verifie("droits : rien d'exécutable par anon", !droits.a1 && !droits.a2 && !droits.a3, droits);
}

async function controle41_reglages_notifications() {
  section("41. Réglages des notifications (0052) : types et projets par personne, filtrage serveur, une seule règle");
  const types = await sql(`select code, defaut, emis from notif_types order by ordre`);
  verifie("catalogue : « reponse » est émis et allumé par défaut", types.find((t) => t.code === "reponse")?.emis === true && types.find((t) => t.code === "reponse")?.defaut === true, types);
  verifie("catalogue : seuls les types réellement émis ont un push (les autres sont « bientôt »)", types.filter((t) => t.emis).map((t) => t.code).join() === "reponse", types);
  const droits = await une(`select has_function_privilege('authenticated', 'cockpit.notif_destinataires(text,uuid)', 'execute') as d, has_function_privilege('anon', 'cockpit.notif_veut(uuid,text,uuid)', 'execute') as v, has_function_privilege('service_role', 'cockpit.notif_destinataires(text,uuid)', 'execute') as s`);
  verifie("notif_destinataires / notif_veut : réservées au service (revoke public)", !droits.d && !droits.v && droits.s, droits);
  const rls = await une(`select (select relrowsecurity and relreplident = 'f' from pg_class where oid = 'cockpit.notif_reglages'::regclass) as reglages, (select relrowsecurity and relreplident = 'f' from pg_class where oid = 'cockpit.notif_types'::regclass) as catalogue`);
  verifie("RLS activée et replica identity full sur les deux tables", rls.reglages === true && rls.catalogue === true, rls);
  const moi = await rest("notif_reglages", { methode: "POST", jwt, prefer: "resolution=merge-duplicates,return=representation", corps: { user_id: userId, types: { reponse: false }, projets_coupes: [P2] } });
  verifie("une personne pose SES réglages", moi.status < 300 && moi.json?.[0]?.types?.reponse === false, moi);
  const autre = await rest("notif_reglages", { methode: "POST", jwt, corps: { user_id: randomUUID(), types: {}, projets_coupes: [] } });
  verifie("elle ne peut pas écrire ceux d'une autre personne", autre.status >= 400, autre.status);
  const lus = await rest("notif_reglages?select=user_id", { jwt });
  verifie("elle ne lit que les siens", Array.isArray(lus.json) && lus.json.every((l) => l.user_id === userId), lus.json);
  const veut = async (type, projet) => (await une(`select notif_veut(${q(userId)}, ${q(type)}, ${q(projet)}) as v`)).v;
  verifie("règle : type coupé → ne veut pas", (await veut("reponse", P1)) === false);
  await sql(`update notif_reglages set types = '{}', projets_coupes = array[${q(P2)}]::uuid[] where user_id = ${q(userId)}`);
  verifie("règle : aucun choix → le défaut du catalogue (voulu)", (await veut("reponse", P1)) === true);
  verifie("règle : projet coupé → ne veut pas, les autres oui", (await veut("reponse", P2)) === false && (await veut("reponse", P1)) === true);
  verifie("règle : type inconnu → jamais voulu", (await veut("inconnu", P1)) === false);
  const test = await une(`select count(*)::int as n from notif_destinataires('reponse', ${q(P1)})`);
  verifie("destinataires : jamais pour un projet de test", test.n === 0, test);
  const reel = await une(`select id from projets where slug not like 'test-%' limit 1`);
  if (reel) {
    verifie("destinataires : un type non émis n'a aucun destinataire", (await une(`select count(*)::int as n from notif_destinataires('a_toi', ${q(reel.id)})`)).n === 0);
    await sql(`update notif_reglages set projets_coupes = array[${q(reel.id)}]::uuid[] where user_id = ${q(userId)}`);
    verifie("destinataires : la personne qui a coupé ce projet n'y figure pas", (await une(`select count(*)::int as n from notif_destinataires('reponse', ${q(reel.id)}) where user_id = ${q(userId)}`)).n === 0);
  }
  await sql(`delete from notif_reglages where user_id = ${q(userId)}`);
}

try {
  await purgerRestesDePassesPrecedentes();
  await sql(`insert into projets (id, slug, nom) values (${q(P1)}, ${q(SLUG_A)}, 'Projet de test A'), (${q(P2)}, ${q(SLUG_B)}, 'Projet de test B')`);
  userId = await creerCompte(EMAIL, MOT_DE_PASSE);
  jwt = await connecter(EMAIL, MOT_DE_PASSE);
  await sql(`insert into membres (projet_id, user_id) values (${q(P1)}, ${q(userId)})`);
  const admin = await une(`select count(*)::int as n from admins where user_id = ${q(userId)}`);
  if (admin.n !== 0) throw new Error("le compte de test est admin : les contrôles RLS n'auraient aucun sens");

  const etapes = [
  // UN contrôle par ligne : en ajouter un = UNE ligne, insérée à côté du contrôle de ton sujet (pas en fin de liste : deux ajouts au même endroit se marchent dessus).
    controle1_reservation,
    controle2_historique,
    controle3_suppression,
    async () => { const c = await controle4_certifier(); await controle5_corriger(c); },
    controle6_repondre,
    controle7_fusionner,
    controle8_activite,
    controle9_marquer_vu,
    async () => { const ctx = await controle10_rls_membre(); await controle11_rls_non_membre(ctx); },
    controle12_realtime,
    controle13_exec_sql,
    controle14_sessions_agents_fusions,
    controle15_limites_autonome,
    controle16_medias,
    controle17_verifie_pour_moi,
    controle18_reponses_prises,
    controle19_chef_par_projet,
    controle20_images_session,
    controle23_a_toi_a_jour,
    controle24_ou_en_est,
    controle21_aucun_reste_de_test,
    controle22_correctifs,
    controle25_renforts,
    controle26_fil_discussion,
    controle27_question_gardee,
    controle28_messages_de_session,
    controle29_synchro,
    controle30_agents_fantomes,
    controle32_economie_modeles,
    controle33_depuis_un_fil,
    controle34_fermeture_sessions,
    controle35_renforts_auto,
    controle36_deplacer_chantier,
    controle37_pr_a_fusionner,
    controle37_accuse_action,
    controle37_fusion_auto,
    controle37_traite_sans_attendre,
    controle38_pr_propre,
    controle38_prochaine_migration,
    controle38_verif_sans_retour,
    controle38_filet_securite,
    controle38_renforts_echecs,
    controle39_delai_sans_signe,
    controle40_liberation_auto,
    controle41_reglages_notifications,
    controle42_renforts_frein_erreurs,
  ];
  // SEUL=41 : ne joue que le contrôle « controle41_… » (passe ciblée, économe) ; sans SEUL, tout.
  for (const etape of etapes.filter((e) => !process.env.SEUL || (e.name ?? "").startsWith(`controle${process.env.SEUL}_`))) {
    try { await etape(); }
    catch (e) { verifie(`${etape.name || "bloc"} : s'est terminé sans planter`, false, e.message); }
  }
} finally {
  section("nettoyage");
  try { if (ws) ws.close(); } catch {}
  const problemes = [];
  if (userId) { if (!(await supprimerCompte(userId))) problemes.push(`compte ${userId} non supprimé`); }
  try { await purgerProjetsDeTest([P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, PLB, PRE]); } catch (e) { problemes.push(`projets : ${e.message}`); }
  // Les médias de test (0013) : le stockage n'est pas en cascade des projets.
  try {
    const noms = (await sql(`select coalesce(jsonb_agg(name), '[]'::jsonb) as noms from storage.objects where bucket_id = 'cockpit-medias' and (name like ${q(P1 + '/%')} or name like ${q(P2 + '/%')})`))[0]?.noms ?? [];
    if (noms.length) await fetch(`${URL_}/storage/v1/object/cockpit-medias`, { method: "DELETE", headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: noms }) });
    const reste = (await une(`select count(*)::int as n from storage.objects where bucket_id = 'cockpit-medias' and (name like ${q(P1 + '/%')} or name like ${q(P2 + '/%')})`)).n;
    if (reste) problemes.push(`${reste} média(s) de test non supprimé(s)`);
  } catch (e) { problemes.push(`médias : ${e.message}`); }
  const restes = await une(`select (select count(*) from projets where id in (${q(P1)}, ${q(P2)}, ${q(P3)}, ${q(P4)}, ${q(P5)}, ${q(P6)}, ${q(P7)}, ${q(P8)}, ${q(P9)}, ${q(P10)}, ${q(P11)}, ${q(PLB)}, ${q(PRE)}))::int as projets,
                                   (select count(*) from supprimes where projet_id in (${q(P1)}, ${q(P2)}, ${q(P3)}, ${q(P4)}, ${q(P5)}, ${q(P6)}, ${q(P7)}, ${q(P8)}, ${q(P9)}, ${q(P10)}, ${q(P11)}, ${q(PLB)}, ${q(PRE)}))::int as supprimes,
                                   (select count(*) from visites where user_id = ${q(userId)})::int as visites`).catch(() => null);
  const compte = await authAdmin(`admin/users?per_page=10&filter=${encodeURIComponent(EMAIL)}`).catch(() => null);
  const compteReste = (compte?.json?.users ?? []).some((u) => u.email === EMAIL);
  verifie("tout est supprimé : projets de test, traces supprimes/historique, visites, compte auth",
    problemes.length === 0 && restes && restes.projets === 0 && restes.supprimes === 0 && restes.visites === 0 && !compteReste,
    { problemes, restes, compteReste });
}
console.log(`\nverifier-base : ${total - echecs}/${total} en ${((Date.now() - debut) / 1000).toFixed(1)} s`);
process.exit(echecs ? 1 : 0);
