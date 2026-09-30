-- RENFORTS OUVERTS TOUT SEULS (30 sept. 2026, chantier 6faa9e7b).
--
-- Raphaël (30/09) : « la chef a 9 tâches en simultané mais n'a pas ouvert seule
-- de renforts » : depuis 0024 ils ne s'ouvraient que sur son toucher (bouton
-- « Lancer des renforts »). Désormais la passe de la chef (renforts_a_ouvrir)
-- en POSE d'elle-même quand la file de chantiers en attente atteint un seuil.
--
-- UNE seule règle, ici (file_renforts) ; l'écran la LIT (etat_renforts.auto) :
--   file   = chantiers qui attendent sans personne (attente_par_section : jamais
--            ce qui attend Raphaël, jamais une section déjà tenue par un renfort) ;
--   seuil  = chefs.renforts_auto_seuil, sinon agents_par_renfort (ce qu'une session
--            absorbe) ; file >= seuil = « bientôt saturée », >= 2 x seuil = « saturée » ;
--   ouvre  = auto allumée (défaut), renforts pas à 0, pas de frein, place libre
--            (max_renforts), UNE demande par section, la plus chargée d'abord,
--            tant que ce qui reste en file atteint encore le seuil ;
--   jamais un projet de test (renforts_a_ouvrir le garde déjà) ; jamais deux
--   renforts sur une section (index unique de 0024).
-- Chaque renfort porte son ORIGINE (manuel / auto) et la file + le seuil du
-- moment : l'écran dit « ouvert automatiquement à HH h MM parce que… ».
-- Rejouable. Ne modifie pas 0038 (chantier « sessions qui se ferment seules »,
-- qui redéfinit renforts_a_ouvrir) : la version d'ici en est le sur-ensemble.

alter table cockpit.chefs add column if not exists renforts_auto boolean not null default true;
alter table cockpit.chefs add column if not exists renforts_auto_seuil int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chefs_renforts_auto_seuil_borne') then
    alter table cockpit.chefs add constraint chefs_renforts_auto_seuil_borne check (renforts_auto_seuil is null or renforts_auto_seuil between 1 and 20);
  end if;
end $$;

alter table cockpit.renforts add column if not exists origine text not null default 'manuel';
alter table cockpit.renforts add column if not exists file_declenchement int;
alter table cockpit.renforts add column if not exists seuil_declenchement int;
alter table cockpit.renforts drop constraint if exists renforts_origine_check;
alter table cockpit.renforts add constraint renforts_origine_check check (origine in ('manuel', 'auto'));

-- LA règle, lue par la passe de la chef ET par l'écran (aucun calcul ailleurs).
-- bloque : pourquoi rien ne s'ouvrirait tout seul (eteint, reglage_zero, frein, plein) ; null = ça s'ouvre.
create or replace function cockpit.file_renforts(p_projet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare ch cockpit.chefs; v_file int; v_seuil int; v_max int; v_vivants int; v_actif boolean; v_niveau text; v_bloque text;
begin
  select * into ch from cockpit.chefs where projet_id = p_projet_id;
  select coalesce(sum(a.n), 0)::int into v_file from cockpit.attente_par_section(p_projet_id) a;
  v_seuil := coalesce(ch.renforts_auto_seuil, ch.agents_par_renfort, 3);
  v_max := coalesce(ch.max_renforts, 2);
  v_actif := coalesce(ch.renforts_auto, true);
  select count(*)::int into v_vivants from cockpit.renforts r where r.projet_id = p_projet_id and r.statut in ('demande', 'actif') and cockpit.renfort_vivant(r);
  v_niveau := case when v_file >= 2 * v_seuil then 'sature' when v_file >= v_seuil then 'proche' end;
  v_bloque := case when not v_actif then 'eteint'
                   when v_max = 0 then 'reglage_zero'
                   when coalesce((cockpit.frein_actif(p_projet_id)->>'actif')::boolean, false) then 'frein'
                   when v_vivants >= v_max then 'plein' end;
  return jsonb_build_object('actif', v_actif, 'seuil', v_seuil, 'seuil_defaut', ch.renforts_auto_seuil is null,
    'file', v_file, 'niveau', v_niveau, 'bloque', v_bloque, 'vivants', v_vivants, 'max', v_max);
end $$;

-- Pose les renforts qui s'imposent (appelée par la passe de la chef seulement).
create or replace function cockpit.renforts_auto(p_projet_id uuid)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare f jsonb; ch cockpit.chefs; a record; v_id uuid; v_reste int; v_vivants int; v_max int; v_seuil int; v_agents int;
  crees jsonb := '[]'::jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  f := cockpit.file_renforts(p_projet_id);
  if f->>'niveau' is null or f->>'bloque' is not null then return jsonb_build_object('demandes', crees, 'raison', coalesce(f->>'bloque', 'file_courte')); end if;
  select * into ch from cockpit.chefs where projet_id = p_projet_id;
  v_agents := coalesce(ch.agents_par_renfort, 3);
  v_reste := (f->>'file')::int; v_seuil := (f->>'seuil')::int; v_vivants := (f->>'vivants')::int; v_max := (f->>'max')::int;
  for a in select * from cockpit.attente_par_section(p_projet_id) loop
    exit when v_reste < v_seuil or v_vivants >= v_max;
    v_id := null;
    insert into cockpit.renforts (projet_id, section_id, prefixe, max_agents, chantiers, origine, file_declenchement, seuil_declenchement)
    values (p_projet_id, a.section_id, 'renfort/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6), v_agents, a.n, 'auto', (f->>'file')::int, v_seuil)
    on conflict do nothing returning id into v_id;
    continue when v_id is null;
    v_vivants := v_vivants + 1; v_reste := v_reste - a.n;
    crees := crees || jsonb_build_object('id', v_id, 'section', a.section, 'chantiers', a.n);
  end loop;
  return jsonb_build_object('demandes', crees, 'raison', null);
end $$;

-- Réglage visible dans l'app : allumer / éteindre, et le seuil (null = défaut : agents par session).
create or replace function cockpit.regler_renforts_auto(p_projet text, p_actif boolean, p_seuil int default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_actif is null then raise exception 'Ouverture automatique : allumée ou éteinte.'; end if;
  if p_seuil is not null and p_seuil not between 1 and 20 then raise exception 'Seuil de la file : un nombre de 1 à 20.'; end if;
  insert into cockpit.chefs (projet_id, renforts_auto, renforts_auto_seuil) values (pr.id, p_actif, p_seuil)
  on conflict (projet_id) do update set renforts_auto = excluded.renforts_auto, renforts_auto_seuil = excluded.renforts_auto_seuil;
  return cockpit.file_renforts(pr.id);
end $$;

-- etat_renforts (0028) + « auto » (la règle) + l'origine de chaque renfort.
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
    'auto', cockpit.file_renforts(pr.id),
    'attente', coalesce((select jsonb_agg(jsonb_build_object('section_id', a.section_id, 'section', a.section, 'n', a.n, 'ids', a.ids))
                           from cockpit.attente_par_section(pr.id) a), '[]'::jsonb),
    'renforts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'section_id', r.section_id, 'section', coalesce(s.nom, 'Sans section'), 'statut', r.statut,
        'vivant', cockpit.renfort_vivant(r), 'session', r.session_distante, 'max_agents', r.max_agents,
        'chantiers', r.chantiers, 'faits', r.faits, 'en_cours', cockpit.renfort_en_cours(r), 'erreur', r.erreur,
        'origine', r.origine, 'file', r.file_declenchement, 'seuil', r.seuil_declenchement,
        'created_at', r.created_at, 'vu_at', r.vu_at, 'fini_at', r.fini_at, 'archive_at', r.archive_at)
        order by r.created_at desc)
      from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
     where r.projet_id = pr.id
       and (r.statut in ('demande', 'actif') or coalesce(r.archive_at, r.fini_at, r.vu_at, r.created_at) > now() - interval '24 hours')), '[]'::jsonb));
end $$;

-- renforts_a_ouvrir (0024, puis 0038 « sessions qui se ferment seules » pour l'archivage) : la passe de la
-- chef pose d'abord les renforts que la file impose. Un projet de test n'en reçoit jamais (sauf p_test,
-- pour verifier-base). ATTENTION : cette version est le SUR-ENSEMBLE de celle de 0038 (fermeture_auto /
-- fermeture_delai_min lus par to_jsonb : marche avec ou sans 0038 appliquée). Rejouer 0038 APRÈS 0040 la
-- remplacerait par sa version sans ouverture automatique : rejouer 0040 ensuite.
create or replace function cockpit.renforts_a_ouvrir(p_projet text, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; v_ferm boolean; v_delai int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null or (cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false)) then
    return jsonb_build_object('ouvrir', '[]'::jsonb, 'archiver', '[]'::jsonb);
  end if;
  perform cockpit.renforts_expirer(pr.id);
  perform cockpit.renforts_auto(pr.id);
  v_ferm := coalesce((to_jsonb(pr) ->> 'fermeture_auto')::boolean, true);
  v_delai := coalesce((to_jsonb(pr) ->> 'fermeture_delai_min')::int, 0);
  return jsonb_build_object(
    'ouvrir', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'section', coalesce(s.nom, 'Sans section'),
                 'chantiers', r.chantiers, 'agents', r.max_agents, 'slug', pr.slug, 'depot', pr.depot) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.statut = 'demande' and r.session_distante is null and cockpit.renfort_vivant(r)), '[]'::jsonb),
    'archiver', case when not v_ferm then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'session', r.session_distante,
                 'section', coalesce(s.nom, 'Sans section'), 'statut', r.statut) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.session_distante is not null and r.archive_at is null
        and ((r.statut = 'fini' and coalesce(r.fini_at, r.vu_at, r.created_at) < now() - make_interval(mins => v_delai))
             or (r.statut = 'erreur' and r.erreur like 'Plus aucun signe%'))), '[]'::jsonb) end);
end $$;

revoke all on function cockpit.file_renforts(uuid), cockpit.renforts_auto(uuid), cockpit.regler_renforts_auto(text, boolean, int),
  cockpit.etat_renforts(text), cockpit.renforts_a_ouvrir(text, boolean) from public, anon, authenticated;
grant execute on function cockpit.file_renforts(uuid), cockpit.renforts_auto(uuid), cockpit.renforts_a_ouvrir(text, boolean) to service_role;
grant execute on function cockpit.regler_renforts_auto(text, boolean, int), cockpit.etat_renforts(text) to authenticated, service_role;
