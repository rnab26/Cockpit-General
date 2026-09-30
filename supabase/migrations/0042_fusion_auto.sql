-- 0042 — Suggestion AUTOMATIQUE de fusion de chantiers (chantier 5b5900a9).
--
-- Raphaël (30 sept. 2026) : « Ce chantier est un doublon d'un nouveau chantier ;
-- la fusion n'a pas été faite automatiquement ni proposée ; c'est de la pollution
-- visuelle et du travail inutile […] je préfère qu'on me SUGGÈRE une fusion
-- automatique plutôt que de me laisser déduire. »
--
-- Avant : seule une SESSION pouvait suggérer (suggerer_fusion, à la main). Ici la
-- base le fait toute seule, par toutes les voies (app, session, module embarqué) :
--  - ressemblance_fusion(a, b) : LA règle, lisible, pas un devin. Deux mesures, on
--    garde la plus forte : (1) la similarité de trigrammes des SUJETS (préfixe de
--    rubrique retiré, comme chantiers_proches) ; (2) les mots significatifs communs
--    (>= 4 lettres, sans mots vides, sans « s » final) : s'il y en a au moins
--    2, part de communs sur le titre le plus court, x 0,9.
--    Un seul mot commun ne suffit jamais.
--  - projets.fusion_auto (oui) et projets.fusion_seuil (0,6) : réglables par projet.
--  - trigger sur chantiers (insert, ou titre modifié) : cherche LE chantier ouvert du
--    même projet qui ressemble le plus (>= seuil) et pose UNE carte 'fusion' « À toi ».
--    Le nouveau est la SOURCE (archivé si accepté), l'ancien la CIBLE (gardé).
--    Jamais : projet de test, chantier archivé/certifié/doublon, paire déjà proposée
--    (acceptée, refusée « Garder séparés » ou en attente, dans un sens ou l'autre).
--  - poser_carte_fusion : l'insertion de la carte, une seule fois, partagée avec
--    suggerer_fusion (session). Accepter = trancher_fusion -> fusionner_chantiers
--    (inchangés : le menu ⋯ « Fusionner avec… » de l'app passe aussi par lui).
-- Idempotente.

alter table cockpit.projets add column if not exists fusion_auto boolean not null default true;
alter table cockpit.projets add column if not exists fusion_seuil real not null default 0.65
  check (fusion_seuil between 0.3 and 1);
-- Défaut posé d'abord à 0,6 puis remonté à 0,65 (mesuré sur les vrais titres : 0,60 = « Alerte : une
-- session a besoin de renfort » vs « Ouverture de session et agents de renfort », un cousin, pas un doublon).
alter table cockpit.projets alter column fusion_seuil set default 0.65;
update cockpit.projets set fusion_seuil = 0.65 where fusion_seuil = 0.6;

-- Mots significatifs d'un titre (sujet, sans accents, sans mots vides, sans « s » final).
create or replace function cockpit.mots_fusion(p text)
returns text[] language sql immutable set search_path = cockpit, extensions, pg_temp as $$
  select coalesce(array_agg(distinct m), '{}')
  from (
    select case when length(w) > 4 and w like '%s' then left(w, length(w) - 1) else w end as m
    from regexp_split_to_table(regexp_replace(cockpit.sujet(p), '[^a-z0-9]+', ' ', 'g'), ' ') w
    where length(w) >= 4
      and w <> all (array['dans','avec','pour','sans','cette','leur','leurs','plus','tout','tous','toute','toutes',
                          'faire','fait','sont','etre','chantier','nouveau','nouvelle','depuis','entre',
                          'comme','aussi','mais','ainsi','apres','avant','sous','vers','chez'])
  ) t;
$$;

create or replace function cockpit.ressemblance_fusion(p_a text, p_b text)
returns real language plpgsql immutable set search_path = cockpit, extensions, pg_temp as $$
declare ma text[] := cockpit.mots_fusion(p_a); mb text[] := cockpit.mots_fusion(p_b);
  communs int; sim real; par_mots real := 0;
  mots_min constant int := 2;   -- un seul mot commun ne suffit jamais
begin
  sim := similarity(cockpit.sujet(p_a), cockpit.sujet(p_b));
  select count(*) into communs from unnest(ma) x where x = any (mb);
  if communs >= mots_min then
    par_mots := (communs::real / least(cardinality(ma), cardinality(mb))) * 0.9;
  end if;
  return greatest(sim, par_mots)::real;
end $$;

-- L'insertion de la carte (une seule fois pour la session et pour la base).
create or replace function cockpit.poser_carte_fusion(p_source uuid, p_cible uuid, p_pourquoi text, p_auteur text, p_type text)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid; ts text; tc text; v_id uuid := gen_random_uuid();
begin
  select projet_id, titre into v_projet, ts from cockpit.chantiers where id = p_source;
  select titre into tc from cockpit.chantiers where id = p_cible and projet_id = v_projet;
  if v_projet is null or tc is null or p_source = p_cible then return null; end if;
  -- Une seule carte par paire : en attente ou tranchée, dans un sens ou l'autre.
  if exists (select 1 from cockpit.messages where kind = 'fusion'
             and ((options->0->>'source' = p_source::text and options->0->>'cible' = p_cible::text)
               or (options->0->>'source' = p_cible::text and options->0->>'cible' = p_source::text))
             and (answered_at is null or reponse is not null)) then
    return null;
  end if;
  insert into cockpit.messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options)
  values (v_id, v_projet, p_cible, coalesce(p_auteur, 'cockpit'), p_type, 'fusion',
          '« ' || ts || ' » et « ' || tc || ' » semblent être le même sujet. Les fusionner ?',
          p_pourquoi,
          jsonb_build_array(jsonb_build_object('libelle', 'Fusionner', 'recommande', true, 'source', p_source, 'cible', p_cible,
                                               'aide', 'Tout « ' || ts || ' » passe dans « ' || tc || ' » ; rien ne se perd.'),
                            jsonb_build_object('libelle', 'Garder séparés', 'aide', 'Ce sont deux sujets différents.')));
  return v_id;
end $$;

create or replace function cockpit.suggerer_fusion(p_source uuid, p_cible uuid, p_pourquoi text, p_session text)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_source = p_cible then raise exception 'même chantier'; end if;
  select projet_id into v_projet from cockpit.chantiers where id = p_source;
  if v_projet is null or not exists (select 1 from cockpit.chantiers where id = p_cible and projet_id = v_projet) then
    raise exception 'les deux chantiers doivent exister dans le même projet';
  end if;
  return cockpit.poser_carte_fusion(p_source, p_cible, p_pourquoi, coalesce(p_session, 'session'), 'session');
end $$;

-- LA règle « quel chantier ouvert ressemble à celui-ci ? » ; renvoie l'id et le score, ou rien.
create or replace function cockpit.candidat_fusion(p_chantier uuid, p_mode_test boolean default false)
returns table (cible uuid, score real)
language sql stable security definer set search_path = cockpit, extensions, pg_temp as $$
  select o.id, cockpit.ressemblance_fusion(c.titre, o.titre) as sc
  from cockpit.chantiers c
  join cockpit.projets p on p.id = c.projet_id
  join cockpit.chantiers o on o.projet_id = c.projet_id and o.id <> c.id
  where c.id = p_chantier
    and p.fusion_auto and (p_mode_test or not cockpit.projet_de_test(p.slug))
    and c.archived_at is null and c.doublon_de is null and c.etat <> 'valide'
    and o.archived_at is null and o.doublon_de is null and o.etat <> 'valide'
    and cockpit.ressemblance_fusion(c.titre, o.titre) >= p.fusion_seuil
  order by sc desc, o.created_at asc
  limit 1;
$$;

-- Pose la carte pour un chantier (rend son id, ou null). p_mode_test : seuls les bancs l'utilisent,
-- pour prouver la règle dans un projet jetable ; le trigger l'appelle toujours à faux.
create or replace function cockpit.fusion_auto_pour(p_chantier uuid, p_mode_test boolean default false)
returns uuid language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
declare v record;
begin
  select * into v from cockpit.candidat_fusion(p_chantier, p_mode_test);
  if v.cible is null then return null; end if;
  return cockpit.poser_carte_fusion(p_chantier, v.cible,
    'Titres très proches (' || round(v.score::numeric * 100) || ' %). Garder les deux crée du travail en double.',
    'cockpit', 'session');
end $$;

create or replace function cockpit.trg_fusion_auto()
returns trigger language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
begin
  perform cockpit.fusion_auto_pour(new.id, false);
  return null;
end $$;

drop trigger if exists fusion_auto_insert on cockpit.chantiers;
create trigger fusion_auto_insert after insert on cockpit.chantiers
  for each row execute function cockpit.trg_fusion_auto();
drop trigger if exists fusion_auto_titre on cockpit.chantiers;
create trigger fusion_auto_titre after update of titre on cockpit.chantiers
  for each row when (old.titre is distinct from new.titre) execute function cockpit.trg_fusion_auto();

-- Réglage par projet (admin).
create or replace function cockpit.regler_fusion(p_slug text, p_auto boolean, p_seuil real default null)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_seuil is not null and (p_seuil < 0.3 or p_seuil > 1) then raise exception 'seuil entre 0,3 et 1'; end if;
  update cockpit.projets set fusion_auto = p_auto, fusion_seuil = coalesce(p_seuil, fusion_seuil) where slug = p_slug;
  if not found then raise exception 'projet inconnu : %', p_slug; end if;
end $$;

revoke all on function cockpit.mots_fusion(text), cockpit.ressemblance_fusion(text, text),
  cockpit.poser_carte_fusion(uuid, uuid, text, text, text), cockpit.candidat_fusion(uuid, boolean), cockpit.fusion_auto_pour(uuid, boolean),
  cockpit.trg_fusion_auto(), cockpit.regler_fusion(text, boolean, real) from public, anon, authenticated;
grant execute on function cockpit.mots_fusion(text), cockpit.ressemblance_fusion(text, text), cockpit.candidat_fusion(uuid, boolean), cockpit.fusion_auto_pour(uuid, boolean) to service_role;
grant execute on function cockpit.regler_fusion(text, boolean, real) to authenticated, service_role;
revoke all on function cockpit.suggerer_fusion(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function cockpit.suggerer_fusion(uuid, uuid, text, text) to service_role;
