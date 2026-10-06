// Renouvellement automatique de la session chef (migration 0068, chantier ffa0d2b2).
//   node scripts/verifier-renouvellement.mjs
// 1. le hook relève les jetons du CONTEXTE dans le transcript (hors sous-agents, transcript tronqué toléré) ;
// 2. la règle chef_a_renouveler (seuil, interrupteur, demande récente) ;
// 3. la vraie passe de chef.sh : consigne d'ouverture, blocage des agents, reprise après échec ;
// 4. les bornes du réglage et les droits. Projet jetable `test-renouv-…`, supprimé à la fin.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { purgerPassesPrecedentes, purgerProjetsDeTest } from "./bancs.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = join(RACINE, "scripts/sql.sh");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY absente."); process.exit(2); }
let total = 0, echecs = 0;
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? " — " + String(detail).slice(0, 400) : ""}`); } };
const q = (s) => s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`;
function sql(requete) {
  const r = spawnSync(SQL, [requete], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}");
  if (!j.ok) throw new Error(`SQL refusé : ${j.error ?? r.stderr}\n  ${requete.slice(0, 200)}`);
  return j.rows ?? [];
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const SLUG = `test-renouv-${randomUUID().slice(0, 8)}`, P = randomUUID(), SESSION = `sess-${randomUUID()}`;
const dossier = mkdtempSync(join(tmpdir(), "cockpit-renouv-"));
const TMP = join(dossier, "tmp"); mkdirSync(TMP);
const DEPOT = join(dossier, "depot"); mkdirSync(DEPOT);
spawnSync("git", ["init", "-q", "-b", "claude/test-renouv", DEPOT]);
const etat = () => sql(`select chef_a_renouveler(${q(SLUG)}) as r`)[0].r;
const envChef = { ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PROJECT_DIR: DEPOT, COCKPIT_SQL: SQL, TMPDIR: TMP };
const chef = (...args) => {
  const r = spawnSync("bash", [join(RACINE, "scripts/chef.sh"), ...args], { encoding: "utf8", timeout: 120000, env: envChef });
  return { status: r.status, texte: `${r.stdout}${r.stderr}` };
};
try {
  await purgerPassesPrecedentes(sql, "test-renouv-");
  sql(`insert into projets (id, slug, nom, depot) values (${q(P)}, ${q(SLUG)}, 'Test renouvellement', 'rnab26/test-renouv')`);
  sql(`insert into sessions (id, projet_id, branche) values (${q(SESSION)}, ${q(P)}, 'claude/test-renouv')`);
  sql(`insert into chefs (projet_id, session_id, actif, vu_at) values (${q(P)}, ${q(SESSION)}, true, now()) on conflict (projet_id) do update set session_id = excluded.session_id, actif = true`);

  console.log("1. Le hook relève les jetons du contexte");
  const stub = join(dossier, "sql-stub.sh"); const journal = join(dossier, "appels.log");
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> "${journal}"\n`, { mode: 0o755 });
  const ligne = (o) => JSON.stringify(o);
  const tr = join(dossier, "transcript.jsonl");
  writeFileSync(tr, [
    '{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_read_inpu', // ligne coupée par le tail
    ligne({ type: "assistant", isSidechain: false, message: { usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50 } } }),
    ligne({ type: "user", message: { content: "salut" } }),
    ligne({ type: "assistant", isSidechain: false, message: { usage: { input_tokens: 3, cache_read_input_tokens: 400000, cache_creation_input_tokens: 150000, output_tokens: 900 } } }),
    ligne({ type: "assistant", isSidechain: true, message: { usage: { input_tokens: 9, cache_read_input_tokens: 9000000, cache_creation_input_tokens: 0 } } }),
  ].join("\n") + "\n");
  const hook = (ev, extra = {}) => spawnSync("bash", [join(RACINE, "hooks/suivi.sh")], { encoding: "utf8", timeout: 30000,
    input: JSON.stringify({ hook_event_name: ev, session_id: SESSION, transcript_path: tr, ...extra }),
    env: { ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: DEPOT, COCKPIT_SQL: stub, TMPDIR: TMP, COCKPIT_REP_INTERVALLE: "99999" } });
  const nbEnvois = () => (existsSync(journal) ? readFileSync(journal, "utf8") : "").split("\n").filter((l) => l.includes("signaler_jetons")).length;
  hook("Stop"); await attendre(1500);
  const appels = existsSync(journal) ? readFileSync(journal, "utf8") : "";
  verifie("Stop : jetons = input + cache lu + cache créé du dernier tour principal (550 003), sous-agent ignoré", appels.includes(`signaler_jetons('${SLUG}', '${SESSION}', 550003)`), appels);
  const avant = nbEnvois();
  hook("PostToolUse", { tool_name: "Read" }); await attendre(800);
  verifie("PostToolUse juste après : pas de nouvel envoi (au plus 1 par minute)", nbEnvois() === avant, `${avant} -> ${nbEnvois()}`);
  hook("SubagentStop", { agent_id: "a1" }); await attendre(500);
  verifie("un arrêt d'agent n'envoie jamais de jetons", nbEnvois() === avant);
  const r = hook("Stop", { transcript_path: join(dossier, "absent.jsonl") }); await attendre(500);
  verifie("transcript absent : rien envoyé, la session n'est pas gênée", nbEnvois() === avant && r.status === 0, `statut ${r.status}`);

  console.log("2. La règle chef_a_renouveler");
  sql(`update chefs set seuil_jetons = 500000, renouvellement_auto = true where projet_id = ${q(P)}`);
  sql(`select signaler_jetons(${q(SLUG)}, ${q(SESSION)}, 120000)`);
  let e = etat();
  verifie("sous le seuil : pas dépassé, jetons lus", e.depasse === false && Number(e.jetons) === 120000, JSON.stringify(e));
  sql(`select signaler_jetons(${q(SLUG)}, ${q(SESSION)}, 500000)`);
  e = etat();
  verifie("au seuil exact, aucun agent : dépassé et ouvrable", e.depasse === true && e.peut_ouvrir === true, JSON.stringify(e));
  sql(`update chefs set renouvellement_auto = false where projet_id = ${q(P)}`);
  verifie("interrupteur éteint : jamais", etat().depasse === false);
  sql(`update chefs set renouvellement_auto = true, seuil_jetons = 0 where projet_id = ${q(P)}`);
  verifie("seuil 0 : jamais", etat().depasse === false);
  sql(`update chefs set seuil_jetons = 500000 where projet_id = ${q(P)}`);

  console.log("3. La passe de chef.sh");
  let s = chef().texte;
  verifie("dépassé + aucun agent : consigne d'ouverture (create_session, --renouvellement, archive_session)", /create_session\(/.test(s) && s.includes("--renouvellement") && s.includes("archive_session") && s.includes("Traite le projet"), s);
  verifie("la consigne ne lance aucun agent de travail", !/Agent « /.test(s));
  const note = chef("--renouvellement", "session_nouvelle_chef");
  verifie("--renouvellement note la nouvelle session", note.status === 0 && etat().nouvelle_session === "session_nouvelle_chef", note.texte);
  verifie("une ligne dans le fil du projet", sql(`select count(*)::int n from messages where projet_id = ${q(P)} and corps like 'Session chef renouvelée%'`)[0].n === 1);
  e = etat();
  verifie("demande récente : plus ouvrable (pas deux remplaçantes)", e.depasse === true && e.peut_ouvrir === false);
  s = chef().texte;
  verifie("la passe suivante n'ouvre pas une deuxième session et ne lance rien", !/create_session\(/.test(s) && /RENOUVELLEMENT/.test(s), s);
  chef("--renouvellement", "--erreur", "create_session refusé");
  s = chef().texte;
  verifie("après un échec : la chef ne reste pas bloquée, et le dit", /RENOUVELLEMENT de ta session échoué/.test(s) && !/create_session\(/.test(s), s);
  verifie("l'échec est dans le fil du projet", sql(`select count(*)::int n from messages where projet_id = ${q(P)} and corps like 'Renouvellement de la session chef échoué%'`)[0].n === 1);
  const reg = chef("--seuil-jetons", "300000", "on");
  verifie("chef.sh --seuil-jetons règle le projet", reg.status === 0 && etat().seuil === 300000, reg.texte);

  console.log("4. Réglage et droits");
  let refus = ""; try { sql(`select regler_renouvellement(${q(SLUG)}, true, 10) r`); } catch (x) { refus = String(x.message); }
  verifie("seuil trop bas (10) refusé", /50 000/.test(refus), refus);
  const roles = sql(`select has_function_privilege('anon', 'cockpit.signaler_jetons(text,text,bigint)', 'execute') a, has_function_privilege('authenticated', 'cockpit.signaler_jetons(text,text,bigint)', 'execute') b, has_function_privilege('anon', 'cockpit.chef_a_renouveler(text)', 'execute') c, has_function_privilege('anon', 'cockpit.regler_renouvellement(text,boolean,int)', 'execute') d`)[0];
  verifie("droits : l'app ne peut pas relever des jetons ; anon ne lit ni ne règle rien", !roles.a && !roles.b && !roles.c && !roles.d, JSON.stringify(roles));
} finally {
  try { await purgerProjetsDeTest(async (x) => sql(x), [P], "test-renouv-"); } catch (x) { console.log("  (nettoyage : " + x.message + ")"); }
  rmSync(dossier, { recursive: true, force: true });
}
console.log(`\n${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
