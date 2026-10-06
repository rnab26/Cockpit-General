-- 0068 — Renouvellement automatique de la session chef (chantier ffa0d2b2).
-- Raphaël : « un renouvellement automatique de la session chef lorsqu'une session atteint un
-- nombre de tokens élevé (500 000 me semble déjà trop pour une seule session) : elle finit ses
-- tâches en cours, on l'archive, et ça ouvre une nouvelle session chef, automatiquement. »
-- Mesure : les JETONS DU CONTEXTE de la session (input + cache lu + cache créé du dernier tour de
-- la session principale), relevés par hooks/suivi.sh dans le transcript. UNE règle :
-- cockpit.chef_a_renouveler(projet), lue par scripts/chef.sh et par l'écran.
-- Idempotente. Ne touche que le schéma cockpit.

alter table cockpit.sessions add column if not exists jetons bigint;
alter table cockpit.sessions add column if not exists jetons_at timestamptz;

alter table cockpit.chefs add column if not exists renouvellement_auto boolean not null default true;
alter table cockpit.chefs add column if not exists seuil_jetons int not null default 500000;
alter table cockpit.chefs add column if not exists renouvellement_demande_at timestamptz;
alter table cockpit.chefs add column if not exists renouvellement_session text;
alter table cockpit.chefs add column if not exists renouvellement_erreur text;
alter table cockpit.chefs drop constraint if exists chefs_seuil_jetons_check;
alter table cockpit.chefs add constraint chefs_seuil_jetons_check check (seuil_jetons = 0 or seuil_jetons between 50000 and 5000000);

-- Le hook de suivi relève les jetons du contexte de la session (service seulement).
create or replace function cockpit.signaler_jetons(p_projet text, p_session text, p_jetons bigint)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_jetons is null or p_jetons < 0 then return; end if;
  update cockpit.sessions s set jetons = p_jetons, jetons_at = now()
   where s.id = p_session and s.projet_id = (select id from cockpit.projets where slug = p_projet);
end $$;

-- LA règle : la chef du projet est-elle à renouveler ?
--  depasse   : ses jetons atteignent le seuil (réglage ON, seuil > 0, jamais un projet de test)
--  peut_ouvrir : depasse, aucun agent en cours, pas de demande depuis moins de 30 min
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
    v_ag := coalesce(cockpit.agents_actifs(c.session_id, pr.id), 0);
  end if;
  v_dep := c.projet_id is not null and c.actif and c.session_id is not null and c.renouvellement_auto
           and c.seuil_jetons > 0 and coalesce(s.jetons, 0) >= c.seuil_jetons;
  v_att := c.renouvellement_demande_at is not null and c.renouvellement_demande_at > now() - interval '30 minutes';
  return jsonb_build_object('auto', coalesce(c.renouvellement_auto, true), 'seuil', coalesce(c.seuil_jetons, 500000),
    'jetons', s.jetons, 'jetons_at', s.jetons_at, 'session', c.session_id, 'agents', v_ag,
    'depasse', coalesce(v_dep, false), 'peut_ouvrir', coalesce(v_dep, false) and v_ag = 0 and not v_att,
    'demande_at', c.renouvellement_demande_at, 'nouvelle_session', c.renouvellement_session, 'erreur', c.renouvellement_erreur);
end $$;

-- La chef note l'ouverture de sa remplaçante (ou son échec) ; une ligne dans le fil du projet.
create or replace function cockpit.renouvellement_note(p_projet text, p_nouvelle text, p_erreur text)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; c cockpit.chefs; v_j bigint;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  select * into c from cockpit.chefs where projet_id = pr.id;
  select jetons into v_j from cockpit.sessions where id = c.session_id;
  update cockpit.chefs set renouvellement_demande_at = now(),
         renouvellement_session = nullif(p_nouvelle, ''), renouvellement_erreur = nullif(left(coalesce(p_erreur, ''), 300), '')
   where projet_id = pr.id;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (pr.id, null, 'cockpit', 'session', 'info',
    case when nullif(p_erreur, '') is null
      then format('Session chef renouvelée : l’ancienne avait %s jetons (seuil %s), une nouvelle prend le relais.', coalesce(v_j::text, '?'), c.seuil_jetons)
      else format('Renouvellement de la session chef échoué (%s), nouvel essai dans 30 min.', left(p_erreur, 160)) end);
end $$;

create or replace function cockpit.regler_renouvellement(p_projet text, p_auto boolean, p_seuil int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_seuil is null or not (p_seuil = 0 or p_seuil between 50000 and 5000000) then
    raise exception 'Seuil de jetons : de 50 000 à 5 000 000 (0 = jamais).';
  end if;
  insert into cockpit.chefs (projet_id) values (pr.id) on conflict (projet_id) do nothing;
  update cockpit.chefs set renouvellement_auto = coalesce(p_auto, true), seuil_jetons = p_seuil where projet_id = pr.id;
  return cockpit.chef_a_renouveler(p_projet);
end $$;

create or replace function cockpit.etat_renouvellement(p_projet text)
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  select cockpit.chef_a_renouveler(p_projet);
$$;

revoke all on function cockpit.signaler_jetons(text, text, bigint), cockpit.chef_a_renouveler(text), cockpit.renouvellement_note(text, text, text),
  cockpit.regler_renouvellement(text, boolean, int), cockpit.etat_renouvellement(text) from public, anon, authenticated;
grant execute on function cockpit.signaler_jetons(text, text, bigint), cockpit.renouvellement_note(text, text, text) to service_role;
grant execute on function cockpit.chef_a_renouveler(text), cockpit.regler_renouvellement(text, boolean, int), cockpit.etat_renouvellement(text) to authenticated, service_role;
