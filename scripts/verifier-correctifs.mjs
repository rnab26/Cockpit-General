// La règle de tri « Correctifs » (migration 0021, cockpit.est_correctif) sur
// une table de cas : lecture seule, rien n'est écrit en base. La règle vit en
// SQL (une seule source, appliquée par le trigger à toute création) ; ce banc
// l'appelle telle quelle. Le trigger, le rangement des existants et les
// droits sont prouvés par verifier-base.mjs §22.
//
//   node scripts/verifier-correctifs.mjs
//
// Un faux positif ou un oubli constaté sur un vrai chantier → ajoute le cas
// ICI d'abord (rouge), puis corrige les listes de la migration.

const URL_ = process.env.SUPABASE_URL ?? "https://bexiyvmdbxcwxasgslxp.supabase.co";
const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!CLE) { console.error("SUPABASE_SERVICE_ROLE_KEY absente de l'environnement."); process.exit(2); }

// [attendu, titre, demande, origine]
export const CAS = [
  // --- correctifs visuels / mise en page / ergonomie : OUI
  [true, "Bouton Envoyer décalé sur mobile", null, "proprietaire"],
  [true, "Le texte déborde de la carte", null, "proprietaire"],
  [true, "Marges trop grandes en haut de l'écran", null, "proprietaire"],
  [true, "Mise en page cassée dans « À toi »", null, "session"],
  [true, "Couleurs criardes, contraste trop faible", null, "proprietaire"],
  [true, "Police trop petite sur téléphone", null, "proprietaire"],
  [true, "Titres mal alignés dans la liste", null, "proprietaire"],
  [true, "Mettre des logos plutôt que des emojis", null, "proprietaire"],
  [true, "Faute d'orthographe dans le libellé", null, "proprietaire"],
  [true, "Ergonomie du menu ⋯", null, "proprietaire"],
  [true, "Quitter une carte plus facilement", null, "proprietaire"],
  [true, "Mode sombre illisible", null, "proprietaire"],
  [true, "Le champ est caché sous le clavier", null, "proprietaire"],
  [true, "Le défilement saute en haut", null, "proprietaire"],
  [true, "Correctif visuel de la page d'accueil", null, "proprietaire"],
  [true, "L'ÉCRAN EST DÉCALÉ", null, "proprietaire"],
  // utilisateur final (module embarqué) : ce qu'il voit, dans la demande
  [true, "Problème sur la page panier", "Le bouton payer est coupé et le texte déborde", "utilisateur"],
  [true, "C'est moche", "les couleurs ne vont pas ensemble", "utilisateur"],
  // --- pas des correctifs visuels : NON
  [false, "Section correctif", "Ajouter une section corrective lorsque c'est des correctifs par exemple visuels de mise en page d'ergonomie", "proprietaire"],
  [false, "Voir l'état du déploiement du site dans le cockpit", "couleur verte quand c'est en ligne", "session"],
  [false, "bouton relancer ce job dans l'historique", null, "proprietaire"],
  [false, "Refonte de l'écran d'accueil (nouvelle mise en page)", null, "proprietaire"],
  [false, "Nouvelle fonctionnalité : affichage des factures", null, "proprietaire"],
  [false, "Tête entière vidéo : plaques de peau et bloc jaune", null, "session"],
  [false, "Correctif object replace et headswap", null, "proprietaire"],
  [false, "Migration de la base : colonne couleur", null, "session"],
  [false, "Notifications quand une question attend", null, "proprietaire"],
  [false, "Rendu du moteur : couleurs de peau", null, "session"],
  [false, "Objets — objets plus grands / autre type", null, "proprietaire"],
  // un propriétaire qui cite « couleur » dans une longue demande : le titre décide
  [false, "Mes réponses arrivent aux sessions", "et la pastille de couleur doit changer", "proprietaire"],
  // un utilisateur final qui parle d'un gros sujet
  [false, "Paiement", "ajouter le paiement par carte, bouton décalé", "utilisateur"],
  [false, "", null, "proprietaire"],
];

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const valeurs = CAS.map(([, t, d, o], i) => `(${i}, ${q(t)}, ${q(d)}, ${q(o)})`).join(",\n");
const requete = `select i, cockpit.est_correctif(titre, demande, origine) as oui
  from (values ${valeurs}) as cas(i, titre, demande, origine) order by i`;

const r = await fetch(`${URL_}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Profile": "cockpit", apikey: CLE, Authorization: `Bearer ${CLE}` },
  body: JSON.stringify({ query: requete }),
});
const json = await r.json();
if (!json.ok) { console.error("SQL refusé :", json.error); process.exit(1); }
let echecs = 0;
for (const { i, oui } of json.rows) {
  const [attendu, titre, demande, origine] = CAS[i];
  const bon = oui === attendu;
  if (!bon) echecs++;
  console.log(`  ${bon ? "✓" : "✗"} ${attendu ? "Correctifs " : "ailleurs   "} « ${titre} »${demande ? ` + « ${demande} »` : ""} (${origine})${bon ? "" : ` — la règle dit ${oui}`}`);
}
console.log(`\n${CAS.length - echecs}/${CAS.length} cas conformes.`);
process.exit(echecs ? 1 : 0);
