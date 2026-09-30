-- 0044 (30 sept. 2026, chantier 42938fc3). Raphaël : « s'il y a zéro session
-- active, ou que la chef n'est pas active, un chantier ne doit jamais rester
-- mort […] ça doit s'activer tout seul, sans que j'aille vérifier dans l'app
-- Claude Code. »
--
-- FILET DE SÉCURITÉ : une surveillance côté BASE (pg_cron, aucune session
-- nécessaire) toutes les 3 minutes. Elle ne réinvente rien : quand du travail
-- attend et que rien de vivant ne le traite, elle appelle le RÉVEIL IMMÉDIAT
-- existant (0028/0038 reveiller_chef : routine /fire, jeton dans le Vault,
-- cible_reveil = chef vivante sinon chef relais). Ce que la routine lance
-- est ce qu'elle lançait déjà : aucune dépense nouvelle.
--
-- « Du travail attend » (une seule règle : filet_attente) :
--   - message libre sans réponse (messages_sans_reponse) ;
--   - réponse de Raphaël sans suite (reponses_sans_suite) ;
--   - vérification demandée (verifs_prenables) ;
--   - renfort demandé et pas encore ouvert ;
--   - chantier prenable (libre / à trier / abandonné : chantiers_prenables),
--     SEULEMENT si le mode autonome du projet est allumé (sinon un chantier
--     « Prêt à lancer » attend Raphaël, pas une session).
--   Depuis au moins `filet_delai_min` minutes (défaut 10) : les hooks
--   (suivi.sh, 20 s) et la chef ont d'abord leur chance.
-- « Rien de vivant ne le traite » : aucune session du projet vue depuis moins
--   de 30 min, aucune tâche/agent en cours vu depuis moins de 30 min, aucun
--   renfort vivant.
-- Sûretés : jamais un projet de test (sauf p_test, pour le banc) ; au plus un
--   réveil par 5 min et par projet (journal + reveils_immediats.dernier_at) ;
--   plafond par jour et par projet (défaut 6, réglable 0-48) ; interrupteur par
--   projet ET global ; sans jeton : rien n'est appelé et l'écran le dit ;
--   le jeton n'apparaît nulle part (jamais lu ici, seulement par reveiller_chef).
-- Non couvert : « PR en conflit » (la base ne voit pas GitHub).
-- Le cron : `select * from cron.job where jobname = 'cockpit-filet-securite'`.
-- Idempotente.

-- ------------------------------------------------ 1. réglages
alter table cockpit.projets add column if not exists filet_actif boolean not null default true;
alter table cockpit.projets add column if not exists filet_plafond_jour int not null default 6;
alter table cockpit.projets add column if not exists filet_delai_min int not null default 10;
alter table cockpit.projets drop constraint if exists projets_filet_plafond_check;
alter table cockpit.projets add constraint projets_filet_plafond_check check (filet_plafond_jour between 0 and 48);
alter table cockpit.projets drop constraint if exists projets_filet_delai_check;
alter table cockpit.projets add constraint projets_filet_delai_check check (filet_delai_min between 1 and 240);

-- Interrupteur global (une ligne).
create table if not exists cockpit.filet_reglage (
  id int primary key default 1 check (id = 1),
  actif boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into cockpit.filet_reglage (id) values (1) on conflict do nothing;
alter table cockpit.filet_reglage enable row level security;
alter table cockpit.filet_reglage replica identity full;
drop policy if exists admin_tout on cockpit.filet_reglage;
create policy admin_tout on cockpit.filet_reglage for all using (cockpit.est_admin()) with check (cockpit.est_admin());

-- Journal : un réveil (envoyé ou simulé par le banc) = une ligne.
create table if not exists cockpit.filet_reveils (
  id         uuid primary key default gen_random_uuid(),
  projet_id  uuid not null references cockpit.projets (id) on delete cascade,
  at         timestamptz not null default now(),
  pourquoi   text not null,
  resultat   text not null,            -- envoye | simule
  simule     boolean not null default false
);
create index if not exists filet_reveils_projet_idx on cockpit.filet_reveils (projet_id, at desc);
alter table cockpit.filet_reveils enable row level security;
alter table cockpit.filet_reveils replica identity full;
drop policy if exists admin_tout on cockpit.filet_reveils;
create policy admin_tout on cockpit.filet_reveils for all using (cockpit.est_admin()) with check (cockpit.est_admin());

-- ------------------------------------------------ 2. ce qui attend, ce qui vit
-- Renvoie {n, plus_ancien, raisons: [texte…]}. Une seule règle, lue par la passe ET par l'écran.
create or replace function cockpit.filet_attente(p_projet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; n int; t timestamptz; v_raisons text[] := '{}'; v_n int := 0; v_min timestamptz;
begin
  select * into pr from cockpit.projets where id = p_projet_id;
  if pr.id is null then return jsonb_build_object('n', 0, 'plus_ancien', null, 'raisons', '[]'::jsonb); end if;
  select count(*), min(created_at) into n, t from cockpit.messages_sans_reponse(p_projet_id);
  if n > 0 then v_raisons := v_raisons || (n || ' message(s) sans réponse'); v_n := v_n + n; v_min := least(v_min, t); end if;
  select count(*), min(answered_at) into n, t from cockpit.reponses_sans_suite(p_projet_id);
  if n > 0 then v_raisons := v_raisons || (n || ' réponse(s) sans suite'); v_n := v_n + n; v_min := least(v_min, t); end if;
  select count(*), min(verif_demandee_at) into n, t from cockpit.verifs_prenables(p_projet_id, null);
  if n > 0 then v_raisons := v_raisons || (n || ' vérification(s) demandée(s)'); v_n := v_n + n; v_min := least(v_min, t); end if;
  select count(*), min(created_at) into n, t from cockpit.renforts r
   where r.projet_id = p_projet_id and r.statut = 'demande' and r.session_distante is null and cockpit.renfort_vivant(r);
  if n > 0 then v_raisons := v_raisons || (n || ' renfort(s) demandé(s)'); v_n := v_n + n; v_min := least(v_min, t); end if;
  if cockpit.autonome_actif(pr) then
    select count(*), min(updated_at) into n, t from cockpit.chantiers_prenables(p_projet_id, null);
    if n > 0 then v_raisons := v_raisons || (n || ' chantier(s) prenable(s)'); v_n := v_n + n; v_min := least(v_min, t); end if;
  end if;
  return jsonb_build_object('n', v_n, 'plus_ancien', v_min, 'raisons', to_jsonb(v_raisons));
end $$;

-- Quelque chose de vivant dans le projet : session, tâche/agent, renfort.
create or replace function cockpit.filet_vivant(p_projet_id uuid)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.sessions s where s.projet_id = p_projet_id and s.fin_at is null and s.vu_at > now() - interval '30 minutes')
      or exists (select 1 from cockpit.taches t where t.projet_id = p_projet_id and t.statut = 'en_cours' and t.vu_at > now() - interval '30 minutes')
      or exists (select 1 from cockpit.renforts r where r.projet_id = p_projet_id and cockpit.renfort_vivant(r));
$$;

-- ------------------------------------------------ 3. le réveil : texte propre à l'origine
-- (0038 revu : seul le texte envoyé à la routine change selon la raison.)
create or replace function cockpit.reveiller_chef(p_projet_id uuid, p_chantier uuid default null, p_raison text default 'message')
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_slug text; v_cible uuid; r cockpit.reveils_immediats; v_jeton text; v_req bigint; v_cslug text; v_texte text;
begin
  select slug into v_slug from cockpit.projets where id = p_projet_id;
  if v_slug is null then return 'aucune_chef'; end if;
  if p_chantier is not null and exists (
       select 1 from cockpit.chantiers c join cockpit.sessions s on s.projet_id = c.projet_id and s.branche = c.pris_par
        where c.id = p_chantier and c.pris_jusqu_a > now() and s.fin_at is null and s.vu_at > now() - interval '30 minutes') then
    return 'session_tient';
  end if;
  if cockpit.rien_a_servir(p_projet_id, p_raison) then return 'rien_a_servir'; end if;
  v_cible := cockpit.cible_reveil(p_projet_id);
  if v_cible is null then return 'aucune_chef'; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif for update skip locked;
  if r.projet_id is null then return 'pas_configure'; end if;
  if r.dernier_at > now() - interval '5 minutes' then return 'trop_tot'; end if;
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

-- ------------------------------------------------ 4. la passe (appelée par pg_cron)
-- p_slug : un seul projet ; p_simuler : journalise sans appeler le réseau (banc) ;
-- p_test : accepte un projet de test (banc seulement). Renvoie une ligne par projet vu.
create or replace function cockpit.filet_passe(p_slug text default null, p_simuler boolean default false, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
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
        if v_dernier > now() - interval '5 minutes' then v_res := 'trop_tot';
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
  -- Une passe qui échoue ne doit jamais casser pg_cron : elle le dit et rend la main.
  return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'erreur', 'detail', left(sqlerrm, 200)));
end $$;

-- ------------------------------------------------ 5. réglages depuis l'app / une session
create or replace function cockpit.regler_filet(p_projet text, p_actif boolean default null, p_plafond int default null, p_delai_min int default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_plafond is not null and p_plafond not between 0 and 48 then raise exception 'plafond : 0 à 48 réveils par jour'; end if;
  if p_delai_min is not null and p_delai_min not between 1 and 240 then raise exception 'délai : 1 à 240 minutes'; end if;
  update cockpit.projets set filet_actif = coalesce(p_actif, filet_actif), filet_plafond_jour = coalesce(p_plafond, filet_plafond_jour),
         filet_delai_min = coalesce(p_delai_min, filet_delai_min)
   where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', r.slug, 'actif', r.filet_actif, 'plafond', r.filet_plafond_jour, 'delai_min', r.filet_delai_min);
end $$;

-- Interrupteur global : coupe aussi le job pg_cron s'il existe.
create or replace function cockpit.regler_filet_global(p_actif boolean)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  update cockpit.filet_reglage set actif = p_actif, updated_at = now() where id = 1;
  begin
    perform cron.alter_job(j.jobid, active := p_actif) from cron.job j where j.jobname = 'cockpit-filet-securite';
  exception when others then null;   -- pg_cron absent : le drapeau suffit, filet_passe le lit
  end;
  return jsonb_build_object('actif', p_actif);
end $$;

-- Ce que l'écran montre (admin) : réglé ou non, dernier réveil et pourquoi, jamais le jeton.
create or replace function cockpit.etat_filet(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; v_cible uuid; v_att jsonb; j cockpit.filet_reveils; v_jour int; v_glob boolean; v_cron jsonb := null;
        v_jeton boolean; v_statut text;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  v_glob := coalesce((select actif from cockpit.filet_reglage where id = 1), true);
  begin
    select jsonb_build_object('existe', true, 'actif', j2.active, 'planning', j2.schedule) into v_cron from cron.job j2 where j2.jobname = 'cockpit-filet-securite';
  exception when others then v_cron := null;
  end;
  v_cible := cockpit.cible_reveil(pr.id);
  v_jeton := v_cible is not null and exists (select 1 from cockpit.reveils_immediats ri where ri.projet_id = v_cible and ri.actif);
  v_att := cockpit.filet_attente(pr.id);
  select * into j from cockpit.filet_reveils where projet_id = pr.id order by at desc limit 1;
  select count(*) into v_jour from cockpit.filet_reveils where projet_id = pr.id and at > now() - interval '24 hours';
  v_statut := case when cockpit.projet_de_test(pr.slug) then 'test'
                   when not v_glob then 'global_eteint'
                   when not pr.filet_actif then 'eteint'
                   when v_cron is null or not coalesce((v_cron ->> 'actif')::boolean, false) then 'cron_absent'
                   when not v_jeton then 'sans_jeton'
                   when v_jour >= pr.filet_plafond_jour then 'plafond'
                   else 'actif' end;
  return jsonb_build_object('statut', v_statut, 'projet_actif', pr.filet_actif, 'global_actif', v_glob, 'cron', v_cron,
    'plafond', pr.filet_plafond_jour, 'delai_min', pr.filet_delai_min, 'aujourdhui', v_jour, 'jeton', v_jeton,
    'dernier_at', j.at, 'dernier_pourquoi', j.pourquoi, 'attente', v_att, 'vivant', cockpit.filet_vivant(pr.id));
end $$;

-- ------------------------------------------------ 6. le cron (pg_cron : à installer une fois, visible dans cron.job)
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron non installable ici (%) : le filet ne tournera pas seul', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cockpit-filet-securite') then
      perform cron.unschedule('cockpit-filet-securite');
    end if;
    perform cron.schedule('cockpit-filet-securite', '*/3 * * * *', 'select cockpit.filet_passe()');
  end if;
end $$;

-- ------------------------------------------------ 7. droits (0004 : jamais EXECUTE à PUBLIC)
revoke all on function cockpit.filet_attente(uuid), cockpit.filet_vivant(uuid), cockpit.filet_passe(text, boolean, boolean),
  cockpit.regler_filet(text, boolean, int, int), cockpit.regler_filet_global(boolean), cockpit.etat_filet(text),
  cockpit.reveiller_chef(uuid, uuid, text) from public, anon, authenticated;
grant execute on function cockpit.filet_attente(uuid), cockpit.filet_vivant(uuid), cockpit.filet_passe(text, boolean, boolean),
  cockpit.reveiller_chef(uuid, uuid, text) to service_role;
grant execute on function cockpit.regler_filet(text, boolean, int, int), cockpit.regler_filet_global(boolean), cockpit.etat_filet(text)
  to authenticated, service_role;
