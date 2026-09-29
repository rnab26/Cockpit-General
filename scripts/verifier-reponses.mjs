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
} catch (e) {
  verifie("le banc s'est déroulé sans planter", false, e.message);
} finally {
  console.log("\nnettoyage");
  await attendre(3000); // les envois en arrière-plan du hook (suivre) se posent avant la purge
  try {
    const reels = sql(`select id from projets where id = ${q(P)} and slug not like 'test-verif-%'`);
    if (reels.length) throw new Error("REFUS : pas un projet de test");
    sql(`delete from sessions where projet_id = ${q(P)}`);
    sql(`delete from projets where id = ${q(P)} and slug like 'test-verif-%'`);
    sql(`delete from historique where chantier_id in (select chantier_id from supprimes where projet_id = ${q(P)})`);
    sql(`delete from supprimes where projet_id = ${q(P)}`);
    const reste = sql(`select (select count(*) from projets where id = ${q(P)})::int + (select count(*) from sessions where projet_id = ${q(P)})::int as n`)[0].n;
    verifie("projet de test, sessions et traces supprimés", reste === 0, reste);
  } catch (e) { verifie("nettoyage", false, e.message); }
  rmSync(dossier, { recursive: true, force: true });
}
console.log(`\nverifier-reponses : ${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
