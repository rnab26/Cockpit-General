# CLAUDE.md — Cockpit (rnab26/Cockpit-General)

Complète le CLAUDE.md global de Raphaël (`rnab26/dotfiles/.claude/CLAUDE.md`),
ne le remplace pas. Français, concis, autonomie une fois la tâche confirmée.

**Tu reprends le travail ? Lis d'abord `docs/REPRISE.md`** (état, ce qui n'est
pas encore en ligne, la suite, les pièges), puis les décisions de Raphaël.

## Ce que c'est, et pourquoi il existe

Le cockpit unique de tous les projets de Raphaël : une base Supabase
centrale (schéma `cockpit`), une app (GitHub Pages), un module embarquable
pour les utilisateurs finaux, des scripts pour les sessions. Les décisions
qui l'ont fondé, dans ses mots :
`rnab26/dotfiles/cockpit-kit/DECISIONS-2026-09-28.md`. **Relis-les avant de
changer un principe** (cycle en colonne, validation humaine, une seule base,
branchable partout, temps réel, style Trieur + synthèses Jarvis).

## Le cockpit se pilote dans le cockpit

Ce dépôt est le projet `cockpit` de sa propre base : le hook
`hooks/session-start.sh` (déclaré dans `.claude/settings.json`) injecte l'état
au démarrage. Réserve un chantier avant de coder, signale ta progression avec
`scripts/progression.sh` à chaque étape et en terminant, pose tes questions
avec `scripts/demander.sh`. Un chantier terminé passe « à vérifier » ; c'est
Raphaël qui certifie depuis l'app.

## Contrat de données : les migrations, rien d'autre

`supabase/migrations/` est la seule source de vérité du schéma. Une
migration est idempotente (rejouable) et s'applique avec
`scripts/sql.sh < supabase/migrations/000N_….sql`. Elle ne touche que le
schéma `cockpit` : le projet Supabase est partagé avec Jarvis (`public`) et
le Trieur (`trieur_data`). Toute nouvelle table : RLS activée, politique
`admin_tout`, temps réel si l'app l'affiche, et `replica identity full`.

Le schéma est exposé à l'API PostgREST (réglage `db_schema` du projet, posé
le 28 sept. par l'API de gestion) ; l'app l'interroge avec
`createClient(url, clé publique, { db: { schema: 'cockpit' } })`.
`scripts/sql.sh` vise `cockpit.exec_sql` par l'en-tête `Content-Profile:
cockpit` (réservée à service_role).

## Ce que tu ne fais pas sans Raphaël

- Poser `valide` sur un chantier (jamais par une session, ni par SQL).
- `drop`, `delete` massif, `truncate`, régénérer une `cle_embed`.
- Créer une ressource payante ou un projet Supabase.
- Créer un dépôt GitHub : la plateforme l'interdit aux sessions (constaté
  le 28 sept. 2026, « sessions are bound to their configured repositories »).

## Vérifications canoniques

```bash
cd app && npm ci && npx tsc -b && npm run build            # l'app se tient
node --experimental-strip-types app/scripts/verifier-*.ts  # décisions pures
node app/scripts/verifier-web.mjs                          # parcours réel, écran de téléphone
node scripts/verifier-embed.mjs                            # fonction serveur déployée + module dans un navigateur
node scripts/verifier-base.mjs                             # schéma, RLS, droits des fonctions, temps réel, médias (158 contrôles)
bash -n scripts/*.sh hooks/*.sh
```

Le compte de test des parcours navigateur est un admin nommé
`test-cockpit@cockpit.local` (mot de passe hors dépôt, dans l'environnement
de la session qui l'a créé) : ce n'est pas une personne, ne l'ajoute à aucun
projet. Sans ce mot de passe, `verifier-web.mjs` se connecte par un lien
magique (clé service_role) ; `app/scripts/capture-ecran.mjs <url> <dossier>`
capture l'écran réel sur un téléphone (clair, ou `SCHEMA=dark`).

**Chromium du conteneur et proxy TLS (29 sept.)** : il ne fait pas confiance
au proxy (`ERR_CERT_AUTHORITY_INVALID`, y compris sur le site en ligne). Les
deux scripts font passer les requêtes https par Node (`ctx.route` + `fetch`),
qui vérifie le certificat : ne jamais « corriger » avec `ignoreHTTPSErrors`.

**Deux pièges payés le 28 sept. 2026.**
- Une fonction `security definer` contourne la RLS : elle doit vérifier
  elle-même le droit de l'appelant (`cockpit.peut_agir`, `est_admin`), et
  PostgreSQL donne EXECUTE à PUBLIC par défaut. Toute nouvelle fonction :
  `revoke … from public`, puis `grant` nommé (migration 0004). Et dans une
  telle fonction, `current_user` est le propriétaire : on lit `auth.role()`.
  `verifier-base.mjs` (sections 10 et 11) rougit si l'un des deux revient.
- Le Chromium de l'environnement cloud Claude n'ouvre AUCUNE WebSocket (même
  vers echo.websocket.org) : le temps réel ne se vérifie pas dans le
  navigateur de test ici. `verifier-web.mjs` le détecte et le dit ;
  `verifier-base.mjs` §12 prouve le direct depuis Node. Ne pas « corriger »
  l'app pour ça.

## Déploiement

Push sur `main` → `deploy.yml` construit l'app, y ajoute `embed/` et pousse la
branche `gh-pages`, que Pages sert (Settings → Pages → « Deploy from a
branch » → gh-pages / root, réglé par Raphaël le 28 sept.). La fonction serveur ne se déploie PAS au push :
`VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-embed` puis
`node scripts/verifier-embed.mjs`. Une modification de `embed/cockpit-embed.js`
est servie aux sites hôtes au prochain chargement de leur page (cache CDN
de Pages, quelques minutes).

## UNE session chef, des agents (29 sept. 2026, migration 0014)

Raphaël : « les sessions se marchent dessus » → une seule session dirige tous
les projets : celle où il a écrit en dernier (hook UserPromptSubmit →
`scripts/chef.sh --prendre`). Elle ne code pas elle-même : `scripts/chef.sh`
lui donne un chantier par place libre (3 agents en parallèle, `--max`), elle
lance un agent par chantier (isolation worktree, sa branche), et relance
`chef.sh` à la fin de CHAQUE agent (et le hook Stop le fait aussi) : le travail
continue sans attendre l'heure. Les autres sessions n'enchaînent plus rien
(`autonome.sh`, `passe.sh`). Un seul réveil horaire, sur la chef
(`chef.reveil_trigger`) ; une nouvelle chef le déplace sur elle. Si le
conteneur de la chef s'arrête, ses agents s'arrêtent : chantiers réservés
3 h, repris au réveil suivant (abandon détecté). Jamais `git add -A` dans un
dossier partagé avec un agent (incident du 29 sept., commit 964528e).

## Correctifs GÉNÉRAUX, jamais par projet (Raphaël, 29 sept. 2026)

« Ce sont des correctifs généraux, peu importe le repo ou le projet que je
brancherai ; le modèle de cockpit doit être réutilisable et branchable sans
correctif par projet. » Tout se corrige ICI (app, base, scripts, hooks,
modèles), jamais dans un projet branché ; un projet ne reçoit que ce que
propagent le lanceur et `brancher.sh`. Et toute session qui travaille ici se
voit dans le cockpit (chantier + `progression.sh` à chaque étape).

## Les projets branchés GARDENT les mises à jour (29 sept. 2026)

Constaté sur FacePro : les scripts arrivaient (lanceur), mais le bloc
CLAUDE.md et les nouvelles commandes n'étaient jamais commités — chaque
nouvelle session repartait des anciennes règles. Désormais le hook de
démarrage commite lui-même les fichiers du cockpit sur la branche courante
(seulement ceux qui étaient propres avant : jamais un travail en cours), et
injecte le bloc à jour dans le contexte de la session.

## « Je ne sais pas : vérifie pour moi » (29 sept. 2026, migration 0016)

Troisième bouton sous « Ça marche / Corriger » : Raphaël colle ce qu'il a vu
(ou une capture), Claude juge. `demander_verification` pose la demande (le
chantier sort de « À toi ») ; `scripts/chef.sh` lance un agent qui compare à la
source et rend `scripts/verdict.sh --bon|--pas-bon` (`rendre_verdict`,
service seulement) : bon → retour à Raphaël pour un toucher, pas bon →
correction. « Comment vérifier » : une observation évidente, jamais compter.

## Réponses courtes (Raphaël, 29 sept. 2026)

« Je veux des réponses simples, courtes, nettes et précises. » Dans la
conversation comme dans le cockpit : la réponse d'abord, en quelques lignes,
puis ce qu'il doit faire. Pas de pavé, pas de détail technique non demandé.

## Réponses du cockpit en direct (29 sept. 2026)

Quand Raphaël répond ou écrit dans le cockpit sur un chantier qu'une session
tient (réservé à sa branche, ou suivi par un de ses agents), `hooks/suivi.sh`
(PostToolUse, toutes les 20 s au plus, 3 s max) le met sous les yeux de la
session avant son prochain pas. Une session à l'arrêt ne le voit qu'à son
prochain réveil (la chef : au plus une heure) ou quand il lui écrit.

## Questions et assistants toujours à jour (29 sept. 2026, migration 0015)

Une question ouverte que du travail a suivie s'affiche « Claude a avancé
depuis : peut-être plus utile » ; la session la confirme (`demander.sh
--confirmer`) ou la retire (`--retirer <id> "pourquoi"`), rappel du hook
toutes les 15 min. Un assistant listé en cours reste « en cours » tant que sa
session vit (trigger 0015 : `taches.vu_at` suit `sessions.vu_at`).

## Règle de clarté (Raphaël, 29 sept. 2026) — elle vaut pour TOUT le cockpit

« Toutes les questions, les constats, tout ce qui demande une interaction et
de la lecture de ma part, donc tout le cockpit, synthétisé le plus simple
possible : qu'on comprenne le sujet, ce qu'il y a à faire, et qu'on puisse
donner des réponses claires. » Pas d'assistant payant pour « expliquer » :
c'est à la source qu'on écrit clair. Appliquée par les scripts (refus avant
toute écriture) : `demander.sh` (question ≤ 140 car., pourquoi ≤ 250, 2 à 4
options avec aide ≤ 140), `progression.sh` (`--verifier` ≤ 5 étapes
numérotées, ≤ 500 car. ; résumé de `--termine` ≤ 120), `chantier.sh` (titre
≤ 80). Même exigence pour tout texte que l'app affiche.

## Médias dans les réponses (29 sept. 2026, migration 0013)

Raphaël répond avec des cartes ET des photos/vidéos/fichiers (bouton 📎 sur
une question, « Écrire à Claude », certifier/corriger). Stockage PRIVÉ
`cockpit-medias` (le bucket `cockpit` est à Jarvis), chemin
`<projet>/<chantier|projet>/<uuid>-<nom>`, droits par `peut_lire_media` /
`peut_deposer_media` ; colonne `messages.medias`. Les RPC de réponse ne portent
pas de fichier : les médias partent dans un message `info` juste après. Une
session les récupère avec `scripts/media.sh --message|--chantier <id>` (📎 dans
le hook) et les REGARDE avant de répondre.

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
