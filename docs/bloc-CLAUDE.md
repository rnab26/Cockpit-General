
## Cockpit (rnab26/Cockpit-General)

Ce projet est suivi dans le cockpit central (projet `{{SLUG}}`, app
https://rnab26.github.io/Cockpit-General/, base Supabase centrale, schéma `cockpit`).
Le hook `.claude/hooks/cockpit-session-start.sh` injecte l'état au démarrage :
chantiers ouverts par section, questions en attente, réponses humaines,
demandes des utilisateurs, progression des autres sessions.

- **Chaque demande de travail de Raphaël → un chantier, AVANT de coder** :
  `scripts/cockpit-chantier.sh --ouvrir "<titre court>" --demande "<ses mots>"`.
  Il reprend (ou rouvre) le chantier existant au lieu d'en créer un doublon ;
  « ambigu » → choisis avec `--id` ou `--nouveau`, ou demande. Un rappel le
  redit à chaque message (hook `cockpit-prompt-rappel.sh`).
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
