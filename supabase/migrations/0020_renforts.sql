-- GROUPE DE RENFORT (29 sept. 2026) — BROUILLON, NON APPLIQUÉ : attend la
-- réponse de Raphaël (chantier 5b5900a9 « Ouverture de session et agents de
-- renfort »). Ne pas appliquer avant.
--
-- Raphaël : « plutôt que d'avoir plein de sessions visuellement, un groupe de
-- sessions renfort […] chacun va prendre les chantiers par section […] et se
-- ferme tout seul une fois que c'est fini ».
--
-- Principe : la chef d'un projet ouvre au plus `chefs.max_renforts` sessions
-- cloud (create_session : chacune a SON conteneur, donc sa machine). Un renfort
-- = UNE section du projet (section_id null = « sans section »). Il ne prend que
-- les chantiers de sa section (prochain_chantier_renfort), et plus personne
-- d'autre ne les prend tant qu'il vit (chantiers_prenables les exclut pour
-- toute branche qui n'est pas la sienne). Section vide → statut « fini » → la
-- chef l'archive (archive_session) et le note (renfort_archive).
create table if not exists cockpit.renforts (
  id               uuid primary key default gen_random_uuid(),
  projet_id        uuid not null references cockpit.projets (id) on delete cascade,
  section_id       uuid references cockpit.sections (id) on delete set null,
  prefixe          text not null,             -- branches du renfort : renfort/<court>/…
  session_distante text,                      -- session_… rendue par create_session
  statut           text not null default 'demande' check (statut in ('demande', 'actif', 'fini', 'archive')),
  faits            int not null default 0,
  created_at       timestamptz not null default now(),
  vu_at            timestamptz,
  fini_at          timestamptz,
  archive_at       timestamptz
);
-- Une section = au plus un renfort vivant.
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

-- 0 = pas de renfort (défaut : rien ne change tant que Raphaël ne l'allume pas).
alter table cockpit.chefs add column if not exists max_renforts int not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chefs_max_renforts_borne') then
    alter table cockpit.chefs add constraint chefs_max_renforts_borne check (max_renforts between 0 and 4);
  end if;
end $$;

-- Un renfort vivant : aucune AUTRE branche ne prend un chantier de sa section.
-- (Même corps que 0011, plus la dernière condition.)
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
        where r.projet_id = c.projet_id and r.statut in ('demande', 'actif')
          and r.section_id is not distinct from c.section_id
          and coalesce(p_par, '') not like r.prefixe || '%')
   order by (c.priorite = 'haute') desc, case c.etat when 'en_cours' then 0 when 'libre' then 1 else 2 end, c.created_at;
$$;

-- La chef demande les renforts qui manquent : une section qui a au moins
-- p_seuil chantiers prenables et aucun renfort vivant, la plus chargée d'abord.
create or replace function cockpit.ouvrir_renforts(p_projet text, p_seuil int default 2)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; v_max int; v_vivants int; r record; sortie jsonb := '[]'::jsonb; v_id uuid; v_pref text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null or not cockpit.autonome_actif(pr) then return sortie; end if;
  select coalesce(max_renforts, 0) into v_max from cockpit.chefs where projet_id = pr.id and actif;
  select count(*) into v_vivants from cockpit.renforts where projet_id = pr.id and statut in ('demande', 'actif');
  for r in
    select c.section_id, s.nom, count(*) as n
      from cockpit.chantiers_prenables(pr.id, null) c left join cockpit.sections s on s.id = c.section_id
     where c.etat = 'libre'
     group by 1, 2 having count(*) >= p_seuil order by count(*) desc
  loop
    exit when v_vivants >= coalesce(v_max, 0);
    v_pref := 'renfort/' || substr(md5(random()::text), 1, 6);
    insert into cockpit.renforts (projet_id, section_id, prefixe) values (pr.id, r.section_id, v_pref)
      on conflict do nothing returning id into v_id;
    continue when v_id is null;
    v_vivants := v_vivants + 1;
    sortie := sortie || jsonb_build_object('id', v_id, 'section', coalesce(r.nom, 'Sans section'), 'chantiers', r.n,
                                           'prefixe', v_pref, 'slug', pr.slug, 'depot', pr.depot);
  end loop;
  return sortie;
end $$;

-- La chef note la session créée (create_session) : le renfort devient actif.
create or replace function cockpit.renfort_session(p_renfort uuid, p_session text)
returns boolean language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts set session_distante = p_session, statut = 'actif', vu_at = now()
   where id = p_renfort and statut = 'demande' and cockpit.est_service() returning true;
$$;

-- Le renfort prend le chantier suivant DE SA SECTION, réservé à sa branche.
-- Plus rien → il passe « fini » (la chef l'archivera) et reçoit null.
create or replace function cockpit.prochain_chantier_renfort(p_renfort uuid)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare rf cockpit.renforts; c cockpit.chantiers; br text; pr cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into rf from cockpit.renforts where id = p_renfort for update;
  if rf.id is null or rf.statut not in ('demande', 'actif') then return null; end if;
  select * into pr from cockpit.projets where id = rf.projet_id;
  br := rf.prefixe || '/' || substr(md5(random()::text), 1, 6);
  select * into c from cockpit.chantiers_prenables(rf.projet_id, rf.prefixe)
   where section_id is not distinct from rf.section_id and etat in ('libre', 'en_cours') limit 1;
  if c.id is null or not cockpit.reserver_chantier(c.id, br, 180) then
    update cockpit.renforts set statut = 'fini', fini_at = now(), vu_at = now() where id = rf.id;
    return null;
  end if;
  update cockpit.renforts set faits = faits + 1, vu_at = now(), statut = 'actif' where id = rf.id;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (rf.projet_id, c.id, br, 'session', 'info', 'Pris par un renfort (session à part, même section).');
  return jsonb_build_object('id', c.id, 'titre', c.titre, 'etat_avant', c.etat, 'branche', br,
                            'slug', pr.slug, 'depot', pr.depot, 'demande', left(coalesce(c.demande, ''), 1500));
end $$;

-- La chef a archivé la session (archive_session) : on le note.
create or replace function cockpit.renfort_archive(p_renfort uuid)
returns boolean language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts set statut = 'archive', archive_at = now()
   where id = p_renfort and statut in ('fini', 'demande', 'actif') and cockpit.est_service() returning true;
$$;

revoke all on function cockpit.ouvrir_renforts(text, int), cockpit.renfort_session(uuid, text),
  cockpit.prochain_chantier_renfort(uuid), cockpit.renfort_archive(uuid) from public, anon, authenticated;
grant execute on function cockpit.ouvrir_renforts(text, int), cockpit.renfort_session(uuid, text),
  cockpit.prochain_chantier_renfort(uuid), cockpit.renfort_archive(uuid) to service_role;
