# Hook utilisateur : une session ouverte sur plusieurs dépôts se branche toute seule

19 oct. 2026, chantier cff4fbb9. Raphaël : « j'ai une session FacePro qui tourne et ça ne s'affiche pas dans Ça avance ».

## Cause (prouvée le 13 oct., revue le 19)
Les hooks d'un projet vivent dans le `.claude/settings.json` de SON dépôt ; ils ne se chargent que si la session démarre dans ce dépôt.
Une session cloud ouverte sur plusieurs dépôts démarre dans `/home/user` : aucun hook, donc ni état dans le contexte, ni session dans l'app, ni réponses en direct. Dans l'environnement de Raphaël, TOUS ses dépôts sont clonés dans `/home/user`, chacun sur une branche `claude/…-<suffixe>` : le disque ne dit pas quel est le sujet de la session.

## Ce qui est livré
- `hooks/utilisateur.sh` (arrive dans le cache des sessions par `modeles/fichiers.txt`, comme tous les hooks) :
  - se tait si `COCKPIT_PROJET` est posé ou si la session est née dans un dépôt branché (jamais de doublon) ;
  - un seul dépôt branché : rejoue SES hooks (ceux de son `.claude/settings.json`, pour l'événement reçu) avec `CLAUDE_PROJECT_DIR`, `COCKPIT_PROJET` et son `env` ;
  - plusieurs : choisit sur des SIGNES, jamais au hasard : choix déjà gardé (`$COCKPIT_HOME/sessions/<id>.depot`, posé aussi par `connecter.sh`), dossier courant ou fichier touché dans UN dépôt, message de Raphaël qui nomme UN seul projet. Sans signe : silence, et un seul message au démarrage qui donne la commande exacte. Le choix tient pour toute la session ;
  - ne fait jamais échouer ni ralentir (sortie 0) ; `COCKPIT_UTILISATEUR=off` l'éteint.
- `scripts/connecter.sh --projet <slug> --depot <dossier>` : branche à la main le projet voulu ET fixe le choix pour les hooks utilisateur.
- `docs/hook-utilisateur-settings.json` : le bloc à poser dans les réglages UTILISATEUR (`rnab26/dotfiles`, `.claude/settings.json`). Il télécharge `hooks/utilisateur.sh` (cache de 10 min) puis l'exécute sur SessionStart, UserPromptSubmit, PostToolUse et Stop.
- Banc : `node scripts/verifier-utilisateur.mjs` (hors ligne, faux dépôts).

## Limites (dites, pas masquées)
- NON VÉRIFIÉ : que Claude Code cloud charge `~/.claude/settings.json` venu des dotfiles. `~/.claude/CLAUDE.md` et `~/.claude/skills` y sont bien synchronisés depuis les dotfiles ; un `settings.json` n'y est pas (aucun présent ici). La preuve se fait en ouvrant une session neuve sur plusieurs dépôts : le premier message doit faire apparaître la session dans « Ça avance ». Sinon `connecter.sh` reste le recours.
- Avant le premier signe d'une session multi-dépôts, elle n'est pas visible (le premier message qui nomme le projet, ou le premier fichier touché, la branche).
- Un message qui nomme deux projets n'en choisit aucun. Un choix fait ne change plus (relancer `connecter.sh --depot` pour le changer).

## Constat du 20 oct. 2026 (à lire avant tout)
VÉRIFIÉ : une session cloud n'a pas de `~/.claude/settings.json` utilisateur (seulement `launcher-settings.json` posé par la plateforme, hook Stop, et `remote-settings.json` vide). Ce hook n'a donc jamais pu se charger. Voie qui marche : `connecter.sh` demandé par le CLAUDE.md des dépôts joints, avec `presence.sh` (voir CLAUDE.md, « Session sans hook »).
