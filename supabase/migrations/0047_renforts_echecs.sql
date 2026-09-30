-- RENFORTS EN ÉCHEC (30 sept. 2026, chantier 60317482).
--
-- Constat : deux renforts FacePro se sont arrêtés en ~2 min (« scripts introuvables »,
-- « cockpit injoignable »), et l'ouverture automatique en redemandait sans cesse.
-- Cause prouvée du MODÈLE Haiku : chefs(facepro).modele_code = sonnet, mais palier = 3
-- (« usage : status ») posé à 14:00 par un `chef.sh --usage status` (le mot d'aide pris à
-- la lettre) ; la bascule range tout statut non « allowed* » en palier 3 = tout en Haiku.
--
-- 1) `chef.sh --usage` refuse désormais un statut inconnu AVANT d'écrire (scripts/chef.sh).
--    bascule_usage / palier_cible ne sont PAS redéfinis ici (un autre chantier les modifie
--    en ce moment) : durcir palier_cible aussi reste à faire, une fois ce chantier fusionné.
-- 2) Protection : renforts_pause(projet, section) — un renfort qui échoue en moins de 5 min
--    sans travail (statut erreur, ou fini/archive, faits = 0) met la section en pause
--    30 min ; 2 échecs de suite : 3 h (jamais de boucle). Seule l'ouverture AUTOMATIQUE
--    est freinée (le bouton de Raphaël reste libre). Une ligne claire dans le fil du
--    projet, une fois par pause.
-- Rejouable.

alter table cockpit.chefs add column if not exists renforts_pause_msg jsonb not null default '{}'::jsonb;

-- Le palier fantôme déjà posé par le mot « status » pris à la lettre.
update cockpit.chefs set palier = 0, palier_raison = 'palier levé : statut d''usage « status » invalide (0044)'
 where palier_raison = 'usage : status';

-- 2) La règle de pause, une seule fois (lue par renforts_auto ; l'écran peut la lire).
--    Échec = renfort mort en moins de 5 min sans le moindre travail.
create or replace function cockpit.renforts_pause(p_projet_id uuid, p_section_id uuid)
returns jsonb language sql stable security definer set search_path = cockpit, pg_temp as $$
  with s as (
    select r.id, r.created_at, r.erreur,
           (r.faits = 0 and r.statut in ('erreur', 'fini', 'archive')
            and coalesce(r.fini_at, r.vu_at, r.created_at) - r.created_at < interval '5 minutes') as echec
      from cockpit.renforts r
     where r.projet_id = p_projet_id and r.section_id is not distinct from p_section_id
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
$$;

-- renforts_auto (0040) : saute une section en pause, et le dit UNE fois dans le fil du projet.
create or replace function cockpit.renforts_auto(p_projet_id uuid)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare f jsonb; ch cockpit.chefs; a record; v_id uuid; v_reste int; v_vivants int; v_max int; v_seuil int; v_agents int;
  crees jsonb := '[]'::jsonb; p jsonb; v_nom text; v_cle text; v_pauses jsonb := '[]'::jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  f := cockpit.file_renforts(p_projet_id);
  if f->>'niveau' is null or f->>'bloque' is not null then return jsonb_build_object('demandes', crees, 'raison', coalesce(f->>'bloque', 'file_courte')); end if;
  select * into ch from cockpit.chefs where projet_id = p_projet_id;
  select nom into v_nom from cockpit.projets where id = p_projet_id;
  v_agents := coalesce(ch.agents_par_renfort, 3);
  v_reste := (f->>'file')::int; v_seuil := (f->>'seuil')::int; v_vivants := (f->>'vivants')::int; v_max := (f->>'max')::int;
  for a in select * from cockpit.attente_par_section(p_projet_id) loop
    exit when v_reste < v_seuil or v_vivants >= v_max;
    p := cockpit.renforts_pause(p_projet_id, a.section_id);
    if coalesce((p->>'pause')::boolean, false) then
      v_pauses := v_pauses || jsonb_build_object('section', a.section, 'jusqu_a', p->>'jusqu_a');
      v_cle := coalesce(a.section_id::text, 'sans') ;
      if (select coalesce(c.renforts_pause_msg ->> v_cle, '') from cockpit.chefs c where c.projet_id = p_projet_id) is distinct from (p->>'jusqu_a') then
        update cockpit.chefs set renforts_pause_msg = coalesce(renforts_pause_msg, '{}'::jsonb) || jsonb_build_object(v_cle, p->>'jusqu_a') where projet_id = p_projet_id;
        insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
        values (p_projet_id, null, 'cockpit', 'session', 'info',
          format('Renfort %s %s : %s échec%s, en pause jusqu’à %s ; cause : %s',
                 v_nom, a.section, p->>'echecs', case when (p->>'echecs')::int > 1 then 's' else '' end,
                 to_char((p->>'jusqu_a')::timestamptz at time zone 'Asia/Jerusalem', 'HH24"h"MI'), left(p->>'cause', 160)));
      end if;
      continue;
    end if;
    v_id := null;
    insert into cockpit.renforts (projet_id, section_id, prefixe, max_agents, chantiers, origine, file_declenchement, seuil_declenchement)
    values (p_projet_id, a.section_id, 'renfort/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6), v_agents, a.n, 'auto', (f->>'file')::int, v_seuil)
    on conflict do nothing returning id into v_id;
    continue when v_id is null;
    v_vivants := v_vivants + 1; v_reste := v_reste - a.n;
    crees := crees || jsonb_build_object('id', v_id, 'section', a.section, 'chantiers', a.n);
  end loop;
  return jsonb_build_object('demandes', crees, 'raison', null, 'en_pause', v_pauses);
end $$;

revoke all on function cockpit.renforts_pause(uuid, uuid), cockpit.renforts_auto(uuid) from public, anon, authenticated;
grant execute on function cockpit.renforts_pause(uuid, uuid), cockpit.renforts_auto(uuid) to service_role;
