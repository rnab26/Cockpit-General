-- Un chantier qui arrive réveille la chef tout de suite (6 oct. 2026, chantier 0079655d).
-- Raphaël : « j'envoie des chantiers sans attendre et sans jamais relancer ». Avant : un chantier neuf
-- n'attendait que le filet (délai 3 min + passage de la base 1 min), alors qu'un message ou une réponse
-- réveillait aussitôt. Même chemin, mêmes sûretés (au plus 1 réveil / reveil_ecart_min, jamais un projet
-- de test, rien si le mode autonome est éteint ou s'il n'y a rien à prendre).
create or replace function cockpit.rien_a_servir(p_projet_id uuid, p_raison text) returns boolean
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select case
    when p_raison = 'chantier' then
      not exists (select 1 from cockpit.projets p where p.id = p_projet_id and cockpit.autonome_actif(p))
      or not exists (select 1 from cockpit.chantiers_prenables(p_projet_id, null))
    else p_raison in ('message', 'réponse')
      and not exists (select 1 from cockpit.messages_sans_reponse(p_projet_id))
      and not exists (select 1 from cockpit.reponses_sans_suite(p_projet_id))
  end;
$$;

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
  if p_chantier is not null and exists (
       select 1 from cockpit.chantiers c join cockpit.sessions s on s.projet_id = c.projet_id and s.branche = c.pris_par
        where c.id = p_chantier and c.pris_jusqu_a > now() and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(p_projet_id)) then
    return 'session_tient';
  end if;
  if cockpit.rien_a_servir(p_projet_id, p_raison) then return 'rien_a_servir'; end if;
  v_cible := cockpit.cible_reveil(p_projet_id);
  if v_cible is null then return 'aucune_chef'; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif for update skip locked;
  if r.projet_id is null then return 'pas_configure'; end if;
  if r.dernier_at > now() - make_interval(mins => coalesce(v_ecart, 5)) then return 'trop_tot'; end if;
  select decrypted_secret into v_jeton from vault.decrypted_secrets where id = r.secret_id;
  if v_jeton is null then return 'pas_configure'; end if;
  select slug into v_cslug from cockpit.projets where id = v_cible;
  v_texte := case when p_raison like 'filet%'
    then format('Filet de sécurité : du travail attend dans le projet %s et aucune session ne le traite. Lance la passe de la chef du projet %s.', v_slug, v_cslug)
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
end $function$
;

create or replace function cockpit.reveil_sur_chantier() returns trigger
language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  begin
    if new.etat in ('libre', 'a_trier') and (tg_op = 'INSERT' or old.etat is distinct from new.etat)
       and not cockpit.projet_de_test((select slug from cockpit.projets where id = new.projet_id)) then
      perform cockpit.reveiller_chef(new.projet_id, new.id, 'chantier');
    end if;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists reveil_sur_chantier on cockpit.chantiers;
create trigger reveil_sur_chantier after insert or update of etat on cockpit.chantiers
  for each row execute function cockpit.reveil_sur_chantier();

revoke all on function cockpit.rien_a_servir(uuid, text) from public;
grant execute on function cockpit.rien_a_servir(uuid, text) to service_role;
revoke all on function cockpit.reveiller_chef(uuid, uuid, text) from public;
grant execute on function cockpit.reveiller_chef(uuid, uuid, text) to service_role;
revoke all on function cockpit.reveil_sur_chantier() from public;
grant execute on function cockpit.reveil_sur_chantier() to service_role;
