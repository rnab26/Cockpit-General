# CLAUDE.md — Cockpit (rnab26/Cockpit-General)

Complète le CLAUDE.md global de Raphaël (`rnab26/dotfiles/.claude/CLAUDE.md`),
ne le remplace pas. Français, concis, autonomie une fois la tâche confirmée.

**Tu reprends le travail ? Lis d'abord `docs/REPRISE.md`** (état, ce qui n'est
pas encore en ligne, la suite, les pièges), puis les décisions de Raphaël.

**Aucun bloc « Cockpit » dans ton contexte au démarrage ?** Session ouverte sur plusieurs dépôts : elle démarre
dans `/home/user`, aucun hook ne tourne (cause du « projet débranché » du 13 oct.). Lance d'abord
`bash /home/user/Cockpit-General/scripts/connecter.sh` : état du projet, et ta session devient visible dans l'app.

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

**Le moteur est un projet comme les autres** (13 oct. 2026, Raphaël : « le projet Cockpit-General […]
est lui-même un projet en soi, c'est lui le moteur qui va reproduire tout ce qu'on fait pour les
projets branchés »). Il n'a pas le bloc de gestes que `brancher.sh` écrit chez eux (ses hooks sont ceux
du dépôt) : les voici, pour tes sessions ici aussi (source unique : `docs/bloc-CLAUDE.md`,
« LES CHANTIERS SE FERMENT D'APRÈS GITHUB »). (1) Chaque envoi : `scripts/progression.sh --jalon
pousse --detail <commit>`. (2) Avant de t'arrêter : `--termine`, ou `scripts/chantier.sh --de-cote
<id>` / `--abandonner <id>`, sur chaque chantier tenu. (3) Au rappel « SANS TRACE », réponds pour
chacun. (4) Un verdict de Raphaël dit en session va dans le fil (`--point`) ; tu ne certifies jamais.
Le rapprochement GitHub du moteur passe par les mêmes hooks ; une session ouverte sur plusieurs
dépôts n'en a pas : `scripts/connecter.sh` les remplace (premier passage du moteur : 13 oct. 2026).

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

Un banc par sujet : le catalogue complet (commande + ce que chacun prouve) est dans **`docs/verifications.md`**, à lire au moment de toucher au sujet.

```bash
cd app && npm ci && npx tsc -b && npm run build   # l'app se tient
bash -n scripts/*.sh hooks/*.sh                        # syntaxe des scripts
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
« [TEST… » dans un projet réel. Nouveau banc : mêmes règles. **13 oct. 2026** : `verifier-base` laissait deux projets `test-verif-…-ke` et `-af` à chaque passe complète (créés par les sections 38 et 47, absents de la liste de purge et du contrôle « tout est supprimé », ramassés seulement par la passe suivante) : corrigé ; une section qui crée un projet l'ajoute à la liste de purge ET au compte de « tout est supprimé ».

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

## Correctifs GÉNÉRAUX, jamais par projet (Raphaël, 29 sept. 2026)

« Ce sont des correctifs généraux, peu importe le repo ou le projet que je
brancherai ; le modèle de cockpit doit être réutilisable et branchable sans
correctif par projet. » Tout se corrige ICI (app, base, scripts, hooks,
modèles), jamais dans un projet branché ; un projet ne reçoit que ce que
propagent le lanceur et `brancher.sh`. Et toute session qui travaille ici se
voit dans le cockpit (chantier + `progression.sh` à chaque étape).

## Réponses courtes (Raphaël, 29 sept. 2026)

« Je veux des réponses simples, courtes, nettes et précises. » Dans la
conversation comme dans le cockpit : la réponse d'abord, en quelques lignes,
puis ce qu'il doit faire. Pas de pavé, pas de détail technique non demandé.
**Forme mesurable (19 oct. 2026, « c'est toujours trop long, je zappe des trucs »)** : une phrase de réponse, 5 puces au plus (mot clé en gras), ni tableau ni récit, fin « À faire de ton côté : … » ou « Rien à faire », 10 lignes au plus ; ne jamais couper ce qui n'est pas vérifié, un risque ou un coût, ni un geste qu'il doit faire (avec le lien exact). Rappelée à CHAQUE message par `hooks/prompt-rappel.sh` et au démarrage par `hooks/session-start.sh` (même phrase aux deux endroits : modifie les deux ensemble) ; le même texte est dans les règles globales (`rnab26/dotfiles`, section « Communication »).

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
**Vocabulaire (6 oct. 2026, chantier ca171345)** : Raphaël, « du jargon, du charabia, toujours les mêmes phrases ». UNE liste de mots de développeur (endpoint, hook, migration, commit, branche, script, déployer…) dans `scripts/clarte.py`, appelée par `demander.sh` (question, pourquoi, options, étapes), `progression.sh` (`--verifier`, résumé de `--termine`, `--point`) et `verdict.sh` : refus avant d'écrire, avec le mot de remplacement. Le nom d'un bouton entre « » n'est pas contrôlé. Les cartes de PR (`pr-a-fusionner.sh`) sont réécrites en mots simples (clés « Fusionne la PR #n » inchangées). Limite : une liste ne juge pas la clarté d'une phrase, seulement le vocabulaire ; les phrases déjà en base ne sont pas réécrites. `verifier-clarte.mjs`.


## Règles permanentes, et où lire l'historique (15 oct. 2026, chantier 1af98322)

Ce fichier est chargé par CHAQUE agent et chaque réveil : il ne garde que les règles. Les dates, causes prouvées, numéros de migration et limites de chaque chantier sont dans `docs/historique/` (déplacés tels quels, rien supprimé) : **lis le fichier du sujet avant de toucher à ce sujet**, pas avant.
**Ajouter ici** : une règle en une ou deux lignes. **Ajouter dans `docs/historique/`** : le récit du chantier (date, cause mesurée, migration, limites, nom du banc). Ne remets pas de récit dans ce fichier.

- `docs/historique/chefs-agents-renforts.md` : chef par projet, renforts, agents, filet de sécurité, réveils, libération, modèles et usage, mode autonome, sessions qui se ferment, hooks en direct.
- `docs/historique/messages-fils-discussions.md` : un message n'est pas un chantier, fils, « où ça en est », réponses en direct, cartes, médias, bulle d'aide, notifications.
- `docs/historique/chantiers-github-pr.md` : vérifier un chantier, PR à fusionner, fusion de doublons, regroupement, rapprochement avec GitHub, déplacer un chantier, déploiements par lots.
- `docs/historique/app-ecran-donnees.md` : accueil, vitesse, navigation, appli installable, hors ligne, connexion lente, emplacement du cockpit, MCP, invités, branchement des dépôts d'autrui.
- `docs/historique/couts-recus.md` : Coûts, factures, reçus Anthropic (programme Google), fournisseurs.

**Règles à retenir (résumé ; détail et preuves dans les fichiers ci-dessus)**
- **Statuer = l'écran bouge tout de suite** (19 oct. 2026, chantier fa297cc4) : un geste sur un chantier ou une carte (« Ça marche », « Ça ne marche pas », « Fait », « Ça bloque », mettre de côté, relancer) pose la ligne à l'écran AVANT la réponse de la base (`lib/statuts.ts`, `lib/reponseCarte.ts`, `useDonnees.poserChantier / poserMessage`), la protège d'une lecture partie avant l'écriture, et revient en arrière avec un message si l'écriture échoue. Un nouveau bouton qui écrit sur un chantier ou une carte passe par là, jamais « écrire, puis recharger tout ». « Ça bloque » (ou « Pas encore » + un mot) passe la balle à Claude : la carte quitte « pour toi » et le chantier avance dans « ça avance » jusqu'à ce que Claude écrive dans le fil (`reponseCarte.retourPrisEnCharge`). Détail : `docs/historique/app-ecran-donnees.md`, « Statuer ».
- **Un message n'est pas un chantier** : un chantier est un sujet de travail qui dure ; un message est une ligne dans un fil. Rien n'ouvre de chantier depuis une phrase. Une session fait UNE chose à la fois ; l'action en direct va sur la session, jamais dans une table lisible par les membres.
- **Hooks** : ils doivent marcher avec le minimum d'événements (UserPromptSubmit, PostToolUse, Stop). Un projet branché ne reçoit que ce que propagent le lanceur et `brancher.sh` : on corrige ici, jamais dans un projet.
- **Chaque fil est une discussion** : un message de Raphaël dans un fil = une réponse courte de Claude dans ce fil (`progression.sh --point`). Les cartes (questions, actions, vérifications) restent en dernier.
- **Les cartes dépassées se retirent seules** (job `cockpit-epuration`, toutes les 3 min, règle `carte_depassee`, délai par projet dans Réglages › « Cartes déjà traitées ») : n'en retire jamais une à la main pour « ranger » ; `demander.sh --confirmer <id>` garde une carte qui compte encore ; une carte retirée n'est JAMAIS un accord (`answered_by` vide, jamais remise à une session comme une réponse). Chaque ligne qui attend Raphaël dit son âge et son heure (`ageEtHeure`).
- **Seul Raphaël certifie** (« valide »). Un verdict dit en session passe par `chantier.sh --verdict-dit`. « À vérifier » exige un lien exact (`--verifier`, ou `--sans-lien "pourquoi"`).
- **Clarté** : question ≤ 140 car., 2 à 4 options, pas de jargon (`scripts/clarte.py`). Un geste manuel = lien exact + étapes numérotées + texte prêt à coller (`demander.sh --action`).
- **Une règle, une source** : « vivant » lit `delai_signe` ; « prenable » = `chantiers_prenables` ; « attend Raphaël » = `attend_raphael` ; ressemblance = `ressemblance_fusion`. Une migration qui redéfinit une fonction part de `pg_get_functiondef` en vigueur, jamais d'une ancienne migration. Numéro de migration : `scripts/prochaine-migration.sh` au moment d'écrire.
- **Données** : toute RPC de lecture entre dans `RPC_LECTURE`, toute RPC d'écriture dans `RPC_ECRITURE` (`lib/fileAttente.ts`, contrôlé par `verifier-file-attente.ts`) ; toute table lue par `useDonnees` a une entrée dans `CHAMPS_DATES` et `ORDRES`. Un événement du direct s'applique, il ne relit pas la table.
- **Écran** : barre du bas sur téléphone, tout ce qui s'ouvre par-dessus passe par `Dialog` (`ui/Modale.ts`), jamais retirer un élément de la vue par défaut sans demande de Raphaël, jamais `ignoreHTTPSErrors`.
- **Usage et coûts** : agents `sonnet` pour coder, `haiku` pour revoir/répondre/vérifier, jamais `opus` sans mention ; pas de réveil récurrent à session persistante (la relecture coûte des centaines de milliers de jetons) ; une PR = une vague, une fonction Supabase déployée une fois en fin de lot.
- **Écritures en masse sur un vrai projet** (ménage, rattrapage, import) : l'accord PRÉCIS de Raphaël avec commande et cible nommées ; la plateforme refuse sinon, ne jamais contourner.
- **Projet en pause** (16 oct. 2026, migration 0093, chantier 975118ca) : Réglages du projet › « Branché / En pause ». UNE règle, `projets.en_pause` (`cockpit.projet_en_pause`), lue par `chantiers_prenables`, `verifs_prenables`, `filet_attente`, `reveiller_chef`, `renforts_auto`, `demander_renforts`, `chef.sh`, `passe.sh` et le hook de démarrage : en pause = ni chef, ni agent, ni renfort, ni réveil, ni prise de chantier ; rien n'est supprimé, un travail déjà tenu finit, une session où Raphaël écrit lui répond. Ne crée pas un second mécanisme : une nouvelle porte d'entrée du travail automatique lit cette règle. Liste « n branchés · n en pause » dans Tout › Réglages des projets.
- **Un seul bouton « Tout lancer » sur l'écran principal** (16 oct. 2026, chantier 876e2e4b) : `ToutLancer.tsx` (décision pure : `lib/toutLancer.ts`) lance un projet, ou chaque projet où quelque chose attend (vue « Tout »), avec `etat_renforts` / `demander_renforts` : aucune règle nouvelle. Pas de liste de renforts, de mode autonome, de pause ni de réglage sur l'écran principal : tout le détail est dans Réglages du projet (« Renforts (détails) », mode autonome, pause). Ne remets pas un second bouton de lancement sur l'écran principal.
- **Voyant des sessions sous « Tout lancer »** (19 oct. 2026, migration 0102, chantier cb3d17df) : `ToutLancer.tsx` montre un voyant par projet (vert « session ouverte » / gris « aucune session » / « en pause »), lu par `etat_sessions` (règle « vivante » = `delai_signe`, jamais recopiée à l'écran). « Activer une session » = `activer_session` = `reveiller_chef(projet, null, 'activer')` : jamais « rien à servir », donc il réveille aussi quand seuls des messages attendent ; pas de doublon (session vivante ou réveil < `reveil_ecart_min`). « Tout lancer » l'appelle lui-même pour chaque projet lancé sans session. Le réveil est PARTAGÉ (un tir par écart minimum pour toute la routine) : le texte nomme les autres projets qui attendent. Une session réveillée coûte ~290 000 jetons : ne l'automatise pas davantage sans accord.
- **« Au travail » = une PREUVE de travail réel, jamais un délai seul** (19 oct. 2026, migration 0104, chantier a33cf882 ; Raphaël : « la règle vivant par rapport à un signe de vie de 60 minutes […] c'est faux. Il faut que ça se cale sur le fait que la session soit réellement vivante »). UNE règle, `cockpit.etat_session` (miroir TS : `etatTravail`, `lib/sessions.ts`, même table de cas `app/scripts/cas-etat-travail.json` rejouée dans la base et à l'écran), trois états en mots simples : **au travail** (elle vient de s'ouvrir, OU un tour est en cours avec battement < `tour_silence_min`, OU une tâche d'arrière-plan en cours avec preuve propre < `fond_plafond_min`, OU un calcul mesuré sur la machine < `machine_fraicheur_min`), **en veille** (ouverte, rien ne tourne), **sans nouvelles** (elle devait travailler, plus aucun signe). `delai_sans_signe_min` (60) n'est plus que le REPLI : combien de temps une session muette reste affichée. Tous les seuils sont dans Réglages du projet › Renforts (détails), jamais en dur. Le voyant (`etat_sessions.etats`) et « Qui travaille » lisent cette règle ; `sessions_ouvertes` = au travail + en veille (sens de « vivantes » de 0102/0103, inchangé) ; `activer_session` ne réveille pas une session en veille. **Ne PAS toucher** `chantiers_prenables`, `sans_signe_de_vie`, réveils, filet : ils gardent `delai_signe` seul (décision de 0096, autre sujet). **Battement machine** (ALLUMÉ par défaut depuis la migration 0110, `projets.machine_actif`, réglable par projet) : `scripts/machine.py`, lancé détaché par `hooks/suivi.sh` (ou `scripts/presence.sh` pour une session sans hook), mesure le CPU des processus de la session dans `/proc` (ils portent `CLAUDE_CODE_SESSION_ID`, même après setsid/nohup) et le remonte par `signaler_machine` ; sans jetons ; s'arrête seul quand rien ne tourne. Limites : un calcul hors du conteneur (GPU distant) ne se voit pas, un conteneur récupéré efface tout, une session sans hook ni `connecter.sh` n'en lance pas. Détail et mesures : `docs/historique/chefs-agents-renforts.md`.
- **« Session ouverte » = au travail, pas seulement non finie** (19 oct. 2026, migration 0103, chantier 520ea5fb) : une session de réveil ouverte puis muette (`vu_at = demarre_at`, aucun battement depuis) comptait « vivante » 60 min et le voyant restait vert à tort. UNE fonction, `sessions_au_travail` : non finie, vue depuis moins de `delai_signe` ET un signe APRÈS l'ouverture (ou ouverte depuis moins de `reveil_ecart_min`) ; `etat_sessions` et `activer_session` la lisent toutes deux. `chantiers_prenables` / `sans_signe_de_vie` gardent `delai_signe` seul (on ne libère pas plus vite). Écran : « N assistants de Claude » dans « Ça avance » suit la même règle que la ligne (`agentsVivantsDuChantier`, silence réglé), jamais les 2 h de `tacheEnCoursVivante`. VOULU, ne pas « corriger » : un chantier « reporté » qu'une conversation vivante continue de signaler reste dans « Ça avance » (règle du 29 sept., il retombe dès que son signe a plus que le silence réglé). Détail : `docs/historique/chefs-agents-renforts.md`.
- **Routine du chef sans `create_session` / `archive_session`** (16 oct. 2026, migration 0095, chantier fb19d6a8) : la passe ne doit pas lister des gestes impossibles. La chef lance UNE fois `chef.sh --sans-outil <outil>` (colonne `chefs.sans_outils`, vaut 7 jours) : une carte claire pour Raphaël, plus aucun renfort/relais/fermeture listé (le renfort de son projet est fait par la chef elle-même). `--outil-present` annule.
- **Délai « sans signe de vie » = 60 min par défaut** (16 oct. 2026, migration 0096) : à 3 min, un agent de routine (sans hook de battement, il ne signale que par `progression.sh`) était compté mort pendant une lecture ou un calcul long, « ça avance » tombait à 0 et son chantier pouvait être libéré puis repris en cours de route. Réglable par projet (1 à 120). Ne le rebaisse pas pour « libérer vite » : un agent mort garde son chantier au plus ce délai (réservation de 3 h au maximum).
- **Les PR sûres se fusionnent seules** (19 oct. 2026, chantier f4a4e3f3, choix de Raphaël « Auto sauf PR sensibles ») : UNE règle, `scripts/fusion_auto.py` (liste blanche : écran, documentation, bancs `verifier-*` ; tout fichier hors liste ou sensible = carte ; branche `agent/` `renfort/` `claude/` `worktree-` du MÊME dépôt), lue par `.github/workflows/fusion-auto.yml` (contrôles verts + état CLEAN + commit vérifié, puis fusion ; relance la mise en ligne) et par `pr-a-fusionner.sh` (PR sûre : aucune carte ; sensible : carte avec sa raison ; repli en carte après 20 min).
- **Le workflow de fusion ne fait JAMAIS de checkout ni n'exécute du code de la PR** (il tourne avec un jeton en écriture) : il lit des noms de fichiers par l'API, la règle sur la branche par défaut. Toute modification de `.github/**`, des outils ou de ces règles est sensible : Raphaël fusionne à la main. Une PR « verte » n'a pas passé les parcours téléphone ni les bancs base : seule la liste blanche limite ce risque. Éteindre : variable de dépôt `FUSION_AUTO` = `off` (ou supprimer le fichier). Récit : `docs/historique/chantiers-github-pr.md`. Banc : `verifier-fusion-auto.mjs`.
- **Session sans hook = `connecter.sh` + présence** (20 oct. 2026 ; Raphaël : « une session FacePro tourne depuis ce matin, aucune visibilité… peu importe le dépôt ») : PROUVÉ le 20 oct. que le hook utilisateur ne se charge PAS dans les sessions cloud (aucun `settings.json` utilisateur, réglages distants vides) : ne compte pas dessus. Le seul canal qui atteint toute session est le CLAUDE.md des dépôts joints (`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`) : `docs/bloc-CLAUDE.md` donne le « PREMIER GESTE » (`connecter.sh --projet <slug>`). `connecter.sh` lance `scripts/presence.sh` (détaché, sans jetons) qui refait le signe de vie toutes les 2 min tant que le processus Claude existe : la session est « en veille » (ouverte) ; `presence.sh` relance aussi le battement machine, donc un calcul qui tourne la rend « au travail ». Sans cela (ni hook), jamais « au travail ». **Le conteneur d'une session est recyclé à l'inactivité (constaté 22 oct. sur FacePro) : les processus d'arrière-plan meurent** ; `connecter.sh` note le projet (`$TMPDIR/cockpit-presence-<session>.projet`) et tout appel à `sql.sh` (donc `progression.sh`, `demander.sh`…) relance `presence.sh` s'il est mort (verrou `flock`, jamais de doublon). Limite : dépend de l'obéissance de la session au premier geste, et d'un appel au cockpit après un recyclage.
- **Un banc n'écrit jamais dans un vrai projet** (`scripts/bancs.mjs`) ; une section qui crée un projet de test l'ajoute à la purge ET au compte de « tout est supprimé ».
