# Historique — Cycle d'un chantier, vérification, fusion, PR, rapprochement GitHub

Déplacé tel quel de `CLAUDE.md` le 15 oct. 2026 (chantier 1af98322, décision de Raphaël : « Oui, je déplace »). Rien n'est supprimé : ce sont les dates, causes prouvées, numéros de migration et limites de chaque chantier. Les règles à appliquer restent résumées dans `CLAUDE.md` ; ce fichier se lit à la demande, quand on touche au sujet.

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

## Vérifier un chantier livré : lien exact, trois issues claires (5 oct. 2026, migration 0056, chantier 2d21c64f)

Raphaël (30/09) : on lui demandait de tester « sans le lien exact », et « Corriger » exigeait un correctif qu'il n'a pas ; il écrivait dans le fil « ça ne marche pas », sans savoir si c'était pris en compte. (1) `progression.sh --verifier` refuse une étape sans lien https (`--sans-lien "pourquoi"` si rien à ouvrir). (2) Le bloc « à vérifier » offre « Ça marche » (certifie), « Ça ne marche pas » (mots FACULTATIFS) et « Je ne peux pas vérifier » : les deux derniers = `signaler_ne_marche_pas` / `demander_verification` (une règle, `poser_verification` ; `verif_motif` = `ne_marche_pas` / `ne_sait_pas`) ; Claude (agent « Vérifier » de `chef.sh`, consigne selon le motif) rejoue le cas puis `verdict.sh` : `--pas-bon` → le chantier repart en correction, `--bon` → retour à lui avec la preuve. « Corriger » (mots obligatoires) n'existe plus sur un chantier à vérifier ; `corriger_chantier` reste pour « Signaler un problème » d'un chantier certifié. (3) Un message TAPÉ dans le fil d'un chantier « à vérifier » vaut « ça ne marche pas » : le déclencheur `verif_sur_message` pose la vérification (ou l'ajoute à celle en cours) et répond « Reçu… » dans le fil. Le constat s'écrit « Ça ne marche pas (je ne sais pas pourquoi)… » (jamais « Ça ne marche pas : », message libre à réponse écrite). La migration 0056 est aussi la trace d'objets qu'une session précédente avait posés en base sans la versionner. `verifier-base` §17, `verifier-web` (Ça ne marche pas).

## « Je ne sais pas : vérifie pour moi » (29 sept. 2026, migration 0016)

Troisième bouton sous « Ça marche / Corriger » : Raphaël colle ce qu'il a vu
(ou une capture), Claude juge. `demander_verification` pose la demande (le
chantier sort de « À toi ») ; `scripts/chef.sh` lance un agent qui compare à la
source et rend `scripts/verdict.sh --bon|--pas-bon` (`rendre_verdict`,
service seulement) : bon → retour à Raphaël pour un toucher, pas bon →
correction. « Comment vérifier » : une observation évidente, jamais compter.

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

## Regrouper les chantiers avant de les traiter (5 oct. 2026, migration 0055, chantier 8486b809)

Raphaël : « la chef doit réfléchir à une logique de fusion quand elle reçoit les chantiers […] regrouper ceux qui peuvent être faits ensemble […] et une fois livrés, qu'on comprenne que deux chantiers ont été fusionnés, actualisé dans le cockpit du projet ». Avant de lancer ses agents, `chef.sh` liste les paires de chantiers ouverts qui se ressemblent (`groupes_possibles`, même mesure `ressemblance_fusion` que la fusion suggérée, seuil 0,35, jamais une paire déjà « Garder séparés ») et dit à la chef de juger : même sujet → `chantier.sh --suggerer-fusion` ; sujets voisins → `chantier.sh --regrouper <id> --avec <id>` (`regrouper_chantiers`, `chantiers.groupe_avec`) puis UN agent fait les deux ; sans rapport → rien. À la livraison, un trigger (`propager_livraison_fusion`) écrit « Livré avec « X » » dans le fil de chaque chantier fusionné (doublon) ou regroupé, et « Cette livraison couvre aussi : … » dans le fil livré. Limite : pas d'écran de réglage du seuil (0,35 en dur dans la fonction) ; la chef juge, rien n'est regroupé automatiquement. `verifier-base` §43.

## Rien repris à tort : « Terminé » sort de bloqué, déjà livré = pas repris (5 oct. 2026, migration 0051, chantier 72d09c69)

Raphaël (réponse « Les 3 correctifs ») : (1) `progression.sh --termine` passe aussi un chantier « bloqué » à « à vérifier » (avant : seulement en cours / libre / à trier, le chantier livré restait « bloqué » — l'ancienne mise en garde du bloc FacePro tombe) ; (2) UNE règle `cockpit.livre_sans_suite(c)` (dernière activité « terminé » et aucun message de Raphaël / d'un utilisateur depuis) lue par `chantiers_prenables` : un chantier libre / à trier déjà livré n'est pas repris par le mode autonome, un « Corriger » ou une réponse le rouvre ; déjà pris = réservation valide (0036) ; (3) la passe de libération rend les réservations EXPIRÉES (`pris_par` vidé, sauf chantier « en_cours » dont `chantier_abandonne` a besoin). `verifier-base` §42 (`SEUL=42`).

## Chantiers à jour d'après GitHub : on lit git, on ne croit plus la mémoire des sessions (13 oct. 2026, migration 0080, chantier 6f112d51)

Raphaël : « une session Claude bosse sur plusieurs sujets sur FacePro […] mes chantiers ne sont pas à jour, les anciens et les nouveaux ne sont pas coordonnés ». **Mesuré** (FacePro, 13 oct.) : 29 chantiers ouverts dont 19 sans personne dessus ni question en attente, 37 « à vérifier » dont 27 sans un mot de lui depuis leur livraison ; causes : une session ouvre un chantier sans le fermer, il tranche dans la session et pas dans l'app, FacePro pousse tout droit sur `main` depuis le 9 oct. (plus de PR). **Détail, preuves, limites : `docs/rapprochement-github.md`.** En bref : `cockpit.rapprocher_depot` (UNE règle) passe « livré, à vérifier » un chantier ouvert que personne ne tient et dont le travail est PROUVÉ dans `main` (commit signalé « envoyé » ; code de sa branche dédiée ; PR de sa branche ; PR qui cite son identifiant ; titre de PR presque identique à lui seul), à la date de la fusion, avec la preuve dans son fil et le lien exact. Jamais « validé » (seul Raphaël), jamais un chantier tenu par une session vivante ou qui attend une réponse, jamais sur une simple mention, une branche non fusionnée, du journal seul ou une preuve ambiguë. `scripts/rapprocher.py` (collecteur, aucune règle ; le texte des commits, parfois d'autrui, est rangé dans la requête avec un délimiteur aléatoire vérifié : l'ancien `$faits$` retiré du texte pouvait en fabriquer un autre) lit un petit clone SANS fichiers gardé dans `~/.cache/cockpit-general/depots/<projet>` (la copie de travail n'est jamais touchée) ; lancé en fond par `session-start.sh` et `prompt-rappel.sh`, au plus toutes les 20 min par projet (`--si-ancien`), arrivé à tous les projets par le lanceur (`modeles/fichiers.txt`). Une session VIVANTE reçoit, au plus toutes les 30 min (`COCKPIT_SANS_TRACE_MIN`, pour ne pas gonfler son contexte), un rappel précis des chantiers qu'elle tient sans trace depuis longtemps (4 h par défaut, réglable par projet : `chantiers_tenus_sans_trace` ; `--termine` / `--etape` / `--de-cote`). Un passage qui ÉCHOUE est noté en base (`projets.rapproche_erreur`, secrets masqués) et l'écran « Chantiers et GitHub » le montre au lieu de « pas encore passé ». **Général, jamais par projet** (Raphaël, 13 oct. : « pas seulement lié à un seul projet […] tous les projets actifs et futurs », migration 0081) : tout vient par le lanceur, la base et `docs/bloc-CLAUDE.md` ; réglages PAR PROJET (écran « Chantiers et GitHub » › « Régler… » : rappel après N h sans trace, 4 par défaut ; recherche au plus toutes les N min, 20 par défaut) et interrupteur GÉNÉRAL (`regler_rapprochement(null, faux)`, testé dans une transaction annulée) ; seuils de la règle en constantes nommées. Éteindre un projet : écran ou `regler_rapprochement(slug, oui|non)` ; `COCKPIT_RAPPROCHEMENT=0` éteint une machine ; `rapprocher.py --projet <slug> --essai` dit ce qui serait fait sans rien écrire. Défaire : « Ça ne marche pas » sur le chantier, ou `annuler_rapprochement(<id du journal>)`, aussi par le bouton « Annuler » de « Derniers passages automatiques » (14 oct., chantier 7070ce60 : confirmation, toast, état vide ; seulement tant que le chantier est encore « à vérifier »). **Limites dites** : un chantier sans PR, sans jalon et sans branche dédiée n'est jamais prouvé (aucune devinette : 14 des 19 chantiers FacePro ouverts sans session) ; le verdict dit DANS une session n'est pas lu (décision à prendre) ; la règle « titre » est la plus faible. **Piège du 13 oct.** : mon application réelle sur FacePro a été REFUSÉE deux fois par la plateforme (classifieur « Modify Shared Resources »), même après un accord général de Raphaël : une écriture en masse dans les données d'un vrai projet exige son autorisation PRÉCISE de la commande ; ne pas contourner (ni SQL direct, ni agent, ni hook lancé à la main). Le hook d'une vraie session FacePro l'a fait tout seul 3 min après la mise en ligne (journal `rapprochements`) : vérifier l'état réel avant de conclure que ce n'est pas fait. **Projets branchés au cockpit central** (13 oct.) : cockpit, facepro, melissa-nabet ; PAS branchés : Midrag, Trieur-Data, Pointeur-Robot-Campaign, Jarvis-assistant, melissa-nabet-site. **Preuve de la généralité** : FacePro fermé par le hook d'une vraie session 3 min après la mise en ligne ; `verifier-greffe.mjs` (projet branché de zéro : règle dans son contexte, collecteur lancé). `verifier-base` §57, `verifier-rapprochement.mjs`, `verifier-rapprochement.ts`, `verifier-rapprochement-ecran.mjs`, `verifier-web` (bloc « Chantiers et GitHub »).

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

## PR sans conflit : la carte n'arrive que quand la PR est prête (30 sept. 2026, chantier 6ef35b6e)

Raphaël : « à chaque fois il y a des conflits sur les branches […] envoie-moi les PR une fois les conflits réglés ». Cause : des agents en parallèle partent d'un main ancien (verifier-base, CLAUDE.md, migrations numérotées : trois 0041).
1. `scripts/pr-a-fusionner.sh` ne pose la carte que si GitHub dit `mergeable_state` = clean (ou unstable/blocked sans CI en échec ni en cours) ; sinon « PAS PRÊTE : <raison> », et une carte existante devenue caduque est retirée (réponse « PR #n pas prête », qui n'empêche pas de la reposer). Tests : `--merge-state`, `--ci`.
2. Les agents fusionnent `origin/main` dans leur branche JUSTE avant d'ouvrir la PR ; la passe de `chef.sh` lance un agent léger « Résoudre le conflit de la PR n » sur toute PR dirty/behind, puis rappelle le script ; quand une PR est fusionnée, les autres sont mises à jour avant d'être proposées.
3. À la source : la liste des contrôles de `verifier-base.mjs` est UN contrôle par ligne (en ajouter un = une ligne, à côté de son sujet), et `scripts/prochaine-migration.sh` donne le numéro libre (max des fichiers locaux et des branches distantes + 1 ; la base n'a pas de journal des migrations cockpit) : à appeler au moment d'écrire le fichier.
4. `verifier-base` §38 (carte selon la propreté) et §38 bis (numéro de migration).

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

## Déploiements par lots : éviter les surconsommations (5 oct. 2026, chantier 719e60e1)

Raphaël : Render, Copilot, Supabase… demandent des crédits à chaque redéploiement ; « le moindre correctif demande un redéploiement ». **Mesuré ici (lecture seule)** : dépôt public (Actions gratuit, vérifié `gh api`) ; 97 pushes sur `main` en 7 jours, `deploy.yml` lancé 133 fois au total ; 22 de ces 97 pushes ne touchaient ni `app/` ni `embed/` (donc rien à publier). Les fonctions Supabase ne se déploient jamais au push (manuel). **Non mesuré / inconnu** : plans, crédits et quotas de Render, Copilot, Supabase (illisibles d'ici), nombre de déploiements de fonctions déjà faits, et si un service Render est branché sur ce dépôt (aucune trace dans le dépôt). **Livré** : (1) `deploy.yml` filtre par `paths` (`app/**`, `embed/**`, lui-même), la concurrence annulant déjà les runs obsolètes ; (2) `deployer-fonction.sh` ne renvoie rien si les fichiers + `verify_jwt` sont identiques au dernier déploiement réussi depuis cette machine (empreinte dans `~/.cache/cockpit-deploiements`, `--force` pour passer outre ; limite : une autre machine ou l'outil MCP ne met pas à jour cette empreinte) ; (3) règle « une PR = une vague, une fonction déployée une fois en fin de lot » dans `chef.sh`, `renfort.sh`, `docs/bloc-CLAUDE.md`. Pas de compteur « déploiements évités » (rien d'existant ne le porte).

**Projet sur Render (14 oct. 2026, Trieur)** : quand seuls des fichiers du cockpit changent, la phrase d'exclusion de Render (« skip render » entre crochets) dans le MESSAGE de l'envoi évite le redéploiement (doc Render ; vérifié : événement `commit_ignored` sur les deux services, aucun déploiement). **Render la lit n'importe où dans le message** : un envoi qui devait déployer a été ignoré parce que je l'avais écrite dans une phrase qui disait de ne pas l'utiliser. Un message qui doit déployer ne la contient jamais ; un envoi ignoré à tort se relance à la main (outil Render `trigger_deploy`, du service concerné seulement : ici le site, pas l'API), puis on vérifie que le site sert le nouveau code. Le skill `cockpit` (dotfiles) le dit à l'étape 6.

## Un verdict dit dans une session arrive dans le cockpit (14 oct. 2026, migration 0086, chantier cff4fbb9)

Raphaël : quand il écrit dans une session « ça marche » / « ça ne marche pas » à propos d'un chantier livré, le cockpit ne le savait pas. Règle gardée : SEUL LUI certifie. `chantier.sh --verdict-dit <id> --marche|--ne-marche-pas --mots "<ses mots>"` → `relayer_verdict` (service) : ses mots dans le fil (message de session) ; « ne marche pas » = son bouton (`poser_verification`) ; « marche » = UNE carte « Tu confirmes que X marche ? » dans « À toi » (question à deux réponses prêtes, `messages.verdict_carte`) dont le « Oui » certifie d'un toucher (déclencheur `verdict_carte_repondue`, SEULEMENT un admin humain ; une session ou un membre non admin n'a aucun effet), le « Non » demande la vérification. La carte se ferme seule si le chantier n'est plus « à vérifier » ; sa réponse n'est jamais « à reprendre » (`est_reponse_automatique`). Reconnaissance : `hooks/prompt-rappel.sh` liste à chaque message les 5 chantiers « à vérifier » (id compris) et la consigne (bloc CLAUDE.md des projets). Limite : la session juge elle-même si une phrase est un verdict ; rien d'automatique sur le texte. `verifier-base` §58.
