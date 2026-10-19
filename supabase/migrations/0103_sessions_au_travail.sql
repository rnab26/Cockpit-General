-- 0103 (19 oct. 2026, chantier 520ea5fb). Raphaël (capture 20 h 13, « Tout » : « Est-ce que tout est bien coordonné ? ») : le voyant sous
-- « Tout lancer » (0102) disait « session ouverte » pour FacePro, Melissa et le Trieur. Mesuré à 17 h 17 UTC : la seule session « vivante » de
-- chacun était une session de réveil ouverte 33 à 52 min plus tôt, dont vu_at = demarre_at : aucun signe depuis son ouverture. Elle comptait
-- « vivante » parce que la règle (delai_signe, 60 min) ne regarde que vu_at, que l'ouverture elle-même pose : une session ouverte puis
-- muette restait « ouverte » pendant tout le délai, et activer_session refusait de réveiller (« session_vivante »).
--
-- UNE règle, sans seuil nouveau : une session « au travail » est non finie, vue depuis moins de delai_signe (inchangé), ET elle a donné un
-- signe APRÈS son ouverture (vu_at > demarre_at : le battement des hooks, toutes les 45 s pendant un tour) — ou vient de s'ouvrir (moins
-- que l'écart de réveil du projet, reveil_ecart_min, déjà la règle « un réveil est parti, elle arrive »). etat_sessions (le voyant) et
-- activer_session (le bouton) lisent la MÊME fonction : un voyant gris ne mène jamais à « une session est déjà ouverte ».
-- Ne touche ni aux réveils, ni au filet, ni à chantiers_prenables / sans_signe_de_vie (qui gardent delai_signe seul : une session muette
-- y protège encore un chantier tenu, décision de 0096 : on ne libère pas vite).

create or replace function cockpit.sessions_au_travail(p_projet uuid)
returns integer language sql stable security definer set search_path = cockpit, pg_temp as $$
  select count(*)::integer from cockpit.sessions s
   where s.projet_id = p_projet and s.fin_at is null
     and s.vu_at > now() - cockpit.delai_signe(p_projet)
     and (s.vu_at > s.demarre_at
          or s.demarre_at > now() - make_interval(mins => coalesce((select reveil_ecart_min from cockpit.projets where id = p_projet), 5)));
$$;
revoke all on function cockpit.sessions_au_travail(uuid) from public, anon;
grant execute on function cockpit.sessions_au_travail(uuid) to authenticated, service_role;

-- Les deux lecteurs de la règle : définitions en vigueur, une seule ligne remplacée chacune (rejouable).
do $$
declare d text;
begin
  d := pg_get_functiondef('cockpit.etat_sessions(text)'::regprocedure);
  if d not like '%sessions_au_travail%' then
    d := replace(d, E'(select count(*) from cockpit.sessions s where s.projet_id = pr.id and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(pr.id))',
                    'cockpit.sessions_au_travail(pr.id)');
    if d not like '%sessions_au_travail%' then raise exception 'etat_sessions : le point de remplacement n''a pas été trouvé'; end if;
    execute d;
  end if;
  d := pg_get_functiondef('cockpit.activer_session(text)'::regprocedure);
  if d not like '%sessions_au_travail%' then
    d := replace(d, E'exists (select 1 from cockpit.sessions s where s.projet_id = pr.id and s.fin_at is null\n       and s.vu_at > now() - cockpit.delai_signe(pr.id))',
                    'cockpit.sessions_au_travail(pr.id) > 0');
    if d not like '%sessions_au_travail%' then raise exception 'activer_session : le point de remplacement n''a pas été trouvé'; end if;
    execute d;
  end if;
end $$;
