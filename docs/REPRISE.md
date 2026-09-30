# Reprise — où en est le cockpit, et quoi faire ensuite

**À lire en premier par toute session qui reprend le cockpit.** Mis à jour à
chaque fin de lot. L'état vivant (chantiers, fil, qui travaille) est en base
et arrive tout seul au démarrage (hook) ; ce fichier dit le contexte et la
suite. Les décisions de Raphaël, mot pour mot :
`rnab26/dotfiles/cockpit-kit/DECISIONS-2026-09-28.md` (les lire aussi).

Dernière mise à jour : 29 sept. 2026, ~02 h 35 (heure d'Israël), fin de la
session `session_01B94XRweeYVuqGoJXTyjimP` (trop longue, Raphaël a demandé
de reprendre dans une session fraîche).

## 1. Ce qui est EN LIGNE et vérifié

- App https://rnab26.github.io/Cockpit-General/ (Pages depuis `gh-pages`,
  poussé par `deploy.yml` à chaque push sur `main`). Version en ligne = l'écran
  d'AVANT la refonte en entonnoir (dernier commit d'app : `071b10e`).
- Base centrale Supabase `bexiyvmdbxcwxasgslxp`, schéma `cockpit`,
  migrations 0001 → 0009 appliquées. `node scripts/verifier-base.mjs` :
  **134/134** (29 sept.).
- Module embarqué + fonction serveur `cockpit-embed` v3 : `verifier-embed`
  77/77.
- Sessions : lanceurs à jour automatique (`modeles/cockpit-*.sh`), hooks
  SessionStart (état), UserPromptSubmit (rappel), et **suivi** (0008/0009 :
  tables `sessions` / `taches`, `hooks/suivi.sh`, `progression.sh --agent`,
  tableau « Qui travaille » dans la session). `chantier.sh` : Claude tranche
  les « ambigu », range (`--section`/`--ranger`), suggère les fusions
  (`--suggerer-fusion`).
- **Limites d'usage et nuit** (migration 0010, `8e7d345`) : reprise native
  de la tâche en cours après une limite (`autoContinueAtUsageLimit`), pause
  visible (`sessions.pause_raison`, hook StopFailure), et **mode autonome** par
  projet (`regler_autonome(slug, jusqu_a, max)`, hook Stop `autonome.sh` qui
  donne le chantier LIBRE suivant). Testé : `verifier-base` §15 (144/144) et de
  bout en bout sur un projet jetable. Pas encore observé sur une VRAIE limite :
  à vérifier au premier arrêt réel (la session doit passer « en pause », puis
  repartir seule) — `select id, pause_raison, pause_at, vu_at from sessions`.
- **Mode autonome PERMANENT allumé** (29 sept. ~02 h 10, migration 0011) sur
  `cockpit` et `facepro` (`autonome_toujours`, max 20 par session). Réveils
  horaires (Routines Claude) :
  - FacePro : `trig_01XoGgs12Vs5QFwKJD5vqXpt` (minute 7) → session autonome
    `session_014wqppUDStT4Fcc7CH4SNj6` ;
  - cockpit : `trig_01VseAzWomoQETWZcXtquBpB` (minute 8) → session autonome
    `session_016AmT87i4pCEQKCLesesihr`.
  Vérifié au lancement : la session autonome FacePro a pris « Tête entière —
  bouche hybride ». Pour tout arrêter : `regler_autonome('<slug>', null)` puis
  supprimer les deux Routines (delete_trigger).
- Projets branchés : `cockpit` (lui-même) et `facepro` (FacePro `main`
  `3a13ebb`, suivi des agents compris). Jarvis et le Trieur : pas encore
  (décision D-12 : après le pilote).

## 2. (FAIT le 29 sept. ~02 h 30 : la refonte est EN LIGNE, commits 8e82a78 → 18b3f5e, verifier-web 167/167) — historique de ce qui était à reprendre

**La refonte de l'écran** (agent « Accueil en entonnoir de l'app cockpit »).
Elle n'est PAS sur `main`. Dernière sauvegarde : branche
**`sauvegarde/comment-verifier`** (commit de sauvegarde, non vérifié, ne pas
déployer tel quel). Si l'agent a fini avant la fin de la session d'origine,
son travail aura été publié et cette section mise à jour ; sinon :

```bash
git fetch origin sauvegarde/comment-verifier
git checkout origin/sauvegarde/comment-verifier -- app/   # récupère l'écran en cours
cd app && npm ci && npx tsc -b && npm run build
node --experimental-strip-types scripts/verifier-*.ts
node scripts/verifier-web.mjs          # parcours réel, écran de téléphone
```

Ce que cette refonte doit livrer (demandes de Raphaël des 28-29 sept.) :
1. **Accueil « Tout » en entonnoir** : En ce moment / À toi / À lancer ;
   vue projet avec sections repliées et compteurs ; pas de défilement dans
   toutes les catégories.
2. **Présence honnête** (`app/src/lib/presence.ts`) : « travaille » exige une
   preuve de vie ; barres grises sinon ; « Copier la consigne pour Claude »,
   « Demander où ça en est » ; réglage du délai de silence.
3. **Mise en ligne en mots d'enfant** : frise ✍️ Codé → 📤 Envoyé → 🤖
   Vérifié par les robots → 🌐 En ligne, et la phrase « C'est en ligne : tu
   peux vérifier » / « Pas encore en ligne » avant « Ça fonctionne ».
4. **Répondre partout** (sa capture du chantier « Notifications (v2) », 0
   message, aucun champ) : champ « ✍️ Écrire à Claude » toujours visible sur
   la carte dépliée ; phrase « Ce qu'on attend de toi » selon l'état ;
   « ▶️ Relancer maintenant » / « Garder de côté » sur un reporté ; fil vide
   non affiché ; Modifier / Supprimer (avec confirmation) conservés.
5. **Qui travaille** (tables `sessions` / `taches`) : par projet, une ligne par
   session (« répond en ce moment » / « attend ton message »), ses agents et
   commandes dessous, depuis quand, et étape + barre + « reste ~X » SEULEMENT
   si l'agent l'a signalé ; résumé « 2 sessions · 5 agents · 1 commande ».
   Un agent qui avance sur un chantier = preuve de vie du chantier.
6. **Suggestions de fusion** (messages `kind = 'fusion'`) dans « À toi » :
   « Fusionner » / « Garder séparés » → rpc `trancher_fusion`.
7. Libellé « 💬 lancé depuis une session Claude » (`origine = 'session'`).
8. **Interrupteur « 🌙 Mode autonome jusqu'à 09:00 »** par projet (rpc
   `regler_autonome`) et « ⏸️ En pause — limite d'usage » sur une session.
9. **État des déploiements** par projet : logique prête et testée
   (`app/src/lib/deploiement.ts`, `app/scripts/verifier-deploiement.ts`
   18/18), composant à faire (API GitHub anonyme, dépôts publics ; FacePro
   est sur Render, pas visible par GitHub : le dire). 29 sept. : + ligne
   « 🌐 Site en ligne — version X » lue sur `<url_site>/health` (FacePro
   renvoie son commit Render, CORS ouvert sur cette route). Chantier
   `b3ba035a-0484-434d-bfe2-dcc695f91f2d`.

Avant de publier : les contrôles ci-dessus au vert, parcours sur écran de
téléphone, puis push sur `main` (déploiement auto), vérifier que Pages sert
la nouvelle version, et passer le chantier « à vérifier » avec `--verifier`
et `--en-ligne`. Chantier concerné : `3f94d1e2-5847-411e-ba61-9e60def0005b`
(+ la refonte elle-même, chantier « Écran en entonnoir… » dans Application).

## 2 bis. 29 sept. matin : retour de Raphaël sur la refonte (chantier `9c417e60`)

« Où est passée la vue d'ensemble (nombre de chantiers, ce qui bouge, ce qui
ne bouge pas) ? Vue très grossière, très colorée, ça fait mal aux yeux,
régressif. Je ne peux plus répondre avec des cartes et ajouter des médias. »
Cause : la refonte `8e82a78` avait SUPPRIMÉ « Où j'en suis » (OuJenSuis.tsx) et
peint chaque bloc (cadres épais, fonds teintés, boutons pleins, emoji ronds).
Les médias n'avaient jamais existé dans l'app (hier = la fiche Claude).
Livré : « Où j'en suis » revenu en tête (Tout : une ligne par projet ; projet :
une ligne par section ; un nombre ouvre la liste de ses chantiers) — « pour
toi » = exactement la liste « À toi » (une seule règle, testée) ; écran calme
(cartes neutres + liseré, boutons en contour, pastilles sans pavé) ; médias
(0013, `Medias.tsx`, `scripts/media.sh`). Vérifié : 13 séries pures,
verifier-base 158/158, verifier-web (voir le commit).

## 2 ter. 29 sept. : règle de clarté (chantier `ca3a6877`)

Raphaël refuse toute solution payante (assistant en direct) : « je veux
simplement quelque chose de clair », pour TOUT le cockpit. Livré : refus dans
demander.sh / progression.sh / chantier.sh (voir CLAUDE.md), règle dans
docs/bloc-CLAUDE.md (propagée aux projets) et en tête du hook. Reste : les 4
questions FacePro déjà posées sont longues (posées avant la règle, par une
autre session) ; l'écran A + D (agent, branche `claude/ecran-a-plus-d`) doit
aussi suivre la règle.

## 2 quater. 29 sept. : écran A + D (chantier `6e651d23`, branche `claude/ecran-a-plus-d`)

Raphaël : « vas-y fais A + D et mets des logos plutôt que des emojis ».
- **Accueil = modèle A** (`TableauDeBord.tsx`, « Tout » ET vue projet) : quatre
  tuiles (pour toi · ça avance · en pause · fini) = LONGUEURS des listes
  (`lib/tableauDeBord.ts`, testé) ; détail par projet/section replié qui compte
  les mêmes chantiers (`ouJenSuis(..., classesDe(t))`) ; « À toi de jouer » (une
  ligne, le sujet, ce qu'on attend en mots simples, UN verbe) ; « Ça avance tout
  seul » par CHANTIER (`caAvanceToutSeul`, jamais une vieille barre sous une
  ligne vivante) + hors chantier + détail des sessions replié ; « Prêt à
  lancer ». Vue projet : + « Tous les chantiers » en lignes compactes,
  « Réglages du projet » replié.
- **Chaque chantier = une conversation** (`Conversation.tsx`, modèle D) :
  feuille plein écran (téléphone) / dialogue (ordinateur), par-dessus l'écran,
  le « retour » du téléphone la ferme (entrée d'historique posée dans
  Cockpit.tsx). Bulles, demande d'abord, ce qu'il faut faire en dernier et on y
  arrive positionné ; barre « Écrire à Claude… » (seule façon d'écrire) ; menu ⋯.
- Morts et supprimés : CarteChantier, Fil, EcrireDansFil, EnCeMoment, ALancer,
  AToi (→ BlocsAToi), VueEnsemble. Libellés des libs SANS emoji ; icônes lucide
  (`Icones.tsx`). Mots simples (conversation / assistant ; aide « c'est quoi ? »).
- **Attention fusion** : main a reçu 964528e (revert des fichiers app/ que
  256f351 avait embarqués par erreur) : en fusionnant cette branche, garder SA
  version de app/.

## 2 quinquies. 29 sept. midi : écran A + D en ligne, et UNE session chef

- Écran A + D fusionné et en ligne (54e63e0, verifier-web 227/227).
- Session chef (0014, `scripts/chef.sh`, voir CLAUDE.md) : la session où
  Raphaël écrit dirige et lance des agents ; un seul réveil horaire
  (`trig_01VseAzWomoQETWZcXtquBpB`, sur la chef) ; le réveil FacePro a été
  supprimé avec l'accord de Raphaël. Chef actuelle : session
  `session_016AmT87i4pCEQKCLesesihr`.

- **29 sept. 16 h : un chef PAR PROJET (0019, chantier b78b8ba3)**. Raphaël ne
  veut plus tous les projets dans la session du cockpit. `cockpit.chefs` (une
  ligne par projet), `chef.sh` ne sert que `COCKPIT_PROJET`. La chef du
  cockpit a été reprise telle quelle (réveil `trig_01VseAzWomoQETWZcXtquBpB`,
  5 agents). FacePro n'a pas de chef tant que Raphaël n'écrit pas dans une
  session FacePro : elle le deviendra et créera SON réveil (consigne de
  `--prendre`). D'ici là, FacePro garde le fonctionnement par session.

## 2 sexies. 29 sept. après-midi : Claude MONTRE des images (chantier `2d51d3f8`, migration 0020)

`demander.sh --image`, `progression.sh --termine … --image` (« Ce que tu dois
voir », `chantiers.verifier_medias`), `media.sh --envoyer` (fil). Miniatures
cliquables dans l'app (plein écran). Règle « montre, ne décris pas » dans
CLAUDE.md et `docs/bloc-CLAUDE.md`. Vérifié : verifier-base §20 (205/205),
verifier-web 282/282, preuve sur le site en ligne (projet jetable, nettoyé).
Reste : le module embarqué (`embed/`) n'affiche pas encore ces images.
`verifier-web.mjs` ne purge plus que les projets de test de plus de 2 h
(plusieurs agents le lançaient en même temps et se purgeaient l'un l'autre).

## 2 septies. 29 sept. soir : pièces jointes dès la création (chantier `db78423d`, fusionné avec `e68e0efd`)

« + Chantier » accepte tout type de fichier (aucun filtre `accept` ; bucket
`cockpit-medias` : tout type, 50 Mo, limite écrite sous le bouton), crayon sur
les images avant envoi. Le chantier est créé (id choisi par l'app), puis les
pièces partent dans `<projet>/<chantier>/` et un message `info`. Dépôt en
échec : pièces gardées, « Envoyer les pièces ». En ligne (PR #1, 9358916),
verifier-web 299/299 (image + PDF + .dwg, `media.sh --chantier` les récupère).
Reste : le module embarqué (`embed/`, « Nouvelle demande ») ne joint aucun
fichier — à décider avec Raphaël.

## 2 octies. 29 sept. soir : section « Correctifs » rangée toute seule (chantier `ea21b577`, migration 0021)

Trigger `before insert` sur `chantiers` : un chantier créé sans section dont
`est_correctif(titre, demande, origine)` est vrai va dans « Correctifs »
(créée si besoin), toutes voies (app, session, module embarqué). Règle :
mot visuel/ergonomie et aucun mot de gros chantier dans le titre (titre +
demande pour un utilisateur final). `ranger_correctifs(slug)` pour les
ouverts sans section : passé sur cockpit et facepro le 29 sept., 0 rangé
(aucun chantier ouvert n'est un correctif visuel). Vérifié :
`verifier-correctifs` 32/32, `verifier-base` 216/216 (§22),
`verifier-reponses` 16/16, `verifier-embed` 80/80. App inchangée. Pas de
réglage pour éteindre le tri par projet (à ajouter si Raphaël le veut).

## 2 nonies. 29 sept. soir : « À toi de jouer » à jour (chantier `20a42f79`, migration 0022)

Raphaël : des demandes de plus de 12 h déjà réglées ailleurs, sans savoir
lesquelles sont récentes. Livré : l'âge sur chaque ligne, le plus récent en
haut (bouton de tri), « peut-être plus à jour » pour tous les types, en bas ;
en base, certifié/archivé ferme ses questions, `a_toi_a_revoir` +
`scripts/revue-a-toi.sh` (chef.sh / passe.sh, 1 revue par heure et par
projet), `demander.sh --confirmer <chantier>` et `--debloquer`. État relevé
avant : cockpit 13 éléments (3 de plus de 12 h, aucun dépassé) ; FacePro 12
(5 de plus de 12 h, 4 que Claude avait fait avancer depuis). Une question
FacePro déjà répondue dans la session (« attends ») retirée. Reste :
FacePro n'a pas de chef, donc sa revue ne tourne que via `passe.sh` (session
autonome) tant que Raphaël n'écrit pas dans une session FacePro ; 2 bloqués
FacePro « regroupés dans une autre session » sont des doublons à proposer en
fusion par cette revue.

## 2 decies. 29 sept. soir : « Où ça en est ? » suivi en direct (chantier `73fddb87`, migration 0023)

Un toucher = UNE demande (`demander_ou_en_est`), suivie en direct dans « Ça
avance tout seul » (frise Envoyée → Reçue / En file → Réponse), bouton
désactivé tant qu'on attend. Reçue : hook de suivi ; personne dessus : la chef
lance un assistant « Point » qui répond avec `progression.sh --point`. Voir
CLAUDE.md. Reste : le module embarqué (`embed/`) n'a pas ce bouton.
30 sept. (correction, migration 0032) : plus de barre grise périmée sous la
demande, assistant « Point » visible sur le chantier (étape + barre), réponse
« Fait / Pour finir / Bloque », un seul assistant par fil. Voir CLAUDE.md.

## 2 undecies. 29 sept. après-midi : les RENFORTS (D-10, chantiers 6a69c7b4 + 5b5900a9)

Bouton « Lancer des renforts » (au-dessus de « Prêt à lancer », vue projet et
« Tout »), réglages (sessions 0-4, agents 1-5), états demande envoyée / en
route / erreur / terminé. Migration 0024 appliquée (le brouillon 0020 de
agent/646460 a été repris, renuméroté : 0020 à 0023 étaient pris).
Voir CLAUDE.md « Renforts ». Vérifié : verifier-base §25,
verifier-renforts 16/16, verifier-web (section « renforts »).
**Pas encore observé en vrai** : aucune session renfort n'a été ouverte. La
première ouverture réelle sera faite par la session chef du cockpit (Raphaël
clique, la passe de `chef.sh` lui donne les `create_session`). À surveiller :
que `create_session` accepte `tags`/`source_url` tels qu'écrits, que la
session renfort charge bien les hooks du dépôt (marque posée par
`renfort.sh --suivant`), qu'elle ne devienne pas chef (`chef.sh --etat`).
Limites connues : la chef ne voit une demande qu'à son prochain passage (au
plus 1 h, ou dès que Raphaël lui écrit) ; un renfort muet 3 h rend sa section
(« erreur » visible). Les projets déjà branchés reçoivent `renfort.sh` par le
lanceur ; `cockpit-renfort.sh` arrive au prochain démarrage (brancher.sh --maj).

## 2 duodecies. 29 sept. soir : chaque fil est une discussion (chantier `450afa9e`, migration 0025)

Un message libre de Raphaël dans un fil attend une réponse ÉCRITE de Claude
(`progression.sh --point`, avec ou sans `--chantier`) ; la chef la confie à un
agent « Répondre : … » si personne ne tient le fil. L'app : chronologique, en
bas, cartes toujours en dernier, « réponse en attente / prochain passage vers
HH h MM ». Branche `agent/discussion`. Ouvert : réveil immédiat de la chef
quand il écrit (déclencheur API de routine, jeton à créer à la main) — question
posée dans le chantier. Le module embarqué montre seulement « la réponse
arrivera ici » (pas l'ordre des cartes ni le prochain passage).

## 2 terdecies. 29 sept. soir : certifier GARDE une question ouverte (chantier `4852f9e5`, migration 0026)

En certifiant `450afa9e`, Raphaël a perdu la question `876ad67b` (réveil
immédiat) : le trigger `retirer_sans_objet` (0022) l'avait fermée. Désormais
seules les fusions sont fermées en certifiant ; « Ça marche » montre d'abord
les questions ouvertes (répondre, ou « Certifier quand même ») et elles restent
dans « À toi ». `876ad67b` rouverte en base (réponse vidée), une ligne dans le
fil de `450afa9e`. Piège trouvé : `certifier_chantier` pose aussi
`archived_at` — voir CLAUDE.md « À toi de jouer ». Branche
`agent/question-gardee`. Le module embarqué (`embed/`) ne montre pas encore
cette étape à l'utilisateur final (la base garde quand même sa question).

## 2 quaterdecies. 29 sept. soir : rejouer une demande d'utilisateur (D-05, chantier `b188cfbb`)

Le module embarqué joint à chaque demande et correction (bloc `<capture>`,
désactivable par `data-reproduction="non"`) : page sans jetons, titre, écran,
appareil, langue, heure, version (`/health` ou `data-version`), 20 dernières
actions (libellés, jamais une valeur saisie), 5 erreurs JS. La fonction
serveur refait tri et bornes (`supabase/functions/cockpit-embed/reproduction.ts`,
v5 déployée) et ne la renvoie jamais au site ; `corriger` remplace le scénario.
App : « Pour reproduire » replié + « Rejouer » (ouvre la page d'origine).
Sessions : `scripts/reproduction.sh --chantier <id>`, cité dans les consignes
(chef, renfort, mode autonome) quand il existe. Parité module/serveur du
nettoyage : `app/scripts/verifier-reproduction.ts`. Hors v1 : rejouer les clics
tout seul, test synthétique automatique, capture dans l'app elle-même (« + Chantier »).

## 2 quindecies. 29 sept. soir : ses messages de SESSION dans le fil du chantier (chantier FacePro `2190e53b`, migration 0027)

Raphaël : « les messages que j'envoie dans une session pour des chantiers que
j'ouvre ne sont pas importés dans le chat du chantier, on s'y perd ». Livré :
`hooks/suivi.sh` (UserPromptSubmit, `consigner_message`) envoie chacun de SES
vrais messages (pas une notification, un réveil, une consigne de renfort ni
une commande seule ; jamais depuis une session de renfort) à
`consigner_message_session` : déposé tel quel (secrets évidents masqués,
`masquer_secrets`) dans le fil des chantiers que la session tient, et gardé
15 min dans `messages_session_attente` pour rejoindre le chantier qu'elle
prend juste après (trigger `chantiers_messages_session`, toutes voies, à
l'heure où il a été écrit, une seule fois par fil). `messages.via_session` :
jamais « message libre » (base ET app), jamais remis à la session comme « il
t'écrit », jamais lu par un utilisateur final (RLS `membre_messages_lit` +
filtre de `cockpit-embed`). App : bulle « Toi · dans la session claude ».
Vérifié : verifier-base §28 (326/326), verifier-reponses §12 (46/46).
Limite : un message qui porte sur un AUTRE sujet que le chantier tenu y est
quand même déposé (la session ne sait qu'après) ; il rejoint aussi le
nouveau chantier si la session l'ouvre dans les 15 min.

## 2 sexdecies. 29 sept. nuit : un sujet = un fil, relais, réveil immédiat (chantiers `450afa9e` + `58e0f05c`, migration 0028)

Branche `agent/synchro` (contient la PR #7). Voir CLAUDE.md « Session et
cockpit : deux portes égales ». Vérifié : verifier-base 357/357 (§29),
verifier-reponses 56/56 (§13-14), verifier-web 376/376, tests purs (reporter
10/10, renforts 17/17). Preuve du réveil : un faux jeton part vraiment vers
api.anthropic.com (401 authentication_error enregistré). Reste :
- le JETON de la routine : posé par Raphaël le 30 sept. ; constaté : un /fire
  ouvre une NOUVELLE session (pas la chef), sans dépôt si la routine n'en a
  pas. Corrigé côté cockpit (`chef.sh --releve`, `--texte-routine`, CLAUDE.md
  « /fire ouvre une NOUVELLE session ») ; reste le geste de Raphaël : ajouter
  le dépôt aux dépôts de la routine (action dans « À toi »), et la session
  chef applique le nouveau prompt (update_trigger) ;
- FacePro : les 2 demandes de renfort seront ouvertes par la chef relais (cockpit)
  à son prochain passage, une fois `main` à jour (le lanceur prend main).
- non fait : la case « Écrire à Claude » dans l'onglet « Tout » (seulement vue
  projet) ; le module embarqué (`embed/`) n'a pas les boutons de côté / reporter.

## 3. Ensuite (dans l'ordre)

- Propagation AUTOMATIQUE (cbef0db) : chaque démarrage de session met le projet
  à jour (brancher.sh --maj) ; la liste des fichiers vient de modeles/fichiers.txt.
  Un fichier ajouté au cockpit doit être ajouté à cette liste.
- Question ouverte à Raphaël : installer le module embarqué sur le SITE FacePro
  (visible par ses clients ?) — posée dans la conversation du 29 sept.

- Faire tester par Raphaël, sur son téléphone, les chantiers « à vérifier »
  (13 au 29 sept.) : c'est lui qui certifie.
- Une prochaine session FacePro devrait apparaître dans « Qui travaille » :
  le vérifier en base (`select * from sessions order by vu_at desc`).
- Brancher Jarvis et le Trieur (`brancher.sh`) une fois le pilote validé.
- **Se greffer sur un projet qui n'est pas à Raphaël** (chantier `f31ae3ec`).
  **FAIT le 30 sept.** : Raphaël a répondu « les 3 options me plaisent, ça
  laisse le choix au client » → `brancher.sh --voie invisible|branches|normale`
  (refus sans voie sur un dépôt d'autrui), garde pre-push, `greffe.sh
  --branche-propre`, `verifier-greffe.mjs` (voir CLAUDE.md et README). Reste :
  le skill `cockpit` (dépôt dotfiles) doit poser la question de la voie au
  moment de brancher un dépôt d'autrui ; aucun dépôt d'autrui branché à ce
  jour. Historique de la réflexion ci-dessous. Ce qui gêne aujourd'hui : `brancher.sh` écrit
  DANS le dépôt (bloc CLAUDE.md, `.claude/settings.json`, `scripts/cockpit-*`)
  et le hook de démarrage les commite seul sur la branche courante — chez
  autrui, c'est une trace non demandée. Et la clé `service_role` de la base
  centrale ne doit JAMAIS aller dans un environnement cloud que le
  propriétaire voit : toujours l'environnement de Raphaël. Trois voies :
  1. **Greffe invisible** (recommandée) : rien dans leur dépôt. Le script
     d'installation de l'environnement cloud de Raphaël clone Cockpit-General
     et pose hooks + `COCKPIT_PROJET` dans `~/.claude/settings.json`
     (niveau utilisateur) ; le bloc de règles arrive par le hook, pas par leur
     CLAUDE.md ; l'auto-commit est coupé (option `--sans-trace` à ajouter à
     `brancher.sh`/`session-start.sh`). Coût : ~½ journée ; limite : une
     session hors de cet environnement n'a pas le cockpit.
  2. **Greffe sur une branche à Raphaël** : branchement normal, mais les
     fichiers du cockpit restent sur ses branches et sont retirés de chaque PR
     vers leur `main`. Simple, mais fragile (un oubli et ça part chez eux).
  3. **Branchement normal avec leur accord** : identique à FacePro ; le
     propriétaire voit les fichiers du cockpit dans son dépôt.
  Dans tous les cas : un projet en base par dépôt d'autrui (données
  séparées), aucun membre extérieur ajouté sans Raphaël, et l'accès au dépôt
  passe par GitHub (collaborateur ou fork), pas par le cockpit.

## 4. Pièges déjà payés (ne pas les repayer)

- Fonctions `security definer` : vérifier l'appelant (`est_service`,
  `est_admin`, `peut_agir`), `revoke … from public` puis `grant` nommé ;
  `auth.role()`, jamais `current_user`.
- `scripts/sql.sh` : une instruction par appel si on attend des lignes ; un
  `insert … returning` ne renvoie rien (générer l'uuid avant) ; jamais de
  colonne aliasée `t`.
- Le Chromium du conteneur n'ouvre aucune WebSocket : le temps réel se
  prouve depuis Node (`verifier-base` §12), pas dans le navigateur de test.
  Et il ne fait pas confiance au proxy TLS : les scripts passent les requêtes
  https par Node (voir CLAUDE.md), jamais `ignoreHTTPSErrors`.
- Une refonte d'écran ne SUPPRIME pas un bloc que Raphaël utilise sans le lui
  dire (29 sept. : « Où j'en suis » disparu, vécu comme une régression). Et
  pas de pavés colorés : couleur = liseré, point ou texte.
- `pgrep`/`pkill` : motifs ancrés, sinon la commande se tue elle-même.
- Un banc de test qui écrit dans un VRAI projet finit par y laisser des
  chantiers « [TEST… » que Raphaël prend pour du vrai (29 sept., chantier
  `0b54f4f8`). Tout banc : projet jetable `test-…`, `scripts/bancs.mjs`
  (voir CLAUDE.md) ; `verifier-base` §21 le garde.
- Les hooks déclarés dans `.claude/settings.json` d'un projet ne se
  propagent pas seuls : un nouvel événement = relancer `brancher.sh` sur
  chaque projet branché (idempotent).
- Un agent en arrière-plan meurt avec la session qui l'a lancé : sauvegarder
  son travail (branche de sauvegarde) avant de fermer.
- Raphaël : répondre à CHAQUE message tout de suite (une ligne d'accusé
  suffit), même pendant un long travail. Il a cru ses messages perdus.
