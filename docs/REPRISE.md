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

## 2 septies. 29 sept. après-midi : les RENFORTS (D-10, chantiers 6a69c7b4 + 5b5900a9)

Bouton « Lancer des renforts » (au-dessus de « Prêt à lancer », vue projet et
« Tout »), réglages (sessions 0-4, agents 1-5), états demande envoyée / en
route / erreur / terminé. Migration 0021 appliquée (le brouillon 0020 de
agent/646460 a été repris, renuméroté : 0020 est pris par l'aperçu d'image).
Voir CLAUDE.md « Renforts ». Vérifié : verifier-base 244/244 (§22),
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
- À cadrer avec Raphaël (dans le cockpit, `demander.sh`, pas d'artefact) :
  rejeu de scénario (D-05). (Le bouton D-10 est livré : les renforts, §2 septies.)
- Brancher Jarvis et le Trieur (`brancher.sh`) une fois le pilote validé.

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
