-- 0109 : UNE règle pour « quelle routine réveille ce projet quand Raphaël le demande ? » (22 oct. 2026).
-- Avant : quatre endroits (reveiller_chef, activer_session, etat_sessions 0107, autocontrole_passe) la recalculaient, et
-- l'autocontrôle se trompait : il disait « aucun réveil configuré » pour Trieur et FacePro alors que la routine existe
-- (cible_reveil() est nulle sans session chef vivante). Maintenant : cockpit.cible_reveil_manuelle(projet) = la routine du
-- chef vivant, sinon la routine active du cockpit. Le FILET automatique garde cible_reveil() seule (décision 0082 : il ne
-- réveille pas la routine d'un autre projet). Idempotent.

create or replace function cockpit.cible_reveil_manuelle(p_projet_id uuid) returns uuid
language sql stable security definer set search_path to 'cockpit', 'pg_temp' as $f$
  select coalesce(cockpit.cible_reveil(p_projet_id), (select r.projet_id from cockpit.reveils_immediats r where r.actif limit 1));
$f$;
revoke all on function cockpit.cible_reveil_manuelle(uuid) from public;
grant execute on function cockpit.cible_reveil_manuelle(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION cockpit.reveiller_chef(p_projet_id uuid, p_chantier uuid DEFAULT NULL::uuid, p_raison text DEFAULT 'message'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare v_slug text; v_cible uuid; r cockpit.reveils_immediats; v_jeton text; v_req bigint; v_cslug text; v_texte text; v_ecart int;
begin
  select slug, reveil_ecart_min into v_slug, v_ecart from cockpit.projets where id = p_projet_id;
  if v_slug is null then return 'aucune_chef'; end if;
  /* garde pause 0093 */ if cockpit.projet_en_pause(p_projet_id) then return 'projet_en_pause'; end if;
  if p_chantier is not null and exists (
       select 1 from cockpit.chantiers c join cockpit.sessions s on s.projet_id = c.projet_id and s.branche = c.pris_par
        where c.id = p_chantier and c.pris_jusqu_a > now() and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(p_projet_id)) then
    return 'session_tient';
  end if;
  if cockpit.rien_a_servir(p_projet_id, p_raison) then return 'rien_a_servir'; end if;
  v_cible := case when p_raison like 'filet%' then cockpit.cible_reveil(p_projet_id) else cockpit.cible_reveil_manuelle(p_projet_id) end;
  if v_cible is null then return 'aucune_chef'; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif for update skip locked;
  if r.projet_id is null then return 'pas_configure'; end if;
  if r.dernier_at > now() - make_interval(mins => coalesce(v_ecart, 5)) then return 'trop_tot'; end if;
  select decrypted_secret into v_jeton from vault.decrypted_secrets where id = r.secret_id;
  if v_jeton is null then return 'pas_configure'; end if;
  select slug into v_cslug from cockpit.projets where id = v_cible;
  v_texte := case when p_raison like 'filet%'
    then format('Filet de sécurité : du travail attend dans le projet %s et aucune session ne le traite. Lance la passe de la chef du projet %s.', v_slug, v_cslug)
    when p_raison = 'activer'
    then format('Raphaël demande une session depuis le cockpit (bouton « Activer une session »). Projets qui attendent : %s. Lance la passe de la chef du projet %s.', (select string_agg(distinct x.slug, ', ') from (select v_slug as slug union select p2.slug from cockpit.renforts r3 join cockpit.projets p2 on p2.id = r3.projet_id where r3.statut = 'demande' and not cockpit.projet_en_pause(p2.id)) x), v_cslug)
    when p_raison = 'chantier'
    then format('Un chantier vient d''arriver dans le cockpit (projet %s). Lance la passe de la chef du projet %s.', v_slug, v_cslug)
    else format('Raphaël vient d''écrire dans le cockpit (projet %s, %s). Lance la passe de la chef du projet %s.', v_slug, p_raison, v_cslug) end;
  v_req := net.http_post(
    url := 'https://api.anthropic.com/v1/claude_code/routines/' || r.trigger_id || '/fire',
    body := jsonb_build_object('text', v_texte),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_jeton, 'anthropic-beta', 'experimental-cc-routine-2026-04-01',
                                  'anthropic-version', '2023-06-01', 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
  update cockpit.reveils_immediats set dernier_at = now(), dernier_request = v_req, dernier_raison = left(v_slug || ' · ' || p_raison, 120)
   where projet_id = v_cible;
  return 'envoye';
end $function$;
CREATE OR REPLACE FUNCTION cockpit.activer_session(p_projet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr cockpit.projets; v_res text; v_cible uuid; r cockpit.reveils_immediats;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  perform cockpit.exiger(pr.id is not null, 'projet inconnu');
  if cockpit.projet_en_pause(pr.id) then return jsonb_build_object('resultat', 'projet_en_pause'); end if;
  if cockpit.chef_vivante(pr.id) or cockpit.sessions_ouvertes(pr.id) > 0 then
    return jsonb_build_object('resultat', 'session_vivante');
  end if;
  v_res := cockpit.reveiller_chef(pr.id, null, 'activer');
  v_cible := cockpit.cible_reveil_manuelle(pr.id);
  select * into r from cockpit.reveils_immediats where projet_id = v_cible;
  return jsonb_build_object('resultat', case v_res when 'trop_tot' then 'deja_demande' else v_res end, 'reveil_at', r.dernier_at);
end $function$;
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
    'reveil_at', r.dernier_at,
    'reveil_ecart_min', coalesce(pr.reveil_ecart_min, 5));
end $function$;
CREATE OR REPLACE FUNCTION cockpit.autocontrole_passe(p_slug text DEFAULT NULL::text, p_essai boolean DEFAULT false, p_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'extensions', 'pg_temp'
AS $function$
declare
  pr record; rf cockpit.renforts; r cockpit.reveils_immediats; h record;
  v_att jsonb; v_n int; v_plus timestamptz; v_travail int; v_cible uuid; v_delai interval;
  v_voulus jsonb; v_out jsonb := '[]'::jsonb; v_net int; v_clos int; v_auto boolean; v_vu timestamptz; v_cartes int; v_dep timestamptz;
  v_code text; v_grav text; v_cause text; v_detail jsonb; v_url text; v_i jsonb; v_rep boolean;
begin
  if not coalesce((select autocontrole_actif from cockpit.filet_reglage where id = 1), true) then
    return jsonb_build_object('global', false, 'projets', '[]'::jsonb);
  end if;
  if not pg_try_advisory_xact_lock(hashtext('cockpit.autocontrole_passe')) then
    return jsonb_build_object('global', true, 'passe_en_cours', true, 'projets', '[]'::jsonb);
  end if;
  v_auto := coalesce((select actif from cockpit.filet_reglage where id = 1), true);
  for pr in select * from cockpit.projets p where p.actif and (p_slug is null or p.slug = p_slug) order by p.slug loop
    if cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false) then continue; end if;
    v_voulus := '[]'::jsonb; v_net := 0;
    v_delai := make_interval(mins => pr.autocontrole_delai_min);
    -- Un projet EN PAUSE (0093) n'a aucun incident : rien ne doit y travailler, donc rien n'y est « en panne ».
    if not cockpit.projet_en_pause(pr.id) then
      v_travail := cockpit.sessions_au_travail(pr.id);   -- règle unique etat_session (0104)

      -- (C) Nettoyage sans risque : une demande de session que personne n'a prise. JAMAIS de réveil.
      if pr.autocontrole_nettoyage_min > 0 and v_travail = 0 then
        for rf in select * from cockpit.renforts x where x.projet_id = pr.id and x.statut = 'demande' and x.session_distante is null
                     and cockpit.renfort_demande_depuis(x) < now() - make_interval(mins => pr.autocontrole_nettoyage_min)
                   order by x.created_at for update skip locked loop
          v_net := v_net + 1;
          if not p_essai then
            update cockpit.renforts set
              statut = case when cockpit.renfort_travail_restant(rf) = 0 then 'fini' else 'erreur' end,
              fini_at = case when cockpit.renfort_travail_restant(rf) = 0 then now() else fini_at end,
              erreur = case when cockpit.renfort_travail_restant(rf) = 0 then erreur
                            else 'Aucune session ne l''a prise en ' || pr.autocontrole_nettoyage_min || ' min. Rien n''est perdu : relance avec « Tout lancer ».' end,
              erreur_at = case when cockpit.renfort_travail_restant(rf) = 0 then erreur_at else now() end
             where id = rf.id and statut = 'demande';
          end if;
        end loop;
      end if;

      -- 1. Du travail attend sans que personne ne travaille.
      v_att := cockpit.filet_attente(pr.id);
      v_n := coalesce((v_att ->> 'n')::int, 0);
      v_plus := (v_att ->> 'plus_ancien')::timestamptz;
      if v_travail = 0 and v_n > 0 and v_plus < now() - v_delai then
        v_cible := cockpit.cible_reveil_manuelle(pr.id);
        select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif;
        v_code := null; v_grav := 'panne'; v_detail := jsonb_build_object('attend', v_n, 'raisons', v_att -> 'raisons', 'geste', 'activer_session');
        if r.projet_id is null then
          v_code := 'attente_sans_reveil'; v_detail := v_detail || jsonb_build_object('geste', null);
          v_cause := 'Du travail attend et aucun réveil n''est configuré pour ce projet : ouvre Claude Code à la main.';
        elsif r.dernier_at is not null and r.dernier_at >= v_plus then
          -- Un réveil est parti depuis que ça attend : le service l'a-t-il accepté ? (réponse gardée par pg_net, pas en SQL du cockpit)
          select hr.status_code, hr.error_msg, hr.content into h from net._http_response hr where hr.id = r.dernier_request;
          v_rep := found;
          v_detail := v_detail || jsonb_build_object('reveil_at', r.dernier_at);
          if v_rep and (h.error_msg is not null or (h.status_code is not null and h.status_code not between 200 and 299)) then
            v_code := 'reveil_refuse';
            v_cause := 'Du travail attend et le dernier réveil a échoué : ' || case
              when h.error_msg is not null then 'le service ne répond pas.'
              when h.status_code in (401, 403) then 'la clé du réveil est refusée, il faut la renouveler.'
              when h.status_code = 404 then 'la routine du réveil n''existe plus.'
              when h.status_code = 429 then 'trop de demandes, le service demande d''attendre.'
              else 'le service a répondu une erreur (code ' || h.status_code || ').' end;
            v_detail := v_detail || jsonb_build_object('code_http', h.status_code);
          elsif now() - r.dernier_at > v_delai then
            v_code := 'reveil_sans_effet';
            v_cause := 'Du travail attend : un réveil est parti, mais la session lancée n''a rien pris.';
            v_url := null;
            if v_rep then begin v_url := (h.content::jsonb) ->> 'claude_code_session_url'; exception when others then v_url := null; end; end if;
            if v_url is not null then v_detail := v_detail || jsonb_build_object('session_url', v_url); end if;
          end if;   -- sinon le réveil vient de partir : on lui laisse sa chance
        elsif not v_auto or not pr.filet_actif then
          v_code := 'attente_reveil_eteint'; v_grav := 'info';
          v_cause := 'Du travail attend, et le réveil automatique est éteint (ton choix).';
        else
          v_code := 'attente_sans_reveil';
          v_cause := 'Du travail attend et aucun réveil n''est parti depuis.';
        end if;
        if v_code is not null then
          v_voulus := v_voulus || jsonb_build_object('code', v_code, 'gravite', v_grav, 'cause', v_cause, 'detail', v_detail, 'depuis', v_plus);
        end if;
      end if;

      -- 2. La dernière session lancée s'est arrêtée en erreur, et du travail reste.
      select * into rf from cockpit.renforts x where x.projet_id = pr.id order by x.created_at desc limit 1;
      if found and rf.statut = 'erreur' and rf.efface_at is null and v_travail = 0
         and coalesce(rf.erreur_at, rf.created_at) > now() - make_interval(hours => pr.autocontrole_garde_h)
         and cockpit.renfort_travail_restant(rf) > 0 then
        v_voulus := v_voulus || jsonb_build_object('code', 'renfort_en_erreur', 'gravite', 'panne',
          'cause', 'Une session lancée s''est arrêtée : ' || coalesce(nullif(rf.erreur, ''), 'sans dire pourquoi.'),
          'detail', jsonb_build_object('renfort', rf.id, 'reste', cockpit.renfort_travail_restant(rf)),
          'depuis', coalesce(rf.erreur_at, rf.created_at));
      end if;

      -- 3. Une session qui devait travailler ne donne plus de signe.
      select count(*), min(s.vu_at) into v_n, v_vu from cockpit.sessions s
       where s.projet_id = pr.id and s.fin_at is null and cockpit.etat_session(s) = 'sans_nouvelles';
      if v_n > 0 and v_travail = 0 then
        v_voulus := v_voulus || jsonb_build_object('code', 'session_sans_nouvelles', 'gravite', 'panne',
          'cause', case when v_n > 1 then v_n || ' sessions qui devaient travailler ne donnent plus de nouvelles.'
                        else 'Une session qui devait travailler ne donne plus de nouvelles.' end,
          'detail', jsonb_build_object('sessions', v_n), 'depuis', v_vu);
      end if;

      -- 4. Des cartes dépassées que la passe d'épuration (3 min) aurait dû retirer.
      if pr.epuration_delai_h > 0 and coalesce((select epuration_actif from cockpit.filet_reglage where id = 1), true) then
        select count(*), min(m.created_at) into v_cartes, v_dep from cockpit.messages m
         where m.projet_id = pr.id and m.answered_at is null and m.kind in ('question', 'action') and not m.epuration_exclue and m.retour_at is null
           and greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) + make_interval(hours => pr.epuration_delai_h * case when m.kind = 'action' then 7 else 1 end) < now() - v_delai
           and cockpit.carte_depassee(m) is not null;
        if v_cartes > 0 then
          v_voulus := v_voulus || jsonb_build_object('code', 'cartes_non_retirees', 'gravite', 'panne',
            'cause', case when v_cartes > 1 then v_cartes || ' cartes périmées ne se retirent pas toutes seules.' else 'Une carte périmée ne se retire pas toute seule.' end,
            'detail', jsonb_build_object('cartes', v_cartes), 'depuis', v_dep);
        end if;
      end if;
    end if;

    -- Écriture : ce qui est voulu s'ouvre ou se met à jour, ce qui ne l'est plus se RÉSOUT (aucun clic).
    v_clos := 0;
    if not p_essai then
      update cockpit.incidents i set etat = 'resolu', resolu_at = now(), updated_at = now()
       where i.projet_id = pr.id and i.etat = 'ouvert'
         and not exists (select 1 from jsonb_array_elements(v_voulus) v where v ->> 'code' = i.code);
      get diagnostics v_clos = row_count;
      for v_i in select * from jsonb_array_elements(v_voulus) loop
        insert into cockpit.incidents (projet_id, code, gravite, cause, detail, depuis)
        values (pr.id, v_i ->> 'code', v_i ->> 'gravite', v_i ->> 'cause', coalesce(v_i -> 'detail', '{}'::jsonb), coalesce((v_i ->> 'depuis')::timestamptz, now()))
        on conflict (projet_id, code) where etat = 'ouvert'
        do update set gravite = excluded.gravite, cause = excluded.cause, detail = excluded.detail, vu_at = now(), updated_at = now();
      end loop;
    end if;
    v_out := v_out || jsonb_build_object('projet', pr.slug, 'incidents', v_voulus, 'nettoyes', v_net, 'resolus', v_clos);
  end loop;
  return jsonb_build_object('global', true, 'essai', p_essai, 'projets', v_out);
exception when others then
  return jsonb_build_object('erreur', left(sqlerrm, 200));
end $function$;
