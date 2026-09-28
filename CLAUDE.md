# CLAUDE.md — Cockpit (rnab26/Cockpit-General)

Complète le CLAUDE.md global de Raphaël (`rnab26/dotfiles/.claude/CLAUDE.md`),
ne le remplace pas. Français, concis, autonomie une fois la tâche confirmée.

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
node scripts/verifier-base.mjs                             # schéma, RLS, droits des fonctions, temps réel (118 contrôles)
bash -n scripts/*.sh hooks/*.sh
```

Le compte de test des parcours navigateur est un admin nommé
`test-cockpit@cockpit.local` (mot de passe hors dépôt, dans l'environnement
de la session qui l'a créé) : ce n'est pas une personne, ne l'ajoute à aucun
projet.

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

Push sur `main` → `deploy.yml` construit l'app, y ajoute `embed/` et publie
par le déploiement officiel GitHub Pages (Source = « GitHub Actions » dans
Settings → Pages ; la branche `gh-pages` n'est plus utilisée). La fonction serveur ne se déploie PAS au push :
`VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-embed` puis
`node scripts/verifier-embed.mjs`. Une modification de `embed/cockpit-embed.js`
est servie aux sites hôtes au prochain chargement de leur page (cache CDN
de Pages, quelques minutes).
