-- 0058 — Inviter des personnes sur un projet, avec des droits, et savoir qui a fait quoi.
-- Chantier 6e3cbee5 « Invité ». Idempotente, schéma cockpit seulement.
--
-- Avant : un membre = un seul rôle, ajouté par e-mail s'il avait déjà un compte ;
-- il lisait toute la ligne `projets` (clé du module embarqué et destinataire
-- comptable compris) et rien ne disait qui avait écrit quoi (auteur = texte
-- libre posé par le navigateur).
-- Maintenant :
--   rôles par projet : 'lecteur' (voit), 'suggere' (voit + écrit des demandes
--   et des messages), 'utilisateur' (= valide : en plus certifie / corrige /
--   répond aux décisions ; c'est l'ancien comportement, donc rien ne change
--   pour les membres existants) ;
--   invitation par LIEN à copier (aucun e-mail envoyé en son nom) : jeton
--   haché, un seul usage, expire ;
--   auteur posé par le SERVEUR (trigger) sur tout ce que fait un non-admin ;
--   journal « qui a fait quoi » ; la clé embed et les réglages internes ne
--   sortent plus vers un membre.

-- ------------------------------------------------------------------ rôles
alter table cockpit.membres drop constraint if exists membres_role_check;
alter table cockpit.membres add constraint membres_role_check
  check (role in ('lecteur', 'suggere', 'utilisateur'));
alter table cockpit.membres add column if not exists nom text;
alter table cockpit.membres add column if not exists invite_par uuid;

create or replace function cockpit.role_dans(p_projet uuid)
returns text language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select case when cockpit.est_admin() then 'admin'
              else (select m.role from cockpit.membres m
                    where m.projet_id = p_projet and m.user_id = auth.uid()) end;
$$;

-- Peut écrire une demande ou un message : admin, suggere, utilisateur.
create or replace function cockpit.peut_suggerer(p_projet uuid)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select cockpit.role_dans(p_projet) in ('admin', 'suggere', 'utilisateur');
$$;

-- Certifier / corriger / répondre aux décisions : le rôle « valide » seulement.
create or replace function cockpit.peut_agir(p_chantier uuid)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select cockpit.est_service() or cockpit.est_admin() or exists (
    select 1 from cockpit.chantiers c
    where c.id = p_chantier and c.visible_utilisateurs
      and cockpit.role_dans(c.projet_id) = 'utilisateur');
$$;

drop policy if exists membre_chantiers_cree on cockpit.chantiers;
create policy membre_chantiers_cree on cockpit.chantiers for insert
  with check (cockpit.peut_suggerer(projet_id) and origine = 'utilisateur' and etat = 'a_trier');
drop policy if exists membre_messages_ecrit on cockpit.messages;
create policy membre_messages_ecrit on cockpit.messages for insert
  with check (cockpit.peut_suggerer(projet_id) and auteur_type = 'utilisateur'
              and kind in ('reponse','info'));

-- ----------------------------------------------- qui a fait quoi (serveur)
alter table cockpit.messages add column if not exists auteur_user uuid;
alter table cockpit.chantiers add column if not exists auteur_user uuid;

-- Tout ce qu'écrit une personne connectée qui n'est pas admin porte son
-- identité réelle, quoi que le navigateur ait envoyé. Les sessions
-- (service_role, pas d'utilisateur) et les admins ne sont pas touchés.
create or replace function cockpit.poser_auteur()
returns trigger language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  if auth.uid() is not null and not cockpit.est_admin() then
    new.auteur_user := auth.uid();
    if tg_table_name = 'messages' then
      new.auteur := coalesce((select u.email::text from auth.users u where u.id = auth.uid()), new.auteur);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists poser_auteur on cockpit.messages;
create trigger poser_auteur before insert on cockpit.messages
  for each row execute function cockpit.poser_auteur();
drop trigger if exists poser_auteur on cockpit.chantiers;
create trigger poser_auteur before insert on cockpit.chantiers
  for each row execute function cockpit.poser_auteur();
revoke all on function cockpit.poser_auteur() from public, anon, authenticated;

-- ----------------------------------------------------------- invitations
create table if not exists cockpit.invitations (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references cockpit.projets (id) on delete cascade,
  role        text not null check (role in ('lecteur', 'suggere', 'utilisateur')),
  nom         text,                        -- pour s'y retrouver (« Dana, comptable »)
  jeton_hash  text not null unique,        -- sha256 du jeton : le jeton lui-même n'est jamais gardé
  cree_par    uuid,
  created_at  timestamptz not null default now(),
  expire_at   timestamptz not null,
  utilise_at  timestamptz,
  utilise_par uuid,
  revoque_at  timestamptz
);
create index if not exists invitations_projet_idx on cockpit.invitations (projet_id, created_at desc);
alter table cockpit.invitations enable row level security;
alter table cockpit.invitations replica identity full;
drop policy if exists admin_tout on cockpit.invitations;
create policy admin_tout on cockpit.invitations for all
  using (cockpit.est_admin()) with check (cockpit.est_admin());

create or replace function cockpit.hacher_jeton(p_jeton text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_jeton, ''), 'utf8')), 'hex');
$$;

-- Crée une invitation ; le jeton n'est rendu QU'ICI (admin seulement).
create or replace function cockpit.inviter(p_projet uuid, p_role text, p_nom text default null, p_jours int default 7)
returns text language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_jeton text;
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  perform cockpit.exiger(p_role in ('lecteur', 'suggere', 'utilisateur'), 'rôle inconnu');
  perform cockpit.exiger(p_jours between 1 and 60, 'durée : 1 à 60 jours');
  v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into cockpit.invitations (projet_id, role, nom, jeton_hash, cree_par, expire_at)
  values (p_projet, p_role, nullif(trim(p_nom), ''), cockpit.hacher_jeton(v_jeton), auth.uid(),
          now() + make_interval(days => p_jours));
  return v_jeton;
end $$;

-- Ce que voit la personne invitée avant d'accepter : le nom du projet, le rôle.
create or replace function cockpit.invitation_info(p_jeton text)
returns jsonb language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select coalesce((
    select jsonb_build_object(
      'projet', p.nom, 'role', i.role,
      'valide', i.utilise_at is null and i.revoque_at is null and i.expire_at > now(),
      'raison', case when i.revoque_at is not null then 'retirée'
                     when i.utilise_at is not null then 'déjà utilisée'
                     when i.expire_at <= now() then 'expirée' end)
    from cockpit.invitations i join cockpit.projets p on p.id = i.projet_id
    where i.jeton_hash = cockpit.hacher_jeton(p_jeton)),
    jsonb_build_object('valide', false, 'raison', 'inconnue'));
$$;

-- La personne connectée accepte : elle devient membre avec le rôle prévu.
create or replace function cockpit.accepter_invitation(p_jeton text)
returns jsonb language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare i cockpit.invitations; v_nom text;
begin
  perform cockpit.exiger(auth.uid() is not null, 'connecte-toi d''abord');
  select * into i from cockpit.invitations where jeton_hash = cockpit.hacher_jeton(p_jeton) for update;
  if i.id is null then raise exception 'invitation inconnue'; end if;
  if i.revoque_at is not null then raise exception 'invitation retirée : demande-en une nouvelle'; end if;
  if i.utilise_at is not null then raise exception 'invitation déjà utilisée : demande-en une nouvelle'; end if;
  if i.expire_at <= now() then raise exception 'invitation expirée : demande-en une nouvelle'; end if;
  select nom into v_nom from cockpit.projets where id = i.projet_id;
  if not cockpit.est_admin() then
    insert into cockpit.membres (projet_id, user_id, role, nom, invite_par)
    values (i.projet_id, auth.uid(), i.role, i.nom, i.cree_par)
    on conflict (projet_id, user_id) do nothing;   -- déjà membre : on ne change pas ses droits
  end if;
  update cockpit.invitations set utilise_at = now(), utilise_par = auth.uid() where id = i.id;
  return jsonb_build_object('projet', v_nom, 'role', i.role);
end $$;

create or replace function cockpit.revoquer_invitation(p_id uuid)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  update cockpit.invitations set revoque_at = now()
   where id = p_id and utilise_at is null and revoque_at is null;
end $$;

create or replace function cockpit.invitations_du_projet(p_projet uuid)
returns table (id uuid, role text, nom text, created_at timestamptz, expire_at timestamptz, etat text)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select i.id, i.role, i.nom, i.created_at, i.expire_at,
         case when i.revoque_at is not null then 'retirée'
              when i.utilise_at is not null then 'utilisée'
              when i.expire_at <= now() then 'expirée' else 'en attente' end
  from cockpit.invitations i
  where i.projet_id = p_projet and cockpit.est_admin()
  order by i.created_at desc limit 30;
$$;

-- --------------------------------------------------------- gérer les invités
create or replace function cockpit.membres_detail(p_projet uuid)
returns table (user_id uuid, email text, nom text, role text, depuis timestamptz,
               nb_actions bigint, derniere_action timestamptz)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select m.user_id, u.email::text, m.nom, m.role, m.created_at,
    (select count(*) from cockpit.messages x where x.projet_id = p_projet and x.auteur_user = m.user_id)
      + (select count(*) from cockpit.chantiers c where c.projet_id = p_projet and c.auteur_user = m.user_id),
    greatest(
      (select max(x.created_at) from cockpit.messages x where x.projet_id = p_projet and x.auteur_user = m.user_id),
      (select max(c.created_at) from cockpit.chantiers c where c.projet_id = p_projet and c.auteur_user = m.user_id))
  from cockpit.membres m join auth.users u on u.id = m.user_id
  where m.projet_id = p_projet and cockpit.est_admin()
  order by m.created_at;
$$;

create or replace function cockpit.changer_role_membre(p_projet uuid, p_user uuid, p_role text)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  perform cockpit.exiger(p_role in ('lecteur', 'suggere', 'utilisateur'), 'rôle inconnu');
  update cockpit.membres set role = p_role where projet_id = p_projet and user_id = p_user;
  if not found then raise exception 'cette personne n''est pas membre du projet'; end if;
end $$;

-- Journal : ce que les invités (non-admins connectés) ont fait sur le projet.
create or replace function cockpit.journal_invites(p_projet uuid, p_limite int default 100)
returns table (quand timestamptz, user_id uuid, email text, nature text, texte text,
               chantier_id uuid, chantier_titre text)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select * from (
    select c.created_at, c.auteur_user, u.email::text, 'demande'::text, c.titre, c.id, c.titre
      from cockpit.chantiers c left join auth.users u on u.id = c.auteur_user
     where c.projet_id = p_projet and c.auteur_user is not null
    union all
    select m.created_at, m.auteur_user, u.email::text,
           case m.kind when 'constat' then 'verdict' when 'reponse' then 'réponse' else 'message' end,
           left(m.corps, 300), m.chantier_id, c.titre
      from cockpit.messages m left join auth.users u on u.id = m.auteur_user
      left join cockpit.chantiers c on c.id = m.chantier_id
     where m.projet_id = p_projet and m.auteur_user is not null
  ) j(quand, user_id, email, nature, texte, chantier_id, chantier_titre)
  where cockpit.est_admin()
  order by quand desc limit greatest(1, least(coalesce(p_limite, 100), 500));
$$;

-- --------------------------- rien d'interne ne sort vers un membre (projets)
-- Un membre lisait toute la ligne projets (cle_embed, compta_*). Il passe
-- maintenant par projets_visibles(), qui vide ces colonnes pour lui.
drop policy if exists membre_projets on cockpit.projets;
create or replace function cockpit.projets_visibles()
returns setof jsonb language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select case when cockpit.est_admin() then to_jsonb(p)
         else jsonb_build_object('id', p.id, 'slug', p.slug, 'nom', p.nom, 'description', p.description,
                'couleur', p.couleur, 'depot', p.depot, 'url_site', p.url_site, 'actif', p.actif,
                'created_at', p.created_at) end
  from cockpit.projets p where cockpit.est_membre(p.id);
$$;

-- moi() dit aussi le rôle de la personne dans chaque projet (l'écran adapte ses boutons ;
-- le serveur, lui, refuse de toute façon).
create or replace function cockpit.moi()
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  select jsonb_build_object('user_id', auth.uid(), 'admin', cockpit.est_admin(),
    'email', (select email from auth.users where id = auth.uid()),
    'roles', coalesce((select jsonb_object_agg(m.projet_id, m.role) from cockpit.membres m where m.user_id = auth.uid()), '{}'::jsonb));
$$;

-- ------------------------------------------------------------------ droits
do $$ declare f text; begin
  foreach f in array array[
    'role_dans(uuid)', 'peut_suggerer(uuid)', 'inviter(uuid,text,text,int)',
    'accepter_invitation(text)', 'revoquer_invitation(uuid)', 'invitations_du_projet(uuid)',
    'membres_detail(uuid)', 'changer_role_membre(uuid,uuid,text)', 'journal_invites(uuid,int)',
    'projets_visibles()', 'hacher_jeton(text)', 'invitation_info(text)'] loop
    execute format('revoke all on function cockpit.%s from public, anon', f);
    execute format('grant execute on function cockpit.%s to authenticated, service_role', f);
  end loop;
end $$;
-- La personne invitée voit le nom du projet avant même d'avoir un compte.
grant execute on function cockpit.invitation_info(text) to anon;
revoke all on function cockpit.hacher_jeton(text) from authenticated;
grant execute on function cockpit.moi() to authenticated, service_role;
