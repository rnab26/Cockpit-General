-- 0052 (5 oct. 2026, chantier 8486b809). Raphaël : « la chef doit réfléchir à une logique de
-- fusion quand elle reçoit les chantiers […] regrouper ceux qui peuvent être faits ensemble […]
-- et une fois livrés, qu'on comprenne que deux chantiers ont été fusionnés, actualisé en
-- parallèle dans le cockpit du projet. Ça évite plusieurs correctifs séparés. »
-- Deux pièces, une règle chacune :
--  1. groupes_possibles(projet, ids) : paires de chantiers OUVERTS du projet (dont au moins un
--     est servi à la chef) assez proches pour être traités par UN agent ; même mesure que la
--     fusion suggérée (ressemblance_fusion), seuil plus bas (0,35) car ici on ne fusionne pas,
--     on regroupe le travail. Écarte les paires déjà tranchées « Garder séparés ».
--  2. Un trigger : quand un chantier passe « à vérifier » (livré), chaque chantier qu'il a
--     absorbé (doublon_de) ou qui a été regroupé avec lui reçoit UNE ligne dans son fil
--     « Livré avec « X » », et le chantier livré dit lesquels il couvre. Toutes voies.
-- Le regroupement sans fusion s'écrit dans chantiers.groupe_avec (uuid[]), posé par la chef
-- (regrouper_chantiers, service seulement). Idempotente.

alter table cockpit.chantiers add column if not exists groupe_avec uuid[] not null default '{}';

create or replace function cockpit.groupes_possibles(p_projet text, p_ids uuid[])
returns table (a uuid, titre_a text, b uuid, titre_b text, score real)
language sql stable security definer set search_path = cockpit, extensions, pg_temp as $$
  select x.id, x.titre, y.id, y.titre, cockpit.ressemblance_fusion(x.titre, y.titre)
  from cockpit.chantiers x
  join cockpit.projets p on p.id = x.projet_id and p.slug = p_projet
  join cockpit.chantiers y on y.projet_id = x.projet_id and y.id > x.id
  where cockpit.est_service()
    and x.archived_at is null and x.doublon_de is null and x.etat in ('libre','a_trier','a_cadrer','en_cours')
    and y.archived_at is null and y.doublon_de is null and y.etat in ('libre','a_trier','a_cadrer','en_cours')
    and (x.id = any (p_ids) or y.id = any (p_ids))
    and cockpit.ressemblance_fusion(x.titre, y.titre) >= 0.35
    and not (y.id = any (x.groupe_avec))
    and not exists (select 1 from cockpit.messages m where m.kind = 'fusion' and m.reponse is not null
                    and m.options->0->>'libelle' is not null and m.reponse = 'Garder séparés'
                    and ((m.options->0->>'source' = x.id::text and m.options->0->>'cible' = y.id::text)
                      or (m.options->0->>'source' = y.id::text and m.options->0->>'cible' = x.id::text)))
  order by 5 desc
  limit 6;
$$;

-- La chef regroupe : les deux chantiers se connaissent (trace visible dans les deux fils).
create or replace function cockpit.regrouper_chantiers(p_a uuid, p_b uuid, p_pourquoi text, p_session text)
returns boolean language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare ca cockpit.chantiers; cb cockpit.chantiers;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into ca from cockpit.chantiers where id = p_a;
  select * into cb from cockpit.chantiers where id = p_b;
  if ca.id is null or cb.id is null or ca.id = cb.id or ca.projet_id <> cb.projet_id then return false; end if;
  if p_b = any (ca.groupe_avec) then return false; end if;
  update cockpit.chantiers set groupe_avec = array_append(groupe_avec, p_b) where id = p_a;
  update cockpit.chantiers set groupe_avec = array_append(groupe_avec, p_a) where id = p_b;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session)
  values (ca.projet_id, p_a, coalesce(p_session, 'chef'), 'proprietaire', 'info',
          'Regroupé avec « ' || cb.titre || ' » : un seul agent fait les deux' || coalesce(' — ' || nullif(p_pourquoi, ''), ''), true),
         (ca.projet_id, p_b, coalesce(p_session, 'chef'), 'proprietaire', 'info',
          'Regroupé avec « ' || ca.titre || ' » : un seul agent fait les deux' || coalesce(' — ' || nullif(p_pourquoi, ''), ''), true);
  return true;
end $$;

-- Livraison : le fil de chaque chantier absorbé ou regroupé le dit. Une ligne par couple et par livraison.
create or replace function cockpit.propager_livraison_fusion()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare o record; liste text;
begin
  if new.etat <> 'a_verifier' or old.etat is not distinct from 'a_verifier' then return new; end if;
  for o in select c.id, c.titre, c.projet_id from cockpit.chantiers c
            where c.doublon_de = new.id or c.id = any (new.groupe_avec) loop
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session)
    values (o.projet_id, o.id, 'cockpit', 'proprietaire', 'info',
            'Livré avec « ' || new.titre || ' » (traités ensemble). La vérification se fait sur ce chantier.', true);
  end loop;
  select string_agg('« ' || c.titre || ' »', ', ') into liste
    from cockpit.chantiers c where c.doublon_de = new.id or c.id = any (new.groupe_avec);
  if liste is not null then
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session)
    values (new.projet_id, new.id, 'cockpit', 'proprietaire', 'info', 'Cette livraison couvre aussi : ' || liste || '.', true);
  end if;
  return new;
end $$;

drop trigger if exists chantiers_livraison_fusion on cockpit.chantiers;
create trigger chantiers_livraison_fusion after update of etat on cockpit.chantiers
  for each row execute function cockpit.propager_livraison_fusion();

revoke all on function cockpit.groupes_possibles(text, uuid[]), cockpit.regrouper_chantiers(uuid, uuid, text, text),
  cockpit.propager_livraison_fusion() from public, anon, authenticated;
grant execute on function cockpit.groupes_possibles(text, uuid[]), cockpit.regrouper_chantiers(uuid, uuid, text, text) to service_role;
