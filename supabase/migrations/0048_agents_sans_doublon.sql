-- La chef compte chaque agent UNE fois (30 sept. 2026, chantier dd84764f)
--
-- Constat (Raphaël, 17:48) : « 6 chantiers en attente, la chef répond RIEN car
-- 8 agents travaillent ». Mesuré : les commandes de fond (wait, until, tests)
-- ne sont PAS comptées (type 'commande' / 'autre', agents_actifs ne lit que
-- 'agent'). La vraie cause est un DOUBLON : un agent existe en deux lignes,
--  - la vraie (SubagentStart / PostToolUse, tache_id = id de Claude Code),
--    dont la description est celle de l'outil Agent ;
--  - la provisoire « prov:<description> » créée par progression.sh --agent,
--    avec la description que l'agent se donne. Quand les deux textes
--    diffèrent (cas courant), adopter_provisoire ne les réunit jamais.
-- Session chef mesurée : 9 lignes comptées pour 6 agents (3 doublons).
--
-- Règle, une seule source (agents_actifs, lue par chef.sh) :
--   agents = vraies lignes vivantes
--          + lignes provisoires vivantes en surplus, c.-à-d. celles qu'aucune
--            vraie ligne SANS signal propre (ni étape ni chantier) ne peut
--            être : chaque vraie ligne muette « absorbe » une provisoire.
-- Une vraie ligne qui a signalé elle-même (adoptée) n'absorbe rien.
create or replace function cockpit.agents_actifs(p_session text, p_projet uuid)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_reels int; v_muets int; v_prov int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_session is null then return 0; end if;
  perform cockpit.clore_taches_prov_perimees(p_session);
  select count(*) filter (where t.tache_id not like 'prov:%'),
         count(*) filter (where t.tache_id not like 'prov:%' and t.progres_at is null and t.chantier_id is null),
         count(*) filter (where t.tache_id like 'prov:%')
    into v_reels, v_muets, v_prov
    from cockpit.taches t
   where t.session_id = p_session and t.projet_id = p_projet and t.type = 'agent'
     and t.statut = 'en_cours' and t.vu_at > now() - interval '3 hours';
  return v_reels + greatest(0, v_prov - v_muets);
end $$;

revoke execute on function cockpit.agents_actifs(text, uuid) from public, anon, authenticated;
grant execute on function cockpit.agents_actifs(text, uuid) to service_role;
