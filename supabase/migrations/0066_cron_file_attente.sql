-- 0066 : les 3 tâches planifiées de la base passent en « file d'attente » (chantier aba861fe).
-- Mesuré 6 oct. sur 24 h : 115 échecs « job startup timeout » (jusqu'à 150 s), les 3 jobs
-- partaient à la même seconde (*/3) et se doublaient quand l'un traînait.
-- Règle unique : UN SEUL job cockpit à la fois (verrou consultatif 724550) ; s'il est pris,
-- le passage est sauté et reprend au tick suivant (rien n'est perdu : chaque job est un balayage).
-- Départs décalés d'une minute. Idempotent ; ne touche que les 3 jobs cockpit-*.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent : rien à faire';
    return;
  end if;
  perform cron.schedule('cockpit-filet-securite', '0-59/3 * * * *',
    'select case when pg_try_advisory_xact_lock(724550) then cockpit.filet_passe() end');
  perform cron.schedule('cockpit-liberation-auto', '1-59/3 * * * *',
    'select case when pg_try_advisory_xact_lock(724550) then cockpit.liberation_passe() end');
  perform cron.schedule('cockpit-taches-mortes', '2-59/3 * * * *',
    'select case when pg_try_advisory_xact_lock(724550) then cockpit.clore_taches_mortes() end');
end $$;
