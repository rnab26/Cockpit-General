# Brancher le cockpit à un outil IA hors Claude (MCP)

Le cockpit d'UN projet, exposé en MCP par la fonction `cockpit-mcp` :
`https://bexiyvmdbxcwxasgslxp.supabase.co/functions/v1/cockpit-mcp`

Ce que l'outil voit et peut faire = exactement le module embarqué (la
fonction relaie `cockpit-embed`) : les demandes VISIBLES du projet, jamais un
champ interne. La clé est la `cle_embed` du projet (app › Projets & membres ›
« Copier »). Ne la régénère pas pour ça : ça casserait les sites branchés.

Outils : `cockpit_etat`, `cockpit_creer`, `cockpit_repondre`,
`cockpit_certifier`, `cockpit_corriger`, `cockpit_message`, `cockpit_modifier`.

## Codex (vérifié dans la doc Codex : `url`, `bearer_token_env_var`)

```bash
export COCKPIT_CLE="<cle_embed du projet>"          # dans ton profil shell
codex mcp add cockpit --url https://bexiyvmdbxcwxasgslxp.supabase.co/functions/v1/cockpit-mcp
```
puis dans `~/.codex/config.toml`, sous `[mcp_servers.cockpit]` :
```toml
bearer_token_env_var = "COCKPIT_CLE"
```
La clé voyage dans l'en-tête `Authorization`, jamais dans le fichier.

## ChatGPT (doc développeur : Streamable HTTP accepté ; authentification
« OAuth » ou « Aucune » seulement, pas d'en-tête personnalisé)

La clé va donc dans l'adresse : `…/functions/v1/cockpit-mcp/<cle_embed>`,
authentification « Aucune ». ChatGPT › Réglages › Sécurité et connexion :
activer « Mode développeur » ; puis Plugins › « + » : nom Cockpit, cette
adresse. Limite : la clé apparaît dans les journaux d'accès de Supabase ;
la faire pivoter est un geste de Raphaël (elle est aussi visible dans les
sites qui portent le module). ChatGPT « recherche approfondie » exige deux
outils `search` / `fetch` : NON fournis ici.

## Autres clients

Tout client MCP « Streamable HTTP » : adresse ci-dessus + `Authorization:
Bearer <clé>` (ou `x-cockpit-key`, ou `?cle=`). Sans état, réponses JSON,
pas de flux (GET → 405), versions 2025-06-18 / 2025-03-26 / 2024-11-05.

## Vérifier

`node scripts/verifier-mcp.mjs` (36 contrôles, fonction déployée, projet
jetable). Déploiement : `VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-mcp`.
