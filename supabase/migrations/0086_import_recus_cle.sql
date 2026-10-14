-- Reçus Claude lus par un petit programme du compte Google de Raphaël (Google Apps Script) : sa clé (14 oct. 2026, chantier 72a8d0f4).
--
-- Raphaël (14/10) : « Programme dans ton compte Google » pour les reçus Claude en continu : gratuit, aucune IA sur sa boîte, PDF de toutes
-- les factures. Le programme lit SEULEMENT les mails de reçus Anthropic (lecture seule) et les envoie à la fonction `cockpit-recus`,
-- qui applique la même règle que scripts/importer-recus.py et écrit dans Coûts. Il faut donc une clé qui dise « ce programme parle
-- pour CE prestataire de CE projet » et rien d'autre : une clé par prestataire, jamais celle d'un utilisateur ni la clé de service.
--   import_cle_hash : sha256 de la clé (la clé elle-même n'est jamais gardée : elle n'est rendue qu'une fois, à l'admin qui la demande).
--   import_cle_at   : quand elle a été créée (l'écran dit « branché le … »).
-- brancher_import_recus(service)   : admin seulement ; crée (ou REMPLACE) la clé, fixe la cadence à 7 jours si rien n'est noté.
-- debrancher_import_recus(service) : admin seulement ; retire la clé (le programme ne peut plus rien écrire) et la cadence.
-- Données internes : la table `services` est déjà réservée aux admins (RLS admin_tout). Idempotente.

alter table cockpit.services add column if not exists import_cle_hash text;
alter table cockpit.services add column if not exists import_cle_at timestamptz;
create unique index if not exists services_import_cle_hash on cockpit.services (import_cle_hash) where import_cle_hash is not null;

create or replace function cockpit.brancher_import_recus(p_service uuid)
returns text language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_cle text;
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  perform cockpit.exiger(exists (select 1 from cockpit.services where id = p_service and archived_at is null), 'prestataire introuvable');
  v_cle := 'rc_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update cockpit.services
     set import_cle_hash = cockpit.hacher_jeton(v_cle), import_cle_at = now(),
         import_cadence_jours = coalesce(import_cadence_jours, 7)
   where id = p_service;
  return v_cle;
end $$;

create or replace function cockpit.debrancher_import_recus(p_service uuid)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  update cockpit.services set import_cle_hash = null, import_cle_at = null, import_cadence_jours = null where id = p_service;
end $$;

revoke all on function cockpit.brancher_import_recus(uuid) from public, anon;
revoke all on function cockpit.debrancher_import_recus(uuid) from public, anon;
grant execute on function cockpit.brancher_import_recus(uuid) to authenticated;
grant execute on function cockpit.debrancher_import_recus(uuid) to authenticated;
