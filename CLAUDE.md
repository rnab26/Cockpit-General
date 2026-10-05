# CLAUDE.md — Cockpit (rnab26/Cockpit-General)

Complète le CLAUDE.md global de Raphaël (`rnab26/dotfiles/.claude/CLAUDE.md`),
ne le remplace pas. Français, concis, autonomie une fois la tâche confirmée.

**Tu reprends le travail ? Lis d'abord `docs/REPRISE.md`** (état, ce qui n'est
pas encore en ligne, la suite, les pièges), puis les décisions de Raphaël.

## Ce que c'est, et pourquoi il existe

Le cockpit unique de tous les projets de Raphaël : une base Supabase
centrale (schéma `cockpit`), une app (GitHub Pages), un module embarquable
pour les utilisateurs finaux, des scripts pour les sessions. Les décisions
qui l'ont fondé, dans ses mots :
`rnab26/dotfiles/cockpit-kit/DECISIONS-2026-09-28.md`. **Relis-les avant de
changer un principe** (cycle en colonne, validation humaine, une seule base,
branchable partout, temps réel, style Trieur + synthèses Jarvis).

## Le cockpit se pilote dans le cockpit

Ce dépôt est le projet `cockpit` de sa propre base : le hook
`hooks/session-start.sh` (déclaré dans `.claude/settings.json`) injecte l'état
au démarrage. Réserve un chantier avant de coder, signale ta progression avec
`scripts/progression.sh` à chaque étape et en terminant, pose tes questions
avec `scripts/demander.sh`. Un chantier terminé passe « à vérifier » ; c'est
Raphaël qui certifie depuis l'app.

## Contrat de données : les migrations, rien d'autre

`supabase/migrations/` est la seule source de vérité du schéma. Une
migration est idempotente (rejouable) et s'applique avec
`scripts/sql.sh < supabase/migrations/000N_….sql`. Elle ne touche que le
schéma `cockpit` : le projet Supabase est partagé avec Jarvis (`public`) et
le Trieur (`trieur_data`). Toute nouvelle table : RLS activée, politique
`admin_tout`, temps réel si l'app l'affiche, et `replica identity full`.

Le schéma est exposé à l'API PostgREST (réglage `db_schema` du projet, posé
le 28 sept. par l'API de gestion) ; l'app l'interroge avec
`createClient(url, clé publique, { db: { schema: 'cockpit' } })`.
`scripts/sql.sh` vise `cockpit.exec_sql` par l'en-tête `Content-Profile:
cockpit` (réservée à service_role).

## Ce que tu ne fais pas sans Raphaël

- Poser `valide` sur un chantier (jamais par une session, ni par SQL).
- `drop`, `delete` massif, `truncate`, régénérer une `cle_embed`.
- Créer une ressource payante ou un projet Supabase.
- Créer un dépôt GitHub : la plateforme l'interdit aux sessions (constaté
  le 28 sept. 2026, « sessions are bound to their configured repositories »).

## Vérifications canoniques

```bash
cd app && npm ci && npx tsc -b && npm run build            # l'app se tient
node --experimental-strip-types app/scripts/verifier-*.ts  # décisions pures
node app/scripts/verifier-web.mjs                          # parcours réel, écran de téléphone
node app/scripts/verifier-bulle.mjs                       # bulle d'aide : visible par défaut (projet et « Tout »), message → fil du projet, réponse de session → bulle, réglage d'extinction
node app/scripts/verifier-creation.mjs                   # « + Chantier » près d'un chantier existant : suggestion, compléter, fusionner, créer quand même (projet jetable, téléphone)
node app/scripts/verifier-depenses.mjs                    # Coûts : prestataires, dépenses par période, factures jointes, envoi à la compta (projet jetable, téléphone)
node scripts/verifier-embed.mjs                            # fonction serveur déployée + module dans un navigateur
node scripts/verifier-emplacement.mjs                      # où le cockpit apparaît : analyse du dépôt (choix possibles seulement) + module en mode bouton / page
node scripts/verifier-mcp.mjs                              # serveur MCP déployé (Codex, ChatGPT…) : poignée de main, 7 outils, clé, isolation
node scripts/verifier-base.mjs                             # schéma, RLS, droits des fonctions, temps réel, médias, réponses reprises, images de Claude, aucun reste de test, tri des correctifs, « À toi » à jour, « où ça en est », renforts (§25), fil en discussion (§26), question gardée en certifiant (§27), messages de session dans le fil (§28), un sujet = un fil / relais / réveil immédiat (§29), agents fantômes (§30), marche à suivre d’une action (§31), mode autonome qui s’éteint seul (§15), chantier né dans un fil (§33)
node scripts/verifier-reponses.mjs                         # ses réponses arrivent aux sessions, ses messages de session arrivent dans le fil, un sujet = un fil à l'arrêt (vrais hooks)
node scripts/verifier-correctifs.mjs                       # règle de tri « Correctifs » sur une table de cas (lecture seule)
node scripts/verifier-fusion.mjs                           # règle de ressemblance de la fusion suggérée sur une table de cas (lecture seule)
node scripts/verifier-push.mjs                            # notifications push : fonction déployée (401 sans secret, chiffrement, abonnement mort retiré), coffre, trigger, droits
node app/scripts/verifier-hors-ligne.mjs                    # survie des données côté app : écriture sans réseau gardée, survit au rechargement, repart dans l'ordre, pas de doublon si la réponse se perd, refus visible/réessayable, lecture hors ligne
node scripts/verifier-file-sessions.mjs                    # survie des données côté sessions : sql.sh garde les écritures base injoignable, les rejoue dans l'ordre, un SQL refusé n'est pas jeté
node scripts/verifier-greffe.mjs                           # dépôt d'autrui : refus sans --voie, voie 1 sans trace, voie 2 garde + branche propre, voie 3 inchangée
bash -n scripts/*.sh hooks/*.sh
```

Le compte de test des parcours navigateur est un admin nommé
`test-cockpit@cockpit.local` (mot de passe hors dépôt, dans l'environnement
de la session qui l'a créé) : ce n'est pas une personne, ne l'ajoute à aucun
projet. Sans ce mot de passe, `verifier-web.mjs` se connecte par un lien
magique (clé service_role) ; `app/scripts/capture-ecran.mjs <url> <dossier>`
capture l'écran réel sur un téléphone (clair, ou `SCHEMA=dark`).

**Chromium du conteneur et proxy TLS (29 sept.)** : il ne fait pas confiance
au proxy (`ERR_CERT_AUTHORITY_INVALID`, y compris sur le site en ligne). Les
deux scripts font passer les requêtes https par Node (`ctx.route` + `fetch`),
qui vérifie le certificat : ne jamais « corriger » avec `ignoreHTTPSErrors`.

**Un banc de test n'écrit JAMAIS dans un vrai projet (29 sept. 2026).**
Raphaël voyait « [TEST verifier-embed …] tri des clients » dans son cockpit
(passe interrompue avant son nettoyage). Règles, dans `scripts/bancs.mjs` :
chaque banc travaille dans un projet jetable `test-<banc>-<aléatoire>` (sa
propre `cle_embed` pour verifier-embed), le supprime à la fin, et purge au
démarrage les restes de SES passes interrompues — seulement ceux de plus de
30 min, pour ne jamais casser la passe d'un autre agent. L'app ne montre
jamais un projet `test-…` (ni onglet, ni « Tout », ni ses lignes arrivées en
direct) sauf à un compte `test-…@cockpit.local` (`lib/projetsDeTest.ts`,
filtré dans `useDonnees`). `verifier-base` §21 rougit s'il reste une ligne
« [TEST… » dans un projet réel. Nouveau banc : mêmes règles.

**Deux pièges payés le 28 sept. 2026.**
- Une fonction `security definer` contourne la RLS : elle doit vérifier
  elle-même le droit de l'appelant (`cockpit.peut_agir`, `est_admin`), et
  PostgreSQL donne EXECUTE à PUBLIC par défaut. Toute nouvelle fonction :
  `revoke … from public`, puis `grant` nommé (migration 0004). Et dans une
  telle fonction, `current_user` est le propriétaire : on lit `auth.role()`.
  `verifier-base.mjs` (sections 10 et 11) rougit si l'un des deux revient.
- Le Chromium de l'environnement cloud Claude n'ouvre AUCUNE WebSocket (même
  vers echo.websocket.org) : le temps réel ne se vérifie pas dans le
  navigateur de test ici. `verifier-web.mjs` le détecte et le dit ;
  `verifier-base.mjs` §12 prouve le direct depuis Node. Ne pas « corriger »
  l'app pour ça.

## Déploiement

Push sur `main` → `deploy.yml` construit l'app, y ajoute `embed/` et pousse la
branche `gh-pages`, que Pages sert (Settings → Pages → « Deploy from a
branch » → gh-pages / root, réglé par Raphaël le 28 sept.). La fonction serveur ne se déploie PAS au push :
`VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-embed` puis
`node scripts/verifier-embed.mjs`. Une modification de `embed/cockpit-embed.js`
est servie aux sites hôtes au prochain chargement de leur page (cache CDN
de Pages, quelques minutes).

## Où le cockpit apparaît, et qui l'utilise : questionnaire AVANT le déploiement (5 oct. 2026, migration 0049, chantier dec7fb3c)

Raphaël : « quand on branche un cockpit, on ne sait pas où il va apparaître ni où il va vivre ».
`brancher.sh` (étape 5) lance `scripts/emplacement.sh` : `analyser-depot.py` lit le dépôt (et
`--site`), puis DEUX cartes avec aperçu image (`apercu-emplacement.mjs`) arrivent dans « À toi » :
où (`menu` bouton dans le menu · `page` à part avec lien · `appli` app Chrome, rien dans le site)
et qui (`moi` · `equipe` · `utilisateurs` du site). Seuls les choix POSSIBLES sont proposés (app
mobile : appli seulement ; site sans connexion : pas « utilisateurs »), la recommandation est
marquée. Réponses rangées dans `projets.emplacement` (jsonb, `regler_emplacement`,
`emplacement_valide` : appli + utilisateurs refusé) par `emplacement.sh --lire`. La balise n'est
donnée qu'après réponse : `emplacement.sh --balise [--gabarit "#lien-du-menu"]`. Module embarqué :
`data-mode="bouton"` (panneau masqué, ouvert par `data-declencheur` ou un bouton flottant, Échap
referme) / `"page"`. Limite : le site, pas le cockpit, décide qui voit la balise (le cockpit ne
gère pas les comptes du site) ; l'écran de l'app ne montre pas encore l'emplacement choisi.
`verifier-emplacement.mjs`.

## Serveur MCP pour les outils IA hors Claude (30 sept. 2026, chantier 12c22ec6)

Raphaël : « brancher le cockpit façon MCP à n'importe quel outil IA », en
commençant par ChatGPT / Codex. `supabase/functions/cockpit-mcp` (Streamable
HTTP, sans état, JSON) est un RELAIS de `cockpit-embed` : aucune règle
dupliquée, un outil IA voit et fait exactement ce que fait le module
embarqué, avec la `cle_embed` du projet (jamais régénérée pour ça). Clé par
`Authorization: Bearer` (Codex), `x-cockpit-key`, `/cockpit-mcp/<clé>` ou
`?cle=` (ChatGPT n'offre que OAuth ou aucune authentification, doc lue le 30
sept.). Guide : `docs/mcp.md`. Une modification de `cockpit-embed` se
propage seule ; déployer : `VERIFY_JWT=false scripts/deployer-fonction.sh
cockpit-mcp`. `scripts/verifier-mcp.mjs`. Non fait : `search`/`fetch` de la
recherche approfondie de ChatGPT, OAuth.

## Un chef PAR PROJET, des agents (29 sept. 2026, migrations 0014 puis 0019)

Raphaël, 29/09 16:00 : « je ne veux pas gérer sur une seule session plein de
projets en même temps. S'il y a des ajouts qui doivent se faire, ça doit se
faire dans la session concernant le projet en question, et pas dans une seule
session, parce que sinon ça mélange tous les contextes. » (Avant, 0014 : une
seule session dirigeait TOUS les projets.) Ce qu'on garde de 0014 : « les
sessions se marchent dessus » → dans UN projet, une seule session dirige,
celle où il a écrit en dernier (hook UserPromptSubmit →
`scripts/chef.sh --prendre`, qui la rend chef de SON projet, `COCKPIT_PROJET`,
et de lui seul). Table `cockpit.chefs` (une ligne par projet : session,
`max_agents`, `reveil_trigger`) ; `prendre_chef(projet, …)`,
`est_chef(projet, session)`, `chef_existe(projet)` (service seulement).
La chef ne code pas elle-même : `scripts/chef.sh` lui donne, DANS SON PROJET
SEULEMENT, un travail par place libre (réponses sans suite, « où ça en est ? »
que personne ne recevra (0023), chantiers
prenables si le mode autonome est allumé, « vérifie pour moi » ; 3 agents en
parallèle par défaut, `--max` règle le projet courant), elle lance un agent
par chantier (isolation worktree, sa branche), et relance `chef.sh` à la fin
de CHAQUE agent (et le hook Stop le fait aussi). Les autres sessions du projet
n'enchaînent rien (`autonome.sh`, `passe.sh`) ; une session d'un AUTRE projet
n'est jamais bloquée ni pilotée par elle. Un projet sans chef garde le
fonctionnement par session (mode autonome, `passe.sh`). Un réveil horaire PAR
chef de projet (`chefs.reveil_trigger`, `chef.sh --reveil`) ; une nouvelle
chef du projet le déplace sur elle (la consigne de `--prendre` le dit). Si le
conteneur de la chef s'arrête, ses agents s'arrêtent : chantiers réservés
3 h, repris au réveil suivant (abandon détecté). Jamais `git add -A` dans un
dossier partagé avec un agent (incident du 29 sept., commit 964528e).
L'ancienne table `chef` (id = 1) et ses fonctions sans projet restent en base,
plus lues par les scripts à jour (pas de drop sans Raphaël).
`verifier-base.mjs` §19.

**Renforts** (29 sept., migration 0024, D-10). Raphaël : « lancer une session
par secteur […] plusieurs agents dedans […] 5 maximum par session […] ne jamais
se marcher dessus ». Bouton « Lancer des renforts » (`Renforts.tsx`), au-dessus
de « Prêt à lancer » : `demander_renforts(slug)` (admin) pose UNE demande par
section qui attend (libres, pas triés, abandonnés, « vérifie pour moi » ; jamais
ce qui attend Raphaël), dans la limite `chefs.max_renforts` (0 à 4, défaut 2),
`chefs.agents_par_renfort` (1 à 5, défaut 3) ; `regler_renforts`,
`etat_renforts` (l'écran ne compte rien lui-même). L'app ne crée pas de
session : la passe de `chef.sh` (`renforts_a_ouvrir`, JAMAIS un projet de
test) dit à la chef de faire `create_session` (titre « Renfort · <projet> ·
<section> — ne pas toucher », tags `cockpit-renfort`), puis `renfort.sh
--session|--erreur`, et d'archiver les finis (`archive_session` : accord de
Raphaël donné d'avance, « se ferme tout seul une fois que c'est fini ») puis
`--archive`. Le renfort : `renfort.sh --suivant <id>` → ses chantiers (sa
section, un agent chacun, chaque chantier réservé à SA branche
`renfort/<court>/<court>`), « ATTENDS » ou « FINI ». Tant qu'il vit (signe de
vie < 3 h), personne d'autre ne prend dans sa section (`chantiers_prenables`,
`verifs_prenables`). Un renfort ne devient JAMAIS chef : consigne préfixée
« [cockpit-renfort] » et marque `cockpit-renfort` dans le `.git` de sa copie
(lue par `prompt-rappel.sh` et `autonome.sh`). `verifier-base.mjs` §20.
**Ouverts TOUT SEULS** (30 sept., migration 0040, chantier 6faa9e7b : « la chef a
9 tâches et n'a pas ouvert seule de renforts ») : la passe de la chef
(`renforts_a_ouvrir` → `renforts_auto`) en pose quand la file (chantiers qui
attendent sans personne, jamais ce qui attend Raphaël) atteint le seuil
(`chefs.renforts_auto_seuil`, défaut = `agents_par_renfort`) : un renfort par
section, la plus chargée d'abord, tant que ce qui reste atteint le seuil, dans
la limite `max_renforts`. Rien si l'interrupteur `chefs.renforts_auto` est
éteint (Réglages des renforts, allumé par défaut), si un frein est actif, si le
maximum est atteint, ni jamais pour un projet de test. UNE règle :
`cockpit.file_renforts` (file, seuil, niveau « proche/saturée », `bloque`),
lue par l'alerte de l'écran (`etat_renforts.auto`, `alerteSaturation` ne
recalcule rien) ; chaque renfort garde son `origine` (auto/manuel) + la file et
le seuil du moment (« ouvert automatiquement à HH h MM parce que… »). Limite :
l'ouverture a lieu au passage de la chef (fin d'agent, réveil, message), pas
à la seconde où la file grossit. `verifier-base` §34, `verifier-renforts.ts`.

**Renforts qui échouent : pause, pas de boucle** (30 sept., migration 0044, chantier
60317482 ; deux renforts FacePro morts en 2 min, l'ouverture auto en redemandait).
Cause PROUVÉE du Haiku : `chefs.modele_code` était sonnet, mais un `chef.sh --usage
status` (l'aide prise à la lettre) avait posé le palier 3 (« usage : status ») ;
`bascule_usage` rangeait tout statut inconnu en palier 3 = tout en Haiku. Désormais
un statut inconnu ne change RIEN (base ET `chef.sh --usage`, qui le refuse avant
d'écrire). Non prouvé : pourquoi Haiku n'a pas trouvé les scripts (dépôt de FacePro
illisible depuis ici) ; la consigne de `create_session` donne donc un repli complet
(`~/.cockpit/bin`, sinon téléchargement du cockpit dans `~/.cache/cockpit-general`,
3 essais si « injoignable ») et `renfort.sh` retrouve ses commandes sœurs à côté de
lui. Protection : `renforts_pause(projet, section)` (une règle) — un renfort mort en
moins de 5 min sans travail = échec ; pause 30 min, 3 h dès 2 échecs de suite ;
seule l'ouverture AUTOMATIQUE est freinée (le bouton reste libre) ; UNE ligne dans le
fil du projet (« Renfort FacePro Objets : 2 échecs, en pause jusqu'à HHhMM ; cause : … »).
`verifier-base` §38.

**Frein d'usage ≠ erreur ; erreurs effaçables** (5 oct. 2026, migration 0053, chantier 5dbbabba ; Raphaël, capture : 4 lignes rouges « Jamais ouvert » + « Rien à faire »). Cause prouvée : un frein de 3 h interdisait l'ouverture, et les 3 h de `renfort_vivant` comptaient pendant le frein. UNE règle, `renfort_demande_depuis(r)` = max(création, `chefs.frein_jusqu_a`) : tant que le frein dure la demande reste « demande » (écran : « en attente : frein d'usage jusqu'à HH h MM », `ligneRenfort`), les 3 h ne courent qu'après sa levée. Une vraie erreur est datée (`erreur_at`, trigger), gardée avec un bouton « Relancer » (`relancer_renfort` : nouvelle demande de la même section), et s'efface seule après `chefs.erreurs_efface_h` h (6 par défaut, 0 = jamais ; Renforts › Réglages) ou d'un geste « Effacer les erreurs » (`effacer_erreurs_renforts`) : colonne `efface_at`, jamais de suppression. `verifier-base` §42, `verifier-renforts.ts`.

**« Traiter ce projet »** (29 sept., Raphaël : « j'appuie sur un bouton, ça lance une
session […] plus d'heures à ouvrir des sessions et à configurer »). Bloc au-dessus des
renforts (`Renforts.tsx::TraiterCeProjet`, logique `lib/traiter.ts`, test
`verifier-traiter.ts` + `verifier-web.mjs`) : dit où en est le projet (session ? combien de
chantiers, par section), copie la phrase « Traite le projet X en lot… » et ouvre
`claude.ai/code`. Aucun réglage par projet : nom et dépôt viennent de la ligne `projets`.
Mécanisme (vérifié dans `hooks/prompt-rappel.sh`) : le premier message d'une session ouverte sur le dépôt
d'un projet branché la rend chef de CE projet. **Limite** : aucun lien de la doc Claude Code ne
préremplit dépôt + message ; ne pas en inventer, l'app copie la phrase et ouvre la page.
**Brancher un projet** = ouvrir une session sur son dépôt et dire « branche le cockpit »
(skill `cockpit` → `scripts/brancher.sh`) ; puis « Traiter ce projet » suffit.

**Une réponse de Raphaël est toujours reprise** (29 sept., migration 0017,
« je réponds, mais je ne sais pas si c'est pris en compte ») : la passe de
`chef.sh` sert D'ABORD `reprendre_reponse` — une question ou action répondue
depuis l'app (`answered_by` posé ; notée par une session = déjà prise, 0018 ;
pas retirée, 7 derniers jours) que rien n'a suivie (aucun message de session,
aucune étape, aucune étape d'agent) sur un chantier que personne ne tient
(réservation expirée, aucun agent ni session vivante), ou une question SANS
chantier (un chantier interne est alors ouvert et la question y est
rattachée). Le chantier repart « en cours », réservé à `agent/reponse-…`, le
fil dit « Claude reprend ta réponse », et la consigne cite question, réponse,
précision, médias, et les barrières de budget si la réponse engage une
dépense. L'app la montre dans « Ça avance tout seul » (« Ta réponse est reçue :
Claude va la reprendre », puis « Claude reprend ta réponse ») :
`repriseReponse` (`lib/entonnoir.ts`). Les projets de TEST (slug `test-…`) ne
sont JAMAIS servis par la chef d'un vrai projet (incident du 29 sept. ; depuis
0019 la passe ne sert que son projet ; `projet_de_test` exclut encore les
tests de `reponses_sans_suite()` sans projet). `verifier-base.mjs` §18.

**Consommation, règle GÉNÉRALE (Raphaël, 30 sept. 2026, migration 0034 puis 0035)** : « ne jamais atteindre la limite des modèles ». Les consignes de `chef.sh` / `renfort.sh` donnent le modèle de chaque agent (paramètre `model` de l'outil Agent) : `haiku` pour Revoir À toi, Point, Vérifier ; `sonnet` pour Répondre/Réponse et coder un chantier ; jamais `opus` sauf mention explicite de Raphaël. `create_session` (renforts, relais) : `model: "claude-sonnet-5-5"`. Frein : 2 agents par défaut (`chefs.max_agents`) ; si `get_session` → `rate_limit_info.status` n'est pas `allowed`, au plus 1 agent et aucune revue. Un élément de « À toi » confirmé ne revient pas avant 24 h (`a_toi_a_revoir`). **Bascule automatique (30 sept. 2026, migration 0037, chantier 29fac2e1)** : le NOMBRE d'agents ne pose pas problème, seuls les modèles : l'usage ne freine plus les agents, il descend les MODÈLES. `chef.sh --usage <status> --fenetre <rateLimitType> --reset <resetsAt>` (depuis `get_session` → `external_metadata.rate_limit_info`, qui n'a AUCUN pourcentage : seulement status, type de fenêtre, resetsAt) pose un palier 0 à 3 (`bascule_usage`, règle `palier_cible`, **migration 0045**, chantier a1a67b3d : « Haiku n'est pas assez puissant : dernière option ; plein gaz jusqu'à 50 %, puis répartir jusqu'à la fin de la fenêtre ») : 0 plein gaz (modèles et effort réglés), 1 effort d'un cran plus bas, 2 effort bas + modèle d'un cran plus léger sans passer sous Sonnet, 3 Haiku seulement (si autorisé) quand la limite est atteinte. Rythme = part écoulée de la fenêtre (5 h ou 7 j) + statut : avertissement tôt = palier 2, après le seuil = 1, dans les 10 % finaux = 0 (le crédit va être remis à zéro). Réglages par projet : `chefs.bascule_seuil_pct` (50) et `bascule_haiku` (oui), écran « Modèles et effort ». Monte tout de suite, redescend après 30 min de calme, expire à resetsAt ou après 3 h ; une session en pause `rate_limit` vaut palier 3. `modeles_effectifs` (une règle) est lue par `chef.sh` et `renfort.sh`. Interrupteur `chef.sh --bascule on|off` ou bouton de l'app. Le frein « 1 agent » reste un geste manuel seulement. `verifier-base` §32.

## Sessions qui se ferment seules (30 sept. 2026, migration 0038, chantier 27d251f8)

Raphaël : « dès qu'une session a fini son travail elle se ferme directement ; un
correctif ou une vérification repart ensuite dans une nouvelle session. Éviter la
pollution. » Avant : seuls les renforts finis étaient archivés (à la passe
suivante de la chef) ; sessions relais et sessions de réveil /fire restaient
ouvertes. Maintenant, chaque session ouverte par le cockpit reçoit une consigne de
fin : renfort FINI, relais (`[cockpit-relais]`) et réveil /fire s'archivent
eux-mêmes si l'outil `archive_session` existe (`get_session` sans id = son id) ;
sinon la chef les archive à sa passe (`renforts_a_ouvrir.archiver`,
`ouvertures_a_fermer` / `relais_a_servir.fermer`, puis `chef.sh
--ouverture-archive <id>`). Jamais fermée : session avec un chantier en cours,
une question posée sans réponse, ou un message de Raphaël sans réponse
(`ouverture_finie`, une seule règle). Réglages par projet (`projets`,
`regler_fermeture`, écran « Modèles et effort » du cockpit, ou `chef.sh
--fermeture oui|non [minutes]`) : `fermeture_auto` (oui) et
`fermeture_delai_min` (10). Ouvrir seulement s'il y a du travail : le relais
n'ouvre que s'il y a un message sans réponse ; `reveiller_chef` renvoie
`rien_a_servir` (aucun /fire) quand rien n'est sans réponse ni sans suite.
Limite : une session /fire dont le modèle n'a pas l'outil `archive_session`
reste ouverte (non suivie en base). `verifier-base` §34.

## Traité sans attendre : aucun chantier « tenu » pour rien (30 sept. 2026, migration 0043, chantier fb19d6a8)

Raphaël : « je ne veux pas que les chantiers soient tenus, je veux qu'ils soient
traités quand ils peuvent l'être. » Mesuré sur la base : 0036 ne libérait que les
`en_cours` ; restaient tenus pour rien un chantier libre réservé 60 min par un agent
« Répondre/Point » mort (ses réponses attendaient), la section d'un renfort muet
depuis 100 min (« vivant » 3 h), un message pris par un agent mort (2 h). UNE règle,
`sans_signe_de_vie(c)` (fiche, activité, agent, session : 30 min de silence), lue par
`chantier_abandonne`, `renfort_vivant` (signe de vie du renfort OU d'un de ses chantiers)
et `liberer_silencieux(slug)` : libère la réservation (`libere_at/de/apres_min` sur la
fiche, JAMAIS un message de session dans le fil : il compterait comme réponse) et remet
à servir le message que l'agent mort avait pris. Appelée en tête de `chef.sh`, `passe.sh`,
`hooks/autonome.sh`. L'écran (`phraseLiberee`) : « Pris par X, sans signe de vie depuis N
min : libéré à HH:MM, repris seul vers HH:MM ». `verifier-base` §37, `verifier-silence.ts`.
Limite : un agent qui code plus de 30 min sans aucune étape signalée est libéré (même
seuil qu'en 0036).

## PR à fusionner : une carte « À toi » par PR (30 sept. 2026, chantier dbae6397)

Raphaël : « je n'ai aucune notification dans le cockpit pour savoir quand merger ».
`scripts/pr-a-fusionner.sh <n>` (commande `cockpit-pr-a-fusionner.sh` dans les projets branchés) pose UNE action
« Fusionne la PR #n : <titre> » (lien exact + « Merge pull request » + « Confirm merge » ; question ≤ 140 car.).
Clé = numéro de PR : 2 appels = 1 carte, une carte déjà répondue n'est pas reposée. `--fermee` (ou `--etat
merged|closed`) la retire ; `--etat open|…` évite GitHub (sinon un GET léger, `GITHUB_TOKEN` si dépôt privé). Tout
agent qui ouvre une PR l'appelle juste après (consignes de `chef.sh` / `renfort.sh`, une seule règle). La passe de
`chef.sh` réconcilie (au plus 30 min par projet, jamais un projet de test) : la chef liste les PR ouvertes (un appel
GitHub) et appelle le script pour chacune ; les cartes dont la PR n'est plus ouverte : `--fermee`. `verifier-base` §37.

**PR en conflit : visible, et sa réponse automatique n'est pas une réponse** (5 oct. 2026, migration 0059, chantier f5ad1859 ; Raphaël : « je n'ai rien pour voir qu'une branche est en conflit »). `pr-a-fusionner.sh` : PR dirty/behind = UNE carte « À toi » « PR #n en conflit : un agent la répare » (ou « à mettre à jour »), à la place de « Fusionne » ; retirée seule (réponse auto) quand la PR est propre, fermée ou fusionnée ; CI en cours ou calcul GitHub en cours : rien n'est retiré. Les réponses automatiques du script (« PR #n pas prête / propre / fusionnée ou fermée ») ne posent plus `answered_by` et `est_reponse_automatique` les écarte de `reponses_sans_suite` (elles créaient des chantiers parasites « Suite de ta réponse : Fusionne la PR… »). `verifier-base` §44. Les anciens chantiers parasites ne sont pas supprimés (accord de Raphaël requis).

**« Fait » sur une carte « Fusionne la PR #n » n'est jamais reprise** (5 oct. 2026, migration 0060, chantier dfa16cd8). Parasites encore vus sur #72, #61, #28, #85. Cause PROUVÉE sur #61 : `est_accuse_action` (0041) refuse l'accusé dès qu'un message de Raphaël AVEC fichier tombe au même chantier dans les 10 min (il le croit joint à la réponse) ; la carte de PR vit dans un chantier où il écrivait (réponse 14:39, image 14:40, parasite 14:40). UNE règle, `cockpit.est_accuse_carte_pr` (corps « Fusionne la PR #n : », réponse « Fait »/« Pas encore » sans précision ni fichier SUR la carte), lue par `reponses_sans_suite` (donc `reprendre_reponse`, la chef et le hook de démarrage). Toujours servies : « Ça bloque », toute réponse avec un texte ou un fichier de la carte, toute autre action. `verifier-base` §46 (`SEUL=46`). Anciens parasites non supprimés.

## Correctifs GÉNÉRAUX, jamais par projet (Raphaël, 29 sept. 2026)

« Ce sont des correctifs généraux, peu importe le repo ou le projet que je
brancherai ; le modèle de cockpit doit être réutilisable et branchable sans
correctif par projet. » Tout se corrige ICI (app, base, scripts, hooks,
modèles), jamais dans un projet branché ; un projet ne reçoit que ce que
propagent le lanceur et `brancher.sh`. Et toute session qui travaille ici se
voit dans le cockpit (chantier + `progression.sh` à chaque étape).

## Les projets branchés GARDENT les mises à jour (29 sept. 2026)

Constaté sur FacePro : les scripts arrivaient (lanceur), mais le bloc
CLAUDE.md et les nouvelles commandes n'étaient jamais commités — chaque
nouvelle session repartait des anciennes règles. Désormais le hook de
démarrage commite lui-même les fichiers du cockpit sur la branche courante
(seulement ceux qui étaient propres avant : jamais un travail en cours), et
injecte le bloc à jour dans le contexte de la session.

## Dépôt qui n'est pas à Raphaël : trois voies (30 sept. 2026, chantier f31ae3ec)

Raphaël : « Les 3 options me plaisent, ça laisse le choix au client. »
`brancher.sh` refuse sans `--voie` quand le propriétaire du dépôt n'est pas
`rnab26` (`COCKPIT_PROPRIETAIRE`) ; le tableau est dans le README.
- **Voie 1, invisible** : rien dans leur dépôt, ni commit (le hook de
  démarrage saute mise à jour et commit quand `COCKPIT_SANS_TRACE=1`, posé par
  le lanceur de `~/.cockpit/bin` qui reconnaît le dépôt à son `origin`). Les
  consignes du bloc arrivent par le hook, commandes en chemin complet. Tient
  tant que le script d'installation de l'environnement de Raphaël relance
  `brancher.sh --voie invisible --maj` (action de Raphaël, une fois).
- **Voie 2, branches de Raphaël** : `COCKPIT_VOIE=branches` et
  `COCKPIT_BRANCHES` dans leurs réglages (sur ses branches) ; garde
  `modeles/cockpit-pre-push.sh` (la SEULE règle « trace du cockpit »,
  `--traces`, reprise par `scripts/greffe.sh`) ; hors de ses branches, le hook
  ne pose que la garde, ne met rien à jour, ne commite rien. Un dépôt qui
  range ses hooks git ailleurs (`core.hooksPath`) n'a pas de garde : dit.
- **Voie 3** : inchangée.
Un chemin de commande peut donc être ABSOLU (`COCKPIT_*_CMD`) : ne jamais
écrire `"$RACINE/$CMD"` sans `case "$CMD" in /*)`. `verifier-greffe.mjs`.

## Vérifier un chantier livré : lien exact, trois issues claires (5 oct. 2026, migration 0056, chantier 2d21c64f)

Raphaël (30/09) : on lui demandait de tester « sans le lien exact », et « Corriger » exigeait un correctif qu'il n'a pas ; il écrivait dans le fil « ça ne marche pas », sans savoir si c'était pris en compte. (1) `progression.sh --verifier` refuse une étape sans lien https (`--sans-lien "pourquoi"` si rien à ouvrir). (2) Le bloc « à vérifier » offre « Ça marche » (certifie), « Ça ne marche pas » (mots FACULTATIFS) et « Je ne peux pas vérifier » : les deux derniers = `signaler_ne_marche_pas` / `demander_verification` (une règle, `poser_verification` ; `verif_motif` = `ne_marche_pas` / `ne_sait_pas`) ; Claude (agent « Vérifier » de `chef.sh`, consigne selon le motif) rejoue le cas puis `verdict.sh` : `--pas-bon` → le chantier repart en correction, `--bon` → retour à lui avec la preuve. « Corriger » (mots obligatoires) n'existe plus sur un chantier à vérifier ; `corriger_chantier` reste pour « Signaler un problème » d'un chantier certifié. (3) Un message TAPÉ dans le fil d'un chantier « à vérifier » vaut « ça ne marche pas » : le déclencheur `verif_sur_message` pose la vérification (ou l'ajoute à celle en cours) et répond « Reçu… » dans le fil. Le constat s'écrit « Ça ne marche pas (je ne sais pas pourquoi)… » (jamais « Ça ne marche pas : », message libre à réponse écrite). La migration 0056 est aussi la trace d'objets qu'une session précédente avait posés en base sans la versionner. `verifier-base` §17, `verifier-web` (Ça ne marche pas).

## « Je ne sais pas : vérifie pour moi » (29 sept. 2026, migration 0016)

Troisième bouton sous « Ça marche / Corriger » : Raphaël colle ce qu'il a vu
(ou une capture), Claude juge. `demander_verification` pose la demande (le
chantier sort de « À toi ») ; `scripts/chef.sh` lance un agent qui compare à la
source et rend `scripts/verdict.sh --bon|--pas-bon` (`rendre_verdict`,
service seulement) : bon → retour à Raphaël pour un toucher, pas bon →
correction. « Comment vérifier » : une observation évidente, jamais compter.

## Réponses courtes (Raphaël, 29 sept. 2026)

« Je veux des réponses simples, courtes, nettes et précises. » Dans la
conversation comme dans le cockpit : la réponse d'abord, en quelques lignes,
puis ce qu'il doit faire. Pas de pavé, pas de détail technique non demandé.

## Réponses du cockpit en direct (29 sept. 2026)

Quand Raphaël répond ou écrit dans le cockpit sur un chantier qu'une session
tient (réservé à sa branche, ou suivi par un de ses agents), `hooks/suivi.sh`
(PostToolUse, toutes les 20 s au plus, 3 s max) le met sous les yeux de la
session avant son prochain pas. Une session à l'arrêt le reçoit à son réveil
(UserPromptSubmit, sans attendre les 20 s ; la chef : au plus une heure).
Un agent reçoit les réponses de SES chantiers (`agent_id` + branche de son
dossier), avec son propre curseur. Curseur = heure de la base au dernier
passage réussi (une panne ne fait rien perdre). Nouvelle session : le hook de
démarrage montre « Ses RÉPONSES que personne n'a encore prises » : la MÊME règle
que la chef, `reponses_sans_suite(projet, sa branche)` (0018 ; jamais réécrite
dans le hook), et pose le curseur.
Bilan du 29 sept. et preuve : `node scripts/verifier-reponses.mjs` (16
contrôles, vrais hooks, vraie base, projet jetable). Le cas « personne ne
tient le chantier » relève de `scripts/chef.sh` (chantier 6c8c6084).

## « Où ça en est ? » se suit, jamais empilé (29 sept. 2026, migration 0023)

Raphaël : « on ne voit pas de différence en cliquant […] qu'on ne pollue pas
les sessions en cliquant 10 fois, et que ça ne reste pas statique ». L'app
passe par `demander_ou_en_est` : UNE demande en attente par chantier
(`messages.ou_en_est`), un deuxième toucher rend la même (verrou, 10 touchers
= 1 ligne). Répondue = un message de session après elle ; périmée après
`delai_ou_en_est()` (2 h, = `DELAI_OU_EN_EST_MS` de `lib/ouEnEst.ts`,
comparés par verifier-base §24). Suivi : envoyée → reçue (`recu_at`, posé par
`hooks/suivi.sh` en la remettant à la session qui tient le chantier) ou en
file (position) → un assistant regarde (la chef : `prendre_ou_en_est`, branche
`agent/point-…`, sans réserver le chantier) → réponse (`progression.sh
--point`, `repondre_ou_en_est`, `repond_a`). Dans l'app, le chantier passe
dans « Ça avance tout seul » avec une frise, bouton désactivé tant qu'on
attend ; la réponse y reste un quart d'heure. `verifier-reponses` §7-8.
**30 sept. (migration 0032, correction de Raphaël : « la barre ne se réactive
pas, je ne comprends pas ce qu'il reste à faire »)** : sous une demande en
attente, plus jamais la vieille barre grise d'une livraison passée (point
vivant + frise) ; l'assistant « Point » signale d'abord son étape sur le
chantier (`--agent "Point : …" --chantier`), la ligne redevient VIVANTE avec
sa barre ; sa réponse dit « Fait / Pour finir (qui fait quoi) / Bloque ». UN
seul assistant par fil : `prendre_ou_en_est` prend aussi les messages libres
du chantier, `reprendre_message` la demande en attente (`ou_en_est`) ; l'app
dit « Un assistant regarde » pour toute branche `agent/…`. Les consignes de
`chef.sh` commencent par « switch -c <branche> » : une copie isolée signait
« worktree-agent-… » (`progression.sh` le signale). `verifier-reponses` §8 bis.

## Chaque fil est une discussion (29 sept. 2026, migration 0025)

Raphaël : « la même logique qu'une discussion dans une session […] je pose des
questions du type "je n'ai pas compris ta demande" et je n'ai pas de retour […]
que le dernier artefact où je dois choisir des cartes se mette toujours en
dernier […] comme une discussion WhatsApp. » **Règle : un message de Raphaël
dans un fil = une réponse courte de Claude dans ce fil avant de continuer** (une
étape ne compte pas). UNE commande : `progression.sh --point "…"` (avec
`--chantier <id>`, ou sans pour le fil du projet) → `repondre_dans_fil`, par
laquelle passe aussi `repondre_ou_en_est` (repond_a : la demande « où ça en
est » en attente, sinon son dernier message). UNE règle « message libre » :
`cockpit.est_message_libre` = `estMessageLibre` (`lib/discussion.ts`),
comparées par verifier-base §26 ; `messages_sans_reponse(projet, branche)` sert
le hook de démarrage ET la chef (`reprendre_message` → agent « Répondre : … »,
branche `agent/message-…`, chantier réservé 60 min sans changer d'état) ;
`hooks/suivi.sh` le remet à la session qui tient le chantier et le marque reçu
(`marquer_messages_recus`). App (`Conversation.tsx`) : chronologique, plus
récent en bas, ouverture en bas, Claude à gauche / toi à droite, les cartes
(question, fusion, vérification, décision) TOUJOURS en dernier, et après son
message « réponse en attente » (qui, et le prochain passage de la chef :
`prochain_passage_chef`, `chefs.reveil_minute` posé par `chef.sh --reveil …
--minute`). `verifier-reponses` §9-11.

## Session et cockpit : deux portes égales, un sujet = un fil (29 sept. 2026, migration 0028)

Raphaël : « tu réponds en essayant de tout condenser dans un message […] je
zappe certaines choses. Le but du cockpit est de créer des chantiers et une
ligne avec un chat sur chaque sujet […] le mettre de côté, l'abandonner ou le
reporter […] en live » ; « on peut utiliser peu importe soit le cockpit soit la
session Claude ». Complète la PR #7 (0027 : ses mots tapés en session sont
recopiés dans le fil).
- **Côté session** : `hooks/prompt-rappel.sh` ouvre un « tour » à chaque VRAI
  message (fichier `<.git>/cockpit-tour`, même filtre que `suivi.sh`) et dit
  « un sujet = un fil » ; `chantier.sh --ouvrir` y note le chantier ; le hook
  Stop (`autonome.sh`, déjà déclaré partout : rien à relancer) refuse l'arrêt
  UNE fois si un chantier du tour n'a aucune réponse de session dans son fil
  depuis le message (`--point` ; la ligne « Chantier ouvert/repris… » ne compte
  pas). La session répond normalement ici ET dans chaque fil.
- **Ses mots tapés en session vont dans le BON fil, seulement lui (30 sept.
  2026, migration 0029)** : constaté sur FacePro, ses questions RunPod
  apparaissaient dans des chantiers sans rapport (déposées dans CHAQUE
  chantier tenu par la session, puis rattachées à tout chantier pris ensuite,
  mode autonome compris) et des rapports d'agents (« <agent-message ») y
  étaient signés « Raphaël (session Claude) ». Désormais `suivi.sh` garde le
  message en attente, et SEULS `chantier.sh --ouvrir` et `progression.sh
  --point`, pendant le tour de ce message, le rattachent à leur chantier
  (`rattacher_messages_session(projet, session, chantier, début du tour)`).
  Plus de trigger sur `pris_par`. Filtre des hooks : `agent-message` et
  `teammate-message` exclus. `verifier-base` §28, `verifier-reponses` §12.
- **Côté cockpit** : case « Écrire à Claude sur ce projet… » (vue projet,
  `EcrireAuProjet`) → « Discussion du projet » ; un message multi-sujets est
  réparti par l'agent « Répondre » de la chef (un chantier par sujet, une
  réponse par fil). Menu ⋯ du fil : Mettre de côté, Reporter… (4 choix ou une
  date, `lib/reporter.ts`), Abandonner (archivé, Désarchiver le rend) →
  `mettre_de_cote`, `abandonner_chantier` (admin ou session :
  `chantier.sh --de-cote|--abandonner`). Un report daté revient seul dans
  « Prêt à lancer » (`reveiller_reportes` : passe de la chef, ouverture de l'app).
- **Projet sans chef vivante** (`chef_vivante` : vue < 3 h) : LA chef relais
  (`chef_relais()` : celle du cockpit si elle vit) ouvre ses renforts et, s'il a
  des messages sans réponse et aucune session vivante, UNE session du projet
  (« [cockpit-relais] », au plus 1/h, `chef.sh --ouverture`) — jamais son
  travail ni sa réponse d'ici (`relais_a_servir`, `chef.sh --relais-texte`).
  Une session relais ne devient jamais chef. L'app : « en attente : aucune
  session <projet> active · la session chef de cockpit l'ouvre vers HH h MM ».
- **Réveil immédiat** (déclencheur API d'une Routine, doc « routines » lue le
  29 sept. : `POST https://api.anthropic.com/v1/claude_code/routines/<trig>/fire`,
  `Authorization: Bearer`, `anthropic-beta: experimental-cc-routine-2026-04-01`,
  `anthropic-version: 2023-06-01`, corps `{"text"}`). Raphaël colle adresse +
  jeton dans Réglages du projet (`ReveilImmediat.tsx`) → `regler_reveil_immediat`
  met le jeton dans le COFFRE (Vault), jamais dans une table ; un trigger sur
  ses messages libres, ses réponses et les demandes de renfort appelle
  `reveiller_chef` → pg_net (après validation), au plus 1 / 5 min par projet,
  rien si une session vivante tient le chantier ; cible = `cible_reveil` (sa
  chef vivante, sinon la chef relais ; un projet de test : lui seul). Sans
  jeton : passage horaire, l'app dit l'heure (`prochain_passage_chef` ; ~3 min
  après un réveil).
- **/fire ouvre une NOUVELLE session** (constaté le 30 sept. au premier jeton,
  conforme à la doc : « starts a new session ») — jamais la session chef, même
  si la routine y est liée pour ses passages horaires. Cette session n'a que
  les dépôts de la ROUTINE : sans le dépôt, elle répondait « Cockpit-General
  n'est pas cloné ici ». Il faut donc (1) le dépôt du projet dans les dépôts de
  la routine (claude.ai/code/routines › la routine › menu › Edit ; action de
  Raphaël, aucun outil ne le fait ; fait le 30 sept., vérifié : son message
  de 00:23:11 → session ouverte par /fire → réponse dans le fil à 00:24:08),
  la routine sur l'environnement qui porte les clés Supabase ; (2) son prompt = `chef.sh --texte-routine` (un seul texte
  pour les deux cas ; commence par « Réveil du chef », donc le hook de message
  ne fait pas d'elle la chef), qui lance `chef.sh --releve` : la chef → la
  passe ; une autre session → si la chef vit (`chef_vivante`), elle sert
  SEULEMENT ce qui attend Raphaël (réponses, « où ça en est », messages) sans
  toucher au signe de vie de la chef, puis s'arrête ; chef morte → elle devient
  chef (sans déplacer le réveil). Une routine qui porte le jeton ne se supprime
  jamais (le jeton mourrait avec). `verifier-base` §19 (« routine de réveil »).
`verifier-base` §29, `verifier-reponses` §13-14, `verifier-reporter.ts`.
- **« Il faudrait aussi X » écrit dans un fil → Claude crée le chantier**
  (30 sept. 2026, migration 0033, chantier 7b85b3bd ; Raphaël : « plutôt que
  de quitter ce chat et de créer un nouveau chantier manuellement »).
  `chantier.sh --ouvrir "<titre>" --demande "<ses mots>" --depuis <id du fil
  | projet> [--reponse "…"] [--section …]` → `ouvrir_depuis_fil` : chantier
  créé « libre » (Prêt à lancer, NON réservé à l'agent qui répond : avant,
  `--ouvrir` le laissait « en cours » réservé 3 h à personne de réel), rangé
  (`--section`, sinon Correctifs 0021, sinon la section du fil) ; si le sujet
  existe et vit, sa demande est complétée sans toucher à état ni réservation ;
  un livré/certifié/archivé n'est jamais rouvert (nouveau chantier). La
  réponse part dans le fil d'origine par `repondre_dans_fil` (elle compte
  comme réponse) avec `messages.chantier_lie` → bouton « Ouvrir ce fil » dans
  la bulle (`filLie`, `lib/discussion.ts`) ; le nouveau fil renvoie à
  l'origine. Même recherche de doublon que `ouvrir_ou_reprendre`
  (`trouver_chantier`, une seule règle). Consignes : agent « Répondre » de
  `chef.sh` (point 3), session relais, `hooks/suivi.sh`, hook de démarrage,
  bloc CLAUDE.md. `verifier-base` §31, `verifier-discussion.ts`.

## Fusion : menu « Fusionner avec… » et carte suggérée toute seule (30 sept. 2026, migration 0042, chantier 5b5900a9)

Raphaël : « ce chantier est un doublon d'un nouveau chantier ; la fusion n'a pas
été proposée […] je préfère qu'on me SUGGÈRE une fusion automatique plutôt que
de me laisser déduire. » (1) Menu ⋯ du fil › « Fusionner avec… » (`Doublons.tsx::
DoublonDe`, `lib/fusion.ts`) : liste recherchable des chantiers OUVERTS du même
projet, confirmation qui dit ce qui se passe, toast, état vide ; passe par
`fusionner_chantiers` (une seule règle). (2) Un trigger sur `chantiers` (création
ou titre modifié, toutes voies) pose UNE carte `fusion` « À toi » quand le titre
ressemble au plus près à un chantier ouvert du même projet : `ressemblance_fusion`
= la plus forte de la similarité de trigrammes des SUJETS et des mots
significatifs communs (au moins 2, jamais un seul), `candidat_fusion`,
`poser_carte_fusion` (une carte par paire, dans un sens ou l'autre, même refusée ;
partagée avec `suggerer_fusion` des sessions). Le nouveau est la source, l'ancien
est gardé. Jamais : projet `test-…`, chantier archivé/certifié/doublon.
Réglable par projet : `projets.fusion_seuil` (0,65 par défaut, mesuré : 0,60
proposait des cousins) et `fusion_auto`, `regler_fusion(slug, auto, seuil)`
(pas encore d'écran : SQL ou `scripts/sql.sh`). Un faux doublon constaté → un cas
dans `scripts/verifier-fusion.mjs` d'abord. `verifier-base` §37,
`verifier-fusion.ts` (menu).

**À la création : compléter, fusionner ou créer quand même** (5 oct. 2026, migration 0060, chantier 69f1650e + doublon 7e4e615a ; Raphaël : « ça me montre ce qui existe déjà mais ne propose pas de fusionner ou d'actualiser […] est-ce que la fusion récupère précisément la demande des DEUX chantiers ? »). Preuve sur un projet jetable : `fusionner_chantiers` gardait bien les deux demandes, mais écrivait « \n » en toutes lettres (littéral sans `E`), laissait un séparateur vide sans demande et ajoutait la demande deux fois si on refusionnait ; corrigé (cible intacte, puis séparateur + demande de la source ou « (aucune demande écrite) », refus d'un doublon déjà fusionné). Dialogue « + Chantier » (`NouveauChantier.tsx`, admin) : sous un titre proche, chaque chantier ouvert proposé a « Compléter celui-ci » (`completer_chantier` : les mots tapés s'ajoutent à sa demande + une ligne dans son fil, aucun chantier créé) et « Fusionner » (création puis `fusionner_chantiers`, une seule règle) ; le bouton principal devient « Créer quand même ». Confirmation avant, toast succès/échec, la fusion qui échoue après la création le dit. UNE règle de ressemblance : `chantiers_proches_creation` (= `ressemblance_fusion` + `projets.fusion_seuil`), l'app ne recalcule plus (Jaccard retiré de la création ; ne pas confondre avec `chantiers_proches(text,…)` des sessions, 0007). Un non-admin voit la liste sans les boutons. `verifier-base` §46, `verifier-fusion.ts`, `app/scripts/verifier-creation.mjs` (parcours téléphone : compléter, fusionner, créer quand même, recherche en panne).

## Libération automatique par la base (5 oct. 2026, migration 0050, chantier 6020714d)

Raphaël : « libérer automatiquement les chantiers bloqués par des sessions le plus rapidement possible ». Cause : `liberer_silencieux` (0043) n'était appelée qu'au passage de `chef.sh` / `passe.sh` / `autonome.sh` ; sans passage, un chantier tenu par une session morte restait « en_cours » jusqu'à la fin de sa réservation. Un job pg_cron (`cockpit-liberation-auto`, toutes les 3 min, visible dans `cron.job`) appelle `liberation_passe()` : le MÊME balayage (`liberer_silencieux_coeur`, corps unique ; `liberer_silencieux` des sessions le délègue après son contrôle d'appelant) et la même règle `sans_signe_de_vie` / `delai_signe`. Jamais un projet `test-…`. Interrupteurs : `projets.liberation_auto` (par projet) et `filet_reglage.liberation_actif` (global, coupe aussi le job), `regler_liberation(slug|null, actif)`. Pas d'écran (SQL). `verifier-base` §40.

## Regrouper les chantiers avant de les traiter (5 oct. 2026, migration 0055, chantier 8486b809)

Raphaël : « la chef doit réfléchir à une logique de fusion quand elle reçoit les chantiers […] regrouper ceux qui peuvent être faits ensemble […] et une fois livrés, qu'on comprenne que deux chantiers ont été fusionnés, actualisé dans le cockpit du projet ». Avant de lancer ses agents, `chef.sh` liste les paires de chantiers ouverts qui se ressemblent (`groupes_possibles`, même mesure `ressemblance_fusion` que la fusion suggérée, seuil 0,35, jamais une paire déjà « Garder séparés ») et dit à la chef de juger : même sujet → `chantier.sh --suggerer-fusion` ; sujets voisins → `chantier.sh --regrouper <id> --avec <id>` (`regrouper_chantiers`, `chantiers.groupe_avec`) puis UN agent fait les deux ; sans rapport → rien. À la livraison, un trigger (`propager_livraison_fusion`) écrit « Livré avec « X » » dans le fil de chaque chantier fusionné (doublon) ou regroupé, et « Cette livraison couvre aussi : … » dans le fil livré. Limite : pas d'écran de réglage du seuil (0,35 en dur dans la fonction) ; la chef juge, rien n'est regroupé automatiquement. `verifier-base` §43.

## Rien repris à tort : « Terminé » sort de bloqué, déjà livré = pas repris (5 oct. 2026, migration 0051, chantier 72d09c69)

Raphaël (réponse « Les 3 correctifs ») : (1) `progression.sh --termine` passe aussi un chantier « bloqué » à « à vérifier » (avant : seulement en cours / libre / à trier, le chantier livré restait « bloqué » — l'ancienne mise en garde du bloc FacePro tombe) ; (2) UNE règle `cockpit.livre_sans_suite(c)` (dernière activité « terminé » et aucun message de Raphaël / d'un utilisateur depuis) lue par `chantiers_prenables` : un chantier libre / à trier déjà livré n'est pas repris par le mode autonome, un « Corriger » ou une réponse le rouvre ; déjà pris = réservation valide (0036) ; (3) la passe de libération rend les réservations EXPIRÉES (`pris_par` vidé, sauf chantier « en_cours » dont `chantier_abandonne` a besoin). `verifier-base` §42 (`SEUL=42`).

## Délai « sans signe de vie » : 3 min, réglable par projet (30 sept. 2026, migration 0046)

Raphaël : « Pourquoi attendre 30 minutes ? […] zéro chantier tenu pour rien. »
UN réglage, `projets.delai_sans_signe_min` (1 à 120, défaut 3), lu par UNE
fonction `cockpit.delai_signe(projet)` que lisent `sans_signe_de_vie`,
`renfort_vivant` et les autres règles « session/agent vivant » (messages sans
réponse, réponses sans suite, « où ça en est », mode autonome, réveil, relais,
filet) : plus aucun « 30 minutes » en dur (`verifier-base` §39 le vérifie sur
les fonctions en vigueur ; toute nouvelle règle « vivant » lit `delai_signe`).
Réglage : app (Renforts › Réglages › « Libérer un chantier réservé sans signe
de vie depuis… », message succès/échec) ou `chef.sh --sans-signe <min>` ;
l'écran (`lib/silence.ts`) reçoit la valeur du projet, son défaut 3 est comparé
à celui de la colonne. **Mesuré** : le signe de vie d'une session ne part qu'au
RETOUR d'un outil (PostToolUse, ≤ 1/min) et les tâches d'agent (`taches.vu_at`)
le suivent ; un outil long (jusqu'à 10 min, plafond du Bash) ne disait rien.
D'où le hook **PreToolUse** de `hooks/suivi.sh` : un battement détaché toutes
les 45 s tant que l'outil tourne (déclaré par `brancher.sh`, propagé par le
hook de démarrage → `brancher --maj`). Limite : un long texte sans aucun outil
(> délai) reste muet. Le cadenas est posé À L'ATTRIBUTION (`reserver_chantier`
dans la même transaction que le choix ; la fiche est touchée, début du délai).

## Un agent vivant garde son chantier (5 oct. 2026, migration 0054, chantier b95c96f9)

Constaté le 30/09 : la chef relançait « Écrans en attente » et « Vérifier un chantier » alors que leurs agents travaillaient, et réattribuait le chantier à `agent/160812`. Cause PROUVÉE (banc rouge, `verifier-base` §41) : `sans_signe_de_vie` ne comptait un agent vivant que si son battement ou sa ligne avait bougé depuis `delai_signe` (3 min), alors qu'il signale une étape toutes les ~10 min ; `reserver_chantier` donnait alors le chantier à un autre nom de branche, et `ouvrir_ou_reprendre` (`chantier.sh --ouvrir`) écrasait `pris_par` sans rien vérifier. Maintenant, UNE règle `agent_tient_chantier` : ligne tâche liée au chantier, en cours, session non finie, battement < `delai_signe` OU dernière étape < `delai_signe_agent` (`projets.delai_agent_signale_min`, 20 min par défaut, 3 à 240, SQL pour l'instant). L'activité `en_cours` suit ce même délai. Lue par `chantier_abandonne`, `chantiers_prenables`, `reserver_chantier` et le balayage de 3 min. `ouvrir_ou_reprendre` ajoute la demande mais garde `pris_par` d'un chantier tenu. Limite : un agent mort garde son chantier jusqu'à 20 min au lieu de 3 ; la ligne doit être liée au chantier (`progression.sh --agent … --chantier`). `SEULEMENT=<contrôle> node scripts/verifier-base.mjs` ne rejoue qu'un contrôle.

## Renfort vivant = sa SESSION vit (5 oct. 2026, migration 0057, chantier 2bf7d90c)

Cause prouvée : `renfort_vivant` ne lisait que `renforts.vu_at` (posé seulement par `renfort.sh --suivant`) et ses chantiers ; un renfort dont la session travaillait (hooks → `sessions.vu_at`) était déclaré mort après `delai_signe`, passé « erreur » par `renforts_expirer`, et la chef disait « muet depuis 3 h » (libellé faux, corrigé).
`renfort.sh --suivant` lie la session des hooks (`CLAUDE_CODE_SESSION_ID`, ≠ `session_distante` cloud) par `renfort_lier` → `renforts.session_hook` ; UNE règle, `renfort_vivant`, la lit (session non finie, vue depuis moins de `delai_signe`). Limite : lié au premier `--suivant` ; avant, seule la règle d'avant joue. `verifier-base` §42.

## Filet de sécurité : du travail attend, personne ne traite → réveil auto (30 sept. 2026, migration 0044, chantier 42938fc3)

Raphaël : « un chantier ne doit jamais rester mort […] sans que j'aille vérifier dans l'app Claude Code ». Un job **pg_cron** de la base (`cockpit-filet-securite`, toutes les 3 min, visible dans `cron.job`) appelle `filet_passe()` : par projet, si du travail attend (`filet_attente` : messages sans réponse, réponses sans suite, vérifications demandées, renforts demandés, chantiers prenables SEULEMENT si le mode autonome est allumé) depuis plus de `filet_delai_min` (10) et que rien ne vit (`filet_vivant` : session, agent, renfort < 30 min), elle appelle `reveiller_chef` (réveil immédiat 0028, jeton dans le Vault, jamais lu ici). Sûretés : jamais un projet de test, au plus 1 réveil/5 min/projet (table `filet_reveils`), plafond `filet_plafond_jour` (6, réglable 0-48), interrupteur par projet (`regler_filet`, `chef.sh --filet oui|non [plafond] [délai]`) et global (`regler_filet_global`, `chef.sh --filet-global oui|non`, coupe aussi le job). Sans jeton : rien n'est appelé, l'écran dit « colle le jeton dans Réglages ». Écran : `FiletSecurite.tsx` (vue projet, `etat_filet`, `lib/filet.ts`). Non couvert : PR en conflit. `verifier-base` §38, `verifier-filet.ts`.

## Déplacer un chantier vers un autre projet (30 sept. 2026, migration 0038)

Raphaël : un chantier écrit dans FacePro devait être un correctif du cockpit.
Menu ⋯ du fil › « Déplacer vers un autre projet… » (`Conversation.tsx`,
`lib/deplacer.ts`, confirmation avant) → `deplacer_chantier(id, slug)` (admin
ou session) : change le projet du chantier ET de ses messages, activité, « ce
qui marche », assistants, passes ; section remise (même nom, créée dans le
projet cible) ; réservation libérée ; lien « doublon de » coupé ; ligne
« Déplacé de … vers … » dans le fil. Les fichiers restent au même chemin
(le stockage ne se renomme pas en SQL) : `peut_lire_media` les accepte via le
message qui les cite. `verifier-base` §36, `verifier-deplacer.ts`.

## Questions et assistants toujours à jour (29 sept. 2026, migration 0015)

Une question ouverte que du travail a suivie s'affiche « Claude a avancé
depuis : peut-être plus utile » ; la session la confirme (`demander.sh
--confirmer`) ou la retire (`--retirer <id> "pourquoi"`), rappel du hook
toutes les 15 min. Un assistant listé en cours reste « en cours » tant que sa
session vit (trigger 0015 : `taches.vu_at` suit `sessions.vu_at`) — SAUF une
ligne provisoire `prov:…` (migration 0030, 30 sept.) : elle ne vit que par
ses étapes, passe « arrêtée » après `delai_tache_prov()` (45 min) sans étape,
et `progression.sh --chantier X --termine|--echec` ferme celles de sa session
sur X. `chef.sh` compte ses agents par `agents_actifs(session, projet)`.
**Un agent = une seule ligne comptée (30 sept. 2026, migration 0048, chantier dd84764f)** :
Raphaël voyait la chef répondre RIEN (« 8 agents ») avec 6 chantiers en attente. Mesuré : les
commandes de fond (`wait`, `until`, tests ; type `commande`/`autre`) n'ont jamais été comptées ;
c'est un DOUBLON : un agent = sa vraie ligne (hook, description de l'outil Agent) + sa ligne
`prov:` (`progression.sh --agent`, sa propre description), jamais réunies quand les deux textes
diffèrent (9 lignes pour 6 agents). `agents_actifs` = vraies lignes vivantes + provisoires en
surplus des vraies lignes muettes (sans étape ni chantier). Plafond `chefs.max_agents` : 1 à 8
(check en base), inchangé. `verifier-base` §30.
Incident : 5 agents fantômes bloquaient la chef parce que
`.claude/settings.json` était du JSON invalide (deux objets collés, commit
f2b6c98) : Claude Code ignore alors TOUS les hooks du projet, sans erreur
visible. `chef.sh` affiche désormais une ALERTE, la CI rougit.
`verifier-base` §30.

**« À toi de jouer » à jour** (29 sept. 2026, migration 0022, Raphaël : « des
requêtes d'il y a 12 h déjà répondues dans la session ; je ne sais pas
lesquelles sont récentes ou vieilles »). Chaque ligne dit son âge (« il y a
12 h », `ElementAToi.depuis`), le plus récent en haut (réglable, préférence
`tri_a_toi`) ; « Claude a avancé depuis : peut-être plus à jour » vaut pour
TOUS les types et passe en bas (`aToi`, `lib/entonnoir.ts`). En base (trigger
`retirer_sans_objet`) : un chantier certifié ou archivé ferme les fusions qui
le citent ; un chantier ARCHIVÉ ferme aussi ses questions, un CERTIFIÉ les
GARDE (migration 0026, 29 sept. : une question sur une décision future,
876ad67b, fermée en certifiant 450afa9e). « Ça marche » montre d'abord les
questions ouvertes du chantier (répondre, ou « Certifier quand même » :
`BlocValidation`, `questionsOuvertesDe`) ; elles restent dans « À toi ».
Piège : `certifier_chantier` pose AUSSI `archived_at` (« Fini ») ; toute règle
qui écarte les archivés garde les certifiés (`aToi`, `a_toi_a_revoir`,
`reponses_sans_suite`). Une réponse à une question d'un certifié : la chef
ouvre un chantier « Suite de ta réponse » (le certifié n'est jamais rouvert).
`verifier-base.mjs` §27 ; `a_toi_a_revoir(projet, heures)` (même
règle que l'app ; plus de 12 h, ou du travail depuis ; jamais un chantier
qu'une session tient ; « proche » = doublon probable) ; `scripts/revue-a-toi.sh`
en fait la consigne d'un agent, lancée par `chef.sh` sur une place libre ou
par `passe.sh` quand il n'y a rien à coder, au plus une fois par heure et par
projet (`projets.revue_a_toi_at`). Gestes : `demander.sh --retirer`,
`--confirmer <question|chantier>` (`chantiers.a_toi_revu_at`), `--debloquer`,
`chantier.sh --suggerer-fusion`. `verifier-base.mjs` §23.

## Règle de clarté (Raphaël, 29 sept. 2026) — elle vaut pour TOUT le cockpit

« Toutes les questions, les constats, tout ce qui demande une interaction et
de la lecture de ma part, donc tout le cockpit, synthétisé le plus simple
possible : qu'on comprenne le sujet, ce qu'il y a à faire, et qu'on puisse
donner des réponses claires. » Pas d'assistant payant pour « expliquer » :
c'est à la source qu'on écrit clair. Appliquée par les scripts (refus avant
toute écriture) : `demander.sh` (question ≤ 140 car., pourquoi ≤ 250, 2 à 4
options avec aide ≤ 140), `progression.sh` (`--verifier` ≤ 5 étapes
numérotées, ≤ 500 car. ; résumé de `--termine` ≤ 120), `chantier.sh` (titre
≤ 80). Même exigence pour tout texte que l'app affiche.

## Médias dans les réponses (29 sept. 2026, migration 0013)

Raphaël répond avec des cartes ET des photos/vidéos/fichiers (bouton 📎 sur
une question, « Écrire à Claude », certifier/corriger). Stockage PRIVÉ
`cockpit-medias` (le bucket `cockpit` est à Jarvis), chemin
`<projet>/<chantier|projet>/<uuid>-<nom>`, droits par `peut_lire_media` /
`peut_deposer_media` ; colonne `messages.medias`. Les RPC de réponse ne portent
pas de fichier : les médias partent dans un message `info` juste après. Une
session les récupère avec `scripts/media.sh --message|--chantier <id>` (📎 dans
le hook) et les REGARDE avant de répondre.
Dès la création aussi (« + Chantier », 29 sept.) : le chantier n'a pas d'id
avant, donc les fichiers restent sur l'appareil (crayon possible), l'id est
choisi par l'app à l'insertion, puis ils partent dans `<projet>/<chantier>/`
et un message `info` (`useMediasAJoindre(…, { differe: true })`). Dépôt en
échec : chantier créé, pièces gardées, « Envoyer les pièces ». Le module
embarqué (`embed/`) ne joint PAS de fichier : décision à prendre à part.
**Crayon** (29 sept.) : sur toute image jointe (import fini), dessiner dessus
(`Annoter.tsx`, un `<canvas>`) ; avant l'envoi l'annotée remplace la pièce,
après l'envoi elle part en nouveau message « Image annotée : … » du fil.
`verifier-annotation.ts`, et les contrôles « crayon » de `verifier-web.mjs`.

**Et dans l'autre sens : montre, ne décris pas** (29 sept. 2026, migration
0020, Raphaël : « montre-moi des images pour que je comprenne mieux, ou ce
que je suis censé voir »). Une question ou une vérification qui porte sur
quelque chose de visible → joins une capture : `demander.sh --image f.png`
(dans `messages.medias`, miniature sous la question), `progression.sh
--termine … --verifier … --image f.png` (`chantiers.verifier_medias`, « Ce que
tu dois voir » sous les étapes ; un `--termine` sans image efface les
anciennes), `media.sh --envoyer --chantier <id> --texte "…" --image f.png`
(message du fil). Contrôle AVANT toute écriture (`media.sh
--verifier-images` : png/jpg/webp/gif/mp4/webm, 4 au plus, 10 Mo) ; dépôt
service_role dans `cockpit-medias` au chemin du chantier (les droits de
lecture suivent donc ceux du chantier). Écran du cockpit : `node
app/scripts/capture-ecran.mjs <url> <dossier>`. Pas encore affiché par le
module embarqué (`embed/`) : seulement l'app.

## Une action manuelle = lien exact + étapes + texte à coller (30 sept. 2026, migration 0033)

Raphaël (chantier e9a7c360) : « à chaque fois il faut que j'aille chercher et
ce n'est pas assez précis. Il faut que Claude renvoie les liens précis et les
démarches précises pour faire simplement des copier-coller […] peu importe le
type de chantier et dans toutes les discussions. Et un visuel si ça peut
aider. » Règle GÉNÉRALE, pour toutes les sessions de tous les projets
branchés (bloc `docs/bloc-CLAUDE.md`, consignes d'agents de `chef.sh` et
`renfort.sh`) : tout geste demandé à Raphaël donne la page EXACTE, un geste
numéroté par étape (nom exact du bouton), chaque chose à taper prête à coller,
une capture quand ça aide — dans le cockpit ET dans la session. Outil :
`demander.sh --action --lien "https://…|libellé" --etape "…" --copier
"libellé|texte" [--image f.png]` → `messages.marche` (jsonb). Le script
refuse AVANT d'écrire (`scripts/marche.py`) : action sans lien (sauf
`--sans-lien "pourquoi"`) ou sans étape, lien http/page d'accueil, plus de
3 liens / 8 étapes / 4 textes, un texte sans libellé, un SECRET (motifs de
jetons connus). App : `MarcheASuivre.tsx` sous la question (bouton vers la
page, nouvel onglet, domaine affiché ; étapes numérotées ; « Copier » qui dit
« Copié » ou l'échec), lecture défensive `lib/marche.ts` (https seulement),
copie commune `lib/copier.ts`. Pas encore dans le module embarqué (`embed/`) :
une action s'adresse à Raphaël, pas à l'utilisateur final. `verifier-base`
§31, `verifier-marche.ts`, `verifier-web.mjs` (« action manuelle »).

## PR sans conflit : la carte n'arrive que quand la PR est prête (30 sept. 2026, chantier 6ef35b6e)

Raphaël : « à chaque fois il y a des conflits sur les branches […] envoie-moi les PR une fois les conflits réglés ». Cause : des agents en parallèle partent d'un main ancien (verifier-base, CLAUDE.md, migrations numérotées : trois 0041).
1. `scripts/pr-a-fusionner.sh` ne pose la carte que si GitHub dit `mergeable_state` = clean (ou unstable/blocked sans CI en échec ni en cours) ; sinon « PAS PRÊTE : <raison> », et une carte existante devenue caduque est retirée (réponse « PR #n pas prête », qui n'empêche pas de la reposer). Tests : `--merge-state`, `--ci`.
2. Les agents fusionnent `origin/main` dans leur branche JUSTE avant d'ouvrir la PR ; la passe de `chef.sh` lance un agent léger « Résoudre le conflit de la PR n » sur toute PR dirty/behind, puis rappelle le script ; quand une PR est fusionnée, les autres sont mises à jour avant d'être proposées.
3. À la source : la liste des contrôles de `verifier-base.mjs` est UN contrôle par ligne (en ajouter un = une ligne, à côté de son sujet), et `scripts/prochaine-migration.sh` donne le numéro libre (max des fichiers locaux et des branches distantes + 1 ; la base n'a pas de journal des migrations cockpit) : à appeler au moment d'écrire le fichier.
4. `verifier-base` §38 (carte selon la propreté) et §38 bis (numéro de migration).

## Survie des données : rien ne se perd, même hors ligne (5 oct. 2026, chantier 5b68a493)

Raphaël : « toutes les données survivent, même sans wifi, plus de crédit Claude, cache vidé : enregistrées et récupérées à la prochaine connexion ». Deux files, une règle chacune.
- **App** (`lib/fetchResilient.ts`, branché comme `global.fetch` du client Supabase ; règle pure `lib/fileAttente.ts`, stockage IndexedDB `lib/fileAttenteStockage.ts`). Une ÉCRITURE (insert/update/delete, RPC d'écriture, dépôt de fichier) qui ne part pas (réseau coupé, 502/503/504) est gardée sur l'appareil (fichiers compris), l'appelant reçoit un succès fabriqué, et le bandeau `BandeauFileAttente` dit « N éléments enregistrés sur cet appareil, envoyés au retour du réseau » ; les toasts « envoyé » le disent aussi (`gardeRecemment`). Renvoi dans l'ORDRE (événement `online`, retour sur l'onglet, minuterie croissante, bouton « Envoyer »). L'identifiant d'un ajout dans `messages` / `chantiers` est fixé AVANT la première tentative : une réponse perdue ne crée pas de doublon (409 = déjà fait). Un REFUS du serveur (4xx) n'est jamais jeté : visible, Copier / Réessayer / Abandonner (confirmation). Lecture : dernière réponse de chaque table et RPC de lecture gardée, servie sans réseau (« Données de HH:MM »). Jamais gardées : connexion, RPC de lecture, `regler_reveil_immediat` (jeton) et `push_abonnements`. Le navigateur est prié de rendre le stockage persistant.
- **Sessions** (`scripts/sql.sh`) : base injoignable (curl 6/7/35 : la requête n'est pas partie) → une écriture (`insert/update/delete` ou `select fonction(…)` sans `from`) est gardée dans `~/.cockpit/file-attente/` et rejouée dans l'ordre au premier appel qui passe (`sql.sh --rejouer`) ; un SQL refusé va dans `refuses/`. Un script qui attend une valeur en retour (un identifiant) ne l'a pas : le relancer en ligne.
- **Limites dites** : vider les données du site AVANT le retour du réseau efface ce qui n'est pas parti (le bandeau l'écrit, et on demande le stockage persistant) ; un conteneur de session recyclé perd sa file locale ; un texte tapé mais pas envoyé n'est pas gardé (pas de brouillon persistant) ; plus de crédit Claude ne perd rien : tout est en base, la chef le reprend au retour du crédit. `verifier-file-attente.ts` (règle), `app/scripts/verifier-hors-ligne.mjs` (parcours réel), `scripts/verifier-file-sessions.mjs`.

## Navigation type application : barre d'onglets en bas (5 oct. 2026, chantier 313b3d95)

Raphaël : « une vraie navigation type téléphone, là c'est trop en mode navigateur, les zoom à gérer ». Barre FIXE en bas (`BarreOnglets.tsx` : Accueil, Projet, Recherche, Coûts, Réglages ; sur « Tout », Projet/Coûts ouvrent le dernier projet vu, Réglages ouvre les réglages de l'appli). Où elle apparaît : UNE règle, `lib/navMobile.ts` (vue Mobile = toujours, Auto = écran tactile, Ordinateur = jamais ; `hooks/useNavMobile.ts` pose `--nav-h` que lisent la bulle, la barre de sélection et les toasts). Elle remplace les trois icônes de la page et la loupe d'en-tête (pas de doublon). Vue Mobile : viewport sans zoom (`VIEWPORT_APPLI`) ; écran tactile : `touch-action: manipulation`, champs à 16 px, pas de débordement horizontal (`index.css`). `verifier-nav-mobile.ts`, contrôles « barre du bas » de `verifier-web.mjs`. Constaté le 5 oct. : sur main comme ici, `verifier-web` a des échecs d'environnement (présence « vivante » sans WebSocket, comptes faussés par les projets de test des autres agents, rechargement qui expire par moments).
**Compléments (5 oct., chantier c6e4ea77, réponse « tous les écrans tactiles »)** : le chantier a été traité avec 313b3d95 (même travail, la barre existait déjà). Ajouts : vue Auto sur écran tactile = viewport sans zoom (`viewportDe(v, tactile)`, comme Mobile) ; la barre se cache quand le clavier est ouvert (`useClavierOuvert`, visualViewport, `--nav-h` repasse à 0) ; le retour du téléphone revient à l'onglet précédent (une entrée d'historique `{onglet}` par changement, puis quitte). Tests : `verifier-vue.ts`. Non vérifié : capture/parcours sur vrai téléphone (clavier et geste retour).

## Appli installable (30 sept. 2026)

Raphaël : « installer l'appli depuis la page internet du cockpit, plutôt qu'un
raccourci Chrome » (Chrome disait « Impossible d'installer cette appli » : pas
de manifeste). `app/public/manifest.webmanifest` (standalone, portée
`/Cockpit-General/`), icônes PNG générées par `app/scripts/generer-icones.mjs`,
`app/public/sw.js` : réseau d'abord, jamais une vieille version servie, seules
les navigations passent par lui. Bouton « Installer l'appli » (menu ⋯ et
Réglages) : l'invite de Chrome (`beforeinstallprompt`, captée avant React dans
`hooks/useInstallation.ts`), sinon la marche à suivre (iPhone : Partager › Sur
l'écran d'accueil). Règle : `lib/installation.ts`. `verifier-installation.ts`,
contrôles « appli installable » de `verifier-web.mjs`.

**Nouvelle version en ligne** (30 sept. 2026, chantier 3cea6ae9, Raphaël :
« que les correctifs prennent sans recharger »). Les données arrivent en direct,
mais le CODE reste celui du chargement. `vite.config.ts` grave le commit
(`GITHUB_SHA`) dans l'app ET dans `version.json` (une source) ; l'app le relit
au retour sur l'app et toutes les 5 min (`lib/version.ts`,
`hooks/useNouvelleVersion.ts`) et affiche « Nouvelle version du cockpit ·
Mettre à jour » (`NouvelleVersion.tsx`, un toucher recharge). Même jour : la
liste « fini » est triée par heure de certification et chaque ligne dit
« Certifié par toi à HH:MM · livré … » (`quandFini`, `ordreListe`) ; « À toi »
montre l'heure à côté de l'âge. `verifier-fini.ts`.

## Bulle flottante d'aide : visible par défaut (30 sept. 2026, chantier 851282af)

Raphaël : « Actuellement il n'y a aucune bulle dans le cockpit. » Trois causes
prouvées : (1) préférence `bulle_flottante_aide_<projet>` lue par `Boolean(...)`
= ÉTEINTE par défaut ; (2) rendue seulement `{d.projet ? … }`, donc jamais dans
« Tout », et hors du contexte projet (`useCockpit hors du CockpitCtx` : l'écran
d'un projet plantait dès qu'elle s'affichait) ; (3) l'app ne lisait que 1000
messages sur 1129 (max-rows du serveur, `.limit(5000)` ignoré, tri ancien →
récent : les 129 DERNIERS, réponses de Claude comprises, restaient invisibles ;
`useDonnees` lit maintenant par pages de 1000). Règles (`lib/bulleAide.ts`,
`verifier-bulle-aide.ts`) : allumée sauf préférence explicitement `false`
(case « Bulle d'aide sur ce projet » dans Réglages du projet) ; vue projet =
son fil, vue « Tout » = le projet `cockpit`, sinon le dernier fil utilisé
(jamais un `test-…`). Un message tapé = message libre du fil du projet
(`ecrireAvecMedias`, comme « Écrire à Claude sur ce projet ») ; la réponse de
session (`progression.sh --point`) s'y affiche, la bulle ouverte relit toutes
les 10 s tant qu'une réponse est attendue. Le bouton « Chantier » d'origine
est retiré (`ouvrir_depuis_fil` est réservée aux sessions : il ne pouvait pas
marcher) : Claude crée lui-même le chantier depuis le message.
`app/scripts/verifier-bulle.mjs` prouve le trajet complet (projet jetable).
**Complété le 5 oct. 2026 (chantier 607d08b1 + doublon 95042f6b « clarifier son rôle »)** : la bulle dit à quoi elle sert (encart « À quoi sert cette bulle » + état vide avec deux suggestions) ; chaque message porte nom ET heure (`auteurDe`, `heureLisible`) et son sujet en gras (`sujetDe`, UNE règle partagée avec la conversation) ; « Répondre » sous un message de Claude cite la phrase sélectionnée, sinon son début (`aCiter`, `avecCitation` : ligne « > » en tête du message, redessinée en encart) ; pièces jointes par `useMediasAJoindre` / `ecrireAvecMedias` (📎 + crayon, même brique que les fils) ; dictée par la reconnaissance vocale du NAVIGATEUR (`constructeurVoix`, fr-FR, Chrome Android/ordinateur, Safari ; micro refusé = message qui dit où l'autoriser ; navigateur sans voix = micro grisé + phrase). Limite : la vraie reconnaissance n'est pas testable dans le conteneur (le banc simule `webkitSpeechRecognition`) ; Chrome l'envoie à un serveur de Google, donc il faut internet.

## Tout ce qui s'ouvre par-dessus se quitte pareil (29 sept. 2026)

Raphaël : « quitter en appuyant sur les zones extérieures de la carte ».
Règle unique, `app/src/ui/Modale.ts` : toucher le fond ferme (la conversation
laisse une bande visible en haut sur téléphone ; une zone libre du fil ferme
aussi), Échap et le retour du téléphone ferment, un menu se ferme en touchant
ailleurs ou avec Échap (sans fermer ce qui est dessous). Un texte, un fichier
ou un dessin non envoyé : « Quitter sans envoyer ? » d'abord (`Dialog
brouillon`, `aUnBrouillon`). Toute nouvelle fenêtre passe par `Dialog` ou ces
fonctions. `verifier-web.mjs` : « quitter une carte ».

## Sessions, agents, doublons : ce que Claude décide seul (29 sept. 2026)

- **Session** = une conversation Claude Code ; **tâche** = un agent ou une
  commande qu'elle lance en arrière-plan. Tables `sessions` / `taches`
  (migrations 0008, 0009), alimentées par `hooks/suivi.sh`, déclaré par
  `brancher.sh` sur UserPromptSubmit, Stop, SubagentStart, SubagentStop,
  PostToolUse et SessionEnd. La liste des tâches vient de Claude Code lui-même
  (`background_tasks` du hook Stop, lu dans le code de la version 2.1.284). Le
  hook ne ralentit jamais une session : il répond en ~20 ms, envoie en
  arrière-plan et ne signale un simple signe de vie qu'une fois par minute.
- L'étape, le % et le temps restant d'un agent ne se devinent pas : l'agent
  les signale (`progression.sh --agent "<sa description>"`). S'il le fait
  avant que le hook l'ait vu, sa ligne provisoire `prov:<description>` est
  adoptée ensuite, jamais dédoublée (`adopter_provisoire`).
- Raphaël ne trie pas : doublons (« ambigu » → la session tranche avec les
  extraits), sections (`--section` / `--ranger`, créée si besoin) et fusions
  **suggérées** (`--suggerer-fusion`, message `kind = 'fusion'`, qu'il accepte
  ou refuse d'un toucher via `trancher_fusion`). `verifier-base.mjs` §14.
- `brancher.sh` REMPLACE désormais le bloc Cockpit du CLAUDE.md d'un projet
  quand `docs/bloc-CLAUDE.md` change (repère de fin `<!-- fin du bloc cockpit`),
  sans toucher au reste du fichier. Mais les hooks déclarés dans
  `.claude/settings.json` d'un projet ne se propagent PAS seuls : un nouvel
  événement de hook exige de relancer `brancher.sh` sur chaque projet branché.

## Section « Correctifs » rangée toute seule (29 sept. 2026, migration 0021)

Raphaël : « une section corrective pour les correctifs visuels, de mise en
page, d'ergonomie, et que ça trie intelligemment ». Un trigger (`before
insert` sur `chantiers`) range dans « Correctifs » (créée si besoin) tout
chantier créé SANS section dont `cockpit.est_correctif(titre, demande,
origine)` est vrai — toutes voies : app, session, module embarqué, reprise.
Règle lisible, pas un devin : un mot visuel/ergonomie (`mots_correctif_visuel`)
et aucun mot de gros chantier (`mots_gros_chantier` : refonte, fonctionnalité,
moteur, migration…) dans le TITRE ; pour un utilisateur final (`origine =
'utilisateur'`), titre + demande. Jamais sur une mise à jour : `--ranger`
corrige un faux tri et n'est pas défait. Les existants ouverts sans section :
`ranger_correctifs(slug)`. Un faux tri constaté → un cas dans
`scripts/verifier-correctifs.mjs` d'abord, puis les listes. `verifier-base` §22.

## « Claude a répondu » : pastille + notification du téléphone (30 sept. 2026, migration 0039, chantier bff5a8cf)

Raphaël : « quand j'envoie un message […] je ne vois aucune notification comme
quoi il m'a répondu […] il faudrait une notification pour pouvoir répondre le
plus rapidement possible » (capture : la case « Écrire à Claude sur ce projet »)
« […] et une notification push du téléphone, à régler dans les paramètres ».
- **Dans l'app** : une RÉPONSE = message de session avec `repond_a` (posé par
  `repondre_dans_fil`, donc pas les lignes automatiques). Non lue tant qu'elle
  est plus récente que le « lu jusqu'à » du fil (préférences `lu_fils`, par
  personne ; `lu_depuis` posé au premier chargement pour ne pas allumer
  l'historique). Pastille rouge « Réponse » sur la case du projet et sur les
  lignes « À toi » / « Ça avance » (`PastilleReponse.tsx`), compteur dans le
  titre de l'onglet et sur l'icône de l'appli ; ouvrir le fil = le lire.
  Règle unique : `lib/lecture.ts`, `verifier-lecture.ts`, `verifier-web.mjs`
  (« pastille Réponse »).
- **Push** : Réglages › « Notifications de réponses » › « Activer sur cet
  appareil » (par appareil ; `usePush.ts`, règle des états `lib/push.ts`,
  iPhone : seulement dans l'appli installée). Un trigger sur la réponse
  (`push_sur_reponse`, pg_net, jamais pour un projet `test-…`) appelle la
  fonction `cockpit-push` (web-push ; `x-push-secret` du coffre) qui envoie
  aux appareils des admins et membres du projet et retire les abonnements
  morts. `sw.js` affiche la bannière (sauf appli déjà à l'écran). Mise en
  place UNE fois : `node scripts/installer-push.mjs` (clés VAPID, secrets de
  la fonction, coffre, `push_config` ; idempotent, `--regenerer` désabonne
  tout) puis `VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-push`.
  Preuve : `node scripts/verifier-push.mjs`. **Non prouvé ici** : la
  livraison sur un vrai téléphone (aucun navigateur abonné dans le conteneur).

**Choisir quelles notifications on reçoit** (5 oct. 2026, migration 0052, chantier 70288582 ;
Raphaël : « gérer quel type de notifications […] pareil pour tous les projets, le plus simple
possible »). Réglages › Notifications : un interrupteur par TYPE, puis « Tous les projets » +
un interrupteur par projet, résumé en une phrase, toast succès/échec. Par personne :
`notif_reglages` (`types` code → bool, absent = défaut du catalogue ; `projets_coupes`, vide =
tous). Catalogue `notif_types` (code, libellé, `defaut`, `emis`) : UNE source pour l'écran et le
serveur ; **seul `reponse` est émis** (défaut allumé) ; « À toi », « PR à fusionner » et « Chantier
terminé » sont listés « bientôt », sans interrupteur, tant qu'aucun trigger ne les envoie. UNE
règle de décision côté serveur : `notif_veut(user, type, projet)` et `notif_destinataires(type,
projet)` (admins + membres qui veulent ; jamais un projet `test-…`, jamais un type non émis),
lue par `cockpit-push` (déployée v2). **Ajouter un type** = une ligne dans `notif_types` (`emis`
faux), puis le trigger qui l'envoie et `emis` vrai ; l'écran suit tout seul. Règles d'affichage :
`lib/notifications.ts`, `verifier-notifications.ts` ; base : `verifier-base` §41 (`SEUL=41` joue
ce seul contrôle). Le réglage vaut pour tous les appareils de la personne ; l'abonnement reste par
appareil (message clair si l'appareil n'est pas abonné).

## Économie des modèles (30 sept. 2026, migration 0035, chantier 7a52df8f)

Raphaël : « le cockpit consomme beaucoup trop de tokens […] les sessions vont
planter trop vite […] pouvoir choisir le modèle (Sonnet ou Opus) et l'effort » ;
« ne jamais atteindre la limite des modèles ». Par projet (table `chefs`,
réglé dans l'app : Renforts › Réglages › « Modèles et effort des agents », ou
`chef.sh --modeles <code> <léger> <effort> [agents]`) : `modele_code` (agents qui
codent, sessions relais/renfort ; **sonnet** par défaut), `modele_leger` (Répondre,
Point, Vérifier, Revoir « À toi » ; **haiku**), `effort` (bas/moyen/eleve : une
CONSIGNE écrite dans la consigne des agents, pas un réglage forcé de Claude Code),
agents en parallèle **2 par défaut** (avant 3). `chef.sh` et `renfort.sh` écrivent
`[model: X]` sur la ligne de chaque agent et `model:` dans chaque `create_session` ;
la chef passe ce paramètre à l'outil Agent. **Frein** (`frein_actif`, une seule
règle) : actif si `chef.sh --frein <h> "raison"` / le bouton « Freiner 3 h », ou si une
session du projet est en pause `rate_limit` depuis moins de 3 h → 1 agent, aucune
revue « À toi », aucun nouveau renfort (le travail reste en file). **Revue « À toi »
une fois par jour** et par projet (`projets.revue_a_toi_delai_h`, 24, réglable).
Limite connue : le signal `rate_limit_info allowed_warning` de Claude Code n'est pas
exposé aux hooks (non vérifié) ; le frein automatique repose sur la pause
`rate_limit` déjà remontée par `StopFailure`. `passe.sh` (projet sans chef) ne lit pas
encore le frein. `verifier-base` §32, `verifier-renforts.ts`.

## Limites d'usage et mode autonome (29 sept. 2026, migration 0010)

- Reprise de la tâche en cours après une limite : native, réglage
  `autoContinueAtUsageLimit: true` (description de Claude Code 2.1.284 : « wait
  for the limit to reset and continue the task automatically »), posé dans le
  `.claude/settings.json` de chaque projet par `brancher.sh`. Limites connues
  (lues dans son code) : annulée si Claude Code redémarre pendant l'attente
  (conteneur recyclé), ou si la réinitialisation est à plus de 24 h.
- La pause se voit : hook `StopFailure` → `sessions.pause_raison`
  (`rate_limit`, `billing_error`, `overloaded`…), levée au prochain signe de vie.
- Enchaînement : `hooks/autonome.sh` (Stop, synchrone) → `prochain_chantier_autonome`
  donne le chantier `libre` suivant (jamais `a_cadrer`), le réserve, et la
  session continue (`decision: block`). Allumé par projet avec
  `regler_autonome(slug, jusqu_a, max)` (admin ; ≤ 24 h ; plafond par session),
  éteint par défaut. `verifier-base.mjs` §15.
- **Permanent** (migration 0011, Raphaël : « le mode autonome tout le temps,
  pas que quand je dors ») : `projets.autonome_toujours`. Pris : `libre`,
  `a_trier` (la session trie), `en_cours` abandonné (fiche immobile depuis 1 h,
  aucun signe de vie 30 min, et aucune session VIVANTE du projet ne l'a tenu
  en dernier) — `chantiers_prenables`, réservée aux sessions. Quand aucune
  session ne vit, un réveil (Routine Claude horaire) lance `scripts/passe.sh`
  dans la session autonome du projet : un chantier, ou « RIEN » en une ligne.
- **Interrupteur, sans crédit perdu** (30 sept. 2026, migration 0031, chantier
  79ec70d6) : dans la vue projet, hors du repli, un interrupteur (un toucher
  allume « tout le temps » ou éteint ; « Régler… » : heure, plafond,
  extinction automatique) ; une lune sur l'onglet de chaque projet allumé
  (ambre = allumé sans rien à prendre). `constater_autonome(slug)` (service),
  appelé à chaque passage par `passe.sh`, `chef.sh` et `hooks/autonome.sh` :
  du travail (prenable, réservé en cours, agent vivant) → compteur à zéro ;
  rien depuis `projets.autonome_arret_vide_h` h (0 = jamais, 3 par défaut) →
  éteint (`autonome_eteint_auto_at`) + message dans le fil du projet. Même
  règle côté écran : `etatAutonome`, `travailEnCours` (`lib/autonome.ts`).
  Limite : éteint, un réveil horaire (routine) tourne encore et répond RIEN ;
  seule la désactivation de la routine l'arrête (non automatisée).

## Coûts du projet : prestataires, dépenses, factures, compta (5 oct. 2026, migration 0052, chantier 41127de1)

Raphaël : un onglet à part par projet avec ses services (Supabase, Claude, RunPod…), leurs factures, les coûts
(jour / semaine / mois / année), le solde des comptes à crédit, et l'envoi des factures à la compta en un clic.
Onglet « Coûts » de la vue projet (`components/Depenses.tsx`, règles pures `lib/depenses.ts`, une seule source).
Tables `services` et `depenses` (ADMIN seulement : donnée interne, aucune politique membre), colonnes
`projets.compta_canal` / `compta_destinataire`. Factures dans `cockpit-medias`, dossier `<projet>/depenses/`
(illisible aux membres : `peut_lire_media` ne connaît que « projet » et les chantiers visibles).
- Totaux PAR devise, jamais convertis ; une recharge de crédit n'est pas un coût.
- Solde = saisi par Raphaël (date affichée), alerte sous `seuil_alerte`. **Non fait : lecture automatique des
  comptes (API RunPod, Supabase, Anthropic…)** : exige une clé par service (action de Raphaël) et une fonction serveur.
- Envoi à la compta : JAMAIS côté serveur. « Envoyer » = partage du téléphone (`navigator.share` avec les fichiers
  et le résumé), l'état « Envoyée à la compta » (qui, quand, canal) n'est posé qu'après ce partage ; annulé = rien
  marqué. Sans partage de fichiers (ordinateur) : marche manuelle (télécharger, copier le résumé, lien e-mail/WhatsApp
  pré-rempli) puis « C'est envoyé : marquer ». `verifier-depenses.ts` (règles), `verifier-depenses.mjs` (parcours).

## Invités : lien, rôles par projet, qui a fait quoi (5 oct. 2026, migration 0058, chantier 6e3cbee5)

Raphaël : inviter des gens, leur donner des droits, les gérer, et distinguer leurs actions de celles de tout autre. Écran : « Projets & membres » › projet › « Invités » (`Invites.tsx`). **Invitation = un LIEN à copier** (aucun e-mail envoyé en son nom) : `inviter(projet, rôle, nom, jours)` (admin) rend le jeton UNE fois, la base ne garde que son sha256 (`invitations.jeton_hash`) ; un seul usage, expire (1/7/30 j), retirable. Le lien est `…/Cockpit-General/#invitation=<jeton>` (fragment : jamais dans un journal serveur) ; `lib/invitation.ts` le garde sur l'appareil, `Invitation.tsx` affiche « Tu es invité sur X » (`invitation_info`, seule fonction ouverte à anon) puis `accepter_invitation` après connexion. **Rôles** (`membres.role`) : `lecteur` (voit), `suggere` (+ écrit demandes et messages ; Raphaël valide), `utilisateur` = « Valide » (+ certifie, corrige, répond aux décisions ; ancien comportement des membres existants). UNE règle chacune : `peut_suggerer(projet)` (RLS d'écriture), `peut_agir(chantier)` (rôle `utilisateur`). **Qui a fait quoi** : trigger `poser_auteur` — tout ce qu'écrit un non-admin connecté porte son e-mail réel et `auteur_user` (messages, chantiers), quoi que le navigateur envoie ; `journal_invites`, `membres_detail` (actions, dernière action). **Fuite fermée** : un membre lisait `projets` en direct, donc `cle_embed` et `compta_*` ; il passe par `projets_visibles()` (liste blanche pour lui), la politique `membre_projets` est supprimée. Ne pas relire `projets` en direct côté app. `verifier-base` §43. **Droits au cas par cas (5 oct., migration 0059, réponse de Raphaël « Droits au cas par cas »)** : le rôle n'est plus qu'un MODÈLE DE DÉPART ; trois droits se règlent personne par personne (`membres.droits` jsonb, `invitations.droits` pour un lien sur mesure) : `demandes` (créer), `messages` (écrire dans les fils), `valider` (certifier/corriger/répondre). UNE règle : `cockpit.droit_dans(projet, droit)` = réglage personnel sinon `droit_du_role` ; lue par les politiques d'écriture, `peut_suggerer`, `peut_agir`, `moi()` (qui rend aussi `droits` effectifs). Changer le rôle remet les droits au modèle. Écran Invités : cases par personne + « Régler les droits au cas par cas » à l'invitation ; miroir côté app `lib/invitation.ts` (le serveur reste seul juge). `verifier-base` §43. Non fait : invitation d'un admin, droit de « voir » plus fin (par chantier).

## Connexion lente : la base cale par moments, l'app ne doit jamais tourner sans fin (5 oct. 2026, migration 0063)

Raphaël : « je n'arrive plus à me connecter, ça charge sans fin, puis ça crash ». Mesuré : la connexion (`/auth/v1/token`) a rendu 504 après 36 s, `select 1` oscille de 0,5 à 30 s, des jobs pg_cron échouent en « job startup timeout », des suppressions de projets de test dépassent le délai de la base. Instance partagée (cockpit + Jarvis + Trieur) par moments saturée : cause de fond NON prouvée à 100 %, c'est un faisceau (bancs lancés par plusieurs agents en même temps, cascades de suppression). Corrigé : (1) neuf clés étrangères sans index (messages.chantier_lie, taches.chantier_id, passes_autonomes, ce_qui_marche, visites, ouvertures, chantiers.doublon_de) : une suppression de projet parcourait ces tables en entier ; `verifier-base` §47 rougit si une nouvelle clé vers projets/chantiers n'a pas d'index ; (2) `useAuth` : délai de 20 s sur la connexion et la lecture du profil (message « Le serveur met trop de temps… » + « Réessayer » au lieu d'un cercle sans fin), écran de connexion montré après 15 s si l'ouverture n'aboutit pas, 502/503/504 traduits. **Non fait / à décider (argent)** : monter la taille de l'instance Supabase si les calages continuent ; ne pas lancer plusieurs bancs lourds en même temps.
