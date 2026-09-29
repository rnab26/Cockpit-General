#!/usr/bin/env node
// Non-régression : les réponses de Raphaël arrivent aux sessions (29 sept. 2026).
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verifier-reponses.mjs
//
// Raphaël : « quand je réponds dans le cockpit, la session doit le prendre en
// compte automatiquement, en live ». Ce banc lance les VRAIS hooks
// (hooks/suivi.sh, hooks/session-start.sh) avec des entrées de Claude Code,
// sur la VRAIE base, dans un projet jetable `test-verif-rep-*` supprimé à la fin :
//   1. session au travail qui tient le chantier → la réponse arrive au pas suivant
//   2. session à l'arrêt quand il répond → remise dès son réveil (UserPromptSubmit)
//   3. nouvelle session → le démarrage montre la réponse jamais prise, puis ne la redonne pas
//   4. un agent reçoit la réponse de SON chantier, pas celle d'un autre agent
//   5. base injoignable un instant → rien n'est perdu (le curseur n'avance pas)
//   6. une question générale (sans chantier) répondue → visible au démarrage
// Le cas « personne ne tient le chantier » relève de scripts/chef.sh (autre chantier).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { purgerPassesPrecedentes, purgerProjetsDeTest } from "./bancs.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = join(RACINE, "scripts/sql.sh");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY absente."); process.exit(2); }

let total = 0, echecs = 0;
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? " — " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 400) : ""}`); } };
const q = (s) => s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`;
function sql(requete) {
  const r = spawnSync(SQL, [requete], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}");
  if (!j.ok) throw new Error(`SQL refusé : ${j.error ?? r.stderr}\n  ${requete.slice(0, 200)}`);
  return j.rows ?? [];
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const rand = randomUUID().slice(0, 8);
const SLUG = `test-verif-rep-${rand}`, P = randomUUID();
const dossier = mkdtempSync(join(tmpdir(), "cockpit-rep-"));
const TMP = join(dossier, "tmp"); mkdirSync(TMP);
// Deux dépôts git : la session (branche claude/test-rep) et le worktree d'un agent (agent/test-rep).
function depot(nom, branche) {
  const d = join(dossier, nom); mkdirSync(d);
  spawnSync("git", ["init", "-q", "-b", branche, d]);
  return d;
}
const PROJET_DIR = depot("session", "claude/test-rep");
const AGENT_DIR = depot("agent", "agent/test-rep");
const env = (extra = {}) => ({ ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: PROJET_DIR, COCKPIT_SQL: SQL, TMPDIR: TMP, COCKPIT_REP_INTERVALLE: "0", ...extra });
function hook(script, entree, extra) {
  const r = spawnSync("bash", [join(process.env.VERIFIER_HOOKS ?? join(RACINE, "hooks"), script)], { input: JSON.stringify(entree), encoding: "utf8", env: env(extra), timeout: 60000 });
  const sortie = (r.stdout || "").trim();
  try { return JSON.parse(sortie)?.hookSpecificOutput ?? {}; } catch { return { brut: sortie }; }
}
const suivi = (e, extra) => hook("suivi.sh", e, extra);
// Comme depuis l'app : repondre_message puis answered_by = un utilisateur (auth.uid() côté app ;
// ici, en service, on le pose à la main avec un uuid de test).
const repondre = (id, rep) => { sql(`select repondre_message(${q(id)}, 'Raphaël', ${q(rep)}, null, null) as r`); sql(`update messages set answered_by = '00000000-0000-4000-8000-00000000cafe' where id = ${q(id)}`); };
function question(chantier, corps) {
  const id = randomUUID();
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, options) values (${q(id)}, ${q(P)}, ${q(chantier)}, 'test', 'session', 'question', ${q(corps)}, '[{"libelle":"Oui"},{"libelle":"Non"}]'::jsonb)`);
  return id;
}
const ecrit = (chantier, corps) => sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values (${q(P)}, ${q(chantier)}, 'Raphaël', 'proprietaire', 'info', ${q(corps)})`);

try {
  await purgerPassesPrecedentes(sql, "test-verif-rep-"); // passes interrompues (> 30 min), jamais une passe vivante
  sql(`insert into projets (id, slug, nom) values (${q(P)}, ${q(SLUG)}, 'Test réponses en direct')`);
  const C1 = randomUUID(), C2 = randomUUID(), C3 = randomUUID();
  sql(`insert into chantiers (id, projet_id, titre, etat) values (${q(C1)}, ${q(P)}, 'Chantier de la session', 'libre'), (${q(C2)}, ${q(P)}, 'Chantier de l''agent', 'libre'), (${q(C3)}, ${q(P)}, 'Chantier d''un autre', 'libre')`);
  sql(`select reserver_chantier(${q(C1)}, 'claude/test-rep', 60) as ok`);
  sql(`select reserver_chantier(${q(C2)}, 'agent/test-rep', 60) as ok`);
  sql(`select reserver_chantier(${q(C3)}, 'agent/autre', 60) as ok`);
  const SID = `test-rep-${rand}`;

  console.log("\n1. session au travail qui tient le chantier");
  let o = hook("session-start.sh", { session_id: SID, hook_event_name: "SessionStart", source: "startup" });
  verifie("le démarrage pose le curseur de la session", !!o.additionalContext, o);
  o = suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
  verifie("rien de neuf → rien n'est injecté", !o.additionalContext, o);
  const Q1 = question(C1, "Je pars sur la version courte ?");
  await attendre(300); repondre(Q1, "Oui");
  o = suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
  verifie("sa réponse arrive au pas suivant (PostToolUse)", o.hookEventName === "PostToolUse" && /version courte/.test(o.additionalContext ?? "") && /→ Oui/.test(o.additionalContext ?? ""), o);
  o = suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
  verifie("elle n'est pas redonnée au pas d'après", !o.additionalContext, o);

  console.log("\n2. session à l'arrêt quand il répond");
  suivi({ session_id: SID, hook_event_name: "Stop", background_tasks: [] }, { COCKPIT_REP_INTERVALLE: "3600" });
  await attendre(300); ecrit(C1, "Finalement, garde aussi la version longue");
  o = suivi({ session_id: SID, hook_event_name: "UserPromptSubmit", prompt: "Réveil" }, { COCKPIT_REP_INTERVALLE: "3600" });
  verifie("au réveil (UserPromptSubmit), remise tout de suite, même sous le rythme de 20 s", o.hookEventName === "UserPromptSubmit" && /version longue/.test(o.additionalContext ?? ""), o);

  console.log("\n3. nouvelle session, réponse jamais prise");
  const Q2 = question(C1, "On garde le bleu ?");
  await attendre(300); repondre(Q2, "Non");
  const SID2 = `test-rep2-${rand}`;
  o = hook("session-start.sh", { session_id: SID2, hook_event_name: "SessionStart", source: "startup" });
  const bloc = (o.additionalContext ?? "").split("## Ses RÉPONSES que personne n'a encore prises")[1]?.split("\n## ")[0] ?? "";
  verifie("le démarrage la montre dans « Ses RÉPONSES que personne n'a encore prises »", /On garde le bleu/.test(bloc) && /« Non »/.test(bloc), bloc || o);
  o = suivi({ session_id: SID2, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
  verifie("puis le premier pas ne la redonne pas (déjà montrée)", !/On garde le bleu/.test(o.additionalContext ?? ""), o);
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values (${q(P)}, ${q(C1)}, 'claude/test-rep', 'session', 'info', 'Pris : pas de bleu')`);
  o = hook("session-start.sh", { session_id: `test-rep3-${rand}`, hook_event_name: "SessionStart", source: "startup" });
  const bloc2 = (o.additionalContext ?? "").split("## Ses RÉPONSES que personne n'a encore prises")[1]?.split("\n## ")[0] ?? "";
  verifie("une fois suivie d'un message de session, elle sort du bloc", !/On garde le bleu/.test(bloc2), bloc2);

  console.log("\n4. agents : chacun reçoit SA réponse");
  sql(`insert into sessions (id, projet_id, branche) values (${q(SID)}, ${q(P)}, 'claude/test-rep') on conflict (id) do nothing`);
  sql(`insert into taches (session_id, projet_id, tache_id, type, description, chantier_id) values (${q(SID)}, ${q(P)}, 'agA', 'agent', 'Agent A', ${q(C2)})`);
  const agA = { session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, agent_id: "agA", cwd: AGENT_DIR };
  const agB = { ...agA, agent_id: "agB", cwd: PROJET_DIR };
  suivi(agA); suivi(agB);
  const Q3 = question(C2, "L'agent passe au format carré ?");
  await attendre(300); repondre(Q3, "Oui");
  const oB = suivi(agB);
  verifie("l'agent B (autre chantier) ne la reçoit pas", !/format carré/.test(oB.additionalContext ?? ""), oB);
  const oA = suivi(agA);
  verifie("l'agent A (son chantier) la reçoit, même après le passage de B", /format carré/.test(oA.additionalContext ?? ""), oA);
  ecrit(C3, "Message pour un chantier que ni la session ni ses agents ne tiennent");
  o = suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
  verifie("un chantier tenu par une autre branche n'est remis à personne ici", !/ne tiennent/.test(o.additionalContext ?? ""), o);

  console.log("\n5. base injoignable un instant");
  const panne = join(dossier, "panne.sh"); writeFileSync(panne, "#!/usr/bin/env bash\necho '{\"ok\":false,\"error\":\"panne\"}'; exit 1\n"); chmodSync(panne, 0o755);
  ecrit(C1, "Précision envoyée pendant la panne");
  o = suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} }, { COCKPIT_SQL: panne });
  verifie("pendant la panne : rien, et le hook ne fait pas échouer la session", !o.additionalContext, o);
  o = suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
  verifie("après la panne : la précision arrive quand même", /pendant la panne/.test(o.additionalContext ?? ""), o);

  console.log("\n6. question générale (sans chantier)");
  const QG = randomUUID();
  sql(`insert into messages (id, projet_id, auteur, auteur_type, kind, corps, options) values (${q(QG)}, ${q(P)}, 'test', 'session', 'question', 'Installer le module pour tous ?', '[{"libelle":"Oui"},{"libelle":"Admin seulement"}]'::jsonb)`);
  repondre(QG, "Admin seulement");
  o = hook("session-start.sh", { session_id: `test-rep4-${rand}`, hook_event_name: "SessionStart", source: "startup" });
  const bloc3 = (o.additionalContext ?? "").split("## Ses RÉPONSES que personne n'a encore prises")[1]?.split("\n## ")[0] ?? "";
  verifie("la réponse générale est montrée au démarrage (« général »)", /général/.test(bloc3) && /Admin seulement/.test(bloc3), bloc3);
  const QS = randomUUID();
  sql(`insert into messages (id, projet_id, auteur, auteur_type, kind, corps) values (${q(QS)}, ${q(P)}, 'test', 'session', 'question', 'Notée par une session ?')`);
  sql(`select repondre_message(${q(QS)}, 'claude/test', 'Dit dans la conversation', null, null) as r`);
  o = hook("session-start.sh", { session_id: `test-rep5-${rand}`, hook_event_name: "SessionStart", source: "startup" });
  const bloc4 = (o.additionalContext ?? "").split("## Ses RÉPONSES que personne n'a encore prises")[1]?.split("\n## ")[0] ?? "";
  verifie("une réponse notée par une session (dite dans sa conversation) n'y est pas", !/Notée par une session/.test(bloc4), bloc4);

  // 0024 : un message LIBRE de Raphaël dans un fil = une réponse écrite de Claude dans ce fil.
  console.log("\n7. message libre : la session qui tient le chantier doit RÉPONDRE dans le fil");
  suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} }); // curseur à jour
  const M1 = randomUUID();
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps) values (${q(M1)}, ${q(P)}, ${q(C1)}, 'Raphaël', 'proprietaire', 'info', 'Je n''ai pas compris ta demande')`);
  o = suivi({ session_id: SID, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {} });
  verifie("il arrive au pas suivant avec l'ordre de lui répondre dans le fil (repondre.sh --chantier)",
    /pas compris ta demande/.test(o.additionalContext ?? "") && /RÉPONDS-LUI/.test(o.additionalContext ?? "") && o.additionalContext.includes(`repondre.sh --chantier ${C1}`), o);
  await attendre(2500);
  verifie("remis à la session vivante = marqué « reçu » (l'app le dit)", !!sql(`select recu_at from messages where id = ${q(M1)}`)[0]?.recu_at);
  const rep = spawnSync("bash", [join(RACINE, "scripts/repondre.sh"), "--chantier", C1, "Je parlais du bouton Envoyer, en bas de l'écran."], { encoding: "utf8", env: env({ COCKPIT_SESSION: "claude/test-rep" }) });
  verifie("repondre.sh écrit la réponse dans le fil", rep.status === 0, rep.stderr || rep.stdout);
  const ecrite = sql(`select auteur_type, repond_a from messages where chantier_id = ${q(C1)} and corps like 'Je parlais du bouton%'`)[0];
  verifie("réponse de session, rattachée à son message (repond_a)", ecrite?.auteur_type === "session" && ecrite?.repond_a === M1, ecrite);
  const long = spawnSync("bash", [join(RACINE, "scripts/repondre.sh"), "--chantier", C1, "x".repeat(700)], { encoding: "utf8", env: env() });
  verifie("règle de clarté : une réponse de plus de 600 caractères est refusée", long.status !== 0 && /600/.test(long.stderr), long.stderr);

  console.log("\n8. message libre sur un fil que PERSONNE ne tient → la chef le confie à un agent");
  const C4 = randomUUID(), M2 = randomUUID(), SIDC = `test-chef-${rand}`;
  sql(`insert into chantiers (id, projet_id, titre, etat, demande) values (${q(C4)}, ${q(P)}, 'Chantier sans personne', 'a_verifier', 'Refaire le menu')`);
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values (${q(P)}, ${q(C4)}, 'claude/vieux', 'session', 'info', 'Livré : le menu est refait')`);
  await attendre(300);
  sql(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps) values (${q(M2)}, ${q(P)}, ${q(C4)}, 'Raphaël', 'proprietaire', 'info', 'Je ne vois pas le menu, où est-il ?')`);
  sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps) values (${q(P)}, ${q(C4)}, 'Raphaël', 'proprietaire', 'constat', 'Ça fonctionne, je certifie.')`);
  let sr = sql(`select * from messages_sans_reponse(${q(P)}, null)`);
  verifie("messages_sans_reponse le donne (un fil, son plus ancien message sans réponse)", sr.some((r) => r.chantier_id === C4 && r.message_id === M2), sr);
  verifie("« Ça fonctionne, je certifie » n'attend pas de réponse (servi ailleurs)", sr.find((r) => r.chantier_id === C4)?.nombre === 1, sr);
  o = hook("session-start.sh", { session_id: `test-rep6-${rand}`, hook_event_name: "SessionStart", source: "startup" });
  const bloc5 = (o.additionalContext ?? "").split("SANS RÉPONSE")[1]?.split("\n## ")[0] ?? "";
  verifie("le démarrage d'une session le montre dans « SANS RÉPONSE », avec la commande pour répondre", /où est-il/.test(bloc5) && /repondre\.sh --chantier/.test(bloc5), bloc5 || o);
  sql(`insert into chefs (projet_id, session_id, actif, max_agents) values (${q(P)}, ${q(SIDC)}, true, 5) on conflict (projet_id) do update set session_id = excluded.session_id, actif = true, max_agents = 5`);
  const passe = spawnSync("bash", [join(RACINE, "scripts/chef.sh"), "--projet", SLUG, "--session", SIDC], { encoding: "utf8", env: env(), timeout: 60000 });
  const sortie = passe.stdout ?? "";
  verifie("la passe de la chef lance un agent « Répondre : … » qui cite son message et la commande",
    /Agent « Répondre : Chantier sans personne »/.test(sortie) && /où est-il/.test(sortie) && sortie.includes(`repondre.sh --chantier ${C4}`) && /Livré : le menu est refait/.test(sortie), sortie.slice(0, 1500) || passe.stderr);
  const apres = sql(`select c.etat, c.pris_par, m.recu_par from chantiers c join messages m on m.id = ${q(M2)} where c.id = ${q(C4)}`)[0];
  verifie("message marqué pris par l'agent, chantier réservé SANS changer d'état", apres?.etat === "a_verifier" && /^agent\/message-/.test(apres?.pris_par ?? "") && apres?.recu_par === apres?.pris_par, apres);
  sr = sql(`select * from messages_sans_reponse(${q(P)}, null)`);
  verifie("il n'est pas redonné à la passe suivante", !sr.some((r) => r.chantier_id === C4), sr);

  console.log("\n9. fil du projet (« Écrire à Claude » hors chantier)");
  const MP = randomUUID();
  sql(`insert into messages (id, projet_id, auteur, auteur_type, kind, corps) values (${q(MP)}, ${q(P)}, 'Raphaël', 'proprietaire', 'info', 'Question générale : tout va bien ?')`);
  sr = sql(`select * from messages_sans_reponse(${q(P)}, null)`);
  verifie("un message hors chantier attend aussi sa réponse", sr.some((r) => r.message_id === MP && r.chantier_id === null), sr);
  const repP = spawnSync("bash", [join(RACINE, "scripts/repondre.sh"), "--projet", "Oui : 3 chantiers avancent, rien ne bloque."], { encoding: "utf8", env: env() });
  sr = sql(`select * from messages_sans_reponse(${q(P)}, null)`);
  verifie("repondre.sh --projet y répond, et il sort de la liste", repP.status === 0 && !sr.some((r) => r.message_id === MP), repP.stderr || sr);
} catch (e) {
  verifie("le banc s'est déroulé sans planter", false, e.message);
} finally {
  console.log("\nnettoyage");
  await attendre(3000); // les envois en arrière-plan du hook (suivre) se posent avant la purge
  try {
    await purgerProjetsDeTest(sql, [P], "test-verif-rep-"); // refuse tout ce qui n'est pas un projet de test
    const reste = sql(`select (select count(*) from projets where id = ${q(P)})::int + (select count(*) from sessions where projet_id = ${q(P)})::int as n`)[0].n;
    verifie("projet de test, sessions et traces supprimés", reste === 0, reste);
  } catch (e) { verifie("nettoyage", false, e.message); }
  rmSync(dossier, { recursive: true, force: true });
}
console.log(`\nverifier-reponses : ${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
