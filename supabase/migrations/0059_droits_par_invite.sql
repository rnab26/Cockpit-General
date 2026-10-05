-- 0059 — Droits AU CAS PAR CAS pour chaque invité (chantier 6e3cbee5, réponse de Raphaël
-- « Droits au cas par cas » à la question « Quels droits donner à un invité ? »).
-- Idempotente, schéma cockpit seulement.
--
-- Le rôle (lecteur / suggère / valide) reste un MODÈLE DE DÉPART. Trois droits peuvent
-- ensuite être réglés personne par personne, projet par projet, et écrasent le modèle :
--   demandes : créer des demandes (chantiers « à trier »)
--   messages : écrire dans les fils
--   valider  : certifier, corriger, répondre aux décisions
-- `droits` = jsonb { "demandes": bool, "messages": bool, "valider": bool } ; une clé
-- absente = ce que dit le rôle. UNE règle : cockpit.droit_dans(projet, droit).

alter table cockpit.membres     add column if not exists droits jsonb;
alter table cockpit.invitations add column if not exists droits jsonb;

create or replace function cockpit.droits_valides(p jsonb)
returns boolean language sql immutable as $$
  select p is null or (jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_each(p) e
                    where e.key not in ('demandes', 'messages', 'valider')
                       or jsonb_typeof(e.value) <> 'boolean'));
$$;
alter table cockpit.membres drop constraint if exists membres_droits_check;
alter table cockpit.membres add constraint membres_droits_check check (cockpit.droits_valides(droits));
alter table cockpit.invitations drop constraint if exists invitations_droits_check;
alter table cockpit.invitations add constraint invitations_droits_check check (cockpit.droits_valides(droits));

-- Valeur par défaut d'un droit selon le rôle (le modèle).
create or replace function cockpit.droit_du_role(p_role text, p_droit text)
returns boolean language sql immutable as $$
  select case p_droit
    when 'demandes' then p_role in ('suggere', 'utilisateur')
    when 'messages' then p_role in ('suggere', 'utilisateur')
    when 'valider'  then p_role = 'utilisateur'
    else false end;
$$;

-- LA règle : admin = tout ; membre = son réglage personnel, sinon le modèle de son rôle.
create or replace function cockpit.droit_dans(p_projet uuid, p_droit text)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select case when cockpit.est_admin() then true
    else coalesce((select coalesce((m.droits ->> p_droit)::boolean, cockpit.droit_du_role(m.role, p_droit))
                   from cockpit.membres m where m.projet_id = p_projet and m.user_id = auth.uid()), false) end;
$$;

create or replace function cockpit.peut_suggerer(p_projet uuid)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select cockpit.droit_dans(p_projet, 'demandes') or cockpit.droit_dans(p_projet, 'messages');
$$;

create or replace function cockpit.peut_agir(p_chantier uuid)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select cockpit.est_service() or cockpit.est_admin() or exists (
    select 1 from cockpit.chantiers c
    where c.id = p_chantier and c.visible_utilisateurs
      and cockpit.droit_dans(c.projet_id, 'valider'));
$$;

drop policy if exists membre_chantiers_cree on cockpit.chantiers;
create policy membre_chantiers_cree on cockpit.chantiers for insert
  with check (cockpit.droit_dans(projet_id, 'demandes') and origine = 'utilisateur' and etat = 'a_trier');
drop policy if exists membre_messages_ecrit on cockpit.messages;
create policy membre_messages_ecrit on cockpit.messages for insert
  with check (cockpit.droit_dans(projet_id, 'messages') and auteur_type = 'utilisateur'
              and kind in ('reponse','info'));

-- Invitation avec droits personnalisés (la signature à 4 arguments disparaît).
drop function if exists cockpit.inviter(uuid, text, text, int);
create or replace function cockpit.inviter(p_projet uuid, p_role text, p_nom text default null,
                                           p_jours int default 7, p_droits jsonb default null)
returns text language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_jeton text;
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  perform cockpit.exiger(p_role in ('lecteur', 'suggere', 'utilisateur'), 'rôle inconnu');
  perform cockpit.exiger(p_jours between 1 and 60, 'durée : 1 à 60 jours');
  perform cockpit.exiger(cockpit.droits_valides(p_droits), 'droits inconnus');
  v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into cockpit.invitations (projet_id, role, nom, jeton_hash, cree_par, expire_at, droits)
  values (p_projet, p_role, nullif(trim(p_nom), ''), cockpit.hacher_jeton(v_jeton), auth.uid(),
          now() + make_interval(days => p_jours), p_droits);
  return v_jeton;
end $$;

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
    insert into cockpit.membres (projet_id, user_id, role, nom, invite_par, droits)
    values (i.projet_id, auth.uid(), i.role, i.nom, i.cree_par, i.droits)
    on conflict (projet_id, user_id) do nothing;   -- déjà membre : on ne change pas ses droits
  end if;
  update cockpit.invitations set utilise_at = now(), utilise_par = auth.uid() where id = i.id;
  return jsonb_build_object('projet', v_nom, 'role', i.role);
end $$;

drop function if exists cockpit.invitations_du_projet(uuid);
create or replace function cockpit.invitations_du_projet(p_projet uuid)
returns table (id uuid, role text, nom text, created_at timestamptz, expire_at timestamptz, etat text, droits jsonb)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select i.id, i.role, i.nom, i.created_at, i.expire_at,
         case when i.revoque_at is not null then 'retirée'
              when i.utilise_at is not null then 'utilisée'
              when i.expire_at <= now() then 'expirée' else 'en attente' end,
         i.droits
  from cockpit.invitations i
  where i.projet_id = p_projet and cockpit.est_admin()
  order by i.created_at desc limit 30;
$$;

drop function if exists cockpit.membres_detail(uuid);
create or replace function cockpit.membres_detail(p_projet uuid)
returns table (user_id uuid, email text, nom text, role text, depuis timestamptz,
               nb_actions bigint, derniere_action timestamptz, droits jsonb)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select m.user_id, u.email::text, m.nom, m.role, m.created_at,
    (select count(*) from cockpit.messages x where x.projet_id = p_projet and x.auteur_user = m.user_id)
      + (select count(*) from cockpit.chantiers c where c.projet_id = p_projet and c.auteur_user = m.user_id),
    greatest(
      (select max(x.created_at) from cockpit.messages x where x.projet_id = p_projet and x.auteur_user = m.user_id),
      (select max(c.created_at) from cockpit.chantiers c where c.projet_id = p_projet and c.auteur_user = m.user_id)),
    m.droits
  from cockpit.membres m join auth.users u on u.id = m.user_id
  where m.projet_id = p_projet and cockpit.est_admin()
  order by m.created_at;
$$;

-- Changer le modèle de départ remet les droits personnels à zéro (sinon l'écran mentirait).
create or replace function cockpit.changer_role_membre(p_projet uuid, p_user uuid, p_role text)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  perform cockpit.exiger(p_role in ('lecteur', 'suggere', 'utilisateur'), 'rôle inconnu');
  update cockpit.membres set role = p_role, droits = null where projet_id = p_projet and user_id = p_user;
  if not found then raise exception 'cette personne n''est pas membre du projet'; end if;
end $$;

-- Règle les droits d'UNE personne ; p_droits null = revenir au modèle de son rôle.
create or replace function cockpit.changer_droits_membre(p_projet uuid, p_user uuid, p_droits jsonb)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  perform cockpit.exiger(cockpit.droits_valides(p_droits), 'droits inconnus');
  update cockpit.membres set droits = p_droits where projet_id = p_projet and user_id = p_user;
  if not found then raise exception 'cette personne n''est pas membre du projet'; end if;
end $$;

-- moi() : rôle ET droits effectifs par projet (l'écran adapte ses boutons ; le serveur refuse de toute façon).
create or replace function cockpit.moi()
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  select jsonb_build_object('user_id', auth.uid(), 'admin', cockpit.est_admin(),
    'email', (select email from auth.users where id = auth.uid()),
    'roles', coalesce((select jsonb_object_agg(m.projet_id, m.role) from cockpit.membres m where m.user_id = auth.uid()), '{}'::jsonb),
    'droits', coalesce((select jsonb_object_agg(m.projet_id, jsonb_build_object(
        'demandes', coalesce((m.droits ->> 'demandes')::boolean, cockpit.droit_du_role(m.role, 'demandes')),
        'messages', coalesce((m.droits ->> 'messages')::boolean, cockpit.droit_du_role(m.role, 'messages')),
        'valider',  coalesce((m.droits ->> 'valider')::boolean,  cockpit.droit_du_role(m.role, 'valider'))))
      from cockpit.membres m where m.user_id = auth.uid()), '{}'::jsonb));
$$;

do $$ declare f text; begin
  foreach f in array array[
    'droit_dans(uuid,text)', 'peut_suggerer(uuid)', 'inviter(uuid,text,text,int,jsonb)',
    'invitations_du_projet(uuid)', 'membres_detail(uuid)', 'changer_role_membre(uuid,uuid,text)',
    'changer_droits_membre(uuid,uuid,jsonb)', 'accepter_invitation(text)', 'droit_du_role(text,text)',
    'droits_valides(jsonb)'] loop
    execute format('revoke all on function cockpit.%s from public, anon', f);
    execute format('grant execute on function cockpit.%s to authenticated, service_role', f);
  end loop;
end $$;
grant execute on function cockpit.moi() to authenticated, service_role;
