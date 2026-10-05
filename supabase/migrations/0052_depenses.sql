-- Dépenses et prestataires d'un projet (5 oct. 2026, chantier 41127de1)
--
-- Raphaël : « chaque cockpit doit avoir une vue et un accès direct à tous les
-- services concernant un projet, pouvoir consulter / télécharger les factures,
-- suivre les coûts (RunPod…), le solde d'un compte, une vue journalière /
-- hebdo / mensuelle / annuelle, et envoyer les factures à la compta en un
-- clic, avec des signes de traitement. »
--
--  - services  : un prestataire du projet (nom, liens directs, solde, seuil d'alerte) ;
--  - depenses  : une ligne de coût (facture, consommation, recharge) + son
--    fichier (stockage privé `cockpit-medias`, dossier `<projet>/depenses/`,
--    lisible par les ADMINS seulement : `peut_lire_media` ne connaît que
--    « projet » et un chantier visible) + son état comptable ;
--  - projets.compta_* : où partent les factures (e-mail, WhatsApp, autre).
-- Donnée INTERNE : admin seulement (RLS admin_tout, aucune politique membre).
-- Aucun envoi côté serveur : l'envoi est un geste de Raphaël (partage de son
-- téléphone), le cockpit ne fait que consigner qu'il l'a fait.

create table if not exists cockpit.services (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references cockpit.projets(id) on delete cascade,
  nom text not null check (length(btrim(nom)) between 1 and 80),
  url_tableau text check (url_tableau is null or url_tableau ~ '^https://'),
  url_factures text check (url_factures is null or url_factures ~ '^https://'),
  devise text not null default 'USD' check (devise ~ '^[A-Z]{3}$'),
  solde numeric,
  solde_at timestamptz,
  seuil_alerte numeric check (seuil_alerte is null or seuil_alerte >= 0),
  note text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists services_projet on cockpit.services(projet_id);

create table if not exists cockpit.depenses (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references cockpit.projets(id) on delete cascade,
  service_id uuid references cockpit.services(id) on delete set null,
  date date not null default current_date,
  montant numeric not null check (montant >= 0),
  devise text not null default 'USD' check (devise ~ '^[A-Z]{3}$'),
  type text not null default 'facture' check (type in ('facture', 'consommation', 'recharge')),
  description text not null default '',
  reference text,
  fichier jsonb,                               -- {chemin, nom, type, taille} dans cockpit-medias
  compta_statut text not null default 'a_envoyer' check (compta_statut in ('a_envoyer', 'envoye', 'sans_objet')),
  compta_at timestamptz,
  compta_par text,
  compta_canal text,
  created_at timestamptz not null default now()
);
create index if not exists depenses_projet_date on cockpit.depenses(projet_id, date desc);

alter table cockpit.projets add column if not exists compta_canal text check (compta_canal is null or compta_canal in ('email', 'whatsapp', 'autre'));
alter table cockpit.projets add column if not exists compta_destinataire text check (compta_destinataire is null or length(compta_destinataire) <= 200);

alter table cockpit.services enable row level security;
alter table cockpit.depenses enable row level security;
drop policy if exists admin_tout on cockpit.services;
create policy admin_tout on cockpit.services for all using (cockpit.est_admin()) with check (cockpit.est_admin());
drop policy if exists admin_tout on cockpit.depenses;
create policy admin_tout on cockpit.depenses for all using (cockpit.est_admin()) with check (cockpit.est_admin());

alter table cockpit.services replica identity full;
alter table cockpit.depenses replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table cockpit.services; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table cockpit.depenses; exception when duplicate_object then null; end;
end $$;

grant select, insert, update, delete on cockpit.services, cockpit.depenses to authenticated, service_role;
