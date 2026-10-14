-- Import automatique des reçus par e-mail : le battement se VOIT dans Coûts (13 oct. 2026, chantier 72a8d0f4).
--
-- Raphaël, après l'ajout à la main de ses reçus Claude : « Configure-le que ce soit constant, c'est mieux ». Une tâche
-- planifiée relit chaque semaine ses e-mails de reçus et ajoute les nouvelles factures (scripts/importer-recus.py, procédure
-- docs/recus-par-email.md). Une tâche qui tourne seule doit se laisser VOIR : sans cela, un échec silencieux ou une tâche
-- arrêtée ressemble à « rien de nouveau ». Ces colonnes sont le battement, par prestataire (service), lu par la carte du
-- prestataire dans l'onglet Coûts :
--   import_depuis         : l'import ne prend que les reçus datés de ce jour ou après (par défaut : le jour de l'ajout du
--                           prestataire ; les lignes existantes prennent le jour de cette migration). L'historique d'avant
--                           s'ajoute à part, avec l'accord précis de Raphaël (la plateforme l'exige pour écrire dans ses données).
--   import_cadence_jours  : tous les combien de jours la tâche doit passer (nul = pas d'import automatique pour ce prestataire).
--                           Sert à dire « en retard » SANS seuil codé en dur dans l'écran (en retard = plus de 2 cadences).
--   import_at, import_statut ('ok' | 'echec'), import_note : le dernier passage, son issue, une phrase pour Raphaël.
-- Données internes : la table est déjà réservée aux admins (RLS admin_tout), rien à ajouter. Idempotente.

alter table cockpit.services add column if not exists import_depuis date not null default current_date;
alter table cockpit.services add column if not exists import_cadence_jours integer
  check (import_cadence_jours is null or import_cadence_jours between 1 and 90);
alter table cockpit.services add column if not exists import_at timestamptz;
alter table cockpit.services add column if not exists import_statut text
  check (import_statut is null or import_statut in ('ok', 'echec'));
alter table cockpit.services add column if not exists import_note text
  check (import_note is null or length(import_note) <= 300);
