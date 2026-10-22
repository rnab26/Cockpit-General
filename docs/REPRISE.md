# Reprise — où en est le cockpit, et quoi faire ensuite

**À lire en premier par toute session qui reprend le cockpit.** L'état vivant (chantiers, fil, qui travaille) est en base et arrive au démarrage (hook, ou `scripts/connecter.sh`) ; ce fichier dit le contexte et la suite. Les règles permanentes sont dans `CLAUDE.md` ; le récit complet des lots du 29 sept. au 19 oct. est dans `docs/historique/reprise-archive-sept-oct-2026.md` (à lire au moment de toucher au sujet, pas avant). Les décisions de Raphaël, mot pour mot : `rnab26/dotfiles/cockpit-kit/DECISIONS-2026-09-28.md`.

Dernière mise à jour : 22 oct. 2026.

## 0 septdecies. 22 oct. 2026 : le cockpit voit TOUTES les sessions, les réveils travaillent tous les projets

Demande de Raphaël : « une session FacePro tourne quasi constamment et aucune visibilité ; je veux que ça marche peu importe le dépôt ; que les réveils s'activent ; zéro autorisation ; supprime le superflu ; demain tout est lisse. »

**En ligne et prouvé (22 oct.)**
- **Session visible sans hook** : `connecter.sh` + `presence.sh` (signe de vie toutes les 2 min tant que le processus Claude existe) + battement machine (calculs, allumé par défaut, migration 0110) ; rattachement au projet demandé (0108, drapeau `rattacher`) ; relance par `sql.sh` après un recyclage de conteneur ; branchement implicite par le premier appel au cockpit (`COCKPIT_PROJET`). Preuve : la session FacePro de Raphaël (9342d930) apparaît dans FacePro, `en veille` / `au travail` mesuré. Banc : `verifier-presence` (19/19).
- **« Premier geste » en tête du CLAUDE.md** de chaque projet (`docs/premier-geste.md`, posé par `brancher.sh --premier-geste-seulement`) : mergé dans FacePro, Trieur, Melissa. Cockpit : voir le haut de son CLAUDE.md.
- **Réveil** : une règle, `cible_reveil_manuelle` (0109) ; « Activer une session » marche même sans chef vivante ; `add_repo` avec `access="push"` et chargé par ToolSearch (outil différé en routine) pour atteindre un autre dépôt. Preuve : le réveil de 10:32 a traité FacePro (chantier « Langue d'origine » passé « à vérifier »).
- **Fusions** : PR sûres + migrations seules + hooks `*.sh` se fusionnent seules (`fusion_auto.py`) ; `.gitattributes` : journaux `docs/historique/*.md` en fusion « union » (plus de conflit d'ajout).
- **Nettoyage** : hook utilisateur supprimé (jamais chargé en cloud), 15 projets de test oubliés purgés, CLAUDE.md 38 → 24 Ko, REPRISE.md 84 → quelques Ko.

**Pas prouvé / à surveiller**
- Un réveil réel APRÈS le correctif ToolSearch de `add_repo` (Trieur n'avait pas été atteint à 10:32).
- Une session neuve multi-dépôts qui obéit au « premier geste » (non testable ici : `create_session` ne prend qu'un dépôt).
- Les cartes « à vérifier » (28) attendent le verdict de Raphaël : seul lui certifie.

**Pièges payés ce jour** : ne jamais `pkill -f` avec un motif présent dans sa propre commande ; ne pas s'abonner aux PR (`subscribe_pr_activity`) quand on sonde de toute façon : chaque abonnement injecte ~9 000 jetons de consignes ; `sql.sh` enveloppe la requête dans `select json_agg(t) from (…) t` (jamais de colonne `t`).

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

