
## Cockpit (rnab26/Cockpit-General)

Ce projet est suivi dans le cockpit central (projet `{{SLUG}}`, app
https://rnab26.github.io/Cockpit-General/, base Supabase centrale, schéma `cockpit`).
Le hook `.claude/hooks/cockpit-session-start.sh` injecte l'état au démarrage :
chantiers ouverts par section, questions en attente, réponses humaines,
demandes des utilisateurs, progression des autres sessions.

- **RÉPONSES À RAPHAËL : simples, courtes, nettes, précises** (29 sept. : « je
  veux des réponses simples, courtes, nettes et précises ; pas de pavé »).
  Quelques lignes : la réponse d'abord, puis ce qu'il doit faire s'il y a
  quelque chose. Pas de détail technique sauf s'il le demande.
- **« COMMENT VÉRIFIER » = UNE observation évidente** (29 sept. : « je ne sais
  pas si le résultat est le bon, il faudrait comparer, compter »). Écris ce
  qu'il doit VOIR, reconnaissable d'un coup d'œil (« le bouton est vert »),
  jamais « compte / compare ». Ce qui demande de juger, vérifie-le toi-même et
  donne la preuve. S'il touche « Je ne sais pas : vérifie pour moi », c'est à
  toi de juger ce qu'il a collé : `scripts/cockpit-verdict.sh --chantier <id>
  --bon "…"` ou `--pas-bon "…"` (la session chef du projet lance un agent pour ça).
- **UNE RÉPONSE DE RAPHAËL N'EST JAMAIS PERDUE** (29 sept. : « je réponds, mais
  je ne sais pas si c'est pris en compte »). Sur un chantier que tu tiens, elle
  t'arrive en direct : suis-la tout de suite (un message ou une étape). Sur un
  chantier que personne ne tient, la session chef du projet la confie à un agent
  (« Claude reprend ta réponse » dans le fil) : ne la reprends pas en doublon.
- **TES QUESTIONS RESTENT À JOUR** (29 sept. : « je ne veux pas répondre à
  des choses déjà faites, déjà répondues ou en cours »). Dès que tu avances sur
  un chantier où tu as une question ouverte : `scripts/cockpit-demander.sh
  --confirmer <id>` si elle compte encore, `--retirer <id> "pourquoi"` sinon.
  Le hook te le rappelle ; l'app marque « Claude a avancé depuis ».
- **RÈGLE DE CLARTÉ — tout ce que Raphaël lit dans le cockpit** (questions,
  constats à faire, « comment vérifier », titres, messages du fil) : le plus
  simple possible, pour quelqu'un qui ne code pas. On doit comprendre **le
  sujet**, **ce qu'il y a à faire**, et pouvoir **répondre d'un toucher**. Une
  question = une phrase (140 car.) + un pourquoi en mots de tous les jours +
  2 à 4 réponses toutes prêtes, chacune disant ce qui se passe si on la
  choisit. Pas de jargon, pas d'identifiant, pas de chiffres techniques : le
  détail va dans le fil. Les scripts refusent ce qui dépasse (Raphaël, 29 sept. :
  « dans 80 % des cas je ne comprends pas, donc je ne peux pas répondre »).
- **Chaque demande de travail de Raphaël → un chantier, AVANT de coder** :
  `scripts/cockpit-chantier.sh --ouvrir "<titre court>" --demande "<ses mots>" --section "<rubrique>"`.
  Il reprend (ou rouvre) le chantier existant au lieu d'en créer un doublon.
  **C'est TOI qui tranches, jamais Raphaël** (ses mots, 29 sept. 2026 :
  « personne mieux que Claude sait si c'est un doublon […] ce n'est pas à moi
  de trier, catégoriser à chaque fois ») : sur « ambigu », lis les extraits
  affichés et relance avec `--id <le bon>` ou `--nouveau`, sans lui demander.
  Range toujours dans une section (`--section`, créée si elle n'existe pas ;
  après coup : `--ranger <id> --section "…"`). Un petit correctif visuel, de
  mise en page ou d'ergonomie va dans **« Correctifs »** : sans `--section`, il
  y est rangé tout seul à la création (règle `cockpit.est_correctif`, même pour
  l'app et le module embarqué) ; un faux tri se corrige par `--ranger`. Si deux chantiers existants
  sont en fait le même sujet, **suggère** la fusion :
  `--suggerer-fusion <id à absorber> --dans <id qui reste> --pourquoi "…"` —
  il l'accepte d'un toucher dans l'app. Un rappel le redit à chaque message
  (hook `cockpit-prompt-rappel.sh`).
- **Tes agents et tes commandes longues sont suivis tout seuls** (hook
  `cockpit-suivi.sh` : Raphaël voit dans le cockpit chaque session, ses agents,
  depuis quand ils tournent). Ce qui ne se devine pas, c'est leur avancement :
  **dans la consigne de CHAQUE agent que tu lances**, écris-lui d'appeler
  `scripts/cockpit-progression.sh --agent "<la description exacte que tu lui
  as donnée>" --chantier <id> --etape "…" --pct N --eta 10m` à chaque étape,
  et `--agent "…" --termine "…"` à la fin. Donne des descriptions d'agents
  lisibles par Raphaël (le sujet, pas la technique).
- **UN CHEF PAR PROJET** (29 sept. : « je ne veux pas gérer sur une seule
  session plein de projets en même temps […] ça doit se faire dans la session
  concernant le projet en question, sinon ça mélange tous les contextes »).
  La session où Raphaël écrit devient chef de CE projet (`{{SLUG}}`), et de lui
  seul : `scripts/cockpit-chef.sh` lui donne les chantiers, réponses et
  vérifications de ce projet, qu'elle confie à des agents ; les autres projets
  ont leur chef dans leur propre session, n'y touche jamais d'ici. Quand elle
  le devient, la consigne dit de créer (ou déplacer) SON réveil horaire, puis
  de le noter : `scripts/cockpit-chef.sh --reveil <trig_…> --distante <session_…>`.
  `--etat` : qui dirige ; `--max <n>` : agents en parallèle pour ce projet.
- **RENFORTS** (0022) : Raphaël les demande d'un bouton du cockpit (« Lancer
  des renforts ») : une session cloud par SECTION en attente. La passe de la
  chef te dit d'ouvrir chaque demande (`create_session`, titre « Renfort ·
  <projet> · <section> — ne pas toucher », tags `cockpit-renfort`), de la
  noter (`scripts/cockpit-renfort.sh --session <id> <session_…>`, ou
  `--erreur`), et d'archiver les renforts finis (`archive_session`, accord
  de Raphaël donné d'avance, puis `--archive <id>`). Tu es TOI-MÊME un renfort
  (consigne « [cockpit-renfort] ») : `scripts/cockpit-renfort.sh --suivant
  <id>` te donne tes chantiers (ta section seulement, un agent chacun), puis
  ATTENDS ou FINI ; tu ne prends rien d'autre et tu ne dis rien à Raphaël ici.
- **Limite d'usage et mode autonome** : la reprise de la tâche en cours quand
  une limite se lève est native (`autoContinueAtUsageLimit`, posé par
  brancher.sh). Si le projet est en « mode autonome » (allumé par Raphaël
  jusqu'à une heure), le hook `cockpit-autonome.sh` te donne à la fin de ta
  tâche le chantier LIBRE suivant, déjà réservé : suis ses règles (aucune
  dépense, aucune suppression, aucun envoi ; une décision de Raphaël → une
  question dans le cockpit, puis passe au suivant).
- **Réserver avant de toucher** : `{{SQL}} "select reserver_chantier('<id>', '<ta branche>', 120)"`
  (false = une autre session l'a). Libérer : `liberer_chantier(id, branche)`.
- **Progression en direct, à chaque étape et en terminant** :
  `scripts/cockpit-progression.sh --chantier "<titre ou id>" --etape "…" --pct 40 --eta 25m`,
  les étapes de mise en ligne au fil de l'eau : `--jalon pousse --detail <commit>`,
  `--jalon ci-ok`, `--jalon en-ligne --detail <adresse vérifiée>` (ou
  `--jalon pas-en-ligne --detail <raison>`), puis `--termine "…" --verifier "1. … 2. … 3. Tu dois voir …"` (le chantier
  passe « à vérifier » ; `--verifier` est obligatoire : où aller, quoi faire,
  ce que Raphaël doit voir, sans jargon) ou `--echec "…"`.
  Le même tableau s'affiche dans la session : c'est le visuel de progression.
- **Une question à un humain** : `scripts/cockpit-demander.sh --chantier … --question … --pourquoi … --option "libellé|aide|recommande"`
  (`--action` pour quelque chose qu'il doit faire). Jamais dans un artefact.
- **Montre, ne décris pas** (Raphaël, 29 sept. 2026 : « montre-moi des images
  pour que je comprenne mieux, ou ce que je suis censé voir ») : une question
  ou une vérification qui porte sur quelque chose de VISIBLE (un écran, un
  rendu, un avant/après) → joins une capture. `--image capture.png` sur
  `scripts/cockpit-demander.sh` (sous la question) et sur
  `scripts/cockpit-progression.sh --termine … --verifier …` (« Ce que tu dois
  voir », sous les étapes) ; dans le fil :
  `scripts/cockpit-media.sh --envoyer --chantier <id> --texte "…" --image capture.png`.
  png, jpg, webp, gif, mp4, webm ; 4 au plus, 10 Mo chacune ; capture faite
  avec l'outil du projet (Playwright sur le site, capture de l'app…), et
  REGARDE-la avant de l'envoyer (Read sur l'image).
- **Photos, vidéos, fichiers de Raphaël** (joints à ses réponses dans l'app, 📎 dans le hook) : `scripts/cockpit-media.sh --message <id>` ou `--chantier <id>` les télécharge ; REGARDE-les (Read sur l'image) avant de répondre.
- **Le cycle** est une colonne `etat` : à trier → à cadrer → libre → en cours →
  à vérifier → validé (+ bloqué, reporté). **Seul un humain pose « validé »**
  (bouton « Ça fonctionne, je certifie » ; « Corriger » complète la demande sur
  la même ligne et rend le chantier). Plus aucun marqueur entre crochets.
- **Écrire dans le fil** : `insert into messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)`
  (`kind` info / blocage). Avant de t'arrêter, écris où tu en es.
- **Ces commandes sont des lanceurs** (`scripts/cockpit-lanceur.sh`) : elles
  exécutent toujours la dernière version publiée sur Cockpit-General, sans
  réinstallation. Ne les modifie pas ici ; une évolution se fait dans
  Cockpit-General et arrive dans tous les projets branchés en 10 minutes.
- `{{SQL}}` vise le schéma `cockpit` sans préfixe, une instruction par appel ;
  demande à Raphaël avant tout drop / delete massif / truncate.
<!-- fin du bloc cockpit : brancher.sh remplace tout ce qui précède jusqu'au titre -->
