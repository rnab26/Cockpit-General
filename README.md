# Cockpit

Le cockpit de développement de Raphaël, **un seul pour tous ses projets** :
les chantiers, les questions-réponses avec les sessions Claude Code, la
validation par un humain de ce qui est livré, et la progression des sessions
en direct. Né le 28 septembre 2026 des trois cockpits précédents (Jarvis,
Trieur de data, FacePro) et des décisions consignées dans
`rnab26/dotfiles/cockpit-kit/DECISIONS-2026-09-28.md`.

## Les trois pièces

| Pièce | Où | Pour qui |
| --- | --- | --- |
| **L'app centrale** | https://rnab26.github.io/cockpit/ (`app/`) | Raphaël, sur tous ses projets, depuis son téléphone |
| **Le module embarqué** | `embed/cockpit-embed.js`, une balise `<script>` à coller dans n'importe quel site | Les utilisateurs finaux d'un projet (ils voient les demandes de leur projet, en créent, répondent, certifient) |
| **Les scripts des sessions** | `scripts/`, `hooks/`, installés par `scripts/brancher.sh` | Les sessions Claude Code, quel que soit le stack du projet |

Tout repose sur **une base Supabase centrale** (projet `bexiyvmdbxcwxasgslxp`,
schéma `cockpit`, migrations dans `supabase/migrations/`). Un projet = une
ligne dans `cockpit.projets` ; brancher un projet ne dépend ni de son
hébergement ni de son langage.

## Le cycle d'un chantier

```
à trier → à cadrer → libre → en cours → à vérifier → validé
                                  ↑            │
                                  └────────────┘   « Corriger » : même ligne, jamais un doublon
          + bloqué, reporté, doublon (fusionné)
```

L'état est une **colonne**, plus jamais un marqueur entre crochets dans une
note. Une session amène le chantier à « à vérifier » ; **seul un humain pose
« validé »** (« Ça fonctionne, je certifie »), sinon il renvoie en correction
sur la même ligne. Ce qu'il certifie entre dans « ce qui marche », pour ne
pas le recasser.

## Brancher un projet

```bash
git clone https://github.com/rnab26/cockpit
cockpit/scripts/brancher.sh --projet facepro --nom "FacePro" --depot rnab26/Facepro --dossier /chemin/vers/Facepro
```

Ça crée le projet en base, copie les scripts et le hook de démarrage dans le
dépôt cible, déclare le hook et `COCKPIT_PROJET` dans `.claude/settings.json`,
ajoute le bloc « Cockpit » au `CLAUDE.md`, et imprime la balise du module
embarqué avec la clé du projet. Prérequis dans l'environnement cloud Claude
Code du projet : `SUPABASE_SERVICE_ROLE_KEY` (déjà en place sur les
environnements de Raphaël), `jq`, `curl`, `python3`.

## Ce qu'une session fait

```bash
scripts/sql.sh "select reserver_chantier('<id>', '<branche>', 120)"          # avant de toucher
scripts/progression.sh --chantier "Écran central" --etape "Bacs" --pct 40 --eta 25m   # à chaque étape
scripts/progression.sh --chantier "Écran central" --termine "Livré, à vérifier"      # en terminant
scripts/demander.sh --chantier … --question … --pourquoi … --option "A|aide|recommande"
```

`progression.sh` imprime dans la session le même tableau de barres que l'app
dessine en temps réel : c'est le visuel de progression, sans le demander.

## Le module embarqué

```html
<script src="https://rnab26.github.io/cockpit/embed/cockpit-embed.js"
        data-cle="<cle_embed du projet>" data-utilisateur="Prénom"></script>
```

Sans framework, dans un Shadow DOM (le style du site hôte ne le traverse
pas), il parle à la fonction serveur `cockpit-embed` qui tient la clé de
service. La clé d'un projet se lit dans l'app (Projets & membres) ; elle ne
donne accès qu'aux chantiers visibles de ce projet.

## Développer le cockpit lui-même

Le cockpit se suit dans le cockpit (projet `cockpit`). Voir `CLAUDE.md`.

- App : `cd app && npm ci && npm run dev` ; build `npm run build` ; parcours
  navigateur `node scripts/verifier-web.mjs` ; contrôles purs
  `node --experimental-strip-types scripts/verifier-*.ts`.
- Fonction serveur : `VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-embed`,
  puis `node scripts/verifier-embed.mjs`.
- Migrations : `scripts/sql.sh < supabase/migrations/000N_….sql` (idempotentes).
- Déploiement : push sur `main` → `.github/workflows/deploy.yml` publie
  `app/dist` + `embed/` sur la branche `gh-pages`.
