# Brancher un projet : la fiche à remplir

Brancher = donner au projet une ligne dans la base du cockpit, ses scripts et
son hook de démarrage, puis (si besoin) le module embarquable dans son site.
Tu ne fais qu'**une chose** : ouvrir une session Claude Code sur le dépôt du
projet et coller la phrase de l'étape 2. Claude fait le reste.

## 1. La fiche (4 infos, 2 obligatoires)

| Info | Obligatoire | Exemple |
|---|---|---|
| Nom du projet | oui | `Mélissa` |
| Dépôt GitHub | oui | `rnab26/Melissa` ou `client/leur-site` |
| Le dépôt est-il à toi ? | oui (déduit : propriétaire `rnab26` = oui) | oui / non |
| Adresse du site (si le projet a un site) | non | `https://exemple.com` |

## 2. La phrase à coller dans une session ouverte sur le dépôt

Dépôt à toi :

> Branche le cockpit sur ce projet : nom « <Nom> », dépôt <owner/repo>.

Dépôt d'un client, au choix de la voie (voir 3) :

> Branche le cockpit sur ce projet avec la voie <invisible | branches | normale> : nom « <Nom> », dépôt <owner/repo>, site <https://…>.

Claude suit le skill `cockpit` (`scripts/brancher.sh`), puis te pose deux
cartes dans « À toi » : **où** le cockpit apparaît (bouton dans le menu, page
à part, appli) et **qui** l'utilise (toi, l'équipe, les utilisateurs du site).
Tu touches une réponse par carte ; la balise du module n'est donnée qu'ensuite.

## 3. Quelle voie ?

| Cas | Voie | Ce que le client voit | Pour qui |
|---|---|---|---|
| Projet à toi (interne) | normale (défaut) | Fichiers du cockpit dans le dépôt | Toi, ton équipe |
| Dépôt d'un tiers, il ne doit rien voir | `invisible` | Rien (tout dans `~/.cockpit` de ton environnement) | Toi seul |
| Dépôt d'un tiers, il veut le cockpit sur certaines branches | `branches` | Les fichiers sur tes branches seulement, garde `pre-push` | Toi + lui |
| Dépôt d'un tiers, il est d'accord | `normale` | Comme un dépôt à toi | Tous |

Recommandation : interne = `normale` ; externe sans accord explicite = `invisible`.
Sans `--voie`, `brancher.sh` refuse sur un dépôt qui n'est pas à toi et
n'écrit rien.

## 4. Comment ça marche

1. `brancher.sh` crée la ligne `projets` (schéma `cockpit`) et une `cle_embed`.
2. Il copie les scripts (`sql.sh`, `demander.sh`, `progression.sh`, `chef.sh`…)
   et le hook de démarrage ; il déclare le hook et `COCKPIT_PROJET` dans
   `.claude/settings.json` et ajoute le bloc « Cockpit » au `CLAUDE.md`.
3. À chaque nouvelle session, le hook injecte l'état (chantiers, fil,
   questions) et met les fichiers à jour tout seul.
4. Le projet apparaît dans l'app ; « Traiter ce projet » lance une session chef.
5. Utilisateurs finaux : la balise `<script>` du module embarquable, avec la
   clé du projet, que `scripts/cockpit-emplacement.sh --projet <slug> --balise`
   donne après tes réponses.

Prérequis déjà en place dans tes environnements cloud :
`SUPABASE_SERVICE_ROLE_KEY` (jamais dans le dépôt d'un client), `jq`, `curl`, `python3`.

## 5. Autres solutions, si tu ne peux pas ouvrir de session sur le dépôt

- **Outil IA hors Claude** (Codex, ChatGPT, Cursor) : serveur MCP, `docs/mcp.md`, avec la `cle_embed`.
- **Site seul, sans dépôt** : la balise du module embarqué suffit pour recevoir des demandes ; pas de sessions ni de chef.
- **Ce qui n'existe pas encore** : un formulaire dans l'app qui crée le projet sans session (il faudrait une fonction serveur qui écrive la ligne `projets` ; décision à prendre à part).
