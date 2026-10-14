# Reprise — où en est le cockpit, et quoi faire ensuite

**À lire en premier par toute session qui reprend le cockpit.** Mis à jour à
chaque fin de lot. L'état vivant (chantiers, fil, qui travaille) est en base
et arrive tout seul au démarrage (hook) ; ce fichier dit le contexte et la
suite. Les décisions de Raphaël, mot pour mot :
`rnab26/dotfiles/cockpit-kit/DECISIONS-2026-09-28.md` (les lire aussi).

Dernière mise à jour : 13 oct. 2026 (sections 0, 0 bis, 0 ter, 0 quinquies et 0 sexies ci-dessous). Les sections 1 et
suivantes datent du 29 sept. : pour l'état à jour, la base et le CLAUDE.md du
dépôt font foi.

## 0. Lot du 13 oct. 2026 (00 h 30 – 01 h 40, heure d'Israël) — traité en lot, jetons économisés

Demande de Raphaël (depuis son téléphone) : traiter les chantiers qui attendent, vérifier que tout
fonctionne et que tout est branché, ne pas brûler ses jetons. Session chef : celle de sa demande.

**Vérifié (preuves : journaux de ce lot, fils des chantiers)**
- Site en ligne = `main` (`version.json` c6500bb35093), déploiement et CI verts, aucune PR ouverte.
- Base : 3 tâches pg_cron actives, 0 échec sur 1 h ; fonctions cockpit-embed v12, cockpit-mcp v2,
  cockpit-push v2 actives. Réveil immédiat vivant : un renfort demandé à 00:29:11 a ouvert une session
  de routine (pg_net 200, `routine_fire`).
- Bancs : app (tsc + build) et 46 suites pures ; clarté 12, correctifs 32, fusion 17 ; MCP 36 ; push 10 ;
  embed 147 ; emplacement 19 ; greffe 44 ; sessions hors ligne 12 ; réponses 64 ; renouvellement 19 ;
  base 820 (819 + 1 témoin ajouté, rejouée en entier après correction) ; web 477 ; bulle 42 ; vitesse 6 ; création 18 ; coûts 27 ; hors ligne 36.
- Trois bancs étaient rouges pour des raisons de TEST seulement (aucune régression du produit) et ont été
  remis d'équerre : `verifier-base` §44 (le titre « PR avec CI » est refusé par la règle de vocabulaire
  depuis 5084dfb : la carte n'était jamais posée), `verifier-web` (6 onglets, règle 0076, liens en boutons,
  message de création : le parcours s'arrêtait sur une exception et ~400 lignes de contrôles ne tournaient
  plus), `verifier-hors-ligne` (la file porte aussi des écritures internes, ex. `lu_fils` : le bandeau dit
  « 2 éléments » pour un message ; les contrôles ciblent maintenant NOS messages).

**Défaut réel trouvé (cause prouvée par le journal de la session de réveil)**
La session ouverte par le réveil immédiat (routine « ⚡ Cockpit — réveil immédiat ») n'a pas l'outil
`create_session` : elle ne peut pas ouvrir de renforts pour un AUTRE projet. Elle a mis en erreur les 4 renforts
FacePro (« outil create_session absent de la session relais »). `cible_reveil` envoie vers la chef relais (cockpit)
tant que la chef du projet n'est pas vivante, donc FacePro (sans réveil propre) ne démarre jamais seul ; la
protection anti-boucle a pausé ses ouvertures automatiques jusqu'à 06 h 29. Une session ouverte par Raphaël
(comme celle de ce lot) a `create_session`. Décision posée à Raphaël (carte « FacePro : aucune session ne
s'ouvre seule »), dans le fil du chantier « Chantiers qui ne se lancent pas seuls ».

**Consommation (mesurée avec `get_session`, coût théorique API, pas la facture de Raphaël)**
Les réveils récurrents relisent un énorme contexte à chaque fois, contre ~140 000 jetons par agent du lot :
passage horaire du chef cockpit (contexte 514 000, 155 réveils depuis le 6 oct., 91 M de jetons relus, ~48 $),
Trieur toutes les heures (741 000, 499 réveils), Jarvis sur Opus toutes les 6 h (399 000, dernier passage
« rien à prendre »), relance du quota toutes les 4 h (719 000, 79 réveils). Les cumuls en dollars (Trieur ~899 $,
Jarvis ~4 562 $, relance ~89 $) incluent le travail passé de ces sessions : ne pas les lire comme le coût des
seuls réveils. Un réveil neuf charge ~287 000 jetons dès son premier appel (mesuré) ; déduit : les CLAUDE.md
des 7 dépôts attachés à la routine. Raphaël a tranché le 13 oct. (matin) : COUPER. Fait : les quatre routines sont
en pause (rien supprimé) et le cockpit n'en recrée plus (migration 0078, `chefs.reveil_horaire`) : voir CLAUDE.md
« Réveils récurrents coupés ». Reste le réveil immédiat du cockpit (jeton).

**Petits défauts notés, non corrigés** (chantiers mis de côté)
- Une demande de renfort dont le travail a été fait ailleurs finit en « Jamais ouvert » (`renforts_expirer`,
  0062 ne traite que `actif`) ; la passe de la chef peut réserver pour ses agents les chantiers qu'elle vient
  de mettre dans un renfort automatique (`renforts_a_ouvrir` avant la réservation dans `chef.sh`). Fermé à la
  main par `renfort.sh --archive`.
- Le bandeau hors ligne compte les écritures internes (« lu jusqu'à ») comme des éléments à envoyer.
- 126 branches `agent/*`, 20 `renfort/*`, 18 `claude/*` jamais supprimées sur le dépôt distant.
- Le CLAUDE.md du dépôt pèse 122 Ko (~33 000 jetons) : chargé par chaque agent et chaque réveil.

**Pièges de méthode** : `list_triggers` rend ~11 000 jetons (préférer `get_trigger`) ; un agent « Vérifier » peut
rendre « bon » sur la lettre d'une étape alors que le problème de fond demeure (relire son verdict) ; une
session ouverte hors du dépôt n'a pas les hooks : elle se rend visible avec `suivre('cockpit', {"session_id":…,
"hook_event_name":"Vie"})`.

## 0 bis. Suite du 13 oct. 2026 (matin) : « simplifie, fais au plus simple » — accueil simple, demandes ≠ à tester, classer sans test

Demande de Raphaël : trop d'informations, 30 actions avant l'historique du chat, cartes sans sujet, rien de coordonné avec
ses sessions Claude, « le projet Cockpit n'est pas branché ». **Tout est dans `docs/accueil-simple.md`** (mesures, règles,
limites). En une phrase : « pour toi » ne compte plus que les demandes (69 → 13), une « Vue simple » à 3 blocs existe (au
choix : la vue par défaut reste l'écran complet avec ses boxes et ses barres, rétabli le jour même quand Raphaël a dit « j'en ai besoin »), le chat se
plie, les livrés non testés se classent d'un geste ou tout seuls (réglage, vide = jamais), et `scripts/connecter.sh`
branche une session sans hooks (cause du « débranché » : session ouverte sur plusieurs dépôts, cwd = `/home/user`) ; l'icône « branché » exige une vraie session.
**Vérifié** : verifier-web 477 (écran complet), bulle 42, hors ligne 36, création 18, coûts 27, vitesse 6, accueil 47,
connecter 11, base 842 (dont §56 : 15), 48 suites pures ; app tsc + build. **À constater par Raphaël** : l'écran sur son téléphone, un classement réel.
**Non fait** (voir le doc) : clôture des chantiers ouverts puis jamais terminés (piste : commits
poussés comme preuve), hook utilisateur (non vérifié : copie de `dotfiles/.claude/settings.json` ?), auto-fusion, CLAUDE.md de 122 Ko.

## 0 ter. Suite du 13 oct. 2026 (après-midi) : « mes chantiers ne sont pas à jour » — le cockpit lit git

Demande de Raphaël : un projet branché (FacePro), une session Claude qui travaille sur plusieurs sujets, des correctifs à tester qu'il a
avancés dans la session sans passer par l'app : « les anciens et les nouveaux chantiers ne sont pas actualisés ni coordonnés ».
**Tout est dans `docs/rapprochement-github.md`** (mesures, preuves, gardes, limites) et la section de même nom du CLAUDE.md. En une phrase :
un chantier ouvert que personne ne tient et dont le travail est PROUVÉ dans `main` passe « livré, à vérifier » tout seul (migration 0080,
`rapprocher_depot` + `scripts/rapprocher.py` lancé en fond par les hooks), une session vivante reçoit le rappel précis de ce qu'elle tient sans
trace depuis 4 h, et l'écran « Chantiers et GitHub » (Réglages du projet) montre l'état et l'interrupteur.
**EN LIGNE** (PR #129, version `336c5977d016`, 13 oct. 16 h 07 UTC) : rejoué sur le SITE RÉEL, écran de téléphone, projet jetable branché sur le vrai dépôt GitHub : `verifier-rapprochement-ecran.mjs` 14/14, `verifier-accueil.mjs` 53/53.
**Vérifié** : base 872/872 (complet, après tous les ajouts) dont §57 (31), web 486/486, `verifier-rapprochement.mjs` 51 (sabotage du collecteur : 6 contrôles rougissent ; ancien guillemetage : le passage échoue), 49 suites pures
(dont `verifier-rapprochement.ts` 20), greffe 44, app tsc + build. **Passage d'essai FacePro (lecture seule)** : 5 clôtures sûres proposées.
**Bloqué par la plateforme, pas fait** : l'application RÉELLE sur FacePro (classifieur « Modify Shared Resources », refusé deux fois, y compris après
« j'ai donné mon accord sur tout ») ; elle se fera toute seule à l'ouverture de la prochaine session FacePro une fois la PR fusionnée (le hook
lance le passage), ou par `python3 scripts/rapprocher.py --projet facepro` dès que Raphaël autorise cette commande précise. Aussi en attente de
son autorisation précise : classer sans test à 7 jours (réglage de projet), 3 clôtures à la main (« 8,8 $ » PR #64, « lèvres » PR #58, « oreille »
fusion e68212c), la carte « FacePro : aucune session ne s'ouvre seule ».
**EN LIGNE aussi** (PR #131 + dotfiles #4, version `51b79dd886bf`, 17 h UTC) : rejoué sur le site réel, écran 16/16, accueil 53/53 ; en local base 880/880, web 492/492, greffe 48/48, collecteur 55/55. **Généralisé le même jour (13 oct., « pas seulement lié à un seul projet », migration 0081)** : délais réglables par projet (écran « Chantiers et GitHub » › « Régler… »), interrupteur GÉNÉRAL (`regler_rapprochement(null, faux)`), seuils en constantes nommées, consigne ajoutée au bloc que reçoit chaque session (`docs/bloc-CLAUDE.md`), aux règles globales et au skill `cockpit` (dotfiles) ; `verifier-greffe` prouve qu'un projet branché de zéro reçoit la règle et lance le collecteur. **FacePro a été fermé tout seul** par le hook d'une vraie session à 16 h 09 UTC (les 5 chantiers du passage d'essai). Projets du cockpit central : cockpit, facepro, melissa-nabet ; non branchés : Midrag, Trieur-Data, Pointeur-Robot-Campaign, Jarvis-assistant, melissa-nabet-site.
**Non fait, noté dans le cockpit (section « Rapprochement GitHub », prêts à lancer)** : relayer les verdicts que Raphaël dit DANS une session (carte « tu confirmes ? » en un toucher, chantier cff4fbb9) ; écran pour annuler un rapprochement (chantier 7070ce60). La carte « FacePro : aucune session ne s'ouvre seule » : sa recommandation (un réveil dédié) date d'AVANT la coupure des réveils récurrents : à re-décider par Raphaël, pas appliquée.
**Le moteur est un projet comme les autres** (13 oct., soir ; Raphaël : « c'est lui le moteur qui va reproduire tout ce qu'on fait pour les projets branchés »). Vérifié en base : `cockpit` a un dépôt, le rapprochement allumé et ses propres hooks, mais `rapproche_at` était VIDE (déduit : aucune session à hooks ne s'est ouverte dans le dépôt depuis la mise en ligne, le dernier branchement vu datait de 09 h 00 UTC ; ma session, ouverte sur deux dépôts, n'a pas de hooks) ; son premier passage a eu lieu à 17 h 46 UTC via `scripts/connecter.sh` (2 chantiers examinés, aucun à fermer). Trouvé en le faisant : un `--essai` posait le repère de 20 min des hooks et faisait sauter le vrai passage suivant ; corrigé avec son test (échoue sur l'ancien code). Et ses sessions n'avaient pas les quatre gestes du bloc (le moteur n'a pas le bloc écrit par `brancher.sh`) : ils sont dans son CLAUDE.md, gardés contre une dérive par `verifier-rapprochement` §9.
**Aussi trouvé sur le moteur (13 oct., soir) : l'écran « Réveil automatique » mentait.** Il disait « Il manque le jeton du réveil / Coller le jeton » alors que le jeton existe (dernier réveil : HTTP 200). Vraie cause : aucune session chef n'est vivante nulle part, donc `cible_reveil()` est nulle et rien n'est tiré (`aucune_chef`). Corrigé par la migration 0082 (statut `sans_chef`, texte, bouton « Lancer une session autonome ») : voir la section « Filet de sécurité » du CLAUDE.md. **Pas décidé** : rouvrir une session tout seul quand aucune chef n'est ouverte (≈ 290 000 jetons à chaque fois) : à Raphaël, carte « FacePro : aucune session ne s'ouvre seule ». **EN LIGNE** (PR #134 puis #135, site en version `ddd8b89cef9c` à 18 h 14 UTC ; migration 0082 appliquée à la base à 18 h 15 UTC) : rejoué sur le VRAI projet « cockpit » du site, écran de téléphone, lecture seule : « Réveil automatique » dit « Bloqué : aucune session chef n'est ouverte » + « Lancer une session autonome », « Chantiers et GitHub » dit « À jour : dernier passage il y a 28 min » ; FacePro et melissa-nabet sont aussi en `sans_chef` (même cause). Vérifié : collecteur 59/59, filet 29/29, écran du filet 13/13, web 492/492, base §38 24/24, 49 suites pures. Le collecteur corrigé est servi par `raw.githubusercontent.com` (donc par le lanceur de tous les projets branchés, 10 min). Chantier du moteur : 721648a9 (« à vérifier »). Constaté aussi : une demande de renfort dont le chantier est déjà livré reste « demandée » puis tombera en « Jamais ouvert » au bout de 3 h (renfort 99e50148 du moteur, créé à 15 h 27 pour mon propre chantier) : chantier 4b0ea892 (reporté).

## 0 quater. Nettoyage du 13 oct. 2026 (soir), demandé par Raphaël avant ses tests

**Retiré (rien d'autre n'a été touché)** : 9 sessions de test du 29 sept. restées dans le VRAI projet « cockpit » (identifiants `test-…`, aucune
dépendance ; `restesDansLesVraisProjets` les compte désormais, banc §21) ; la demande de renfort 99e50148, périmée (son chantier était déjà livré,
`renfort_travail_restant` = 0 : elle aurait fait ouvrir une session pour rien ; geste documenté `renfort.sh --archive`) ; un `.pyc` suivi par erreur
(commit bab28a6) et `__pycache__/` désormais ignoré ; deux chemins faux de la doc ; une affirmation périmée (« le filet du moteur reste éteint » : il est
allumé sur les trois projets) ; mes 4 branches locales vides et 2 repères de cache de projets de test disparus.

**Vérifié, tout vert** (rejoué un banc à la fois, base 881/881 en 537 s) : syntaxe des scripts, `tsc`, 49 suites pures, clarté 12, sessions hors ligne 12,
réponses 64, greffe 48, rapprochement 59, connecter 11, renouvellement 19, correctifs 32, fusion 17, emplacement 19, embed 147, MCP 36, push 8 (des appareils
réels sont abonnés : le banc n'envoie rien), accueil 53, bulle 42, création 18, coûts 27, hors ligne 36, vitesse 6 ; sur le SITE EN LIGNE : réveil 13/13 et
rapprochement 16/16 ; `verifier-web` 492/492 plus tôt dans la journée (même code d'app). Après la série : 0 projet, ligne, session, fichier de test ; file
d'attente locale vide ; les 4 tâches planifiées de la base actives, 0 échec sur 3 h.

**Constaté, PAS touché** : 47 lignes de progression « en cours » abandonnées (35 FacePro, 12 moteur, depuis le 29 sept.), invisibles dans l'app (elle exige un
signe de vie récent) : chantier 4267e6a8 (mis de côté ; ne JAMAIS les passer en « termine », `livre_sans_suite` lit ce statut) ; 174 branches distantes de
Cockpit-General dont 131 déjà dans `main` (hors sessions, sauvegarde, déploiement) : suppression = accord de Raphaël, carte posée, les 37 non fusionnées ne se
touchent pas sans lui ; 6 numéros de migration en double (0033, 0038, 0046, 0052, 0059, 0060), aucune fonction redéfinie par les deux fichiers d'un même numéro,
donc sans risque pour un rejeu ; 16 chantiers FacePro « en cours » que personne ne tient (du travail à relancer, pas de la saleté) ; 11 cartes FacePro à lui.
**Déduit, non vérifié** : le CLAUDE.md global du compte (`/root/.claude/CLAUDE.md`) est pris des dotfiles au démarrage d'une session ; les trois règles ajoutées
aux dotfiles aujourd'hui n'arrivent donc qu'aux NOUVELLES sessions.

## 0 quinquies. Les reçus Claude dans Coûts (13 oct. 2026, soir) : « Configure-le que ce soit constant »

Chantier `72a8d0f4`. Procédure complète, garde-fous, coûts mesurés, voie gratuite : **`docs/recus-par-email.md`** (à lire avant d'y toucher).

**Fait et vérifié** : migration 0083 appliquée (colonnes `services.import_*`) ; `scripts/importer-recus.py` + `scripts/verifier-recus.mjs` 49/49 (projet jetable, aucun reste) ;
carte du prestataire (ligne « Import automatique des reçus », date de départ dans le crayon) : `verifier-depenses.ts` 30/30, `verifier-depenses.mjs` 36/36 sur écran de téléphone ;
les 7 reçus de Raphaël (juillet à octobre, lus dans sa boîte avec son accord) se lisent avec le lecteur sur leurs vrais textes ; seul le PDF du plus récent était encore
téléchargeable (les liens Stripe expirent : valable à 11 jours, expiré à 33 ; liens jamais modifiés pour contourner).

**Pas fait, et pourquoi** : (1) la routine hebdomadaire existe (`trig_01HViAL4dDqkdXTKmjrRmHJ8`) mais est **EN PAUSE** : elle n'a aucun connecteur Gmail (`create_trigger` refuse `connectors`
pour cette organisation ; l'essai à blanc a montré une session sans outil `mcp__`, avec dépôt clonable, clé de base présente, python3 et pdftotext) ; il faut le geste de Raphaël dans
claude.ai/code/routines › Edit › Connectors, **et sa décision** : un connecteur Gmail donne à la routine tous ses outils (envoi compris) sans permission, seul son texte l'en empêche. Alternative sans
ce risque ni jetons : un petit programme dans son compte Google (Apps Script), à construire. (2) L'historique des 7 reçus est dans Coûts (673,33 ₪ et 15,60 $, PDF du plus récent seulement) depuis le soir du 13 oct. : la plateforme avait refusé l'écriture (« Modify Shared Resources »)
jusqu'à ce que Raphaël envoie sa phrase PRÉCISE (commande et cible) ; mon premier SQL (un `with … insert`) était en plus refusé par la base : un `insert … select … ;` simple a passé.
**Piège** : un passage réussi de la routine écrasera le battement « échec » que j'ai posé volontairement (la carte du prestataire Claude dit aujourd'hui, vrai, que la tâche n'a pas accès à Gmail).
**Effet de bord de l'essai** : la session d'essai a envoyé une notification sur le téléphone de Raphaël (« Import impossible… »), parce que le dépôt n'était pas encore fusionné.

## 0 sexies. Le bouton « Chercher mes fournisseurs » (13 oct. 2026, soir) — chantier `07258fe5`, migration 0084

Raphaël : « une recherche par mots-clés plutôt que de lire toute la boîte mail » et « un bouton où j'appuie et ça va chercher tous les noms des fournisseurs où je suis susceptible d'avoir des
factures, et comme ça on actualise ». Procédure : `docs/recus-par-email.md` › « Chercher les fournisseurs ». Bloc `RechercheFournisseurs.tsx` en tête de Coûts ; tables
`recherches_fournisseurs` (UNE demande ouverte par projet) et `fournisseurs_detectes` ; `scripts/chercher-fournisseurs.py` ; les hooks préviennent une session qui a Gmail.
**Fait pour de vrai** : première recherche par mots-clés sur la boîte de Raphaël (3 appels `search_threads`, aucun mail ouvert) → 94 mails, 24 fournisseurs « nouveaux » enregistrés dans Coûts du projet `cockpit` (à lui de « Suivre » ou « Ignorer » : beaucoup de bruit, banques, virements reçus, versements de plateformes).
**Vérifié** : `verifier-fournisseurs.mjs` 50/50, `app/scripts/verifier-fournisseurs.mjs` 37/37 (téléphone, avec « Choisir plusieurs »), `verifier-fournisseurs.ts` 28/28 ; un vrai défaut trouvé par le banc écran et corrigé (la liste se
repliait toute seule quand on ignorait le dernier « nouveau »). **Limite** : l'écran n'ouvre pas de session ; sans session qui a Gmail la demande attend. **Piège** : la recherche ne lit JAMAIS un mail
(`search_threads` seulement : expéditeur, date, objet) ; ne pas ajouter de `get_thread` « pour être plus précis ».

## 0 septies. Le Trieur de Data est branché, avec son bouton « Demandes » (14 oct. 2026) — chantiers `8c1e730f` (défaut du moteur) et `04e4bcdc` (bouton)

Raphaël : « brancher un projet à moi sur le cockpit, étape par étape » → le Trieur (`rnab26/Trieur-Data`, projet `trieur-data`, « Trieur de Data »). Skill `cockpit` : quatre choix posés d'un coup (nom, reprise des chantiers,
mise en ligne, mode autonome : non), puis tout fait. **Fait et vérifié** : `brancher.sh` (settings.json valide, l'ancien hook de démarrage du Trieur est gardé à côté du nôtre), hook lancé pour de vrai, 3 chantiers
ouverts côté Trieur = 3 repris en base (rangés par `cockpit-chantier.sh --ranger`, commandes du Trieur testées), branche `claude/cockpit-trieur-data` fusionnée sur `main` avec `[skip render]` dans le message : Render a
enregistré « commit ignoré » pour ses deux services `main` (`list_events`), aucun déploiement. **Défaut trouvé et corrigé** : l'étape 5 de `brancher.sh` (questionnaire d'emplacement) a été refusée par le filtre de
clarté parce que le texte du choix « menu » citait `frontend/src/App.tsx` ; `analyser-depot.py` ne cite plus de chemin, `verifier-emplacement.mjs` couvre front / frontend / backend / runtime (rouge 4 KO → vert 25/25).
**Pièges** : (1) des appels d'outil lancés en parallèle partagent le dossier courant : un `cd` dans l'un change l'autre (une vérification du Trieur a lu le dépôt du cockpit) ; chemins absolus et `git -C`.
(2) Le dépôt du Trieur a été renommé (`Trieur-Data` avec majuscules) : GitHub redirige l'ancienne adresse ; `brancher.sh` met le dépôt en minuscules en base (`rnab26/trieur-data`), sans conséquence. (3) `[skip render]` : Render
la cherche n'importe où dans le MESSAGE, pas seulement sur la première ligne : un envoi qui devait déployer a été ignoré parce que je l'avais écrite dans une explication (« pas de [skip render] ») ; mise en ligne lancée à la main
(`trigger_deploy`, site seul, l'API n'avait pas changé), puis site en ligne vérifié. (4) Le mode autonome du Trieur est « tout le temps » parce que Raphaël l'a allumé lui-même dans l'app (journaux de la base : deux appels
à `regler_autonome` depuis son compte, 08:19) après avoir répondu « non » au bilan : son geste prime, on ne l'éteint pas à sa place.
**La suite, après sa remarque** (« on n'est pas censé pouvoir le mettre directement en copier-coller quand on ajoute un projet ? » ; décision D-16 dans dotfiles) : le bouton n'était pas à cadrer, il fallait le poser. Fait : composant
`CockpitCentral` du Trieur (comptes administrateurs seulement, la règle de son onglet Cockpit ; bouton « Demandes » dans le menu à partir de 640 px, bouton flottant du module en dessous), menu du Trieur qui ne déborde plus sur
téléphone (494 px sur 390, défaut qui existait avant : rangée d'onglets qui défile), `tests/test_cockpit_central.py`, 33 contrôles dans Chromium sur le build puis sur le VRAI site (comptes simulés, API et base interceptées).
Skill `cockpit` étape 5 réécrite (dotfiles, PR 5). **Reste** : (a) « Copier le code » de l'app donne encore une balise « page » sans tenir compte de l'emplacement choisi (chantier `949ed6d7`, prêt à lancer) ; (b) garder ou remplacer l'écran Cockpit
intégré du Trieur (décision de Raphaël) ; (c) l'ancien hook de démarrage du Trieur liste les mêmes 3 chantiers que le cockpit ; (d) **non vérifié** : un vrai compte administrateur du Trieur (aucun identifiant côté session).

## 0 octies. « Les réglages de Melissa ne sont pas bons, les projets ne sont pas branchés » (14 oct. 2026) — chantier `a225351a`

Raphaël (captures de Melissa Nabet, réglages + liste des projets) : « pourquoi les réglages du projet de Melissa sont pas bons ? et pourquoi les projets ne sont pas branchés ». **Causes PROUVÉES.**
(1) *Melissa* : le branchement du 29 sept. (un seul commit `0c24ea2`, 14 fichiers, branche `claude/cockpit-setup-oyrkl9`) n'a jamais été fusionné sur `main` (`git merge-base --is-ancestor` faux ; base = un vieux `main`, `ebca66f`). Sa `main` n'a que son propre
hook `session-start.sh` : aucun `cockpit-*.sh`, aucun bloc cockpit dans son CLAUDE.md. Toute session ouverte sur `main` démarre donc sans cockpit (dernier démarrage du hook : 29 sept., une seule ligne de session de 0 min). Le module n'a jamais été installé
(`embed_vu_at` nul : le questionnaire d'emplacement n'existait pas à ce branchement, 0 carte posée) ; le collecteur GitHub n'a jamais tourné (`rapproche_at` nul : il part des hooks) ; 0 chantier repris (son ancien tableau en a 105 : 87 livrés, 17 à faire, 1 en partie livré).
(2) *Bandeau rouge « mise en ligne échouée »* : FAUX. Le site sert exactement `main` (`index.html` identique octet pour octet, 839 787 octets ; `site-vitrine/` en 404 sur le domaine du CRM = l'artefact du workflow du projet). L'« échec » est la tâche INTERNE de GitHub
« pages build and deployment » (exécution 14 du 5 oct. : build Jekyll réussi, job `deploy` annulé après 15 min), qui vise la même destination que le workflow du projet « Deploy to GitHub Pages » (réussi sur le même commit, après 10 min 30 ce soir-là) ; les deux se sont annulées l'une l'autre le 5 oct. (exécutions 12 et 13 « annulées » ; groupe de
concurrence `pages` commun : déduit, non lu pour la tâche interne). Plus aucun envoi sur `main` depuis le 5 oct. : ce dernier passage restait « le dernier » depuis 8 jours.
(3) *Trieur* : branché et prouvé (hook lancé à la main depuis son dépôt à 08:20 ; module chargé par le vrai navigateur de Raphaël à 09:15) mais AUCUNE ligne dans `sessions` : depuis le 13 oct. l'icône exige une vraie session ; elle s'allume à la première vraie session ouverte sur le Trieur.
**Corrigé, général (aucun réglage par projet)** : `lib/deploiement.ts::pagesInterneSansEffet` (UNE règle : l'échec ou l'annulation de la tâche interne de GitHub est sans effet quand une autre mise en ligne du projet a réussi sur le même commit ou après ; jamais masqué : tâche
interne encore en cours, échec d'un workflow du projet, recopie du site vitrine) ; `lib/branchement.ts::lireCockpitSurMain` + `hooks/useCockpitSurMain.ts` (lecture anonyme de `.claude/settings.json` sur `main` : `COCKPIT_PROJET` = installé ; le 404 d'un dépôt privé = « inconnu », jamais
deviné ; seulement admin et même propriétaire que le moteur, car les voies « invisible » et « branches » n'ont, par choix, rien sur `main` ; dit aussi « pas sur main » quand une session vient de se brancher sur une branche de travail) ; `etatBranchement` applique la MÊME règle que l'icône (vraie session) et dit la cause avec la phrase « branche le cockpit » ;
le texte de « Réveil immédiat » ne parle plus d'un passage horaire qui n'existe plus. Preuves : `verifier-deploiement.ts` 37/37 (13 cas neufs), `verifier-branchement.ts` 40/40, les 51 bancs purs verts, rejeu sur les 30 exécutions RÉELLES de Melissa (avant : le message de la capture ; après : « En ligne —
dernière mise en ligne réussie il y a 8 j »), sur les quatre vrais dépôts (Melissa absent, Trieur présent, cockpit présent, FacePro inconnu = privé) et sur l'écran réel d'un téléphone (390 px). **Limites** : lecture anonyme = dépôts publics seulement ; la branche principale est supposée `main` (comme l'écran de mise en ligne) ;
« pas installé » n'est dit que pour un dépôt public dont le fichier est lisible sans le cockpit, ou absent ; GitHub garde `raw.githubusercontent.com` en cache 5 min (`cache-control: max-age=300`) et l'écran relit au plus toutes les 10 min :
après une fusion sur `main`, la ligne peut mettre jusqu'à ~15 min à passer de « pas installé » à « bien installé » (constaté : lue « absente » 10 s après la fusion de Melissa, « présente » 1 min plus tard).
**Melissa, rebranchée le jour même (réponses de Raphaël : reprise des 18 = oui, sur `main` = oui, autonome « tout le temps »)** : `brancher.sh` sur `claude/cockpit-melissa-nabet` depuis `main` (répété d'abord sur une COPIE avec `--maj`, sans base :
settings.json valide avec SON hook gardé à côté du nôtre, `scripts/sql.sh` intact), commit `0957a5c`, fusion `7158b96` sur `main` (preuve : `git ls-remote origin refs/heads/main` = le HEAD local), 18 chantiers repris (2 libres, 9 à cadrer, 7 bloqués : une action de Raphaël, du contenu de Mélissa
ou une dépendance), 18/18 rangés par rubrique + un 19e chantier « Poser le bouton du cockpit dans le CRM (après tes 2 réponses) », bloqué sur ses réponses, pour que la pose de la balise ne se perde pas ; mode autonome allumé (`regler_autonome`, plafond 20, s'éteint seul après 3 h sans rien à prendre). Son `CLAUDE.md`, son hook de démarrage et `docs/journal.md` ne désignent plus l'ancien tableau comme source de vérité (UNE seule source).
Questionnaire d'emplacement posé (carte « Où le cockpit de Melissa Nabet doit-il apparaître ? », recommandé : bouton dans le menu, pour l'équipe) ; **la balise n'est pas posée** : elle attend ses deux réponses (`scripts/cockpit-emplacement.sh --projet melissa-nabet --balise`). Le CRM est une page unique de 840 Ko (`index.html`) avec connexion :
le bouton ne doit exister que pour les comptes de l'équipe (modèle : `CockpitCentral.tsx` du Trieur). La prise verte reste éteinte jusqu'à la première VRAIE session sur le dépôt (hook lancé à la main deux fois : preuve du branchement, pas une session).
**Trouvé en route, NON corrigé (réglage du dépôt de Melissa, décision de Raphaël)** : GitHub lance DEUX mises en ligne à chaque envoi sur `main` : le workflow du projet (« Deploy to GitHub Pages », qui retire `site-vitrine/` avant de publier) et sa tâche interne « pages build and deployment » (vu : elle revient dans les exécutions depuis le 5 oct., après deux mois sans ;
**déduit, non lu** : la source Pages est redevenue « une branche », l'API des réglages Pages étant refusée à la session). Elles se disputent la même adresse : la dernière arrivée gagne (constaté ci-dessous). Après la fusion du 14 oct., c'est la tâche interne qui a fini en dernier (09:52:44 contre 09:52:21) : `site-vitrine/index.html` répond 200 sur l'adresse du CRM (404 avant), le CRM lui-même est intact (`index.html` identique octet pour octet).
Les pages du studio sont publiques par ailleurs (aucun secret), mais ce n'est pas voulu (commentaire de `pages.yml`). Remède permanent : Réglages du dépôt › Pages › Source = « GitHub Actions » (`PUT /repos/…/pages` est refusé par le proxy de la session : action de Raphaël) ; ou, sans aucun clic, un `_config.yml` avec `exclude: [site-vitrine]` dans le dépôt (la tâche interne publierait alors la même chose).
**Banc** : `verifier-web.mjs` simule maintenant la lecture des réglages de `main` (sans ça, le dépôt de test fait un 404 dans la console : 491/492 à la première passe, c'était MON code) et vérifie la ligne « pas installé sur la branche principale ».

## 1. Ce qui est EN LIGNE et vérifié (état du 29 sept.)

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
node app/scripts/verifier-web.mjs      # parcours réel, écran de téléphone
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

## 2 septdecies. 30 sept. : « il faudrait aussi X » dans un fil → chantier créé et rangé (chantier `7b85b3bd`, migration 0033)

- `chantier.sh --ouvrir … --depuis <id du fil | projet> [--reponse] [--section]`
  → `ouvrir_depuis_fil` : créé « Prêt à lancer » non réservé, rangé, ou
  demande ajoutée au chantier vivant existant (sans rien lui arracher) ;
  réponse dans le fil d'origine avec bouton « Ouvrir ce fil »
  (`messages.chantier_lie`). Consignes mises à jour (chef « Répondre »,
  relais, suivi, démarrage, bloc CLAUDE.md). `verifier-base` §31.
- non fait : le module embarqué (`embed/`) n'affiche pas le bouton de fil
  lié ; côté SESSION (il tape « il faudrait aussi X » dans la session), on
  garde `--ouvrir` sans `--depuis` (la session le tient).

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
