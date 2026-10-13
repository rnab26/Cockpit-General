# Accueil simple, « pour toi » = les demandes, « à tester » à part (13 oct. 2026)

Demande de Raphaël (13 oct., depuis son téléphone) : « il y a encore trop d'informations […] j'ai 30 actions à faire
avant de voir l'historique du chat […] il n'y a pas toujours les sujets, je suis obligé de lire les descriptifs […]
je ne traite pas sur le cockpit donc ce n'est pas traité, alors que j'ai avancé sur la session Claude […] simplifie les
choses, allège ton process, fais au plus simple possible, pour que je puisse faire travailler des gens sur le cockpit. »

## Ce qui a été mesuré (base et captures réelles, téléphone 390 px, 13 oct. 09 h UTC)

- « Pour toi » = **69** (Tout), dont **56 chantiers livrés** qui attendent seulement un test (35 FacePro, 21 cockpit) :
  il n'y avait que ~13 vraies demandes. Après : 13. Pastille « Discussions » : 97 → 38 (les réponses non lues de Claude y
  restent : un chat à 28 réponses non lues en pèse 28).
- Le chat FacePro s'ouvrait sur **35 grandes cartes** « Ça marche / Ça ne marche pas » avant son historique.
- Quatre questions d'un même chantier (« Décisions en attente de Raphaël (7 oct.) ») s'affichaient avec le MÊME titre : on
  aurait dit des doublons. Les vrais doublons de titres sont rares : 19 chantiers FacePro créés en 5 jours, 2 paires
  proches ; sur 20 fusions suggérées depuis le 28 sept., 11 acceptées, 1 refusée (le reste « sans objet »).
- 26 chantiers FacePro « en cours », dont 24 sans session, beaucoup ouverts par des sessions qui se sont arrêtées sans jamais
  les terminer (aucune étape, aucune activité) : c'est ce qui donne « 24 chantiers attendent une session ».

## Ce qui est livré

1. **UNE règle, `estDemande`** (`app/src/lib/entonnoir.ts`) : une demande = question, action, fusion, décision, blocage.
   Un chantier livré « à tester » n'en est pas une. `tableauDeBord().aToi` = les demandes, `.aTester` à part ; la tuile
   « pour toi » du tableau, le rouge des onglets (`pastillesProjet`), « pour toi » par section (`ouJenSuis`) et la pastille
   des chats (`notifsChat`) ne comptent que les demandes ; une sixième tuile « à tester » existe dans la vue détaillée.
2. **L'accueil simple est la vue par défaut** (`AccueilSimple.tsx`, règles `lib/vueAccueil.ts`) : trois blocs.
   - **À toi** : cinq demandes au plus (le plus récent en haut), puis « Voir les N autres » ; dessous une ligne repliée
     « N livrés à tester · sans urgence » qui s'ouvre sur la liste ; vide : « Rien ne t'attend ».
   - **En cours** : ce qui avance vraiment (barre, étape) ; « N chantiers attendent une session · Lancer » ouvre la liste
     de ce qui attend.
   - **Livré** : les trois derniers certifiés (« Certifié par toi à 12:17 »), « changer » la période.
   « Vue détaillée » (bas de page) rend l'ancien accueil (tuiles, tableau par section, renforts, réglages) ; « Vue simple »
   (haut) y ramène. Retenu par appareil (`localStorage` `cockpit_accueil`, `simple` | `detaillee`). Les bancs qui parcourent
   l'ancien écran posent `cockpit_accueil = detaillee`.
3. **Chaque carte dit son sujet** (`sujetEtDetail`, `detailDeCarte` dans `lib/bulleAide.ts`) : titre du chantier ; sans
   chantier, le « Sujet : … » du message, sinon sa première phrase ; la 2e ligne d'une question ou d'une action est la
   QUESTION elle-même (jamais « Claude te pose une question » quand le texte existe ; l'alerte « Claude a avancé depuis »
   passe d'abord). Un nom de conversation illisible (« Chantier cockpit 9dcc2c9a-… », un identifiant) n'est plus affiché
   (`nomIllisible`, `lib/sessions.ts`).
4. **Chat plié** (`BulleFlottanteAide.tsx`) : l'historique d'abord ; « À faire ici (N) » = une ligne par demande (icône,
   sujet, question, geste), une seule carte dépliée à la fois (la seule demande, d'emblée), cinq lignes puis « Voir les N
   autres » ; « N livrés à tester » replié. La liste des discussions dit « N à faire » (demandes) et « N à tester » (gris).
5. **Classer sans test** (migration 0079, `ClasserLivres.tsx`, `lib/classerLivres.ts`) : sous la liste des livrés à
   tester, « Classer ces N sans test » (confirmation qui dit ce qui se passe, puis « Annuler » 10 s) → `archiver_livres` :
   le chantier GARDE « à vérifier » (jamais « certifié » : seul Raphaël pose « valide »), part aux archives, une ligne
   dans son fil ; « Désarchiver » le rend. Dans la vue d'un projet, le réglage « Classer tout seul ceux que tu n'as pas
   touchés après [jamais · 3 · 7 · 14 · 30 jours] » (`projets.livres_classes_apres_j`, **vide = jamais, c'est le défaut**) ;
   UNE règle en base, `livre_sans_retour(c, jours)` (livré, pas archivé, aucun « vérifie pour moi », aucun mot de Raphaël
   ni d'un utilisateur depuis la livraison, aucune question ouverte), lue par `classer_livres_anciens()` (job pg_cron
   horaire `cockpit-livres-classes`, jamais un projet de test). Mesuré le 13 oct. : 23 chantiers seraient classés à 7 jours,
   0 à 14 jours (le cockpit a 15 jours).
6. **Brancher une session à la main** (`scripts/connecter.sh`) : voir plus bas.

## Pourquoi « le projet Cockpit n'était pas branché » (cause prouvée)

Les hooks (`.claude/settings.json`) ne se chargent que si la session démarre DANS le dépôt. Une session ouverte sur
**plusieurs dépôts** (Cockpit-General + dotfiles) démarre dans `/home/user` : aucun hook, donc ni l'état du cockpit
dans le contexte, ni la session visible dans l'app (aucune ligne `sessions` avant que la session soit déclarée à la main),
ni « un sujet = un fil », ni les réponses en direct. Preuve : la session de ce lot (`fd8d658a…`) n'existait pas en base
avant `suivre(...)` ; les seules sessions du jour étaient trois « démarrages » de 0 s sur la branche `main` à 00:28-00:29
(déduit : un préchauffage du conteneur), qui posent pourtant `branchement_vu_at` : l'icône « branché » de l'app peut donc être
verte sans qu'aucune vraie session soit connectée (non corrigé : voir « Non fait »).

`bash scripts/connecter.sh [--projet <slug>]` (depuis n'importe quel dossier) fait à la main ce que fait le hook de
démarrage : il affiche l'état du projet (le MÊME texte), pose `branchement_vu_at` et déclare la session (`suivre`).
Il échoue net (code 1) si le projet est inconnu ou la base muette : jamais un faux « branché ». Il ne remplace pas les
hooks : pas de réponses en direct tant qu'il n'est pas relancé. `scripts/verifier-connecter.mjs` rejoue le cas exact.

## Non fait, dit franchement

- **L'icône « branché » reste trompeuse** : `branchement_vu_at` est posé par n'importe quel démarrage de hook, même un
  préchauffage de 0 s. Une preuve honnête = une session vue depuis plus de 2 minutes ou une écriture de session.
- **Les chantiers ouverts puis jamais terminés** (26 FacePro « en cours ») : rien ne les clôt tout seul. Piste : à la fin
  d'un tour, le hook d'arrêt compte les commits poussés depuis l'ouverture du chantier (faits, pas déclarations) et les
  pose comme jalon « poussé » ; une session morte avec commits = « livré, à vérifier ». Non fait : demande une décision.
- **Pas de hook utilisateur** : le mécanisme qui copie `rnab26/dotfiles/.claude/` dans `~/.claude/` (CLAUDE.md, skills)
  copie-t-il aussi un `settings.json` avec des hooks ? Non vérifié (il faudrait une session neuve). Si oui, un hook
  utilisateur réglerait le cas « plusieurs dépôts » pour tous les projets.
- **Auto-fusion des doublons** : non faite. 11 fusions suggérées acceptées sur 12 décidées : un seuil d'auto-fusion serait
  défendable, mais une fusion se défait mal (la demande de la source reste dans le texte de la cible).
- **Un CLAUDE.md de 122 Ko** (~33 000 jetons chargés par chaque session et agent) alourdit tout : à découper (chantier).

## Vérifications

`node --experimental-strip-types app/scripts/verifier-vue-accueil.ts` · `verifier-classer-livres.ts` ·
`verifier-bulle-aide.ts` (sujet, détail) · `verifier-entonnoir.ts`, `verifier-tableau-de-bord.ts`, `verifier-ou-jen-suis.ts`
(demandes / à tester) · `node app/scripts/verifier-accueil.mjs` (accueil simple, vue détaillée, chat plié, classer sans
test, téléphone, projets jetables) · `node scripts/verifier-connecter.mjs` · `verifier-base` §56 (`SEUL=56`).
