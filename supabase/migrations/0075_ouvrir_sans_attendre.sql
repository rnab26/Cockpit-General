-- 0075 (6 oct. 2026, chantier 0079655d « Tout simplifier : j'envoie, ça travaille seul »)
-- Raphaël : « une session traite au plus 5 agents ; quand elle est pleine une nouvelle s'ouvre ; tant que tout n'est pas traité
-- ça continue ». MESURÉ sur FacePro (6 oct.) : 2 chantiers à prendre, 4 réveils, personne. Cause : le seuil d'ouverture
-- automatique d'un renfort (réglé à 4) dépassait la file (2) : un projet SANS chef vivante n'ouvrait rien tant que la file
-- n'atteignait pas ce seuil. Règle : quand aucune chef ne tient le projet, UN chantier en attente suffit pour ouvrir (le seuil
-- reste réglable : une valeur posée à la main est respectée). Alerte « bientôt saturée » : inchangée (elle garde `seuil`).
-- Idempotent.
CREATE OR REPLACE FUNCTION cockpit.file_renforts(p_projet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare ch cockpit.chefs; v_file int; v_seuil int; v_max int; v_vivants int; v_actif boolean; v_niveau text; v_bloque text; v_ouv int;
begin
  select * into ch from cockpit.chefs where projet_id = p_projet_id;
  select coalesce(sum(a.n), 0)::int into v_file from cockpit.attente_par_section(p_projet_id) a;
  v_seuil := coalesce(ch.renforts_auto_seuil, ch.agents_par_renfort, 3);
  v_ouv := case when ch.renforts_auto_seuil is null and not cockpit.chef_vivante(p_projet_id) then 1 else v_seuil end;
  v_max := coalesce(ch.max_renforts, 2);
  v_actif := coalesce(ch.renforts_auto, true);
  select count(*)::int into v_vivants from cockpit.renforts r where r.projet_id = p_projet_id and r.statut in ('demande', 'actif') and cockpit.renfort_vivant(r);
  v_niveau := case when v_file >= 2 * v_seuil then 'sature' when v_file >= v_seuil then 'proche' end;
  v_bloque := case when not v_actif then 'eteint'
                   when v_max = 0 then 'reglage_zero'
                   when coalesce((cockpit.frein_actif(p_projet_id)->>'actif')::boolean, false) then 'frein'
                   when v_vivants >= v_max then 'plein' end;
  return jsonb_build_object('actif', v_actif, 'seuil', v_seuil, 'seuil_defaut', ch.renforts_auto_seuil is null, 'seuil_ouverture', v_ouv,
    'file', v_file, 'niveau', v_niveau, 'bloque', v_bloque, 'vivants', v_vivants, 'max', v_max);
end $function$
;

CREATE OR REPLACE FUNCTION cockpit.renforts_auto(p_projet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare f jsonb; ch cockpit.chefs; a record; v_id uuid; v_reste int; v_vivants int; v_max int; v_seuil int; v_agents int;
  crees jsonb := '[]'::jsonb; p jsonb; v_nom text; v_cle text; v_pauses jsonb := '[]'::jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  f := cockpit.file_renforts(p_projet_id);
  if (f->>'file')::int < (f->>'seuil_ouverture')::int or f->>'bloque' is not null then return jsonb_build_object('demandes', crees, 'raison', coalesce(f->>'bloque', 'file_courte')); end if;
  select * into ch from cockpit.chefs where projet_id = p_projet_id;
  select nom into v_nom from cockpit.projets where id = p_projet_id;
  v_agents := coalesce(ch.agents_par_renfort, 3);
  v_reste := (f->>'file')::int; v_seuil := (f->>'seuil_ouverture')::int; v_vivants := (f->>'vivants')::int; v_max := (f->>'max')::int;
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
end $function$
;

