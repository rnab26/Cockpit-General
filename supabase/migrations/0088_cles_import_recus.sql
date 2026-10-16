-- Reçus Claude par un programme du compte Google de Raphaël : la CLÉ qui ouvre la porte du cockpit (14 oct. 2026, chantier 72a8d0f4).
--
-- Raphaël (13 oct.) : « Configure-le que ce soit constant, c'est mieux » ; au choix « Programme dans ton compte Google » (14 oct.) :
-- gratuit, aucune IA sur sa boîte, le PDF de chaque facture. Un petit programme de son compte Google (Google Apps Script) lit,
-- en LECTURE SEULE, ses mails « Your receipt from Anthropic » et les envoie à la fonction serveur `cockpit-recus`, qui applique
-- la MÊME règle que scripts/importer-recus.py (refus en clair si un chiffre ne concorde pas, jamais deux fois la même facture).
-- Cette fonction est publique (aucun jeton de connexion : c'est un programme, pas une personne) ; la seule chose qui l'ouvre est
-- une clé par prestataire, créée ici, montrée UNE fois, révocable :
--   - la clé n'est jamais gardée : seulement son empreinte sha256 (comme les invitations, 0058) et ses 4 derniers caractères
--     (pour reconnaître quel programme porte quelle clé) ;
--   - UNE seule clé active par prestataire : en créer une nouvelle révoque l'ancienne (son programme cesse de marcher, l'écran le dit) ;
--   - une clé ne sait écrire que dans SON prestataire (projet + service sont portés par la ligne, jamais par la requête) ;
--   - `derniere_utilisation_at` et `programme_version` : l'écran voit si le programme a bien appelé, et s'il faut recopier une version
--     plus récente du programme (sans cela, une vieille copie dans le compte Google dériverait en silence).
-- Données internes : admin seulement (RLS admin_tout) ; l'écran lit la table, mais créer et révoquer passe par deux fonctions
-- réservées aux admins (la clé en clair n'existe que dans la réponse de `creer_cle_import`). Idempotente.

create table if not exists cockpit.cles_import (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references cockpit.projets(id) on delete cascade,
  service_id uuid not null references cockpit.services(id) on delete cascade,
  empreinte text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),
  fin text not null check (length(fin) = 4),
  creee_par uuid,
  created_at timestamptz not null default now(),
  revoquee_at timestamptz,
  derniere_utilisation_at timestamptz,
  utilisations integer not null default 0 check (utilisations >= 0),
  programme_version integer check (programme_version is null or programme_version between 1 and 1000)
);
create index if not exists cles_import_projet on cockpit.cles_import(projet_id);
-- UNE clé active par prestataire (les clés révoquées restent, pour l'historique).
create unique index if not exists cles_import_une_active on cockpit.cles_import(service_id) where revoquee_at is null;

alter table cockpit.cles_import enable row level security;
drop policy if exists admin_tout on cockpit.cles_import;
create policy admin_tout on cockpit.cles_import for all using (cockpit.est_admin()) with check (cockpit.est_admin());
alter table cockpit.cles_import replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table cockpit.cles_import; exception when duplicate_object then null; end;
end $$;
-- L'app LIT (le temps réel exige le droit de lecture sur la table entière ; l'empreinte, sha256 d'une clé de 244 bits, ne permet
-- pas de retrouver la clé, et la RLS réserve la table aux admins) ; elle n'écrit jamais en direct : créer et révoquer passent par
-- les deux fonctions ci-dessous.
revoke all on cockpit.cles_import from anon, authenticated;
grant select on cockpit.cles_import to authenticated;
grant select, insert, update, delete on cockpit.cles_import to service_role;

-- Crée la clé d'un prestataire et la rend EN CLAIR, une seule fois. Remplace (révoque) la précédente.
create or replace function cockpit.creer_cle_import(p_service uuid)
returns text language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_cle text;
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  select projet_id into v_projet from cockpit.services where id = p_service;
  perform cockpit.exiger(v_projet is not null, 'prestataire inconnu');
  update cockpit.cles_import set revoquee_at = now() where service_id = p_service and revoquee_at is null;
  v_cle := 'cki_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into cockpit.cles_import (projet_id, service_id, empreinte, fin, creee_par)
  values (v_projet, p_service, cockpit.hacher_jeton(v_cle), right(v_cle, 4), auth.uid());
  return v_cle;
end $$;

-- Révoque une clé : le programme qui la porte reçoit « clé révoquée » à son prochain passage. Rien n'est supprimé.
create or replace function cockpit.revoquer_cle_import(p_cle uuid)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin(), 'réservé aux admins');
  update cockpit.cles_import set revoquee_at = now() where id = p_cle and revoquee_at is null;
end $$;

do $$ declare f text; begin
  foreach f in array array['creer_cle_import(uuid)', 'revoquer_cle_import(uuid)'] loop
    execute format('revoke all on function cockpit.%s from public, anon', f);
    execute format('grant execute on function cockpit.%s to authenticated, service_role', f);
  end loop;
end $$;
