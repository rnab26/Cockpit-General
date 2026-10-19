-- 0104 (19 oct. 2026, chantier a33cf882). Raphaël : « La règle vivant par rapport à un signe de vie de 60 minutes, c'est moi qui l'ai mise,
-- mais c'est faux. Il faut que ça se cale sur le fait que la session soit réellement vivante […] Sur FacePro, des choses progressent par des
-- agents ou des calculs en arrière-plan (CPU) : la session n'est pas en mode actif mais le travail avance. »
--
-- CAUSE (mesurée le 19 oct. 17 h UTC) : « vivant » = « vu depuis moins de delai_signe » (60 min), deux erreurs à la fois. (1) Une session qui ne
-- fait QUE surveiller un calcul ou un agent en arrière-plan ne déclenche aucun signe entre deux appels d'outils : elle devient « muette » alors
-- que le travail avance (FacePro : « rejeu de la vidéo seuil 8 % en cours (~35 min) », aucun signe depuis 14 h 42 UTC). (2) Inversement, une
-- session ouverte puis morte reste « vivante » 60 min (0103 l'a réduit à « un signe après l'ouverture », sans changer le principe).
--
-- UNE règle, `cockpit.etat_session(session)`, trois états lisibles (le délai de 60 min n'en est plus que le REPLI) :
--   au_travail     (a) un tour est en cours ET le battement des hooks est récent (tour_silence_min : le battement part toutes les 45 s et
--                      s'arrête après 11 min sans événement) ; OU (b) une tâche d'arrière-plan de la session est « en cours » avec une preuve
--                      propre dans le plafond (fond_plafond_min : étape signalée, ou vue en cours par Claude Code à l'arrêt du tour), OU un
--                      calcul réel mesuré sur la machine (battement machine, ci-dessous : machine_fraicheur_min) ; OU (c) elle vient de
--                      s'ouvrir (reveil_ecart_min, déjà la règle « un réveil est parti, elle arrive »).
--   en_veille      ouverte (un signe après son ouverture, vue depuis moins du repli), rien ne tourne : elle attend ton message.
--   sans_nouvelles elle devait travailler (un tour ou une tâche en cours, ou jamais le moindre signe depuis son ouverture) et plus rien ne le
--                  prouve, depuis moins du repli. Au-delà du repli, sans preuve : 'absente' (plus affichée, plus comptée).
-- delai_sans_signe_min (60) reste le REPLI : combien de temps une session muette reste affichée. Il ne décide plus « vivant » à lui seul.
--
-- BATTEMENT MACHINE (mesure, ÉTEINT par défaut : projets.machine_actif) : un petit processus détaché, lancé par le hook de suivi, mesure le
-- temps CPU des descendants du processus Claude (/proc) et le remonte par `signaler_machine` tant qu'un calcul tourne. Sans jetons.
-- Aucune règle d'autres fonctions n'est touchée (réveils, filet, chantiers_prenables, sans_signe_de_vie gardent delai_signe seul).

alter table cockpit.projets
  add column if not exists tour_silence_min integer not null default 12,
  add column if not exists fond_plafond_min integer not null default 120,
  add column if not exists machine_actif boolean not null default false,
  add column if not exists machine_fraicheur_min integer not null default 6,
  add column if not exists machine_seuil_pct integer not null default 5,
  add column if not exists machine_pas_s integer not null default 120;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projets_tour_silence_borne') then
    alter table cockpit.projets add constraint projets_tour_silence_borne check (tour_silence_min between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projets_fond_plafond_borne') then
    alter table cockpit.projets add constraint projets_fond_plafond_borne check (fond_plafond_min between 1 and 1440);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projets_machine_fraicheur_borne') then
    alter table cockpit.projets add constraint projets_machine_fraicheur_borne check (machine_fraicheur_min between 2 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projets_machine_seuil_borne') then
    alter table cockpit.projets add constraint projets_machine_seuil_borne check (machine_seuil_pct between 1 and 400);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projets_machine_pas_borne') then
    alter table cockpit.projets add constraint projets_machine_pas_borne check (machine_pas_s between 30 and 600);
  end if;
end $$;

alter table cockpit.sessions
  add column if not exists machine_vu_at timestamptz,
  add column if not exists machine_actif_at timestamptz,
  add column if not exists machine_cpu_pct integer,
  add column if not exists machine_procs integer;

-- LA règle. Pure lecture de la ligne de session, de ses tâches et des réglages du projet : aucun seuil écrit ici.
create or replace function cockpit.etat_session(s cockpit.sessions)
returns text language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; devait boolean;
begin
  if s.fin_at is not null then return 'fermee'; end if;
  select * into pr from cockpit.projets where id = s.projet_id;
  if pr.id is null then return 'absente'; end if;
  -- (c) elle vient de s'ouvrir
  if s.demarre_at > now() - make_interval(mins => coalesce(pr.reveil_ecart_min, 5)) then return 'au_travail'; end if;
  -- (a) un tour est en cours et le battement est récent
  if s.tour_en_cours and s.vu_at > now() - make_interval(mins => pr.tour_silence_min) then return 'au_travail'; end if;
  -- (b) un calcul réel mesuré sur la machine, ou une tâche d'arrière-plan en cours avec une preuve propre dans le plafond
  if s.machine_actif_at is not null and s.machine_actif_at > now() - make_interval(mins => pr.machine_fraicheur_min) then return 'au_travail'; end if;
  if exists (select 1 from cockpit.taches t where t.session_id = s.id and t.statut = 'en_cours'
              and greatest(t.progres_at, t.vu_at) > now() - make_interval(mins => pr.fond_plafond_min)) then return 'au_travail'; end if;
  -- plus aucune preuve : au-delà du repli (delai_sans_signe_min) elle n'est plus affichée du tout
  if s.vu_at <= now() - cockpit.delai_signe(pr.id) then return 'absente'; end if;
  devait := s.tour_en_cours or s.vu_at <= s.demarre_at
            or exists (select 1 from cockpit.taches t where t.session_id = s.id and t.statut = 'en_cours');
  return case when devait then 'sans_nouvelles' else 'en_veille' end;
end $$;

-- Combien de sessions du projet dans chaque état (une seule lecture de la règle).
create or replace function cockpit.sessions_par_etat(p_projet uuid)
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  select jsonb_build_object(
    'au_travail', count(*) filter (where e = 'au_travail'),
    'en_veille', count(*) filter (where e = 'en_veille'),
    'sans_nouvelles', count(*) filter (where e = 'sans_nouvelles'))
  from (select cockpit.etat_session(s) as e from cockpit.sessions s where s.projet_id = p_projet and s.fin_at is null) x;
$$;

-- Ouvertes = au travail + en veille : c'est le sens de « vivantes » du voyant (0102) et du refus d'activer_session (0103), inchangé.
create or replace function cockpit.sessions_ouvertes(p_projet uuid)
returns integer language sql stable security definer set search_path = cockpit, pg_temp as $$
  select (coalesce((cockpit.sessions_par_etat(p_projet)->>'au_travail')::int, 0) + coalesce((cockpit.sessions_par_etat(p_projet)->>'en_veille')::int, 0));
$$;

-- 0103 gardait ce nom pour « ouvertes » ; il désigne maintenant ce qu'il dit : les sessions réellement AU TRAVAIL.
create or replace function cockpit.sessions_au_travail(p_projet uuid)
returns integer language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce((cockpit.sessions_par_etat(p_projet)->>'au_travail')::int, 0);
$$;

revoke all on function cockpit.etat_session(cockpit.sessions), cockpit.sessions_par_etat(uuid), cockpit.sessions_ouvertes(uuid), cockpit.sessions_au_travail(uuid) from public, anon;
grant execute on function cockpit.etat_session(cockpit.sessions), cockpit.sessions_par_etat(uuid), cockpit.sessions_ouvertes(uuid), cockpit.sessions_au_travail(uuid) to authenticated, service_role;

-- Les deux lecteurs : définitions en vigueur, quelques lignes remplacées (rejouable).
do $$
declare d text;
begin
  d := pg_get_functiondef('cockpit.etat_sessions(text)'::regprocedure);
  if d not like '%sessions_ouvertes%' then
    d := replace(d, E'\'vivantes\', cockpit.sessions_au_travail(pr.id),',
                    E'\'vivantes\', cockpit.sessions_ouvertes(pr.id),\n    \'etats\', cockpit.sessions_par_etat(pr.id),');
    if d not like '%sessions_ouvertes%' then raise exception 'etat_sessions : le point de remplacement n''a pas été trouvé'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('cockpit.activer_session(text)'::regprocedure);
  if d not like '%sessions_ouvertes%' then
    d := replace(d, 'cockpit.sessions_au_travail(pr.id) > 0', 'cockpit.sessions_ouvertes(pr.id) > 0');
    if d not like '%sessions_ouvertes%' then raise exception 'activer_session : le point de remplacement n''a pas été trouvé'; end if;
    execute d;
  end if;
end $$;

-- Réglage (admin depuis l'app, service depuis un script) : les seuils de la règle, jamais en dur ailleurs.
create or replace function cockpit.regler_travail_reel(p_projet text, p_tour_min int, p_fond_min int, p_machine boolean, p_machine_min int, p_seuil_pct int, p_pas_s int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_tour_min is null or p_tour_min not between 1 and 120 then raise exception 'Battement d''un tour : de 1 à 120 minutes.'; end if;
  if p_fond_min is null or p_fond_min not between 1 and 1440 then raise exception 'Preuve d''une tâche en arrière-plan : de 1 à 1440 minutes.'; end if;
  if p_machine_min is null or p_machine_min not between 2 and 60 then raise exception 'Calcul récent : de 2 à 60 minutes.'; end if;
  if p_seuil_pct is null or p_seuil_pct not between 1 and 400 then raise exception 'Seuil de calcul : de 1 à 400 %%.'; end if;
  if p_pas_s is null or p_pas_s not between 30 and 600 then raise exception 'Mesure de la machine : toutes les 30 à 600 secondes.'; end if;
  if p_machine_min * 60 < 2 * p_pas_s then raise exception 'Calcul récent : au moins deux mesures (% s) tiennent dans % min.', p_pas_s, p_machine_min; end if;
  update cockpit.projets set tour_silence_min = p_tour_min, fond_plafond_min = p_fond_min, machine_actif = coalesce(p_machine, false),
         machine_fraicheur_min = p_machine_min, machine_seuil_pct = p_seuil_pct, machine_pas_s = p_pas_s where id = pr.id;
  return jsonb_build_object('tour_silence_min', p_tour_min, 'fond_plafond_min', p_fond_min, 'machine_actif', coalesce(p_machine, false),
    'machine_fraicheur_min', p_machine_min, 'machine_seuil_pct', p_seuil_pct, 'machine_pas_s', p_pas_s);
end $$;

-- Le battement machine : la session dit « mes processus enfants ont consommé N % de CPU sur la dernière mesure ». Réservé aux sessions.
-- Rend le pas de mesure du projet (la session s'y plie sans changer de hook) ou « eteint » (le processus s'arrête seul).
create or replace function cockpit.signaler_machine(p_projet text, p_session text, p_cpu_pct integer, p_procs integer)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return jsonb_build_object('etat', 'inconnu'); end if;
  if not pr.machine_actif then return jsonb_build_object('etat', 'eteint'); end if;
  update cockpit.sessions
     set machine_vu_at = now(), machine_cpu_pct = greatest(p_cpu_pct, 0), machine_procs = greatest(p_procs, 0),
         machine_actif_at = case when coalesce(p_cpu_pct, 0) >= pr.machine_seuil_pct and coalesce(p_procs, 0) > 0 then now() else machine_actif_at end
   where id = p_session and projet_id = pr.id and fin_at is null;
  if not found then return jsonb_build_object('etat', 'session_inconnue'); end if;
  return jsonb_build_object('etat', 'ok', 'pas_s', pr.machine_pas_s);
end $$;

revoke all on function cockpit.regler_travail_reel(text, int, int, boolean, int, int, int), cockpit.signaler_machine(text, text, integer, integer) from public, anon, authenticated;
grant execute on function cockpit.regler_travail_reel(text, int, int, boolean, int, int, int) to authenticated, service_role;
grant execute on function cockpit.signaler_machine(text, text, integer, integer) to service_role;
