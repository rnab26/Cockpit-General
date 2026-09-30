-- ÉCONOMIE DES MODÈLES (30 sept. 2026, chantier 7a52df8f)
--
-- Raphaël : « le cockpit consomme beaucoup trop de tokens dans les modèles, ce
-- qui fait que les sessions vont planter trop vite […] pouvoir choisir le
-- modèle (Sonnet 5.5 ou Opus 5.5) et l'effort […] hyper important » ; « fais
-- en sorte de ne jamais atteindre la limite des modèles ».
--
-- Ce que la base porte (par projet, table chefs) :
--   modele_code   modèle des agents qui CODENT et des sessions relais/renfort
--                 (sonnet par défaut) : haiku | sonnet | opus ;
--   modele_leger  modèle des agents de lecture (Répondre, Point, Vérifier, Revoir)
--                 (haiku par défaut) ;
--   effort        effort de raisonnement demandé aux agents : bas | moyen | eleve ;
--   frein_jusqu_a / frein_raison : FREIN posé à la main (chef.sh --frein) ;
--   agents en parallèle : 2 par défaut (avant : 3), réglable comme avant.
-- Le frein est aussi ACTIF tant qu'une session du projet est arrêtée sur une
-- limite d'usage (sessions.pause_raison = 'rate_limit', moins de 3 h) : la chef
-- ne lance alors qu'UN agent, aucune revue « À toi », aucun nouveau renfort.
-- La revue « À toi » devient au plus UNE FOIS PAR JOUR et par projet
-- (projets.revue_a_toi_delai_h, 24 par défaut, réglable ; avant : 1 h).
-- Idempotente.

alter table cockpit.chefs add column if not exists modele_code   text not null default 'sonnet';
alter table cockpit.chefs add column if not exists modele_leger  text not null default 'haiku';
alter table cockpit.chefs add column if not exists effort        text not null default 'moyen';
alter table cockpit.chefs add column if not exists frein_jusqu_a timestamptz;
alter table cockpit.chefs add column if not exists frein_raison  text;
alter table cockpit.chefs alter column max_agents set default 2;
alter table cockpit.projets add column if not exists revue_a_toi_delai_h int not null default 24;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chefs_modeles_valides') then
    alter table cockpit.chefs add constraint chefs_modeles_valides check (
      modele_code in ('haiku', 'sonnet', 'opus') and modele_leger in ('haiku', 'sonnet', 'opus') and effort in ('bas', 'moyen', 'eleve'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projets_revue_delai_valide') then
    alter table cockpit.projets add constraint projets_revue_delai_valide check (revue_a_toi_delai_h between 1 and 168);
  end if;
end $$;

-- Le frein est-il actif ? Une seule règle, lue par chef.sh et par l'écran.
create or replace function cockpit.frein_actif(p_projet uuid)
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  select case
    when c.frein_jusqu_a > now() then jsonb_build_object('actif', true, 'raison', coalesce(c.frein_raison, 'frein posé à la main'), 'jusqu_a', c.frein_jusqu_a)
    when exists (select 1 from cockpit.sessions s where s.projet_id = p_projet and s.pause_raison = 'rate_limit' and s.pause_at > now() - interval '3 hours')
      then jsonb_build_object('actif', true, 'raison', 'une session du projet est arrêtée sur la limite d''usage', 'jusqu_a', null)
    else jsonb_build_object('actif', false) end
  from (select 1) x left join cockpit.chefs c on c.projet_id = p_projet;
$$;

-- Réglages (admin depuis l'app, service depuis chef.sh).
create or replace function cockpit.regler_modeles(p_projet text, p_code text, p_leger text, p_effort text, p_agents int default null, p_revue_h int default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_code not in ('haiku', 'sonnet', 'opus') then raise exception 'Modèle de code : haiku, sonnet ou opus.'; end if;
  if p_leger not in ('haiku', 'sonnet', 'opus') then raise exception 'Modèle léger : haiku, sonnet ou opus.'; end if;
  if p_effort not in ('bas', 'moyen', 'eleve') then raise exception 'Effort : bas, moyen ou eleve.'; end if;
  if p_agents is not null and p_agents not between 1 and 8 then raise exception 'Agents en parallèle : un nombre de 1 à 8.'; end if;
  if p_revue_h is not null and p_revue_h not between 1 and 168 then raise exception 'Revue « À toi » : de 1 à 168 heures.'; end if;
  insert into cockpit.chefs (projet_id, modele_code, modele_leger, effort, max_agents)
  values (pr.id, p_code, p_leger, p_effort, coalesce(p_agents, 2))
  on conflict (projet_id) do update set modele_code = excluded.modele_code, modele_leger = excluded.modele_leger,
    effort = excluded.effort, max_agents = coalesce(p_agents, cockpit.chefs.max_agents);
  if p_revue_h is not null then update cockpit.projets set revue_a_toi_delai_h = p_revue_h where id = pr.id; end if;
  return cockpit.etat_modeles(p_projet);
end $$;

-- Freiner (heures > 0) ou lever le frein (0).
create or replace function cockpit.freiner(p_projet text, p_heures numeric, p_raison text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_heures is null or p_heures < 0 or p_heures > 48 then raise exception 'Frein : de 0 à 48 heures (0 = le lever).'; end if;
  insert into cockpit.chefs (projet_id, frein_jusqu_a, frein_raison)
  values (pr.id, case when p_heures > 0 then now() + make_interval(secs => p_heures * 3600) end, case when p_heures > 0 then nullif(left(p_raison, 200), '') end)
  on conflict (projet_id) do update set frein_jusqu_a = excluded.frein_jusqu_a, frein_raison = excluded.frein_raison;
  return cockpit.etat_modeles(p_projet);
end $$;

-- Tout ce que l'écran et chef.sh lisent (une seule règle).
create or replace function cockpit.etat_modeles(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; ch cockpit.chefs;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  select * into ch from cockpit.chefs where projet_id = pr.id;
  return jsonb_build_object(
    'modele_code', coalesce(ch.modele_code, 'sonnet'), 'modele_leger', coalesce(ch.modele_leger, 'haiku'),
    'effort', coalesce(ch.effort, 'moyen'), 'agents', coalesce(ch.max_agents, 2),
    'revue_h', pr.revue_a_toi_delai_h, 'frein', cockpit.frein_actif(pr.id));
end $$;

revoke all on function cockpit.frein_actif(uuid), cockpit.regler_modeles(text, text, text, text, int, int),
  cockpit.freiner(text, numeric, text), cockpit.etat_modeles(text) from public, anon, authenticated;
grant execute on function cockpit.frein_actif(uuid) to service_role;
grant execute on function cockpit.regler_modeles(text, text, text, text, int, int), cockpit.freiner(text, numeric, text),
  cockpit.etat_modeles(text) to authenticated, service_role;
