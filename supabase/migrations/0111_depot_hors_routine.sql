-- 0111 : un projet dont le dépôt n'est PAS dans la routine de réveil n'est plus réveillé pour rien (22 oct. 2026).
-- Constaté (deux réveils, 10:32 et 10:51) : la routine « réveil immédiat » ne contient que ses dépôts ; une session de routine n'a PAS
-- add_repo (ToolSearch ne le trouve pas) et ne peut donc pas travailler trieur-data. Chaque « Tout lancer » dépensait ~0,5 $ pour rien.
-- La session le dit une fois (chef.sh --depot-absent <slug> : drapeau chefs.sans_outils.depot_routine + une carte) ; pendant 24 h,
-- reveiller_chef répond « depot_absent » sans rien tirer et relais_a_servir ne liste plus ce projet. Après 24 h, UN nouvel essai
-- (le dépôt a pu être ajouté à la routine) : aucun réglage à défaire. Idempotent.

create or replace function cockpit.depot_hors_routine(p_projet_id uuid) returns boolean
language sql stable security definer set search_path to 'cockpit', 'pg_temp' as $f$
  select coalesce((select (c.sans_outils ->> 'depot_routine')::timestamptz > now() - interval '24 hours' from cockpit.chefs c where c.projet_id = p_projet_id), false);
$f$;
revoke all on function cockpit.depot_hors_routine(uuid) from public;
grant execute on function cockpit.depot_hors_routine(uuid) to authenticated, service_role;

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
  /* 0111 : la routine ne peut pas atteindre le dépôt de ce projet (constaté, 24 h) : on ne la réveille pas pour rien */
  if v_cible is distinct from p_projet_id and cockpit.depot_hors_routine(p_projet_id) then return 'depot_absent'; end if;
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
CREATE OR REPLACE FUNCTION cockpit.relais_a_servir(p_chef_projet text, p_test text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare v_chef uuid; r jsonb := '[]'::jsonb; p record; v_renf jsonb; v_msg int; v_ouvrir boolean; v_fermer jsonb; v_verif int; v_deja boolean;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_chef from cockpit.projets where slug = p_chef_projet;
  if p_test is null and (v_chef is null or v_chef is distinct from cockpit.chef_relais()) then return r; end if;
  for p in select * from cockpit.projets x
            where x.actif and x.id is distinct from v_chef
              and (case when p_test is null then not cockpit.projet_de_test(x.slug) else x.slug = p_test end)
              and not cockpit.chef_vivante(x.id)
              and not cockpit.depot_hors_routine(x.id)
            order by x.slug loop
    v_renf := cockpit.renforts_a_ouvrir(p.slug, p_test is not null);
    v_deja := cockpit.relais_deja_ouvert(p.id);
    select count(*) into v_msg from cockpit.messages_sans_reponse(p.id);
    select count(*) into v_verif from cockpit.verifs_prenables(p.id, null);
    v_ouvrir := (v_verif > 0 or (v_msg > 0
      and not exists (select 1 from cockpit.sessions s where s.projet_id = p.id and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(p.id))))
      and not v_deja
      and not exists (select 1 from cockpit.ouvertures o where o.projet_id = p.id and o.created_at > now() - interval '1 hour');
    v_fermer := coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'session', o.session_distante) order by o.created_at)
                 from cockpit.ouvertures o where o.projet_id = p.id and cockpit.ouverture_finie(o.id)), '[]'::jsonb);
    continue when jsonb_array_length(v_renf -> 'ouvrir') = 0 and jsonb_array_length(v_renf -> 'archiver') = 0
              and jsonb_array_length(v_fermer) = 0 and not v_ouvrir;
    r := r || jsonb_build_object('slug', p.slug, 'nom', p.nom, 'depot', p.depot, 'renforts', v_renf,
                                 'ouvrir_session', v_ouvrir, 'messages', v_msg, 'verifs', v_verif, 'fermer', v_fermer);
  end loop;
  return r;
end $function$;
