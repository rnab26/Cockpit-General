-- 0102 (19 oct. 2026, chantier cb3d17df). Raphaël : « Un voyant pour voir s'il y a des sessions actives directement. S'il n'y a pas
-- de session active, appuyer pour activer une session. […] S'il n'y a pas de chantier à lancer mais que j'ai répondu dans le
-- cockpit et que j'attends des réponses, un interrupteur pour activer une session. »
--
-- Deux fonctions, AUCUNE règle nouvelle :
--  - etat_sessions(projet) : lecture (admin) de ce que l'écran affiche : sessions vivantes (règle « vivant » = delai_signe, la même
--    que chantiers_prenables / le filet : sessions.vu_at récent et fin_at nul), chef vivante, en pause, messages qui attendent
--    (messages_sans_reponse + reponses_sans_suite), dernier réveil demandé.
--  - activer_session(projet) : écriture (admin) = reveiller_chef(projet, null, 'activer'). La raison 'activer' n'est jamais « rien à
--    servir » (rien_a_servir ne connaît que 'chantier', 'message', 'réponse') : un clic explicite réveille même sans chantier
--    prenable. Les garde-fous restent ceux de reveiller_chef : pause, écart minimum entre deux réveils (reveil_ecart_min), routine
--    configurée. Jamais de doublon : session déjà vivante ou réveil parti il y a moins de 5 min = on le dit, on ne tire pas.
-- Le texte du réveil 'activer' nomme aussi les autres projets qui attendent (le réveil est partagé : un seul tir toutes les 5 min).

create or replace function cockpit.etat_sessions(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; v_cible uuid; r cockpit.reveils_immediats;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  v_cible := cockpit.cible_reveil(pr.id);
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif;
  return jsonb_build_object(
    'projet', pr.nom,
    'en_pause', cockpit.projet_en_pause(pr.id),
    'vivantes', (select count(*) from cockpit.sessions s where s.projet_id = pr.id and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(pr.id)),
    'chef', cockpit.chef_vivante(pr.id),
    'messages', (select count(*) from cockpit.messages_sans_reponse(pr.id)) + (select count(*) from cockpit.reponses_sans_suite(pr.id)),
    'reveil_possible', r.projet_id is not null,
    'reveil_at', r.dernier_at,
    'reveil_ecart_min', coalesce(pr.reveil_ecart_min, 5));
end $$;

create or replace function cockpit.activer_session(p_projet text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; v_res text; v_cible uuid; r cockpit.reveils_immediats;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  perform cockpit.exiger(pr.id is not null, 'projet inconnu');
  if cockpit.projet_en_pause(pr.id) then return jsonb_build_object('resultat', 'projet_en_pause'); end if;
  if cockpit.chef_vivante(pr.id) or exists (select 1 from cockpit.sessions s where s.projet_id = pr.id and s.fin_at is null
       and s.vu_at > now() - cockpit.delai_signe(pr.id)) then
    return jsonb_build_object('resultat', 'session_vivante');
  end if;
  v_res := cockpit.reveiller_chef(pr.id, null, 'activer');
  v_cible := cockpit.cible_reveil(pr.id);
  select * into r from cockpit.reveils_immediats where projet_id = v_cible;
  return jsonb_build_object('resultat', case v_res when 'trop_tot' then 'deja_demande' else v_res end, 'reveil_at', r.dernier_at);
end $$;

-- Texte du réveil 'activer' : part de la définition en vigueur (jamais d'une ancienne migration), rejouable.
do $$
declare d text;
begin
  d := pg_get_functiondef('cockpit.reveiller_chef(uuid,uuid,text)'::regprocedure);
  if d like '%p_raison = ''activer''%' then return; end if;
  d := replace(d, E'    when p_raison = ''chantier''\n',
    E'    when p_raison = ''activer''\n    then format(''Raphaël demande une session depuis le cockpit (bouton « Activer une session »). Projets qui attendent : %s. Lance la passe de la chef du projet %s.'', (select string_agg(distinct x.slug, '', '') from (select v_slug as slug union select p2.slug from cockpit.renforts r3 join cockpit.projets p2 on p2.id = r3.projet_id where r3.statut = ''demande'' and not cockpit.projet_en_pause(p2.id)) x), v_cslug)\n    when p_raison = ''chantier''\n');
  if d not like '%p_raison = ''activer''%' then raise exception 'reveiller_chef : le point d''insertion n''a pas été trouvé'; end if;
  execute d;
end $$;

revoke all on function cockpit.etat_sessions(text), cockpit.activer_session(text) from public, anon;
grant execute on function cockpit.etat_sessions(text), cockpit.activer_session(text) to authenticated, service_role;
