-- 0037 — Bascule automatique des modèles selon la consommation (chantier 29fac2e1).
--
-- Raphaël : « bascule automatique des modèles selon l'usage pour ne jamais être à court de
-- crédit, sans manipulation manuelle : meilleurs modèles au début, ralentir la cadence au fur
-- et à mesure, continuer h24 » ; puis (30/09) : « c'est le NOMBRE d'agents qui ne pose pas
-- problème, seuls les modèles bloquent » → on ne bride JAMAIS le nombre d'agents : on ne
-- change que le modèle (et l'effort).
--
-- Palier d'usage (chefs.palier, 0 à 3), UNE règle en base, lue par chef.sh, renfort.sh et l'écran :
--   0  normal            : les modèles réglés par Raphaël (0035), les meilleurs
--   1  usage soutenu     : le modèle de code descend d'un cran (opus → sonnet → haiku)
--   2  usage élevé       : code d'un cran de plus, lecture d'un cran, effort « bas »
--   3  limite proche/atteinte : tout en haiku, effort « bas » (les sessions continuent h24)
-- Il monte tout de suite, redescend d'un coup seulement après 30 min de calme, et expire seul
-- après 3 h sans nouvelle mesure. Une session du projet arrêtée sur la limite (pause_raison =
-- 'rate_limit', < 3 h) vaut palier 3. Interrupteur par projet : chefs.bascule_auto (allumé par défaut).
-- L'ancien frein « 1 agent » n'est plus déclenché par l'usage (reste un geste manuel de Raphaël).
-- Idempotente.

alter table cockpit.chefs add column if not exists bascule_auto  boolean not null default true;
alter table cockpit.chefs add column if not exists palier        smallint not null default 0;
alter table cockpit.chefs add column if not exists palier_at     timestamptz;
alter table cockpit.chefs add column if not exists palier_raison text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chefs_palier_valide') then
    alter table cockpit.chefs add constraint chefs_palier_valide check (palier between 0 and 3);
  end if;
end $$;

-- Le frein ne vient plus de l'usage : seulement d'un geste manuel (le nombre d'agents n'est pas le problème).
create or replace function cockpit.frein_actif(p_projet uuid)
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  select case
    when c.frein_jusqu_a > now() then jsonb_build_object('actif', true, 'raison', coalesce(c.frein_raison, 'frein posé à la main'), 'jusqu_a', c.frein_jusqu_a)
    else jsonb_build_object('actif', false) end
  from (select 1) x left join cockpit.chefs c on c.projet_id = p_projet;
$$;

-- Le palier en vigueur (0 si l'interrupteur est éteint).
create or replace function cockpit.palier_actif(p_projet uuid)
returns int language sql stable security definer set search_path = cockpit, pg_temp as $$
  select case when coalesce(c.bascule_auto, true) = false then 0 else greatest(
    case when c.palier_at > now() - interval '3 hours' then c.palier else 0 end,
    case when exists (select 1 from cockpit.sessions s where s.projet_id = p_projet and s.pause_raison = 'rate_limit' and s.pause_at > now() - interval '3 hours') then 3 else 0 end
  ) end
  from (select 1) x left join cockpit.chefs c on c.projet_id = p_projet;
$$;

-- Descend un modèle de n crans sur l'échelle opus > sonnet > haiku (jamais sous haiku).
create or replace function cockpit.descendre_modele(p_modele text, p_crans int)
returns text language sql immutable as $$
  select (array['opus', 'sonnet', 'haiku'])[least(greatest(array_position(array['opus', 'sonnet', 'haiku'], p_modele), 1) + greatest(p_crans, 0), 3)];
$$;

-- Les modèles et l'effort À UTILISER MAINTENANT (réglages de Raphaël + palier). Une seule règle.
create or replace function cockpit.modeles_effectifs(p_projet uuid)
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  with r as (
    select coalesce(c.modele_code, 'sonnet') as code, coalesce(c.modele_leger, 'haiku') as leger, coalesce(c.effort, 'moyen') as effort,
           cockpit.palier_actif(p_projet) as pal
      from (select 1) x left join cockpit.chefs c on c.projet_id = p_projet)
  select jsonb_build_object(
    'palier', pal,
    'modele_code', case when pal >= 3 then 'haiku' else cockpit.descendre_modele(code, pal) end,
    'modele_leger', case when pal >= 3 then 'haiku' else cockpit.descendre_modele(leger, pal - 1) end,
    'effort', case when pal >= 2 then 'bas' else effort end) from r;
$$;

-- Mesure d'usage → palier. p_statut : « allowed », « allowed_warning », « rejected »… (rate_limit_info.status) ;
-- p_pct : utilisation en % si connue (elle prime). Service seulement (chef.sh --usage).
create or replace function cockpit.bascule_usage(p_projet text, p_statut text, p_pct numeric default null, p_raison text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; ch cockpit.chefs; cible int; courant int; raison text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux scripts du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then raise exception 'Projet inconnu.'; end if;
  cible := case
    when p_pct is not null then case when p_pct < 60 then 0 when p_pct < 80 then 1 when p_pct < 90 then 2 else 3 end
    when p_statut = 'allowed' then 0
    when p_statut = 'allowed_warning' then 1
    else 3 end;
  raison := coalesce(nullif(left(p_raison, 200), ''), 'usage : ' || coalesce(p_statut, '?') || coalesce(' ' || round(p_pct)::text || ' %', ''));
  select * into ch from cockpit.chefs where projet_id = pr.id;
  courant := case when ch.palier_at > now() - interval '3 hours' then ch.palier else 0 end;
  -- Monte tout de suite ; redescend seulement après 30 min sans montée (pas de yo-yo) ; une mesure identique rafraîchit l'expiration.
  if cible >= courant or ch.palier_at is null or ch.palier_at < now() - interval '30 minutes' then
    insert into cockpit.chefs (projet_id, palier, palier_at, palier_raison) values (pr.id, cible, now(), raison)
    on conflict (projet_id) do update set palier = excluded.palier, palier_at = excluded.palier_at, palier_raison = excluded.palier_raison;
  end if;
  return cockpit.etat_modeles(p_projet);
end $$;

-- Interrupteur (admin depuis l'app, service depuis chef.sh).
create or replace function cockpit.regler_bascule(p_projet text, p_actif boolean)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  insert into cockpit.chefs (projet_id, bascule_auto) values (pr.id, coalesce(p_actif, true))
  on conflict (projet_id) do update set bascule_auto = excluded.bascule_auto;
  return cockpit.etat_modeles(p_projet);
end $$;

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
    'revue_h', pr.revue_a_toi_delai_h, 'frein', cockpit.frein_actif(pr.id),
    'bascule_auto', coalesce(ch.bascule_auto, true), 'palier', cockpit.palier_actif(pr.id),
    'palier_raison', case when cockpit.palier_actif(pr.id) > 0 then coalesce(case when ch.palier_at > now() - interval '3 hours' then ch.palier_raison end, 'une session du projet est arrêtée sur la limite d''usage') end,
    'effectifs', cockpit.modeles_effectifs(pr.id));
end $$;

revoke all on function cockpit.palier_actif(uuid), cockpit.descendre_modele(text, int), cockpit.modeles_effectifs(uuid),
  cockpit.bascule_usage(text, text, numeric, text), cockpit.regler_bascule(text, boolean), cockpit.etat_modeles(text) from public, anon, authenticated;
grant execute on function cockpit.palier_actif(uuid), cockpit.modeles_effectifs(uuid), cockpit.bascule_usage(text, text, numeric, text) to service_role;
grant execute on function cockpit.regler_bascule(text, boolean), cockpit.etat_modeles(text) to authenticated, service_role;
grant execute on function cockpit.descendre_modele(text, int) to service_role;
