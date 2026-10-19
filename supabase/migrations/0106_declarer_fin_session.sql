-- 0106 (19 oct. 2026, chantier 8101764d). Raphaël, capture du voyant sous « Tout lancer » : « c'est faux ».
-- CAUSE (relevé en base) : une session de réveil ouverte par une routine n'envoie aucun signal de fin (le hook SessionEnd ne part pas
-- quand le conteneur est simplement arrêté, ou qu'elle n'a pas les hooks). Finie, elle restait « elle devait travailler, plus de signe »,
-- donc « sans nouvelles : une session ne répond plus » pendant le repli (60 min).
-- CORRECTIF : la session DÉCLARE sa fin (chef.sh --fin-session, dernière ligne de la consigne de réveil). Elle passe « fermée » (fin_at),
-- comme après un SessionEnd : plus affichée, plus comptée, jamais « sans nouvelles ». Aucune règle d'état n'est modifiée (etat_session
-- lit déjà fin_at). Rejouable ; sans effet sur une session inconnue ou déjà finie.
create or replace function cockpit.declarer_fin_session(p_projet text, p_session text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; n integer;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return jsonb_build_object('etat', 'projet_inconnu'); end if;
  update cockpit.sessions set fin_at = now(), tour_en_cours = false
   where id = p_session and projet_id = pr.id and fin_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('etat', case when exists (select 1 from cockpit.sessions where id = p_session and projet_id = pr.id) then 'deja_finie' else 'session_inconnue' end);
  end if;
  update cockpit.taches set statut = 'arrete', fini_at = now() where session_id = p_session and statut = 'en_cours';
  return jsonb_build_object('etat', 'ok');
end $$;
revoke all on function cockpit.declarer_fin_session(text, text) from public, anon, authenticated;
grant execute on function cockpit.declarer_fin_session(text, text) to service_role;
