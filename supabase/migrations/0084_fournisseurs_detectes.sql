-- Le bouton « Chercher mes fournisseurs » de Coûts (13 oct. 2026, chantier 07258fe5).
--
-- Raphaël : « tu peux pas faire une recherche par mots-clés simplement plutôt que de lire toute la boîte mail ? Et moi tu me mets un
-- bouton où j'appuie et ça va chercher tous les noms des fournisseurs où je suis susceptible d'avoir des factures, et comme ça on
-- actualise. » Deux tables, rien d'autre :
--   recherches_fournisseurs : la DEMANDE (une seule ouverte par projet : dix touchers = une ligne). L'app la pose ; une session
--                             qui a Gmail la prend, cherche PAR MOTS-CLÉS (jamais toute la boîte : expéditeur, objet et date
--                             seulement, rien d'autre n'est gardé), puis la termine ou la déclare en échec.
--   fournisseurs_detectes   : ce que la recherche a trouvé, un fournisseur par ligne (clé = le domaine de l'expéditeur, ou
--                             « processeur:vendeur » quand le mail passe par Stripe, Paddle, PayPal… qui cachent le vendeur).
--                             Raphaël décide : « suivre » (le prestataire est créé dans Coûts) ou « ignorer » ; un fournisseur
--                             déjà suivi ou ignoré ne revient jamais « nouveau » à la recherche suivante.
-- Données internes : admin seulement (RLS admin_tout, aucune politique membre). Idempotente.

create table if not exists cockpit.recherches_fournisseurs (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references cockpit.projets(id) on delete cascade,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'en_cours', 'terminee', 'echec', 'annulee')),
  demandee_par text,
  demandee_at timestamptz not null default now(),
  pris_par text,
  pris_at timestamptz,
  fini_at timestamptz,
  trouves integer check (trouves is null or trouves >= 0),
  nouveaux integer check (nouveaux is null or nouveaux >= 0),
  note text check (note is null or length(note) <= 300)
);
create index if not exists recherches_fournisseurs_projet on cockpit.recherches_fournisseurs(projet_id, demandee_at desc);
-- UNE demande ouverte par projet : un deuxième toucher n'en crée pas une autre (l'app le dit).
create unique index if not exists recherches_fournisseurs_une_ouverte on cockpit.recherches_fournisseurs(projet_id) where statut in ('en_attente', 'en_cours');

create table if not exists cockpit.fournisseurs_detectes (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid not null references cockpit.projets(id) on delete cascade,
  cle text not null check (cle = lower(cle) and length(cle) between 3 and 120),
  nom text not null check (length(btrim(nom)) between 1 and 80),
  domaine text not null check (length(domaine) between 3 and 80),
  expediteur text check (expediteur is null or length(expediteur) <= 120),
  mails integer not null default 0 check (mails >= 0),
  premier_mail date,
  dernier_mail date,
  exemple_objet text check (exemple_objet is null or length(exemple_objet) <= 160),
  lecteur boolean not null default false,       -- cockpit sait lire les reçus de ce fournisseur (montants, PDF) : importer-recus.py
  statut text not null default 'nouveau' check (statut in ('nouveau', 'suivi', 'ignore')),
  service_id uuid references cockpit.services(id) on delete set null,
  recherche_id uuid references cockpit.recherches_fournisseurs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (projet_id, cle)
);
create index if not exists fournisseurs_detectes_service on cockpit.fournisseurs_detectes(service_id);
create index if not exists fournisseurs_detectes_recherche on cockpit.fournisseurs_detectes(recherche_id);

alter table cockpit.recherches_fournisseurs enable row level security;
alter table cockpit.fournisseurs_detectes enable row level security;
drop policy if exists admin_tout on cockpit.recherches_fournisseurs;
create policy admin_tout on cockpit.recherches_fournisseurs for all using (cockpit.est_admin()) with check (cockpit.est_admin());
drop policy if exists admin_tout on cockpit.fournisseurs_detectes;
create policy admin_tout on cockpit.fournisseurs_detectes for all using (cockpit.est_admin()) with check (cockpit.est_admin());

alter table cockpit.recherches_fournisseurs replica identity full;
alter table cockpit.fournisseurs_detectes replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table cockpit.recherches_fournisseurs; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table cockpit.fournisseurs_detectes; exception when duplicate_object then null; end;
end $$;

grant select, insert, update, delete on cockpit.recherches_fournisseurs, cockpit.fournisseurs_detectes to authenticated, service_role;

-- La date de modification suit toute écriture (affichage « vu il y a… » et ordre), comme les autres tables.
create or replace function cockpit.fournisseurs_detectes_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists fournisseurs_detectes_touch on cockpit.fournisseurs_detectes;
create trigger fournisseurs_detectes_touch before update on cockpit.fournisseurs_detectes for each row execute function cockpit.fournisseurs_detectes_touch();
revoke all on function cockpit.fournisseurs_detectes_touch() from public;
