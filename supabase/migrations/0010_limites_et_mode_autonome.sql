-- Les limites d'usage et la nuit (29 sept. 2026).
--
-- Raphaël : « dès que mes crédits Claude sont consommés […] à la minute où ils
-- reviennent, je veux que la session reprenne tout ce qui était en cours, et si
-- elle n'a rien à reprendre, qu'elle poursuive sur les chantiers disponibles.
-- Je pars dormir à 4 h, ça se renouvelle, je me réveille à 9 h : ce sont 4 h
-- gagnées ». Trois pièces :
--   1. la REPRISE de la tâche en cours est native dans Claude Code (réglage
--      `autoContinueAtUsageLimit`, posé par brancher.sh) ;
--   2. la PAUSE se voit : le hook StopFailure (error = rate_limit…) la note
--      sur la session, et tout signe de vie suivant la lève ;
--   3. l'ENCHAÎNEMENT : quand le « mode autonome » d'un projet est allumé
--      (jusqu'à une heure donnée), le hook Stop donne à la session le chantier
--      LIBRE suivant au lieu de la laisser s'arrêter (prochain_chantier_autonome).
--      Éteint par défaut ; plafonné par session ; jamais un chantier à cadrer.

alter table cockpit.sessions add column if not exists pause_raison text;
alter table cockpit.sessions add column if not exists pause_at timestamptz;
alter table cockpit.sessions add column if not exists pause_detail text;
alter table cockpit.sessions add column if not exists relances int not null default 0;
alter table cockpit.projets add column if not exists autonome_jusqu_a timestamptz;
alter table cockpit.projets add column if not exists autonome_max int not null default 8
  check (autonome_max between 1 and 50);

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
end $$;


-- Allumer (jusqu'à une heure) ou éteindre (null) le mode autonome d'un projet.
create or replace function cockpit.regler_autonome(p_projet text, p_jusqu_a timestamptz, p_max int default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux admins');
  if p_jusqu_a is not null and p_jusqu_a <= now() then raise exception 'l''heure de fin doit être dans le futur'; end if;
  if p_jusqu_a is not null and p_jusqu_a > now() + interval '24 hours' then raise exception 'pas plus de 24 h d''affilée'; end if;
  update cockpit.projets set autonome_jusqu_a = p_jusqu_a, autonome_max = coalesce(p_max, autonome_max)
   where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  -- Une nouvelle nuit remet les compteurs des sessions du projet à zéro.
  if p_jusqu_a is not null then update cockpit.sessions set relances = 0 where projet_id = r.id; end if;
  return jsonb_build_object('projet', r.slug, 'jusqu_a', r.autonome_jusqu_a, 'max', r.autonome_max);
end $$;

-- Appelé par le hook Stop : le chantier LIBRE suivant, réservé pour cette
-- session, ou null (mode éteint, heure passée, plafond atteint, rien de libre).
create or replace function cockpit.prochain_chantier_autonome(p_projet text, p_session text, p_branche text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; s cockpit.sessions; c cockpit.chantiers; par text := coalesce(nullif(p_branche, ''), 'session-autonome');
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null or pr.autonome_jusqu_a is null or pr.autonome_jusqu_a <= now() then return null; end if;
  select * into s from cockpit.sessions where id = p_session;
  if s.id is not null and s.relances >= pr.autonome_max then return null; end if;
  select * into c from cockpit.chantiers
   where projet_id = pr.id and archived_at is null and doublon_de is null and etat = 'libre'
     and (pris_par is null or pris_jusqu_a < now() or pris_par = par)
   order by (priorite = 'haute') desc, created_at
   limit 1 for update skip locked;
  if c.id is null then return null; end if;
  if not cockpit.reserver_chantier(c.id, par, 180) then return null; end if;
  update cockpit.sessions set relances = relances + 1 where id = p_session;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (pr.id, c.id, par, 'session', 'info', 'Pris en mode autonome (Raphaël absent jusqu''à '
          || to_char(pr.autonome_jusqu_a at time zone 'Asia/Jerusalem', 'HH24:MI') || ').');
  return jsonb_build_object('id', c.id, 'titre', c.titre, 'demande', left(coalesce(c.demande, ''), 1500),
    'jusqu_a', to_char(pr.autonome_jusqu_a at time zone 'Asia/Jerusalem', 'HH24:MI'),
    'reste', pr.autonome_max - coalesce(s.relances, 0) - 1);
end $$;

revoke execute on function cockpit.suivre(text, jsonb), cockpit.regler_autonome(text, timestamptz, int),
  cockpit.prochain_chantier_autonome(text, text, text) from public, anon, authenticated;
grant execute on function cockpit.suivre(text, jsonb), cockpit.prochain_chantier_autonome(text, text, text),
  cockpit.regler_autonome(text, timestamptz, int) to service_role;
grant execute on function cockpit.regler_autonome(text, timestamptz, int) to authenticated;
