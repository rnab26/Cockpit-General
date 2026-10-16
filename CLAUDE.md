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

```bash
cd app && npm ci && npx tsc -b && npm run build            # l'app se tient
node --experimental-strip-types app/scripts/verifier-*.ts  # décisions pures
node app/scripts/verifier-web.mjs                          # parcours réel, écran de téléphone
node app/scripts/verifier-accueil.mjs                     # vue par défaut (boxes + barres), accueil simple (boxes + 3 blocs), vue détaillée, chat plié, classer sans test (projets jetables, téléphone)
node app/scripts/verifier-messages.mjs                     # un message n'est pas un chantier, sur écran de téléphone : lignes de vrais chantiers (« au travail » au lieu de « 0 % »), conversation sans chantier = une ligne sans barre, pastille, toucher = la discussion, la phrase exacte de Raphaël ne crée aucune ligne (vrais hooks, projet jetable)
node --experimental-strip-types app/scripts/verifier-messages-fils.ts   # les règles pures de cet écran (hors ligne, CI)
node app/scripts/verifier-epuration.mjs                    # cartes déjà traitées retirées SEULES, sur écran de téléphone : date + heure de chaque ligne de « Pour toi » (plus récent en haut), la passe retire deux cartes, « 2 cartes retirées seules · Voir », la raison de chacune, « Remettre » (liste et fil), délai réglable dans Réglages du projet (même avant tout retrait), plus aucun lien « la retirer » (projet jetable, vraie base)
node --experimental-strip-types app/scripts/verifier-epuration.ts      # les règles pures de cet écran : dates, ordre, cartes retirées, délais saisis (hors ligne, CI)
node scripts/verifier-connecter.mjs                        # connecter.sh : brancher à la main une session sans hooks (dossier sans dépôt, projet jetable)
node app/scripts/verifier-bulle.mjs                       # bulle d'aide : visible par défaut (projet et « Tout »), message → fil du projet, réponse de session → bulle, réglage d'extinction
node app/scripts/verifier-creation.mjs                   # « + Chantier » près d'un chantier existant : suggestion, compléter, fusionner, créer quand même (projet jetable, téléphone)
node app/scripts/verifier-depenses.mjs                    # Coûts : prestataires, dépenses par période, factures jointes, envoi à la compta, ligne « Import automatique des reçus » et date de départ (projet jetable, téléphone)
node scripts/verifier-recus.mjs                            # reçus par e-mail → Coûts : lecteur sur reçus fictifs au format réel + ses refus, parcours sur projet jetable (ajout, PDF, doublons, essai sans écriture, battement, échec), aucun reste
node scripts/verifier-fournisseurs.mjs                     # bouton « Chercher mes fournisseurs » : regroupement par fournisseur (domaines, .co.il, vendeur derrière Stripe/PayPal, webmails écartés), demande → liste, décisions gardées, hooks qui préviennent une session (projet jetable)
node app/scripts/verifier-fournisseurs.mjs                 # le même bouton sur écran de téléphone : demande, annulation, liste qui arrive seule, Suivre (sans doublon), Ignorer, « Choisir plusieurs » (Suivre / Ignorer / Remettre en groupe, Annuler, refus visible), échec visible (projet jetable)
node --experimental-strip-types scripts/verifier-recus-parite.mjs   # reçus Claude : le lecteur Python (sessions) et son port TypeScript (fonction cockpit-recus) lisent les MÊMES reçus pareil, au caractère près ; constantes, phrases, mots de l'écran sans jargon (hors ligne : tourne aussi dans la CI)
DENO=<deno> node --experimental-strip-types scripts/verifier-recus-google.mjs [--local]   # reçus Claude par le programme du compte Google : clé, porte, reçus, battement, et LE programme (Code.gs) exécuté contre un faux service Gmail qui n'accepte que les trois lectures (projet jetable ; un appel réel à Stripe avec un lien inventé ; --local lance la fonction ici avec Deno AVANT tout déploiement, sinon la fonction déployée)
node app/scripts/verifier-recus-google.mjs [--local]          # le même parcours sur écran de téléphone : carte, assistant en sept étapes, clé montrée une fois, copie du programme, confirmation, remplacer, révoquer, erreur visible (projet jetable ; BASE_URL=https://rnab26.github.io/Cockpit-General/ vise le site en ligne)
node --experimental-strip-types app/scripts/verifier-recus-regle.ts   # la règle des reçus côté serveur et ce que la fonction en fait, sur une base en mémoire (hors ligne, CI)
node --experimental-strip-types app/scripts/verifier-recus-google.ts  # règles de l'écran du programme Google (hors ligne, CI)
node scripts/verifier-embed.mjs                            # fonction serveur déployée + module dans un navigateur
node app/scripts/verifier-balise.mjs                       # « Copier le code » de Projets & membres suit l'emplacement choisi (vide, menu, page, appli ; échec de copie visible ; = emplacement.sh --balise), projet jetable, téléphone
node scripts/verifier-emplacement.mjs                      # où le cockpit apparaît : analyse du dépôt (choix possibles seulement) + module en mode bouton / page
node scripts/verifier-mcp.mjs                              # serveur MCP déployé (Codex, ChatGPT…) : poignée de main, 7 outils, clé, isolation
node scripts/verifier-base.mjs                             # schéma, RLS, droits des fonctions, temps réel, médias, réponses reprises, images de Claude, aucun reste de test, tri des correctifs, « À toi » à jour, « où ça en est », renforts (§25), fil en discussion (§26), question gardée en certifiant (§27), messages de session dans le fil (§28), un sujet = un fil / relais / réveil immédiat (§29), agents fantômes (§30), marche à suivre d’une action (§31), mode autonome qui s’éteint seul (§15), chantier né dans un fil (§33), réveil horaire (§55), classer sans test (§56), chantiers à jour d'après GitHub (§57), cartes déjà traitées retirées seules (§59)
node scripts/verifier-direct.mjs                           # EN DIRECT (0087, 0091) : un message de session n'ouvre JAMAIS un chantier (rangé dans le fil tenu ou la discussion du projet, déplacé par la réponse, réponse réclamée à l'arrêt), travail sans chantier = une relance, action en direct sur UN chantier et sur la session, ce que personne ne tient remis à la session (vrais hooks, projet jetable)
node scripts/verifier-reponses.mjs                         # ses réponses arrivent aux sessions, ses messages de session arrivent dans le fil, un sujet = un fil à l'arrêt (vrais hooks)
node scripts/verifier-renouvellement.mjs                   # session chef renouvelée au seuil de jetons : hook (jetons du transcript), règle, passe de chef.sh, réglage (projet jetable)
node scripts/verifier-correctifs.mjs                       # règle de tri « Correctifs » sur une table de cas (lecture seule)
node scripts/verifier-fusion.mjs                           # règle de ressemblance de la fusion suggérée sur une table de cas (lecture seule)
node scripts/verifier-push.mjs                            # notifications push : fonction déployée (401 sans secret, chiffrement, abonnement mort retiré), coffre, trigger, droits
node app/scripts/verifier-hors-ligne.mjs                    # survie des données côté app : écriture sans réseau gardée, survit au rechargement, repart dans l'ordre, pas de doublon si la réponse se perd, refus visible/réessayable, lecture hors ligne
node --experimental-strip-types app/scripts/verifier-delta.ts  # lecture incrémentale : événements appliqués, rafales regroupées, delta, relecture complète toutes les 5 min
node app/scripts/verifier-vitesse.mjs                       # vitesse réelle (téléphone, vraies données) : poids du chargement, 0 relecture complète par clic, repos, réponse d'une session sans recharger (projet jetable)
node scripts/verifier-file-sessions.mjs                    # survie des données côté sessions : sql.sh garde les écritures base injoignable, les rejoue dans l'ordre, un SQL refusé n'est pas jeté
node app/scripts/verifier-rapprochement-ecran.mjs          # « Chantiers et GitHub » de bout en bout sur écran de téléphone : le collecteur sur le VRAI dépôt GitHub passe un chantier « à vérifier », l'écran le dit, échec visible, éteindre / rallumer (projet jetable ; BASE_URL=https://rnab26.github.io/Cockpit-General/ pour le site en ligne)
node app/scripts/verifier-filet-ecran.mjs                  # « Réveil automatique » : la vraie raison quand aucune session chef n'est ouverte (jamais « jeton manquant »), le bouton qui ouvre une session, non-régression « sans jeton » (projet jetable, téléphone, état fabriqué)
node scripts/verifier-rapprochement.mjs                    # chantiers à jour d'après GitHub : le collecteur sur de vrais dépôts git temporaires (jalon, branche, PR, squash, titre ; jamais journal seul / non fusionné / mention), essai sans écriture, copie de travail intacte, --si-ancien, réglage éteint, pannes, hooks (projet jetable)
node scripts/verifier-greffe.mjs                           # dépôt d'autrui : refus sans --voie, voie 1 sans trace, voie 2 garde + branche propre, voie 3 inchangée
node scripts/verifier-clarte.mjs                          # vocabulaire des cartes : jargon refusé, bouton entre « » accepté (sans base)
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
- **Un banc n'écrit jamais dans un vrai projet** (`scripts/bancs.mjs`) ; une section qui crée un projet de test l'ajoute à la purge ET au compte de « tout est supprimé ».
