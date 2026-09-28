-- Qui travaille, vraiment : les SESSIONS Claude Code et leurs TÂCHES en
-- arrière-plan (agents, commandes), suivies toutes seules par des hooks.
-- Et : Claude décide des doublons et des sections, Raphaël n'a qu'à accepter
-- une fusion qu'on lui SUGGÈRE (29 sept. 2026).
--
-- Raphaël : « s'il y a des agents qui bossent sur des projets, il faut que je
-- voie combien d'agents, sur quel projet […] la notion d'agent et la notion de
-- session qui travaille, c'est pas pareil, il faut que ce soit clair » ; et, sa
-- capture du panneau « Tâches en arrière-plan » de FacePro (5 tâches, durée
-- écoulée seulement) : « c'est illisible, pas possible de voir leur
-- progression, ni combien de temps il reste ».
--
-- Vocabulaire, à ne pas mélanger :
--   SESSION = une conversation Claude Code (ce que Raphaël ouvre), identifiée
--             par le session_id que Claude Code donne aux hooks ;
--   TÂCHE   = un travail qu'une session lance en arrière-plan : un AGENT
--             (un autre Claude qui travaille pour elle) ou une COMMANDE longue.
-- La liste des tâches vient de Claude Code lui-même (entrée `background_tasks`
-- du hook Stop, vérifiée dans le code de la version 2.1.284), pas de la bonne
-- volonté de la session. L'étape, le pourcentage et le temps restant, eux, ne
-- se devinent pas : c'est l'agent qui les signale (progression.sh --agent).
--
-- Et : « personne mieux que Claude sait si c'est un chantier doublon […] ce
-- n'est pas à moi de trier, catégoriser à chaque fois ; il peut me suggérer de
-- fusionner, ça j'accepte ». D'où un message de kind « fusion » que Raphaël
-- accepte ou refuse d'un toucher (trancher_fusion), et ranger_chantier qui
-- crée la section si elle n'existe pas.

create table if not exists cockpit.sessions (
  id            text primary key,              -- session_id de Claude Code
  projet_id     uuid not null references cockpit.projets (id) on delete cascade,
  branche       text,
  sujet         text,                          -- début du premier message, pour la reconnaître
  tour_en_cours boolean not null default false, -- entre un message et la fin de la réponse
  demarre_at    timestamptz not null default now(),
  vu_at         timestamptz not null default now(),
  fin_at        timestamptz
);
create index if not exists sessions_projet_idx on cockpit.sessions (projet_id, vu_at desc);

create table if not exists cockpit.taches (
  id            uuid primary key default gen_random_uuid(),
  session_id    text not null references cockpit.sessions (id) on delete cascade,
  projet_id     uuid not null references cockpit.projets (id) on delete cascade,
  tache_id      text not null,                 -- identifiant donné par Claude Code
  type          text not null default 'autre' check (type in ('agent','commande','autre')),
  description   text,
  sorte         text,                          -- type d'agent, ou la commande
  statut        text not null default 'en_cours' check (statut in ('en_cours','termine','echec','arrete')),
  chantier_id   uuid references cockpit.chantiers (id) on delete set null,
  etape         text,
  pourcentage   int check (pourcentage between 0 and 100),
  eta_secondes  int,                           -- null = inconnu, jamais 0
  progres_at    timestamptz,                   -- dernier signalement de l'agent lui-même
  demarre_at    timestamptz not null default now(),
  vu_at         timestamptz not null default now(),
  fini_at       timestamptz,
  unique (session_id, tache_id)
);
create index if not exists taches_projet_idx on cockpit.taches (projet_id, statut, vu_at desc);

alter table cockpit.sessions enable row level security;
alter table cockpit.taches enable row level security;
drop policy if exists admin_tout on cockpit.sessions;
create policy admin_tout on cockpit.sessions for all to authenticated using (cockpit.est_admin()) with check (cockpit.est_admin());
drop policy if exists admin_tout on cockpit.taches;
create policy admin_tout on cockpit.taches for all to authenticated using (cockpit.est_admin()) with check (cockpit.est_admin());
alter table cockpit.sessions replica identity full;
alter table cockpit.taches replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table cockpit.sessions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table cockpit.taches; exception when duplicate_object then null; end;
end $$;
grant select, insert, update, delete on cockpit.sessions, cockpit.taches to authenticated, service_role;

-- Une suggestion de fusion est un message à part : l'app la montre avec deux
-- boutons, et la suggestion porte ses deux chantiers dans `options`.
alter table cockpit.messages drop constraint if exists messages_kind_check;
alter table cockpit.messages add constraint messages_kind_check
  check (kind in ('info','question','reponse','blocage','action','constat','fusion'));

create or replace function cockpit.statut_tache(p text)
returns text language sql immutable as $$
  select case lower(coalesce(p, ''))
    when 'completed' then 'termine' when 'failed' then 'echec'
    when 'killed' then 'arrete' when 'stopped' then 'arrete' when 'cancelled' then 'arrete'
    else 'en_cours' end;
$$;

-- LE point d'entrée des hooks. `p` est l'entrée du hook de Claude Code
-- (session_id, hook_event_name, …) + `branche` ajoutée par hooks/suivi.sh.
-- Ne lève jamais pour une entrée incomplète : un hook ne doit rien casser.
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
    -- La liste des tâches en vol, telle que Claude Code la connaît.
    for t in select * from jsonb_array_elements(coalesce(p->'background_tasks', '[]'::jsonb)) loop
      continue when t->>'id' is null;
      v_type := case t->>'type' when 'local_agent' then 'agent' when 'local_bash' then 'commande'
                  when 'agent' then 'agent' when 'bash' then 'commande' else 'autre' end;
      v_ids := v_ids || (t->>'id');
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
    -- Ce qui n'y est plus est fini.
    update cockpit.taches set statut = 'termine', fini_at = now()
     where session_id = v_sid and statut = 'en_cours' and not (tache_id = any (v_ids));

  elsif v_ev = 'SubagentStart' and p->>'agent_id' is not null then
    insert into cockpit.taches (session_id, projet_id, tache_id, type, sorte)
    values (v_sid, v_projet, p->>'agent_id', 'agent', nullif(p->>'agent_type', ''))
    on conflict (session_id, tache_id) do update set vu_at = now(), statut = 'en_cours', fini_at = null;

  elsif v_ev = 'SubagentStop' and p->>'agent_id' is not null then
    update cockpit.taches set statut = 'termine', fini_at = now(), vu_at = now()
     where session_id = v_sid and tache_id = p->>'agent_id' and statut = 'en_cours';

  elsif v_ev = 'PostToolUse' and p->>'tache_id' is not null then
    -- Lancement d'un agent ou d'une commande en arrière-plan : on a sa description tout de suite.
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

-- Un agent signale lui-même où il en est (progression.sh --agent "<sa description>").
-- On retrouve sa tâche par sa description dans le projet (la plus récente en cours).
create or replace function cockpit.progression_tache(
  p_projet text, p_agent text, p_etape text, p_pct int, p_eta int, p_chantier uuid default null, p_statut text default 'en_cours')
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_id uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select t.id into v_id from cockpit.taches t join cockpit.projets pr on pr.id = t.projet_id
   where pr.slug = p_projet and (t.description = p_agent or t.tache_id = p_agent or t.description ilike '%' || p_agent || '%')
   order by (t.statut = 'en_cours') desc, (t.description = p_agent or t.tache_id = p_agent) desc, t.vu_at desc
   limit 1;
  if v_id is null then return null; end if;
  update cockpit.taches
     set etape = p_etape, pourcentage = coalesce(p_pct, pourcentage), eta_secondes = p_eta,
         chantier_id = coalesce(p_chantier, chantier_id), progres_at = now(), vu_at = now(),
         statut = case when p_statut in ('termine','echec') then p_statut else statut end,
         fini_at = case when p_statut in ('termine','echec') then now() else fini_at end
   where id = v_id;
  return v_id;
end $$;

-- Claude range lui-même : la section est créée si elle n'existe pas.
create or replace function cockpit.ranger_chantier(p_chantier uuid, p_section text, p_par text default 'session')
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_section uuid;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux admins');
  select projet_id into v_projet from cockpit.chantiers where id = p_chantier;
  if v_projet is null then raise exception 'chantier introuvable'; end if;
  if nullif(trim(p_section), '') is null then raise exception 'section vide'; end if;
  insert into cockpit.sections (projet_id, nom, position)
  values (v_projet, trim(p_section), coalesce((select max(position) + 1 from cockpit.sections where projet_id = v_projet), 0))
  on conflict (projet_id, cle) do nothing;
  select id into v_section from cockpit.sections where projet_id = v_projet and cle = cockpit.cle_section(p_section);
  perform set_config('cockpit.par', coalesce(p_par, 'session'), true);
  update cockpit.chantiers set section_id = v_section where id = p_chantier;
  return v_section;
end $$;

-- Claude SUGGÈRE une fusion ; Raphaël accepte ou refuse d'un toucher.
create or replace function cockpit.suggerer_fusion(p_source uuid, p_cible uuid, p_pourquoi text, p_session text)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid; ts text; tc text; v_id uuid := gen_random_uuid();
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_source = p_cible then raise exception 'même chantier'; end if;
  select projet_id, titre into v_projet, ts from cockpit.chantiers where id = p_source;
  select titre into tc from cockpit.chantiers where id = p_cible and projet_id = v_projet;
  if v_projet is null or tc is null then raise exception 'les deux chantiers doivent exister dans le même projet'; end if;
  -- Pas deux fois la même suggestion en attente.
  if exists (select 1 from cockpit.messages where kind = 'fusion' and answered_at is null
             and options->0->>'source' = p_source::text and options->0->>'cible' = p_cible::text) then
    return null;
  end if;
  insert into cockpit.messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options)
  values (v_id, v_projet, p_cible, coalesce(p_session, 'session'), 'session', 'fusion',
          '« ' || ts || ' » et « ' || tc || ' » semblent être le même sujet. Les fusionner ?',
          p_pourquoi,
          jsonb_build_array(jsonb_build_object('libelle', 'Fusionner', 'recommande', true, 'source', p_source, 'cible', p_cible,
                                               'aide', 'Tout « ' || ts || ' » passe dans « ' || tc || ' » ; rien ne se perd.'),
                            jsonb_build_object('libelle', 'Garder séparés', 'aide', 'Ce sont deux sujets différents.')));
  return v_id;
end $$;

create or replace function cockpit.trancher_fusion(p_message uuid, p_fusionner boolean, p_par text default 'Raphaël')
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare m cockpit.messages;
begin
  select * into m from cockpit.messages where id = p_message and kind = 'fusion';
  if m.id is null then raise exception 'suggestion introuvable'; end if;
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux admins');
  if m.answered_at is not null then return; end if;
  if p_fusionner then
    perform cockpit.fusionner_chantiers((m.options->0->>'source')::uuid, (m.options->0->>'cible')::uuid, p_par, null);
  end if;
  update cockpit.messages
     set reponse = case when p_fusionner then 'Fusionner' else 'Garder séparés' end,
         answered_at = now(), answered_by = auth.uid()
   where id = p_message;
end $$;

-- La recherche de proches renvoie aussi un extrait de la demande : c'est avec
-- lui que Claude tranche un « ambigu » tout seul.
create or replace function cockpit.chantiers_proches_detail(p_projet text, p_texte text, p_limite int default 5)
returns table (id uuid, titre text, etat text, archive boolean, score real, extrait text)
language sql stable security definer set search_path = cockpit, extensions, pg_temp as $$
  select x.id, x.titre, x.etat, x.archive, x.score,
         left(regexp_replace(coalesce(c.demande, ''), '\s+', ' ', 'g'), 220)
  from cockpit.chantiers_proches(p_projet, p_texte, p_limite) x join cockpit.chantiers c on c.id = x.id;
$$;

revoke execute on function cockpit.statut_tache(text), cockpit.suivre(text, jsonb),
  cockpit.progression_tache(text, text, text, int, int, uuid, text), cockpit.ranger_chantier(uuid, text, text),
  cockpit.suggerer_fusion(uuid, uuid, text, text), cockpit.trancher_fusion(uuid, boolean, text),
  cockpit.chantiers_proches_detail(text, text, int)
  from public, anon, authenticated;
grant execute on function cockpit.statut_tache(text), cockpit.suivre(text, jsonb),
  cockpit.progression_tache(text, text, text, int, int, uuid, text), cockpit.ranger_chantier(uuid, text, text),
  cockpit.suggerer_fusion(uuid, uuid, text, text), cockpit.trancher_fusion(uuid, boolean, text),
  cockpit.chantiers_proches_detail(text, text, int)
  to service_role;
-- Depuis l'app (admin) : accepter/refuser une fusion, ranger un chantier.
grant execute on function cockpit.trancher_fusion(uuid, boolean, text), cockpit.ranger_chantier(uuid, text, text) to authenticated;
