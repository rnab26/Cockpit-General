-- 0108 : une session déclarée par connecter.sh / presence.sh est rattachée au projet DEMANDÉ (20 oct. 2026).
-- Cause prouvée : la session FacePro du 16 oct. était enregistrée dans le projet « cockpit » ; suivre() ne changeait jamais projet_id
-- (on conflict ... do update sans projet_id), donc connecter.sh --projet facepro la laissait dans « cockpit » : invisible dans FacePro.
-- Seul le drapeau explicite "rattacher":"1" déplace la session ; les hooks ordinaires ne changent rien. Idempotent.

CREATE OR REPLACE FUNCTION cockpit.suivre(p_projet text, p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
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
        -- Rattachement voulu (connecter.sh / presence.sh) : la session est celle de CE projet, même si un autre l'avait déclarée avant.
        projet_id = case when p->>'rattacher' = '1' then excluded.projet_id else cockpit.sessions.projet_id end,
        -- Tout signe de vie autre qu'un échec lève la pause « limite ».
        pause_raison = case when v_ev = 'StopFailure' then cockpit.sessions.pause_raison else null end,
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

  elsif v_ev = 'Vie' and p->>'agent_id' is not null then
    -- Un AGENT qui travaille (retour d'outil, battement) rafraîchit SA ligne : sinon le chantier qu'il
    -- tient n'était protégé que par ses étapes signalées (20 min) et libéré en plein travail.
    update cockpit.taches set vu_at = now()
     where session_id = v_sid and tache_id = p->>'agent_id' and statut = 'en_cours';

  elsif v_ev = 'StopFailure' then
    update cockpit.sessions
       set tour_en_cours = false, pause_at = now(),
           pause_raison = coalesce(nullif(p->>'error', ''), 'unknown'),
           pause_detail = left(coalesce(p->>'error_details', ''), 400)
     where id = v_sid;

  elsif v_ev = 'SessionEnd' then
    update cockpit.sessions set fin_at = now(), tour_en_cours = false where id = v_sid;
    update cockpit.taches set statut = 'arrete', fini_at = now()
     where session_id = v_sid and statut = 'en_cours';
  end if;
  return v_ev;
end $function$;

revoke all on function cockpit.suivre(text, jsonb) from public;
grant execute on function cockpit.suivre(text, jsonb) to service_role;
