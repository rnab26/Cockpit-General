-- RÉGLAGES DES NOTIFICATIONS (5 oct. 2026, chantier 70288582)
--
-- Raphaël : « pouvoir gérer et régler quel type de notifications on veut
-- recevoir via l'appli Chrome, pareil pour tous les projets, le plus simple
-- et intuitif possible. »
--
-- Trois pièces, UNE règle de décision côté serveur :
--   notif_types        le catalogue des types (code, libellé, défaut, `emis`) ;
--                      `emis` = le système envoie déjà réellement ce push. Un
--                      type non émis s'affiche « bientôt », SANS interrupteur.
--   notif_reglages     par personne : `types` (code → vrai/faux ; absent = le
--                      défaut du catalogue) et `projets_coupes` (les projets
--                      dont elle ne veut aucune notification ; vide = tous) ;
--   notif_veut / notif_destinataires : la règle. cockpit-push les appelle,
--                      l'écran n'en recalcule rien.
-- Jamais pour un projet de test. Idempotente.

create table if not exists cockpit.notif_types (
  code    text primary key,
  libelle text not null,
  aide    text not null,
  defaut  boolean not null default true,
  emis    boolean not null default false,
  ordre   int not null default 0
);
alter table cockpit.notif_types enable row level security;
alter table cockpit.notif_types replica identity full;
drop policy if exists admin_tout on cockpit.notif_types;
create policy admin_tout on cockpit.notif_types for all using (cockpit.est_admin()) with check (cockpit.est_admin());
drop policy if exists lecture_connecte on cockpit.notif_types;
create policy lecture_connecte on cockpit.notif_types for select to authenticated using (true);

insert into cockpit.notif_types (code, libelle, aide, defaut, emis, ordre) values
  ('reponse',  'Claude a répondu',            'Une réponse de Claude dans un fil ou dans la discussion d’un projet.', true,  true,  1),
  ('a_toi',    'Une question ou action « À toi »', 'Claude te pose une question ou attend un geste de ta part.',        true,  false, 2),
  ('pr',       'PR à fusionner',              'Une PR est prête, sans conflit, à fusionner.',                          true,  false, 3),
  ('termine',  'Chantier terminé, à vérifier', 'Un chantier est livré et attend ton « Ça marche ».',                   false, false, 4)
on conflict (code) do update set libelle = excluded.libelle, aide = excluded.aide, defaut = excluded.defaut, emis = excluded.emis, ordre = excluded.ordre;

create table if not exists cockpit.notif_reglages (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  types          jsonb not null default '{}'::jsonb check (jsonb_typeof(types) = 'object'),
  projets_coupes uuid[] not null default '{}',
  updated_at     timestamptz not null default now()
);
alter table cockpit.notif_reglages enable row level security;
alter table cockpit.notif_reglages replica identity full;
drop policy if exists admin_tout on cockpit.notif_reglages;
create policy admin_tout on cockpit.notif_reglages for all using (cockpit.est_admin()) with check (cockpit.est_admin());
drop policy if exists les_siens on cockpit.notif_reglages;
create policy les_siens on cockpit.notif_reglages for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- La règle pour UNE personne : ce type est-il voulu, sur ce projet ?
create or replace function cockpit.notif_veut(p_user uuid, p_type text, p_projet uuid)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce(
    (select (r.types ->> p_type)::boolean from cockpit.notif_reglages r where r.user_id = p_user and r.types ? p_type),
    (select t.defaut from cockpit.notif_types t where t.code = p_type),
    false)
  and not coalesce((select p_projet = any (r.projets_coupes) from cockpit.notif_reglages r where r.user_id = p_user), false);
$$;

-- Qui reçoit : admins et membres du projet qui veulent ce type sur ce projet.
-- Rien pour un projet de test, ni pour un type que le système n'émet pas.
create or replace function cockpit.notif_destinataires(p_type text, p_projet uuid)
returns table (user_id uuid) language sql stable security definer set search_path = cockpit, pg_temp as $$
  select u.id from (
    select a.user_id as id from cockpit.admins a
    union select m.user_id from cockpit.membres m where m.projet_id = p_projet
  ) u
  where exists (select 1 from cockpit.notif_types t where t.code = p_type and t.emis)
    and not cockpit.projet_de_test((select slug from cockpit.projets where id = p_projet))
    and cockpit.notif_veut(u.id, p_type, p_projet);
$$;

revoke all on function cockpit.notif_veut(uuid, text, uuid) from public, anon, authenticated;
revoke all on function cockpit.notif_destinataires(text, uuid) from public, anon, authenticated;
grant execute on function cockpit.notif_veut(uuid, text, uuid) to service_role;
grant execute on function cockpit.notif_destinataires(text, uuid) to service_role;
