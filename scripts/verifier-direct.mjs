#!/usr/bin/env node
// Non-régression : le cockpit et les sessions sont branchés EN DIRECT (14 oct. 2026, migration 0087).
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verifier-direct.mjs
//
// Raphaël : « cela doit être de l'instantané […] des sessions ouvertes où les chantiers ne se créent pas
// automatiquement, pas de barre de progression […] des doublons quand je réponds des deux côtés ».
// VRAIS hooks (hooks/suivi.sh), VRAIE base, projet jetable `test-verif-direct-*` supprimé à la fin :
//   1. un message de travail dans une session ouvre TOUT SEUL un chantier réservé à elle, message déposé dans son fil
//   2. un 2e message ne crée rien (même chantier) ; un « merci » n'ouvre rien
//   3. un chantier ouvert ressemblant est REPRIS (pas de doublon) ; un livré n'est jamais rouvert
//   4. le premier --ouvrir de la session remplace le titre approximatif, sans créer de doublon
//   5. un outil lancé met l'action en direct sur la barre ; la fin du tour la passe « en attente »
//   6. un message écrit dans le cockpit au niveau du projet arrive à la session AU PROCHAIN PAS, réclamé : une seule session le reçoit
//   7. une carte répondue que personne ne tient arrive aussi ; la chef ne la reprend pas pendant 20 min
//   8. sans PreToolUse : le battement part à l'événement du message et s'arrête à Stop
//   9. demander.sh --repondu ferme une carte répondue dans la session (pas de doublon de réponse)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { purgerPassesPrecedentes, purgerProjetsDeTest } from "./bancs.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = join(RACINE, "scripts/sql.sh");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY absente."); process.exit(2); }
let total = 0, echecs = 0;
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? " — " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 500) : ""}`); } };
const q = (s) => s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`;
function sql(requete) {
  const r = spawnSync(SQL, [requete], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}");
  if (!j.ok) throw new Error(`SQL refusé : ${j.error ?? r.stderr}\n  ${requete.slice(0, 200)}`);
  return j.rows ?? [];
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = randomUUID().slice(0, 8);
const SLUG = `test-verif-direct-${rand}`, P = randomUUID();
const dossier = mkdtempSync(join(tmpdir(), "cockpit-direct-"));
const TMP = join(dossier, "tmp"); mkdirSync(TMP);
function depot(nom, branche) { const d = join(dossier, nom); mkdirSync(d); spawnSync("git", ["init", "-q", "-b", branche, d]); return d; }
const DIR_A = depot("a", "claude/direct-a"), DIR_B = depot("b", "claude/direct-b");
const env = (dir) => ({ ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: dir, COCKPIT_SQL: SQL, TMPDIR: TMP, COCKPIT_REP_INTERVALLE: "0", COCKPIT_LIVE_INTERVALLE: "0", COCKPIT_BATTEMENT_PAS: "1" });
function suivi(dir, entree) {
  const r = spawnSync("bash", [join(RACINE, "hooks/suivi.sh")], { input: JSON.stringify(entree), encoding: "utf8", env: env(dir), timeout: 60000 });
  try { return JSON.parse((r.stdout || "").trim())?.hookSpecificOutput?.additionalContext ?? ""; } catch { return ""; }
}
const prompt = (dir, sid, texte) => suivi(dir, { session_id: sid, hook_event_name: "UserPromptSubmit", prompt: texte });

try {
  await purgerPassesPrecedentes(sql, "test-verif-direct-");
  sql(`insert into projets (id, slug, nom) values (${q(P)}, ${q(SLUG)}, 'Test direct')`);

  console.log("\n1-2. un message de travail ouvre tout seul le chantier");
  let o = prompt(DIR_A, "sa", "Corrige le bandeau qui compte mal les éléments en attente quand le réseau est coupé");
  let c = sql(`select id, titre, etat, pris_par, titre_auto from chantiers where projet_id = ${q(P)}`);
  verifie("un chantier est ouvert, réservé à la branche de la session", c.length === 1 && c[0].pris_par === "claude/direct-a" && c[0].etat === "en_cours", c);
  verifie("la session est prévenue (id du chantier, ne pas le recréer)", /OUVERT TOUT SEUL/.test(o) && o.includes(c[0]?.id), o.slice(0, 300));
  verifie("le message de Raphaël est dans le fil du chantier", sql(`select count(*)::int n from messages where chantier_id = ${q(c[0].id)} and auteur_type = 'proprietaire'`)[0].n === 1);
  const C1 = c[0].id;
  prompt(DIR_A, "sa", "Et ajoute aussi un état vide propre quand il n'y a plus rien en attente");
  verifie("un 2e message de travail ne crée pas de 2e chantier", sql(`select count(*)::int n from chantiers where projet_id = ${q(P)}`)[0].n === 1);
  console.log("   (un « merci » n'ouvre rien)");
  prompt(DIR_A, "sa", "merci beaucoup");
  verifie("un message de conversation n'ouvre aucun chantier", sql(`select count(*)::int n from chantiers where projet_id = ${q(P)}`)[0].n === 1);

  console.log("\n3. reprise d'un chantier ouvert qui ressemble, jamais d'un livré");
  const OUVERT = randomUUID(), LIVRE = randomUUID();
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values (${q(OUVERT)}, ${q(P)}, 'Graphiques des coûts par prestataire', 'Afficher un graphique des coûts mensuels par prestataire dans Coûts', 'libre'), (${q(LIVRE)}, ${q(P)}, 'Export PDF des factures groupées', 'Exporter toutes les factures du mois en un seul PDF pour la compta', 'a_verifier')`);
  prompt(DIR_B, "sb", "Ajoute un graphique des coûts mensuels par prestataire dans l'onglet Coûts du projet");
  const reprise = sql(`select id, pris_par from chantiers where id = ${q(OUVERT)}`)[0];
  verifie("le chantier ouvert qui ressemble est repris par la session (pas de doublon)", reprise.pris_par === "claude/direct-b", reprise);
  prompt(DIR_A, "sc", "Exporter toutes les factures du mois en un seul PDF pour la compta, avec un bouton dans Coûts");
  const livre = sql(`select etat, pris_par from chantiers where id = ${q(LIVRE)}`)[0];
  verifie("un chantier livré n'est jamais rouvert ni réservé", livre.etat === "a_verifier" && livre.pris_par == null, livre);

  console.log("\n4. le premier --ouvrir remplace le titre approximatif");
  const r = spawnSync("bash", [join(RACINE, "scripts/chantier.sh"), "--ouvrir", "Bandeau hors ligne : compter justement", "--demande", "précision", "--projet", SLUG], { encoding: "utf8", env: { ...env(DIR_A), CLAUDE_CODE_SESSION_ID: "sa" } });
  const apres = sql(`select titre, titre_auto from chantiers where id = ${q(C1)}`)[0];
  const nb = sql(`select count(*)::int n from chantiers where projet_id = ${q(P)} and pris_par = 'claude/direct-a'`)[0].n;
  verifie("même chantier, titre précisé, plus marqué automatique, aucun doublon", apres?.titre === "Bandeau hors ligne : compter justement" && apres.titre_auto === false && nb === 1, { apres, nb, sortie: r.stdout?.slice(0, 200), err: r.stderr?.slice(0, 200) });

  console.log("\n5. l'action en direct et la fin de tour");
  suivi(DIR_A, { session_id: "sa", hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "/x/app/src/Bandeau.tsx" }, tool_response: {} });
  await attendre(2500);
  let act = sql(`select action_live, statut, pct_estime from activite where chantier_id = ${q(C1)}`)[0];
  verifie("la barre montre ce que la session fait (Modifie Bandeau.tsx)", act?.action_live === "Modifie Bandeau.tsx" && act.statut === "en_cours" && act.pct_estime === false, act);
  verifie("le battement du tour tourne (sans PreToolUse)", existsSync(join(TMP, "cockpit-tour-vie-sa")));
  suivi(DIR_A, { session_id: "sa", hook_event_name: "Stop", background_tasks: [] });
  await attendre(2500);
  act = sql(`select statut, action_live from activite where chantier_id = ${q(C1)}`)[0];
  verifie("fin de tour : « en attente », action effacée", act.statut === "attente" && act.action_live == null, act);
  verifie("le battement s'arrête à Stop", !existsSync(join(TMP, "cockpit-tour-vie-sa")));

  // Chantier réservé au nom d'une AUTRE branche (copie de travail), mais suivi par cette session vivante (étape signalée).
  const AUTRE = randomUUID();
  sql(`insert into chantiers (id, projet_id, titre, etat, pris_par, pris_jusqu_a) values (${q(AUTRE)}, ${q(P)}, 'Voile sur la main', 'en_cours', 'claude/copie-de-travail', now() + interval '1 hour')`);
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, updated_at) values (${q(P)}, ${q(AUTRE)}, 'claude/direct-a', 'Voile encore visible', 80, 'en_cours', now() - interval '2 hours')`);
  suivi(DIR_A, { session_id: "sa", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { description: "Lance le banc" }, tool_response: {} });
  await attendre(2500);
  const viv = sql(`select action_live, pourcentage, extract(epoch from now() - updated_at)::int as age from activite where chantier_id = ${q(AUTRE)}`)[0];
  verifie("un chantier réservé à une autre branche mais suivi par la session vivante montre son action en direct (barre à jour, 80 % gardé)", viv?.action_live === "Lance : Lance le banc" && viv.pourcentage === 80 && viv.age < 30, viv);

  console.log("\n6-7. ce que personne ne tient arrive à la session ouverte, une seule fois");
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values (${q(P)}, null, 'raphael@test', 'proprietaire', 'info', 'Je ne vois aucune barre de progression sur ce projet, regarde.')`);
  const Q = randomUUID();
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options, answered_at, answered_by, reponse, created_at) values (${q(Q)}, ${q(P)}, null, 'test', 'session', 'question', 'On garde le rendu ?', 'parce que', '[{"libelle":"oui","aide":"a"},{"libelle":"non","aide":"b"}]'::jsonb, now(), '00000000-0000-4000-8000-00000000cafe', 'oui', now() - interval '1 minute')`);
  const ob = suivi(DIR_B, { session_id: "sb", hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/x/a.ts" }, tool_response: {} });
  verifie("la session B reçoit le message du cockpit au niveau du projet", /barre de progression/.test(ob), ob.slice(0, 300));
  verifie("… et la réponse de carte", /On garde le rendu/.test(ob) && /oui/.test(ob), ob.slice(0, 300));
  const oa = suivi(DIR_A, { session_id: "sa", hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/x/a.ts" }, tool_response: {} });
  verifie("la session A ne les reçoit PAS une seconde fois (réclamé en base)", !/barre de progression/.test(oa) && !/On garde le rendu/.test(oa), oa.slice(0, 300));
  verifie("la chef (messages_sans_reponse / reponses_sans_suite) ne les voit plus", sql(`select (select count(*) from messages_sans_reponse(${q(P)}, null))::int + (select count(*) from reponses_sans_suite(${q(P)}, null))::int as n`)[0].n === 0);
  verifie("l'app saura qu'ils sont reçus (recu_at / recu_par)", sql(`select count(*)::int n from messages where projet_id = ${q(P)} and recu_at is not null and recu_par = 'claude/direct-b'`)[0].n >= 2);

  console.log("\n9. répondre à une carte DANS la session la ferme");
  const Q2 = randomUUID();
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values (${q(Q2)}, ${q(P)}, ${q(C1)}, 'claude/direct-a', 'session', 'question', 'Version courte ou longue ?', 'parce que', '[{"libelle":"courte","aide":"a"},{"libelle":"longue","aide":"b"}]'::jsonb)`);
  const d = spawnSync("bash", [join(RACINE, "scripts/demander.sh"), "--repondu", Q2, "la courte", "--projet", SLUG], { encoding: "utf8", env: env(DIR_A) });
  const f = sql(`select answered_at is not null as ferme, answered_by is null as sans_suite, reponse from messages where id = ${q(Q2)}`)[0];
  verifie("la carte est fermée, avec ses mots, sans devenir une « réponse à reprendre »", f.ferme && f.sans_suite && /la courte/.test(f.reponse), { f, err: d.stderr?.slice(0, 200) });
} catch (e) {
  verifie("le banc s'est déroulé sans planter", false, e.message);
} finally {
  console.log("\nnettoyage");
  await attendre(3000);
  try {
    await purgerProjetsDeTest(sql, [P], "test-verif-direct-");
    const reste = sql(`select (select count(*) from projets where id = ${q(P)})::int + (select count(*) from sessions where projet_id = ${q(P)})::int as n`)[0].n;
    verifie("projet de test et traces supprimés", reste === 0, reste);
  } catch (e) { verifie("nettoyage", false, e.message); }
  rmSync(dossier, { recursive: true, force: true });
}
console.log(`\nverifier-direct : ${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
