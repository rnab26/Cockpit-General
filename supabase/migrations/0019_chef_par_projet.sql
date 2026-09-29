-- UN CHEF PAR PROJET (29 sept. 2026) — remplace « une session chef pour tous » (0014)
--
-- Raphaël : « Dans la session du cockpit je vois différents sujets en même
-- temps. Ce n'est pas le but : je ne veux pas gérer sur une seule session
-- plein de projets en même temps. S'il y a des ajouts qui doivent se faire,
-- ça doit se faire dans la session concernant le projet en question, et pas
-- dans une seule session, parce que sinon ça mélange tous les contextes. »
--
-- Ce qu'on garde de 0014 : dans UN projet, une seule session dirige (celle où
-- Raphaël a écrit en dernier), les autres n'enchaînent rien (« les sessions se
-- marchent dessus »). Ce qui change : une ligne `chefs` PAR PROJET ; la passe
-- (scripts/chef.sh) ne sert que le projet de sa session ; max_agents et le
-- réveil horaire (reveil_trigger) sont réglés par projet.
--
-- L'ancienne table `chef` (id = 1) et ses fonctions sans projet
-- (prendre_chef(text,text,text), est_chef(text), chef_existe()) ne sont plus
-- appelées par les scripts à jour ; elles restent en base (pas de drop sans
-- Raphaël) pour qu'une session encore sur l'ancienne version (checkout pas
-- encore mis à jour, cache du lanceur de 10 min) continue de marcher comme
-- avant, sans erreur. Les nouvelles signatures ont un argument de plus : aucun
-- appel ambigu. La ligne de `chef` est reprise pour le projet `cockpit` : c'est
-- la session du cockpit qui la tenait.
create table if not exists cockpit.chefs (
  projet_id        uuid primary key references cockpit.projets (id) on delete cascade,
  session_id       text,          -- identifiant Claude Code (session_id des hooks)
  session_distante text,          -- identifiant de la session cloud (session_…), cible du réveil
  branche          text,
  depuis           timestamptz,
  vu_at            timestamptz,
  max_agents       int not null default 3 check (max_agents between 1 and 8),
  reveil_trigger   text,
  actif            boolean not null default true
);
alter table cockpit.chefs enable row level security;
alter table cockpit.chefs replica identity full;
drop policy if exists admin_tout on cockpit.chefs;
create policy admin_tout on cockpit.chefs for all using (cockpit.est_admin()) with check (cockpit.est_admin());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cockpit' and tablename = 'chefs') then
    execute 'alter publication supabase_realtime add table cockpit.chefs';
  end if;
end $$;

-- Reprise des valeurs actuelles pour le projet cockpit (une seule fois).
insert into cockpit.chefs (projet_id, session_id, session_distante, branche, depuis, vu_at, max_agents, reveil_trigger, actif)
select p.id, c.session_id, c.session_distante, c.branche, c.depuis, c.vu_at, c.max_agents, c.reveil_trigger, c.actif
  from cockpit.chef c join cockpit.projets p on p.slug = 'cockpit'
 where c.id = 1
on conflict (projet_id) do nothing;
comment on table cockpit.chef is 'Obsolète depuis 0019 (un chef par projet : cockpit.chefs). Plus lue.';

-- Raphaël écrit dans une session du projet → elle devient chef de CE projet.
-- Renvoie l'état d'avant (pour dire à la nouvelle chef de déplacer le réveil).
create or replace function cockpit.prendre_chef(p_projet text, p_session text, p_branche text, p_distante text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid; avant cockpit.chefs;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  if nullif(trim(coalesce(p_session, '')), '') is null then raise exception 'donne la session'; end if;
  insert into cockpit.chefs (projet_id) values (v_projet) on conflict (projet_id) do nothing;
  select * into avant from cockpit.chefs where projet_id = v_projet for update;
  update cockpit.chefs set
    session_id = p_session,
    session_distante = coalesce(nullif(p_distante, ''), case when session_id = p_session then session_distante end),
    branche = nullif(p_branche, ''),
    depuis = case when session_id is distinct from p_session then now() else depuis end,
    vu_at = now()
  where projet_id = v_projet;
  return jsonb_build_object('projet', p_projet, 'change', avant.session_id is distinct from p_session,
                            'ancienne', avant.session_id, 'ancienne_distante', avant.session_distante,
                            'reveil_trigger', avant.reveil_trigger, 'max_agents', avant.max_agents);
end $$;

create or replace function cockpit.est_chef(p_projet text, p_session text)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.chefs c join cockpit.projets p on p.id = c.projet_id
                  where p.slug = p_projet and c.actif and c.session_id = p_session);
$$;

-- Aucune chef connue pour CE projet : le fonctionnement par session (hook
-- autonome.sh, passe.sh) reste celui du projet.
create or replace function cockpit.chef_existe(p_projet text)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.chefs c join cockpit.projets p on p.id = c.projet_id
                  where p.slug = p_projet and c.actif and c.session_id is not null);
$$;

revoke all on function cockpit.prendre_chef(text, text, text, text), cockpit.est_chef(text, text), cockpit.chef_existe(text) from public, anon, authenticated;
grant execute on function cockpit.prendre_chef(text, text, text, text), cockpit.est_chef(text, text), cockpit.chef_existe(text) to service_role;
