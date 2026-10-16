-- 0090 : un descriptif clair sous le titre de chaque chantier (14 oct. 2026, chantier 34ebaaf3).
-- Raphaël : « sur les chantiers mis de côté j'ai le titre mais je ne comprends pas toujours le but ».
-- descriptif = UNE phrase simple (<= 160 car.) ; descriptif_detail = le texte plus long, au toucher.
-- Écrits par la session (chantier.sh --decrire) ou par lui (écran « Modifier »). Idempotente.
alter table cockpit.chantiers add column if not exists descriptif text;
alter table cockpit.chantiers add column if not exists descriptif_detail text;

create or replace function cockpit.decrire_chantier(p_chantier uuid, p_court text, p_detail text, p_par text default 'session')
returns boolean language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux admins');
  if nullif(trim(p_court), '') is null then raise exception 'descriptif vide'; end if;
  if length(trim(p_court)) > 160 then raise exception 'descriptif trop long (160 caractères au plus)'; end if;
  if length(coalesce(p_detail, '')) > 1500 then raise exception 'texte détaillé trop long (1500 caractères au plus)'; end if;
  perform set_config('cockpit.par', coalesce(p_par, 'session'), true);
  update cockpit.chantiers set descriptif = trim(p_court), descriptif_detail = nullif(trim(coalesce(p_detail, '')), '')
   where id = p_chantier;
  return found;
end $$;

revoke execute on function cockpit.decrire_chantier(uuid, text, text, text) from public;
grant execute on function cockpit.decrire_chantier(uuid, text, text, text) to service_role, authenticated;
