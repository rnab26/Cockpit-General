-- 0076 (6 oct. 2026, chantier a1d295d8 « Règle unique : 5 chantiers en attente = une session s'ouvre, tout seul »)
-- Raphaël (dit 4 fois) : « tout est automatique, pour tous les projets, sans réglage, sans dépendre de la chef. Une session = 5 agents
-- au plus ; quand elle est pleine une nouvelle s'ouvre ; chaque session finie se ferme seule ; ça continue tant que tout n'est pas traité ».
-- 1. REGROUPEMENT : les chantiers en attente sont répartis en paquets de `agents_par_renfort` (5 par défaut), TOUTES SECTIONS
--    CONFONDUES (avant : une session par section, donc 3 sessions pour 3 chantiers d'une seule unité). Un seul chantier suffit pour
--    ouvrir (aucun seuil). `renforts.chantier_ids` = le paquet confié à la session ; sans lui (anciens renforts) la règle par section
--    d'avant joue encore. Règle unique : `renfort_a(renfort, chantier)`.
-- 2. FAUX BESOIN (cause PROUVÉE sur FacePro, 6 oct. 17 h) : trois chantiers « en cours » dont l'agent était mort APRÈS avoir posé une
--    question à Raphaël comptaient comme « à traiter » (`chantier_abandonne`), donc la passe rouvrait trois sessions pour rien (~4 $ de
--    quota). Règle unique `attend_raphael(chantier)` : une question ou un geste ouvert, sans réponse ni retour, = on attend Raphaël ;
--    lue par `chantiers_prenables` et `verifs_prenables` (donc par la file, le filet, le réveil, la chef, le mode autonome).
-- 3. PAS DE BOUCLE : un renfort arrêté en moins de 5 min sans avoir fini compte comme un échec même s'il avait pris un chantier
--    (`renforts_pause`) ; et un chantier qu'un renfort a pris il y a moins de 30 min n'est pas redonné TOUT SEUL à un nouveau renfort
--    (`renfort_repris_recemment`, `delai_renfort_repris_min`).
-- Valeur par défaut : 5 agents par session. Idempotent ; schéma cockpit seulement ; aucune donnée supprimée.

alter table cockpit.renforts add column if not exists chantier_ids uuid[];
alter table cockpit.chefs alter column agents_par_renfort set default 5;
update cockpit.chefs set agents_par_renfort = 5 where agents_par_renfort = 3;

-- Une session vivante par section SEULEMENT pour les anciens renforts (sans paquet) ; les paquets s'additionnent.
drop index if exists cockpit.renforts_section_vivante;
create unique index if not exists renforts_section_vivante on cockpit.renforts (projet_id, coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where statut in ('demande', 'actif') and chantier_ids is null;

-- Règle : on attend Raphaël (question ou geste ouvert, ni répondu ni renvoyé à Claude).
create or replace function cockpit.attend_raphael(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp
as $$
  select exists (select 1 from cockpit.messages m
                  where m.chantier_id = c.id and m.kind in ('question', 'action')
                    and m.answered_at is null and m.retour_at is null);
$$;
revoke all on function cockpit.attend_raphael(cockpit.chantiers) from public, anon;
grant execute on function cockpit.attend_raphael(cockpit.chantiers) to authenticated, service_role;

create or replace function cockpit.delai_renfort_repris_min() returns int language sql immutable as $$ select 30 $$;
revoke all on function cockpit.delai_renfort_repris_min() from public, anon;
grant execute on function cockpit.delai_renfort_repris_min() to authenticated, service_role;

-- Un renfort a pris ce chantier il y a peu : pas redonné tout seul à un nouveau renfort.
create or replace function cockpit.renfort_repris_recemment(p_chantier uuid)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp
as $$
  select exists (select 1 from cockpit.messages m
                  where m.chantier_id = p_chantier and m.auteur_type = 'session' and m.kind = 'info' and m.auteur like 'renfort/%'
                    and (m.corps like 'Pris par un renfort%' or m.corps like 'Un renfort vérifie%')
                    and m.created_at > now() - make_interval(mins => cockpit.delai_renfort_repris_min()));
$$;
revoke all on function cockpit.renfort_repris_recemment(uuid) from public, anon;
grant execute on function cockpit.renfort_repris_recemment(uuid) to authenticated, service_role;

-- Règle : ce chantier est-il à ce renfort ? (paquet s'il en a un, sinon sa section comme avant)
create or replace function cockpit.renfort_a(r cockpit.renforts, c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp
as $$
  select case when r.chantier_ids is null then c.section_id is not distinct from r.section_id else c.id = any(r.chantier_ids) end;
$$;
revoke all on function cockpit.renfort_a(cockpit.renforts, cockpit.chantiers) from public, anon;
grant execute on function cockpit.renfort_a(cockpit.renforts, cockpit.chantiers) to authenticated, service_role;

CREATE OR REPLACE FUNCTION cockpit.chantiers_prenables(p_projet_id uuid, p_par text DEFAULT NULL::text)
 RETURNS SETOF cockpit.chantiers
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.doublon_de is null
     and ((c.etat in ('libre', 'a_trier')
           and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par)
           and not cockpit.livre_sans_suite(c))
          or cockpit.chantier_abandonne(c))
     and not cockpit.attend_raphael(c)
     and not exists (
       select 1 from cockpit.renforts r
        where r.projet_id = c.projet_id and cockpit.renfort_vivant(r)
          and cockpit.renfort_a(r, c)
          and coalesce(p_par, '') not like r.prefixe || '/%')
   order by (c.priorite = 'haute') desc, case c.etat when 'en_cours' then 0 when 'libre' then 1 else 2 end, c.created_at;
$function$;

CREATE OR REPLACE FUNCTION cockpit.verifs_prenables(p_projet_id uuid, p_par text DEFAULT NULL::text)
 RETURNS SETOF cockpit.chantiers
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.verif_demandee_at is not null
     and c.etat <> 'valide'
     and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par)
     and not cockpit.attend_raphael(c)
     and not exists (
       select 1 from cockpit.renforts r
        where r.projet_id = c.projet_id and cockpit.renfort_vivant(r)
          and cockpit.renfort_a(r, c)
          and c.verif_demandee_at > now() - make_interval(mins => cockpit.delai_verif_renfort_min())
          and coalesce(p_par, '') not like r.prefixe || '/%')
   order by c.verif_demandee_at;
$function$;

CREATE OR REPLACE FUNCTION cockpit.renfort_travail_restant(r cockpit.renforts)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  select cockpit.renfort_en_cours(r)
       + (select count(*)::int from cockpit.chantiers_prenables(r.projet_id, r.prefixe || '/') x where cockpit.renfort_a(r, x))
       + (select count(*)::int from cockpit.verifs_prenables(r.projet_id, r.prefixe || '/') v where cockpit.renfort_a(r, v));
$function$;

-- Les paquets : chantiers en attente (code + vérifications), vérifications d'abord, puis priorité haute, puis les plus anciens,
-- découpés par `p_taille` (5), toutes sections confondues. p_auto : l'ouverture automatique saute ce qu'un renfort vient de prendre.
create or replace function cockpit.paquets_attente(p_projet_id uuid, p_taille int, p_auto boolean default false)
returns table(rang int, n int, ids uuid[])
language sql stable security definer set search_path = cockpit, pg_temp
as $$
  with a0 as (
    select c.id as cid, 1 as ordre, (c.priorite = 'haute') as haute, c.created_at as cree from cockpit.chantiers_prenables(p_projet_id, null) c
    union all
    select v.id, 0, (v.priorite = 'haute'), v.created_at from cockpit.verifs_prenables(p_projet_id, null) v),
  a as (select cid, min(ordre) as ordre, bool_or(haute) as haute, min(cree) as cree from a0 group by cid),
  f as (select * from a where not p_auto or not cockpit.renfort_repris_recemment(cid)),
  n1 as (select cid, (row_number() over (order by ordre, haute desc, cree, cid) - 1)::int as pos from f),
  n2 as (select cid, pos, (pos / greatest(p_taille, 1))::int + 1 as paquet from n1)
  select paquet, count(*)::int, array_agg(cid order by pos) from n2 group by paquet order by paquet;
$$;
revoke all on function cockpit.paquets_attente(uuid, int, boolean) from public, anon;
grant execute on function cockpit.paquets_attente(uuid, int, boolean) to service_role, authenticated;

-- Seuil d'ouverture : UN chantier suffit, pour tous les projets (l'alerte « bientôt saturée » garde `seuil`).
CREATE OR REPLACE FUNCTION cockpit.file_renforts(p_projet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare ch cockpit.chefs; v_file int; v_seuil int; v_max int; v_vivants int; v_actif boolean; v_niveau text; v_bloque text;
begin
  select * into ch from cockpit.chefs where projet_id = p_projet_id;
  select coalesce(sum(a.n), 0)::int into v_file from cockpit.attente_par_section(p_projet_id) a;
  v_seuil := coalesce(ch.renforts_auto_seuil, ch.agents_par_renfort, 5);
  v_max := coalesce(ch.max_renforts, 2);
  v_actif := coalesce(ch.renforts_auto, true);
  select count(*)::int into v_vivants from cockpit.renforts r where r.projet_id = p_projet_id and r.statut in ('demande', 'actif') and cockpit.renfort_vivant(r);
  v_niveau := case when v_file >= 2 * v_seuil then 'sature' when v_file >= v_seuil then 'proche' end;
  v_bloque := case when not v_actif then 'eteint'
                   when v_max = 0 then 'reglage_zero'
                   when coalesce((cockpit.frein_actif(p_projet_id)->>'actif')::boolean, false) then 'frein'
                   when v_vivants >= v_max then 'plein' end;
  return jsonb_build_object('actif', v_actif, 'seuil', v_seuil, 'seuil_defaut', ch.renforts_auto_seuil is null, 'seuil_ouverture', 1,
    'file', v_file, 'niveau', v_niveau, 'bloque', v_bloque, 'vivants', v_vivants, 'max', v_max);
end $function$;

-- Ouverture automatique : un renfort par paquet de 5.
CREATE OR REPLACE FUNCTION cockpit.renforts_auto(p_projet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare f jsonb; ch cockpit.chefs; a record; v_id uuid; v_vivants int; v_max int; v_seuil int; v_agents int;
  crees jsonb := '[]'::jsonb; p jsonb; v_nom text; v_pauses jsonb := '[]'::jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  perform pg_advisory_xact_lock(hashtext('renforts_auto'), hashtext(p_projet_id::text));
  f := cockpit.file_renforts(p_projet_id);
  if (f->>'file')::int < (f->>'seuil_ouverture')::int or f->>'bloque' is not null then return jsonb_build_object('demandes', crees, 'raison', coalesce(f->>'bloque', 'file_courte')); end if;
  select * into ch from cockpit.chefs where projet_id = p_projet_id;
  select nom into v_nom from cockpit.projets where id = p_projet_id;
  v_agents := coalesce(ch.agents_par_renfort, 5);
  v_seuil := (f->>'seuil_ouverture')::int; v_vivants := (f->>'vivants')::int; v_max := (f->>'max')::int;
  p := cockpit.renforts_pause(p_projet_id, null);
  if coalesce((p->>'pause')::boolean, false) then
    v_pauses := v_pauses || jsonb_build_object('section', 'Paquets', 'jusqu_a', p->>'jusqu_a');
    if (select coalesce(c.renforts_pause_msg ->> 'paquet', '') from cockpit.chefs c where c.projet_id = p_projet_id) is distinct from (p->>'jusqu_a') then
      update cockpit.chefs set renforts_pause_msg = coalesce(renforts_pause_msg, '{}'::jsonb) || jsonb_build_object('paquet', p->>'jusqu_a') where projet_id = p_projet_id;
      insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
      values (p_projet_id, null, 'cockpit', 'session', 'info',
        format('Renfort %s : %s échec%s, en pause jusqu’à %s ; cause : %s',
               v_nom, p->>'echecs', case when (p->>'echecs')::int > 1 then 's' else '' end,
               to_char((p->>'jusqu_a')::timestamptz at time zone 'Asia/Jerusalem', 'HH24"h"MI'), left(p->>'cause', 160)));
    end if;
    return jsonb_build_object('demandes', crees, 'raison', 'pause', 'en_pause', v_pauses);
  end if;
  for a in select * from cockpit.paquets_attente(p_projet_id, v_agents, true) loop
    exit when v_vivants >= v_max;
    v_id := null;
    insert into cockpit.renforts (projet_id, section_id, prefixe, max_agents, chantiers, chantier_ids, origine, file_declenchement, seuil_declenchement)
    values (p_projet_id, null, 'renfort/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6), v_agents, a.n, a.ids, 'auto', (f->>'file')::int, v_seuil)
    returning id into v_id;
    v_vivants := v_vivants + 1;
    crees := crees || jsonb_build_object('id', v_id, 'section', 'Paquet de ' || a.n, 'chantiers', a.n);
  end loop;
  return jsonb_build_object('demandes', crees, 'raison', null, 'en_pause', v_pauses);
end $function$;

-- Le bouton « Lancer des renforts » : mêmes paquets (sans le délai de reprise).
CREATE OR REPLACE FUNCTION cockpit.demander_renforts(p_projet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr cockpit.projets; v_max int; v_agents int; v_vivants int; a record; v_id uuid;
  crees jsonb := '[]'::jsonb; v_attente int := 0;
begin
  pr := cockpit.renfort_projet(p_projet);
  perform pg_advisory_xact_lock(hashtext('renforts_auto'), hashtext(pr.id::text));
  select coalesce(max_renforts, 2), coalesce(agents_par_renfort, 5) into v_max, v_agents from cockpit.chefs where projet_id = pr.id;
  v_max := coalesce(v_max, 2); v_agents := coalesce(v_agents, 5);
  perform cockpit.renforts_expirer(pr.id);
  select count(*) into v_vivants from cockpit.renforts r where r.projet_id = pr.id and r.statut in ('demande', 'actif');
  for a in select * from cockpit.paquets_attente(pr.id, v_agents, false) loop
    v_attente := v_attente + 1;
    exit when v_vivants >= v_max;
    v_id := null;
    insert into cockpit.renforts (projet_id, section_id, prefixe, max_agents, chantiers, chantier_ids, demande_par)
    values (pr.id, null, 'renfort/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6), v_agents, a.n, a.ids, auth.uid())
    returning id into v_id;
    v_vivants := v_vivants + 1;
    crees := crees || jsonb_build_object('id', v_id, 'section', 'Paquet de ' || a.n, 'chantiers', a.n);
  end loop;
  return jsonb_build_object('demandes', crees, 'vivants', v_vivants, 'max', v_max, 'agents', v_agents,
    'raison', case when jsonb_array_length(crees) > 0 then null
                   when v_max = 0 then 'reglage_zero'
                   when v_attente = 0 then 'rien_en_attente'
                   else 'plein' end);
end $function$;

-- Le prochain pas d'un renfort : ses chantiers sont ceux de son paquet (ou de sa section pour un ancien renfort).
CREATE OR REPLACE FUNCTION cockpit.prochain_renfort(p_renfort uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
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
    -- 0046 : « Vérifie pour moi » PASSE AVANT le code (une vérification est courte et Raphaël l'attend).
    select v.* into c from cockpit.verifs_prenables(rf.projet_id, rf.prefixe || '/') v
     where cockpit.renfort_a(rf, v) limit 1;
    v_verif := c.id is not null;
    if c.id is null then
      select x.* into c from cockpit.chantiers_prenables(rf.projet_id, rf.prefixe || '/') x
       where cockpit.renfort_a(rf, x) limit 1;
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
end $function$;

-- Libellé d'un paquet à l'ouverture de sa session (la section d'un ancien renfort reste telle quelle).
CREATE OR REPLACE FUNCTION cockpit.renforts_a_ouvrir(p_projet text, p_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
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
    'ouvrir', coalesce((select jsonb_agg(jsonb_build_object('id', r.id,
                 'section', case when r.chantier_ids is not null then 'Paquet de ' || r.chantiers else coalesce(s.nom, 'Sans section') end,
                 'chantiers', r.chantiers, 'agents', r.max_agents, 'slug', pr.slug, 'depot', pr.depot) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.statut = 'demande' and r.session_distante is null and cockpit.renfort_vivant(r)), '[]'::jsonb),
    'archiver', case when not v_ferm then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'session', r.session_distante,
                 'section', case when r.chantier_ids is not null then 'Paquet de ' || r.chantiers else coalesce(s.nom, 'Sans section') end, 'statut', r.statut) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.session_distante is not null and r.archive_at is null
        and ((r.statut = 'fini' and coalesce(r.fini_at, r.vu_at, r.created_at) < now() - make_interval(mins => v_delai))
             or (r.statut = 'erreur' and r.erreur like 'Plus aucun signe%'))), '[]'::jsonb) end);
end $function$;

-- Échec rapide : arrêté en moins de 5 min sans avoir fini (même s'il avait pris un chantier) ; un renfort FINI avec du travail fait n'en est pas un.
CREATE OR REPLACE FUNCTION cockpit.renforts_pause(p_projet_id uuid, p_section_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  with s as (
    select r.id, r.created_at, r.erreur,
           ((r.faits = 0 or r.statut = 'erreur') and r.statut in ('erreur', 'fini', 'archive')
            and coalesce(r.fini_at, r.vu_at, r.created_at) - r.created_at < interval '5 minutes') as echec
      from cockpit.renforts r
     where r.projet_id = p_projet_id
       and (case when p_section_id is null then r.chantier_ids is not null or r.section_id is null else r.chantier_ids is null and r.section_id = p_section_id end)
       and r.statut <> 'demande' and r.statut <> 'actif'
       and r.created_at > now() - interval '24 hours'
  ),
  ord as (select *, row_number() over (order by created_at desc) as rn from s),
  suite as (  -- échecs consécutifs les plus récents (s'arrête au premier renfort qui n'a pas échoué)
    select count(*)::int as n from ord where rn < coalesce((select min(rn) from ord where not echec), 1000000) and echec),
  dernier as (select created_at, coalesce(erreur, 'arrêté en moins de 5 min sans travail') as cause from ord where echec order by rn limit 1)
  select case when (select n from suite) = 0 then jsonb_build_object('pause', false)
    else jsonb_build_object('pause', now() < d.created_at + case when (select n from suite) >= 2 then interval '3 hours' else interval '30 minutes' end,
           'echecs', (select n from suite), 'cause', d.cause,
           'jusqu_a', d.created_at + case when (select n from suite) >= 2 then interval '3 hours' else interval '30 minutes' end)
    end
  from (select 1) x left join dernier d on true;
$function$;

-- Écran : le libellé d'un paquet.
CREATE OR REPLACE FUNCTION cockpit.etat_renforts(p_projet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
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
    'agents_par_session', coalesce(ch.agents_par_renfort, 5),
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
        'id', r.id, 'section_id', r.section_id,
        'section', case when r.chantier_ids is not null then 'Paquet de ' || r.chantiers else coalesce(s.nom, 'Sans section') end, 'statut', r.statut,
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
end $function$;

-- Relancer un renfort en erreur : un paquet reprend ce qui reste de SON paquet ; un ancien renfort, sa section.
CREATE OR REPLACE FUNCTION cockpit.relancer_renfort(p_renfort uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare r cockpit.renforts; pr cockpit.projets; v_max int; v_vivants int; v_id uuid; v_n int; v_ids uuid[];
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
  if r.chantier_ids is not null then
    select array_agg(x.id), count(*)::int into v_ids, v_n
      from (select c.id from cockpit.chantiers_prenables(pr.id, null) c where c.id = any(r.chantier_ids)
            union select v.id from cockpit.verifs_prenables(pr.id, null) v where v.id = any(r.chantier_ids)) x;
    v_n := coalesce(v_n, 0);
  else
    select coalesce(sum(a.n), 0)::int into v_n from cockpit.attente_par_section(pr.id) a where a.section_id is not distinct from r.section_id;
  end if;
  if v_n = 0 then raise exception 'Plus rien n''attend dans ce paquet : rien à relancer.'; end if;
  -- l'ancienne ligne libère la section (index renforts_section_vivante) avant la nouvelle demande
  update cockpit.renforts set statut = 'erreur', erreur = coalesce(erreur, 'Relancé à la main.'), efface_at = now() where id = r.id;
  insert into cockpit.renforts (projet_id, section_id, prefixe, max_agents, chantiers, chantier_ids, demande_par)
  values (pr.id, r.section_id, 'renfort/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6), r.max_agents, v_n, v_ids, auth.uid())
  on conflict do nothing returning id into v_id;
  if v_id is null then raise exception 'Cette section a déjà un renfort en route.'; end if;
  return jsonb_build_object('id', v_id, 'chantiers', v_n);
end $function$;
