#!/usr/bin/env node
// Non-régression : se greffer sur un dépôt qui n'est pas à Raphaël (30 sept. 2026,
// chantier f31ae3ec, « les 3 options me plaisent, ça laisse le choix au client »).
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verifier-greffe.mjs
//
// Dépôts git JETABLES (dossier temporaire, faux $HOME, faux « origin » GitHub,
// dépôt distant nu local) et projets jetables `test-greffe-*` supprimés à la fin.
// Les VRAIS scripts (brancher.sh, hooks, garde pre-push, greffe.sh), servis par un
// cache préparé depuis ce dépôt (aucun téléchargement).
//   1. dépôt d'autrui sans --voie → refus, rien d'écrit
//   2. voie 1 (invisible) : rien dans le dépôt, hooks utilisateur, le démarrage
//      charge le cockpit sans aucun commit, les commandes trouvent le projet
//   3. voie 2 (branches) : garde posée (et l'ancien pre-push rejoué), push sur une
//      branche de Raphaël OK, vers leur main REFUSÉ, branche propre poussable,
//      clé service_role refusée partout, démarrage sur leur branche sans commit
//   4. voie 3 (normale) : un dépôt de Raphaël se branche comme avant, sans garde

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, cpSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { purgerPassesPrecedentes, purgerProjetsDeTest } from "./bancs.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = join(RACINE, "scripts/sql.sh");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY absente."); process.exit(2); }

let total = 0, echecs = 0;
const verifie = (nom, ok, detail) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${detail !== undefined ? " — " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600) : ""}`); } };
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
function sql(requete) {
  const r = spawnSync(SQL, [requete], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}");
  if (!j.ok) throw new Error(`SQL refusé : ${j.error ?? r.stderr}`);
  return j.rows ?? [];
}

const rand = randomUUID().slice(0, 8);
const PREFIXE = "test-greffe-";
const S1 = `${PREFIXE}${rand}-a`, S2 = `${PREFIXE}${rand}-b`, S3 = `${PREFIXE}${rand}-c`;
const T = mkdtempSync(join(tmpdir(), "cockpit-greffe-"));
const HOME = join(T, "home"), CACHE = join(T, "cache");
mkdirSync(HOME);
// Le cache du lanceur, rempli depuis CE dépôt (la version testée), marqué frais.
for (const f of readFileSync(join(RACINE, "modeles/fichiers.txt"), "utf8").split("\n").filter((l) => /^[\w./-]+$/.test(l))) {
  mkdirSync(dirname(join(CACHE, f)), { recursive: true }); cpSync(join(RACINE, f), join(CACHE, f));
}
writeFileSync(join(CACHE, ".maj"), "");

const ENV = (() => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("COCKPIT_") || k === "CLAUDE_PROJECT_DIR") delete e[k];
  return { ...e, HOME, COCKPIT_CACHE: CACHE, COCKPIT_TTL: "99999999", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@cockpit.local", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@cockpit.local", TMPDIR: T };
})();
const run = (cmd, args, { cwd = T, env = {}, input } = {}) => {
  const r = spawnSync(cmd, args, { cwd, env: { ...ENV, ...env }, encoding: "utf8", input, timeout: 120000 });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};
const git = (cwd, ...a) => run("git", a, { cwd });
const fichiers = (d) => { const l = []; const f = (x, p) => { for (const n of readdirSync(x)) { if (n === ".git") continue; const c = join(x, n); statSync(c).isDirectory() ? f(c, p + n + "/") : l.push(p + n); } }; f(d, ""); return l.sort(); };
function depot(nom, proprio, branche = "main") {
  const d = join(T, nom); mkdirSync(d);
  git(d, "init", "-q", "-b", branche);
  git(d, "remote", "add", "origin", `https://github.com/${proprio}/${nom}.git`);
  writeFileSync(join(d, "README.md"), "Leur projet\n");
  writeFileSync(join(d, "CLAUDE.md"), "# Leur CLAUDE.md\n\nLeurs règles.\n");
  mkdirSync(join(d, ".claude")); writeFileSync(join(d, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } }, null, 2) + "\n");
  git(d, "add", "-A"); git(d, "commit", "-q", "-m", "Départ");
  return d;
}
const demarrage = (cwd, cmd, args, env = {}) => {
  const r = run(cmd, args, { cwd, env: { CLAUDE_PROJECT_DIR: cwd, ...env }, input: JSON.stringify({ session_id: `test-greffe-${rand}`, hook_event_name: "SessionStart", source: "startup" }) });
  try { return JSON.parse(r.out)?.hookSpecificOutput?.additionalContext ?? ""; } catch { return r.out; }
};
const BRANCHER = join(RACINE, "scripts/brancher.sh");
const ORIGINE = ".claude/settings.json,CLAUDE.md,README.md"; // ce que contient un dépôt neuf de depot()

try {
  await purgerPassesPrecedentes(sql, PREFIXE);

  console.log("\n1. dépôt d'autrui sans --voie : refus");
  const A = depot(`projet-${rand}`, "autrui");
  const headA = git(A, "rev-parse", "HEAD").out;
  let r = run("bash", [BRANCHER, "--projet", S1, "--dossier", A]);
  verifie("refusé (code 3)", r.code === 3, r);
  verifie("le refus explique les 3 voies", /--voie invisible/.test(r.err) && /--voie branches/.test(r.err) && /--voie normale/.test(r.err), r.err);
  verifie("rien d'écrit dans le dépôt", git(A, "status", "--porcelain", "--ignored").out === "" && fichiers(A).join() === ORIGINE, fichiers(A));
  verifie("aucun projet créé en base", sql(`select count(*)::int as n from projets where slug = ${q(S1)}`)[0].n === 0);

  console.log("\n2. voie 1 : greffe invisible");
  const hooksAvant = readdirSync(join(A, ".git/hooks")).sort().join();
  r = run("bash", [BRANCHER, "--voie", "invisible", "--projet", S1, "--nom", "Test greffe", "--dossier", A]);
  verifie("branché (code 0)", r.code === 0, r);
  verifie("dépôt intact : aucun fichier, rien à commiter", git(A, "status", "--porcelain", "--ignored").out === "" && fichiers(A).join() === ORIGINE);
  verifie("aucun hook git ajouté", readdirSync(join(A, ".git/hooks")).sort().join() === hooksAvant);
  verifie("le projet est en base avec son dépôt", sql(`select depot from projets where slug = ${q(S1)}`)[0]?.depot === `autrui/projet-${rand}`);
  const greffes = readFileSync(join(HOME, ".cockpit/greffes"), "utf8");
  verifie("~/.cockpit/greffes relie le dépôt au projet", greffes.includes(`autrui/projet-${rand} ${S1}`), greffes);
  const RU = join(HOME, ".claude/settings.json");
  const reglages = () => JSON.parse(readFileSync(RU, "utf8"));
  const nbGreffe = (ev) => (reglages().hooks?.[ev] ?? []).flatMap((h) => h.hooks).filter((x) => x.command.includes("cockpit-greffe-hook.sh")).length;
  verifie("hooks déclarés dans les réglages UTILISATEUR", nbGreffe("SessionStart") === 1 && nbGreffe("UserPromptSubmit") === 2 && nbGreffe("Stop") === 2 && nbGreffe("PostToolUse") === 1, reglages().hooks);
  verifie("aucune clé écrite dans les réglages", !readFileSync(RU, "utf8").includes(process.env.SUPABASE_SERVICE_ROLE_KEY));
  r = run("bash", [BRANCHER, "--voie", "invisible", "--maj", "--projet", S1, "--depot", `autrui/projet-${rand}`]);
  verifie("relance (script d'installation) : idempotente, sans doublon de hook", r.code === 0 && nbGreffe("SessionStart") === 1 && nbGreffe("Stop") === 2, r);
  const crochet = join(HOME, ".cockpit/bin/cockpit-greffe-hook.sh");
  let ctx = demarrage(A, "bash", [crochet, "session-start"]);
  verifie("le démarrage charge le cockpit du projet", ctx.includes(`projet « Test greffe » (${S1})`), ctx.slice(0, 300));
  verifie("… avec la consigne « greffe invisible » et les commandes hors du dépôt", ctx.includes("GREFFE INVISIBLE") && ctx.includes(join(HOME, ".cockpit/bin/cockpit-progression.sh")), ctx.slice(0, 1500));
  verifie("… et le bloc de règles du cockpit (réponses courtes)", /RÉPONSES À RAPHAËL/.test(ctx));
  verifie("… sans rien écrire ni commiter dans le dépôt", git(A, "status", "--porcelain", "--ignored").out === "" && git(A, "rev-parse", "HEAD").out === headA);
  r = run("bash", ["-c", 'source "$1" && echo "$COCKPIT_PROJET|$COCKPIT_SANS_TRACE|$COCKPIT_PROG_CMD"', "_", join(HOME, ".cockpit/bin/cockpit-lanceur.sh")], { cwd: A });
  verifie("une commande tapée dans le dépôt trouve son projet", r.out === `${S1}|1|${join(HOME, ".cockpit/bin/cockpit-progression.sh")}`, r);
  r = run(join(HOME, ".cockpit/bin/cockpit-sql.sh"), [`select nom from projets where slug = ${q(S1)}`], { cwd: A });
  verifie("… et parle à la base", r.out.includes("Test greffe"), r);
  const B = depot(`autre-${rand}`, "quelquun");
  ctx = demarrage(B, "bash", [crochet, "session-start"]);
  verifie("un dépôt NON greffé : le hook se tait", ctx === "", ctx);
  ctx = demarrage(A, "bash", [crochet, "session-start"], { COCKPIT_PROJET: "autre-projet" });
  verifie("un projet branché normalement (COCKPIT_PROJET posé) : le hook se tait", ctx === "", ctx);

  console.log("\n3. voie 2 : branches de Raphaël seulement");
  const C = depot(`projet2-${rand}`, "autrui");
  const DIST = join(T, "distant.git"); run("git", ["init", "-q", "--bare", DIST]);
  git(C, "remote", "set-url", "--push", "origin", DIST);
  verifie("leur main part sur le distant", git(C, "push", "-q", "origin", "main").code === 0);
  writeFileSync(join(C, ".git/hooks/pre-push"), `#!/bin/sh\ntouch "${join(T, "ancien-pre-push-joue")}"\n`, { mode: 0o755 });
  git(C, "checkout", "-q", "-b", "claude/travail");
  r = run("bash", [BRANCHER, "--voie", "branches", "--projet", S2, "--nom", "Test greffe 2", "--dossier", C]);
  verifie("branché (code 0)", r.code === 0, r);
  const env2 = JSON.parse(readFileSync(join(C, ".claude/settings.json"), "utf8")).env ?? {};
  verifie("réglages : voie et branches de Raphaël", env2.COCKPIT_VOIE === "branches" && env2.COCKPIT_BRANCHES === "claude/*" && env2.COCKPIT_PROJET === S2, env2);
  verifie("leurs réglages gardés", JSON.parse(readFileSync(join(C, ".claude/settings.json"), "utf8")).permissions?.allow?.[0] === "Bash(npm test)");
  verifie("garde posée dans .git/hooks, leur pre-push gardé à côté", readFileSync(join(C, ".git/hooks/pre-push"), "utf8").includes("cockpit-pre-push") && existsSync(join(C, ".git/hooks/pre-push.avant-cockpit")));
  verifie("config git locale", git(C, "config", "--get", "cockpit.voie").out === "branches");
  git(C, "add", "-A"); git(C, "commit", "-q", "-m", "Cockpit : branchement");
  writeFileSync(join(C, "travail.txt"), "leur fonctionnalité\n"); git(C, "add", "travail.txt"); git(C, "commit", "-q", "-m", "Ajoute la fonctionnalité");
  r = git(C, "push", "-q", "origin", "claude/travail");
  verifie("push sur une branche de Raphaël : accepté", r.code === 0, r);
  verifie("leur ancien pre-push est toujours joué", existsSync(join(T, "ancien-pre-push-joue")));
  r = git(C, "push", "-q", "origin", "claude/travail:main");
  verifie("push des fichiers du cockpit vers LEUR main : refusé", r.code !== 0 && r.err.includes("REFUS (cockpit)") && r.err.includes("--branche-propre"), r);
  verifie("… leur main n'a pas bougé", run("git", ["--git-dir", DIST, "log", "-1", "--format=%s", "main"]).out === "Départ");
  r = run("bash", [join(RACINE, "scripts/greffe.sh"), "--branche-propre", "pr-propre", "--base", "main"], { cwd: C });
  verifie("branche propre créée", r.code === 0 && git(C, "rev-parse", "-q", "--verify", "pr-propre").code === 0, r);
  verifie("… aucune trace du cockpit", run("bash", [join(RACINE, "scripts/greffe.sh"), "--traces", "pr-propre"], { cwd: C }).out === "");
  verifie("… un seul commit sur leur main, leur travail dedans", git(C, "rev-list", "--count", "main..pr-propre").out === "1" && git(C, "show", "pr-propre:travail.txt").out === "leur fonctionnalité");
  verifie("… message = le leur, pas le cockpit", git(C, "log", "-1", "--format=%s", "pr-propre").out === "Ajoute la fonctionnalité");
  verifie("… leur CLAUDE.md et leurs réglages rendus à l'identique", git(C, "show", "pr-propre:CLAUDE.md").out === git(C, "show", "main:CLAUDE.md").out && JSON.stringify(JSON.parse(git(C, "show", "pr-propre:.claude/settings.json").out)) === JSON.stringify(JSON.parse(git(C, "show", "main:.claude/settings.json").out)));
  verifie("… la copie de travail n'a pas bougé", git(C, "rev-parse", "--abbrev-ref", "HEAD").out === "claude/travail" && git(C, "status", "--porcelain").out === "");
  r = git(C, "push", "-q", "origin", "pr-propre:main");
  verifie("la branche propre part vers leur main", r.code === 0, r);
  const FAUSSE = `faussecle-${randomUUID()}${randomUUID()}`;
  writeFileSync(join(C, "config.txt"), `cle=${FAUSSE}\n`); git(C, "add", "config.txt"); git(C, "commit", "-q", "-m", "config");
  r = run("git", ["push", "-q", "origin", "claude/travail"], { cwd: C, env: { SUPABASE_SERVICE_ROLE_KEY: FAUSSE } });
  verifie("la clé service_role ne part sur AUCUNE branche", r.code !== 0 && r.err.includes("service_role"), r);
  git(C, "reset", "-q", "--hard", "HEAD~1");
  // Démarrage sur LEUR branche : jamais de commit du cockpit.
  const lanceurC = join(C, ".claude/hooks/cockpit-session-start.sh");
  git(C, "checkout", "-q", "-b", "leur-branche", "main");
  git(C, "checkout", "-q", "claude/travail", "--", ".claude", "scripts", "CLAUDE.md"); git(C, "reset", "-q");
  writeFileSync(join(C, "scripts/cockpit-sql.sh"), "#!/bin/sh\n# Cockpit-General vieille version\n");
  const headLeur = git(C, "rev-parse", "HEAD").out;
  ctx = demarrage(C, "bash", [lanceurC], { COCKPIT_PROJET: S2, COCKPIT_VOIE: "branches", COCKPIT_BRANCHES: "claude/*" });
  verifie("démarrage sur leur branche : la consigne le dit", ctx.includes("PAS à Raphaël") && ctx.includes("--branche-propre"), ctx.slice(0, 1200));
  verifie("… aucun commit, rien mis à jour", git(C, "rev-parse", "HEAD").out === headLeur && readFileSync(join(C, "scripts/cockpit-sql.sh"), "utf8").includes("vieille version"));
  git(C, "clean", "-qfd"); git(C, "checkout", "-q", "--", "."); git(C, "checkout", "-q", "claude/travail");
  writeFileSync(join(C, "scripts/cockpit-sql.sh"), "#!/bin/sh\n# Cockpit-General vieille version\n"); git(C, "commit", "-qam", "vieille copie");
  const headRaph = git(C, "rev-parse", "HEAD").out;
  ctx = demarrage(C, "bash", [lanceurC], { COCKPIT_PROJET: S2, COCKPIT_VOIE: "branches", COCKPIT_BRANCHES: "claude/*" });
  verifie("démarrage sur SA branche : mise à jour commitée comme avant", git(C, "rev-parse", "HEAD").out !== headRaph && !readFileSync(join(C, "scripts/cockpit-sql.sh"), "utf8").includes("vieille version") && ctx.includes("à Raphaël."), ctx.slice(0, 600));

  console.log("\n4. voie 3 : un dépôt de Raphaël, comme avant");
  const D = depot(`sien-${rand}`, "rnab26");
  r = run("bash", [BRANCHER, "--projet", S3, "--dossier", D]);
  verifie("branché sans --voie (code 0)", r.code === 0, r);
  verifie("fichiers du cockpit dans le dépôt", existsSync(join(D, "scripts/cockpit-sql.sh")) && readFileSync(join(D, "CLAUDE.md"), "utf8").includes("## Cockpit (rnab26/Cockpit-General)"));
  verifie("aucune garde, aucune voie dans les réglages", !existsSync(join(D, ".git/hooks/pre-push")) && !JSON.parse(readFileSync(join(D, ".claude/settings.json"), "utf8")).env.COCKPIT_VOIE);
} catch (e) {
  echecs++; console.log(`  ✗ exception : ${e.stack ?? e}`);
} finally {
  try {
    const ids = sql(`select id from projets where slug in (${[S1, S2, S3].map(q).join(", ")})`).map((x) => x.id);
    await purgerProjetsDeTest(sql, ids, PREFIXE);
  } catch (e) { echecs++; console.log(`  ✗ nettoyage : ${e.message}`); }
  if (process.env.GARDER) console.log(`(dossier gardé : ${T})`); else rmSync(T, { recursive: true, force: true });
}
console.log(`\n${total - echecs}/${total} contrôles OK${echecs ? ` — ${echecs} ÉCHEC(S)` : ""}`);
process.exit(echecs ? 1 : 0);
