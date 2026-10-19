-- 0107 : « Activer une session » reste proposé quand aucune chef ne vit (19-20 oct. 2026, chantier 7bf2c3a1).
-- Raphaël (capture 01 h 25) : le bouton avait disparu pour Trieur et FacePro avec « Réveil automatique non réglé », alors que le
-- réveil est réglé : etat_sessions.reveil_possible passait par cible_reveil (nulle sans chef vivante), alors que reveiller_chef
-- (raison hors « filet ») retombe déjà sur la routine de réveil active. UNE règle, la même aux deux endroits.
-- Partie de pg_get_functiondef en vigueur (0105). Rejouable.
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
  v_cible := coalesce(cockpit.cible_reveil(pr.id), (select r2.projet_id from cockpit.reveils_immediats r2 where r2.actif limit 1));
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif;
  return jsonb_build_object(
    'projet', pr.nom,
    'en_pause', cockpit.projet_en_pause(pr.id),
    'vivantes', cockpit.sessions_ouvertes(pr.id),
    'etats', cockpit.sessions_par_etat(pr.id),
    'chef', cockpit.chef_vivante(pr.id),
    'messages', (select count(*) from cockpit.messages_sans_reponse(pr.id)) + (select count(*) from cockpit.reponses_sans_suite(pr.id)),
    'reveil_possible', r.projet_id is not null,
    'reveil_at', r.dernier_at,
    'reveil_ecart_min', coalesce(pr.reveil_ecart_min, 5));
end $function$
;
