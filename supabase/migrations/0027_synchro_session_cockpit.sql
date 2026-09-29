-- La session et le cockpit, deux portes sur les mêmes fils (29 sept. 2026,
-- chantiers 450afa9e « Chaque fil de chantier devient une vraie discussion »
-- et 58e0f05c « Les renforts lancés depuis le cockpit ne démarrent pas »).
--
-- Raphaël : « Le but du cockpit est de créer des chantiers et une ligne avec un
-- chat sur chaque sujet évoqué […] On aurait vraiment un chat par requête pour
-- le finir jusqu'au bout et le classer le plus efficacement possible, ou le
-- mettre de côté, l'abandonner ou le reporter. Il faut récupérer et téléverser
-- les infos le plus rapidement possible, voire en live […] » ; « on peut
-- utiliser peu importe soit le cockpit soit la session Claude ».
--
-- Ce que la base apporte (le côté session est dans les hooks) :
--  1. Mettre de côté / Reporter / Abandonner un chantier depuis son fil
--     (mettre_de_cote, abandonner_chantier) ; un report daté revient tout seul
--     dans « Prêt à lancer » à sa date (reveiller_reportes, appelé par la passe
--     de la chef et par l'app).
--  2. Projet SANS chef vivante : la chef « relais » (celle du cockpit si elle
--     vit, sinon la plus récemment vue) ouvre ses renforts et, s'il a des
--     messages sans réponse et aucune session vivante, ouvre UNE session de ce
--     projet (au plus une par heure) — jamais son travail à sa place
--     (chef_vivante, chef_relais, relais_a_servir, noter_ouverture).
--     etat_renforts dit si le projet a une chef VIVANTE et qui relaie ;
--     prochain_passage_chef retombe sur la chef relais.
--  3. Réveil immédiat de la chef quand Raphaël écrit : déclencheur API d'une
--     Routine Claude Code (POST …/routines/<trig>/fire, en-tête
--     anthropic-beta: experimental-cc-routine-2026-04-01 — doc « routines »
--     lue le 29 sept.). Le jeton est créé à la main par Raphaël sur claude.ai et
--     collé dans les réglages du projet : il va dans le coffre de Supabase
--     (Vault), jamais dans une table lisible ; seule reveiller_chef le lit.
--     pg_net envoie l'appel après la validation de la transaction. Au plus un
--     réveil toutes les 5 minutes par projet ; rien si une session vivante
--     tient déjà le chantier (hooks/suivi.sh le lui remet en 20 s). Sans jeton :
--     rien ne change (passage horaire, et l'app dit l'heure).
-- Idempotente.

-- ------------------------------------------------ 1. de côté, reporté, abandonné
alter table cockpit.chantiers add column if not exists reporte_jusqu_a timestamptz;

create or replace function cockpit.mettre_de_cote(p_id uuid, p_jusqu_a timestamptz default null, p_raison text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; v_texte text;
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé à l''admin du cockpit');
  if p_jusqu_a is not null and (p_jusqu_a <= now() or p_jusqu_a > now() + interval '1 year') then
    raise exception 'date de report : dans le futur, un an au plus';
  end if;
  update cockpit.chantiers set etat = 'reporte', reporte_jusqu_a = p_jusqu_a, pris_par = null, pris_jusqu_a = null, archived_at = null
   where id = p_id returning * into c;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  v_texte := case when p_jusqu_a is null then 'Mis de côté'
                  else 'Reporté au ' || to_char(p_jusqu_a at time zone 'Asia/Jerusalem', 'DD/MM') end
          || coalesce(' : ' || nullif(trim(p_raison), ''), '.');
  -- Un « constat » : il vient d'un bouton, il n'attend pas de réponse écrite (est_message_libre).
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (c.projet_id, c.id, 'Raphaël', 'proprietaire', 'constat', left(v_texte, 500));
  return jsonb_build_object('id', c.id, 'etat', c.etat, 'jusqu_a', c.reporte_jusqu_a);
end $$;

create or replace function cockpit.abandonner_chantier(p_id uuid, p_raison text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers;
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé à l''admin du cockpit');
  update cockpit.chantiers set etat = 'reporte', reporte_jusqu_a = null, pris_par = null, pris_jusqu_a = null, archived_at = now()
   where id = p_id returning * into c;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (c.projet_id, c.id, 'Raphaël', 'proprietaire', 'constat',
          left('Abandonné' || coalesce(' : ' || nullif(trim(p_raison), ''), '.'), 500));
  return jsonb_build_object('id', c.id, 'archived_at', c.archived_at);
end $$;

-- Un report daté dont la date est passée revient dans « Prêt à lancer ».
create or replace function cockpit.reveiller_reportes(p_projet_id uuid default null)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare n int;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin ou aux sessions');
  with revenus as (
    update cockpit.chantiers set etat = 'libre', reporte_jusqu_a = null
     where etat = 'reporte' and reporte_jusqu_a is not null and reporte_jusqu_a <= now() and archived_at is null
       and (p_projet_id is null or projet_id = p_projet_id)
    returning id, projet_id
  ), notes as (
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    select projet_id, id, 'cockpit', 'session', 'info', 'La date de report est arrivée : il revient dans « Prêt à lancer ».' from revenus
    returning 1
  )
  select count(*) into n from notes;
  return n;
end $$;

-- ------------------------------------------------ 2. chef vivante, chef relais
-- Une chef VIVANTE : notée active, et vue (passe ou signe de vie de sa session) depuis moins de 3 h.
create or replace function cockpit.chef_vivante(p_projet_id uuid)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.chefs c where c.projet_id = p_projet_id and c.actif and c.session_id is not null
     and (c.vu_at > now() - interval '3 hours'
          or exists (select 1 from cockpit.sessions s where s.id = c.session_id and s.fin_at is null and s.vu_at > now() - interval '3 hours')));
$$;

-- LA chef qui relaie pour les projets sans chef : celle du cockpit si elle vit,
-- sinon la chef vivante vue le plus récemment. Une seule : jamais deux relais.
create or replace function cockpit.chef_relais()
returns uuid language sql stable security definer set search_path = cockpit, pg_temp as $$
  select p.id from cockpit.projets p join cockpit.chefs c on c.projet_id = p.id
   where p.actif and not cockpit.projet_de_test(p.slug) and cockpit.chef_vivante(p.id)
   order by (p.slug = 'cockpit') desc, c.vu_at desc nulls last limit 1;
$$;

create table if not exists cockpit.ouvertures (
  id               uuid primary key default gen_random_uuid(),
  projet_id        uuid not null references cockpit.projets (id) on delete cascade,
  session_distante text,
  erreur           text,
  par_projet_id    uuid references cockpit.projets (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists ouvertures_projet_idx on cockpit.ouvertures (projet_id, created_at desc);
alter table cockpit.ouvertures enable row level security;
alter table cockpit.ouvertures replica identity full;
drop policy if exists admin_tout on cockpit.ouvertures;
create policy admin_tout on cockpit.ouvertures for all using (cockpit.est_admin()) with check (cockpit.est_admin());

-- Pour la passe de la chef RELAIS seulement (sinon vide) : les projets réels
-- sans chef vivante, leurs renforts à ouvrir/archiver, et s'il faut ouvrir UNE
-- session du projet (messages sans réponse, aucune session vivante, aucune
-- ouverture depuis 1 h). p_test : un projet de test précis (verifier-base).
create or replace function cockpit.relais_a_servir(p_chef_projet text, p_test text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_chef uuid; r jsonb := '[]'::jsonb; p record; v_renf jsonb; v_msg int; v_ouvrir boolean;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_chef from cockpit.projets where slug = p_chef_projet;
  if p_test is null and (v_chef is null or v_chef is distinct from cockpit.chef_relais()) then return r; end if;
  for p in select * from cockpit.projets x
            where x.actif and x.id is distinct from v_chef
              and (case when p_test is null then not cockpit.projet_de_test(x.slug) else x.slug = p_test end)
              and not cockpit.chef_vivante(x.id)
            order by x.slug loop
    v_renf := cockpit.renforts_a_ouvrir(p.slug, p_test is not null);
    select count(*) into v_msg from cockpit.messages_sans_reponse(p.id);
    v_ouvrir := v_msg > 0
      and not exists (select 1 from cockpit.sessions s where s.projet_id = p.id and s.fin_at is null and s.vu_at > now() - interval '30 minutes')
      and not exists (select 1 from cockpit.ouvertures o where o.projet_id = p.id and o.created_at > now() - interval '1 hour');
    continue when jsonb_array_length(v_renf -> 'ouvrir') = 0 and jsonb_array_length(v_renf -> 'archiver') = 0 and not v_ouvrir;
    r := r || jsonb_build_object('slug', p.slug, 'nom', p.nom, 'depot', p.depot, 'renforts', v_renf,
                                 'ouvrir_session', v_ouvrir, 'messages', v_msg);
  end loop;
  return r;
end $$;

-- La chef relais note la session ouverte (ou l'échec) : pas une deuxième avant 1 h.
create or replace function cockpit.noter_ouverture(p_projet text, p_session text, p_erreur text default null, p_par text default null)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_id uuid; v_p uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_p from cockpit.projets where slug = p_projet;
  if v_p is null then raise exception 'projet inconnu : %', p_projet; end if;
  insert into cockpit.ouvertures (projet_id, session_distante, erreur, par_projet_id)
  values (v_p, nullif(trim(coalesce(p_session, '')), ''), left(nullif(trim(coalesce(p_erreur, '')), ''), 300),
          (select id from cockpit.projets where slug = p_par))
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------ 3. réveil immédiat (routine /fire)
create table if not exists cockpit.reveils_immediats (
  projet_id         uuid primary key references cockpit.projets (id) on delete cascade,
  trigger_id        text not null check (trigger_id ~ '^trig_[A-Za-z0-9]+$'),
  secret_id         uuid not null,        -- vault.secrets : le jeton, jamais ailleurs
  actif             boolean not null default true,
  dernier_at        timestamptz,
  dernier_request   bigint,               -- net._http_response.id
  dernier_raison    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table cockpit.reveils_immediats enable row level security;
alter table cockpit.reveils_immediats replica identity full;
drop policy if exists admin_tout on cockpit.reveils_immediats;
create policy admin_tout on cockpit.reveils_immediats for all using (cockpit.est_admin()) with check (cockpit.est_admin());

-- Raphaël colle l'adresse (ou l'identifiant trig_…) et le jeton : le jeton va au coffre.
create or replace function cockpit.regler_reveil_immediat(p_projet text, p_adresse text, p_jeton text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_p uuid; v_trig text; v_jeton text := trim(coalesce(p_jeton, '')); r cockpit.reveils_immediats; v_secret uuid;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select id into v_p from cockpit.projets where slug = p_projet;
  if v_p is null then raise exception 'projet inconnu : %', p_projet; end if;
  v_trig := substring(trim(coalesce(p_adresse, '')) from '^(?:https://api\.anthropic\.com/v1/claude_code/routines/)?(trig_[A-Za-z0-9]+)(?:/fire)?/?$');
  if v_trig is null then raise exception 'adresse illisible : colle l''adresse de la routine (https://api.anthropic.com/v1/claude_code/routines/trig_…/fire)'; end if;
  if v_jeton !~ '^sk-ant-[A-Za-z0-9_-]{16,}$' then raise exception 'jeton illisible : il commence par sk-ant-'; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_p;
  if r.projet_id is not null and exists (select 1 from vault.secrets s where s.id = r.secret_id) then
    perform vault.update_secret(r.secret_id, v_jeton);
    v_secret := r.secret_id;
  else
    delete from vault.secrets where name = 'cockpit_reveil_' || v_p::text;
    v_secret := vault.create_secret(v_jeton, 'cockpit_reveil_' || v_p::text, 'Jeton du déclencheur API de la routine de réveil (cockpit, projet ' || p_projet || ')');
  end if;
  insert into cockpit.reveils_immediats (projet_id, trigger_id, secret_id, actif, updated_at)
  values (v_p, v_trig, v_secret, true, now())
  on conflict (projet_id) do update set trigger_id = excluded.trigger_id, secret_id = excluded.secret_id, actif = true, updated_at = now();
  return jsonb_build_object('projet', p_projet, 'trigger', v_trig);
end $$;

create or replace function cockpit.retirer_reveil_immediat(p_projet text)
returns boolean language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.reveils_immediats;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select ri.* into r from cockpit.reveils_immediats ri join cockpit.projets p on p.id = ri.projet_id where p.slug = p_projet;
  if r.projet_id is null then return false; end if;
  delete from vault.secrets where id = r.secret_id;
  delete from cockpit.reveils_immediats where projet_id = r.projet_id;
  return true;
end $$;

-- Ce que l'écran montre : réglé ou non, le dernier réveil et sa réponse (jamais le jeton).
create or replace function cockpit.etat_reveil_immediat(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare v_p uuid; r cockpit.reveils_immediats; h record;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select id into v_p from cockpit.projets where slug = p_projet;
  if v_p is null then return null; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_p;
  if r.dernier_request is not null then
    select status_code, error_msg, left(content, 400) as content, created into h from net._http_response where id = r.dernier_request;
  end if;
  return jsonb_build_object(
    'configure', r.projet_id is not null and r.actif,
    'trigger', r.trigger_id,
    'chef', cockpit.chef_vivante(v_p),
    'dernier_at', r.dernier_at,
    'dernier_raison', r.dernier_raison,
    'statut', h.status_code,
    'erreur', coalesce(h.error_msg, case when h.status_code >= 300 then left(h.content, 200) end),
    'session', case when h.status_code between 200 and 299 then (h.content::jsonb ->> 'claude_code_session_id') end);
exception when others then
  return jsonb_build_object('configure', r.projet_id is not null and r.actif, 'trigger', r.trigger_id, 'chef', cockpit.chef_vivante(v_p),
                            'dernier_at', r.dernier_at, 'dernier_raison', r.dernier_raison);
end $$;

-- LE RÉVEIL. Renvoie ce qui s'est passé (pour les tests et le journal) :
-- envoye | pas_configure | trop_tot | session_tient | aucune_chef.
create or replace function cockpit.reveiller_chef(p_projet_id uuid, p_chantier uuid default null, p_raison text default 'message')
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_slug text; v_cible uuid; r cockpit.reveils_immediats; v_jeton text; v_req bigint; v_cslug text;
begin
  select slug into v_slug from cockpit.projets where id = p_projet_id;
  if v_slug is null then return 'aucune_chef'; end if;
  -- Une session vivante tient le chantier : hooks/suivi.sh le lui remet (20 s), pas besoin de réveil.
  if p_chantier is not null and exists (
       select 1 from cockpit.chantiers c join cockpit.sessions s on s.projet_id = c.projet_id and s.branche = c.pris_par
        where c.id = p_chantier and c.pris_jusqu_a > now() and s.fin_at is null and s.vu_at > now() - interval '30 minutes') then
    return 'session_tient';
  end if;
  -- Qui réveiller : la chef du projet si elle vit, sinon la chef relais. Un projet de test : lui seul.
  v_cible := case when cockpit.projet_de_test(v_slug) or cockpit.chef_vivante(p_projet_id) then p_projet_id else cockpit.chef_relais() end;
  if v_cible is null then return 'aucune_chef'; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif for update skip locked;
  if r.projet_id is null then return 'pas_configure'; end if;
  if r.dernier_at > now() - interval '5 minutes' then return 'trop_tot'; end if;
  select decrypted_secret into v_jeton from vault.decrypted_secrets where id = r.secret_id;
  if v_jeton is null then return 'pas_configure'; end if;
  select slug into v_cslug from cockpit.projets where id = v_cible;
  v_req := net.http_post(
    url := 'https://api.anthropic.com/v1/claude_code/routines/' || r.trigger_id || '/fire',
    body := jsonb_build_object('text', format('Raphaël vient d''écrire dans le cockpit (projet %s, %s). Lance la passe de la chef du projet %s.', v_slug, p_raison, v_cslug)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_jeton, 'anthropic-beta', 'experimental-cc-routine-2026-04-01',
                                  'anthropic-version', '2023-06-01', 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
  update cockpit.reveils_immediats set dernier_at = now(), dernier_request = v_req, dernier_raison = left(v_slug || ' · ' || p_raison, 120)
   where projet_id = v_cible;
  return 'envoye';
end $$;

-- Les déclencheurs : un message de Raphaël, une réponse de sa part, une demande de renforts.
-- Jamais d'échec de son geste à cause du réveil : toute erreur est avalée.
create or replace function cockpit.reveil_sur_message()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  begin
    if tg_op = 'INSERT' and new.auteur_type = 'proprietaire' and (cockpit.est_message_libre(new) or coalesce(new.ou_en_est, false)) then
      perform cockpit.reveiller_chef(new.projet_id, new.chantier_id, 'message');
    elsif tg_op = 'UPDATE' and old.answered_at is null and new.answered_at is not null and new.answered_by is not null then
      perform cockpit.reveiller_chef(new.projet_id, new.chantier_id, 'réponse');
    end if;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists reveil_sur_message on cockpit.messages;
create trigger reveil_sur_message after insert or update of answered_at on cockpit.messages
  for each row execute function cockpit.reveil_sur_message();

create or replace function cockpit.reveil_sur_renfort()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  begin perform cockpit.reveiller_chef(new.projet_id, null, 'renforts'); exception when others then null; end;
  return null;
end $$;
drop trigger if exists reveil_sur_renfort on cockpit.renforts;
create trigger reveil_sur_renfort after insert on cockpit.renforts
  for each row execute function cockpit.reveil_sur_renfort();

-- ------------------------------------------------ l'app : prochain passage, renforts
-- Le prochain passage de Claude pour un projet : sa chef si elle vit, sinon la
-- chef relais ; un réveil immédiat parti depuis moins de 10 min → dans ~3 min.
create or replace function cockpit.prochain_passage_chef(p_projet_id uuid)
returns timestamptz language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare v_cible uuid; c cockpit.chefs; v_h timestamptz; r cockpit.reveils_immediats;
begin
  if not (cockpit.est_service() or cockpit.est_membre(p_projet_id)) then return null; end if;
  v_cible := case when cockpit.chef_vivante(p_projet_id) then p_projet_id else cockpit.chef_relais() end;
  if v_cible is null then return null; end if;
  select * into c from cockpit.chefs where projet_id = v_cible;
  if c.reveil_minute is not null and c.actif and c.session_id is not null and c.reveil_trigger is not null then
    v_h := date_trunc('hour', now()) + make_interval(mins => c.reveil_minute);
    if v_h <= now() then v_h := v_h + interval '1 hour'; end if;
  end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif;
  if r.dernier_at > now() - interval '10 minutes' then
    return least(coalesce(v_h, 'infinity'::timestamptz), r.dernier_at + interval '3 minutes');
  end if;
  return v_h;
end $$;

-- etat_renforts (0024) : « chef » veut dire désormais une chef VIVANTE ; + qui relaie.
create or replace function cockpit.etat_renforts(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; ch cockpit.chefs; v_relais uuid; v_vivante boolean;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  select * into ch from cockpit.chefs where projet_id = pr.id;
  v_vivante := cockpit.chef_vivante(pr.id);
  v_relais := case when v_vivante or cockpit.projet_de_test(pr.slug) then null else cockpit.chef_relais() end;
  return jsonb_build_object(
    'sessions_max', coalesce(ch.max_renforts, 2),
    'agents_par_session', coalesce(ch.agents_par_renfort, 3),
    'chef', v_vivante,
    'chef_vu_at', ch.vu_at,
    'projet', pr.nom,
    'relais', (select slug from cockpit.projets where id = v_relais),
    'relais_passage', case when v_relais is not null then cockpit.prochain_passage_chef(v_relais) end,
    'attente', coalesce((select jsonb_agg(jsonb_build_object('section_id', a.section_id, 'section', a.section, 'n', a.n, 'ids', a.ids))
                           from cockpit.attente_par_section(pr.id) a), '[]'::jsonb),
    'renforts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'section_id', r.section_id, 'section', coalesce(s.nom, 'Sans section'), 'statut', r.statut,
        'vivant', cockpit.renfort_vivant(r), 'session', r.session_distante, 'max_agents', r.max_agents,
        'chantiers', r.chantiers, 'faits', r.faits, 'en_cours', cockpit.renfort_en_cours(r), 'erreur', r.erreur,
        'created_at', r.created_at, 'vu_at', r.vu_at, 'fini_at', r.fini_at, 'archive_at', r.archive_at)
        order by r.created_at desc)
      from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
     where r.projet_id = pr.id
       and (r.statut in ('demande', 'actif') or coalesce(r.archive_at, r.fini_at, r.vu_at, r.created_at) > now() - interval '24 hours')), '[]'::jsonb));
end $$;

-- 0024 : « Jamais ouvert : la session chef n'est pas passée en 3 h. » reste vrai
-- (la chef relais compte comme chef) ; rien à changer à renforts_expirer.

-- ------------------------------------------------ droits
revoke all on function cockpit.mettre_de_cote(uuid, timestamptz, text), cockpit.abandonner_chantier(uuid, text),
  cockpit.reveiller_reportes(uuid), cockpit.chef_vivante(uuid), cockpit.chef_relais(), cockpit.relais_a_servir(text, text),
  cockpit.noter_ouverture(text, text, text, text), cockpit.regler_reveil_immediat(text, text, text),
  cockpit.retirer_reveil_immediat(text), cockpit.etat_reveil_immediat(text), cockpit.reveiller_chef(uuid, uuid, text),
  cockpit.reveil_sur_message(), cockpit.reveil_sur_renfort(), cockpit.prochain_passage_chef(uuid), cockpit.etat_renforts(text)
  from public, anon, authenticated;
grant execute on function cockpit.mettre_de_cote(uuid, timestamptz, text), cockpit.abandonner_chantier(uuid, text),
  cockpit.reveiller_reportes(uuid), cockpit.regler_reveil_immediat(text, text, text), cockpit.retirer_reveil_immediat(text),
  cockpit.etat_reveil_immediat(text), cockpit.prochain_passage_chef(uuid), cockpit.etat_renforts(text) to authenticated, service_role;
grant execute on function cockpit.chef_vivante(uuid), cockpit.chef_relais(), cockpit.relais_a_servir(text, text),
  cockpit.noter_ouverture(text, text, text, text), cockpit.reveiller_chef(uuid, uuid, text) to service_role;
