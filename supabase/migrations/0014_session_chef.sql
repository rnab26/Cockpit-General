-- UNE session chef pour tous les projets (29 sept. 2026)
--
-- Raphaël : « les sessions se marchent dessus : un coup l'une prend un
-- chantier, un coup l'autre session que j'ai ouverte répond "attends, j'arrête"
-- […] plutôt que d'ouvrir plein de sessions autonomes, une seule session
-- maître qui ouvre des agents ; je réponds dans le cockpit ; les agents
-- travaillent en permanence ; et si j'ouvre une nouvelle session et laisse
-- celle-là de côté, elle doit faire le même travail. »
--
--  - une seule ligne `chef` : la session qui dirige (celle où Raphaël a écrit
--    en dernier). Elle seule lance des agents sur les chantiers ; les autres
--    sessions ne prennent plus rien d'elles-mêmes (hook autonome.sh, passe.sh) ;
--  - max_agents : combien d'agents en parallèle (réglable, 3 par défaut) ;
--  - reveil_trigger : l'identifiant du réveil horaire (Routine Claude) qui
--    relance la session chef si son conteneur s'est arrêté ; une nouvelle
--    session chef le déplace sur elle.
create table if not exists cockpit.chef (
  id              int primary key default 1 check (id = 1),
  session_id      text,          -- identifiant Claude Code (session_id des hooks)
  session_distante text,         -- identifiant de la session cloud (session_…), cible du réveil
  branche         text,
  depuis          timestamptz,
  vu_at           timestamptz,
  max_agents      int not null default 3 check (max_agents between 1 and 8),
  reveil_trigger  text,
  actif           boolean not null default true
);
insert into cockpit.chef (id) values (1) on conflict (id) do nothing;
alter table cockpit.chef enable row level security;
alter table cockpit.chef replica identity full;
drop policy if exists admin_tout on cockpit.chef;
create policy admin_tout on cockpit.chef for all using (cockpit.est_admin()) with check (cockpit.est_admin());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cockpit' and tablename = 'chef') then
    execute 'alter publication supabase_realtime add table cockpit.chef';
  end if;
end $$;

-- Raphaël écrit dans une session → elle devient chef. Renvoie l'état d'avant
-- (pour dire à la nouvelle chef de déplacer le réveil sur elle).
create or replace function cockpit.prendre_chef(p_session text, p_branche text, p_distante text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare avant cockpit.chef;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into avant from cockpit.chef where id = 1 for update;
  update cockpit.chef set
    session_id = p_session,
    session_distante = coalesce(nullif(p_distante, ''), case when session_id = p_session then session_distante end),
    branche = nullif(p_branche, ''),
    depuis = case when session_id is distinct from p_session then now() else depuis end,
    vu_at = now()
  where id = 1;
  return jsonb_build_object('change', avant.session_id is distinct from p_session,
                            'ancienne', avant.session_id, 'ancienne_distante', avant.session_distante,
                            'reveil_trigger', avant.reveil_trigger, 'max_agents', avant.max_agents);
end $$;

create or replace function cockpit.est_chef(p_session text)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.chef where id = 1 and actif and session_id = p_session);
$$;

-- Aucune session chef connue (jamais posée) : l'ancien fonctionnement par projet reste possible.
create or replace function cockpit.chef_existe()
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.chef where id = 1 and actif and session_id is not null);
$$;

revoke all on function cockpit.prendre_chef(text, text, text), cockpit.est_chef(text), cockpit.chef_existe() from public, anon, authenticated;
grant execute on function cockpit.prendre_chef(text, text, text), cockpit.est_chef(text), cockpit.chef_existe() to service_role;
