// Présence d'une session sans hooks (20 oct. 2026) : presence.sh refait le signe de vie tant que le processus Claude existe, puis s'arrête.
//   node scripts/verifier-presence.mjs      (hors ligne : un faux sql.sh enregistre les appels, un faux « Claude » = un sleep)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
let total = 0, echecs = 0;
const verifie = (nom, ok, d) => { total++; if (ok) console.log(`  ✓ ${nom}`); else { echecs++; console.log(`  ✗ ${nom}${d !== undefined ? " — " + String(d).slice(0, 300) : ""}`); } };
const attends = async (cond, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return cond(); };
const dossier = mkdtempSync(join(tmpdir(), "cockpit-presence-"));
const journal = join(dossier, "appels.log");
const faux = join(dossier, "sql.sh");
writeFileSync(faux, `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >>"${journal}"\necho '{"ok":true,"rows":[]}'\n`); chmodSync(faux, 0o755);
const nbAppels = () => (existsSync(journal) ? readFileSync(journal, "utf8").split("\n").filter(Boolean).length : 0);
const claude = spawn("sleep", ["60"], { stdio: "ignore" });
const env = { ...process.env, COCKPIT_SQL: faux, TMPDIR: dossier };
try {
  console.log("1. Tant que Claude existe, le signe de vie se refait");
  const p = spawn("bash", [join(RACINE, "scripts/presence.sh"), "--projet", "test-presence", "--session", "sess-1", "--claude-pid", String(claude.pid), "--branche", "b", "--pas", "1"], { env, stdio: "ignore" });
  verifie("au moins 3 signes de vie en quelques secondes", await attends(() => nbAppels() >= 3, 6000), nbAppels());
  const l = readFileSync(journal, "utf8").split("\n")[0];
  verifie("même appel que le hook : suivre(projet, {session_id, Vie, branche})", /suivre\('test-presence', '.*"session_id":"sess-1".*"hook_event_name":"Vie".*"branche":"b"/.test(l), l);
  console.log("2. Un 2e lancement pour la même session ne double pas");
  const avant = nbAppels();
  const r = spawnSync("bash", [join(RACINE, "scripts/presence.sh"), "--projet", "test-presence", "--session", "sess-1", "--claude-pid", String(claude.pid), "--pas", "1"], { env, timeout: 3000 });
  verifie("le 2e lancement sort tout de suite", r.status === 0 && !r.error, r.error ?? r.status);
  console.log("3. Quand Claude s'arrête, la présence s'arrête seule");
  claude.kill("SIGKILL");
  const fini = await new Promise((res) => { const t = setTimeout(() => res(false), 6000); p.on("exit", () => { clearTimeout(t); res(true); }); });
  verifie("le processus de présence se termine", fini);
  const apres = nbAppels(); await new Promise((r) => setTimeout(r, 2500));
  verifie("plus aucun appel ensuite", nbAppels() === apres, `${apres} -> ${nbAppels()}`);
  verifie("le fichier de présence est retiré", !existsSync(join(dossier, "cockpit-presence-sess-1.pid")));
  console.log("4. Entrées fausses : sortie 0 sans rien faire");
  const v = spawnSync("bash", [join(RACINE, "scripts/presence.sh"), "--projet", "x"], { env, timeout: 3000 });
  verifie("arguments manquants : sortie 0", v.status === 0, v.status);
} finally { try { claude.kill("SIGKILL"); } catch {} rmSync(dossier, { recursive: true, force: true }); }
console.log(`\n${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
