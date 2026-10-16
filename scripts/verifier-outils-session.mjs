// Outils de session absents de la routine du chef (migration 0095, chantier fb19d6a8).
//   node scripts/verifier-outils-session.mjs
// 1. la consigne de relais liste create_session / archive_session tant que l'outil n'est pas déclaré absent, puis plus du tout ;
// 2. chef.sh --sans-outil : note l'absence, pose UNE carte claire (pas de doublon au 2e appel), refuse un nom inconnu ;
// 3. --outil-present remet le geste ; la valeur vit en base (chefs.sans_outils).
// Projet jetable `test-outils-…`, supprimé à la fin.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
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
const SLUG = `test-outils-${randomUUID().slice(0, 8)}`, P = randomUUID();
const dossier = mkdtempSync(join(tmpdir(), "cockpit-outils-"));
const TMP = join(dossier, "tmp"); mkdirSync(TMP);
const DEPOT = join(dossier, "depot"); mkdirSync(DEPOT);
spawnSync("git", ["init", "-q", "-b", "claude/test-outils", DEPOT]);
const env = { ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: DEPOT, COCKPIT_SQL: SQL, COCKPIT_DEM_CMD: join(RACINE, "scripts/demander.sh"), TMPDIR: TMP };
const chef = (args, extra = {}, input) => {
  const r = spawnSync("bash", [join(RACINE, "scripts/chef.sh"), ...args], { encoding: "utf8", timeout: 120000, env: { ...env, ...extra }, input });
  return { status: r.status, texte: `${r.stdout}${r.stderr}` };
};
const relais = JSON.stringify([{
  slug: "autre", nom: "Autre", depot: "rnab26/autre", messages: 1, verifs: 0, ouvrir_session: true,
  renforts: { ouvrir: [{ id: randomUUID(), slug: "autre", depot: "rnab26/autre", section: "Sec", chantiers: 1, agents: 1 }],
              archiver: [{ id: randomUUID(), section: "Fini", statut: "fini", session: "session_renfort_1" }] },
  fermer: [{ id: randomUUID(), session: "session_relais_2" }],
}]);
const cartes = () => sql(`select count(*)::int n from messages where projet_id = ${q(P)} and kind = 'question' and corps like '%ne peuvent pas ouvrir%'`)[0].n;
try {
  await purgerPassesPrecedentes(sql, "test-outils-");
  sql(`insert into projets (id, slug, nom, depot) values (${q(P)}, ${q(SLUG)}, 'Test outils', 'rnab26/test-outils')`);

  console.log("1. Avant : les gestes sont listés");
  let s = chef(["--relais-texte"], {}, relais).texte;
  verifie("create_session listé", /create_session\(/.test(s), s);
  verifie("archive_session listé", /archive_session\(/.test(s), s);

  console.log("2. Après --sans-outil : plus de geste impossible, une seule carte");
  let r = chef(["--sans-outil", "create_session"]);
  verifie("--sans-outil create_session réussit et dit la carte posée", r.status === 0 && /Carte posée/.test(r.texte), r.texte);
  verifie("une carte posée", cartes() === 1, cartes());
  const c = sql(`select corps, pourquoi, options from messages where projet_id = ${q(P)} and kind = 'question' limit 1`)[0];
  verifie("la carte est courte et sans jargon (question ≤ 140, 2 options)", c && c.corps.length <= 140 && Array.isArray(c.options) && c.options.length === 2, JSON.stringify(c));
  r = chef(["--sans-outil", "create_session"]);
  verifie("2e appel : pas de deuxième carte", r.status === 0 && cartes() === 1, r.texte);
  r = chef(["--sans-outil", "archive_session"]);
  verifie("archive_session noté aussi, toujours une seule carte", r.status === 0 && cartes() === 1, r.texte);
  const flags = sql(`select sans_outils from chefs where projet_id = ${q(P)}`)[0]?.sans_outils ?? {};
  verifie("en base : les deux outils notés", !!flags.create_session && !!flags.archive_session, JSON.stringify(flags));
  s = chef(["--relais-texte"], { SANS_CREATE: "1", SANS_ARCHIVE: "1" }, relais).texte;
  verifie("relais : plus aucun create_session ni archive_session listé", !/create_session\(|archive_session\(/.test(s), s);
  r = chef(["--sans-outil", "rm_rf"]);
  verifie("nom inconnu refusé", r.status === 2, r.texte);

  console.log("3. --outil-present remet le geste");
  r = chef(["--outil-present", "create_session"]);
  const f2 = sql(`select sans_outils from chefs where projet_id = ${q(P)}`)[0]?.sans_outils ?? {};
  verifie("create_session retiré, archive_session gardé", r.status === 0 && !f2.create_session && !!f2.archive_session, JSON.stringify(f2));
  s = chef(["--relais-texte"], { SANS_CREATE: "0", SANS_ARCHIVE: "1" }, relais).texte;
  verifie("relais : create_session revient, archive_session reste absent", /create_session\(/.test(s) && !/archive_session\(/.test(s), s);
} finally {
  try { await purgerProjetsDeTest(async (x) => sql(x), [P], "test-outils-"); } catch (x) { console.log("  (nettoyage : " + x.message + ")"); }
  rmSync(dossier, { recursive: true, force: true });
}
console.log(`\n${total - echecs}/${total}`);
process.exit(echecs ? 1 : 0);
