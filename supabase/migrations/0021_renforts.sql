-- RENFORTS (29 sept. 2026, chantiers 5b5900a9 « Ouverture de session et agents
-- de renfort » et 6a69c7b4 « Bouton lancer une session autonome » — D-10).
--
-- Raphaël (29/09 13:24) : « visible et bien distincte de tout le reste
-- au-dessus de tous les chantiers qui sont abandonnés ou à l'arrêt ou libres
-- […] lancer une session par secteur, que ça les sectorise et les réunisse
-- automatiquement, et mettre plusieurs agents dedans en même temps. 5 maximum
-- par session sinon ça coûte trop cher […]. La règle pour ce genre de session :
-- ne jamais se marcher dessus, c'est une condition pour pouvoir travailler. »
--
-- Principe :
--   - un clic dans l'app (admin) → demander_renforts(slug) pose UNE DEMANDE par
--     section qui a des chantiers en attente (libres, pas triés, abandonnés,
--     « vérifie pour moi »), dans la limite du réglage (chefs.max_renforts, 0 à 4) ;
--   - l'app ne peut pas créer de session : la session CHEF du projet lit les
--     demandes (renforts_a_ouvrir, via scripts/chef.sh), crée une session cloud
--     par demande (create_session), la note (renfort_session) ;
--   - le renfort ne prend QUE les chantiers de sa section (prochain_renfort),
--     jusqu'à chefs.agents_par_renfort agents à la fois (1 à 5) ; personne
--     d'autre ne prend un chantier de cette section tant qu'il vit
--     (chantiers_prenables et la passe de la chef l'excluent) ;
--   - section vide et plus rien en cours → « fini » ; la chef archive la session
--     (archive_session, accord donné par Raphaël : « se ferme tout seul une fois
--     que c'est fini ») et le note (renfort_archive).
-- Les projets de test (slug test-…) ne sont jamais servis à une chef
-- (renforts_a_ouvrir) : aucune vraie session n'est ouverte pour eux.
create table if not exists cockpit.renforts (
  id               uuid primary key default gen_random_uuid(),
  projet_id        uuid not null references cockpit.projets (id) on delete cascade,
  section_id       uuid references cockpit.sections (id) on delete set null,
  prefixe          text not null,             -- branches du renfort : renfort/<court>/…
  session_distante text,                      -- session_… rendue par create_session
  statut           text not null default 'demande',
  max_agents       int not null default 3,
  chantiers        int not null default 0,    -- en attente dans la section au moment de la demande
  faits            int not null default 0,    -- chantiers pris par le renfort
  erreur           text,
  demande_par      uuid,
  created_at       timestamptz not null default now(),
  vu_at            timestamptz,
  fini_at          timestamptz,
  archive_at       timestamptz
);
alter table cockpit.renforts add column if not exists max_agents int not null default 3;
alter table cockpit.renforts add column if not exists chantiers int not null default 0;
alter table cockpit.renforts add column if not exists erreur text;
alter table cockpit.renforts add column if not exists demande_par uuid;
alter table cockpit.renforts drop constraint if exists renforts_statut_check;
alter table cockpit.renforts add constraint renforts_statut_check check (statut in ('demande', 'actif', 'fini', 'archive', 'erreur'));
alter table cockpit.renforts drop constraint if exists renforts_max_agents_check;
alter table cockpit.renforts add constraint renforts_max_agents_check check (max_agents between 1 and 5);
-- Une section = au plus un renfort vivant (demandé ou actif).
create unique index if not exists renforts_section_vivante
  on cockpit.renforts (projet_id, coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where statut in ('demande', 'actif');
alter table cockpit.renforts enable row level security;
alter table cockpit.renforts replica identity full;
drop policy if exists admin_tout on cockpit.renforts;
create policy admin_tout on cockpit.renforts for all using (cockpit.est_admin()) with check (cockpit.est_admin());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cockpit' and tablename = 'renforts') then
    execute 'alter publication supabase_realtime add table cockpit.renforts';
  end if;
end $$;

-- Réglages, par projet (ligne de chefs créée si besoin, sans chef) :
-- sessions renfort au plus (0 = aucune), agents par session (1 à 5).
alter table cockpit.chefs add column if not exists max_renforts int not null default 2;
alter table cockpit.chefs add column if not exists agents_par_renfort int not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chefs_max_renforts_borne') then
    alter table cockpit.chefs add constraint chefs_max_renforts_borne check (max_renforts between 0 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chefs_agents_par_renfort_borne') then
    alter table cockpit.chefs add constraint chefs_agents_par_renfort_borne check (agents_par_renfort between 1 and 5);
  end if;
end $$;

-- Un renfort « tient » sa section : demandé depuis moins de 3 h (la chef ne
-- l'a pas encore ouvert), ou actif avec un signe de vie depuis moins de 3 h
-- (au-delà, sa session est morte : la section est rendue aux autres).
create or replace function cockpit.renfort_vivant(r cockpit.renforts)
returns boolean language sql stable as $$
  select (r.statut = 'demande' and r.created_at > now() - interval '3 hours')
      or (r.statut = 'actif' and coalesce(r.vu_at, r.created_at) > now() - interval '3 hours');
$$;

-- Les chantiers d'un renfort : ceux que ses branches tiennent et qui avancent
-- (en cours, réservation valide, aucune question ouverte : une question attend
-- Raphaël, elle n'occupe plus une place d'agent).
create or replace function cockpit.renfort_en_cours(r cockpit.renforts)
returns int language sql stable security definer set search_path = cockpit, pg_temp as $$
  select count(*)::int from cockpit.chantiers c
   where c.projet_id = r.projet_id and c.pris_par like r.prefixe || '/%' and c.pris_jusqu_a > now()
     and c.archived_at is null and c.etat in ('en_cours', 'a_verifier')
     and (c.etat = 'en_cours' or c.verif_demandee_at is not null)
     and not exists (select 1 from cockpit.messages m where m.chantier_id = c.id
                      and m.kind in ('question', 'action') and m.answered_at is null);
$$;

-- Même corps que 0011, plus la section d'un renfort vivant : aucune AUTRE
-- branche n'y prend quoi que ce soit.
create or replace function cockpit.chantiers_prenables(p_projet_id uuid, p_par text default null)
returns setof cockpit.chantiers language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.doublon_de is null
     and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par)
     and (c.etat in ('libre', 'a_trier')
          or (c.etat = 'en_cours'
              and c.updated_at < now() - interval '60 minutes'
              and not exists (
                select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
                   and a.updated_at > now() - interval '30 minutes')
              and not exists (
                select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                   and t.vu_at > now() - interval '30 minutes')
              and not exists (
                select 1 from cockpit.sessions se
                 where se.projet_id = c.projet_id and se.fin_at is null and se.vu_at > now() - interval '30 minutes'
                   and se.branche is not null
                   and (se.branche = c.pris_par
                        or se.branche = (select a.session from cockpit.activite a where a.chantier_id = c.id
                                          order by a.updated_at desc limit 1)))))
     and not exists (
       select 1 from cockpit.renforts r
        where r.projet_id = c.projet_id and cockpit.renfort_vivant(r)
          and r.section_id is not distinct from c.section_id
          and coalesce(p_par, '') not like r.prefixe || '/%')
   order by (c.priorite = 'haute') desc, case c.etat when 'en_cours' then 0 when 'libre' then 1 else 2 end, c.created_at;
$$;

-- « Vérifie pour moi » (0016) qu'aucune branche ne tient, hors section d'un
-- AUTRE renfort : la même règle pour la passe de la chef et pour un renfort.
create or replace function cockpit.verifs_prenables(p_projet_id uuid, p_par text default null)
returns setof cockpit.chantiers language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.verif_demandee_at is not null
     and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par)
     and not exists (
       select 1 from cockpit.renforts r
        where r.projet_id = c.projet_id and cockpit.renfort_vivant(r)
          and r.section_id is not distinct from c.section_id
          and coalesce(p_par, '') not like r.prefixe || '/%')
   order by c.verif_demandee_at;
$$;

-- Ce qui attend, par section, hors sections déjà tenues par un renfort.
create or replace function cockpit.attente_par_section(p_projet_id uuid)
returns table (section_id uuid, section text, rang int, n int, ids uuid[])
language sql stable security definer set search_path = cockpit, pg_temp as $$
  with attente as (
    select c.id, c.section_id, c.created_at from cockpit.chantiers_prenables(p_projet_id, null) c
    union
    select v.id, v.section_id, v.created_at from cockpit.verifs_prenables(p_projet_id, null) v
  )
  select a.section_id, coalesce(s.nom, 'Sans section'), coalesce(s.position, 1000000), count(*)::int,
         array_agg(a.id order by a.created_at)
    from attente a left join cockpit.sections s on s.id = a.section_id
   group by a.section_id, s.nom, s.position
   order by count(*) desc, coalesce(s.position, 1000000), coalesce(s.nom, 'Sans section');
$$;

-- Le garde commun : l'app (admin) ou une session (service).
create or replace function cockpit.renfort_projet(p_projet text)
returns cockpit.projets language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return pr;
end $$;

-- Réglages visibles dans l'app : sessions renfort au plus (0 à 4), agents par session (1 à 5).
create or replace function cockpit.regler_renforts(p_projet text, p_sessions int, p_agents int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_sessions is null or p_sessions not between 0 and 4 then raise exception 'Sessions de renfort : un nombre de 0 à 4.'; end if;
  if p_agents is null or p_agents not between 1 and 5 then raise exception 'Agents par session : un nombre de 1 à 5.'; end if;
  insert into cockpit.chefs (projet_id, max_renforts, agents_par_renfort) values (pr.id, p_sessions, p_agents)
  on conflict (projet_id) do update set max_renforts = excluded.max_renforts, agents_par_renfort = excluded.agents_par_renfort;
  return jsonb_build_object('sessions', p_sessions, 'agents', p_agents);
end $$;

-- Tout ce que l'écran montre, calculé ici (une seule règle) : réglages, chef,
-- ce qui attend par section, et les renforts (vivants, ou finis depuis 24 h).
create or replace function cockpit.etat_renforts(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; ch cockpit.chefs;
begin
  pr := cockpit.renfort_projet(p_projet);
  select * into ch from cockpit.chefs where projet_id = pr.id;
  return jsonb_build_object(
    'sessions_max', coalesce(ch.max_renforts, 2),
    'agents_par_session', coalesce(ch.agents_par_renfort, 3),
    'chef', ch.actif is true and ch.session_id is not null,
    'chef_vu_at', ch.vu_at,
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

-- Un renfort mort (plus de signe de vie depuis 3 h) ne tient plus sa section :
-- il passe en erreur, visible dans l'app (et la chef archive sa session).
create or replace function cockpit.renforts_expirer(p_projet_id uuid)
returns void language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts r set statut = 'erreur', erreur = coalesce(r.erreur,
           case r.statut when 'demande' then 'Jamais ouvert : la session chef n’est pas passée en 3 h.'
                         else 'Plus aucun signe de vie depuis 3 h : session arrêtée ?' end)
   where r.projet_id = p_projet_id and r.statut in ('demande', 'actif') and not cockpit.renfort_vivant(r);
$$;

-- LE BOUTON : une demande par section en attente, la plus chargée d'abord,
-- dans la limite du réglage. Renvoie ce qui a été demandé, ou pourquoi rien.
create or replace function cockpit.demander_renforts(p_projet text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; v_max int; v_agents int; v_vivants int; a record; v_id uuid; v_pref text;
  crees jsonb := '[]'::jsonb; v_attente int := 0;
begin
  pr := cockpit.renfort_projet(p_projet);
  select coalesce(max_renforts, 2), coalesce(agents_par_renfort, 3) into v_max, v_agents from cockpit.chefs where projet_id = pr.id;
  v_max := coalesce(v_max, 2); v_agents := coalesce(v_agents, 3);
  perform cockpit.renforts_expirer(pr.id);
  select count(*) into v_vivants from cockpit.renforts r where r.projet_id = pr.id and r.statut in ('demande', 'actif');
  for a in select * from cockpit.attente_par_section(pr.id) loop
    v_attente := v_attente + 1;
    exit when v_vivants >= v_max;
    v_pref := 'renfort/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    v_id := null;
    insert into cockpit.renforts (projet_id, section_id, prefixe, max_agents, chantiers, demande_par)
    values (pr.id, a.section_id, v_pref, v_agents, a.n, auth.uid())
    on conflict do nothing returning id into v_id;
    continue when v_id is null;
    v_vivants := v_vivants + 1;
    crees := crees || jsonb_build_object('id', v_id, 'section', a.section, 'chantiers', a.n);
  end loop;
  return jsonb_build_object('demandes', crees, 'vivants', v_vivants, 'max', v_max, 'agents', v_agents,
    'raison', case when jsonb_array_length(crees) > 0 then null
                   when v_max = 0 then 'reglage_zero'
                   when v_attente = 0 then 'rien_en_attente'
                   else 'plein' end);
end $$;

-- La chef : les demandes à ouvrir et les renforts finis à archiver, de SON
-- projet. Jamais pour un projet de test (sauf p_test, pour verifier-base).
create or replace function cockpit.renforts_a_ouvrir(p_projet text, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null or (cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false)) then
    return jsonb_build_object('ouvrir', '[]'::jsonb, 'archiver', '[]'::jsonb);
  end if;
  perform cockpit.renforts_expirer(pr.id);
  return jsonb_build_object(
    'ouvrir', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'section', coalesce(s.nom, 'Sans section'),
                 'chantiers', r.chantiers, 'agents', r.max_agents, 'slug', pr.slug, 'depot', pr.depot) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.statut = 'demande' and r.session_distante is null and cockpit.renfort_vivant(r)), '[]'::jsonb),
    'archiver', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'session', r.session_distante,
                 'section', coalesce(s.nom, 'Sans section'), 'statut', r.statut) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.session_distante is not null and r.archive_at is null
        and (r.statut = 'fini' or (r.statut = 'erreur' and r.erreur like 'Plus aucun signe%'))), '[]'::jsonb));
end $$;

-- La chef note la session créée (create_session) : le renfort devient actif.
create or replace function cockpit.renfort_session(p_renfort uuid, p_session text)
returns boolean language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts set session_distante = p_session, statut = 'actif', vu_at = now()
   where id = p_renfort and statut = 'demande' and nullif(trim(p_session), '') is not null
     and cockpit.est_service() returning true;
$$;

-- La chef n'a pas pu ouvrir (create_session a échoué…) : l'erreur se VOIT dans l'app.
create or replace function cockpit.renfort_erreur(p_renfort uuid, p_texte text)
returns boolean language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts set statut = 'erreur', erreur = left(coalesce(nullif(trim(p_texte), ''), 'Erreur sans détail'), 300), vu_at = now()
   where id = p_renfort and statut in ('demande', 'actif') and cockpit.est_service() returning true;
$$;

-- LE RENFORT : les chantiers suivants DE SA SECTION, autant que de places
-- d'agent libres (max_agents − ceux qui avancent), chacun réservé à sa propre
-- branche <prefixe>/<court>. Rien de nouveau :
--   - « attends » s'il a encore des chantiers en cours (ses agents travaillent) ;
--   - « fini » sinon : la chef archivera la session.
create or replace function cockpit.prochain_renfort(p_renfort uuid)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare rf cockpit.renforts; c cockpit.chantiers; br text; pr cockpit.projets; places int; en_cours int;
  donnes jsonb := '[]'::jsonb; v_etat text; v_verif boolean;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into rf from cockpit.renforts where id = p_renfort for update;
  if rf.id is null or rf.statut not in ('demande', 'actif') then
    return jsonb_build_object('etat', 'fini', 'chantiers', donnes, 'en_cours', 0, 'raison', 'renfort fermé');
  end if;
  select * into pr from cockpit.projets where id = rf.projet_id;
  en_cours := cockpit.renfort_en_cours(rf);
  places := rf.max_agents - en_cours;
  while places > 0 loop
    select x.* into c from cockpit.chantiers_prenables(rf.projet_id, rf.prefixe || '/') x
     where x.section_id is not distinct from rf.section_id limit 1;
    v_verif := false;
    if c.id is null then
      select v.* into c from cockpit.verifs_prenables(rf.projet_id, rf.prefixe || '/') v
       where v.section_id is not distinct from rf.section_id limit 1;
      v_verif := c.id is not null;
    end if;
    exit when c.id is null;
    v_etat := c.etat;
    br := rf.prefixe || '/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    exit when not cockpit.reserver_chantier(c.id, br, case when v_verif then 60 else 180 end);
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (rf.projet_id, c.id, br, 'session', 'info',
            case when v_verif then 'Un renfort vérifie pour toi (session à part, même section).'
                 else 'Pris par un renfort (session à part, même section).' end);
    donnes := donnes || jsonb_build_object('id', c.id, 'titre', c.titre, 'etat_avant', v_etat, 'branche', br,
      'verif', v_verif, 'comment', c.comment_verifier,
      'apporte', case when v_verif then (select string_agg(m.corps, chr(10) || '---' || chr(10) order by m.created_at)
                   from cockpit.messages m where m.chantier_id = c.id and m.auteur_type in ('proprietaire', 'utilisateur')
                    and m.created_at >= c.verif_demandee_at - interval '1 minute') end,
      'demande', left(coalesce(c.demande, ''), 1500));
    places := places - 1;
    c := null;
  end loop;
  update cockpit.renforts set faits = faits + jsonb_array_length(donnes), vu_at = now(), statut = 'actif' where id = rf.id;
  if jsonb_array_length(donnes) = 0 and en_cours = 0 then
    update cockpit.renforts set statut = 'fini', fini_at = now() where id = rf.id;
    return jsonb_build_object('etat', 'fini', 'chantiers', donnes, 'en_cours', 0, 'slug', pr.slug, 'depot', pr.depot);
  end if;
  return jsonb_build_object('etat', case when jsonb_array_length(donnes) > 0 then 'chantiers' else 'attends' end,
    'chantiers', donnes, 'en_cours', en_cours, 'max_agents', rf.max_agents, 'slug', pr.slug, 'depot', pr.depot);
end $$;

-- La chef a archivé la session (archive_session) : on le note.
create or replace function cockpit.renfort_archive(p_renfort uuid)
returns boolean language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts set statut = case when statut = 'erreur' then 'erreur' else 'archive' end, archive_at = now()
   where id = p_renfort and statut in ('fini', 'demande', 'actif', 'erreur') and archive_at is null
     and cockpit.est_service() returning true;
$$;

-- Le brouillon non appliqué (0020 sur agent/646460) avait ces noms : jamais en base.
drop function if exists cockpit.ouvrir_renforts(text, int);
drop function if exists cockpit.prochain_chantier_renfort(uuid);

revoke all on function cockpit.renfort_vivant(cockpit.renforts), cockpit.renfort_en_cours(cockpit.renforts), cockpit.renforts_expirer(uuid),
  cockpit.verifs_prenables(uuid, text), cockpit.attente_par_section(uuid), cockpit.renfort_projet(text),
  cockpit.regler_renforts(text, int, int), cockpit.etat_renforts(text), cockpit.demander_renforts(text),
  cockpit.renforts_a_ouvrir(text, boolean), cockpit.renfort_session(uuid, text), cockpit.renfort_erreur(uuid, text),
  cockpit.prochain_renfort(uuid), cockpit.renfort_archive(uuid), cockpit.chantiers_prenables(uuid, text)
  from public, anon, authenticated;
grant execute on function cockpit.renfort_vivant(cockpit.renforts), cockpit.renfort_en_cours(cockpit.renforts), cockpit.renforts_expirer(uuid),
  cockpit.verifs_prenables(uuid, text), cockpit.attente_par_section(uuid), cockpit.renfort_projet(text),
  cockpit.regler_renforts(text, int, int), cockpit.etat_renforts(text), cockpit.demander_renforts(text),
  cockpit.renforts_a_ouvrir(text, boolean), cockpit.renfort_session(uuid, text), cockpit.renfort_erreur(uuid, text),
  cockpit.prochain_renfort(uuid), cockpit.renfort_archive(uuid), cockpit.chantiers_prenables(uuid, text)
  to service_role;
-- L'app (admin) : l'écran, le bouton, les réglages. Chacune vérifie est_admin
-- elle-même (renfort_projet) ; un simple membre reçoit « réservé à l'admin ».
grant execute on function cockpit.regler_renforts(text, int, int), cockpit.etat_renforts(text),
  cockpit.demander_renforts(text) to authenticated;
