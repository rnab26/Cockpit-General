-- Un admin ajoute un utilisateur final à un projet par son e-mail : le
-- navigateur ne peut pas lire auth.users, la fonction le fait pour lui.
-- Le compte doit déjà exister (inscription par l'écran de connexion).
create or replace function cockpit.ajouter_membre(p_projet uuid, p_email text)
returns text language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_user uuid;
begin
  if not cockpit.est_admin() then raise exception 'réservé aux admins'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    return 'aucun compte avec cette adresse : la personne doit d''abord se connecter une fois';
  end if;
  insert into cockpit.membres (projet_id, user_id) values (p_projet, v_user)
  on conflict do nothing;
  return 'ajouté';
end $$;

-- La liste des membres avec leur e-mail, pour l'écran d'un projet.
create or replace function cockpit.membres_du_projet(p_projet uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from cockpit.membres m join auth.users u on u.id = m.user_id
  where m.projet_id = p_projet and cockpit.est_admin();
$$;

-- L'e-mail de l'utilisateur courant, et s'il est admin (un seul appel au
-- chargement de l'app).
create or replace function cockpit.moi()
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  select jsonb_build_object('user_id', auth.uid(), 'admin', cockpit.est_admin(),
    'email', (select email from auth.users where id = auth.uid()));
$$;
grant execute on function cockpit.ajouter_membre(uuid, text), cockpit.membres_du_projet(uuid), cockpit.moi() to authenticated, service_role;
