# Historique — Messages, fils, discussions, cartes, bulle

Déplacé tel quel de `CLAUDE.md` le 15 oct. 2026 (chantier 1af98322, décision de Raphaël : « Oui, je déplace »). Rien n'est supprimé : ce sont les dates, causes prouvées, numéros de migration et limites de chaque chantier. Les règles à appliquer restent résumées dans `CLAUDE.md` ; ce fichier se lit à la demande, quand on touche au sujet.

## Un message n'est pas un chantier : le fil, la pastille, et le filet « travail sans chantier » (16 oct. 2026, migration 0091, chantier c2c79e7b)

Raphaël (capture de « Ça avance tout seul », FacePro, 16 oct. 00 h 45) : « chaque message que je crée en discussion est transcrit comme un chantier avec une progression […] il vaut mieux une petite pastille de notification et la discussion concernant le chantier en question. Quand on clique sur la barre de progression du chantier, pas que chaque message devienne un chantier avec une barre. » Il avait entouré « Ca en es ou cest finit » (0 %) et « Vas-y teste toi la piste du relighting voir ce que ca donne » (35 %).

**Cause MESURÉE (base réelle)** : 0087 (`chantier_auto_depuis_message`) ouvrait un chantier pour tout message de session d'au moins 35 caractères et 6 mots dès que la session n'en tenait pas un qui lui RESSEMBLAIT (trigrammes : « Ca en es ou cest finit » ne ressemble à rien). FacePro : 14 chantiers dont le titre est copié de ses mots, 4 « en cours » avec une barre, alors que le vrai chantier du sujet existait (« Scintillement : diagnostic gratuit puis une piste sans surcoût »). Trois aggravants : `signaler_action_live` recopiait la MÊME action sur jusqu'à 3 chantiers tenus (3 barres « Au travail » pour une seule chose) ; `signaler_activite` ne levait jamais `pct_estime` (une barre à 35 % restait marquée « sans pourcentage ») ; l'écran écrivait « 0 % » pour une barre sans pourcentage.

**Règle (générale, aucun réglage par projet) : un chantier est un SUJET de travail qui dure ; un message est une ligne dans un fil.**
- `chantier_auto_depuis_message` (même nom et même signature : les hooks de tous les projets l'appellent) n'ouvre plus JAMAIS un chantier. Il consigne le message, puis le dépose TOUT DE SUITE dans UN fil : `cockpit.chantier_du_message` = le chantier que la session tient s'il n'y en a qu'un, le plus ressemblant (score ≥ 0,25) s'il y en a plusieurs, sinon la discussion du projet (hors chantier). Jamais un chantier que personne ne tient, jamais un livré (« jamais dans un fil étranger », 0029). Un message de moins de 3 mots / 12 caractères (« ok », « merci », « vas-y ») n'est déposé nulle part (gardé 1 jour, comme avant). `cockpit.chantiers_de_la_session` = UNE règle (réservés à la branche, ou étape signalée il y a peu ; le dernier avancé d'abord, jamais `updated_at` que la prolongation de réservation touche).
- La session RÉPOND dans le bon fil ; sa première réponse explicite DÉPLACE le message (`rattacher_messages_session` : `progression.sh --chantier <autre id> --point`, ou `--point` seul pour la discussion du projet), les suivantes le COPIENT (un message à plusieurs sujets). `messages_session_attente.message_id/confirme/au_projet` portent cet état. Un autre chantier existant : `chantier.sh --chercher "<mots>"`.
- Le hook d'arrêt (`hooks/autonome.sh`) réclame UNE fois la réponse écrite dans le fil où le message a été rangé (`fils_du_tour_sans_reponse`, la discussion du projet comprise), puis laisse partir.
- **Filet « travail sans chantier »** (remplace l'ouverture par message : un chantier naît d'un TRAVAIL, pas d'une phrase) : `hooks/suivi.sh` compte les modifications de fichiers de la session elle-même (`$TMPDIR/cockpit-travail-<session>`, remis à zéro à chaque vrai message) ; si elle en a fait au moins 3 (`COCKPIT_TRAVAIL_MIN`) et ne tient AUCUN chantier, l'arrêt est refusé UNE fois par tour avec « TRAVAIL SANS CHANTIER » (chercher l'existant, le reprendre ou l'ouvrir). Jamais pour un renfort, un agent, ni une session sans tour.
- **Une session fait UNE chose à la fois** : `signaler_action_live` garde vivante la barre d'UN chantier (le dernier avancé) et écrit l'action (secrets masqués) sur `sessions.action_live` SEULEMENT ; `signaler_fin_tour` efface l'action et passe la barre « en attente ». **Donnée interne séparée côté serveur** : avant 0091 l'action (« Lance : <commande> », nom de fichier) était écrite dans `activite.action_live`, table lisible par les membres invités (`membre_activite`) alors qu'une commande peut porter un secret ; l'écran la lit maintenant sur la session (`actionDeLActivite`, table réservée à l'admin). Aucun membre invité n'existait au 16 oct. (table `membres` vide) ; les anciennes valeurs de 0087 restent dans `activite.action_live` jusqu'à la fin de tour de leur session (plus lues). `signaler_activite` lève `pct_estime` dès que la session donne un pourcentage.
- **Écran** : « Ça avance tout seul » ne montre que de vrais chantiers ; une barre sans pourcentage dit « au travail » (une barre en mouvement), jamais « 0 % » (`sansPourcentage`, UNE règle dans `lib/presence.ts`) ; une conversation SANS chantier est UNE ligne sans barre (`LigneSession`), qui dit ce que Claude fait à l'instant (`actionEnDirect`), avec la pastille « Réponse » de la discussion du projet ; un toucher sur la ligne d'un chantier ouvre SA discussion, sur la ligne d'une conversation la discussion du projet ; ouvrir une discussion éteint sa pastille.
- **Consignes** : `docs/bloc-CLAUDE.md` (« UN MESSAGE N'EST PAS UN CHANTIER »), `hooks/prompt-rappel.sh`, `hooks/suivi.sh` (texte donné à la session), `scripts/chef.sh` (agent « Répondre » : seulement un VRAI sujet de travail distinct, jamais une question ni un point d'avancement).
- **Le ménage de l'existant est une décision de Raphaël, pas une réécriture silencieuse** : `cockpit.ranger_chantiers_nes_de_messages(slug, essai := vrai)` liste (sans rien écrire) les chantiers `titre_auto` « purs » (ses mots, aucune étape, aucun travail livré) qui seraient archivés (« Désarchiver » le rend) avec leurs messages recopiés dans la discussion du projet, et ceux « à voir » (du vrai travail dessus) avec le chantier le plus proche à fusionner. Pour l'appliquer (`essai := faux`) sur un vrai projet : l'accord PRÉCIS de Raphaël, commande et cible nommées (la plateforme refuse sinon l'écriture en masse).
- **Limites dites** : le rangement par défaut ne devine pas le sujet (seul un chantier TENU par la session est choisi, pas de recherche dans tout le projet) : c'est la session, qui connaît le contexte, qui corrige en répondant ; une réponse sans `--chantier` pendant un tour déplace aussi le message de ce tour vers la discussion du projet ; une session sans tour (réveil, mode autonome) n'a ni message à ranger ni relance ; le nom d'une conversation reste le début de son premier message (`sessions.sujet`).
`verifier-direct.mjs` (50), `app/scripts/verifier-messages.mjs` (23), `app/scripts/verifier-messages-fils.ts` (16).

## Les cartes déjà traitées se retirent seules, chaque ligne a sa date (16 oct. 2026, migration 0092, chantier fe412d83)

Raphaël (16 oct., trois captures de tablette) : « les anciens chantiers ne s'actualisent pas en fonction de ce que les sessions ont avancé […] des questions d'il y a 2 jours, il me semble que les tests ont déjà été effectués […] le cockpit ne vérifie pas ce qui a été fait […] le but, c'est d'épurer » ; « j'ai pas la date ni l'horaire de quand ça date » ; et, sur le lien « Cette carte n'a pas lieu d'être : la retirer » : « pourquoi est-ce que je devrais faire une action manuelle ? […] perte de temps, pollution visuelle. **Je veux vraiment que ce soit automatisé.** »

**Causes MESURÉES (base réelle, 16 oct.)** : (1) la seule revue des cartes (`a_toi_a_revoir` + l'agent « Revoir À toi » de la chef) n'est JAMAIS passée sur FacePro, Melissa ni le Trieur (`projets.revue_a_toi_at` nul) : elle exige une session chef vivante, donc rien ne tournait seul ; (2) sa preuve « Claude a avancé » ne regarde que le chantier de la carte, or les sessions traitent des LOTS : les 14 cartes FacePro de plus de 24 h n'avaient aucun message ni aucune étape de session sur LEUR chantier depuis qu'elles étaient posées, alors que le projet avait reçu 19 à 66 livraisons et 42 à 231 mots de Raphaël (dont un accord global « jusqu'à 7 $ de GPU » dit dans la conversation, jamais rattaché à chaque carte). Le lien « la retirer » ne faisait que déplacer le travail sur lui.

**Règle (générale, aucun réglage propre à un projet)** : UNE règle en base, `cockpit.carte_depassee(message)` (rend NULL ou la raison en mots simples), lue par UNE passe, `cockpit.epuration_passe(slug, essai, test)`, que pg_cron lance toutes les 3 min (`cockpit-epuration`, sans session ni chef). Une carte question/action ouverte est retirée quand, APRÈS le délai du projet (`projets.epuration_delai_h`, 24 h par défaut, 0 = jamais ; une **action** attend 7 fois plus, seule une preuve forte la retire), rien ne l'a gardée vivante ET le travail a continué sans elle : (a) son chantier a été livré depuis (étape `termine`, ou « à vérifier » / « validé » après la carte) ; (b) une session a travaillé sur ce chantier depuis (message de session hors question/action/fusion, étape, tâche) ; (c) le projet a avancé sans elle : au moins une livraison de session ET au moins un mot de Raphaël (info/constat/réponse, hors « J'ai retiré la carte… » et « Doublon fusionné… ») depuis qu'elle existe. **Jamais** : une carte qu'une session confirme (`demander.sh --confirmer`, le délai repart), qu'il a remise (`epuration_exclue`), dont il a écrit un retour en attente (« Ça bloque », `retour_at`), dont le chantier est tenu par une session ou un agent VIVANT (`sans_signe_de_vie` : c'est à elle de garder ses cartes), une carte de fusion (décision de produit), un projet `test-…` (sauf demandé), ni quand l'interrupteur général est éteint (`filet_reglage.epuration_actif`).

**Rien n'est perdu, tout se défait** : le retrait écrit `answered_at`, `reponse = 'Retirée automatiquement : <raison>'` et `retiree_seule_at`, et **ne pose JAMAIS `answered_by`** (ce n'est pas une réponse de Raphaël : aucun réveil de chef via `reveil_sur_message`, jamais « à reprendre » par `reponses_sans_suite`, vérifié par §59). `restaurer_carte(id)` rouvre la carte (âge repart d'aujourd'hui, `epuration_exclue` : plus jamais retirée seule). **Une carte retirée seule n'est JAMAIS remise à une session comme « sa réponse »** (une non-réponse n'est pas un accord, surtout pour une dépense) : `hooks/suivi.sh` et `hooks/session-start.sh` l'excluent (`retiree_seule_at is null`), `remettre_orphelins` et la chef passent par `reponses_sans_suite` (qui exige `answered_by`) ; preuve avec les vrais hooks dans `verifier-reponses.mjs` (5 ter) : avec les hooks d'AVANT ce correctif (`VERIFIER_HOOKS=<copie de HEAD>/hooks`), 2 des 3 contrôles échouent (65/67 : la session recevait « il a répondu à « Je lance le rendu payant de 38 dollars ? » → Retirée automatiquement… »), avec les hooks corrigés 67/67. Une carte dont le chantier est archivé reste fermée par le déclencheur `retirer_sans_objet` (0022), inchangé.

**Écran** : « N cartes retirées seules · Voir » sous « À toi de jouer » (vue complète et vue simple ; n'apparaît que s'il y en a eu ces 7 derniers jours, jamais une ligne vide) → fenêtre « Retirées seules » : la carte, « Retirée il y a 3 h · 05:44 : restée 46 h sans réponse… », « Remettre » (confirmation par toast, échec visible) ; dans le fil, la carte garde sa trace (« Retirée seule · … : raison ») avec « Remettre ». Le lien manuel « la retirer » a disparu (`BlocQuestion.tsx`) ; `retirer_carte` (0070) reste en base pour les scripts. **Chaque ligne de « Pour toi » et de « à tester » dit son âge ET son heure** (`ageEtHeure`, `lib/dates.ts` : « il y a 3 h · 05:44 », « hier 02:44 », « il y a 2 j · 14 oct. 23:22 ») et la liste met en haut ce qui attend depuis le moins longtemps (`ordrePourToi`, comme « À toi de jouer »). **Réglage** : Réglages du projet › « Cartes déjà traitées » (`EpurationProjet`, admin, toujours accessible même avant tout retrait) : un champ d'heures (0–720, 0 = jamais), « Maintenant : après 24 h », message de succès ou d'échec, état vide « Rien n'a été retiré seul ces 7 derniers jours » ou la ligne « N cartes retirées seules · Voir » ; SQL : `select cockpit.regler_epuration('<slug>', <heures>)` ; interrupteur général `regler_epuration(null, null, false)` (coupe aussi le job).

**Premier passage réel (16 oct., 08 h 33 UTC)** : 13 cartes FacePro retirées (9 jours / 46 h / 36 h / 35 h sans réponse, 19 à 66 livraisons depuis), raison écrite sur chacune ; il en reste 2 d'ouvertes dans toute la base, à raison : « Recharge le compte RunPod » (action, 9 h) et la question d'argent du Trieur (« Pour 60 millions de leads, il faut une offre Supabase payante. On la prend ? », 42 h, aucune livraison ni mot de lui depuis : une vraie décision d'argent, jamais retirée). **Trois heures plus tard (12 h 40, heure d'Israël), les sessions de FacePro avaient reposé 6 de ces sujets avec la date du jour** (d'après leur texte : « as-tu de nouveau du budget GPU pour 5 rendus de test (environ 1,7 $) ? », « Je lance un rendu GPU de test (environ 1 $ au plus)… », « Crée une nouvelle clé fal avec tous les droits »…) : le ménage ne cache donc pas ce qui compte encore, la session le redemande, et chaque carte vue est désormais récente. Revers à connaître : une question retirée alors qu'elle valait toujours (ici, le budget GPU de l'accord « jusqu'à 7 $ » était sans doute épuisé) revient d'elle-même mais seulement quand une session reprend le chantier. Même jour, FacePro : les 18 chantiers nés de ses messages ont été archivés après son « Oui, les 18 » (carte feac1dcd).

**Limites dites** : (1) la règle (c) est un jugement par signes (livraison + mot de lui), pas une lecture de git ni du contenu : une carte qui reste vraiment utile se garde avec `--confirmer`, ou se remet d'un toucher ; (2) les chantiers `a_cadrer` / `bloque` ne sont PAS rangés seuls (ceux de Melissa sont ses propres à-faire importés : les parquer serait faux) et les cartes de **fusion** ne sont pas acceptées seules (décision de produit à prendre) ; (3) la ligne « N cartes retirées seules · Voir » de « À toi de jouer » n'apparaît qu'une fois une carte retirée dans les 7 jours (jamais une ligne vide de plus à l'écran), alors que le réglage du délai est toujours dans Réglages du projet ; (4) l'interrupteur général n'est pas exercé par le banc (il couperait le vrai job) ; (5) non vérifié sur une vraie session FacePro qui poserait une nouvelle carte (le premier passage réel s'est fait sur les cartes déjà là) ; (6) la règle (c) retire aussi une **question d'argent** (au moins 9 des 13 retraits FacePro du 16 oct. demandaient un accord pour une dépense, de ~1 $ à ≈ 38 $ par jour) dès que le projet avance sans elle : rien n'est dépensé (jamais un accord), la carte reste 7 jours dans « Retirées seules », le chantier garde son état ; si Raphaël veut que les questions d'argent ne se retirent jamais seules, c'est une décision à lui (un mot-clé dans la règle, ou un délai plus long comme pour les actions).
`verifier-epuration.ts` (31, règles pures, vérifié dans cinq fuseaux horaires), `app/scripts/verifier-epuration.mjs` (38, téléphone, vraie base, projet jetable), `verifier-base` §59 (37 : règle sur une table de cas, essai sans écriture, jamais `answered_by`, jamais `reponses_sans_suite`, délai 72 / 0 / 721, permissions, job, grants, défaut base = défaut app, essai sur tous les vrais projets).

## Réponses du cockpit en direct (29 sept. 2026)

Quand Raphaël répond ou écrit dans le cockpit sur un chantier qu'une session
tient (réservé à sa branche, ou suivi par un de ses agents), `hooks/suivi.sh`
(PostToolUse, toutes les 20 s au plus, 3 s max) le met sous les yeux de la
session avant son prochain pas. Une session à l'arrêt le reçoit à son réveil
(UserPromptSubmit, sans attendre les 20 s ; la chef : au plus une heure).
Un agent reçoit les réponses de SES chantiers (`agent_id` + branche de son
dossier), avec son propre curseur. Curseur = heure de la base au dernier
passage réussi (une panne ne fait rien perdre). Nouvelle session : le hook de
démarrage montre « Ses RÉPONSES que personne n'a encore prises » : la MÊME règle
que la chef, `reponses_sans_suite(projet, sa branche)` (0018 ; jamais réécrite
dans le hook), et pose le curseur.
Bilan du 29 sept. et preuve : `node scripts/verifier-reponses.mjs` (16
contrôles, vrais hooks, vraie base, projet jetable). Le cas « personne ne
tient le chantier » relève de `scripts/chef.sh` (chantier 6c8c6084).

## « Où ça en est ? » se suit, jamais empilé (29 sept. 2026, migration 0023)

Raphaël : « on ne voit pas de différence en cliquant […] qu'on ne pollue pas
les sessions en cliquant 10 fois, et que ça ne reste pas statique ». L'app
passe par `demander_ou_en_est` : UNE demande en attente par chantier
(`messages.ou_en_est`), un deuxième toucher rend la même (verrou, 10 touchers
= 1 ligne). Répondue = un message de session après elle ; périmée après
`delai_ou_en_est()` (2 h, = `DELAI_OU_EN_EST_MS` de `lib/ouEnEst.ts`,
comparés par verifier-base §24). Suivi : envoyée → reçue (`recu_at`, posé par
`hooks/suivi.sh` en la remettant à la session qui tient le chantier) ou en
file (position) → un assistant regarde (la chef : `prendre_ou_en_est`, branche
`agent/point-…`, sans réserver le chantier) → réponse (`progression.sh
--point`, `repondre_ou_en_est`, `repond_a`). Dans l'app, le chantier passe
dans « Ça avance tout seul » avec une frise, bouton désactivé tant qu'on
attend ; la réponse y reste un quart d'heure. `verifier-reponses` §7-8.
**30 sept. (migration 0032, correction de Raphaël : « la barre ne se réactive
pas, je ne comprends pas ce qu'il reste à faire »)** : sous une demande en
attente, plus jamais la vieille barre grise d'une livraison passée (point
vivant + frise) ; l'assistant « Point » signale d'abord son étape sur le
chantier (`--agent "Point : …" --chantier`), la ligne redevient VIVANTE avec
sa barre ; sa réponse dit « Fait / Pour finir (qui fait quoi) / Bloque ». UN
seul assistant par fil : `prendre_ou_en_est` prend aussi les messages libres
du chantier, `reprendre_message` la demande en attente (`ou_en_est`) ; l'app
dit « Un assistant regarde » pour toute branche `agent/…`. Les consignes de
`chef.sh` commencent par « switch -c <branche> » : une copie isolée signait
« worktree-agent-… » (`progression.sh` le signale). `verifier-reponses` §8 bis.

## Chaque fil est une discussion (29 sept. 2026, migration 0025)

Raphaël : « la même logique qu'une discussion dans une session […] je pose des
questions du type "je n'ai pas compris ta demande" et je n'ai pas de retour […]
que le dernier artefact où je dois choisir des cartes se mette toujours en
dernier […] comme une discussion WhatsApp. » **Règle : un message de Raphaël
dans un fil = une réponse courte de Claude dans ce fil avant de continuer** (une
étape ne compte pas). UNE commande : `progression.sh --point "…"` (avec
`--chantier <id>`, ou sans pour le fil du projet) → `repondre_dans_fil`, par
laquelle passe aussi `repondre_ou_en_est` (repond_a : la demande « où ça en
est » en attente, sinon son dernier message). UNE règle « message libre » :
`cockpit.est_message_libre` = `estMessageLibre` (`lib/discussion.ts`),
comparées par verifier-base §26 ; `messages_sans_reponse(projet, branche)` sert
le hook de démarrage ET la chef (`reprendre_message` → agent « Répondre : … »,
branche `agent/message-…`, chantier réservé 60 min sans changer d'état) ;
`hooks/suivi.sh` le remet à la session qui tient le chantier et le marque reçu
(`marquer_messages_recus`). App (`Conversation.tsx`) : chronologique, plus
récent en bas, ouverture en bas, Claude à gauche / toi à droite, les cartes
(question, fusion, vérification, décision) TOUJOURS en dernier, et après son
message « réponse en attente » (qui, et le prochain passage de la chef :
`prochain_passage_chef`, `chefs.reveil_minute` posé par `chef.sh --reveil …
--minute`). `verifier-reponses` §9-11.

## Session et cockpit : deux portes égales, un sujet = un fil (29 sept. 2026, migration 0028)

Raphaël : « tu réponds en essayant de tout condenser dans un message […] je
zappe certaines choses. Le but du cockpit est de créer des chantiers et une
ligne avec un chat sur chaque sujet […] le mettre de côté, l'abandonner ou le
reporter […] en live » ; « on peut utiliser peu importe soit le cockpit soit la
session Claude ». Complète la PR #7 (0027 : ses mots tapés en session sont
recopiés dans le fil).
- **Côté session** : `hooks/prompt-rappel.sh` ouvre un « tour » à chaque VRAI
  message (fichier `<.git>/cockpit-tour`, même filtre que `suivi.sh`) et dit
  « un sujet = un fil » ; `chantier.sh --ouvrir` y note le chantier ; le hook
  Stop (`autonome.sh`, déjà déclaré partout : rien à relancer) refuse l'arrêt
  UNE fois si un chantier du tour n'a aucune réponse de session dans son fil
  depuis le message (`--point` ; la ligne « Chantier ouvert/repris… » ne compte
  pas). La session répond normalement ici ET dans chaque fil.
- **Ses mots tapés en session vont dans le BON fil, seulement lui (30 sept.
  2026, migration 0029)** : constaté sur FacePro, ses questions RunPod
  apparaissaient dans des chantiers sans rapport (déposées dans CHAQUE
  chantier tenu par la session, puis rattachées à tout chantier pris ensuite,
  mode autonome compris) et des rapports d'agents (« <agent-message ») y
  étaient signés « Raphaël (session Claude) ». Désormais `suivi.sh` garde le
  message en attente, et SEULS `chantier.sh --ouvrir` et `progression.sh
  --point`, pendant le tour de ce message, le rattachent à leur chantier
  (`rattacher_messages_session(projet, session, chantier, début du tour)`).
  Plus de trigger sur `pris_par`. Filtre des hooks : `agent-message` et
  `teammate-message` exclus. `verifier-base` §28, `verifier-reponses` §12.
- **Côté cockpit** : case « Écrire à Claude sur ce projet… » (vue projet,
  `EcrireAuProjet`) → « Discussion du projet » ; un message multi-sujets est
  réparti par l'agent « Répondre » de la chef (un chantier par sujet, une
  réponse par fil). Menu ⋯ du fil : Mettre de côté, Reporter… (4 choix ou une
  date, `lib/reporter.ts`), Abandonner (archivé, Désarchiver le rend) →
  `mettre_de_cote`, `abandonner_chantier` (admin ou session :
  `chantier.sh --de-cote|--abandonner`). Un report daté revient seul dans
  « Prêt à lancer » (`reveiller_reportes` : passe de la chef, ouverture de l'app).
- **Projet sans chef vivante** (`chef_vivante` : vue < 3 h) : LA chef relais
  (`chef_relais()` : celle du cockpit si elle vit) ouvre ses renforts et, s'il a
  des messages sans réponse et aucune session vivante, UNE session du projet
  (« [cockpit-relais] », au plus 1/h, `chef.sh --ouverture`) — jamais son
  travail ni sa réponse d'ici (`relais_a_servir`, `chef.sh --relais-texte`).
  Une session relais ne devient jamais chef. L'app : « en attente : aucune
  session <projet> active · la session chef de cockpit l'ouvre vers HH h MM ».
- **Réveil immédiat** (déclencheur API d'une Routine, doc « routines » lue le
  29 sept. : `POST https://api.anthropic.com/v1/claude_code/routines/<trig>/fire`,
  `Authorization: Bearer`, `anthropic-beta: experimental-cc-routine-2026-04-01`,
  `anthropic-version: 2023-06-01`, corps `{"text"}`). Raphaël colle adresse +
  jeton dans Réglages du projet (`ReveilImmediat.tsx`) → `regler_reveil_immediat`
  met le jeton dans le COFFRE (Vault), jamais dans une table ; un trigger sur
  ses messages libres, ses réponses et les demandes de renfort appelle
  `reveiller_chef` → pg_net (après validation), au plus 1 / 5 min par projet,
  rien si une session vivante tient le chantier ; cible = `cible_reveil` (sa
  chef vivante, sinon la chef relais ; un projet de test : lui seul). Sans
  jeton : passage horaire, l'app dit l'heure (`prochain_passage_chef` ; ~3 min
  après un réveil).
- **/fire ouvre une NOUVELLE session** (constaté le 30 sept. au premier jeton,
  conforme à la doc : « starts a new session ») — jamais la session chef, même
  si la routine y est liée pour ses passages horaires. Cette session n'a que
  les dépôts de la ROUTINE : sans le dépôt, elle répondait « Cockpit-General
  n'est pas cloné ici ». Il faut donc (1) le dépôt du projet dans les dépôts de
  la routine (claude.ai/code/routines › la routine › menu › Edit ; action de
  Raphaël, aucun outil ne le fait ; fait le 30 sept., vérifié : son message
  de 00:23:11 → session ouverte par /fire → réponse dans le fil à 00:24:08),
  la routine sur l'environnement qui porte les clés Supabase ; (2) son prompt = `chef.sh --texte-routine` (un seul texte
  pour les deux cas ; commence par « Réveil du chef », donc le hook de message
  ne fait pas d'elle la chef), qui lance `chef.sh --releve` : la chef → la
  passe ; une autre session → si la chef vit (`chef_vivante`), elle sert
  SEULEMENT ce qui attend Raphaël (réponses, « où ça en est », messages) sans
  toucher au signe de vie de la chef, puis s'arrête ; chef morte → elle devient
  chef (sans déplacer le réveil). Une routine qui porte le jeton ne se supprime
  jamais (le jeton mourrait avec). `verifier-base` §19 (« routine de réveil »).
`verifier-base` §29, `verifier-reponses` §13-14, `verifier-reporter.ts`.
- **« Il faudrait aussi X » écrit dans un fil → Claude crée le chantier**
  (30 sept. 2026, migration 0033, chantier 7b85b3bd ; Raphaël : « plutôt que
  de quitter ce chat et de créer un nouveau chantier manuellement »).
  `chantier.sh --ouvrir "<titre>" --demande "<ses mots>" --depuis <id du fil
  | projet> [--reponse "…"] [--section …]` → `ouvrir_depuis_fil` : chantier
  créé « libre » (Prêt à lancer, NON réservé à l'agent qui répond : avant,
  `--ouvrir` le laissait « en cours » réservé 3 h à personne de réel), rangé
  (`--section`, sinon Correctifs 0021, sinon la section du fil) ; si le sujet
  existe et vit, sa demande est complétée sans toucher à état ni réservation ;
  un livré/certifié/archivé n'est jamais rouvert (nouveau chantier). La
  réponse part dans le fil d'origine par `repondre_dans_fil` (elle compte
  comme réponse) avec `messages.chantier_lie` → bouton « Ouvrir ce fil » dans
  la bulle (`filLie`, `lib/discussion.ts`) ; le nouveau fil renvoie à
  l'origine. Même recherche de doublon que `ouvrir_ou_reprendre`
  (`trouver_chantier`, une seule règle). Consignes : agent « Répondre » de
  `chef.sh` (point 3), session relais, `hooks/suivi.sh`, hook de démarrage,
  bloc CLAUDE.md. `verifier-base` §31, `verifier-discussion.ts`.

## Questions et assistants toujours à jour (29 sept. 2026, migration 0015)

Une question ouverte que du travail a suivie s'affiche « Claude a avancé
depuis : peut-être plus utile » ; la session la confirme (`demander.sh
--confirmer`) ou la retire (`--retirer <id> "pourquoi"`), rappel du hook
toutes les 15 min. Un assistant listé en cours reste « en cours » tant que sa
session vit (trigger 0015 : `taches.vu_at` suit `sessions.vu_at`) — SAUF une
ligne provisoire `prov:…` (migration 0030, 30 sept.) : elle ne vit que par
ses étapes, passe « arrêtée » après `delai_tache_prov()` (45 min) sans étape,
et `progression.sh --chantier X --termine|--echec` ferme celles de sa session
sur X. `chef.sh` compte ses agents par `agents_actifs(session, projet)`.
**Un agent = une seule ligne comptée (30 sept. 2026, migration 0048, chantier dd84764f)** :
Raphaël voyait la chef répondre RIEN (« 8 agents ») avec 6 chantiers en attente. Mesuré : les
commandes de fond (`wait`, `until`, tests ; type `commande`/`autre`) n'ont jamais été comptées ;
c'est un DOUBLON : un agent = sa vraie ligne (hook, description de l'outil Agent) + sa ligne
`prov:` (`progression.sh --agent`, sa propre description), jamais réunies quand les deux textes
diffèrent (9 lignes pour 6 agents). `agents_actifs` = vraies lignes vivantes + provisoires en
surplus des vraies lignes muettes (sans étape ni chantier). Plafond `chefs.max_agents` : 1 à 8
(check en base), inchangé. `verifier-base` §30.
Incident : 5 agents fantômes bloquaient la chef parce que
`.claude/settings.json` était du JSON invalide (deux objets collés, commit
f2b6c98) : Claude Code ignore alors TOUS les hooks du projet, sans erreur
visible. `chef.sh` affiche désormais une ALERTE, la CI rougit.
`verifier-base` §30.

**« À toi de jouer » à jour** (29 sept. 2026, migration 0022, Raphaël : « des
requêtes d'il y a 12 h déjà répondues dans la session ; je ne sais pas
lesquelles sont récentes ou vieilles »). Chaque ligne dit son âge (« il y a
12 h », `ElementAToi.depuis`), le plus récent en haut (réglable, préférence
`tri_a_toi`) ; « Claude a avancé depuis : peut-être plus à jour » vaut pour
TOUS les types et passe en bas (`aToi`, `lib/entonnoir.ts`). En base (trigger
`retirer_sans_objet`) : un chantier certifié ou archivé ferme les fusions qui
le citent ; un chantier ARCHIVÉ ferme aussi ses questions, un CERTIFIÉ les
GARDE (migration 0026, 29 sept. : une question sur une décision future,
876ad67b, fermée en certifiant 450afa9e). « Ça marche » montre d'abord les
questions ouvertes du chantier (répondre, ou « Certifier quand même » :
`BlocValidation`, `questionsOuvertesDe`) ; elles restent dans « À toi ».
Piège : `certifier_chantier` pose AUSSI `archived_at` (« Fini ») ; toute règle
qui écarte les archivés garde les certifiés (`aToi`, `a_toi_a_revoir`,
`reponses_sans_suite`). Une réponse à une question d'un certifié : la chef
ouvre un chantier « Suite de ta réponse » (le certifié n'est jamais rouvert).
`verifier-base.mjs` §27 ; `a_toi_a_revoir(projet, heures)` (même
règle que l'app ; plus de 12 h, ou du travail depuis ; jamais un chantier
qu'une session tient ; « proche » = doublon probable) ; `scripts/revue-a-toi.sh`
en fait la consigne d'un agent, lancée par `chef.sh` sur une place libre ou
par `passe.sh` quand il n'y a rien à coder, au plus une fois par heure et par
projet (`projets.revue_a_toi_at`). Gestes : `demander.sh --retirer`,
`--confirmer <question|chantier>` (`chantiers.a_toi_revu_at`), `--debloquer`,
`chantier.sh --suggerer-fusion`. `verifier-base.mjs` §23.

## Médias dans les réponses (29 sept. 2026, migration 0013)

Raphaël répond avec des cartes ET des photos/vidéos/fichiers (bouton 📎 sur
une question, « Écrire à Claude », certifier/corriger). Stockage PRIVÉ
`cockpit-medias` (le bucket `cockpit` est à Jarvis), chemin
`<projet>/<chantier|projet>/<uuid>-<nom>`, droits par `peut_lire_media` /
`peut_deposer_media` ; colonne `messages.medias`. Les RPC de réponse ne portent
pas de fichier : les médias partent dans un message `info` juste après. Une
session les récupère avec `scripts/media.sh --message|--chantier <id>` (📎 dans
le hook) et les REGARDE avant de répondre.
Dès la création aussi (« + Chantier », 29 sept.) : le chantier n'a pas d'id
avant, donc les fichiers restent sur l'appareil (crayon possible), l'id est
choisi par l'app à l'insertion, puis ils partent dans `<projet>/<chantier>/`
et un message `info` (`useMediasAJoindre(…, { differe: true })`). Dépôt en
échec : chantier créé, pièces gardées, « Envoyer les pièces ». Le module
embarqué (`embed/`) ne joint PAS de fichier : décision à prendre à part.
**Crayon** (29 sept.) : sur toute image jointe (import fini), dessiner dessus
(`Annoter.tsx`, un `<canvas>`) ; avant l'envoi l'annotée remplace la pièce,
après l'envoi elle part en nouveau message « Image annotée : … » du fil.
`verifier-annotation.ts`, et les contrôles « crayon » de `verifier-web.mjs`.

**Et dans l'autre sens : montre, ne décris pas** (29 sept. 2026, migration
0020, Raphaël : « montre-moi des images pour que je comprenne mieux, ou ce
que je suis censé voir »). Une question ou une vérification qui porte sur
quelque chose de visible → joins une capture : `demander.sh --image f.png`
(dans `messages.medias`, miniature sous la question), `progression.sh
--termine … --verifier … --image f.png` (`chantiers.verifier_medias`, « Ce que
tu dois voir » sous les étapes ; un `--termine` sans image efface les
anciennes), `media.sh --envoyer --chantier <id> --texte "…" --image f.png`
(message du fil). Contrôle AVANT toute écriture (`media.sh
--verifier-images` : png/jpg/webp/gif/mp4/webm, 4 au plus, 10 Mo) ; dépôt
service_role dans `cockpit-medias` au chemin du chantier (les droits de
lecture suivent donc ceux du chantier). Écran du cockpit : `node
app/scripts/capture-ecran.mjs <url> <dossier>`. Pas encore affiché par le
module embarqué (`embed/`) : seulement l'app.

## Une action manuelle = lien exact + étapes + texte à coller (30 sept. 2026, migration 0033)

Raphaël (chantier e9a7c360) : « à chaque fois il faut que j'aille chercher et
ce n'est pas assez précis. Il faut que Claude renvoie les liens précis et les
démarches précises pour faire simplement des copier-coller […] peu importe le
type de chantier et dans toutes les discussions. Et un visuel si ça peut
aider. » Règle GÉNÉRALE, pour toutes les sessions de tous les projets
branchés (bloc `docs/bloc-CLAUDE.md`, consignes d'agents de `chef.sh` et
`renfort.sh`) : tout geste demandé à Raphaël donne la page EXACTE, un geste
numéroté par étape (nom exact du bouton), chaque chose à taper prête à coller,
une capture quand ça aide — dans le cockpit ET dans la session. Outil :
`demander.sh --action --lien "https://…|libellé" --etape "…" --copier
"libellé|texte" [--image f.png]` → `messages.marche` (jsonb). Le script
refuse AVANT d'écrire (`scripts/marche.py`) : action sans lien (sauf
`--sans-lien "pourquoi"`) ou sans étape, lien http/page d'accueil, plus de
3 liens / 8 étapes / 4 textes, un texte sans libellé, un SECRET (motifs de
jetons connus). App : `MarcheASuivre.tsx` sous la question (bouton vers la
page, nouvel onglet, domaine affiché ; étapes numérotées ; « Copier » qui dit
« Copié » ou l'échec), lecture défensive `lib/marche.ts` (https seulement),
copie commune `lib/copier.ts`. Pas encore dans le module embarqué (`embed/`) :
une action s'adresse à Raphaël, pas à l'utilisateur final. `verifier-base`
§31, `verifier-marche.ts`, `verifier-web.mjs` (« action manuelle »).

## Bulle flottante d'aide : visible par défaut (30 sept. 2026, chantier 851282af)

Raphaël : « Actuellement il n'y a aucune bulle dans le cockpit. » Trois causes
prouvées : (1) préférence `bulle_flottante_aide_<projet>` lue par `Boolean(...)`
= ÉTEINTE par défaut ; (2) rendue seulement `{d.projet ? … }`, donc jamais dans
« Tout », et hors du contexte projet (`useCockpit hors du CockpitCtx` : l'écran
d'un projet plantait dès qu'elle s'affichait) ; (3) l'app ne lisait que 1000
messages sur 1129 (max-rows du serveur, `.limit(5000)` ignoré, tri ancien →
récent : les 129 DERNIERS, réponses de Claude comprises, restaient invisibles ;
`useDonnees` lit maintenant par pages de 1000). Règles (`lib/bulleAide.ts`,
`verifier-bulle-aide.ts`) : allumée sauf préférence explicitement `false`
(case « Bulle d'aide sur ce projet » dans Réglages du projet) ; vue projet =
son fil, vue « Tout » = le projet `cockpit`, sinon le dernier fil utilisé
(jamais un `test-…`). Un message tapé = message libre du fil du projet
(`ecrireAvecMedias`, comme « Écrire à Claude sur ce projet ») ; la réponse de
session (`progression.sh --point`) s'y affiche, la bulle ouverte relit toutes
les 10 s tant qu'une réponse est attendue. Le bouton « Chantier » d'origine
est retiré (`ouvrir_depuis_fil` est réservée aux sessions : il ne pouvait pas
marcher) : Claude crée lui-même le chantier depuis le message.
`app/scripts/verifier-bulle.mjs` prouve le trajet complet (projet jetable).
**Complété le 5 oct. 2026 (chantier 607d08b1 + doublon 95042f6b « clarifier son rôle »)** : la bulle dit à quoi elle sert (encart « À quoi sert cette bulle » + état vide avec deux suggestions) ; chaque message porte nom ET heure (`auteurDe`, `heureLisible`) et son sujet en gras (`sujetDe`, UNE règle partagée avec la conversation) ; « Répondre » sous un message de Claude cite la phrase sélectionnée, sinon son début (`aCiter`, `avecCitation` : ligne « > » en tête du message, redessinée en encart) ; pièces jointes par `useMediasAJoindre` / `ecrireAvecMedias` (📎 + crayon, même brique que les fils) ; dictée par la reconnaissance vocale du NAVIGATEUR (`constructeurVoix`, fr-FR, Chrome Android/ordinateur, Safari ; micro refusé = message qui dit où l'autoriser ; navigateur sans voix = micro grisé + phrase). Limite : la vraie reconnaissance n'est pas testable dans le conteneur (le banc simule `webkitSpeechRecognition`) ; Chrome l'envoie à un serveur de Google, donc il faut internet.

## « Claude a répondu » : pastille + notification du téléphone (30 sept. 2026, migration 0039, chantier bff5a8cf)

Raphaël : « quand j'envoie un message […] je ne vois aucune notification comme
quoi il m'a répondu […] il faudrait une notification pour pouvoir répondre le
plus rapidement possible » (capture : la case « Écrire à Claude sur ce projet »)
« […] et une notification push du téléphone, à régler dans les paramètres ».
- **Dans l'app** : une RÉPONSE = message de session avec `repond_a` (posé par
  `repondre_dans_fil`, donc pas les lignes automatiques). Non lue tant qu'elle
  est plus récente que le « lu jusqu'à » du fil (préférences `lu_fils`, par
  personne ; `lu_depuis` posé au premier chargement pour ne pas allumer
  l'historique). Pastille rouge « Réponse » sur la case du projet et sur les
  lignes « À toi » / « Ça avance » (`PastilleReponse.tsx`), compteur dans le
  titre de l'onglet et sur l'icône de l'appli ; ouvrir le fil = le lire.
  Règle unique : `lib/lecture.ts`, `verifier-lecture.ts`, `verifier-web.mjs`
  (« pastille Réponse »).
- **Push** : Réglages › « Notifications de réponses » › « Activer sur cet
  appareil » (par appareil ; `usePush.ts`, règle des états `lib/push.ts`,
  iPhone : seulement dans l'appli installée). Un trigger sur la réponse
  (`push_sur_reponse`, pg_net, jamais pour un projet `test-…`) appelle la
  fonction `cockpit-push` (web-push ; `x-push-secret` du coffre) qui envoie
  aux appareils des admins et membres du projet et retire les abonnements
  morts. `sw.js` affiche la bannière (sauf appli déjà à l'écran). Mise en
  place UNE fois : `node scripts/installer-push.mjs` (clés VAPID, secrets de
  la fonction, coffre, `push_config` ; idempotent, `--regenerer` désabonne
  tout) puis `VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-push`.
  Preuve : `node scripts/verifier-push.mjs`. **Non prouvé ici** : la
  livraison sur un vrai téléphone (aucun navigateur abonné dans le conteneur).

**Choisir quelles notifications on reçoit** (5 oct. 2026, migration 0052, chantier 70288582 ;
Raphaël : « gérer quel type de notifications […] pareil pour tous les projets, le plus simple
possible »). Réglages › Notifications : un interrupteur par TYPE, puis « Tous les projets » +
un interrupteur par projet, résumé en une phrase, toast succès/échec. Par personne :
`notif_reglages` (`types` code → bool, absent = défaut du catalogue ; `projets_coupes`, vide =
tous). Catalogue `notif_types` (code, libellé, `defaut`, `emis`) : UNE source pour l'écran et le
serveur ; **seul `reponse` est émis** (défaut allumé) ; « À toi », « PR à fusionner » et « Chantier
terminé » sont listés « bientôt », sans interrupteur, tant qu'aucun trigger ne les envoie. UNE
règle de décision côté serveur : `notif_veut(user, type, projet)` et `notif_destinataires(type,
projet)` (admins + membres qui veulent ; jamais un projet `test-…`, jamais un type non émis),
lue par `cockpit-push` (déployée v2). **Ajouter un type** = une ligne dans `notif_types` (`emis`
faux), puis le trigger qui l'envoie et `emis` vrai ; l'écran suit tout seul. Règles d'affichage :
`lib/notifications.ts`, `verifier-notifications.ts` ; base : `verifier-base` §41 (`SEUL=41` joue
ce seul contrôle). Le réglage vaut pour tous les appareils de la personne ; l'abonnement reste par
appareil (message clair si l'appareil n'est pas abonné).

## « Ça bloque » sur une carte d'action (6 oct. 2026, migration 0070, chantier 0fec7563)

Raphaël : « j'ai beau écrire que ça bloque et que la PR 60 n'existe pas, rien ne prend mon retour ».
Cause : `repondre_message` laisse `answered_at` NUL sur une action non « fait » (la carte reste ouverte) et
tout ce qui sert un retour à Claude (`reponses_sans_suite`, hook de démarrage, hook de suivi) exigeait
`answered_at` : le retour n'était lu par personne. Maintenant : `messages.retour_at` date le retour,
`est_retour_carte` (« Ça bloque », ou « Pas encore » avec un mot/fichier) le fait servir, la consigne de
l'agent exige de FERMER la carte (`demander.sh --retirer`), Raphaël pouvait la retirer lui-même
(`retirer_carte`, bouton sur la carte : **ce bouton n'existe plus depuis le 16 oct., une carte dépassée se retire
toute seule, voir « Les cartes déjà traitées se retirent seules »** ; la fonction reste en base), et `pr-a-fusionner.sh` retire/ne pose pas la carte d'une PR
inexistante (404 alors que le dépôt répond). Tests : `verifier-base` §50 et §37, `verifier-reponses` 5 bis.

## Bulle embarquée : saisie fluide et pièces jointes (6 oct. 2026, chantier d1cf639b)

Taper ne redessine plus l'écran (mises à jour en place), champs qui grandissent, Ctrl/Cmd+Entrée envoie.
Pièces jointes : action serveur `televerser` (adresse d'envoi signée vers `cockpit-medias`, 25 Mo au plus,
le fichier ne passe pas par la fonction), `medias` acceptés par `creer` / `corriger` / `message` (chemin sous
le projet de la clé et fichier existant, vérifiés), lecture par adresses signées dans `etat` (jamais le
chemin). Fonction à redéployer après modification : `VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-embed`.
Liens : une adresse https écrite dans une carte « À toi » ou dans « Comment vérifier » devient un bouton
(`ui/TexteAvecLiens.tsx`, `liensDuTexte`).

**Discussions : pastilles réparties par chat** (6 oct. 2026, chantier 3b2bf53d ; Raphaël : « les notifications ne sont pas réparties dans les différents chats »). Cause prouvée : la pastille de l'onglet « Discussions » comptait TOUTES les réponses non lues (fils de chantiers compris) alors que chaque ligne de chat ne comptait que la discussion libre, et les cartes « À faire ici » n'étaient comptées nulle part. UNE règle (`lib/bulleAide.ts` : `cartesAFaire`, `notifsChat`) : un chat = réponses non lues de sa discussion + cartes à faire (même liste que celle affichée en ouvrant le chat) ; l'onglet = la somme des chats ; la liste met en haut les chats qui attendent. Le sondage de 10 s de la bulle relit en silence (`recharger(true)`, plus de voyant de chargement ni d'erreur à l'écran). `verifier-bulle.mjs` (cartes répondues dans le chat, clavier ouvert, total = somme), `verifier-bulle-aide.ts`. Non vérifié : vrai téléphone (clavier réel).


**La liste « À faire ici » et « N livrés à tester » sont retirées du chat** (19 oct. 2026). Raphaël, capture du chat FacePro (5 lignes dont deux fois « GPU de secours »
et deux « Claude a travaillé dessus… il vérifie ») : « ça encombre pour rien et surtout je pense que ce n'est pas à jour ; je veux plus de choses comme ça à l'avenir, des cartes
intempestives et pas actualisées dans le chat ». Le chat de la bulle d'aide est une DISCUSSION : l'historique, la saisie, rien d'autre. Les cartes (questions, actions,
vérifications, à tester) vivent dans « À toi » de l'accueil, une seule fois. Retiré : `AFaireIci` et `LigneCarte` (`BulleFlottanteAide.tsx`). Gardé tel quel : les pastilles
« à faire » de la liste des discussions et de la barre du bas (`cartesAFaire`, `notifsChat`) : elles disent qu'une chose attend, l'accueil la montre. Règle pour la suite : on ne remet
pas de liste de cartes dans le chat ; une carte nouvelle se pose dans « À toi ». Bancs : `verifier-bulle.mjs` (41/41) et `verifier-accueil.mjs` (50/50) vérifient qu'il n'y a plus de bloc.

### Push « une question t'attend » (23 oct. 2026, migration 0113, chantier 3892956d)
Raphaël : notifications reçues seulement quand l'app est ouverte. Constat : (1) `push_abonnements` était VIDE, aucun appareil n'était abonné (Réglages › Notifications › « Activer sur cet appareil » jamais fait ou abonnement mort) ; (2) seul le type « reponse » partait, jamais une question ou une action (`a_toi`, emis = false). Fait : trigger `push_sur_question` (question/action posée par une session, tant qu'elle attend), `cockpit-push` gère les deux types, `notif_types.a_toi.emis = true`. Non couvert : « pr » et « termine » restent non émis ; un appareil doit encore être abonné par Raphaël.
