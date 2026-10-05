-- 0061 (5 oct. 2026, chantier 4f715afd). Raphaël : « 22 tâches en cours » dans Claude Code,
-- et la base montrait des lignes d'agents (Répondre / Point / Résoudre le conflit) finis
-- depuis des heures, jusqu'à 5 jours (7 809 min sans signe), encore « en cours ».
-- CAUSE PROUVÉE (mesure du 5 oct. : 14 lignes `prov:` en_cours, sessions vues il y a 7 628 min,
-- fin_at null) : une ligne ne se ferme que par un événement DE SA SESSION (Stop / SubagentStop /
-- SessionEnd, ou le balayage des `prov:` déclenché par un signe de vie de cette session, 0030).
-- Une session qui s'arrête sans SessionEnd (conteneur recyclé) n'émet plus rien : ses lignes
-- ne sont jamais balayées. SubagentStop ne ferme que la ligne portant l'id de l'agent, jamais
-- sa ligne provisoire (descriptions différentes) ; et la règle des 45 min ne vaut que pour
-- les `prov:` et seulement quand la session parle.
-- Correctif à la source, UNE règle, lue par le balayage ET par agents_actifs :
--   tache_morte(t) : ligne « en_cours » sans signe depuis plus de projets.delai_tache_agent_h
--   (3 h par défaut, 0 = jamais, réglable) ET dont la session n'est plus vivante (absente, finie,
--   ou vue il y a plus de delai_signe du projet). Statut seul : aucune ligne supprimée.
-- + à la fin d'un agent (SubagentStop → sa vraie ligne passe terminée), sa ligne provisoire de
--   même description, dans la même session, est fermée avec elle (trigger).
-- + job pg_cron « cockpit-taches-mortes » toutes les 3 min, jamais un projet test-… (sauf banc).
-- Idempotente.

alter table cockpit.projets add column if not exists delai_tache_agent_h numeric not null default 3
  check (delai_tache_agent_h >= 0 and delai_tache_agent_h <= 72);

create or replace function cockpit.tache_morte(t cockpit.taches)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select t.statut = 'en_cours'
     and coalesce((select p.delai_tache_agent_h from cockpit.projets p where p.id = t.projet_id), 3) > 0
     and greatest(t.vu_at, coalesce(t.progres_at, t.vu_at), t.demarre_at)
         < now() - case when t.tache_id like 'prov:%' then cockpit.delai_tache_prov()  -- une provisoire ne vit que par ses étapes (0030)
                        else make_interval(secs => 3600 * coalesce((select p.delai_tache_agent_h from cockpit.projets p where p.id = t.projet_id), 3)) end
     and not exists (select 1 from cockpit.sessions s
                      where s.id = t.session_id and s.fin_at is null
                        and s.vu_at > now() - cockpit.delai_signe(t.projet_id));
$$;

create or replace function cockpit.clore_taches_mortes(p_slug text default null, p_test boolean default false)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare n integer;
begin
  update cockpit.taches t set statut = 'arrete', fini_at = coalesce(t.fini_at, now())
   where t.statut = 'en_cours'
     and (p_slug is null or t.projet_id = (select id from cockpit.projets where slug = p_slug))
     and (coalesce(p_test, false) or not exists (select 1 from cockpit.projets p where p.id = t.projet_id and cockpit.projet_de_test(p.slug)))
     and cockpit.tache_morte(t);
  get diagnostics n = row_count;
  return n;
exception when others then
  return 0;
end $$;

-- agents_actifs (0048) : même corps, plus le balayage de la règle unique en tête.
create or replace function cockpit.agents_actifs(p_session text, p_projet uuid)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_reels int; v_muets int; v_prov int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_session is null then return 0; end if;
  perform cockpit.clore_taches_prov_perimees(p_session);
  perform cockpit.clore_taches_mortes((select slug from cockpit.projets where id = p_projet), true);
  select count(*) filter (where t.tache_id not like 'prov:%'),
         count(*) filter (where t.tache_id not like 'prov:%' and t.progres_at is null and t.chantier_id is null),
         count(*) filter (where t.tache_id like 'prov:%')
    into v_reels, v_muets, v_prov
    from cockpit.taches t
   where t.session_id = p_session and t.projet_id = p_projet and t.type = 'agent'
     and t.statut = 'en_cours' and t.vu_at > now() - interval '3 hours';
  return v_reels + greatest(0, v_prov - v_muets);
end $$;

-- Fin d'un agent : sa ligne provisoire de même description (même session) se ferme avec lui.
create or replace function cockpit.fermer_prov_de_agent_fini()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if new.statut <> 'en_cours' and old.statut = 'en_cours' and new.tache_id not like 'prov:%'
     and new.type = 'agent' and nullif(new.description, '') is not null then
    update cockpit.taches set statut = new.statut, fini_at = coalesce(fini_at, now())
     where session_id = new.session_id and tache_id like 'prov:%' and statut = 'en_cours'
       and description = new.description;
  end if;
  return new;
end $$;
drop trigger if exists taches_fermer_prov on cockpit.taches;
create trigger taches_fermer_prov after update of statut on cockpit.taches
  for each row execute function cockpit.fermer_prov_de_agent_fini();

-- Réglage par projet (admin ou service) : heures ; 0 = ne jamais fermer seul.
create or replace function cockpit.regler_delai_tache_agent(p_projet text, p_heures numeric)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_heures is null or p_heures < 0 or p_heures > 72 then raise exception 'délai entre 0 et 72 heures'; end if;
  update cockpit.projets set delai_tache_agent_h = p_heures where slug = p_projet;
  if not found then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'heures', p_heures);
end $$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron non installable ici (%) : les lignes mortes ne seront pas fermées seules', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cockpit-taches-mortes') then
      perform cron.unschedule('cockpit-taches-mortes');
    end if;
    perform cron.schedule('cockpit-taches-mortes', '*/3 * * * *', 'select cockpit.clore_taches_mortes()');
  end if;
end $$;

-- Nettoyage immédiat des lignes déjà mortes (statut seulement).
select cockpit.clore_taches_mortes();

revoke all on function cockpit.tache_morte(cockpit.taches), cockpit.clore_taches_mortes(text, boolean),
  cockpit.fermer_prov_de_agent_fini(), cockpit.agents_actifs(text, uuid), cockpit.regler_delai_tache_agent(text, numeric)
  from public, anon, authenticated;
grant execute on function cockpit.tache_morte(cockpit.taches), cockpit.clore_taches_mortes(text, boolean), cockpit.agents_actifs(text, uuid) to service_role;
grant execute on function cockpit.regler_delai_tache_agent(text, numeric) to authenticated, service_role;
