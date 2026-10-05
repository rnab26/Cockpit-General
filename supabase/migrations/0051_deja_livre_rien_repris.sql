-- 0051 (5 oct. 2026, chantier 72d09c69). Raphaël a répondu « Les 3 correctifs » :
-- pour que le cockpit se tienne à jour tout seul,
--   1. « Terminé » sort un chantier de « bloqué » (scripts/progression.sh, pas ici),
--   2. le mode autonome ne reprend pas un chantier déjà livré ni déjà pris,
--   3. les réservations expirées sont rendues.
-- Cause prouvée (base du 5 oct.) : chantiers_prenables (0036) ne regardait que
-- l'état et la réservation : un chantier « libre » dont la dernière activité est
-- « terminé », sans nouveau message de Raphaël depuis, était repris tel quel ; et
-- une réservation expirée restait écrite sur la fiche (pris_par rempli) jusqu'à
-- la prochaine prise.
-- Une seule règle « déjà livré » : cockpit.livre_sans_suite(c) = la dernière
-- activité du chantier est « terminé » ET ni Raphaël ni un utilisateur n'a écrit
-- depuis (un « Corriger » ou une réponse rouvre le chantier : il redevient prenable).
-- Idempotente.

create or replace function cockpit.livre_sans_suite(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce((select a.statut = 'termine' and not exists (
                     select 1 from cockpit.messages m
                      where m.chantier_id = c.id and m.auteur_type in ('proprietaire', 'utilisateur')
                        and m.created_at > a.updated_at)
                     from cockpit.activite a where a.chantier_id = c.id
                    order by a.updated_at desc limit 1), false);
$$;

-- Même définition qu'en 0036, plus : un chantier libre / à trier déjà livré sans suite n'est pas pris.
create or replace function cockpit.chantiers_prenables(p_projet_id uuid, p_par text default null)
returns setof cockpit.chantiers language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.doublon_de is null
     and ((c.etat in ('libre', 'a_trier')
           and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par)
           and not cockpit.livre_sans_suite(c))
          or cockpit.chantier_abandonne(c))
     and not exists (
       select 1 from cockpit.renforts r
        where r.projet_id = c.projet_id and cockpit.renfort_vivant(r)
          and r.section_id is not distinct from c.section_id
          and coalesce(p_par, '') not like r.prefixe || '/%')
   order by (c.priorite = 'haute') desc, case c.etat when 'en_cours' then 0 when 'libre' then 1 else 2 end, c.created_at;
$$;

-- Réservations expirées rendues : la fiche ne dit plus « pris par » pour rien.
-- Un chantier « en_cours » garde sa trace (chantier_abandonne s'en sert pour savoir qui l'a lâché).
-- Même corps que 0050 + le rendu, dans la passe pg_cron comme dans l'appel des sessions.
create or replace function cockpit.liberer_silencieux_coeur(p_projet text)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; c cockpit.chantiers; n integer := 0; v_min integer;
begin
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return 0; end if;
  for c in select * from cockpit.chantiers x
            where x.projet_id = pr.id and x.archived_at is null and x.pris_par is not null and x.pris_jusqu_a > now()
              and x.etat <> 'valide' and cockpit.sans_signe_de_vie(x)
            for update skip locked loop
    v_min := greatest(1, floor(extract(epoch from (now() - c.updated_at)) / 60))::int;
    update cockpit.chantiers set pris_jusqu_a = now(), libere_at = now(), libere_de = c.pris_par, libere_apres_min = v_min where id = c.id;
    update cockpit.messages set recu_at = null
     where chantier_id = c.id and recu_par = c.pris_par and recu_at is not null;
    n := n + 1;
  end loop;
  update cockpit.chantiers set pris_par = null, pris_jusqu_a = null
   where projet_id = pr.id and archived_at is null and pris_par is not null
     and pris_jusqu_a < now() and etat <> 'en_cours';
  return n;
end $$;

revoke all on function cockpit.livre_sans_suite(cockpit.chantiers) from public, anon, authenticated;
grant execute on function cockpit.livre_sans_suite(cockpit.chantiers) to service_role;
