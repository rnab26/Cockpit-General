-- Agents fantômes : une ligne provisoire finit toujours (30 sept. 2026)
--
-- Constat (session chef b027b00d) : chef.sh disait « 5 agent(s) travaillent
-- déjà (maximum 5) » alors qu'aucun agent ne tournait. En base, 5 lignes
-- « prov:<description> » (créées par progression.sh --agent), statut en_cours,
-- vu_at rafraîchi par le trigger 0015 (taches.vu_at suit sessions.vu_at).
-- Cause du jour : .claude/settings.json était du JSON invalide (deux objets
-- collés, commit f2b6c98) ; Claude Code l'ignorait, AUCUN hook du projet ne
-- tournait (ni Stop, ni SubagentStop, ni PostToolUse) : rien ne nommait ni ne
-- fermait ces lignes. Même hooks en marche, une ligne provisoire dont la
-- description diffère de celle de l'outil Agent n'est jamais adoptée.
--
-- Règle générale, une seule source de vérité :
--  - une ligne PROVISOIRE ne vit que par ses propres signaux (progression.sh) :
--    le trigger 0015 ne la maintient plus en vie ;
--  - sans étape depuis delai_tache_prov() (45 min), elle passe « arrêtée »
--    (clore_taches_prov_perimees) : au passage de la chef, et à chaque signe
--    de vie de la session ;
--  - progression.sh --chantier X --termine/--echec ferme les lignes provisoires
--    de SA session sur X (clore_taches_prov_chantier) ;
--  - chef.sh compte ses agents par agents_actifs(session, projet), jamais
--    par une requête recopiée.

create or replace function cockpit.delai_tache_prov()
returns interval language sql immutable as $$ select interval '45 minutes' $$;

create or replace function cockpit.clore_taches_prov_perimees(p_session text default null)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare n int;
begin
  update cockpit.taches set statut = 'arrete', fini_at = now()
   where statut = 'en_cours' and tache_id like 'prov:%'
     and (p_session is null or session_id = p_session)
     and coalesce(progres_at, demarre_at) < now() - cockpit.delai_tache_prov();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function cockpit.clore_taches_prov_chantier(p_session text, p_chantier uuid)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare n int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  update cockpit.taches set statut = 'termine', fini_at = now(), vu_at = now()
   where session_id = p_session and chantier_id = p_chantier
     and statut = 'en_cours' and tache_id like 'prov:%';
  get diagnostics n = row_count;
  return n;
end $$;

-- Les agents d'une session qui comptent (chef.sh : places libres).
create or replace function cockpit.agents_actifs(p_session text, p_projet uuid)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_session is null then return 0; end if;
  perform cockpit.clore_taches_prov_perimees(p_session);
  return (select count(*) from cockpit.taches t
           where t.session_id = p_session and t.projet_id = p_projet and t.type = 'agent'
             and t.statut = 'en_cours' and t.vu_at > now() - interval '3 hours')::int;
end $$;

-- 0015 revu : la session vit → ses VRAIES tâches vivent ; une ligne
-- provisoire, non (elle ne vit que par ses étapes), et une périmée est close.
create or replace function cockpit.taches_vivent_avec_session()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if new.vu_at is distinct from old.vu_at and new.fin_at is null then
    update cockpit.taches set vu_at = new.vu_at
     where session_id = new.id and statut = 'en_cours' and tache_id not like 'prov:%'
       and vu_at < new.vu_at - interval '30 seconds';
    perform cockpit.clore_taches_prov_perimees(new.id);
  end if;
  return new;
end $$;

revoke all on function cockpit.taches_vivent_avec_session() from public, anon, authenticated;
revoke execute on function cockpit.clore_taches_prov_perimees(text), cockpit.clore_taches_prov_chantier(text, uuid),
  cockpit.agents_actifs(text, uuid), cockpit.delai_tache_prov() from public, anon, authenticated;
grant execute on function cockpit.clore_taches_prov_perimees(text), cockpit.clore_taches_prov_chantier(text, uuid),
  cockpit.agents_actifs(text, uuid), cockpit.delai_tache_prov() to service_role;
