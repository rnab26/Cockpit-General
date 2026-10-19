-- 0105 : le cockpit repère SEUL ce qui ne marche pas, et le dit (19 oct. 2026, chantier 7cecd1f3).
-- Raphaël : « Je veux que ce soit automatique […] je ne peux pas chaque fois que j'utilise le cockpit signaler tout ça. »
-- Le fardeau s'inverse : ce n'est plus lui qui signale une panne, c'est le cockpit.
--
-- UNE règle côté base, sans jetons et sans session : cockpit.autocontrole_passe (pg_cron, toutes les 5 min, éteignable, réglable).
-- Elle calcule, par projet, des « incidents » parmi une liste FERMÉE de cas qu'on peut vraiment lire en base (aucun n'est deviné) :
--   reveil_refuse         du travail attend, et le dernier réveil a été REFUSÉ par le service (la réponse HTTP est gardée par pg_net :
--                         net._http_response, lue avec reveils_immediats.dernier_request ; ex. 401 « OAuth access token is invalid »)
--   reveil_sans_effet     du travail attend, un réveil est parti (réponse 2xx : la session a été créée) mais personne n'a rien pris
--                         depuis le délai du projet : la session lancée n'a rien fait (cas du 19 oct. : « le dépôt trieur-data n'est pas
--                         dans les dépôts de la routine » ; la CAUSE exacte n'est pas en base, le lien de la session lancée l'est)
--   attente_sans_reveil   du travail attend et aucun réveil n'est parti depuis (ou aucune routine n'est configurée)
--   attente_reveil_eteint du travail attend et le réveil automatique est éteint : c'est le CHOIX de Raphaël (19 oct.), gravité « info »,
--                         jamais une panne
--   renfort_en_erreur     la dernière session lancée s'est arrêtée avec une erreur (sa vraie raison) et du travail reste
--   session_sans_nouvelles une session qui devait travailler ne donne plus de signe (règle unique etat_session)
--   cartes_non_retirees   des cartes dépassées (règle carte_depassee) ne sont pas retirées seules : la passe d'épuration ne tourne plus
-- Ce qui n'est PAS lisible en base, donc pas inventé : une vraie session de travail ouverte hors du dossier du projet (aucun hook : elle
-- n'écrit jamais en base) ; les cartes « en double » (aucune règle de doublon sûre) ; la cause exacte d'une session lancée qui n'a rien fait.
-- Une « attente » compte seulement si AUCUNE session n'est au travail (etat_session, 0104) et que le projet n'est pas en pause (0093).
--
-- Table `incidents` : (projet, code) ouvert au plus une fois ; « depuis » ne bouge pas tant que l'incident dure ; il se RÉSOUT SEUL dès que
-- la condition disparaît (aucun clic). RLS admin, temps réel, replica identity full.
--
-- Nettoyage sans risque (jamais de réveil : Raphaël a coupé le filet automatique le 19 oct. à cause du coût en jetons, on ne le rallume pas) :
-- une demande de session restée « demande » plus de `autocontrole_nettoyage_min` sans qu'aucune session ne travaille est fermée avec sa
-- raison en mots simples (« fini » si plus rien n'est à faire, sinon « erreur »), comme renforts_expirer (0089) mais plus tôt et réglable.
-- Réglages (jamais en dur) : projets.autocontrole_delai_min (20), autocontrole_nettoyage_min (60, 0 = jamais), autocontrole_garde_h (6) ;
-- interrupteur général filet_reglage.autocontrole_actif. Idempotente, rejouable.

alter table cockpit.filet_reglage add column if not exists autocontrole_actif boolean not null default true;
alter table cockpit.projets add column if not exists autocontrole_delai_min integer not null default 20;
alter table cockpit.projets add column if not exists autocontrole_nettoyage_min integer not null default 60;
alter table cockpit.projets add column if not exists autocontrole_garde_h integer not null default 6;
alter table cockpit.projets drop constraint if exists projets_autocontrole_check;
alter table cockpit.projets add constraint projets_autocontrole_check check (
  autocontrole_delai_min between 5 and 1440 and (autocontrole_nettoyage_min = 0 or autocontrole_nettoyage_min between 10 and 1440)
  and autocontrole_garde_h between 1 and 168);

create table if not exists cockpit.incidents (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references cockpit.projets(id) on delete cascade,
  code text not null,
  gravite text not null default 'panne',
  cause text not null,
  detail jsonb not null default '{}'::jsonb,
  etat text not null default 'ouvert',
  depuis timestamptz not null default now(),
  vu_at timestamptz not null default now(),
  resolu_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table cockpit.incidents drop constraint if exists incidents_code_check;
alter table cockpit.incidents add constraint incidents_code_check check (code in
  ('reveil_refuse', 'reveil_sans_effet', 'attente_sans_reveil', 'attente_reveil_eteint', 'renfort_en_erreur', 'session_sans_nouvelles', 'cartes_non_retirees'));
alter table cockpit.incidents drop constraint if exists incidents_gravite_check;
alter table cockpit.incidents add constraint incidents_gravite_check check (gravite in ('panne', 'info'));
alter table cockpit.incidents drop constraint if exists incidents_etat_check;
alter table cockpit.incidents add constraint incidents_etat_check check (etat in ('ouvert', 'resolu'));
create unique index if not exists incidents_un_ouvert on cockpit.incidents (projet_id, code) where etat = 'ouvert';
create index if not exists incidents_ouverts on cockpit.incidents (projet_id, depuis) where etat = 'ouvert';

alter table cockpit.incidents enable row level security;
drop policy if exists admin_tout on cockpit.incidents;
create policy admin_tout on cockpit.incidents for all using (cockpit.est_admin()) with check (cockpit.est_admin());
alter table cockpit.incidents replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table cockpit.incidents; exception when duplicate_object then null; end;
end $$;
-- Moindre privilège : l'écran LIT (politique admin_tout), seule la passe (security definer) écrit.
revoke all on cockpit.incidents from public, anon, authenticated;
grant select on cockpit.incidents to authenticated;
grant select, insert, update, delete on cockpit.incidents to service_role;

-- La passe. p_essai : dit ce qu'elle ferait, n'écrit rien. Une erreur ne casse pas pg_cron.
create or replace function cockpit.autocontrole_passe(p_slug text default null, p_essai boolean default false, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
declare
  pr record; rf cockpit.renforts; r cockpit.reveils_immediats; h record;
  v_att jsonb; v_n int; v_plus timestamptz; v_travail int; v_cible uuid; v_delai interval;
  v_voulus jsonb; v_out jsonb := '[]'::jsonb; v_net int; v_clos int; v_auto boolean; v_vu timestamptz; v_cartes int; v_dep timestamptz;
  v_code text; v_grav text; v_cause text; v_detail jsonb; v_url text; v_i jsonb; v_rep boolean;
begin
  if not coalesce((select autocontrole_actif from cockpit.filet_reglage where id = 1), true) then
    return jsonb_build_object('global', false, 'projets', '[]'::jsonb);
  end if;
  if not pg_try_advisory_xact_lock(hashtext('cockpit.autocontrole_passe')) then
    return jsonb_build_object('global', true, 'passe_en_cours', true, 'projets', '[]'::jsonb);
  end if;
  v_auto := coalesce((select actif from cockpit.filet_reglage where id = 1), true);
  for pr in select * from cockpit.projets p where p.actif and (p_slug is null or p.slug = p_slug) order by p.slug loop
    if cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false) then continue; end if;
    v_voulus := '[]'::jsonb; v_net := 0;
    v_delai := make_interval(mins => pr.autocontrole_delai_min);
    -- Un projet EN PAUSE (0093) n'a aucun incident : rien ne doit y travailler, donc rien n'y est « en panne ».
    if not cockpit.projet_en_pause(pr.id) then
      v_travail := cockpit.sessions_au_travail(pr.id);   -- règle unique etat_session (0104)

      -- (C) Nettoyage sans risque : une demande de session que personne n'a prise. JAMAIS de réveil.
      if pr.autocontrole_nettoyage_min > 0 and v_travail = 0 then
        for rf in select * from cockpit.renforts x where x.projet_id = pr.id and x.statut = 'demande' and x.session_distante is null
                     and cockpit.renfort_demande_depuis(x) < now() - make_interval(mins => pr.autocontrole_nettoyage_min)
                   order by x.created_at for update skip locked loop
          v_net := v_net + 1;
          if not p_essai then
            update cockpit.renforts set
              statut = case when cockpit.renfort_travail_restant(rf) = 0 then 'fini' else 'erreur' end,
              fini_at = case when cockpit.renfort_travail_restant(rf) = 0 then now() else fini_at end,
              erreur = case when cockpit.renfort_travail_restant(rf) = 0 then erreur
                            else 'Aucune session ne l''a prise en ' || pr.autocontrole_nettoyage_min || ' min. Rien n''est perdu : relance avec « Tout lancer ».' end,
              erreur_at = case when cockpit.renfort_travail_restant(rf) = 0 then erreur_at else now() end
             where id = rf.id and statut = 'demande';
          end if;
        end loop;
      end if;

      -- 1. Du travail attend sans que personne ne travaille.
      v_att := cockpit.filet_attente(pr.id);
      v_n := coalesce((v_att ->> 'n')::int, 0);
      v_plus := (v_att ->> 'plus_ancien')::timestamptz;
      if v_travail = 0 and v_n > 0 and v_plus < now() - v_delai then
        v_cible := cockpit.cible_reveil(pr.id);
        select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif;
        v_code := null; v_grav := 'panne'; v_detail := jsonb_build_object('attend', v_n, 'raisons', v_att -> 'raisons', 'geste', 'activer_session');
        if r.projet_id is null then
          v_code := 'attente_sans_reveil'; v_detail := v_detail || jsonb_build_object('geste', null);
          v_cause := 'Du travail attend et aucun réveil n''est configuré pour ce projet : ouvre Claude Code à la main.';
        elsif r.dernier_at is not null and r.dernier_at >= v_plus then
          -- Un réveil est parti depuis que ça attend : le service l'a-t-il accepté ? (réponse gardée par pg_net, pas en SQL du cockpit)
          select hr.status_code, hr.error_msg, hr.content into h from net._http_response hr where hr.id = r.dernier_request;
          v_rep := found;
          v_detail := v_detail || jsonb_build_object('reveil_at', r.dernier_at);
          if v_rep and (h.error_msg is not null or (h.status_code is not null and h.status_code not between 200 and 299)) then
            v_code := 'reveil_refuse';
            v_cause := 'Du travail attend et le dernier réveil a échoué : ' || case
              when h.error_msg is not null then 'le service ne répond pas.'
              when h.status_code in (401, 403) then 'la clé du réveil est refusée, il faut la renouveler.'
              when h.status_code = 404 then 'la routine du réveil n''existe plus.'
              when h.status_code = 429 then 'trop de demandes, le service demande d''attendre.'
              else 'le service a répondu une erreur (code ' || h.status_code || ').' end;
            v_detail := v_detail || jsonb_build_object('code_http', h.status_code);
          elsif now() - r.dernier_at > v_delai then
            v_code := 'reveil_sans_effet';
            v_cause := 'Du travail attend : un réveil est parti, mais la session lancée n''a rien pris.';
            v_url := null;
            if v_rep then begin v_url := (h.content::jsonb) ->> 'claude_code_session_url'; exception when others then v_url := null; end; end if;
            if v_url is not null then v_detail := v_detail || jsonb_build_object('session_url', v_url); end if;
          end if;   -- sinon le réveil vient de partir : on lui laisse sa chance
        elsif not v_auto or not pr.filet_actif then
          v_code := 'attente_reveil_eteint'; v_grav := 'info';
          v_cause := 'Du travail attend, et le réveil automatique est éteint (ton choix).';
        else
          v_code := 'attente_sans_reveil';
          v_cause := 'Du travail attend et aucun réveil n''est parti depuis.';
        end if;
        if v_code is not null then
          v_voulus := v_voulus || jsonb_build_object('code', v_code, 'gravite', v_grav, 'cause', v_cause, 'detail', v_detail, 'depuis', v_plus);
        end if;
      end if;

      -- 2. La dernière session lancée s'est arrêtée en erreur, et du travail reste.
      select * into rf from cockpit.renforts x where x.projet_id = pr.id order by x.created_at desc limit 1;
      if found and rf.statut = 'erreur' and rf.efface_at is null and v_travail = 0
         and coalesce(rf.erreur_at, rf.created_at) > now() - make_interval(hours => pr.autocontrole_garde_h)
         and cockpit.renfort_travail_restant(rf) > 0 then
        v_voulus := v_voulus || jsonb_build_object('code', 'renfort_en_erreur', 'gravite', 'panne',
          'cause', 'Une session lancée s''est arrêtée : ' || coalesce(nullif(rf.erreur, ''), 'sans dire pourquoi.'),
          'detail', jsonb_build_object('renfort', rf.id, 'reste', cockpit.renfort_travail_restant(rf)),
          'depuis', coalesce(rf.erreur_at, rf.created_at));
      end if;

      -- 3. Une session qui devait travailler ne donne plus de signe.
      select count(*), min(s.vu_at) into v_n, v_vu from cockpit.sessions s
       where s.projet_id = pr.id and s.fin_at is null and cockpit.etat_session(s) = 'sans_nouvelles';
      if v_n > 0 and v_travail = 0 then
        v_voulus := v_voulus || jsonb_build_object('code', 'session_sans_nouvelles', 'gravite', 'panne',
          'cause', case when v_n > 1 then v_n || ' sessions qui devaient travailler ne donnent plus de nouvelles.'
                        else 'Une session qui devait travailler ne donne plus de nouvelles.' end,
          'detail', jsonb_build_object('sessions', v_n), 'depuis', v_vu);
      end if;

      -- 4. Des cartes dépassées que la passe d'épuration (3 min) aurait dû retirer.
      if pr.epuration_delai_h > 0 and coalesce((select epuration_actif from cockpit.filet_reglage where id = 1), true) then
        select count(*), min(m.created_at) into v_cartes, v_dep from cockpit.messages m
         where m.projet_id = pr.id and m.answered_at is null and m.kind in ('question', 'action') and not m.epuration_exclue and m.retour_at is null
           and greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) + make_interval(hours => pr.epuration_delai_h * case when m.kind = 'action' then 7 else 1 end) < now() - v_delai
           and cockpit.carte_depassee(m) is not null;
        if v_cartes > 0 then
          v_voulus := v_voulus || jsonb_build_object('code', 'cartes_non_retirees', 'gravite', 'panne',
            'cause', case when v_cartes > 1 then v_cartes || ' cartes périmées ne se retirent pas toutes seules.' else 'Une carte périmée ne se retire pas toute seule.' end,
            'detail', jsonb_build_object('cartes', v_cartes), 'depuis', v_dep);
        end if;
      end if;
    end if;

    -- Écriture : ce qui est voulu s'ouvre ou se met à jour, ce qui ne l'est plus se RÉSOUT (aucun clic).
    v_clos := 0;
    if not p_essai then
      update cockpit.incidents i set etat = 'resolu', resolu_at = now(), updated_at = now()
       where i.projet_id = pr.id and i.etat = 'ouvert'
         and not exists (select 1 from jsonb_array_elements(v_voulus) v where v ->> 'code' = i.code);
      get diagnostics v_clos = row_count;
      for v_i in select * from jsonb_array_elements(v_voulus) loop
        insert into cockpit.incidents (projet_id, code, gravite, cause, detail, depuis)
        values (pr.id, v_i ->> 'code', v_i ->> 'gravite', v_i ->> 'cause', coalesce(v_i -> 'detail', '{}'::jsonb), coalesce((v_i ->> 'depuis')::timestamptz, now()))
        on conflict (projet_id, code) where etat = 'ouvert'
        do update set gravite = excluded.gravite, cause = excluded.cause, detail = excluded.detail, vu_at = now(), updated_at = now();
      end loop;
    end if;
    v_out := v_out || jsonb_build_object('projet', pr.slug, 'incidents', v_voulus, 'nettoyes', v_net, 'resolus', v_clos);
  end loop;
  return jsonb_build_object('global', true, 'essai', p_essai, 'projets', v_out);
exception when others then
  return jsonb_build_object('erreur', left(sqlerrm, 200));
end $$;

-- Réglages : par projet (slug + délais) ou global (slug nul + p_actif). Un nombre hors bornes est refusé avec la borne.
create or replace function cockpit.regler_autocontrole(p_projet text default null, p_delai_min integer default null, p_nettoyage_min integer default null,
                                                       p_garde_h integer default null, p_actif boolean default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_projet is null then
    if p_actif is null then raise exception 'dis si l''autocontrôle est allumé ou éteint'; end if;
    update cockpit.filet_reglage set autocontrole_actif = p_actif, updated_at = now() where id = 1;
    begin
      perform cron.alter_job(j.jobid, active := p_actif) from cron.job j where j.jobname = 'cockpit-autocontrole';
    exception when others then null;
    end;
    return jsonb_build_object('global', p_actif);
  end if;
  if p_delai_min is null or p_delai_min < 5 or p_delai_min > 1440 then raise exception 'délai avant d''alerter : de 5 à 1440 minutes'; end if;
  if p_nettoyage_min is null or (p_nettoyage_min <> 0 and (p_nettoyage_min < 10 or p_nettoyage_min > 1440)) then raise exception 'nettoyage des demandes sans suite : 0 (jamais) ou de 10 à 1440 minutes'; end if;
  if p_garde_h is null or p_garde_h < 1 or p_garde_h > 168 then raise exception 'durée d''une erreur de session : de 1 à 168 heures'; end if;
  update cockpit.projets set autocontrole_delai_min = p_delai_min, autocontrole_nettoyage_min = p_nettoyage_min, autocontrole_garde_h = p_garde_h where slug = p_projet;
  if not found then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'delai_min', p_delai_min, 'nettoyage_min', p_nettoyage_min, 'garde_h', p_garde_h);
end $$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron non installable ici (%) : l''autocontrôle ne tournera pas seul', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cockpit-autocontrole') then
      perform cron.unschedule('cockpit-autocontrole');
    end if;
    perform cron.schedule('cockpit-autocontrole', '*/5 * * * *', 'select cockpit.autocontrole_passe()');
    if not coalesce((select autocontrole_actif from cockpit.filet_reglage where id = 1), true) then
      perform cron.alter_job(j.jobid, active := false) from cron.job j where j.jobname = 'cockpit-autocontrole';
    end if;
  end if;
end $$;

revoke all on function cockpit.autocontrole_passe(text, boolean, boolean), cockpit.regler_autocontrole(text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function cockpit.autocontrole_passe(text, boolean, boolean) to service_role;
grant execute on function cockpit.regler_autocontrole(text, integer, integer, integer, boolean) to authenticated, service_role;
