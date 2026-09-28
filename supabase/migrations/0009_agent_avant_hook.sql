-- Un agent peut signaler sa progression AVANT que le hook de suivi ait vu sa
-- tâche (le hook Stop ne passe qu'à la fin d'une réponse de la session, qui
-- peut durer une heure). Il s'enregistre alors sous un identifiant provisoire
-- « prov:<description> », dans SA session (variable CLAUDE_CODE_SESSION_ID,
-- la même que le session_id des hooks) ; quand Claude Code annonce la vraie
-- tâche de même description, la ligne provisoire est ADOPTÉE, jamais dédoublée.

create or replace function cockpit.adopter_provisoire(p_sid text, p_tache_id text, p_description text)
returns void language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.taches set tache_id = p_tache_id
   where session_id = p_sid and tache_id = 'prov:' || p_description and p_description is not null
     and not exists (select 1 from cockpit.taches x where x.session_id = p_sid and x.tache_id = p_tache_id);
$$;

create or replace function cockpit.suivre(p_projet text, p jsonb)
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare
  v_projet uuid; v_sid text := p->>'session_id'; v_ev text := p->>'hook_event_name';
  t jsonb; v_ids text[] := '{}'; v_type text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null or v_sid is null or v_ev is null then return 'ignoré'; end if;

  insert into cockpit.sessions (id, projet_id, branche, sujet)
  values (v_sid, v_projet, nullif(p->>'branche', ''),
          case when v_ev = 'UserPromptSubmit' then left(regexp_replace(coalesce(p->>'prompt', ''), '\s+', ' ', 'g'), 120) end)
  on conflict (id) do update
    set vu_at = now(), fin_at = null,
        branche = coalesce(excluded.branche, cockpit.sessions.branche),
        sujet = coalesce(cockpit.sessions.sujet, excluded.sujet);

  if v_ev = 'UserPromptSubmit' then
    update cockpit.sessions set tour_en_cours = true where id = v_sid;

  elsif v_ev = 'Stop' then
    update cockpit.sessions set tour_en_cours = false where id = v_sid;
    for t in select * from jsonb_array_elements(coalesce(p->'background_tasks', '[]'::jsonb)) loop
      continue when t->>'id' is null;
      v_type := case t->>'type' when 'local_agent' then 'agent' when 'local_bash' then 'commande'
                  when 'agent' then 'agent' when 'bash' then 'commande' else 'autre' end;
      v_ids := v_ids || (t->>'id');
      perform cockpit.adopter_provisoire(v_sid, t->>'id', t->>'description');
      insert into cockpit.taches (session_id, projet_id, tache_id, type, description, sorte, statut)
      values (v_sid, v_projet, t->>'id', v_type, t->>'description',
              coalesce(t->>'agent_type', t->>'command', t->>'name'), cockpit.statut_tache(t->>'status'))
      on conflict (session_id, tache_id) do update
        set vu_at = now(), statut = excluded.statut,
            description = coalesce(excluded.description, cockpit.taches.description),
            sorte = coalesce(excluded.sorte, cockpit.taches.sorte),
            type = case when cockpit.taches.type = 'autre' then excluded.type else cockpit.taches.type end,
            fini_at = case when excluded.statut <> 'en_cours' then coalesce(cockpit.taches.fini_at, now()) end;
    end loop;
    -- Ce qui n'y est plus est fini — sauf une ligne provisoire qu'un agent
    -- vient de signaler (il vit, Claude Code ne l'a juste pas encore nommé).
    update cockpit.taches set statut = 'termine', fini_at = now()
     where session_id = v_sid and statut = 'en_cours' and not (tache_id = any (v_ids))
       and not (tache_id like 'prov:%' and progres_at > now() - interval '15 minutes');

  elsif v_ev = 'SubagentStart' and p->>'agent_id' is not null then
    insert into cockpit.taches (session_id, projet_id, tache_id, type, sorte)
    values (v_sid, v_projet, p->>'agent_id', 'agent', nullif(p->>'agent_type', ''))
    on conflict (session_id, tache_id) do update set vu_at = now(), statut = 'en_cours', fini_at = null;

  elsif v_ev = 'SubagentStop' and p->>'agent_id' is not null then
    update cockpit.taches set statut = 'termine', fini_at = now(), vu_at = now()
     where session_id = v_sid and tache_id = p->>'agent_id' and statut = 'en_cours';

  elsif v_ev = 'PostToolUse' and p->>'tache_id' is not null then
    perform cockpit.adopter_provisoire(v_sid, p->>'tache_id', p->>'tache_description');
    insert into cockpit.taches (session_id, projet_id, tache_id, type, description, sorte)
    values (v_sid, v_projet, p->>'tache_id', coalesce(p->>'tache_type', 'autre'),
            nullif(p->>'tache_description', ''), nullif(p->>'tache_sorte', ''))
    on conflict (session_id, tache_id) do update
      set vu_at = now(), description = coalesce(excluded.description, cockpit.taches.description),
          sorte = coalesce(cockpit.taches.sorte, excluded.sorte),
          type = case when cockpit.taches.type = 'autre' then excluded.type else cockpit.taches.type end;

  elsif v_ev = 'SessionEnd' then
    update cockpit.sessions set fin_at = now(), tour_en_cours = false where id = v_sid;
    update cockpit.taches set statut = 'arrete', fini_at = now()
     where session_id = v_sid and statut = 'en_cours';
  end if;
  return v_ev;
end $$;

drop function if exists cockpit.progression_tache(text, text, text, int, int, uuid, text);
create or replace function cockpit.progression_tache(
  p_projet text, p_agent text, p_etape text, p_pct int, p_eta int, p_chantier uuid default null,
  p_statut text default 'en_cours', p_session text default null)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_id uuid; v_projet uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null or nullif(trim(p_agent), '') is null then return null; end if;
  select t.id into v_id from cockpit.taches t
   where t.projet_id = v_projet
     and (p_session is null or t.session_id = p_session)
     and (t.description = p_agent or t.tache_id = p_agent or t.tache_id = 'prov:' || p_agent)
   order by (t.statut = 'en_cours') desc, t.vu_at desc
   limit 1;
  if v_id is null and p_session is not null then
    -- Pas encore vue par le hook : ligne provisoire dans sa session.
    insert into cockpit.sessions (id, projet_id) values (p_session, v_projet)
      on conflict (id) do update set vu_at = now(), fin_at = null;
    insert into cockpit.taches (session_id, projet_id, tache_id, type, description)
    values (p_session, v_projet, 'prov:' || p_agent, 'agent', p_agent)
    on conflict (session_id, tache_id) do nothing
    returning id into v_id;
  end if;
  if v_id is null then return null; end if;
  update cockpit.taches
     set etape = p_etape, pourcentage = coalesce(p_pct, pourcentage), eta_secondes = p_eta,
         chantier_id = coalesce(p_chantier, chantier_id), progres_at = now(), vu_at = now(),
         statut = case when p_statut in ('termine','echec') then p_statut else 'en_cours' end,
         fini_at = case when p_statut in ('termine','echec') then now() end
   where id = v_id;
  return v_id;
end $$;

revoke execute on function cockpit.adopter_provisoire(text, text, text), cockpit.suivre(text, jsonb),
  cockpit.progression_tache(text, text, text, int, int, uuid, text, text) from public, anon, authenticated;
grant execute on function cockpit.adopter_provisoire(text, text, text), cockpit.suivre(text, jsonb),
  cockpit.progression_tache(text, text, text, int, int, uuid, text, text) to service_role;
