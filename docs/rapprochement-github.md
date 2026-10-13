# Chantiers à jour d'après GitHub (13 oct. 2026, migration 0080, chantier 6f112d51)

Raphaël, 13 oct. : « un projet branché comme FacePro, une session Claude qui bosse dessus sur plusieurs sujets : est-ce que je
suis censé voir sa progression, et ses chantiers doivent être créés, fusionnés, mis à jour automatiquement dans le cockpit du
projet ? […] j'ai plein de correctifs passés que je dois tester, vérifier, valider ou envoyer à corriger, mais j'ai avancé sur
une session Claude en parallèle, parce que le code PIT n'était pas fonctionnel pour moi. Mes chantiers ne sont pas à jour : les
anciens et les nouveaux ne sont pas actualisés ni coordonnés. »

**Réponse : oui, il doit les voir.** Le cockpit ne le faisait que si la session pensait à le dire ; il croyait ce que les
sessions DÉCLARENT. Il lit maintenant ce qu'elles ONT FAIT (git), et il fait confiance à git plutôt qu'à la mémoire d'une session.

## Ce qui était cassé (mesuré sur la base, FacePro, 13 oct.)

- 72 chantiers non archivés : 26 « en cours », 2 « libre », 1 « bloqué », 6 reportés, **37 « à vérifier »**.
- Les 29 ouverts : **19 sans personne dessus et sans question en attente**, 5 tenus par une session vivante, 5 qui attendent
  une réponse de Raphaël. Seulement 4 avec une trace du jour, 3 sans trace depuis plus de 7 jours.
- Les 37 « à vérifier » : **27 n'ont aucun mot de Raphaël (message ou réponse à une carte) depuis leur livraison**, 12 sont livrés
  depuis plus de 7 jours, 4 seulement portent un verdict (« ça ne marche pas » 2, « je ne sais pas » 2).
- Causes (prouvées sur les fils et sur git) : (1) une session ouvre un chantier mais ne le ferme pas quand elle s'arrête ;
  (2) Raphaël teste et tranche DANS la session Claude, pas dans l'app : le cockpit ne le sait jamais ; (3) depuis le 9 oct.
  FacePro travaille directement sur `main` (plus de PR après la #80) : les cartes de PR ne couvraient plus rien ; (4) de longues
  sessions multi-sujets sur une seule branche : plusieurs chantiers y sont ouverts, aucun n'est refermé.

## Ce qui est livré

1. **Le rapprochement** (SQL, une règle : `cockpit.rapprocher_depot`). Un chantier OUVERT, que plus personne ne tient (aucun
   signe de vie depuis `delai_signe`), qui n'attend pas Raphaël, dont le travail est PROUVÉ dans `main`, passe « livré, à
   vérifier ». Jamais « validé » (seul Raphaël). Il est livré À LA DATE DE LA FUSION, sa réservation est rendue, son fil dit
   « Livré, d'après GitHub : <preuve>. Si ce n'est pas le cas, touche « Ça ne marche pas » », « Comment vérifier » donne le lien
   GitHub exact, sa barre est fermée, et une ligne du journal (`rapprochements`) garde la preuve (`annuler_rapprochement(id)`
   remet l'état d'avant).
2. **Le collecteur** (`scripts/rapprocher.py`) lit git et pose les faits. Aucune règle n'y est : il ne fait que transmettre.
   Un petit clone SANS fichiers (commits et arbres seulement) est gardé dans `~/.cache/cockpit-general/depots/<projet>` : la
   copie de travail de la session n'est ni lue ni modifiée. Le texte des commits et des PR vient de git (donc parfois d'autrui) : il est
   rangé dans la requête avec un délimiteur aléatoire vérifié absent du texte, jamais exécuté.
3. **Les hooks** (`session-start.sh`, `prompt-rappel.sh`) lancent le collecteur en tâche de fond, au plus toutes les 20 min par
   projet, 170 s maximum, jamais bloquant. Arrivé par le lanceur à TOUS les projets branchés dès que c'est sur `main`
   (`modeles/fichiers.txt`).
4. **Le rappel précis** : une session VIVANTE n'est jamais court-circuitée. `prompt-rappel.sh` lui liste les chantiers qu'elle tient
   sans aucune trace depuis plus de 4 h, et lui dit quoi faire pour CHACUN : `--termine`, `--etape`, ou `--de-cote` / `--abandonner`
   (`cockpit.chantiers_tenus_sans_trace`). Au plus un rappel toutes les 30 min par copie de travail (`COCKPIT_SANS_TRACE_MIN`, 0 = à
   chaque message) : le texte est long et part avec les messages, il ne doit pas gonfler le contexte.
5. **L'écran** : Réglages du projet › « Chantiers et GitHub » (`RapprochementGithub.tsx`) : le rôle en une phrase, l'état (jamais
   passé / à jour / dernier passage ancien / **échec avec sa cause** / éteint), « Éteindre » / « Rallumer », erreur de lecture avec
   « Réessayer ». Un passage qui échoue (git injoignable, clone impossible…) est noté en base (`projets.rapproche_erreur`,
   `noter_echec_rapprochement`) et effacé par le passage réussi suivant : sans cela l'écran dirait « pas encore passé » pour toujours.
   La cause est masquée avant d'être écrite ou affichée (identifiants d'adresse, jetons GitHub, clés : `masquer()`).

## Les preuves, dans l'ordre (la première qui joue l'emporte)

Gardes communes : chantier ouvert (`en_cours`, `libre`, `a_trier`, `bloque`), jamais archivé, sans signe de vie, sans question en
attente (`attend_raphael`), et **personne n'en a parlé APRÈS la livraison** (le dernier mot du fil, hors lignes automatiques, ne
dépasse pas la date de fusion de plus de 30 min).

| Règle | Preuve | Gardes en plus |
|---|---|---|
| `jalon` | le commit que la session avait elle-même signalé « envoyé » (`--pousse`) est dans `main` | chantier `en_cours`/`bloque` (un « libre » a été rendu par le balayage) ; aucun travail signalé APRÈS ce dernier envoi |
| `branche` | le travail de CODE de sa branche (jamais journal, notes, docs), fait depuis la création du chantier jusqu'à sa dernière trace, est dans `main` | branche dédiée : aucun autre chantier ouvert ne la tient |
| `branche` (PR) | une PR venue de sa branche est fusionnée après sa dernière trace | — |
| `identifiant` | le TITRE ou le message d'une PR fusionnée cite les 8 premiers signes de son identifiant | une simple mention dans un commit ne suffit jamais |
| `titre` | le titre d'une PR fusionnée ressemble à ce chantier (≥ 0,6, même mesure que la fusion suggérée) et à AUCUN autre ouvert (≥ 0,5) | fusionnée dans les 21 jours qui suivent sa création |

Ce que le rapprochement ne fait JAMAIS : poser « validé » ; toucher un chantier tenu par une session vivante ; toucher un chantier
qui attend une réponse de Raphaël ; livrer sur une mention, sur un titre ambigu, sur une branche partagée par deux chantiers, sur
une branche non fusionnée, sur du journal seul ; rien supprimer.

## Réglages et défaire

- **Éteindre** pour un projet : l'écran « Chantiers et GitHub », ou `select regler_rapprochement('<slug>', false)`. Ça arrête les
  passages des hooks ; un passage lancé à la main (`python3 scripts/rapprocher.py --projet <slug>`) écrit toujours.
- Éteindre sur une machine : `COCKPIT_RAPPROCHEMENT=0`.
- **Défaire** : un chantier passé « livré » à tort se renvoie en correction avec « Ça ne marche pas » (même geste que n'importe quelle
  livraison) ou se classe avec « Classer sans test » ; côté base, `annuler_rapprochement(<id du journal>)` rend l'état d'avant
  (en cours, réservation, jalon). Pas d'écran pour ce dernier geste.
- Passage d'essai : `python3 scripts/rapprocher.py --projet <slug> --essai` (ou `--json`) dit ce qui SERAIT livré, sans rien écrire.

## Ce qu'il ne fait pas (limites dites)

- **Un chantier dont le travail n'est ni dans une PR, ni un jalon « envoyé », ni sur une branche dédiée** (par exemple des
  commits directs sur `main` sans jamais signaler le chantier) ne peut pas être prouvé : il reste ouvert. Aucune devinette.
  Sur FacePro, 14 des 19 chantiers ouverts sans session sont dans ce cas : seul Raphaël (ou la session qui y a travaillé) peut dire.
- **Le verdict dit dans une session** (« ça marche ») n'est pas lu par le cockpit. Décision à prendre par Raphaël : relayer ses
  mots dans le fil comme une carte « tu confirmes ? » en un toucher, ou garder le bouton de l'app seul.
- Le rapprochement ajoute des chantiers « à vérifier » : sans le classement automatique (« Classer sans test », réglable, vide =
  jamais), la pile à tester grossit. Recommandation : 7 jours.
- La règle `titre` est la plus faible (seuil mesuré sur FacePro) ; une erreur est visible dans le fil et se défait.
- La règle `branche` prouve que du CODE de la branche du chantier, écrit pendant sa vie, est dans `main` ; pas que c'est le code de CE sujet
  (une longue session multi-sujets peut y mêler d'autres travaux). Garde-fou : une seule fiche ouverte doit tenir la branche, et le chantier
  passe « à vérifier » (jamais « validé ») avec la preuve dans son fil. Aucun chantier FacePro n'a été proposé par cette règle au passage d'essai.
- Fenêtre : 60 jours d'historique au plus, 150 s de budget par passage. Il faut `python3`, `git` et l'accès à GitHub depuis la
  session (déduit : un dépôt privé exige les identifiants git de la session ; non vérifié ailleurs que sur FacePro).

## Bancs

- `node scripts/verifier-base.mjs` §57 (31 contrôles) : la règle sur des faits fabriqués (chaque preuve, chaque garde, écritures,
  journal, annulation, échec noté puis effacé, droits).
- `node scripts/verifier-rapprochement.mjs` (51) : le collecteur sur de VRAIS dépôts git temporaires (origine « comme GitHub »,
  copie de travail de session, PR fusionnées, branche supprimée, squash, journal seul, branche non fusionnée, commit inconnu),
  essai sans écriture, copie de travail intacte, `--si-ancien`, réglage éteint, pannes (échec noté, secrets masqués, texte de PR piégé
  inerte), et les deux hooks (collecteur lancé en fond, rappel précis limité à un par 30 min). Testé par sabotage : un collecteur qui prend le journal pour du code ou ne vérifie pas `main` fait rougir 6 contrôles ; l'ancien guillemetage de la
  requête (un texte de PR piégé `$fa$faits$its$` en fabriquait la fin) fait échouer le passage entier, d'où un délimiteur aléatoire vérifié.
- `node --experimental-strip-types app/scripts/verifier-rapprochement.ts` (20) : les mots de l'écran, échec compris.
- `node app/scripts/verifier-web.mjs` : « Chantiers et GitHub » dans les réglages du projet (rôle, état, échec, éteindre/rallumer, toasts).
- `node app/scripts/verifier-rapprochement-ecran.mjs` (14) : de bout en bout sur écran de téléphone, projet jetable branché sur le VRAI dépôt
  GitHub : le collecteur passe « à vérifier » le chantier dont le commit est dans `main`, laisse l'autre, l'écran dit « À jour » puis
  l'échec en rouge ; `BASE_URL=https://rnab26.github.io/Cockpit-General/` rejoue le même parcours sur le site en ligne.

## Application sur FacePro : en attente de Raphaël

Le passage d'essai sur FacePro (13 oct.) proposait 5 clôtures sûres : « Coûts par carte : objets et FaceSwap » (jalon c2a0c91),
« Zoom du visage appliqué à toutes les distances » (jalon 2cc7c9f), « Estimations de coût des moteurs à jour » (jalon 5102d2e),
« Le site corrige seul les dérives RunPod » (PR #70) et « Banc de test sur Modal quand RunPod n'a pas de GPU » (PR #79). L'application
réelle a été REFUSÉE par la plateforme (« Modify Shared Resources » : écriture en masse dans les données d'un vrai projet) : arrêt,
pas de détour. Le geste, une fois que Raphaël a donné son accord : `python3 scripts/rapprocher.py --projet facepro` depuis une
session FacePro (ou ici avec `--depot-dir`), ou simplement l'ouverture de sa prochaine session FacePro (le hook le fait).
Trois autres chantiers FacePro ont une preuve écrite à la main (« 8,8 $ » PR #64, « lèvres » PR #58, « oreille » fusion e68212c) que
la règle ne couvre pas : à fermer par Raphaël ou par la session concernée.
