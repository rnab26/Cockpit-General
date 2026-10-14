-- 0078 — Réveil horaire du chef : un réglage par projet (13 oct. 2026, décision de Raphaël)
--
-- Raphaël : « t'as qu'à couper les réveils avec la relecture qui prend 750 000 jetons ou des choses comme ça.
-- Corrige le problème de relecture. » Mesuré (get_session, 13 oct.) : la routine « passage horaire du chef » réveille UNE
-- session persistante qui garde tout son contexte : 514 470 jetons, 155 réveils en 6 jours, 91 M de jetons relus pour
-- 24 000 écrits. Le réveil immédiat (jeton) et le filet de la base couvrent la réactivité ; le passage horaire n'apportait
-- presque rien. Les quatre routines récurrentes les plus lourdes ont été mises en pause (update_trigger enabled=false).
--
-- Avant cette migration rien ne permettait de dire « pas de réveil horaire » :
--  - chef.sh --prendre demandait à CHAQUE nouvelle chef d'en recréer un (la relecture serait donc revenue d'elle-même) ;
--  - l'app annonçait un « prochain passage de la chef » qui n'aura plus lieu (prochain_passage_chef).
-- Maintenant : chefs.reveil_horaire (vrai par défaut = le comportement d'avant ; cockpit = faux). Faux : prendre_chef le dit,
-- chef.sh n'ordonne plus de créer la routine, prochain_passage_chef ne promet plus de passage horaire.
-- Une migration qui redéfinit une fonction part de la définition EN VIGUEUR en base (pg_get_functiondef), pas d'une ancienne.

alter table cockpit.chefs add column if not exists reveil_horaire boolean not null default true;

update cockpit.chefs set reveil_horaire = false
 where projet_id = (select id from cockpit.projets where slug = 'cockpit') and reveil_horaire;

create or replace function cockpit.prendre_chef(p_projet text, p_session text, p_branche text, p_distante text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'cockpit', 'pg_temp'
as $function$
declare v_projet uuid; avant cockpit.chefs;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  if nullif(trim(coalesce(p_session, '')), '') is null then raise exception 'donne la session'; end if;
  insert into cockpit.chefs (projet_id) values (v_projet) on conflict (projet_id) do nothing;
  select * into avant from cockpit.chefs where projet_id = v_projet for update;
  update cockpit.chefs set
    session_id = p_session,
    session_distante = coalesce(nullif(p_distante, ''), case when session_id = p_session then session_distante end),
    branche = nullif(p_branche, ''),
    depuis = case when session_id is distinct from p_session then now() else depuis end,
    vu_at = now()
  where projet_id = v_projet;
  return jsonb_build_object('projet', p_projet, 'change', avant.session_id is distinct from p_session,
                            'ancienne', avant.session_id, 'ancienne_distante', avant.session_distante,
                            'reveil_trigger', avant.reveil_trigger, 'max_agents', avant.max_agents,
                            'reveil_horaire', avant.reveil_horaire);
end $function$;

create or replace function cockpit.prochain_passage_chef(p_projet_id uuid)
 returns timestamp with time zone
 language plpgsql
 stable
 security definer
 set search_path to 'cockpit', 'pg_temp'
as $function$
declare v_cible uuid; c cockpit.chefs; v_h timestamptz; r cockpit.reveils_immediats;
begin
  if not (cockpit.est_service() or cockpit.est_membre(p_projet_id)) then return null; end if;
  v_cible := cockpit.cible_reveil(p_projet_id);
  if v_cible is null then return null; end if;
  select * into c from cockpit.chefs where projet_id = v_cible;
  -- Le passage horaire n'est promis que s'il existe : réglage reveil_horaire (0078) + routine notée.
  if c.reveil_minute is not null and c.actif and c.session_id is not null and c.reveil_trigger is not null and c.reveil_horaire then
    v_h := date_trunc('hour', now()) + make_interval(mins => c.reveil_minute);
    if v_h <= now() then v_h := v_h + interval '1 hour'; end if;
  end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif;
  if r.dernier_at > now() - interval '10 minutes' then
    return least(coalesce(v_h, 'infinity'::timestamptz), r.dernier_at + interval '3 minutes');
  end if;
  return v_h;
end $function$;

create or replace function cockpit.regler_reveil_horaire(p_projet text, p_actif boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'cockpit', 'pg_temp'
as $function$
declare v_projet uuid; r cockpit.chefs;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_actif is null then raise exception 'oui ou non'; end if;
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  insert into cockpit.chefs (projet_id) values (v_projet) on conflict (projet_id) do nothing;
  update cockpit.chefs set reveil_horaire = p_actif where projet_id = v_projet returning * into r;
  return jsonb_build_object('projet', p_projet, 'reveil_horaire', r.reveil_horaire, 'reveil_trigger', r.reveil_trigger);
end $function$;
revoke all on function cockpit.regler_reveil_horaire(text, boolean) from public, anon;
grant execute on function cockpit.regler_reveil_horaire(text, boolean) to authenticated, service_role;
