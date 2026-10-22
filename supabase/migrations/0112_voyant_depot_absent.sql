-- 0112 : le voyant dit POURQUOI « Activer une session » ne marche pas pour un projet dont le dépôt n'est pas dans la routine (22 oct. 2026).
-- etat_sessions ajoute `depot_absent` (même règle que reveiller_chef, 0111) : l'écran n'offre plus un bouton qui échouerait et renvoie à la carte.
-- Idempotent.

CREATE OR REPLACE FUNCTION cockpit.etat_sessions(p_projet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr cockpit.projets; v_cible uuid; r cockpit.reveils_immediats;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  -- Comme reveiller_chef pour une activation à la main : sans chef vivante (cible nulle), c'est la routine de réveil
  -- active qui répond. Sinon le bouton « Activer une session » disparaissait justement quand plus aucune chef ne vit.
  v_cible := cockpit.cible_reveil_manuelle(pr.id);
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif;
  return jsonb_build_object(
    'projet', pr.nom,
    'en_pause', cockpit.projet_en_pause(pr.id),
    'vivantes', cockpit.sessions_ouvertes(pr.id),
    'etats', cockpit.sessions_par_etat(pr.id),
    'chef', cockpit.chef_vivante(pr.id),
    'messages', (select count(*) from cockpit.messages_sans_reponse(pr.id)) + (select count(*) from cockpit.reponses_sans_suite(pr.id)),
    'reveil_possible', r.projet_id is not null,
    'depot_absent', v_cible is distinct from pr.id and cockpit.depot_hors_routine(pr.id),
    'reveil_at', r.dernier_at,
    'reveil_ecart_min', coalesce(pr.reveil_ecart_min, 5));
end $function$;
