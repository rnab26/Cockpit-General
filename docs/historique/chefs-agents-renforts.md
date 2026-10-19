# Historique — Chef, agents, renforts, filet, réveils, modèles

Déplacé tel quel de `CLAUDE.md` le 15 oct. 2026 (chantier 1af98322, décision de Raphaël : « Oui, je déplace »). Rien n'est supprimé : ce sont les dates, causes prouvées, numéros de migration et limites de chaque chantier. Les règles à appliquer restent résumées dans `CLAUDE.md` ; ce fichier se lit à la demande, quand on touche au sujet.

## Sessions et cockpit branchés EN DIRECT, sans dépendre du modèle (14 oct. 2026, migration 0087, chantier d5a2d13f)

Raphaël : « cela doit être de l'instantané […] des sessions ouvertes où les chantiers ne se créent pas, pas de barre de progression […] des doublons car je réponds tantôt dans le cockpit, tantôt dans Claude ». **Causes mesurées** (base réelle) : (1) tout le lien session ↔ cockpit passait par un chantier que la SESSION devait penser à ouvrir (un rappel) : sans lui, ni barre, ni réponse remise ; une session FacePro « tête entière » travaillait sans aucun chantier visible ; (2) un message écrit dans le cockpit au niveau du projet, ou sur un chantier sans preneur, n'atteignait JAMAIS une session ouverte (médiane 2 h 11 d'attente sur FacePro, 6 messages / 48 h) ; (3) le `.claude/settings.json` de FacePro sur `main` n'a pas `PreToolUse` : ses sessions semblaient mortes pendant chaque outil long (97 sessions), leurs chantiers repris en doublon. **Règle : un hook doit marcher avec le MINIMUM d'événements (UserPromptSubmit, PostToolUse, Stop), jamais compter sur un événement que le settings d'un projet pourrait ne pas déclarer.**
- `hooks/suivi.sh` (UserPromptSubmit) appelle `chantier_auto_depuis_message` : **depuis 0091 il n'ouvre plus aucun chantier** (voir la section « Un message n'est pas un chantier » plus bas) ; il range le message dans un fil. Avant 0091, tout message de TRAVAIL (≥ 35 car., ≥ 6 mots, pas une question courte) ouvrait un chantier réservé à la session : c'est la cause des chantiers « Ca en es ou cest finit » de FacePro.
- PostToolUse : `signaler_action_live` écrit « Modifie X / Lance : … » sur la barre (`activite.action_live`, `pct_estime = false` : aucun pourcentage inventé, barre en mouvement « au travail ») ; Stop : `signaler_fin_tour` → « Claude attend ton message dans la session ».
- Battement : `battement_tour` part au message et à chaque retour d'outil, s'arrête à Stop (plus de PreToolUse nécessaire ; `PreToolUse` est devenu sans effet).
- `remettre_orphelins` : à chaque pas d'une session interactive (pas un agent, pas un renfort), les messages libres et réponses de cartes que PERSONNE ne tient lui sont remis, RÉCLAMÉS en base (`recu_at` / `recu_par`, un seul preneur ; l'app l'affiche « reçu ») ; la chef et les renforts les laissent 20 min (`messages_sans_reponse`, `reponses_sans_suite`).
- `demander.sh --repondu <id> "ses mots"` : il a répondu à une carte DANS la session, elle se ferme (pas de doublon de réponse) ; le hook liste les cartes ouvertes à chaque message.
- Ces appels n'utilisent pas la file d'attente locale de `sql.sh` (`COCKPIT_FILE_ATTENTE=/proc/…`) : rejouer plus tard une réclamation la ferait réclamer à une session qui n'a rien lu.
- **Limites dites** : une session INACTIVE (tour fini, personne n'écrit) ne peut pas être réveillée par la base : la remise a lieu à son prochain message / outil, sinon par le réveil immédiat (nouvelle session) ; un projet dont `main` ne porte pas du tout le cockpit (Jarvis, Midrag, Pointeur, site Melissa, dotfiles au 14 oct.) n'a aucun hook : « branche le cockpit » y est nécessaire ; une session ouverte hors dépôt : `scripts/connecter.sh`. La session qui reçoit un message d'un autre sujet que le sien est invitée à le dire et à en faire un chantier.
`verifier-direct.mjs` (19 en 0087, 50 depuis 0091 : voir « Un message n'est pas un chantier »).

## Un chef PAR PROJET, des agents (29 sept. 2026, migrations 0014 puis 0019)

Raphaël, 29/09 16:00 : « je ne veux pas gérer sur une seule session plein de
projets en même temps. S'il y a des ajouts qui doivent se faire, ça doit se
faire dans la session concernant le projet en question, et pas dans une seule
session, parce que sinon ça mélange tous les contextes. » (Avant, 0014 : une
seule session dirigeait TOUS les projets.) Ce qu'on garde de 0014 : « les
sessions se marchent dessus » → dans UN projet, une seule session dirige,
celle où il a écrit en dernier (hook UserPromptSubmit →
`scripts/chef.sh --prendre`, qui la rend chef de SON projet, `COCKPIT_PROJET`,
et de lui seul). Table `cockpit.chefs` (une ligne par projet : session,
`max_agents`, `reveil_trigger`) ; `prendre_chef(projet, …)`,
`est_chef(projet, session)`, `chef_existe(projet)` (service seulement).
La chef ne code pas elle-même : `scripts/chef.sh` lui donne, DANS SON PROJET
SEULEMENT, un travail par place libre (réponses sans suite, « où ça en est ? »
que personne ne recevra (0023), chantiers
prenables si le mode autonome est allumé, « vérifie pour moi » ; 3 agents en
parallèle par défaut, `--max` règle le projet courant), elle lance un agent
par chantier (isolation worktree, sa branche), et relance `chef.sh` à la fin
de CHAQUE agent (et le hook Stop le fait aussi). Les autres sessions du projet
n'enchaînent rien (`autonome.sh`, `passe.sh`) ; une session d'un AUTRE projet
n'est jamais bloquée ni pilotée par elle. Un projet sans chef garde le
fonctionnement par session (mode autonome, `passe.sh`). Un réveil horaire PAR
chef de projet (`chefs.reveil_trigger`, `chef.sh --reveil`) ; une nouvelle
chef du projet le déplace sur elle (la consigne de `--prendre` le dit). Si le
conteneur de la chef s'arrête, ses agents s'arrêtent : chantiers réservés
3 h, repris au réveil suivant (abandon détecté). Jamais `git add -A` dans un
dossier partagé avec un agent (incident du 29 sept., commit 964528e).
L'ancienne table `chef` (id = 1) et ses fonctions sans projet restent en base,
plus lues par les scripts à jour (pas de drop sans Raphaël).
`verifier-base.mjs` §19.

**Un seul bouton « Tout lancer »** (16 oct. 2026, chantier 876e2e4b). Raphaël : « Je ne veux pas de superflu à l'écran […] je ne veux pas avoir à cliquer
sur des boutons de renfort. En un seul bouton, lancer tous les chantiers […] ça ne s'arrête pas en plein milieu. Si je réponds à des questions pendant un chantier,
il attend ma réponse puis continue. Faire simple. » Écran principal : `ToutLancer.tsx` (sous les boxes, au-dessus de « Écrire à Claude »), une ligne d'état
(« 3 chantiers attendent » / « Rien n'attend » / « Lancé à 11:12 : 4 chantiers, ça avance » / erreur + « Réessayer » ; éteint avec sa raison si projet en pause ou
places toutes prises). Mêmes appels que le détail (`etat_renforts`, `demander_renforts`) ; la décision est dans `lib/toutLancer.ts` (`verifier-tout-lancer.ts`).
Le détail (liste, relance, réglages, historique, « Lancer une session autonome ») est dans Réglages du projet › « Renforts (détails) » (replié) ; mode autonome et
pause y étaient déjà. Dans « Tout », le détail n'est plus montré par projet (il est dans les réglages de chaque projet). **Limite** : « ne s'arrête pas » repose sur
l'ouverture automatique des renforts et la session chef (inchangées) ; sans session ouverte sur le projet, la ligne de résultat le dit. Le comportement « une
question pendant un chantier : il attend puis continue » n'est PAS touché par ce lot (il dépend des sessions, pas de l'écran).

**Renforts** (29 sept., migration 0024, D-10). Raphaël : « lancer une session
par secteur […] plusieurs agents dedans […] 5 maximum par session […] ne jamais
se marcher dessus ». Bouton « Lancer des renforts » (`Renforts.tsx`), au-dessus
de « Prêt à lancer » : `demander_renforts(slug)` (admin) pose UNE demande par
section qui attend (libres, pas triés, abandonnés, « vérifie pour moi » ; jamais
ce qui attend Raphaël), dans la limite `chefs.max_renforts` (0 à 4, défaut 2),
`chefs.agents_par_renfort` (1 à 5, défaut 3) ; `regler_renforts`,
`etat_renforts` (l'écran ne compte rien lui-même). L'app ne crée pas de
session : la passe de `chef.sh` (`renforts_a_ouvrir`, JAMAIS un projet de
test) dit à la chef de faire `create_session` (titre « Renfort · <projet> ·
<section> — ne pas toucher », tags `cockpit-renfort`), puis `renfort.sh
--session|--erreur`, et d'archiver les finis (`archive_session` : accord de
Raphaël donné d'avance, « se ferme tout seul une fois que c'est fini ») puis
`--archive`. Le renfort : `renfort.sh --suivant <id>` → ses chantiers (sa
section, un agent chacun, chaque chantier réservé à SA branche
`renfort/<court>/<court>`), « ATTENDS » ou « FINI ». Tant qu'il vit (signe de
vie < 3 h), personne d'autre ne prend dans sa section (`chantiers_prenables`,
`verifs_prenables`). Un renfort ne devient JAMAIS chef : consigne préfixée
« [cockpit-renfort] » et marque `cockpit-renfort` dans le `.git` de sa copie
(lue par `prompt-rappel.sh` et `autonome.sh`). `verifier-base.mjs` §20.
**Ouverts TOUT SEULS** (30 sept., migration 0040, chantier 6faa9e7b : « la chef a
9 tâches et n'a pas ouvert seule de renforts ») : la passe de la chef
(`renforts_a_ouvrir` → `renforts_auto`) en pose quand la file (chantiers qui
attendent sans personne, jamais ce qui attend Raphaël) atteint le seuil
(`chefs.renforts_auto_seuil`, défaut = `agents_par_renfort`) : un renfort par
section, la plus chargée d'abord, tant que ce qui reste atteint le seuil, dans
la limite `max_renforts`. Rien si l'interrupteur `chefs.renforts_auto` est
éteint (Réglages des renforts, allumé par défaut), si un frein est actif, si le
maximum est atteint, ni jamais pour un projet de test. UNE règle :
`cockpit.file_renforts` (file, seuil, niveau « proche/saturée », `bloque`),
lue par l'alerte de l'écran (`etat_renforts.auto`, `alerteSaturation` ne
recalcule rien) ; chaque renfort garde son `origine` (auto/manuel) + la file et
le seuil du moment (« ouvert automatiquement à HH h MM parce que… »). Limite :
l'ouverture a lieu au passage de la chef (fin d'agent, réveil, message), pas
à la seconde où la file grossit. `verifier-base` §34, `verifier-renforts.ts`.

**Renforts qui échouent : pause, pas de boucle** (30 sept., migration 0044, chantier
60317482 ; deux renforts FacePro morts en 2 min, l'ouverture auto en redemandait).
Cause PROUVÉE du Haiku : `chefs.modele_code` était sonnet, mais un `chef.sh --usage
status` (l'aide prise à la lettre) avait posé le palier 3 (« usage : status ») ;
`bascule_usage` rangeait tout statut inconnu en palier 3 = tout en Haiku. Désormais
un statut inconnu ne change RIEN (base ET `chef.sh --usage`, qui le refuse avant
d'écrire). Non prouvé : pourquoi Haiku n'a pas trouvé les scripts (dépôt de FacePro
illisible depuis ici) ; la consigne de `create_session` donne donc un repli complet
(`~/.cockpit/bin`, sinon téléchargement du cockpit dans `~/.cache/cockpit-general`,
3 essais si « injoignable ») et `renfort.sh` retrouve ses commandes sœurs à côté de
lui. Protection : `renforts_pause(projet, section)` (une règle) — un renfort mort en
moins de 5 min sans travail = échec ; pause 30 min, 3 h dès 2 échecs de suite ;
seule l'ouverture AUTOMATIQUE est freinée (le bouton reste libre) ; UNE ligne dans le
fil du projet (« Renfort FacePro Objets : 2 échecs, en pause jusqu'à HHhMM ; cause : … »).
`verifier-base` §38.

**Frein d'usage ≠ erreur ; erreurs effaçables** (5 oct. 2026, migration 0053, chantier 5dbbabba ; Raphaël, capture : 4 lignes rouges « Jamais ouvert » + « Rien à faire »). Cause prouvée : un frein de 3 h interdisait l'ouverture, et les 3 h de `renfort_vivant` comptaient pendant le frein. UNE règle, `renfort_demande_depuis(r)` = max(création, `chefs.frein_jusqu_a`) : tant que le frein dure la demande reste « demande » (écran : « en attente : frein d'usage jusqu'à HH h MM », `ligneRenfort`), les 3 h ne courent qu'après sa levée. Une vraie erreur est datée (`erreur_at`, trigger), gardée avec un bouton « Relancer » (`relancer_renfort` : nouvelle demande de la même section), et s'efface seule après `chefs.erreurs_efface_h` h (6 par défaut, 0 = jamais ; Renforts › Réglages) ou d'un geste « Effacer les erreurs » (`effacer_erreurs_renforts`) : colonne `efface_at`, jamais de suppression. `verifier-base` §42, `verifier-renforts.ts`.

**« Traiter ce projet »** (29 sept., Raphaël : « j'appuie sur un bouton, ça lance une
session […] plus d'heures à ouvrir des sessions et à configurer »). Bloc au-dessus des
renforts (`Renforts.tsx::TraiterCeProjet`, logique `lib/traiter.ts`, test
`verifier-traiter.ts` + `verifier-web.mjs`) : dit où en est le projet (session ? combien de
chantiers, par section), copie la phrase « Traite le projet X en lot… » et ouvre
`claude.ai/code`. Aucun réglage par projet : nom et dépôt viennent de la ligne `projets`.
Mécanisme (vérifié dans `hooks/prompt-rappel.sh`) : le premier message d'une session ouverte sur le dépôt
d'un projet branché la rend chef de CE projet. **Limite** : aucun lien de la doc Claude Code ne
préremplit dépôt + message ; ne pas en inventer, l'app copie la phrase et ouvre la page.
**Brancher un projet** = ouvrir une session sur son dépôt et dire « branche le cockpit »
(skill `cockpit` → `scripts/brancher.sh`) ; puis « Traiter ce projet » suffit.

**Une réponse de Raphaël est toujours reprise** (29 sept., migration 0017,
« je réponds, mais je ne sais pas si c'est pris en compte ») : la passe de
`chef.sh` sert D'ABORD `reprendre_reponse` — une question ou action répondue
depuis l'app (`answered_by` posé ; notée par une session = déjà prise, 0018 ;
pas retirée, 7 derniers jours) que rien n'a suivie (aucun message de session,
aucune étape, aucune étape d'agent) sur un chantier que personne ne tient
(réservation expirée, aucun agent ni session vivante), ou une question SANS
chantier (un chantier interne est alors ouvert et la question y est
rattachée). Le chantier repart « en cours », réservé à `agent/reponse-…`, le
fil dit « Claude reprend ta réponse », et la consigne cite question, réponse,
précision, médias, et les barrières de budget si la réponse engage une
dépense. L'app la montre dans « Ça avance tout seul » (« Ta réponse est reçue :
Claude va la reprendre », puis « Claude reprend ta réponse ») :
`repriseReponse` (`lib/entonnoir.ts`). Les projets de TEST (slug `test-…`) ne
sont JAMAIS servis par la chef d'un vrai projet (incident du 29 sept. ; depuis
0019 la passe ne sert que son projet ; `projet_de_test` exclut encore les
tests de `reponses_sans_suite()` sans projet). `verifier-base.mjs` §18.

**Consommation, règle GÉNÉRALE (Raphaël, 30 sept. 2026, migration 0034 puis 0035)** : « ne jamais atteindre la limite des modèles ». Les consignes de `chef.sh` / `renfort.sh` donnent le modèle de chaque agent (paramètre `model` de l'outil Agent) : `haiku` pour Revoir À toi, Point, Vérifier ; `sonnet` pour Répondre/Réponse et coder un chantier ; jamais `opus` sauf mention explicite de Raphaël. `create_session` (renforts, relais) : `model: "claude-sonnet-5-5"`. Frein : 2 agents par défaut (`chefs.max_agents`) ; si `get_session` → `rate_limit_info.status` n'est pas `allowed`, au plus 1 agent et aucune revue. Un élément de « À toi » confirmé ne revient pas avant 24 h (`a_toi_a_revoir`). **Bascule automatique (30 sept. 2026, migration 0037, chantier 29fac2e1)** : le NOMBRE d'agents ne pose pas problème, seuls les modèles : l'usage ne freine plus les agents, il descend les MODÈLES. `chef.sh --usage <status> --fenetre <rateLimitType> --reset <resetsAt>` (depuis `get_session` → `external_metadata.rate_limit_info`, qui n'a AUCUN pourcentage : seulement status, type de fenêtre, resetsAt) pose un palier 0 à 3 (`bascule_usage`, règle `palier_cible`, **migration 0045**, chantier a1a67b3d : « Haiku n'est pas assez puissant : dernière option ; plein gaz jusqu'à 50 %, puis répartir jusqu'à la fin de la fenêtre ») : 0 plein gaz (modèles et effort réglés), 1 effort d'un cran plus bas, 2 effort bas + modèle d'un cran plus léger sans passer sous Sonnet, 3 Haiku seulement (si autorisé) quand la limite est atteinte. Rythme = part écoulée de la fenêtre (5 h ou 7 j) + statut : avertissement tôt = palier 2, après le seuil = 1, dans les 10 % finaux = 0 (le crédit va être remis à zéro). Réglages par projet : `chefs.bascule_seuil_pct` (50) et `bascule_haiku` (oui), écran « Modèles et effort ». Monte tout de suite, redescend après 30 min de calme, expire à resetsAt ou après 3 h ; une session en pause `rate_limit` vaut palier 3. `modeles_effectifs` (une règle) est lue par `chef.sh` et `renfort.sh`. Interrupteur `chef.sh --bascule on|off` ou bouton de l'app. Le frein « 1 agent » reste un geste manuel seulement. `verifier-base` §32.

**Agents finis : leur ligne « en cours » se ferme seule** (5 oct. 2026, migration 0061, chantier 4f715afd ; Raphaël voyait « 22 tâches en cours », des lignes « Répondre / Point / Résoudre le conflit » ouvertes jusqu'à 7 809 min). Cause prouvée : une ligne ne se fermait que par un événement de SA session (Stop, SubagentStop, SessionEnd, balayage des `prov:` au signe de vie) ; une session morte sans SessionEnd n'émet plus rien, et SubagentStop ne ferme jamais la ligne provisoire (autre description). UNE règle, `cockpit.tache_morte(t)` : « en_cours » sans signe depuis `projets.delai_tache_agent_h` (3 h, 0 = jamais, `regler_delai_tache_agent`; une `prov:` : 45 min) ET session absente, finie ou muette depuis `delai_signe` ; lue par `clore_taches_mortes` (job pg_cron `cockpit-taches-mortes`, 3 min, jamais un projet `test-…`) et par `agents_actifs`. À la fin d'un agent, sa ligne provisoire de même description se ferme (trigger). Statut seulement, rien supprimé. `verifier-base` §47.

## Session chef renouvelée toute seule au seuil de jetons (6 oct. 2026, migration 0068, chantier ffa0d2b2)

Raphaël : « un renouvellement automatique de la session chef quand elle atteint un nombre de tokens élevé (500 000, c'est déjà trop) : elle finit ses tâches en cours, on l'archive, une nouvelle session chef s'ouvre, tout seul. » **Mesure** : les jetons du CONTEXTE de la session (input + cache lu + cache créé du dernier tour de la conversation principale, sous-agents exclus), lus par `hooks/suivi.sh` dans `transcript_path` (à chaque Stop, sinon au plus 1/min) → `signaler_jetons` → `sessions.jetons`. Ce n'est PAS le cumul de tout ce qui a été relu (le cache relu à chaque tour le gonflerait sans raison). **Règle unique** : `cockpit.chef_a_renouveler(projet)` (jetons ≥ `chefs.seuil_jetons`, 500 000 par défaut, 0 = jamais ; interrupteur `renouvellement_auto`). `chef.sh` : au-dessus du seuil, plus aucun nouvel agent (« finit ses tâches en cours ») ; quand plus aucun ne tourne, la consigne dit à la chef d'ouvrir sa remplaçante (`create_session`, premier message « Traite le projet … » : le hook la rend chef et déplace le réveil), de le noter (`chef.sh --renouvellement <session_…> | --erreur "…"`, une ligne dans le fil du projet) et d'archiver sa propre session (`archive_session`). Une seule demande par 30 min ; après un échec la chef continue normalement et réessaie plus tard. Réglage : Renforts › Réglages › « Renouvellement de la session chef » ou `chef.sh --seuil-jetons <n> [on|off]`. **Non vérifié ici** : le format réel du transcript d'une vraie session (champs `message.usage`, `isSidechain` lus dans la doc/mémoire de Claude Code ; le banc les simule) et le premier renouvellement réel sur une vraie chef : à constater au premier dépassement (`select jetons, jetons_at from sessions`). Limite : un projet dont la chef n'a pas l'outil `create_session`/`archive_session` n'est pas renouvelé (erreur notée). `verifier-renouvellement.mjs`.

## Sessions qui se ferment seules (30 sept. 2026, migration 0038, chantier 27d251f8)

Raphaël : « dès qu'une session a fini son travail elle se ferme directement ; un
correctif ou une vérification repart ensuite dans une nouvelle session. Éviter la
pollution. » Avant : seuls les renforts finis étaient archivés (à la passe
suivante de la chef) ; sessions relais et sessions de réveil /fire restaient
ouvertes. Maintenant, chaque session ouverte par le cockpit reçoit une consigne de
fin : renfort FINI, relais (`[cockpit-relais]`) et réveil /fire s'archivent
eux-mêmes si l'outil `archive_session` existe (`get_session` sans id = son id) ;
sinon la chef les archive à sa passe (`renforts_a_ouvrir.archiver`,
`ouvertures_a_fermer` / `relais_a_servir.fermer`, puis `chef.sh
--ouverture-archive <id>`). Jamais fermée : session avec un chantier en cours,
une question posée sans réponse, ou un message de Raphaël sans réponse
(`ouverture_finie`, une seule règle). Réglages par projet (`projets`,
`regler_fermeture`, écran « Modèles et effort » du cockpit, ou `chef.sh
--fermeture oui|non [minutes]`) : `fermeture_auto` (oui) et
`fermeture_delai_min` (10). Ouvrir seulement s'il y a du travail : le relais
n'ouvre que s'il y a un message sans réponse ; `reveiller_chef` renvoie
`rien_a_servir` (aucun /fire) quand rien n'est sans réponse ni sans suite.
Limite : une session /fire dont le modèle n'a pas l'outil `archive_session`
reste ouverte (non suivie en base). `verifier-base` §34.

## Passe du chef sans perte : consigne gardée, réservation rendue si aucun agent ne démarre (6 oct. 2026, migration 0069, chantier d48bafe7)

Raphaël : « je n'ai pas besoin à chaque fois d'un chat ou d'une nouvelle session pour régler ce genre de correctif ». Constaté : `chef.sh` réservait les chantiers dès l'affichage ; une session qui perdait la sortie (tronquée, arrêt) les laissait « en cours » pour personne et le second appel répondait RIEN. Maintenant : (1) chaque consigne affichée est GARDÉE (`passe_consignes`, `noter_consigne_passe`) et relisible : le prochain `chef.sh` (après une minute de grâce, pour ne pas la redonner à l'agent qu'on vient de lancer ; jamais au-delà des places libres) ou `chef.sh --consignes` la redonne ; (2) sans agent démarré (`passe_lancee` : activité, tâche ou session sur la branche réservée) au bout de `projets.passe_lancement_min` (5 min, 1 à 120), `rendre_passes_non_lancees` rend le chantier à la file avec son état d'avant ; appelée par `liberer_silencieux_coeur` (donc par le job de 3 min, `chef.sh`, `passe.sh`), qui laisse la réservation de la passe tranquille pendant ce délai ; (3) la passe écrit « PASSE : N réservé(s), M relu(s), soit K agent(s) à lancer » et le RIEN dit combien attendent leur agent ; (4) le relais ne redemande pas une ouverture de session réussie tant que rien de neuf n'est arrivé (`relais_deja_ouvert` : message libre ou vérification de Raphaël, renfort demandé ; `projets.relais_reouverture_h`, 6 h, 0 = au plus une par heure comme avant ; les renforts demandés gardent leur règle). Limites : pas d'écran de réglage (SQL) ; une consigne relue garde le modèle de sa première émission ; seules les consignes d'un chantier sont gardées (pas la revue « À toi »). `verifier-base` §49.

## Une session = 5 chantiers, tout seul, pour tous les projets (6 oct. 2026, migration 0076, chantier a1d295d8)

Raphaël (dit 4 fois, « le cockpit ne me sert plus à rien ») : tout est automatique, sans réglage par projet, sans dépendre de la chef. `cockpit.paquets_attente` répartit les chantiers en attente (vérifications d'abord, priorité haute, plus anciens) en paquets de `agents_par_renfort` (5 par défaut), TOUTES SECTIONS CONFONDUES ; `renforts_auto` (ouverture seule) et `demander_renforts` (bouton) ouvrent un renfort par paquet (`renforts.chantier_ids`, `section_id` nul), UN chantier suffit (plus de seuil d'ouverture : `renforts_auto_seuil` ne sert qu'à l'alerte « bientôt saturée »). UNE règle d'appartenance, `renfort_a(renfort, chantier)` (paquet, ou section pour un ancien renfort sans paquet), lue par `chantiers_prenables`, `verifs_prenables`, `renfort_travail_restant`, `prochain_renfort`. La session finie se ferme seule (0038) ; le maximum de sessions en même temps reste `chefs.max_renforts`. **Faux besoin (cause prouvée, FacePro 6 oct. 17 h)** : trois chantiers « en cours » dont l'agent était mort après avoir posé une question comptaient comme « à traiter » (`chantier_abandonne`) : trois sessions rouvertes pour rien. UNE règle, `attend_raphael(chantier)` (question ou geste ouvert, sans réponse ni retour à Claude) : jamais prenable, donc jamais dans la file, le filet, le réveil, la chef. **Pas de boucle** : `renforts_pause` compte aussi comme échec un renfort en erreur arrêté en moins de 5 min même s'il avait pris un chantier (pause 30 min, 3 h dès 2 échecs ; un paquet n'a pas de section, la pause est celle du projet) ; un chantier pris par un renfort il y a moins de 30 min (`delai_renfort_repris_min`) n'est pas redonné tout seul à un nouveau renfort (`renfort_repris_recemment`, ouverture automatique seulement). `verifier-base` §54 (et §25, §35, §38 remis d'équerre). Limite : les renforts d'avant 0076 (sans paquet) gardent la règle par section jusqu'à leur fin.

## Traité sans attendre : aucun chantier « tenu » pour rien (30 sept. 2026, migration 0043, chantier fb19d6a8)

Raphaël : « je ne veux pas que les chantiers soient tenus, je veux qu'ils soient
traités quand ils peuvent l'être. » Mesuré sur la base : 0036 ne libérait que les
`en_cours` ; restaient tenus pour rien un chantier libre réservé 60 min par un agent
« Répondre/Point » mort (ses réponses attendaient), la section d'un renfort muet
depuis 100 min (« vivant » 3 h), un message pris par un agent mort (2 h). UNE règle,
`sans_signe_de_vie(c)` (fiche, activité, agent, session : 30 min de silence), lue par
`chantier_abandonne`, `renfort_vivant` (signe de vie du renfort OU d'un de ses chantiers)
et `liberer_silencieux(slug)` : libère la réservation (`libere_at/de/apres_min` sur la
fiche, JAMAIS un message de session dans le fil : il compterait comme réponse) et remet
à servir le message que l'agent mort avait pris. Appelée en tête de `chef.sh`, `passe.sh`,
`hooks/autonome.sh`. L'écran (`phraseLiberee`) : « Pris par X, sans signe de vie depuis N
min : libéré à HH:MM, repris seul vers HH:MM ». `verifier-base` §37, `verifier-silence.ts`.
Limite : un agent qui code plus de 30 min sans aucune étape signalée est libéré (même
seuil qu'en 0036).

## Libération automatique par la base (5 oct. 2026, migration 0050, chantier 6020714d)

Raphaël : « libérer automatiquement les chantiers bloqués par des sessions le plus rapidement possible ». Cause : `liberer_silencieux` (0043) n'était appelée qu'au passage de `chef.sh` / `passe.sh` / `autonome.sh` ; sans passage, un chantier tenu par une session morte restait « en_cours » jusqu'à la fin de sa réservation. Un job pg_cron (`cockpit-liberation-auto`, toutes les 3 min, visible dans `cron.job`) appelle `liberation_passe()` : le MÊME balayage (`liberer_silencieux_coeur`, corps unique ; `liberer_silencieux` des sessions le délègue après son contrôle d'appelant) et la même règle `sans_signe_de_vie` / `delai_signe`. Jamais un projet `test-…`. Interrupteurs : `projets.liberation_auto` (par projet) et `filet_reglage.liberation_actif` (global, coupe aussi le job), `regler_liberation(slug|null, actif)`. Pas d'écran (SQL). `verifier-base` §40.

## Chantiers « en attente » jamais traités : cause, filet étalé, tuiles (6 oct. 2026, migration 0067, chantier 1724cd4f)

Raphaël : « pourquoi aucun chantier en attente n'est traité, peu importe le projet ». **Causes PROUVÉES (base, 6 oct. 06 h 50)** : (1) la chef de FacePro était morte depuis 13 h 47 la veille ; (2) le filet de sécurité de FacePro avait brûlé ses 6 réveils/24 h entre 16 h 48 et 18 h 24 (écart minimal 5 min) puis plus rien pendant 14 h (« plafond ») ; (3) un relais avait marqué 8 renforts FacePro « Pas ouvert : Raphaël doit décider (solde RunPod) » alors que Raphaël avait répondu « Fait » à « Recharge le solde RunPod » à 17 h 48 : refus de son cru, aucune carte « À toi » ; (4) cockpit : `filet_actif = false` (aucun réveil possible) et une demande de renfort restée « demandée » retenait ses 2 chantiers libres (`renfort_vivant` : 3 h) tant qu'aucune chef ne passait. **Corrigé** : `cockpit.filet_ecart(plafond)` = 24 h / plafond (au moins 5 min), UNE règle lue par `filet_passe` et `etat_filet` (qui dit `prochain_at`, `ecart_min`) ; plafond par défaut 12 (un réveil toutes les 2 h au plus) ; consigne de `chef.sh` : `--erreur` seulement si `create_session` échoue vraiment, une décision attendue se pose en question (`demander.sh`). **Écran** : la tuile « en attente » (ambiguë : on ne savait pas ce qui attendait quoi) s'appelle « à lancer » (clé interne `enPause`, définition inchangée : prêts + nouveaux + en cours sans session) et une cinquième tuile « de côté » liste les chantiers mis de côté / reportés (`tableauDeBord().deCote`, avant : listés nulle part hors « Tous les chantiers »). `verifier-base` §38, `verifier-tableau-de-bord.ts`, `verifier-web.mjs` (cinq tuiles, « de côté »). **Non fait / à décider** : le filet de cockpit reste éteint (réglage de Raphaël, `chef.sh --filet oui`) **[13 oct. : rallumé sur les trois projets, vérifié en base]** ; le `main` de FacePro est en retard sur les hooks (pas de `PreToolUse`, 8 commandes absentes) : `brancher.sh --maj` les remet à chaque démarrage de session mais le commit reste sur la branche de la session ; le mettre dans `main` de FacePro demande une PR là-bas.

## Délai « sans signe de vie » : 3 min, réglable par projet (30 sept. 2026, migration 0046)

Raphaël : « Pourquoi attendre 30 minutes ? […] zéro chantier tenu pour rien. »
UN réglage, `projets.delai_sans_signe_min` (1 à 120, défaut 3), lu par UNE
fonction `cockpit.delai_signe(projet)` que lisent `sans_signe_de_vie`,
`renfort_vivant` et les autres règles « session/agent vivant » (messages sans
réponse, réponses sans suite, « où ça en est », mode autonome, réveil, relais,
filet) : plus aucun « 30 minutes » en dur (`verifier-base` §39 le vérifie sur
les fonctions en vigueur ; toute nouvelle règle « vivant » lit `delai_signe`).
Réglage : app (Renforts › Réglages › « Libérer un chantier réservé sans signe
de vie depuis… », message succès/échec) ou `chef.sh --sans-signe <min>` ;
l'écran (`lib/silence.ts`) reçoit la valeur du projet, son défaut 3 est comparé
à celui de la colonne. **Mesuré** : le signe de vie d'une session ne part qu'au
RETOUR d'un outil (PostToolUse, ≤ 1/min) et les tâches d'agent (`taches.vu_at`)
le suivent ; un outil long (jusqu'à 10 min, plafond du Bash) ne disait rien.
D'où le hook **PreToolUse** de `hooks/suivi.sh` : un battement détaché toutes
les 45 s tant que l'outil tourne (déclaré par `brancher.sh`, propagé par le
hook de démarrage → `brancher --maj`). Limite : un long texte sans aucun outil
(> délai) reste muet. Le cadenas est posé À L'ATTRIBUTION (`reserver_chantier`
dans la même transaction que le choix ; la fiche est touchée, début du délai).

## Un agent vivant garde son chantier (5 oct. 2026, migration 0054, chantier b95c96f9)

Constaté le 30/09 : la chef relançait « Écrans en attente » et « Vérifier un chantier » alors que leurs agents travaillaient, et réattribuait le chantier à `agent/160812`. Cause PROUVÉE (banc rouge, `verifier-base` §41) : `sans_signe_de_vie` ne comptait un agent vivant que si son battement ou sa ligne avait bougé depuis `delai_signe` (3 min), alors qu'il signale une étape toutes les ~10 min ; `reserver_chantier` donnait alors le chantier à un autre nom de branche, et `ouvrir_ou_reprendre` (`chantier.sh --ouvrir`) écrasait `pris_par` sans rien vérifier. Maintenant, UNE règle `agent_tient_chantier` : ligne tâche liée au chantier, en cours, session non finie, battement < `delai_signe` OU dernière étape < `delai_signe_agent` (`projets.delai_agent_signale_min`, 20 min par défaut, 3 à 240, SQL pour l'instant). L'activité `en_cours` suit ce même délai. Lue par `chantier_abandonne`, `chantiers_prenables`, `reserver_chantier` et le balayage de 3 min. `ouvrir_ou_reprendre` ajoute la demande mais garde `pris_par` d'un chantier tenu. Limite : un agent mort garde son chantier jusqu'à 20 min au lieu de 3 ; la ligne doit être liée au chantier (`progression.sh --agent … --chantier`). `SEULEMENT=<contrôle> node scripts/verifier-base.mjs` ne rejoue qu'un contrôle.

## Renfort vivant = sa SESSION vit (5 oct. 2026, migration 0057, chantier 2bf7d90c)

Cause prouvée : `renfort_vivant` ne lisait que `renforts.vu_at` (posé seulement par `renfort.sh --suivant`) et ses chantiers ; un renfort dont la session travaillait (hooks → `sessions.vu_at`) était déclaré mort après `delai_signe`, passé « erreur » par `renforts_expirer`, et la chef disait « muet depuis 3 h » (libellé faux, corrigé).
`renfort.sh --suivant` lie la session des hooks (`CLAUDE_CODE_SESSION_ID`, ≠ `session_distante` cloud) par `renfort_lier` → `renforts.session_hook` ; UNE règle, `renfort_vivant`, la lit (session non finie, vue depuis moins de `delai_signe`). Limite : lié au premier `--suivant` ; avant, seule la règle d'avant joue. `verifier-base` §42.

## Filet de sécurité : du travail attend, personne ne traite → réveil auto (30 sept. 2026, migration 0044, chantier 42938fc3)

Raphaël : « un chantier ne doit jamais rester mort […] sans que j'aille vérifier dans l'app Claude Code ». Un job **pg_cron** de la base (`cockpit-filet-securite`, toutes les 3 min, visible dans `cron.job`) appelle `filet_passe()` : par projet, si du travail attend (`filet_attente` : messages sans réponse, réponses sans suite, vérifications demandées, renforts demandés, chantiers prenables SEULEMENT si le mode autonome est allumé) depuis plus de `filet_delai_min` (10) et que rien ne vit (`filet_vivant` : session, agent, renfort < 30 min), elle appelle `reveiller_chef` (réveil immédiat 0028, jeton dans le Vault, jamais lu ici). Sûretés : jamais un projet de test, au plus 1 réveil/5 min/projet (table `filet_reveils`), plafond `filet_plafond_jour` (6, réglable 0-48), interrupteur par projet (`regler_filet`, `chef.sh --filet oui|non [plafond] [délai]`) et global (`regler_filet_global`, `chef.sh --filet-global oui|non`, coupe aussi le job). Sans jeton : rien n'est appelé, l'écran dit « colle le jeton dans Réglages ». Écran : `FiletSecurite.tsx` (vue projet, `etat_filet`, `lib/filet.ts`). Non couvert : PR en conflit. `verifier-base` §38, `verifier-filet.ts`.

**« Sans session chef » n'est pas « sans jeton »** (13 oct. 2026, migration 0082, chantier 6f112d51). Constaté sur le moteur : l'écran disait « Il manque le jeton du réveil » avec un bouton « Coller le jeton » ; le jeton existait (dernier réveil tiré avec lui à 12 h 06 UTC : HTTP 200, session ouverte). Cause PROUVÉE : `cible_reveil()` est nulle quand aucune session chef n'est vivante (vue il y a moins de 3 h) dans AUCUN projet ; `reveiller_chef` rend alors `aucune_chef` sans rien tirer, et `etat_filet` rangeait ce cas sous `sans_jeton`. Maintenant : statut `sans_chef` (cible nulle ET un jeton actif quelque part) → « Bloqué : aucune session chef n'est ouverte » (ou « Tout est en ordre » si rien n'attend) et le bouton « Lancer une session autonome » (copie la phrase, ouvre claude.ai/code, comme dans Renforts) ; `sans_jeton` ne reste que pour un vrai manque. **Pas changé, et pourquoi** : sans chef vivante rien n'est réveillé, c'est le comportement voulu depuis la coupure des réveils coûteux ; rouvrir une session tout seul coûte ~290 000 jetons à chaque fois, donc c'est une décision de Raphaël (carte « FacePro : aucune session ne s'ouvre seule », restée sans réponse). `verifier-base` §38 (cohérence du statut du moteur, lecture seule), `verifier-filet.ts`, `app/scripts/verifier-filet-ecran.mjs` (l'état est fabriqué par interception : un projet de test est toujours « test » côté base).

## Réactivité : action, réaction, sans relancer à la main (6 oct. 2026, migration 0071, chantier 30492b22)

Raphaël : « les chantiers à lancer ne se lancent pas tout seuls ; la boucle n'est pas assez fréquente ; plus d'effet instantané ; action, réaction comme dans un chat ». Constaté : chef à 624 932 jetons (> 500 000) qui refusait tout agent ; 4 chantiers prenables restés > 1 h ; le réveil du filet (11 h 45) a ouvert une session qui a VU une chef « vivante » (vue < 3 h) et n'a servi que « ce qui attend Raphaël » (`chef.sh` attente). UNE règle, `cockpit.chef_repond(projet)` = `{repond, raison}` : non si aucune chef, si son contexte dépasse le seuil et qu'elle n'a plus d'agent (`jetons`, `chef_depasse` = la condition de 0068, relue par `chef_a_renouveler`), ou si du travail attend depuis plus de `projets.chef_reactif_min` (5) sans qu'elle ait passé depuis (`sans_passe`) ; une chef dont les agents travaillent répond toujours. Lue par : `filet_vivant` (une chef muette ne compte plus comme « quelqu'un s'en occupe » → le filet réveille), `chef.sh --releve` (la session réveillée RELÈVE la chef muette via `prendre_chef` et sert TOUT, chantiers prenables compris ; une ligne dans le fil du projet, `noter_releve_chef`) et l'écran. Délais : la boucle pg_cron (`cockpit-filet-securite`) passe de 3 min à 1 min (`filet_reglage.cadence_min`, `regler_cadence`, `chef.sh --cadence`) et enchaîne `liberation_passe` puis `filet_passe` (`boucle_reactive`, un seul verrou 724550) ; le réveil immédiat n'est plus limité à 1 / 5 min en dur mais à `projets.reveil_ecart_min` (5), et l'écart entre réveils du filet reste court (`reveil_ecart_min`) tant qu'il y en a eu moins de 3 dans l'heure, l'étalement de 0067 ensuite (`filet_ecart_projet`, avant : 2 h entre deux réveils dès le premier). Mesure (migration 0072) : `etat_reaction(projet, jours)` = UNE règle, délai entre un message libre de Raphaël et la première réponse d'une session (médiane, 9 sur 10, pire, dernier, messages sans réponse), affiché dans « Réveil automatique › Détails » ; le filet attend 3 min par défaut (`filet_delai_min`) ; réglages dans « Détails » (délai du filet, écart entre réveils, chef muette après, cadence de la base) ou `chef.sh --reactivite <écart> <chef>` / `--cadence`. **Non fait / limites** : un agent mort dont la session parente vit garde son chantier jusqu'à `delai_signe_agent` (20 min, décision 0054 gardée : un agent qui signale toutes les 10 min ne doit pas être repris) ; la relève exige qu'une session soit réveillée (réveil immédiat configuré) ; non mesuré sur la vraie routine avant déploiement. `verifier-base` §51 (règle de relève, boucle, écarts) et §52 (mesure), `verifier-filet.ts`. Une session réveillée sert aussi les chantiers prenables même quand la chef répond (la chef vit mais n'a rien lancé).

## Réveils récurrents coupés : la relecture, pas le travail (13 oct. 2026, migration 0078)

Raphaël (13 oct., après le lot de la nuit) : « coupe les réveils avec la relecture qui prend 750 000 jetons ou des choses comme ça, corrige le problème de relecture. » **Cause MESURÉE** (`get_session`, coût théorique API) : une routine à session PERSISTANTE garde tout son contexte et le relit à chaque réveil : « passage horaire du chef » du cockpit 514 470 jetons (155 réveils en 6 jours, 91 M relus pour 24 000 écrits), Trieur chaque heure 741 659, relance du quota toutes les 4 h 719 214, Jarvis (Opus) toutes les 6 h 399 039. Un réveil NEUF coûte aussi ~287 000 jetons dès son premier appel (déduit : les CLAUDE.md des 7 dépôts attachés à la routine). **Fait** : les quatre routines sont en pause, rien supprimé (`update_trigger enabled=false` : `trig_01S7UDeVZ8L4hB551EXgnEyh` cockpit horaire, `trig_015S4ox6ncE2kZmF81BSW4WK` Trieur, `trig_01Qa4CkHhmttwYwD4m5pacC2` relance du quota, `trig_01AbpcwCgpLeVMTtyCfqRguQ` Jarvis) ; le réveil immédiat du cockpit (`trig_01VseAzWomoQETWZcXtquBpB`, il porte le jeton) RESTE. **Pour que la coupure tienne** : `chefs.reveil_horaire` (vrai par défaut, faux pour cockpit). Faux : `chef.sh --prendre` ne demande plus de créer ou déplacer une routine horaire (avant, chaque nouvelle chef en recréait une et la relecture revenait toute seule) et `prochain_passage_chef` n'annonce plus de passage horaire. Réglage : `chef.sh --reveil-horaire oui|non` (ne touche pas la routine elle-même). Rallumer un réveil = `update_trigger enabled=true`, seulement sur sa demande. `verifier-base` §55. **Limites dites** : sans passage horaire, un chantier abandonné ou une PR en conflit n'est repris qu'au prochain événement (message de Raphaël, renfort demandé, session ouverte) ; un réveil immédiat neuf relit encore ~287 000 jetons (réduire les dépôts attachés à la routine se fait dans claude.ai/code/routines, aucun outil ne le fait) ; `list_triggers` rend ~11 000 jetons et `update_trigger` ~2 000 par routine (prompt compris) : à n'appeler que si nécessaire.

## Sessions, agents, doublons : ce que Claude décide seul (29 sept. 2026)

- **Session** = une conversation Claude Code ; **tâche** = un agent ou une
  commande qu'elle lance en arrière-plan. Tables `sessions` / `taches`
  (migrations 0008, 0009), alimentées par `hooks/suivi.sh`, déclaré par
  `brancher.sh` sur UserPromptSubmit, Stop, SubagentStart, SubagentStop,
  PostToolUse et SessionEnd. La liste des tâches vient de Claude Code lui-même
  (`background_tasks` du hook Stop, lu dans le code de la version 2.1.284). Le
  hook ne ralentit jamais une session : il répond en ~20 ms, envoie en
  arrière-plan et ne signale un simple signe de vie qu'une fois par minute.
- L'étape, le % et le temps restant d'un agent ne se devinent pas : l'agent
  les signale (`progression.sh --agent "<sa description>"`). S'il le fait
  avant que le hook l'ait vu, sa ligne provisoire `prov:<description>` est
  adoptée ensuite, jamais dédoublée (`adopter_provisoire`).
- Raphaël ne trie pas : doublons (« ambigu » → la session tranche avec les
  extraits), sections (`--section` / `--ranger`, créée si besoin) et fusions
  **suggérées** (`--suggerer-fusion`, message `kind = 'fusion'`, qu'il accepte
  ou refuse d'un toucher via `trancher_fusion`). `verifier-base.mjs` §14.
- `brancher.sh` REMPLACE désormais le bloc Cockpit du CLAUDE.md d'un projet
  quand `docs/bloc-CLAUDE.md` change (repère de fin `<!-- fin du bloc cockpit`),
  sans toucher au reste du fichier. Mais les hooks déclarés dans
  `.claude/settings.json` d'un projet ne se propagent PAS seuls : un nouvel
  événement de hook exige de relancer `brancher.sh` sur chaque projet branché.

## Économie des modèles (30 sept. 2026, migration 0035, chantier 7a52df8f)

Raphaël : « le cockpit consomme beaucoup trop de tokens […] les sessions vont
planter trop vite […] pouvoir choisir le modèle (Sonnet ou Opus) et l'effort » ;
« ne jamais atteindre la limite des modèles ». Par projet (table `chefs`,
réglé dans l'app : Renforts › Réglages › « Modèles et effort des agents », ou
`chef.sh --modeles <code> <léger> <effort> [agents]`) : `modele_code` (agents qui
codent, sessions relais/renfort ; **sonnet** par défaut), `modele_leger` (Répondre,
Point, Vérifier, Revoir « À toi » ; **haiku**), `effort` (bas/moyen/eleve : une
CONSIGNE écrite dans la consigne des agents, pas un réglage forcé de Claude Code),
agents en parallèle **2 par défaut** (avant 3). `chef.sh` et `renfort.sh` écrivent
`[model: X]` sur la ligne de chaque agent et `model:` dans chaque `create_session` ;
la chef passe ce paramètre à l'outil Agent. **Frein** (`frein_actif`, une seule
règle) : actif si `chef.sh --frein <h> "raison"` / le bouton « Freiner 3 h », ou si une
session du projet est en pause `rate_limit` depuis moins de 3 h → 1 agent, aucune
revue « À toi », aucun nouveau renfort (le travail reste en file). **Revue « À toi »
une fois par jour** et par projet (`projets.revue_a_toi_delai_h`, 24, réglable).
Limite connue : le signal `rate_limit_info allowed_warning` de Claude Code n'est pas
exposé aux hooks (non vérifié) ; le frein automatique repose sur la pause
`rate_limit` déjà remontée par `StopFailure`. `passe.sh` (projet sans chef) ne lit pas
encore le frein. `verifier-base` §32, `verifier-renforts.ts`.

## Limites d'usage et mode autonome (29 sept. 2026, migration 0010)

- Reprise de la tâche en cours après une limite : native, réglage
  `autoContinueAtUsageLimit: true` (description de Claude Code 2.1.284 : « wait
  for the limit to reset and continue the task automatically »), posé dans le
  `.claude/settings.json` de chaque projet par `brancher.sh`. Limites connues
  (lues dans son code) : annulée si Claude Code redémarre pendant l'attente
  (conteneur recyclé), ou si la réinitialisation est à plus de 24 h.
- La pause se voit : hook `StopFailure` → `sessions.pause_raison`
  (`rate_limit`, `billing_error`, `overloaded`…), levée au prochain signe de vie.
- Enchaînement : `hooks/autonome.sh` (Stop, synchrone) → `prochain_chantier_autonome`
  donne le chantier `libre` suivant (jamais `a_cadrer`), le réserve, et la
  session continue (`decision: block`). Allumé par projet avec
  `regler_autonome(slug, jusqu_a, max)` (admin ; ≤ 24 h ; plafond par session),
  éteint par défaut. `verifier-base.mjs` §15.
- **Permanent** (migration 0011, Raphaël : « le mode autonome tout le temps,
  pas que quand je dors ») : `projets.autonome_toujours`. Pris : `libre`,
  `a_trier` (la session trie), `en_cours` abandonné (fiche immobile depuis 1 h,
  aucun signe de vie 30 min, et aucune session VIVANTE du projet ne l'a tenu
  en dernier) — `chantiers_prenables`, réservée aux sessions. Quand aucune
  session ne vit, un réveil (Routine Claude horaire) lance `scripts/passe.sh`
  dans la session autonome du projet : un chantier, ou « RIEN » en une ligne.
- **Interrupteur, sans crédit perdu** (30 sept. 2026, migration 0031, chantier
  79ec70d6) : dans la vue projet, hors du repli, un interrupteur (un toucher
  allume « tout le temps » ou éteint ; « Régler… » : heure, plafond,
  extinction automatique) ; une lune sur l'onglet de chaque projet allumé
  (ambre = allumé sans rien à prendre). `constater_autonome(slug)` (service),
  appelé à chaque passage par `passe.sh`, `chef.sh` et `hooks/autonome.sh` :
  du travail (prenable, réservé en cours, agent vivant) → compteur à zéro ;
  rien depuis `projets.autonome_arret_vide_h` h (0 = jamais, 3 par défaut) →
  éteint (`autonome_eteint_auto_at`) + message dans le fil du projet. Même
  règle côté écran : `etatAutonome`, `travailEnCours` (`lib/autonome.ts`).
  Limite : éteint, un réveil horaire (routine) tourne encore et répond RIEN ;
  seule la désactivation de la routine l'arrête (non automatisée).

## Renfort muet : « fini » s'il n'a plus rien à faire, jamais une erreur pour du ménage (5 oct. 2026, migration 0062, chantier b8a2cd53)

Raphaël : « le but c'est que l'erreur soit CORRIGÉE, pas juste faire du ménage ». Cause PROUVÉE sur les renforts cockpit « Base et sessions » (3 chantiers) et « Correctifs » (6) : ils avaient LIVRÉ (PR 63, 70, 72, 73, 74 fusionnées, chantiers « à vérifier »), leur session a été archivée avant leur dernier `renfort.sh --suivant` (le seul à poser « fini »), `renforts_expirer` les a passés en « erreur : plus aucun signe de vie depuis 3 h » sans regarder s'il restait du travail. `renfort_vivant` (0057) était bien la règle en vigueur : la faute était dans la sortie « muet ». UNE règle, `renfort_travail_restant` (chantiers tenus + prenables + vérifications de la section) : muet sans reste = `fini` (`fini_at` = dernier signe), muet avec reste = `erreur` qui dit « il reste N chantier(s) dans la section, à reprendre » (jamais « 3 h »). La migration rattrape honnêtement les anciennes erreurs (fini si plus rien, sinon message corrigé ; rien n'est effacé). `verifier-base` §48 (`SEUL=48`) ; le contrôle de §41 appelait `--verifier` sans lien (refusé depuis 0056) : corrigé.


## Un agent qui travaille garde son chantier (16 oct. 2026, migration 0094, chantier c33c0db9)

Raphaël : « la session travaille, je vois la barre de progression et d'un coup tout s'arrête […] les chantiers sont repris en cours de route ». **Cause mesurée** : sur les 40 dernières libérations (`chantiers.libere_apres_min`), 20 tombaient à 20-31 min, toutes sur des `agent/…` et `renfort/…`. `battement_tour` rendait la main pour un agent (`[ -z "$agent" ] || return 0`) et le « Vie » d'un retour d'outil ne portait pas son `agent_id` : la ligne tâche d'un agent n'était rafraîchie que par ses étapes signalées, donc `agent_tient_chantier` le lâchait après `delai_agent_signale_min` (20 min) en plein travail et un autre le reprenait. **Fait** : `hooks/suivi.sh` bat aussi pour un agent (marqueur par agent, `agent_id` dans le « Vie », nettoyé à SubagentStop) et `cockpit.suivre` rafraîchit `taches.vu_at` de cet agent (événement « Vie » + `agent_id`). `verifier-base` §39 (cas rejoué : agent muet 25 min, libre ; avec un « Vie » de l'agent, gardé). **Limite dite** : un agent qui réfléchit plus de 3 min sans AUCUN outil retombe sur la fenêtre de 20 min de ses étapes ; une session morte (conteneur recyclé, limite d'usage) reste libérée par la règle normale. Le hook arrive aux projets branchés par le lanceur / `brancher --maj`.


## Délai « sans signe de vie » : 3 min -> 60 min (16 oct. 2026, migration 0096)

Raphaël (capture du 16/10, correctif bouche/lèvre resté à 5 %) : « je veux que ça tourne […] si en plus ça stoppe le travail, c'est une catastrophe ». **Cause mesurée** : les agents lancés par la session de réveil (routine) n'ont pas les hooks du dépôt (pas de battement 45 s de 0046) ; ils ne signalent que par `progression.sh`, à plus de 3 min d'écart pendant une lecture ou un calcul. Passé `delai_signe` (3 min) : tuile « ça avance » à 0, réservation libérable puis reprise par une autre session (= l'« arrêt brutal »). **Fait** : défaut de la colonne et des 4 projets encore à 3 -> 60 ; `delai_signe(null)` = 60 ; `DELAI_ABANDON_MIN` = 60 (écran) ; `verifier-base` §39 et `verifier-silence.ts` alignés ; consigne des agents : un signe au moins toutes les 2 min. **Limite** : un agent réellement mort garde son chantier jusqu'à 60 min.


## Voyant des sessions et « Activer une session » (19 oct. 2026, chantier cb3d17df, migration 0102)

Demande de Raphaël : voir d'un coup d'œil s'il y a une session active, pouvoir en activer une d'un toucher, que « Tout lancer » en active une pour tous les correctifs, et un interrupteur quand seuls des messages attendent une réponse.
- Mesuré : depuis l'app il n'y a que la base ; le réveil immédiat ouvre une session de routine (jeton dans le Vault, `reveiller_chef`). La cible est `cible_reveil` : le projet s'il a une chef vivante, sinon la chef relais ; depuis 0098 sans chef vivante la routine est réveillée quand même. Cette routine n'a pas `create_session` : la session réveillée ajoute le dépôt (`add_repo`) et traite le renfort elle-même (commit 7554700, `chef.sh`).
- `etat_sessions(projet)` (lecture admin) : sessions vivantes (`sessions.vu_at` > `delai_signe`, `fin_at` nul), chef vivante, pause, messages qui attendent (`messages_sans_reponse` + `reponses_sans_suite`), dernier réveil. `activer_session(projet)` (écriture admin) : `session_vivante` / `projet_en_pause` / `deja_demande` (écart `reveil_ecart_min`, 5 min) / `envoye` / `pas_configure` / `aucune_chef`. La raison `'activer'` n'est jamais « rien à servir » (`rien_a_servir` ne connaît que chantier, message, réponse), contrairement à 0038 qui n'ouvre que s'il y a quelque chose à servir : un clic explicite réveille toujours ; l'écran ne propose le bouton que si quelque chose attend (chantier, message, renfort demandé).
- Écran : `lib/toutLancer.ts` (`voyantDe`, `messageApresActivation`, `aActiverAvecLancer`), `ToutLancer.tsx`. Hors ligne l'activation échoue visiblement (jamais mise en file : un réveil rejoué plus tard n'a plus de sens, `RPC_EN_DIRECT`).
- Limites : le réveil est partagé par toute la routine (un seul tir par écart minimum) : si deux projets demandent à moins de 5 min, le second voit « déjà demandée » ; le texte du réveil nomme les projets qui attendent. Coût d'une session réveillée (~290 000 jetons) non traité ici. Bancs : `scripts/verifier-voyant.mjs`, `app/scripts/verifier-voyant-ecran.mjs`.

## 19 oct. 2026 — rien ne reste sans lecteur (migrations 0099, 0100, 0101 ; scripts/pr-cartes.sh)
Raphaël : « mes réponses dans Mélissa n'ont pas été prises en compte parce qu'il n'y a pas de session […] les cartes FacePro ne sont pas d'actualité […] il faut que ce soit coordonné en instantané ».
Causes mesurées : (1) `messages_sans_reponse` prenait une CARTE ou une ligne automatique de session (« Fusionne la PR », « Pris par un renfort ») pour une réponse : son message n'était plus « sans réponse » (0100). (2) `filet_passe` s'abstenait dès qu'un agent avait donné signe de vie dans l'heure, alors qu'il travaille sur un autre chantier et ne lira rien (0101). (3) Une carte « Fusionne la PR #n » n'était retirée que par la passe d'une chef vivante : la PR #92 de FacePro, fermée depuis 20 min, restait affichée. Retrait maintenant par `scripts/pr-cartes.sh` (hooks de démarrage et de message, état réel lu sur GitHub, 3 min) et, pour les dépôts PUBLICS, par la base seule (`cockpit.pr_cartes_passe`, pg_cron 2 min, 0099). Limite : FacePro est privé, la base ne peut pas le lire sans jeton GitHub de lecture ; seules les sessions (qui ont leur accès) retirent ses cartes.
