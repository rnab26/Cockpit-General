-- Réveil automatique : dire la VRAIE raison quand rien ne peut être réveillé (13 oct. 2026, chantier 6f112d51).
--
-- Constaté sur le projet « cockpit » (le moteur) : l'écran « Réveil automatique » disait « Bloqué : Claude ne peut pas être
-- réveillé — il manque le jeton du réveil » avec un bouton « Coller le jeton ». C'était FAUX :
--   - le jeton existe (reveils_immediats : actif, secret au coffre) et le dernier réveil tiré avec lui, à 12 h 06 UTC, a reçu
--     HTTP 200 et ouvert une session (routine_fire) ;
--   - la vraie cause : cible_reveil() est NULLE quand aucune session chef n'est vivante (vue il y a moins de 3 h) dans AUCUN
--     projet ; reveiller_chef rend alors 'aucune_chef' sans rien tirer, et etat_filet rangeait ce cas sous « sans_jeton ».
-- Raphaël aurait collé un jeton pour rien (« chaque manipulation manuelle me coûte cher »).
--
-- UN seul changement de règle : un statut 'sans_chef' (cible nulle ET un jeton actif quelque part) avant 'sans_jeton'.
-- Rien d'autre ne bouge : « sans_jeton » reste vrai pour une cible sans jeton ou un cockpit sans aucun jeton. Ce que fait le
-- système quand aucune chef n'est ouverte (ne rien lancer, pour ne pas dépenser de jetons) n'est PAS modifié : rouvrir une
-- session tout seul coûte ~290 000 jetons à chaque fois, c'est la décision de Raphaël (carte « aucune session ne s'ouvre seule »).
-- Base : la définition EN VIGUEUR en base (pg_get_functiondef le 13 oct.), pas une ancienne migration.
-- Idempotente (create or replace).
CREATE OR REPLACE FUNCTION cockpit.etat_filet(p_projet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr cockpit.projets; v_cible uuid; v_att jsonb; j cockpit.filet_reveils; v_jour int; v_total int; v_glob boolean; v_cron jsonb := null;
        v_jeton boolean; v_sans_chef boolean; v_statut text; v_ecart interval; v_cad int;
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
  -- 0082 : « pas de cible » (aucune session chef vivante nulle part) n'est PAS « pas de jeton » : le jeton existe, mais reveiller_chef
  -- ne tire rien sans cible (il rend 'aucune_chef'). Seul ce cas-là, avec un jeton configuré quelque part, est « sans_chef ».
  v_sans_chef := v_cible is null and exists (select 1 from cockpit.reveils_immediats ri where ri.actif);
  v_att := cockpit.filet_attente(pr.id);
  select * into j from cockpit.filet_reveils where projet_id = pr.id order by at desc limit 1;
  v_jour := cockpit.filet_reveils_sans_effet(pr.id);
  select count(*) into v_total from cockpit.filet_reveils where projet_id = pr.id and at > now() - interval '24 hours';
  v_ecart := cockpit.filet_ecart_projet(pr.id);
  v_statut := case when cockpit.projet_de_test(pr.slug) then 'test'
                   when not v_glob then 'global_eteint'
                   when not pr.filet_actif then 'eteint'
                   when v_cron is null or not coalesce((v_cron ->> 'actif')::boolean, false) then 'cron_absent'
                   when v_sans_chef then 'sans_chef'
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

revoke all on function cockpit.etat_filet(text) from public;
grant execute on function cockpit.etat_filet(text) to authenticated, service_role;
