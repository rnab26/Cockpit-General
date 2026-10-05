-- 0053 — Renforts : un frein d'usage ne les met plus en erreur ; les erreurs s'effacent (chantier 5dbbabba).
-- Raphaël (05/10, capture) : 4 lignes rouges « Jamais ouvert : la session chef n'est pas passée en 3 h » alors que
-- l'écran disait « Rien à faire ». Cause prouvée : un frein d'usage (chefs.frein_jusqu_a, 3 h) interdisait
-- toute ouverture ; la règle des 3 h de renfort_vivant a compté pendant le frein.
--   1. UNE règle : renfort_demande_depuis(r) = le début du délai de 3 h d'une demande = max(création, fin du frein).
--      Tant que le frein est actif, la demande reste vivante ; les 3 h ne comptent qu'à partir de sa levée.
--   2. L'erreur garde une date (erreur_at) ; une ligne en erreur s'efface seule après chefs.erreurs_efface_h h
--      (6 par défaut, 0 = jamais) ou d'un geste (effacer_erreurs_renforts) : colonne efface_at, AUCUNE suppression.
--   3. Une vraie erreur se relance (relancer_renfort) : nouvelle demande pour la même section.
-- Idempotente. renfort_vivant garde le délai « sans signe de vie » du projet (0046 : delai_signe).

alter table cockpit.renforts add column if not exists erreur_at timestamptz;
alter table cockpit.renforts add column if not exists efface_at timestamptz;
alter table cockpit.chefs add column if not exists erreurs_efface_h integer not null default 6;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chefs_erreurs_efface_h_valide') then
    alter table cockpit.chefs add constraint chefs_erreurs_efface_h_valide check (erreurs_efface_h between 0 and 168);
  end if;
end $$;

-- Les lignes déjà en erreur : on date leur erreur au plus tôt connu.
update cockpit.renforts set erreur_at = coalesce(fini_at, archive_at, vu_at, created_at) where statut = 'erreur' and erreur_at is null;

create or replace function cockpit.renforts_date_erreur()
returns trigger language plpgsql as $$
begin
  if new.statut = 'erreur' and (tg_op = 'INSERT' or old.statut is distinct from 'erreur') and new.erreur_at is null then new.erreur_at := now(); end if;
  return new;
end $$;
drop trigger if exists renforts_date_erreur on cockpit.renforts;
create trigger renforts_date_erreur before insert or update on cockpit.renforts for each row execute function cockpit.renforts_date_erreur();

-- Début du délai de 3 h d'une demande : la fin du frein si elle est plus tardive que la création.
create or replace function cockpit.renfort_demande_depuis(r cockpit.renforts)
returns timestamptz language sql stable security definer set search_path = cockpit, pg_temp as $$
  select greatest(r.created_at, coalesce((select c.frein_jusqu_a from cockpit.chefs c where c.projet_id = r.projet_id), r.created_at));
$$;

create or replace function cockpit.renfort_vivant(r cockpit.renforts)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select (r.statut = 'demande' and cockpit.renfort_demande_depuis(r) > now() - interval '3 hours')
      or (r.statut = 'actif' and coalesce(r.vu_at, r.created_at) > now() - interval '3 hours'
          and (coalesce(r.vu_at, r.created_at) > now() - cockpit.delai_signe(r.projet_id)
               or exists (select 1 from cockpit.chantiers c
                           where c.projet_id = r.projet_id and c.pris_par like r.prefixe || '/%'
                             and c.pris_jusqu_a > now() and c.archived_at is null
                             and not cockpit.sans_signe_de_vie(c))));
$$;

-- etat_renforts (0040) + frein_jusqu_a par demande en attente + erreurs masquées/effaçables.
create or replace function cockpit.etat_renforts(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; ch cockpit.chefs; v_relais uuid; v_vivante boolean; v_frein jsonb; v_h int;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  select * into ch from cockpit.chefs where projet_id = pr.id;
  v_vivante := cockpit.chef_vivante(pr.id);
  v_relais := case when v_vivante or cockpit.projet_de_test(pr.slug) then null else cockpit.chef_relais() end;
  v_frein := cockpit.frein_actif(pr.id);
  v_h := coalesce(ch.erreurs_efface_h, 6);
  return jsonb_build_object(
    'sessions_max', coalesce(ch.max_renforts, 2),
    'agents_par_session', coalesce(ch.agents_par_renfort, 3),
    'chef', v_vivante,
    'chef_vu_at', ch.vu_at,
    'projet', pr.nom,
    'relais', (select slug from cockpit.projets where id = v_relais),
    'relais_passage', case when v_relais is not null then cockpit.prochain_passage_chef(v_relais) end,
    'auto', cockpit.file_renforts(pr.id),
    'frein_jusqu_a', case when (v_frein->>'actif')::boolean then v_frein->>'jusqu_a' end,
    'erreurs_efface_h', v_h,
    'attente', coalesce((select jsonb_agg(jsonb_build_object('section_id', a.section_id, 'section', a.section, 'n', a.n, 'ids', a.ids))
                           from cockpit.attente_par_section(pr.id) a), '[]'::jsonb),
    'renforts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'section_id', r.section_id, 'section', coalesce(s.nom, 'Sans section'), 'statut', r.statut,
        'vivant', cockpit.renfort_vivant(r), 'session', r.session_distante, 'max_agents', r.max_agents,
        'chantiers', r.chantiers, 'faits', r.faits, 'en_cours', cockpit.renfort_en_cours(r), 'erreur', r.erreur,
        'origine', r.origine, 'file', r.file_declenchement, 'seuil', r.seuil_declenchement,
        'frein_jusqu_a', case when r.statut = 'demande' and (v_frein->>'actif')::boolean then v_frein->>'jusqu_a' end,
        'erreur_at', r.erreur_at,
        'created_at', r.created_at, 'vu_at', r.vu_at, 'fini_at', r.fini_at, 'archive_at', r.archive_at)
        order by r.created_at desc)
      from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
     where r.projet_id = pr.id and r.efface_at is null
       and not (r.statut = 'erreur' and v_h > 0 and coalesce(r.erreur_at, r.fini_at, r.archive_at, r.vu_at, r.created_at) < now() - make_interval(hours => v_h))
       and (r.statut in ('demande', 'actif') or coalesce(r.archive_at, r.fini_at, r.vu_at, r.created_at) > now() - interval '24 hours')), '[]'::jsonb));
end $$;

-- Le geste « Effacer les erreurs » : masque (efface_at), ne supprime rien.
create or replace function cockpit.effacer_erreurs_renforts(p_projet text)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; n int;
begin
  pr := cockpit.renfort_projet(p_projet);
  update cockpit.renforts r set efface_at = now()
   where r.projet_id = pr.id and r.efface_at is null
     and (r.statut = 'erreur' or (r.statut in ('demande', 'actif') and not cockpit.renfort_vivant(r)));
  get diagnostics n = row_count;
  return n;
end $$;

-- Délai d'effacement automatique des erreurs (heures ; 0 = jamais).
create or replace function cockpit.regler_renforts_erreurs(p_projet text, p_heures int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_heures is null or p_heures not between 0 and 168 then raise exception 'Effacement des erreurs : un nombre d''heures de 0 (jamais) à 168.'; end if;
  insert into cockpit.chefs (projet_id, erreurs_efface_h) values (pr.id, p_heures)
  on conflict (projet_id) do update set erreurs_efface_h = excluded.erreurs_efface_h;
  return jsonb_build_object('erreurs_efface_h', p_heures);
end $$;

-- « Relancer » une vraie erreur : une nouvelle demande pour la même section (l'ancienne ligne s'efface).
create or replace function cockpit.relancer_renfort(p_renfort uuid)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.renforts; pr cockpit.projets; v_max int; v_vivants int; v_id uuid; v_n int;
begin
  select * into r from cockpit.renforts where id = p_renfort;
  if r.id is null then raise exception 'Renfort introuvable.'; end if;
  select * into pr from cockpit.projets where id = r.projet_id;
  pr := cockpit.renfort_projet(pr.slug);
  if r.statut <> 'erreur' and not (r.statut in ('demande', 'actif') and not cockpit.renfort_vivant(r)) then raise exception 'Ce renfort n''est pas en erreur.'; end if;
  select coalesce(max_renforts, 2) into v_max from cockpit.chefs where projet_id = pr.id;
  v_max := coalesce(v_max, 2);
  select count(*) into v_vivants from cockpit.renforts x where x.projet_id = pr.id and x.statut in ('demande', 'actif') and cockpit.renfort_vivant(x);
  if v_vivants >= v_max then raise exception 'Déjà % renfort(s) en route (maximum %) : rien relancé.', v_vivants, v_max; end if;
  select coalesce(sum(a.n), 0)::int into v_n from cockpit.attente_par_section(pr.id) a where a.section_id is not distinct from r.section_id;
  if v_n = 0 then raise exception 'Plus rien n''attend dans cette section : rien à relancer.'; end if;
  -- l'ancienne ligne libère la section (index renforts_section_vivante) avant la nouvelle demande
  update cockpit.renforts set statut = 'erreur', erreur = coalesce(erreur, 'Relancé à la main.'), efface_at = now() where id = r.id;
  insert into cockpit.renforts (projet_id, section_id, prefixe, max_agents, chantiers, demande_par)
  values (pr.id, r.section_id, 'renfort/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6), r.max_agents, v_n, auth.uid())
  on conflict do nothing returning id into v_id;
  if v_id is null then raise exception 'Cette section a déjà un renfort en route.'; end if;
  return jsonb_build_object('id', v_id, 'chantiers', v_n);
end $$;

revoke all on function cockpit.renforts_date_erreur(), cockpit.renfort_demande_depuis(cockpit.renforts), cockpit.renfort_vivant(cockpit.renforts),
  cockpit.etat_renforts(text), cockpit.effacer_erreurs_renforts(text), cockpit.regler_renforts_erreurs(text, int), cockpit.relancer_renfort(uuid)
  from public, anon, authenticated;
grant execute on function cockpit.renfort_demande_depuis(cockpit.renforts), cockpit.renfort_vivant(cockpit.renforts) to service_role;
grant execute on function cockpit.etat_renforts(text), cockpit.effacer_erreurs_renforts(text), cockpit.regler_renforts_erreurs(text, int), cockpit.relancer_renfort(uuid) to authenticated, service_role;
