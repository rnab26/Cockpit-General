-- 0063 — Index sur les clés étrangères qui n'en avaient pas (5 oct. 2026).
-- Constaté : supprimer un projet (les bancs de test le font) déclenche des
-- cascades qui parcouraient en entier messages / taches / passes_autonomes ;
-- sur la petite instance partagée, ces suppressions dépassaient le délai de la
-- base (« canceling statement due to statement timeout ») et ralentissaient
-- tout le reste, la connexion de l'app comprise. Idempotent.
create index if not exists chantiers_doublon_de_idx       on cockpit.chantiers (doublon_de) where doublon_de is not null;
create index if not exists ce_qui_marche_projet_idx       on cockpit.ce_qui_marche (projet_id);
create index if not exists ce_qui_marche_chantier_idx     on cockpit.ce_qui_marche (chantier_id);
create index if not exists visites_projet_idx             on cockpit.visites (projet_id);
create index if not exists passes_autonomes_projet_idx    on cockpit.passes_autonomes (projet_id);
create index if not exists passes_autonomes_chantier_idx  on cockpit.passes_autonomes (chantier_id);
create index if not exists taches_chantier_idx            on cockpit.taches (chantier_id) where chantier_id is not null;
create index if not exists ouvertures_par_projet_idx      on cockpit.ouvertures (par_projet_id);
create index if not exists messages_chantier_lie_idx      on cockpit.messages (chantier_lie) where chantier_lie is not null;
