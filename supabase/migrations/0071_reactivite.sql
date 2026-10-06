-- 0071 — Réactivité : action, réaction, sans relancer à la main (chantier 30492b22).
-- Raphaël (6 oct.) : « les chantiers à lancer ne se lancent pas tout seuls ; la boucle de vérification n'est pas
-- assez fréquente ; plus d'effet instantané ; action, réaction comme dans un chat ».
-- Constaté le 6 oct. : la chef portait 624 932 jetons (> 500 000) et refusait tout agent ; 4 chantiers prenables
-- attendaient plus d'1 h ; le réveil du filet (11 h 45) a ouvert une session qui a VU une chef « vivante » (vue < 3 h)
-- et n'a servi que ce qui attend Raphaël. Délais cumulés : filet 10 min + cron 3 min + routine horaire + réveil 1/5 min.
-- UNE règle pour « la chef répond-elle ? » (chef_repond), lue par filet_vivant (une chef muette ne compte plus comme
-- « quelqu'un s'en occupe »), par scripts/chef.sh (la session réveillée la relève) et par l'écran.
-- Idempotent. Ne touche que le schéma cockpit.

-- ------------------------------------------------ 1. réglages visibles
alter table cockpit.projets add column if not exists reveil_ecart_min int not null default 5;
alter table cockpit.projets add column if not exists chef_reactif_min int not null default 5;
alter table cockpit.projets drop constraint if exists projets_reveil_ecart_chk;
alter table cockpit.projets add constraint projets_reveil_ecart_chk check (reveil_ecart_min between 1 and 60);
alter table cockpit.projets drop constraint if exists projets_chef_reactif_chk;
alter table cockpit.projets add constraint projets_chef_reactif_chk check (chef_reactif_min between 1 and 120);
alter table cockpit.filet_reglage add column if not exists cadence_min int not null default 1;
alter table cockpit.filet_reglage drop constraint if exists filet_reglage_cadence_chk;
alter table cockpit.filet_reglage add constraint filet_reglage_cadence_chk check (cadence_min between 1 and 15);

-- ------------------------------------------------ 2. règles
-- Jetons de la chef au-dessus du seuil (la condition de 0068, UNE fois ; chef_a_renouveler la relit).
create or replace function cockpit.chef_depasse(p_projet uuid) returns boolean
  language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce((select c.actif and c.session_id is not null and c.renouvellement_auto and c.seuil_jetons > 0
                          and coalesce(s.jetons, 0) >= c.seuil_jetons
                     from cockpit.chefs c left join cockpit.sessions s on s.id = c.session_id
                    where c.projet_id = p_projet), false);
$$;

-- Le décompte de agents_actifs SANS ses effets de bord (lisible par pg_cron).
create or replace function cockpit.agents_comptes(p_session text, p_projet uuid) returns integer
  language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare v_reels int; v_muets int; v_prov int;
begin
  if p_session is null then return 0; end if;
  select count(*) filter (where t.tache_id not like 'prov:%'),
         count(*) filter (where t.tache_id not like 'prov:%' and t.progres_at is null and t.chantier_id is null),
         count(*) filter (where t.tache_id like 'prov:%')
    into v_reels, v_muets, v_prov
    from cockpit.taches t
   where t.session_id = p_session and t.projet_id = p_projet and t.type = 'agent'
     and t.statut = 'en_cours' and t.vu_at > now() - interval '3 hours';
  return v_reels + greatest(0, v_prov - v_muets);
end $$;

create or replace function cockpit.agents_actifs(p_session text, p_projet uuid)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_session is null then return 0; end if;
  perform cockpit.clore_taches_prov_perimees(p_session);
  perform cockpit.clore_taches_mortes((select slug from cockpit.projets where id = p_projet), true);
  return cockpit.agents_comptes(p_session, p_projet);
end $$;

-- La chef répond-elle ? {repond, raison}. Non si :
--  aucune     : pas de chef active ;
--  jetons     : son contexte dépasse le seuil et plus aucun agent ne tourne (elle ne peut plus rien lancer) ;
--  sans_passe : du travail attend depuis plus de chef_reactif_min minutes, elle n'a fait aucune passe depuis son
--               arrivée et n'a aucun agent (une chef qui ne réagit pas, ou dont la session est muette).
-- Une chef dont les agents travaillent répond toujours (elle reprend la main à leur fin).
create or replace function cockpit.chef_repond(p_projet uuid) returns jsonb
  language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; c cockpit.chefs; v_ag int; v_att jsonb; v_pa timestamptz;
begin
  select * into pr from cockpit.projets where id = p_projet;
  if pr.id is null then return jsonb_build_object('repond', false, 'raison', 'aucune'); end if;
  select * into c from cockpit.chefs where projet_id = pr.id;
  if c.projet_id is null or not c.actif or c.session_id is null then
    return jsonb_build_object('repond', false, 'raison', 'aucune');
  end if;
  v_ag := cockpit.agents_comptes(c.session_id, pr.id);
  if v_ag > 0 then return jsonb_build_object('repond', true, 'raison', 'agents', 'agents', v_ag); end if;
  if cockpit.chef_depasse(pr.id) then
    return jsonb_build_object('repond', false, 'raison', 'jetons', 'session', c.session_id);
  end if;
  v_att := cockpit.filet_attente(pr.id);
  v_pa := nullif(v_att ->> 'plus_ancien', '')::timestamptz;
  if (v_att ->> 'n')::int > 0 and v_pa < now() - make_interval(mins => pr.chef_reactif_min)
     and (c.vu_at is null or c.vu_at < v_pa) then
    return jsonb_build_object('repond', false, 'raison', 'sans_passe', 'session', c.session_id, 'attend_depuis', v_pa);
  end if;
  return jsonb_build_object('repond', true, 'raison', 'ok');
end $$;

-- 0068 : chef_a_renouveler relit chef_depasse (une seule condition).
create or replace function cockpit.chef_a_renouveler(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; c cockpit.chefs; s cockpit.sessions; v_ag int := 0; v_dep boolean; v_att boolean;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  select * into c from cockpit.chefs where projet_id = pr.id;
  if c.projet_id is not null and c.session_id is not null then
    select * into s from cockpit.sessions where id = c.session_id;
    v_ag := coalesce(cockpit.agents_comptes(c.session_id, pr.id), 0);
  end if;
  v_dep := cockpit.chef_depasse(pr.id);
  v_att := c.renouvellement_demande_at is not null and c.renouvellement_demande_at > now() - interval '30 minutes';
  return jsonb_build_object('auto', coalesce(c.renouvellement_auto, true), 'seuil', coalesce(c.seuil_jetons, 500000),
    'jetons', s.jetons, 'jetons_at', s.jetons_at, 'session', c.session_id, 'agents', v_ag,
    'depasse', coalesce(v_dep, false), 'peut_ouvrir', coalesce(v_dep, false) and v_ag = 0 and not v_att,
    'demande_at', c.renouvellement_demande_at, 'nouvelle_session', c.renouvellement_session, 'erreur', c.renouvellement_erreur);
end $$;

-- Quelque chose de vivant : session, agent, renfort. Une chef qui ne répond pas ne compte PLUS.
create or replace function cockpit.filet_vivant(p_projet_id uuid) returns boolean
  language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare v_chef text; v_muette boolean;
begin
  select c.session_id into v_chef from cockpit.chefs c where c.projet_id = p_projet_id;
  v_muette := v_chef is not null and not coalesce((cockpit.chef_repond(p_projet_id) ->> 'repond')::boolean, true);
  return exists (select 1 from cockpit.sessions s where s.projet_id = p_projet_id and s.fin_at is null
                    and s.vu_at > now() - cockpit.delai_signe(p_projet_id) and not (v_muette and s.id = v_chef))
      or exists (select 1 from cockpit.taches t where t.projet_id = p_projet_id and t.statut = 'en_cours' and t.vu_at > now() - cockpit.delai_signe(p_projet_id))
      or exists (select 1 from cockpit.renforts r where r.projet_id = p_projet_id and cockpit.renfort_vivant(r));
end $$;

-- Écart entre deux réveils : court (reveil_ecart_min) tant qu'il y en a eu moins de 3 dans l'heure, l'étalement
-- de 0067 (24 h / plafond) ensuite : un réveil utile n'est plus bloqué 2 h, un réveil qui boucle l'est toujours.
create or replace function cockpit.filet_ecart_projet(p_projet uuid) returns interval
  language sql stable security definer set search_path = cockpit, pg_temp as $$
  select case when (select count(*) from cockpit.filet_reveils f where f.projet_id = p.id and f.at > now() - interval '1 hour') < 3
              then make_interval(mins => p.reveil_ecart_min)
              else cockpit.filet_ecart(p.filet_plafond_jour) end
    from cockpit.projets p where p.id = p_projet;
$$;

-- Réveil immédiat : au plus un par reveil_ecart_min (avant : 5 min en dur).
create or replace function cockpit.reveiller_chef(p_projet_id uuid, p_chantier uuid default null, p_raison text default 'message')
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_slug text; v_cible uuid; r cockpit.reveils_immediats; v_jeton text; v_req bigint; v_cslug text; v_texte text; v_ecart int;
begin
  select slug, reveil_ecart_min into v_slug, v_ecart from cockpit.projets where id = p_projet_id;
  if v_slug is null then return 'aucune_chef'; end if;
  if p_chantier is not null and exists (
       select 1 from cockpit.chantiers c join cockpit.sessions s on s.projet_id = c.projet_id and s.branche = c.pris_par
        where c.id = p_chantier and c.pris_jusqu_a > now() and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(p_projet_id)) then
    return 'session_tient';
  end if;
  if cockpit.rien_a_servir(p_projet_id, p_raison) then return 'rien_a_servir'; end if;
  v_cible := cockpit.cible_reveil(p_projet_id);
  if v_cible is null then return 'aucune_chef'; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif for update skip locked;
  if r.projet_id is null then return 'pas_configure'; end if;
  if r.dernier_at > now() - make_interval(mins => coalesce(v_ecart, 5)) then return 'trop_tot'; end if;
  select decrypted_secret into v_jeton from vault.decrypted_secrets where id = r.secret_id;
  if v_jeton is null then return 'pas_configure'; end if;
  select slug into v_cslug from cockpit.projets where id = v_cible;
  v_texte := case when p_raison like 'filet%'
    then format('Filet de sécurité : du travail attend dans le projet %s et aucune session ne le traite. Lance la passe de la chef du projet %s.', v_slug, v_cslug)
    else format('Raphaël vient d''écrire dans le cockpit (projet %s, %s). Lance la passe de la chef du projet %s.', v_slug, p_raison, v_cslug) end;
  v_req := net.http_post(
    url := 'https://api.anthropic.com/v1/claude_code/routines/' || r.trigger_id || '/fire',
    body := jsonb_build_object('text', v_texte),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_jeton, 'anthropic-beta', 'experimental-cc-routine-2026-04-01',
                                  'anthropic-version', '2023-06-01', 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
  update cockpit.reveils_immediats set dernier_at = now(), dernier_request = v_req, dernier_raison = left(v_slug || ' · ' || p_raison, 120)
   where projet_id = v_cible;
  return 'envoye';
end $$;

-- ------------------------------------------------ 3. le délai réel message → première réponse (mesuré, affiché)
create or replace function cockpit.delai_reponse(p_projet text, p_jours int default 7) returns jsonb
  language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare v_pid uuid; v jsonb;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select id into v_pid from cockpit.projets where slug = p_projet;
  if v_pid is null then return null; end if;
  with libres as (
    select m.id, m.created_at, m.chantier_id from cockpit.messages m
     where m.projet_id = v_pid and m.auteur_type in ('proprietaire', 'utilisateur') and m.kind in ('info', 'constat', 'reponse')
       and m.created_at > now() - make_interval(days => greatest(coalesce(p_jours, 7), 1)) and cockpit.est_message_libre(m)),
  rep as (
    select l.*, (select min(s.created_at) from cockpit.messages s
                  where s.projet_id = v_pid and s.chantier_id is not distinct from l.chantier_id
                    and s.auteur_type = 'session' and s.created_at > l.created_at) as r from libres l),
  d as (select *, extract(epoch from r - created_at) as s from rep)
  select jsonb_build_object(
      'jours', greatest(coalesce(p_jours, 7), 1), 'n', count(*), 'repondus', count(r), 'en_attente', count(*) filter (where r is null),
      'attente_depuis_s', (max(extract(epoch from now() - created_at)) filter (where r is null))::int,
      'mediane_s', (percentile_cont(0.5) within group (order by s))::int,
      'p90_s', (percentile_cont(0.9) within group (order by s))::int,
      'max_s', (max(s))::int,
      'dernier_s', (select d2.s::int from d d2 where d2.r is not null order by d2.created_at desc limit 1),
      'dernier_at', (select d2.created_at from d d2 where d2.r is not null order by d2.created_at desc limit 1))
    into v from d;
  return v;
end $$;

-- ------------------------------------------------ 4. la boucle (cron) : libération puis filet, une seule tâche, cadence réglable
create or replace function cockpit.boucle_reactive() returns jsonb
  language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  begin perform cockpit.liberation_passe(); exception when others then null; end;
  return cockpit.filet_passe();
end $$;

create or replace function cockpit.planifier_boucle(p_min int) returns void
  language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.schedule('cockpit-filet-securite', case when p_min <= 1 then '* * * * *' else format('*/%s * * * *', p_min) end,
    'select case when pg_try_advisory_xact_lock(724550) then cockpit.boucle_reactive() end');
  if not coalesce((select actif from cockpit.filet_reglage where id = 1), true) then
    perform cron.alter_job(j.jobid, active := false) from cron.job j where j.jobname = 'cockpit-filet-securite';
  end if;
exception when others then null;
end $$;

create or replace function cockpit.regler_cadence(p_min int) returns jsonb
  language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_min is null or p_min not between 1 and 15 then raise exception 'cadence : 1 à 15 minutes'; end if;
  update cockpit.filet_reglage set cadence_min = p_min, updated_at = now() where id = 1;
  perform cockpit.planifier_boucle(p_min);
  return jsonb_build_object('cadence_min', p_min);
end $$;

create or replace function cockpit.regler_reactivite(p_projet text, p_ecart_min int default null, p_chef_min int default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_ecart_min is not null and p_ecart_min not between 1 and 60 then raise exception 'écart entre réveils : 1 à 60 minutes'; end if;
  if p_chef_min is not null and p_chef_min not between 1 and 120 then raise exception 'réaction de la chef : 1 à 120 minutes'; end if;
  update cockpit.projets set reveil_ecart_min = coalesce(p_ecart_min, reveil_ecart_min), chef_reactif_min = coalesce(p_chef_min, chef_reactif_min)
   where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', r.slug, 'reveil_ecart_min', r.reveil_ecart_min, 'chef_reactif_min', r.chef_reactif_min);
end $$;

-- La relève de la chef par la session réveillée : une ligne dans le fil du projet.
create or replace function cockpit.noter_releve_chef(p_projet text, p_raison text, p_ancienne text) returns void
  language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_pid uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_pid from cockpit.projets where slug = p_projet;
  if v_pid is null then return; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_pid, null, 'cockpit', 'session', 'info',
    case p_raison when 'jetons' then 'Session chef relevée sans attendre : l’ancienne dépassait son seuil de jetons et n’avait plus d’agent, la session réveillée prend la main.'
                  when 'sans_passe' then 'Session chef relevée : l’ancienne ne réagissait pas à du travail en attente, la session réveillée prend la main.'
                  else 'Session chef relevée (' || coalesce(p_raison, '?') || ').' end);
end $$;

-- ------------------------------------------------ 5. filet_passe / etat_filet : écart par projet, état enrichi
CREATE OR REPLACE FUNCTION cockpit.filet_passe(p_slug text DEFAULT NULL::text, p_simuler boolean DEFAULT false, p_test boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr record; v_att jsonb; v_res text; v_out jsonb := '[]'::jsonb; v_jour int; v_dernier timestamptz; v_pourquoi text; v_r text;
begin
  if not coalesce((select actif from cockpit.filet_reglage where id = 1), true) then
    return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'global_eteint'));
  end if;
  if not pg_try_advisory_xact_lock(hashtext('cockpit.filet_passe')) then
    return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'passe_en_cours'));
  end if;
  for pr in select * from cockpit.projets p where p.actif and (p_slug is null or p.slug = p_slug) order by p.slug loop
    v_res := null;
    if cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false) then v_res := 'projet_de_test';
    elsif not pr.filet_actif then v_res := 'eteint';
    else
      v_att := cockpit.filet_attente(pr.id);
      if (v_att ->> 'n')::int = 0 then v_res := 'rien_en_attente';
      elsif (v_att ->> 'plus_ancien')::timestamptz > now() - make_interval(mins => pr.filet_delai_min) then v_res := 'trop_recent';
      elsif cockpit.filet_vivant(pr.id) then v_res := 'session_vivante';
      else
        select count(*), max(at) into v_jour, v_dernier from cockpit.filet_reveils where projet_id = pr.id and at > now() - interval '24 hours';
        if v_dernier > now() - cockpit.filet_ecart_projet(pr.id) then v_res := 'trop_tot';
        elsif v_jour >= pr.filet_plafond_jour then v_res := 'plafond';
        else
          v_pourquoi := left(array_to_string(array(select jsonb_array_elements_text(v_att -> 'raisons')), ', '), 300);
          if p_simuler then v_r := 'simule'; else v_r := cockpit.reveiller_chef(pr.id, null, 'filet de sécurité'); end if;
          if v_r in ('envoye', 'simule') then
            insert into cockpit.filet_reveils (projet_id, pourquoi, resultat, simule) values (pr.id, v_pourquoi, v_r, v_r = 'simule');
          end if;
          v_res := v_r;
        end if;
      end if;
    end if;
    v_out := v_out || jsonb_build_object('projet', pr.slug, 'resultat', v_res);
  end loop;
  return v_out;
exception when others then
  return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'erreur', 'detail', left(sqlerrm, 200)));
end $function$;

CREATE OR REPLACE FUNCTION cockpit.etat_filet(p_projet text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr cockpit.projets; v_cible uuid; v_att jsonb; j cockpit.filet_reveils; v_jour int; v_glob boolean; v_cron jsonb := null;
        v_jeton boolean; v_statut text; v_ecart interval; v_cad int;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  v_glob := coalesce((select actif from cockpit.filet_reglage where id = 1), true);
  v_cad := coalesce((select cadence_min from cockpit.filet_reglage where id = 1), 1);
  begin
    select jsonb_build_object('existe', true, 'actif', j2.active, 'planning', j2.schedule) into v_cron from cron.job j2 where j2.jobname = 'cockpit-filet-securite';
  exception when others then v_cron := null;
  end;
  v_cible := cockpit.cible_reveil(pr.id);
  v_jeton := v_cible is not null and exists (select 1 from cockpit.reveils_immediats ri where ri.projet_id = v_cible and ri.actif);
  v_att := cockpit.filet_attente(pr.id);
  select * into j from cockpit.filet_reveils where projet_id = pr.id order by at desc limit 1;
  select count(*) into v_jour from cockpit.filet_reveils where projet_id = pr.id and at > now() - interval '24 hours';
  v_ecart := cockpit.filet_ecart_projet(pr.id);
  v_statut := case when cockpit.projet_de_test(pr.slug) then 'test'
                   when not v_glob then 'global_eteint'
                   when not pr.filet_actif then 'eteint'
                   when v_cron is null or not coalesce((v_cron ->> 'actif')::boolean, false) then 'cron_absent'
                   when not v_jeton then 'sans_jeton'
                   when v_jour >= pr.filet_plafond_jour then 'plafond'
                   else 'actif' end;
  return jsonb_build_object('statut', v_statut, 'projet_actif', pr.filet_actif, 'global_actif', v_glob, 'cron', v_cron,
    'plafond', pr.filet_plafond_jour, 'delai_min', pr.filet_delai_min, 'aujourdhui', v_jour, 'jeton', v_jeton,
    'dernier_at', j.at, 'prochain_at', case when j.at is null then null else greatest(j.at + v_ecart, now()) end, 'ecart_min', (extract(epoch from v_ecart) / 60)::int,
    'dernier_pourquoi', j.pourquoi, 'attente', v_att, 'vivant', cockpit.filet_vivant(pr.id),
    'cadence_min', v_cad, 'reveil_ecart_min', pr.reveil_ecart_min, 'chef_reactif_min', pr.chef_reactif_min,
    'chef', cockpit.chef_repond(pr.id), 'reponse', cockpit.delai_reponse(p_projet, 7));
end $function$;

-- ------------------------------------------------ 6. droits (nommés, jamais PUBLIC) et mise en route
revoke all on function cockpit.chef_depasse(uuid), cockpit.agents_comptes(text, uuid), cockpit.chef_repond(uuid), cockpit.filet_ecart_projet(uuid),
  cockpit.delai_reponse(text, int), cockpit.boucle_reactive(), cockpit.planifier_boucle(int), cockpit.regler_cadence(int),
  cockpit.regler_reactivite(text, int, int), cockpit.noter_releve_chef(text, text, text),
  cockpit.agents_actifs(text, uuid), cockpit.chef_a_renouveler(text), cockpit.filet_vivant(uuid), cockpit.reveiller_chef(uuid, uuid, text),
  cockpit.filet_passe(text, boolean, boolean), cockpit.etat_filet(text) from public, anon, authenticated;
grant execute on function cockpit.chef_depasse(uuid), cockpit.agents_comptes(text, uuid), cockpit.chef_repond(uuid), cockpit.filet_ecart_projet(uuid),
  cockpit.boucle_reactive(), cockpit.planifier_boucle(int), cockpit.noter_releve_chef(text, text, text),
  cockpit.agents_actifs(text, uuid), cockpit.filet_vivant(uuid), cockpit.reveiller_chef(uuid, uuid, text), cockpit.filet_passe(text, boolean, boolean) to service_role;
grant execute on function cockpit.delai_reponse(text, int), cockpit.regler_cadence(int), cockpit.regler_reactivite(text, int, int),
  cockpit.chef_a_renouveler(text), cockpit.etat_filet(text) to authenticated, service_role;

select cockpit.planifier_boucle(coalesce((select cadence_min from cockpit.filet_reglage where id = 1), 1));
