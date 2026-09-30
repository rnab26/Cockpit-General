// La règle de ressemblance de la fusion suggérée (migration 0041,
// cockpit.ressemblance_fusion) sur une table de cas : lecture seule, rien n'est
// écrit en base. La règle vit en SQL (une seule source, lue par le trigger) ; ce
// banc l'appelle telle quelle. Le trigger, une carte par paire, le seuil et
// l'interrupteur sont prouvés par verifier-base.mjs §37.
//
//   node scripts/verifier-fusion.mjs
//
// SEUIL = défaut de projets.fusion_seuil. Un faux doublon ou un doublon raté
// constaté sur de vrais titres → ajoute le cas ICI d'abord, puis la règle.

const URL_ = process.env.SUPABASE_URL ?? "https://bexiyvmdbxcwxasgslxp.supabase.co";
const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!CLE) { console.error("SUPABASE_SERVICE_ROLE_KEY absente de l'environnement."); process.exit(2); }
const SEUIL = 0.65;

// [proposé ?, titre A, titre B]
export const CAS = [
  // --- même sujet : OUI
  [true, "Ouverture de session et agents de renfort", "Ouverture des sessions et des agents de renfort"],
  [true, "Migration de la table des factures clients", "Migration table factures clients"],
  [true, "Notifications push du téléphone", "Notification push sur téléphone"],
  [true, "Mode sombre illisible", "Mode sombre illisible sur téléphone"],
  [true, "Déplacer un chantier vers un autre projet", "Déplacer chantier vers autre projet"],
  [true, "Objets — objets plus grands", "Objets vidéo : objets plus grands"],
  [true, "Bouton Envoyer décalé", "Bouton Envoyer décalé"],
  // --- sujets différents : NON
  [false, "Ouverture de session et agents de renfort", "Couleur du bouton d'envoi"],
  [false, "Fusion de chantiers : menu et suggestion auto", "Notifications push du téléphone"],
  [false, "Alerte : une session a besoin de renfort", "Ouverture de session et agents de renfort"],
  [false, "Tête entière — bouche hybride", "Tête entière — plaques de peau"],            // préfixe commun seul
  [false, "Objets — objets plus grands", "Objets — autre type de vidéo"],                // idem
  [false, "Notifications push", "Notifications de réponses"],                            // un seul mot commun
  [false, "Migration de la base", "Migration du module embarqué"],                       // un seul mot commun
  [false, "Mode autonome qui s'éteint seul", "Interrupteur du mode autonome"],           // un seul mot significatif commun
  [false, "", "Ouverture de session"],
  [false, "Un chantier", "Nouveau chantier"],                                            // mots vides seulement
];

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const valeurs = CAS.map(([, a, b], i) => `(${i}, ${q(a)}, ${q(b)})`).join(",\n");
const requete = `select i, cockpit.ressemblance_fusion(a, b) as score
  from (values ${valeurs}) as cas(i, a, b) order by i`;

const r = await fetch(`${URL_}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Profile": "cockpit", apikey: CLE, Authorization: `Bearer ${CLE}` },
  body: JSON.stringify({ query: requete }),
});
const json = await r.json();
if (!json.ok) { console.error("SQL refusé :", json.error); process.exit(1); }
let echecs = 0;
for (const { i, score } of json.rows) {
  const [attendu, a, b] = CAS[i];
  const oui = Number(score) >= SEUIL;
  const bon = oui === attendu;
  if (!bon) echecs++;
  console.log(`  ${bon ? "✓" : "✗"} ${attendu ? "proposée " : "ignorée  "} ${Number(score).toFixed(2)}  « ${a} » / « ${b} »${bon ? "" : " — la règle dit le contraire"}`);
}
console.log(`\n${CAS.length - echecs}/${CAS.length} cas conformes (seuil ${SEUIL}).`);
process.exit(echecs ? 1 : 0);
