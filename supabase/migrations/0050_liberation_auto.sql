-- 0050 (5 oct. 2026, chantier 6020714d). Raphaël : « Libérer automatiquement les
-- chantiers bloqués par des sessions le plus rapidement possible car ça peut
-- traîner pour rien. »
-- Cause : liberer_silencieux(slug) (0043) n'était appelée qu'au passage de
-- chef.sh / passe.sh / autonome.sh ; sans passage (session morte, personne
-- ne repasse), un chantier « en_cours » restait tenu jusqu'à la fin de sa
-- réservation (3 h). Correctif à la source : un job pg_cron de la base, toutes
-- les 3 minutes, comme le filet de sécurité (0044), qui appelle la MÊME règle.
-- Une seule règle : sans_signe_de_vie / delai_signe (0043, 0046). Le corps du
-- balayage passe dans liberer_silencieux_coeur (sans contrôle d'appelant : pg_cron
-- n'a pas de jeton) ; liberer_silencieux (sessions) la garde et le délègue.
-- Sûretés : jamais un projet test-… (sauf p_test, banc) ; interrupteur par
-- projet (projets.liberation_auto) et global (filet_reglage.liberation_actif) ;
-- une passe qui échoue ne casse pas pg_cron. Le cron :
-- select * from cron.job where jobname = 'cockpit-liberation-auto'. Idempotente.

alter table cockpit.projets add column if not exists liberation_auto boolean not null default true;
alter table cockpit.filet_reglage add column if not exists liberation_actif boolean not null default true;

create or replace function cockpit.liberer_silencieux_coeur(p_projet text)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; c cockpit.chantiers; n integer := 0; v_min integer;
begin
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return 0; end if;
  for c in select * from cockpit.chantiers x
            where x.projet_id = pr.id and x.archived_at is null and x.pris_par is not null and x.pris_jusqu_a > now()
              and x.etat <> 'valide' and cockpit.sans_signe_de_vie(x)
            for update skip locked loop
    v_min := greatest(1, floor(extract(epoch from (now() - c.updated_at)) / 60))::int;
    -- La trace va sur la fiche, PAS dans le fil : un message de session dans le fil
    -- compterait comme une réponse à Raphaël (messages_sans_reponse, reponses_sans_suite).
    update cockpit.chantiers set pris_jusqu_a = now(), libere_at = now(), libere_de = c.pris_par, libere_apres_min = v_min where id = c.id;
    update cockpit.messages set recu_at = null
     where chantier_id = c.id and recu_par = c.pris_par and recu_at is not null;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function cockpit.liberer_silencieux(p_projet text)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  return cockpit.liberer_silencieux_coeur(p_projet);
end $$;

-- La passe (pg_cron) : un balayage par projet vivant, hors tests. Renvoie une ligne par projet.
create or replace function cockpit.liberation_passe(p_slug text default null, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr record; v_out jsonb := '[]'::jsonb; v_n int;
begin
  if not coalesce((select liberation_actif from cockpit.filet_reglage where id = 1), true) then
    return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'global_eteint'));
  end if;
  for pr in select * from cockpit.projets p where p.actif and (p_slug is null or p.slug = p_slug) order by p.slug loop
    if cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false) then continue; end if;
    if not pr.liberation_auto then
      v_out := v_out || jsonb_build_object('projet', pr.slug, 'resultat', 'eteint');
      continue;
    end if;
    v_n := cockpit.liberer_silencieux_coeur(pr.slug);
    if v_n > 0 then v_out := v_out || jsonb_build_object('projet', pr.slug, 'resultat', 'libere', 'n', v_n); end if;
  end loop;
  return v_out;
exception when others then
  return jsonb_build_array(jsonb_build_object('projet', null, 'resultat', 'erreur', 'detail', left(sqlerrm, 200)));
end $$;

-- Interrupteurs : par projet (projet = slug) ou global (projet null).
create or replace function cockpit.regler_liberation(p_projet text, p_actif boolean)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_projet is null then
    update cockpit.filet_reglage set liberation_actif = p_actif, updated_at = now() where id = 1;
    begin
      perform cron.alter_job(j.jobid, active := p_actif) from cron.job j where j.jobname = 'cockpit-liberation-auto';
    exception when others then null;
    end;
    return jsonb_build_object('global', p_actif);
  end if;
  update cockpit.projets set liberation_auto = p_actif where slug = p_projet;
  if not found then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'actif', p_actif);
end $$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron non installable ici (%) : la libération ne tournera pas seule', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cockpit-liberation-auto') then
      perform cron.unschedule('cockpit-liberation-auto');
    end if;
    perform cron.schedule('cockpit-liberation-auto', '*/3 * * * *', 'select cockpit.liberation_passe()');
  end if;
end $$;

revoke all on function cockpit.liberer_silencieux_coeur(text), cockpit.liberer_silencieux(text), cockpit.liberation_passe(text, boolean),
  cockpit.regler_liberation(text, boolean) from public, anon, authenticated;
grant execute on function cockpit.liberer_silencieux_coeur(text), cockpit.liberer_silencieux(text), cockpit.liberation_passe(text, boolean) to service_role;
grant execute on function cockpit.regler_liberation(text, boolean) to authenticated, service_role;
