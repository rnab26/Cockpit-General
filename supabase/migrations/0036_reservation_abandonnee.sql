-- 0036 (30 sept. 2026, Raphaël : « aucun intérêt à ce que les chantiers soient
-- réservés et que ça ne travaille pas »). Une réservation (jusqu'à 3 h) protégeait
-- un chantier « en cours » même quand plus rien ne travaillait dessus : la chef
-- voyait « aucun chantier à prendre » pendant que 9 chantiers dormaient réservés.
-- Désormais la réservation ne protège un chantier « en cours » que tant que
-- quelque chose y travaille : UNE règle, chantier_abandonne, lue par
-- chantiers_prenables ET reserver_chantier (jamais dupliquée).
-- Idempotente ; ne touche que le schéma cockpit.

-- Abandonné = en cours, fiche immobile depuis 30 min, aucune activité, tâche
-- (agent) ni session vivante du projet qui le tienne (signe de vie < 30 min).
create or replace function cockpit.chantier_abandonne(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.etat = 'en_cours'
     and c.updated_at < now() - interval '30 minutes'
     and not exists (
       select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
          and a.updated_at > now() - interval '30 minutes')
     and not exists (
       select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
          and t.vu_at > now() - interval '30 minutes')
     and not exists (
       select 1 from cockpit.sessions se
        where se.projet_id = c.projet_id and se.fin_at is null and se.vu_at > now() - interval '30 minutes'
          and se.branche is not null
          and (se.branche = c.pris_par
               or se.branche = (select a.session from cockpit.activite a where a.chantier_id = c.id
                                 order by a.updated_at desc limit 1)));
$$;

create or replace function cockpit.chantiers_prenables(p_projet_id uuid, p_par text default null)
returns setof cockpit.chantiers language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.doublon_de is null
     and ((c.etat in ('libre', 'a_trier')
           and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par))
          or cockpit.chantier_abandonne(c))
     and not exists (
       select 1 from cockpit.renforts r
        where r.projet_id = c.projet_id and cockpit.renfort_vivant(r)
          and r.section_id is not distinct from c.section_id
          and coalesce(p_par, '') not like r.prefixe || '/%')
   order by (c.priorite = 'haute') desc, case c.etat when 'en_cours' then 0 when 'libre' then 1 else 2 end, c.created_at;
$$;

create or replace function cockpit.reserver_chantier(p_id uuid, p_par text, p_minutes integer default 120)
returns boolean language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pris boolean;
begin
  update cockpit.chantiers c
     set pris_par = p_par,
         pris_jusqu_a = now() + make_interval(mins => greatest(p_minutes, 1)),
         etat = case when c.etat in ('libre','a_trier') then 'en_cours' else c.etat end
   where c.id = p_id
     and c.archived_at is null
     and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par
          or cockpit.chantier_abandonne(c))
  returning true into pris;
  return coalesce(pris, false);
end $$;

revoke execute on function cockpit.chantier_abandonne(cockpit.chantiers) from public;
grant execute on function cockpit.chantier_abandonne(cockpit.chantiers) to service_role;
