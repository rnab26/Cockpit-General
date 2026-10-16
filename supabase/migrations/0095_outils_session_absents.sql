-- Outils de session que la routine du chef n'a PAS (16 oct. 2026, chantier fb19d6a8).
-- Une routine de réveil n'a pas toujours create_session / archive_session : chef.sh en listait les gestes à chaque
-- passe, impossibles. La chef le dit une fois (chef.sh --sans-outil <nom>) ; la passe cesse alors de les lister
-- et une carte claire est posée pour Raphaël. {outil: date}, périmé après 7 jours (une routine corrigée se reprend seule).
-- Idempotente. Table chefs : RLS, replica identity et politique déjà posées (0019).
alter table cockpit.chefs add column if not exists sans_outils jsonb not null default '{}'::jsonb;
