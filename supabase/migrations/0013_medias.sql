-- Médias dans les réponses (29 sept. 2026)
--
-- Raphaël : « je n'ai plus la possibilité de répondre avec des cartes et
-- d'ajouter des médias dans mes réponses ; c'était bien hier » (hier = la
-- fiche Claude, cartes à cocher + bouton photo). Une question vit en base,
-- jamais dans un document externe : le cockpit doit donc porter les médias.
--
--  - messages.medias : les pièces jointes d'un message, une liste
--    [{chemin, nom, type, taille}] ; le fichier est dans le stockage ;
--  - espace de stockage PRIVÉ `cockpit-medias` (le bucket `cockpit` existant
--    appartient à Jarvis : on n'y touche pas) ; chemin
--    `<projet_id>/<chantier_id | projet>/<uuid>-<nom>` ;
--  - lire : membre du projet (et chantier visible des utilisateurs, sauf
--    admin) ; déposer : qui peut agir sur le chantier (ou membre, pour une
--    pièce de niveau projet) ; supprimer : admin seulement.
-- Les sessions lisent avec service_role (scripts/media.sh).

alter table cockpit.messages add column if not exists medias jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit)
values ('cockpit-medias', 'cockpit-medias', false, 52428800)   -- 50 Mo par fichier (plafond du plan gratuit)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Le projet et le chantier d'un chemin, sans jamais lever d'erreur sur un chemin mal formé.
create or replace function cockpit.media_uuid(p_segment text)
returns uuid language plpgsql immutable
set search_path = cockpit, pg_temp as $$
begin
  return p_segment::uuid;
exception when others then
  return null;
end $$;

create or replace function cockpit.peut_lire_media(p_nom text)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  with p as (select cockpit.media_uuid(split_part(p_nom, '/', 1)) projet,
                    split_part(p_nom, '/', 2) seg)
  select cockpit.est_admin() or exists (
    select 1 from p
    where p.projet is not null and cockpit.est_membre(p.projet)
      and (p.seg = 'projet' or exists (
        select 1 from cockpit.chantiers c
        where c.id = cockpit.media_uuid(p.seg) and c.projet_id = p.projet and c.visible_utilisateurs)));
$$;

create or replace function cockpit.peut_deposer_media(p_nom text)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  with p as (select cockpit.media_uuid(split_part(p_nom, '/', 1)) projet,
                    split_part(p_nom, '/', 2) seg)
  select cockpit.est_admin() or exists (
    select 1 from p
    where p.projet is not null and cockpit.est_membre(p.projet)
      and (p.seg = 'projet' or exists (
        select 1 from cockpit.chantiers c
        where c.id = cockpit.media_uuid(p.seg) and c.projet_id = p.projet and cockpit.peut_agir(c.id))));
$$;

-- Leçon du 28 sept. (0004) : EXECUTE n'est jamais laissé à PUBLIC.
revoke all on function cockpit.media_uuid(text), cockpit.peut_lire_media(text), cockpit.peut_deposer_media(text) from public, anon;
grant execute on function cockpit.media_uuid(text), cockpit.peut_lire_media(text), cockpit.peut_deposer_media(text) to authenticated, service_role;

drop policy if exists cockpit_medias_lit on storage.objects;
create policy cockpit_medias_lit on storage.objects for select to authenticated
  using (bucket_id = 'cockpit-medias' and cockpit.peut_lire_media(name));
drop policy if exists cockpit_medias_depose on storage.objects;
create policy cockpit_medias_depose on storage.objects for insert to authenticated
  with check (bucket_id = 'cockpit-medias' and cockpit.peut_deposer_media(name));
drop policy if exists cockpit_medias_supprime on storage.objects;
create policy cockpit_medias_supprime on storage.objects for delete to authenticated
  using (bucket_id = 'cockpit-medias' and cockpit.est_admin());
