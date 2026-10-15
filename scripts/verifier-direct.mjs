#!/usr/bin/env node
// Non-régression : le cockpit et les sessions sont branchés EN DIRECT (14 oct. 2026, migration 0087).
//
//   SUPABASE_SERVICE_ROLE_KEY=… node scripts/verifier-direct.mjs
//
// Raphaël : « cela doit être de l'instantané […] des sessions ouvertes où les chantiers ne se créent pas
// automatiquement, pas de barre de progression […] des doublons quand je réponds des deux côtés » (14 oct.), puis
// « chaque message que je crée en discussion est transcrit comme un chantier avec une progression […] il vaut mieux une
// petite pastille de notification et la discussion concernant le chantier en question » (16 oct., migration 0091).
// VRAIS hooks (hooks/suivi.sh, hooks/autonome.sh, scripts/progression.sh), VRAIE base, projet jetable `test-verif-direct-*`
// supprimé à la fin :
//   1. un message dans une session n'ouvre JAMAIS un chantier : sans chantier tenu il va dans la discussion du projet ; un « merci » n'est déposé nulle part
//   2. une session qui tient UN chantier : le message va dans son fil, et seulement là
//   3. deux chantiers tenus : le plus ressemblant, sinon la discussion du projet ; un chantier ouvert que personne ne tient n'est jamais touché
//   4. la session corrige le rangement en répondant dans le bon fil (déplacé une fois, copié ensuite) ; le hook d'arrêt réclame la réponse écrite
//   5. du travail (fichiers modifiés) sans aucun chantier tenu : une relance, une seule par tour
//   6. la barre d'UN chantier reste vivante (le dernier avancé) et l'action en direct va sur la session seulement (jamais dans `activite`, lisible des membres), secrets masqués ; la fin du tour tout passe « en attente »
//   7. un message écrit dans le cockpit au niveau du projet arrive à la session AU PROCHAIN PAS, réclamé : une seule session le reçoit
//   8. une carte répondue que personne ne tient arrive aussi ; la chef ne la reprend pas pendant 20 min
//   9. sans PreToolUse : le battement part à l'événement du message et s'arrête à Stop
//  10. demander.sh --repondu ferme une carte répondue dans la session (pas de doublon de réponse)
//  11. le ménage des chantiers déjà nés d'un message : essai sans écriture, puis rangement réversible
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
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
const DIR_A = depot("a", "claude/direct-a"), DIR_B = depot("b", "claude/direct-b"), DIR_D = depot("d", "claude/direct-d"), DIR_E = depot("e", "claude/direct-e");
const env = (dir) => ({ ...process.env, COCKPIT_PROJET: SLUG, CLAUDE_PROJECT_DIR: dir, COCKPIT_SQL: SQL, TMPDIR: TMP, COCKPIT_REP_INTERVALLE: "0", COCKPIT_LIVE_INTERVALLE: "0", COCKPIT_BATTEMENT_PAS: "1" });
function suivi(dir, entree) {
  const r = spawnSync("bash", [join(RACINE, "hooks/suivi.sh")], { input: JSON.stringify(entree), encoding: "utf8", env: env(dir), timeout: 60000 });
  try { return JSON.parse((r.stdout || "").trim())?.hookSpecificOutput?.additionalContext ?? ""; } catch { return ""; }
}
const prompt = (dir, sid, texte) => suivi(dir, { session_id: sid, hook_event_name: "UserPromptSubmit", prompt: texte });
// Le « tour » que hooks/prompt-rappel.sh ouvre au message de Raphaël (un fichier dans le .git de la copie) : même format.
function tour(nom, sid, extra = "", decalage = 0) {
  const t = sql(`select to_char((date_trunc('second', clock_timestamp()) + make_interval(secs => ${Number(decalage)})) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as instant`)[0].instant;
  const f = join(dossier, `tour-${nom}`); writeFileSync(f, `session ${sid}\ndebut ${t}\n${extra}`); return f;
}
// Le hook d'arrêt : ce qu'il répond (décision de refuser l'arrêt), ou null s'il laisse la session s'arrêter.
function arret(dir, sid, fichierTour) {
  const r = spawnSync("bash", [join(RACINE, "hooks/autonome.sh")], { input: JSON.stringify({ session_id: sid, hook_event_name: "Stop" }), encoding: "utf8", env: { ...env(dir), COCKPIT_TOUR: fichierTour }, timeout: 60000 });
  try { const j = JSON.parse((r.stdout || "").trim()); return j.decision === "block" ? j.reason : null; } catch { return null; }
}
// progression.sh comme la session l'appelle, pendant un tour.
function point(dir, sid, fichierTour, args) {
  const r = spawnSync("bash", [join(RACINE, "scripts/progression.sh"), ...args, "--projet", SLUG], { encoding: "utf8", env: { ...env(dir), CLAUDE_CODE_SESSION_ID: sid, COCKPIT_TOUR: fichierTour } });
  return { sortie: (r.stdout || "") + (r.stderr || ""), code: r.status };
}
const nbMessages = (ou) => sql(`select count(*)::int n from messages where projet_id = ${q(P)} and auteur_type = 'proprietaire' and via_session and ${ou}`)[0].n;
const nbChantiers = () => sql(`select count(*)::int n from chantiers where projet_id = ${q(P)}`)[0].n;

try {
  await purgerPassesPrecedentes(sql, "test-verif-direct-");
  sql(`insert into projets (id, slug, nom) values (${q(P)}, ${q(SLUG)}, 'Test direct')`);

  console.log("\n1. un message n'ouvre JAMAIS un chantier : sans chantier tenu, il va dans la discussion du projet");
  let o = prompt(DIR_A, "sa", "Corrige le bandeau qui compte mal les éléments en attente quand le réseau est coupé");
  verifie("aucun chantier n'est ouvert", nbChantiers() === 0, nbChantiers());
  verifie("son message est dans la discussion du projet (hors chantier), marqué « venu de la session »", nbMessages("chantier_id is null") === 1);
  verifie("la session est prévenue : discussion du projet, « n'est PAS un chantier », comment répondre", /discussion du projet/.test(o) && /n'est PAS un chantier/.test(o) && /--point/.test(o) && !/OUVERT TOUT SEUL/.test(o), o.slice(0, 400));
  prompt(DIR_A, "sa", "merci beaucoup");
  verifie("un message trop court (« merci ») n'est déposé nulle part", nbMessages("true") === 1);
  prompt(DIR_A, "sa", "Et ajoute aussi un état vide propre quand il n'y a plus rien en attente");
  verifie("un 2e message ne crée toujours aucun chantier", nbChantiers() === 0);

  console.log("\n2. la session tient UN chantier : le message va dans son fil, et seulement là");
  const C1 = randomUUID(), C2 = randomUUID(), OUVERT = randomUUID(), LIVRE = randomUUID();
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, pris_jusqu_a, origine) values (${q(C1)}, ${q(P)}, 'Bandeau hors ligne : compter justement', 'Le bandeau compte mal les éléments quand le réseau est coupé', 'en_cours', 'claude/direct-a', now() + interval '2 hours', 'session')`);
  o = prompt(DIR_A, "sa", "Alors ça en est où, c'est fini ou pas ?");
  verifie("le message est dans le fil du chantier tenu", nbMessages(`chantier_id = ${q(C1)}`) === 1);
  verifie("aucun chantier de plus", nbChantiers() === 1);
  verifie("la session est prévenue : le titre et l'id du chantier, comment répondre dans son fil", o.includes(C1) && /Bandeau hors ligne/.test(o) && /--chantier/.test(o) && /n'est PAS un chantier/.test(o), o.slice(0, 400));

  console.log("\n3. deux chantiers tenus : le plus ressemblant, sinon la discussion du projet ; jamais un chantier que personne ne tient");
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, pris_jusqu_a, origine) values (${q(C2)}, ${q(P)}, 'Graphiques des coûts par prestataire', 'Afficher un graphique des coûts mensuels par prestataire dans Coûts', 'en_cours', 'claude/direct-a', now() + interval '2 hours', 'session')`);
  prompt(DIR_A, "sa", "Ajoute un graphique des coûts mensuels par prestataire dans l'onglet Coûts du projet");
  verifie("un message qui ressemble à l'un des deux va dans le fil de celui-là", nbMessages(`chantier_id = ${q(C2)}`) === 1);
  const avant = nbMessages("chantier_id is null");
  prompt(DIR_A, "sa", "Pense à regarder les droits de lecture des membres invités sur ce projet");
  verifie("un message qui ne ressemble à aucun va dans la discussion du projet (pas dans un fil au hasard)", nbMessages("chantier_id is null") === avant + 1 && nbMessages(`chantier_id = ${q(C1)}`) === 1 && nbMessages(`chantier_id = ${q(C2)}`) === 1);
  sql(`insert into chantiers (id, projet_id, titre, demande, etat) values (${q(OUVERT)}, ${q(P)}, 'Export PDF des factures groupées', 'Exporter toutes les factures du mois en un seul PDF pour la compta', 'libre'), (${q(LIVRE)}, ${q(P)}, 'Envoi des relevés par courriel', 'Envoyer chaque mois les relevés par courriel', 'a_verifier')`);
  prompt(DIR_D, "sd", "Exporter toutes les factures du mois en un seul PDF pour la compta, avec un bouton dans Coûts");
  const ouvert = sql(`select pris_par, etat, (select count(*)::int from messages where chantier_id = ${q(OUVERT)}) as nb from chantiers where id = ${q(OUVERT)}`)[0];
  verifie("un chantier ouvert que personne ne tient n'est ni réservé ni rempli (jamais un fil étranger)", ouvert.pris_par == null && ouvert.etat === "libre" && ouvert.nb === 0, ouvert);
  const livre = sql(`select etat, pris_par from chantiers where id = ${q(LIVRE)}`)[0];
  verifie("un chantier livré n'est jamais rouvert ni réservé", livre.etat === "a_verifier" && livre.pris_par == null, livre);

  console.log("\n4. la session corrige le rangement en répondant dans le bon fil ; le hook d'arrêt réclame la réponse écrite");
  const CB = randomUUID();
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, pris_par, pris_jusqu_a, origine) values (${q(CB)}, ${q(P)}, 'Notifications des réponses', 'Prévenir quand Claude répond', 'en_cours', 'claude/direct-b', now() + interval '2 hours', 'session')`);
  const tB = tour("b", "sb");
  prompt(DIR_B, "sb", "Dis-moi où en est le bandeau hors ligne, c'est lui que je veux voir");
  verifie("rangé par défaut dans l'unique chantier que la session B tient", nbMessages(`chantier_id = ${q(CB)}`) === 1);
  let bloc = arret(DIR_B, "sb", tB);
  verifie("sans réponse écrite, l'arrêt est refusé UNE fois, avec la commande exacte du fil", !!bloc && bloc.includes(CB) && /--point/.test(bloc), bloc);
  verifie("…et pas une deuxième fois (jamais de boucle)", arret(DIR_B, "sb", tB) === null);
  let rp = point(DIR_B, "sb", tB, ["--chantier", C1, "--point", "Le bandeau compte maintenant les éléments en attente, je finis les tests."]);
  verifie("la réponse est écrite dans le fil du bandeau", rp.code === 0 && sql(`select count(*)::int n from messages where chantier_id = ${q(C1)} and auteur_type = 'session' and repond_a is not null`)[0].n >= 1, rp);
  verifie("son message a été DÉPLACÉ vers ce fil (jamais copié) : plus dans le fil de B", nbMessages(`chantier_id = ${q(CB)}`) === 0 && nbMessages(`chantier_id = ${q(C1)} and corps like 'Dis-moi où en est le bandeau%'`) === 1);
  verifie("avec la réponse écrite dans le fil où il a été rangé, l'arrêt n'est pas refusé", arret(DIR_B, "sb", tour("b2", "sb", "", -3)) === null);
  rp = point(DIR_B, "sb", tB, ["--chantier", CB, "--point", "Pour les notifications, rien de neuf : je n'y ai pas touché."]);
  verifie("une 2e réponse dans un autre fil COPIE le message (un message à plusieurs sujets)", nbMessages(`chantier_id = ${q(CB)}`) === 1 && nbMessages(`chantier_id = ${q(C1)} and corps like 'Dis-moi où en est le bandeau%'`) === 1, rp);
  rp = point(DIR_B, "sb", tB, ["--point", "Côté projet, tout est calme pour l'instant."]);
  verifie("sans --chantier : la réponse va dans la discussion du projet, le message y est copié une fois", rp.code === 0 && nbMessages(`chantier_id is null and corps like 'Dis-moi où en est le bandeau%'`) === 1, rp);
  // Le hook d'arrêt compte aussi le fil où le message a été rangé par défaut.
  const tA = tour("a", "sa");
  prompt(DIR_A, "sa", "Peux-tu me dire si les graphiques des coûts sont prêts à regarder");
  bloc = arret(DIR_A, "sa", tA);
  verifie("le fil où le message a été rangé réclame sa réponse à l'arrêt (ici le chantier des graphiques)", !!bloc && bloc.includes("Graphiques des coûts"), bloc);

  console.log("\n5. du travail sans aucun chantier tenu : une relance, une seule par tour");
  prompt(DIR_D, "sd", "Range les fichiers du dossier docs par date de modification");
  for (let k = 0; k < 3; k++) suivi(DIR_D, { session_id: "sd", hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: `/x/docs/f${k}.md` }, tool_response: {} });
  const tD = tour("d", "sd", "ok\n", 600);
  bloc = arret(DIR_D, "sd", tD);
  verifie("trois modifications de fichiers, aucun chantier tenu : l'arrêt est refusé avec « TRAVAIL SANS CHANTIER »", !!bloc && /TRAVAIL SANS CHANTIER/.test(bloc) && /--chercher/.test(bloc), bloc);
  verifie("…une seule fois par tour", arret(DIR_D, "sd", tD) === null);
  const tA2 = tour("a2", "sa", "ok\n", 600);
  for (let k = 0; k < 3; k++) suivi(DIR_A, { session_id: "sa", hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: `/x/app/g${k}.ts` }, tool_response: {} });
  verifie("la session A tient des chantiers : pas de relance", arret(DIR_A, "sa", tA2) === null);
  suivi(DIR_D, { session_id: "sd", hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/x/a.ts" }, tool_response: {} });

  console.log("\n6. l'action en direct (sur UN chantier et sur la session) et la fin de tour");
  suivi(DIR_A, { session_id: "sa", hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "/x/app/src/Bandeau.tsx" }, tool_response: {} });
  await attendre(2500);
  const lignes = sql(`select chantier_id, statut, pct_estime, pourcentage from activite where chantier_id in (${q(C1)}, ${q(C2)}) and statut = 'en_cours' and session = 'claude/direct-a'`);
  verifie("la barre d'UN SEUL chantier reste vivante (le dernier avancé), sans pourcentage inventé", lignes.length === 1 && lignes[0].pct_estime === false && lignes[0].pourcentage === 0, lignes);
  verifie("le texte de l'action n'est écrit dans AUCUNE ligne d'activité (lisible des membres invités) : seulement sur la session (admin)", sql(`select count(*)::int n from activite where projet_id = ${q(P)} and action_live is not null`)[0].n === 0);
  const sess = sql(`select action_live, action_live_at is not null as quand from sessions where projet_id = ${q(P)} and branche = 'claude/direct-a'`)[0];
  verifie("la session elle-même porte l'action (une session sans chantier reste visible)", sess?.action_live === "Modifie Bandeau.tsx" && sess.quand, sess);
  suivi(DIR_A, { session_id: "sa", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { description: "Appelle l'API avec sk-ant-abcdefghijklmnopqrstuvwxyz0123" }, tool_response: {} });
  await attendre(2500);
  verifie("un secret dans une commande est masqué avant d'être écrit", !/sk-ant-abcdefghijklmnop/.test(sql(`select action_live from sessions where projet_id = ${q(P)} and branche = 'claude/direct-a'`)[0]?.action_live ?? ""));
  verifie("le battement du tour tourne (sans PreToolUse)", existsSync(join(TMP, "cockpit-tour-vie-sa")));
  suivi(DIR_A, { session_id: "sa", hook_event_name: "Stop", background_tasks: [] });
  await attendre(2500);
  const fin = sql(`select (select count(*)::int from activite where chantier_id in (${q(C1)}, ${q(C2)}) and statut = 'en_cours') as vives, (select action_live from sessions where projet_id = ${q(P)} and branche = 'claude/direct-a') as sess`)[0];
  verifie("fin de tour : barre « en attente », action effacée de la session", fin.vives === 0 && fin.sess == null, fin);
  verifie("le battement s'arrête à Stop", !existsSync(join(TMP, "cockpit-tour-vie-sa")));

  // Chantier réservé au nom d'une AUTRE branche (copie de travail), mais suivi par une session vivante qui n'a que lui (étape signalée il y a 2 h).
  const AUTRE = randomUUID();
  sql(`insert into chantiers (id, projet_id, titre, etat, pris_par, pris_jusqu_a) values (${q(AUTRE)}, ${q(P)}, 'Voile sur la main', 'en_cours', 'claude/copie-de-travail', now() + interval '1 hour')`);
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, updated_at) values (${q(P)}, ${q(AUTRE)}, 'claude/direct-e', 'Voile encore visible', 80, 'en_cours', now() - interval '2 hours')`);
  suivi(DIR_E, { session_id: "se", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { description: "Lance le banc" }, tool_response: {} });
  await attendre(2500);
  const viv = sql(`select pourcentage, statut, extract(epoch from now() - updated_at)::int as age from activite where chantier_id = ${q(AUTRE)}`)[0];
  verifie("un chantier réservé à une autre branche mais suivi par la session vivante (sa seule) reste vivant (barre à jour, 80 % gardé)", viv?.statut === "en_cours" && viv.pourcentage === 80 && viv.age < 30, viv);

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

  console.log("\n11. le drapeau « pourcentage donné » et le ménage des chantiers déjà nés d'un message");
  // signaler_activite : un pourcentage donné par la session lève pct_estime (avant, une barre à 35 % restait « sans pourcentage »).
  const CP = randomUUID();
  sql(`insert into chantiers (id, projet_id, titre, etat, pris_par, pris_jusqu_a) values (${q(CP)}, ${q(P)}, 'Chantier du drapeau', 'en_cours', 'claude/direct-a', now() + interval '1 hour')`);
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, pct_estime, action_live, action_live_at) values (${q(P)}, ${q(CP)}, 'claude/direct-a', 'Au travail', 0, 'en_cours', false, 'Modifie X', now())`);
  sql(`select signaler_activite(${q(SLUG)}, ${q(CP)}::uuid, 'claude/direct-a', 'Lot lancé', null, null, 'en_cours', null)`);
  let fl = sql(`select pct_estime, pourcentage from activite where chantier_id = ${q(CP)}`)[0];
  verifie("une étape SANS pourcentage laisse le drapeau « pas de pourcentage »", fl.pct_estime === false && fl.pourcentage === 0, fl);
  sql(`select signaler_activite(${q(SLUG)}, ${q(CP)}::uuid, 'claude/direct-a', 'Lot lancé', 35, null, 'en_cours', null)`);
  fl = sql(`select pct_estime, pourcentage from activite where chantier_id = ${q(CP)}`)[0];
  verifie("une étape AVEC pourcentage (35 %) lève le drapeau : la barre dit vraiment 35 %", fl.pct_estime === true && fl.pourcentage === 35, fl);

  // Quatre chantiers : né d'un message (pur), né d'un message et clos par « relis ma réponse », né d'un message avec du vrai travail, et un vrai chantier.
  const PUR = randomUUID(), CONV = randomUUID(), TRAV = randomUUID(), VRAI = randomUUID();
  const MSG_P = "Ca en es ou cest finit ? Jai limpression que oui mais je ne sais pas ce quil fait";
  const MSG_C = "Combien ça coûterait de faire tous ces tests sur GPU et combien de temps ça prendrait";
  const nes = (id, titre, etat, extra = "") => sql(`insert into chantiers (id, projet_id, titre, demande, etat, origine, titre_auto ${extra ? ", " + extra.split("|")[0] : ""}) values (${q(id)}, ${q(P)}, ${q(titre)}, 'Test.', ${q(etat)}, 'session', true ${extra ? ", " + extra.split("|")[1] : ""})`);
  nes(PUR, "Ca en es ou cest finit", "en_cours");
  nes(CONV, "Combien ça coûterait de faire tous ces tests", "a_verifier", `jalons, comment_verifier|'{"pas_en_ligne": {"at": "2026-10-15T10:00:00Z"}}'::jsonb, '1. Relis ma réponse dans la conversation 2. Dis-moi si ça te va'`);
  nes(TRAV, "Vas-y teste toi la piste", "en_cours");
  sql(`insert into chantiers (id, projet_id, titre, demande, etat, origine, titre_auto) values (${q(VRAI)}, ${q(P)}, 'Un vrai chantier', 'Test.', 'en_cours', 'session', false)`);
  const msgFil = (ch, qui, corps, extra = "") => sql(`insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps ${extra ? ", " + extra.split("|")[0] : ""}) values (${q(P)}, ${q(ch)}, ${qui === "lui" ? "'Raphaël (session Claude)', 'proprietaire'" : "'main', 'session'"}, 'info', ${q(corps)} ${extra ? ", " + extra.split("|")[1] : ""})`);
  for (const [ch, corps] of [[PUR, MSG_P], [CONV, MSG_C]]) {
    msgFil(ch, "elle", `Chantier ouvert depuis une session : ${corps}`);
    msgFil(ch, "lui", corps, "via_session, recu_par|true, 'main'");
  }
  msgFil(CONV, "elle", "Estimation : environ 3 dollars et 20 minutes pour tout le lot.");
  msgFil(TRAV, "lui", "Vas-y teste toi la piste du relighting voir ce que ca donne", "via_session, recu_par|true, 'main'");
  sql(`insert into activite (projet_id, chantier_id, session, etape, pourcentage, statut, pct_estime) values (${q(P)}, ${q(PUR)}, 'main', 'Au travail', 0, 'attente', false), (${q(P)}, ${q(CONV)}, 'main', 'Estimation donnée à Raphaël', 100, 'termine', true), (${q(P)}, ${q(TRAV)}, 'main', 'Lot de rendus lancé', 40, 'en_cours', true)`);
  const etat = () => sql(`select (select count(*)::int from chantiers where projet_id = ${q(P)}) as chantiers, (select count(*)::int from chantiers where projet_id = ${q(P)} and archived_at is not null) as archives, (select count(*)::int from messages where projet_id = ${q(P)} and chantier_id is null) as fil_projet`)[0];
  const avantMenage = etat();
  let rm = sql(`select ranger_chantiers_nes_de_messages(${q(SLUG)}, 'purs', true) as r`)[0].r;
  verifie("ESSAI au niveau « purs » : seul le chantier né d'un message sans rien d'autre serait rangé ; le clos par « relis ma réponse » et celui qui a du travail sont « à voir »",
    rm.ranges.length === 1 && rm.ranges[0].id === PUR && rm.a_voir.map((x) => x.id).sort().join() === [CONV, TRAV].sort().join(), rm);
  rm = sql(`select ranger_chantiers_nes_de_messages(${q(SLUG)}, 'conversations', true) as r`)[0].r;
  verifie("ESSAI au niveau « conversations » : les deux nés d'un message ; celui avec 40 % de vrai travail reste à voir ; le vrai chantier n'est jamais cité",
    rm.ranges.map((x) => x.id).sort().join() === [PUR, CONV].sort().join() && rm.a_voir.length === 1 && rm.a_voir[0].id === TRAV && !JSON.stringify(rm).includes(VRAI), rm);
  verifie("l'essai n'écrit RIEN (ni chantier archivé, ni message déplacé)", JSON.stringify(etat()) === JSON.stringify(avantMenage), { avantMenage, apres: etat() });
  let refus = false; try { sql(`select ranger_chantiers_nes_de_messages(${q(SLUG)}, 'tout', true)`); } catch { refus = true; }
  verifie("un niveau inconnu est refusé", refus);
  rm = sql(`select ranger_chantiers_nes_de_messages(${q(SLUG)}, 'conversations', false) as r`)[0].r;
  const apresMenage = etat();
  verifie("appliqué : les deux sont archivés (rien n'est supprimé), les deux autres ne bougent pas", apresMenage.chantiers === avantMenage.chantiers && apresMenage.archives === avantMenage.archives + 2
    && sql(`select count(*)::int n from chantiers where id in (${q(TRAV)}, ${q(VRAI)}) and archived_at is null`)[0].n === 2, { rm, apresMenage });
  verifie("ses mots reviennent dans la discussion du projet, et la réponse de la session aussi, sans la ligne automatique « Chantier ouvert… »",
    nbMessages(`chantier_id is null and corps = ${q(MSG_P)}`) === 1 && nbMessages(`chantier_id is null and corps = ${q(MSG_C)}`) === 1
    && sql(`select count(*)::int n from messages where projet_id = ${q(P)} and chantier_id is null and corps like 'Estimation : environ 3 dollars%'`)[0].n === 1
    && sql(`select count(*)::int n from messages where projet_id = ${q(P)} and chantier_id is null and corps like 'Chantier ouvert depuis une session%'`)[0].n === 0);
  verifie("le compte rendu de la session est gardé, et aucune « réponse non lue » ne s'allume (aucune référence à un message)",
    sql(`select count(*)::int n from messages where projet_id = ${q(P)} and chantier_id is null and corps like 'Compte rendu de la session : Estimation donnée à Raphaël%' and repond_a is null`)[0].n === 1
    && sql(`select count(*)::int n from messages where projet_id = ${q(P)} and chantier_id is null and repond_a is not null and created_at > now() - interval '1 hour' and corps like 'Estimation%'`)[0].n === 0);
  rm = sql(`select ranger_chantiers_nes_de_messages(${q(SLUG)}, 'conversations', false) as r`)[0].r;
  verifie("rejoué : plus rien à ranger, aucun doublon dans la discussion du projet", rm.ranges.length === 0 && JSON.stringify(etat()) === JSON.stringify(apresMenage), { rm, e: etat() });
  sql(`update chantiers set archived_at = null, etat = 'a_verifier' where id = ${q(CONV)}`);
  verifie("« Désarchiver » le rend : le chantier et son fil sont intacts", sql(`select count(*)::int n from messages where chantier_id = ${q(CONV)}`)[0].n >= 3);
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
