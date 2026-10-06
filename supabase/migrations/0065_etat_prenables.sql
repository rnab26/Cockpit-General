-- 0065 — « N chantiers prêts » : la règle vit en base, l'app la LIT (5 oct. 2026).
-- Constaté à la revue : l'app recalculait chantiersPrenables (lib/autonome.ts) d'après une copie
-- de cockpit.chantiers_prenables restée à l'état de 0011 (30 min en dur, ni « livré sans suite »
-- 0051, ni agent qui tient le chantier 0054, ni renfort vivant) : le bandeau du mode autonome
-- affichait par exemple 3 chantiers prêts là où la base en prenait 2. Une seule règle : la base.
-- Une ligne par projet actif, pour un admin seulement (lecture ; rien ne s'écrit).
create or replace function cockpit.etat_prenables()
returns table (projet_id uuid, n integer)
language sql stable security definer
set search_path = cockpit, pg_temp
as $$
  select p.id, (select count(*)::int from cockpit.chantiers_prenables(p.id, null))
    from cockpit.projets p
   where cockpit.est_admin() and p.actif;
$$;
revoke all on function cockpit.etat_prenables() from public, anon;
grant execute on function cockpit.etat_prenables() to authenticated, service_role;
