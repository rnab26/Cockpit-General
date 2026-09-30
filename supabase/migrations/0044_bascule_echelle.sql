-- 0044 — Bascule : plein gaz d'abord, effort avant modèle, Haiku en dernier (chantier a1a67b3d).
--
-- Raphaël (30/09) : « Sonnet ou Opus font très bien le travail, Haiku n'est pas assez puissant :
-- dernière option. Tant qu'il y a du crédit : plein gaz jusqu'à 50 % de la session, puis répartir pour
-- consommer les crédits jusqu'à la fin de la fenêtre sans forcément atteindre 100 %. Régler l'EFFORT
-- d'abord, le modèle ensuite, Haiku en tout dernier. »
--
-- Données RÉELLES (get_session → external_metadata.rate_limit_info, lu le 30/09) :
--   { status: allowed | allowed_warning | rejected, rateLimitType: five_hour | seven_day…,
--     resetsAt: epoch en secondes, isUsingOverage }. AUCUN pourcentage. On n'en invente pas :
--   le rythme = temps écoulé de la fenêtre (resetsAt - durée du type) + statut ; un pourcentage,
--   s'il est un jour donné (--usage … pct), prime.
--
-- Échelle (palier 0 à 3), UNE règle : cockpit.palier_cible
--   0  plein gaz     : modèles et effort réglés par Raphaël
--   1  rythme        : effort d'un cran plus bas (élevé → moyen → bas), modèles inchangés
--   2  économie      : effort bas + modèle plus léger d'un cran, sans jamais passer sous Sonnet
--   3  limite        : Haiku (si autorisé pour le projet, sinon Sonnet), effort bas
-- Décision par mesure :
--   statut autre que allowed* (rejected)      → 3
--   pourcentage connu : ≥ 95 → 3 ; < seuil → 0 ; sinon avance sur le temps écoulé de la fenêtre
--                       ≥ 15 pts → 2, > 0 → 1, sinon 0
--   pas de pourcentage : allowed → 0 ; allowed_warning → 2 si la fenêtre est écoulée à moins du seuil
--                       (on brûle trop vite), 1 après le seuil, 0 dans les 10 % finaux de la fenêtre
--                       (le crédit restant va être remis à zéro : autant le consommer)
-- Réglé par projet (chefs) : bascule_seuil_pct (défaut 50), bascule_haiku (Haiku autorisé au palier 3,
-- défaut oui). Le palier expire au plus tard à resetsAt (nouvelle fenêtre = plein gaz). Idempotente.

alter table cockpit.chefs add column if not exists bascule_seuil_pct smallint not null default 50;
alter table cockpit.chefs add column if not exists bascule_haiku boolean not null default true;
alter table cockpit.chefs add column if not exists palier_fenetre text;
alter table cockpit.chefs add column if not exists palier_reset_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chefs_seuil_valide') then
    alter table cockpit.chefs add constraint chefs_seuil_valide check (bascule_seuil_pct between 10 and 90);
  end if;
end $$;
-- Haiku en dernier : le modèle de lecture par défaut devient Sonnet (les réglages posés restent).
alter table cockpit.chefs alter column modele_leger set default 'sonnet';

-- Durée d'une fenêtre d'après rateLimitType (null si inconnue : pas de rythme, statut seul).
create or replace function cockpit.duree_fenetre(p_type text)
returns interval language sql immutable as $$
  select case when p_type = 'five_hour' then interval '5 hours'
              when p_type like 'seven_day%' then interval '7 days' end;
$$;

-- Part de la fenêtre déjà écoulée, en % (null si type ou fin inconnus).
create or replace function cockpit.fenetre_ecoulee_pct(p_type text, p_reset timestamptz, p_now timestamptz default now())
returns numeric language sql immutable as $$
  select case when cockpit.duree_fenetre(p_type) is null or p_reset is null then null
    else least(100, greatest(0, round(100 * (1 - extract(epoch from (p_reset - p_now)) / extract(epoch from cockpit.duree_fenetre(p_type))), 1))) end;
$$;

-- LA règle : mesure → palier.
create or replace function cockpit.palier_cible(p_statut text, p_pct numeric, p_type text, p_reset timestamptz, p_seuil int, p_now timestamptz default now())
returns int language plpgsql immutable as $$
declare ecoule numeric := cockpit.fenetre_ecoulee_pct(p_type, p_reset, p_now); avance numeric;
begin
  if p_statut is not null and p_statut not like 'allowed%' then return 3; end if;
  if p_pct is not null then
    if p_pct >= 95 then return 3; end if;
    if p_pct < p_seuil then return 0; end if;
    if ecoule is null then return case when p_pct < 80 then 1 else 2 end; end if;
    avance := p_pct - ecoule;
    return case when avance >= 15 then 2 when avance > 0 then 1 else 0 end;
  end if;
  if p_statut = 'allowed_warning' then
    if ecoule is null then return 1; end if;
    if ecoule >= 90 then return 0; end if;
    return case when ecoule < p_seuil then 2 else 1 end;
  end if;
  return 0;
end $$;

-- Descend un modèle de n crans sans passer sous le plancher (opus > sonnet > haiku).
create or replace function cockpit.descendre_modele(p_modele text, p_crans int, p_plancher text)
returns text language sql immutable as $$
  select (array['opus', 'sonnet', 'haiku'])[least(
    greatest(array_position(array['opus', 'sonnet', 'haiku'], p_modele), 1) + greatest(p_crans, 0),
    greatest(array_position(array['opus', 'sonnet', 'haiku'], p_plancher), 1))];
$$;

-- Effort descendu de n crans (eleve > moyen > bas).
create or replace function cockpit.descendre_effort(p_effort text, p_crans int)
returns text language sql immutable as $$
  select (array['eleve', 'moyen', 'bas'])[least(greatest(array_position(array['eleve', 'moyen', 'bas'], p_effort), 1) + greatest(p_crans, 0), 3)];
$$;

-- Le palier en vigueur : expire à resetsAt (nouvelle fenêtre) ou 3 h après la dernière mesure.
create or replace function cockpit.palier_actif(p_projet uuid)
returns int language sql stable security definer set search_path = cockpit, pg_temp as $$
  select case when coalesce(c.bascule_auto, true) = false then 0 else greatest(
    case when c.palier_at > now() - interval '3 hours' and (c.palier_reset_at is null or c.palier_reset_at > now()) then c.palier else 0 end,
    case when exists (select 1 from cockpit.sessions s where s.projet_id = p_projet and s.pause_raison = 'rate_limit' and s.pause_at > now() - interval '3 hours') then 3 else 0 end
  ) end
  from (select 1) x left join cockpit.chefs c on c.projet_id = p_projet;
$$;

-- Modèles et effort À UTILISER MAINTENANT. Une seule règle (lue par chef.sh, renfort.sh, l'écran).
create or replace function cockpit.modeles_effectifs(p_projet uuid)
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  with r as (
    select coalesce(c.modele_code, 'sonnet') as code, coalesce(c.modele_leger, 'sonnet') as leger, coalesce(c.effort, 'moyen') as effort,
           coalesce(c.bascule_haiku, true) as haiku, cockpit.palier_actif(p_projet) as pal
      from (select 1) x left join cockpit.chefs c on c.projet_id = p_projet)
  select jsonb_build_object(
    'palier', pal,
    'modele_code', case when pal >= 3 then (case when haiku then 'haiku' else cockpit.descendre_modele(code, 2, 'sonnet') end)
                        when pal = 2 then cockpit.descendre_modele(code, 1, 'sonnet') else code end,
    'modele_leger', case when pal >= 3 then (case when haiku then 'haiku' else cockpit.descendre_modele(leger, 2, 'sonnet') end)
                         when pal = 2 then cockpit.descendre_modele(leger, 1, 'sonnet') else leger end,
    'effort', case when pal >= 2 then 'bas' when pal = 1 then cockpit.descendre_effort(effort, 1) else effort end) from r;
$$;

-- Mesure d'usage → palier. Nouvelle signature : + type de fenêtre et resetsAt (epoch s). L'ancienne disparaît.
drop function if exists cockpit.bascule_usage(text, text, numeric, text);
create or replace function cockpit.bascule_usage(p_projet text, p_statut text, p_pct numeric default null, p_raison text default null,
                                                 p_type text default null, p_reset_epoch bigint default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; ch cockpit.chefs; cible int; courant int; raison text; reset_at timestamptz; ecoule numeric; seuil int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux scripts du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then raise exception 'Projet inconnu.'; end if;
  select * into ch from cockpit.chefs where projet_id = pr.id;
  seuil := coalesce(ch.bascule_seuil_pct, 50);
  reset_at := case when p_reset_epoch is not null then to_timestamp(p_reset_epoch) end;
  ecoule := cockpit.fenetre_ecoulee_pct(p_type, reset_at);
  cible := cockpit.palier_cible(p_statut, p_pct, p_type, reset_at, seuil);
  raison := coalesce(nullif(left(p_raison, 200), ''),
    'usage : ' || coalesce(p_statut, '?') || coalesce(' ' || round(p_pct)::text || ' %', '')
    || coalesce(' · fenêtre ' || p_type || ' écoulée à ' || round(ecoule)::text || ' %', '')
    || coalesce(' · remise à zéro à ' || to_char(reset_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), ''));
  courant := case when ch.palier_at > now() - interval '3 hours' and (ch.palier_reset_at is null or ch.palier_reset_at > now()) then ch.palier else 0 end;
  -- Monte tout de suite ; redescend seulement après 30 min sans montée (pas de yo-yo) ; une mesure identique rafraîchit l'expiration.
  if cible >= courant or ch.palier_at is null or ch.palier_at < now() - interval '30 minutes' then
    insert into cockpit.chefs (projet_id, palier, palier_at, palier_raison, palier_fenetre, palier_reset_at)
    values (pr.id, cible, now(), raison, p_type, reset_at)
    on conflict (projet_id) do update set palier = excluded.palier, palier_at = excluded.palier_at, palier_raison = excluded.palier_raison,
      palier_fenetre = excluded.palier_fenetre, palier_reset_at = excluded.palier_reset_at;
  end if;
  return cockpit.etat_modeles(p_projet);
end $$;

-- Réglages de la bascule par projet : seuil du plein gaz (10 à 90 %), Haiku autorisé au palier 3.
create or replace function cockpit.regler_bascule_seuils(p_projet text, p_seuil int, p_haiku boolean)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_seuil is null or p_seuil not between 10 and 90 then raise exception 'Seuil du plein gaz : de 10 à 90 %%.'; end if;
  insert into cockpit.chefs (projet_id, bascule_seuil_pct, bascule_haiku) values (pr.id, p_seuil, coalesce(p_haiku, true))
  on conflict (projet_id) do update set bascule_seuil_pct = excluded.bascule_seuil_pct, bascule_haiku = excluded.bascule_haiku;
  return cockpit.etat_modeles(p_projet);
end $$;

create or replace function cockpit.etat_modeles(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; ch cockpit.chefs; actif boolean;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  select * into ch from cockpit.chefs where projet_id = pr.id;
  actif := ch.palier_at > now() - interval '3 hours' and (ch.palier_reset_at is null or ch.palier_reset_at > now());
  return jsonb_build_object(
    'modele_code', coalesce(ch.modele_code, 'sonnet'), 'modele_leger', coalesce(ch.modele_leger, 'sonnet'),
    'effort', coalesce(ch.effort, 'moyen'), 'agents', coalesce(ch.max_agents, 2),
    'revue_h', pr.revue_a_toi_delai_h, 'frein', cockpit.frein_actif(pr.id),
    'bascule_auto', coalesce(ch.bascule_auto, true), 'palier', cockpit.palier_actif(pr.id),
    'bascule_seuil_pct', coalesce(ch.bascule_seuil_pct, 50), 'bascule_haiku', coalesce(ch.bascule_haiku, true),
    'fenetre', case when actif and ch.palier_fenetre is not null then jsonb_build_object(
      'type', ch.palier_fenetre, 'reset_at', ch.palier_reset_at, 'ecoule_pct', cockpit.fenetre_ecoulee_pct(ch.palier_fenetre, ch.palier_reset_at)) end,
    'palier_raison', case when cockpit.palier_actif(pr.id) > 0 then coalesce(case when actif then ch.palier_raison end, 'une session du projet est arrêtée sur la limite d''usage') end,
    'effectifs', cockpit.modeles_effectifs(pr.id));
end $$;

revoke all on function cockpit.duree_fenetre(text), cockpit.fenetre_ecoulee_pct(text, timestamptz, timestamptz),
  cockpit.palier_cible(text, numeric, text, timestamptz, int, timestamptz), cockpit.descendre_modele(text, int, text),
  cockpit.descendre_effort(text, int), cockpit.palier_actif(uuid), cockpit.modeles_effectifs(uuid),
  cockpit.bascule_usage(text, text, numeric, text, text, bigint), cockpit.regler_bascule_seuils(text, int, boolean),
  cockpit.etat_modeles(text) from public, anon, authenticated;
grant execute on function cockpit.duree_fenetre(text), cockpit.fenetre_ecoulee_pct(text, timestamptz, timestamptz),
  cockpit.palier_cible(text, numeric, text, timestamptz, int, timestamptz), cockpit.descendre_modele(text, int, text),
  cockpit.descendre_effort(text, int), cockpit.palier_actif(uuid), cockpit.modeles_effectifs(uuid),
  cockpit.bascule_usage(text, text, numeric, text, text, bigint) to service_role;
grant execute on function cockpit.regler_bascule_seuils(text, int, boolean), cockpit.etat_modeles(text) to authenticated, service_role;
