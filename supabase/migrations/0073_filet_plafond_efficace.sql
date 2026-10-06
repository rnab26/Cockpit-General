-- Le plafond de réveils du filet ne compte que les réveils SANS EFFET (6 oct. 2026, chantier 91985f79).
-- Raphaël : « aucun chantier n'est lancé seul ». Cause prouvée sur FacePro : 12 réveils en 24 h (plafond),
-- dont 3 en 11 min à 13 h 27-13 h 38, ont épuisé le plafond ; à 15 h 37 une réponse et 4 renforts attendaient,
-- statut « plafond », aucun réveil possible avant 16 h 48. Le plafond protège d'une boucle qui ouvre des
-- sessions pour rien : un réveil dont une session du projet a démarré dans les 30 min n'est pas « pour rien ».
-- UNE règle : filet_reveils_sans_effet, lue par filet_passe et etat_filet. Butoir dur : 3 × le plafond au total.
create or replace function cockpit.filet_reveils_sans_effet(p_projet uuid) returns int
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select count(*)::int from cockpit.filet_reveils f
   where f.projet_id = p_projet and f.at > now() - interval '24 hours'
     and not exists (select 1 from cockpit.sessions s
                      where s.projet_id = f.projet_id and s.demarre_at >= f.at
                        and s.demarre_at < f.at + interval '30 minutes');
$$;
revoke all on function cockpit.filet_reveils_sans_effet(uuid) from public;
grant execute on function cockpit.filet_reveils_sans_effet(uuid) to service_role;

CREATE OR REPLACE FUNCTION cockpit.filet_passe(p_slug text DEFAULT NULL::text, p_simuler boolean DEFAULT false, p_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr record; v_att jsonb; v_res text; v_out jsonb := '[]'::jsonb; v_jour int; v_total int; v_dernier timestamptz; v_pourquoi text; v_r text;
begin
  if not coalesce((select actif from cockpit.filet_reglage where id = 1), true) then
    return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'global_eteint'));
  end if;
  if not pg_try_advisory_xact_lock(hashtext('cockpit.filet_passe')) then
    return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'passe_en_cours'));
  end if;
  for pr in select * from cockpit.projets p where p.actif and (p_slug is null or p.slug = p_slug) order by p.slug loop
    v_res := null;
    if cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false) then v_res := 'projet_de_test';
    elsif not pr.filet_actif then v_res := 'eteint';
    else
      v_att := cockpit.filet_attente(pr.id);
      if (v_att ->> 'n')::int = 0 then v_res := 'rien_en_attente';
      elsif (v_att ->> 'plus_ancien')::timestamptz > now() - make_interval(mins => pr.filet_delai_min) then v_res := 'trop_recent';
      elsif cockpit.filet_vivant(pr.id) then v_res := 'session_vivante';
      else
        select count(*), max(at) into v_total, v_dernier from cockpit.filet_reveils where projet_id = pr.id and at > now() - interval '24 hours';
        v_jour := cockpit.filet_reveils_sans_effet(pr.id);
        if v_dernier > now() - cockpit.filet_ecart_projet(pr.id) then v_res := 'trop_tot';
        elsif v_jour >= pr.filet_plafond_jour or v_total >= pr.filet_plafond_jour * 3 then v_res := 'plafond';
        else
          v_pourquoi := left(array_to_string(array(select jsonb_array_elements_text(v_att -> 'raisons')), ', '), 300);
          if p_simuler then v_r := 'simule'; else v_r := cockpit.reveiller_chef(pr.id, null, 'filet de sécurité'); end if;
          if v_r in ('envoye', 'simule') then
            insert into cockpit.filet_reveils (projet_id, pourquoi, resultat, simule) values (pr.id, v_pourquoi, v_r, v_r = 'simule');
          end if;
          v_res := v_r;
        end if;
      end if;
    end if;
    v_out := v_out || jsonb_build_object('projet', pr.slug, 'resultat', v_res);
  end loop;
  return v_out;
exception when others then
  return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'erreur', 'detail', left(sqlerrm, 200)));
end $function$
;

CREATE OR REPLACE FUNCTION cockpit.etat_filet(p_projet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr cockpit.projets; v_cible uuid; v_att jsonb; j cockpit.filet_reveils; v_jour int; v_total int; v_glob boolean; v_cron jsonb := null;
        v_jeton boolean; v_statut text; v_ecart interval; v_cad int;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  v_glob := coalesce((select actif from cockpit.filet_reglage where id = 1), true);
  v_cad := coalesce((select cadence_min from cockpit.filet_reglage where id = 1), 1);
  begin
    select jsonb_build_object('existe', true, 'actif', j2.active, 'planning', j2.schedule) into v_cron from cron.job j2 where j2.jobname = 'cockpit-filet-securite';
  exception when others then v_cron := null;
  end;
  v_cible := cockpit.cible_reveil(pr.id);
  v_jeton := v_cible is not null and exists (select 1 from cockpit.reveils_immediats ri where ri.projet_id = v_cible and ri.actif);
  v_att := cockpit.filet_attente(pr.id);
  select * into j from cockpit.filet_reveils where projet_id = pr.id order by at desc limit 1;
  v_jour := cockpit.filet_reveils_sans_effet(pr.id);
  select count(*) into v_total from cockpit.filet_reveils where projet_id = pr.id and at > now() - interval '24 hours';
  v_ecart := cockpit.filet_ecart_projet(pr.id);
  v_statut := case when cockpit.projet_de_test(pr.slug) then 'test'
                   when not v_glob then 'global_eteint'
                   when not pr.filet_actif then 'eteint'
                   when v_cron is null or not coalesce((v_cron ->> 'actif')::boolean, false) then 'cron_absent'
                   when not v_jeton then 'sans_jeton'
                   when v_jour >= pr.filet_plafond_jour or v_total >= pr.filet_plafond_jour * 3 then 'plafond'
                   else 'actif' end;
  return jsonb_build_object('statut', v_statut, 'projet_actif', pr.filet_actif, 'global_actif', v_glob, 'cron', v_cron,
    'plafond', pr.filet_plafond_jour, 'delai_min', pr.filet_delai_min, 'aujourdhui', v_jour, 'reveils_total', v_total, 'jeton', v_jeton,
    'dernier_at', j.at, 'prochain_at', case when j.at is null then null else greatest(j.at + v_ecart, now()) end, 'ecart_min', (extract(epoch from v_ecart) / 60)::int,
    'dernier_pourquoi', j.pourquoi, 'attente', v_att, 'vivant', cockpit.filet_vivant(pr.id),
    'cadence_min', v_cad, 'reveil_ecart_min', pr.reveil_ecart_min, 'chef_reactif_min', pr.chef_reactif_min,
    'chef', cockpit.chef_repond(pr.id));
end $function$
;

revoke all on function cockpit.filet_passe(text, boolean, boolean) from public;
grant execute on function cockpit.filet_passe(text, boolean, boolean) to service_role;
revoke all on function cockpit.etat_filet(text) from public;
grant execute on function cockpit.etat_filet(text) to authenticated, service_role;
