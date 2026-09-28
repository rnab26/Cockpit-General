-- Cockpit — schéma de base (28 sept. 2026).
--
-- Un seul projet Supabase central pour tous les cockpits (décision D-02) :
-- tout vit dans le schéma `cockpit`, jamais dans `public`, pour ne pas se
-- mélanger aux tables de Jarvis et du Trieur qui partagent ce projet.
-- Le cycle de vie d'un chantier est une COLONNE (`etat`), plus jamais un
-- marqueur entre crochets en tête de note (décision D-04, trois bugs payés
-- sur Jarvis). Le principe est celui du Trieur : la session amène le
-- chantier à « à vérifier », seul un humain pose « validé » (D-05).
--
-- Appliqué avec scripts/sql.sh (exec_sql, clé service_role). Idempotent :
-- rejouer ce fichier ne casse rien.

create schema if not exists cockpit;

-- ---------------------------------------------------------------- projets
create table if not exists cockpit.projets (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  nom         text not null,
  description text,
  depot       text,                      -- ex. rnab26/Facepro
  url_site    text,                      -- où le module embarqué est branché
  couleur     text,                      -- teinte de l'onglet projet (hex)
  actif       boolean not null default true,
  -- Clé du module embarqué (script <cockpit-embed>) : identifie le projet
  -- côté fonction serveur, jamais un droit direct sur la base.
  cle_embed   text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now()
);

-- Qui voit quoi : un admin voit tout ; un utilisateur ne voit que ses projets.
create table if not exists cockpit.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note    text,
  created_at timestamptz not null default now()
);

create table if not exists cockpit.membres (
  projet_id uuid not null references cockpit.projets (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'utilisateur'
            check (role in ('utilisateur')),
  created_at timestamptz not null default now(),
  primary key (projet_id, user_id)
);

create or replace function cockpit.est_admin()
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.admins where user_id = auth.uid());
$$;

create or replace function cockpit.est_membre(p_projet uuid)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select cockpit.est_admin()
      or exists (select 1 from cockpit.membres
                 where projet_id = p_projet and user_id = auth.uid());
$$;

-- --------------------------------------------------------------- sections
-- Une section range des chantiers. Texte libre côté chantier (theme) était
-- la dérive de Jarvis ; ici la section est une vraie ligne, avec un ordre.
create or replace function cockpit.cle_section(p_nom text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(p_nom, ''),
      'àâäáãåéèêëíìîïóòôöõúùûüçñýÿ''’',
      'aaaaaaeeeeiiiiooooouuuucnyy  ')),
    '[^a-z0-9]+', '-', 'g'));
$$;

create table if not exists cockpit.sections (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references cockpit.projets (id) on delete cascade,
  nom         text not null,
  cle         text generated always as (cockpit.cle_section(nom)) stored,
  description text,
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (projet_id, cle)
);

-- -------------------------------------------------------------- chantiers
create table if not exists cockpit.chantiers (
  id           uuid primary key default gen_random_uuid(),
  projet_id    uuid not null references cockpit.projets (id) on delete cascade,
  section_id   uuid references cockpit.sections (id) on delete set null,
  titre        text not null,
  -- Ce qui est demandé (les mots de la personne). Grossit à chaque
  -- correction, sur la MÊME ligne (règle du Trieur : jamais un doublon).
  demande      text,
  -- Les notes de travail des sessions (texte libre, plus de marqueur).
  notes        text,
  -- Résumé en langage simple, écrit une fois le chantier livré.
  resume_simple text,
  etat         text not null default 'a_trier'
               check (etat in ('a_trier','a_cadrer','libre','en_cours',
                               'a_verifier','valide','bloque','reporte')),
  priorite     text not null default 'normale'
               check (priorite in ('basse','normale','haute')),
  origine      text not null default 'proprietaire'
               check (origine in ('proprietaire','utilisateur','session')),
  -- Faux = interne (un utilisateur final ne le voit pas, D-05 « ce qui est
  -- vraiment interne »).
  visible_utilisateurs boolean not null default true,
  -- Capture de quoi rejouer le scénario (D-05, instruit plus tard) :
  -- réglages, entrées, suite d'actions. Présent dès la v1 pour ne pas
  -- migrer le jour où on s'en sert.
  reproduction jsonb,
  -- Doublon fusionné dans un autre chantier.
  doublon_de   uuid references cockpit.chantiers (id) on delete set null,
  -- Réservation par une session (atomique, expire toute seule).
  pris_par     text,
  pris_jusqu_a timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  livre_at     timestamptz,     -- passage à « à vérifier »
  valide_at    timestamptz,
  valide_par   text,
  archived_at  timestamptz
);

create index if not exists chantiers_projet_etat_idx
  on cockpit.chantiers (projet_id, etat) where archived_at is null;
create index if not exists chantiers_section_idx
  on cockpit.chantiers (section_id) where archived_at is null;
create index if not exists chantiers_pris_idx
  on cockpit.chantiers (pris_jusqu_a) where pris_jusqu_a is not null;

-- --------------------------------------------------------------- messages
-- Le fil d'un chantier : ce que la session fait (info), ce qu'elle demande
-- (question, avec options cliquables), ce que l'humain répond (reponse),
-- une action attendue de l'humain (action, avec etat fait/pas_encore/bloque),
-- un constat (« ça marche » / « ça ne marche pas »), un blocage.
create table if not exists cockpit.messages (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references cockpit.projets (id) on delete cascade,
  chantier_id uuid references cockpit.chantiers (id) on delete cascade,
  auteur      text not null,
  auteur_type text not null default 'session'
              check (auteur_type in ('proprietaire','utilisateur','session')),
  kind        text not null default 'info'
              check (kind in ('info','question','reponse','blocage','action','constat')),
  corps       text not null,
  pourquoi    text,
  options     jsonb,          -- [{"libelle":..,"aide":..,"recommande":bool}]
  reponse     text,           -- libellé choisi (ou texte libre)
  precision   text,           -- complément écrit par l'humain
  repond_a    uuid references cockpit.messages (id) on delete set null,
  etat        text check (etat in ('fait','pas_encore','bloque')),
  answered_at timestamptz,
  answered_by uuid,
  created_at  timestamptz not null default now()
);

create index if not exists messages_chantier_idx on cockpit.messages (chantier_id, created_at);
create index if not exists messages_projet_idx on cockpit.messages (projet_id, created_at desc);
create index if not exists messages_attente_idx on cockpit.messages (projet_id)
  where kind in ('question','action') and answered_at is null;

-- --------------------------------------------------------------- activite
-- La progression EN DIRECT d'une session sur un chantier (D-07) : une ligne
-- par (chantier, session), écrasée à chaque étape. C'est ce que l'app dessine
-- en barre, et ce que la session affiche chez elle (scripts/progression.sh).
create table if not exists cockpit.activite (
  id            uuid primary key default gen_random_uuid(),
  projet_id     uuid not null references cockpit.projets (id) on delete cascade,
  chantier_id   uuid references cockpit.chantiers (id) on delete cascade,
  session       text not null,
  etape         text not null,
  pourcentage   int  not null default 0 check (pourcentage between 0 and 100),
  eta_secondes  int,                       -- null = inconnu, jamais 0
  statut        text not null default 'en_cours'
                check (statut in ('en_cours','termine','echec','attente')),
  detail        text,
  demarre_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (chantier_id, session)
);
create index if not exists activite_projet_idx on cockpit.activite (projet_id, updated_at desc);

-- ------------------------------------------------------------- historique
-- Rien ne s'écrase : chaque changement de champ est tracé (leçon Jarvis).
create table if not exists cockpit.historique (
  id          bigserial primary key,
  chantier_id uuid not null,
  champ       text not null,
  ancienne    text,
  nouvelle    text,
  par         text,
  changed_at  timestamptz not null default now()
);
create index if not exists historique_chantier_idx on cockpit.historique (chantier_id, changed_at desc);

create or replace function cockpit.tracer_chantier()
returns trigger language plpgsql as $$
declare
  v_par text := coalesce(current_setting('cockpit.par', true), 'inconnu');
  c text;
begin
  new.updated_at := now();
  foreach c in array array['titre','demande','notes','resume_simple','etat',
                           'priorite','section_id','archived_at','visible_utilisateurs']
  loop
    if to_jsonb(old) -> c is distinct from to_jsonb(new) -> c then
      insert into cockpit.historique (chantier_id, champ, ancienne, nouvelle, par)
      values (old.id, c, to_jsonb(old) ->> c, to_jsonb(new) ->> c, v_par);
    end if;
  end loop;
  if new.etat = 'a_verifier' and old.etat is distinct from 'a_verifier' then
    new.livre_at := now();
  end if;
  return new;
end $$;

drop trigger if exists chantiers_tracer on cockpit.chantiers;
create trigger chantiers_tracer before update on cockpit.chantiers
  for each row execute function cockpit.tracer_chantier();

-- Une suppression laisse une trace hors cascade (leçon Jarvis, migration 0036).
create table if not exists cockpit.supprimes (
  id          bigserial primary key,
  chantier_id uuid not null,
  projet_id   uuid not null,
  ligne       jsonb not null,
  par         text,
  deleted_at  timestamptz not null default now()
);

create or replace function cockpit.tracer_suppression()
returns trigger language plpgsql as $$
begin
  insert into cockpit.supprimes (chantier_id, projet_id, ligne, par)
  values (old.id, old.projet_id, to_jsonb(old),
          coalesce(current_setting('cockpit.par', true), 'inconnu'));
  return old;
end $$;

drop trigger if exists chantiers_tracer_suppression on cockpit.chantiers;
create trigger chantiers_tracer_suppression before delete on cockpit.chantiers
  for each row execute function cockpit.tracer_suppression();

-- ------------------------------------------------------ ce qui marche, vu
create table if not exists cockpit.ce_qui_marche (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references cockpit.projets (id) on delete cascade,
  chantier_id uuid references cockpit.chantiers (id) on delete set null,
  texte       text not null,
  par         text,
  created_at  timestamptz not null default now()
);

create table if not exists cockpit.visites (
  user_id   uuid not null references auth.users (id) on delete cascade,
  projet_id uuid not null references cockpit.projets (id) on delete cascade,
  vu_at     timestamptz not null default now(),
  primary key (user_id, projet_id)
);

-- Préférences d'affichage par personne (fenêtre « livré », etc.) : jamais
-- une valeur en dur dans l'app.
create table if not exists cockpit.preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  cle     text not null,
  valeur  jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, cle)
);

-- Sessions autonomes : la table existe dès la v1 (D-10), le mécanisme suit.
create table if not exists cockpit.passes_autonomes (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid references cockpit.projets (id) on delete cascade,
  session     text not null,
  verdict     text not null
              check (verdict in ('travaille','eteint','occupe','rien_a_prendre','il_a_repondu')),
  chantier_id uuid references cockpit.chantiers (id) on delete set null,
  detail      text,
  demarre_at  timestamptz not null default now(),
  termine_at  timestamptz
);

-- ------------------------------------------------------------- fonctions
-- Réservation atomique : deux sessions en même temps, une seule obtient true.
create or replace function cockpit.reserver_chantier(p_id uuid, p_par text, p_minutes int default 120)
returns boolean language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare pris boolean;
begin
  update cockpit.chantiers
     set pris_par = p_par,
         pris_jusqu_a = now() + make_interval(mins => greatest(p_minutes, 1)),
         etat = case when etat in ('libre','a_trier') then 'en_cours' else etat end
   where id = p_id
     and archived_at is null
     and (pris_par is null or pris_jusqu_a < now() or pris_par = p_par)
  returning true into pris;
  return coalesce(pris, false);
end $$;

create or replace function cockpit.liberer_chantier(p_id uuid, p_par text)
returns boolean language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare ok boolean;
begin
  update cockpit.chantiers
     set pris_par = null, pris_jusqu_a = null,
         etat = case when etat = 'en_cours' then 'libre' else etat end
   where id = p_id and pris_par = p_par
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- Progression en direct : une ligne par (chantier, session), écrasée.
create or replace function cockpit.signaler_activite(
  p_projet text, p_chantier uuid, p_session text, p_etape text,
  p_pourcentage int default null, p_eta int default null,
  p_statut text default 'en_cours', p_detail text default null)
returns cockpit.activite language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid; r cockpit.activite;
begin
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  insert into cockpit.activite (projet_id, chantier_id, session, etape, pourcentage, eta_secondes, statut, detail)
  values (v_projet, p_chantier, p_session, p_etape, coalesce(p_pourcentage, 0), p_eta, p_statut, p_detail)
  on conflict (chantier_id, session) do update
     set etape = excluded.etape,
         pourcentage = coalesce(p_pourcentage, cockpit.activite.pourcentage),
         eta_secondes = p_eta,
         statut = excluded.statut,
         detail = coalesce(p_detail, cockpit.activite.detail),
         updated_at = now()
  returning * into r;
  return r;
end $$;

-- Certifier / corriger : les deux gestes de l'humain sur un chantier livré.
-- « Corriger » complète la demande sur la même ligne et rend le chantier à
-- la session (etat en_cours si une session le tient encore, sinon libre).
create or replace function cockpit.certifier_chantier(p_id uuid, p_par text, p_mots text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_titre text;
begin
  perform set_config('cockpit.par', coalesce(p_par, 'humain'), true);
  update cockpit.chantiers
     set etat = 'valide', valide_at = now(), valide_par = p_par,
         archived_at = coalesce(archived_at, now()),
         pris_par = null, pris_jusqu_a = null
   where id = p_id and etat = 'a_verifier'
  returning projet_id, titre into v_projet, v_titre;
  if v_projet is null then raise exception 'ce chantier n''est pas « à vérifier »'; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_id, p_par, 'proprietaire', 'constat',
          coalesce(nullif(p_mots, ''), 'Ça fonctionne, je certifie.'));
  insert into cockpit.ce_qui_marche (projet_id, chantier_id, texte, par)
  values (v_projet, p_id, v_titre || case when nullif(p_mots,'') is null then '' else ' — ' || p_mots end, p_par);
end $$;

create or replace function cockpit.corriger_chantier(p_id uuid, p_par text, p_mots text)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid;
begin
  if nullif(trim(p_mots), '') is null then raise exception 'dis ce qui ne marche pas'; end if;
  perform set_config('cockpit.par', coalesce(p_par, 'humain'), true);
  update cockpit.chantiers
     set demande = coalesce(demande, '') || E'\n\n--- Correction du ' || to_char(now(), 'DD/MM/YYYY HH24:MI')
                   || E' (livré mais ne fonctionne pas comme attendu) ---\n' || p_mots,
         etat = case when pris_par is not null and pris_jusqu_a > now() then 'en_cours' else 'libre' end,
         archived_at = null, valide_at = null, valide_par = null
   where id = p_id and etat in ('a_verifier','valide')
  returning projet_id into v_projet;
  if v_projet is null then raise exception 'ce chantier n''est ni « à vérifier » ni « validé »'; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_id, p_par, 'proprietaire', 'constat', 'Ça ne marche pas : ' || p_mots);
end $$;

-- Répondre à une question ou poser l'état d'une action.
create or replace function cockpit.repondre_message(p_id uuid, p_par text, p_reponse text,
                                                    p_precision text default null, p_etat text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
begin
  update cockpit.messages
     set reponse = coalesce(p_reponse, reponse),
         precision = coalesce(p_precision, precision),
         etat = coalesce(p_etat, etat),
         answered_at = case when kind = 'action' and coalesce(p_etat, etat) <> 'fait' then answered_at else now() end,
         answered_by = auth.uid()
   where id = p_id and kind in ('question','action');
  if not found then raise exception 'message introuvable ou pas une question'; end if;
end $$;

-- Fusion de doublons : validée à la main (D-06), le doublon garde sa trace.
create or replace function cockpit.fusionner_chantiers(p_source uuid, p_cible uuid, p_par text, p_note text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_titre text;
begin
  if p_source = p_cible then raise exception 'même chantier'; end if;
  perform set_config('cockpit.par', coalesce(p_par, 'humain'), true);
  select projet_id, titre into v_projet, v_titre from cockpit.chantiers where id = p_source;
  update cockpit.messages set chantier_id = p_cible where chantier_id = p_source;
  update cockpit.chantiers
     set demande = coalesce(demande, '') || E'\n\n--- Fusion du doublon « ' || v_titre || ' » ---\n'
                   || coalesce((select demande from cockpit.chantiers where id = p_source), '')
                   || case when nullif(p_note, '') is null then '' else E'\nNote : ' || p_note end
   where id = p_cible;
  update cockpit.chantiers
     set doublon_de = p_cible, archived_at = now(), pris_par = null, pris_jusqu_a = null
   where id = p_source;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_cible, p_par, 'proprietaire', 'info',
          'Doublon fusionné : « ' || v_titre || ' »' || coalesce(' — ' || p_note, ''));
end $$;

-- Repère « vu » : ne recule jamais (leçon Jarvis).
create or replace function cockpit.marquer_vu(p_projet uuid)
returns timestamptz language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v timestamptz;
begin
  insert into cockpit.visites (user_id, projet_id, vu_at) values (auth.uid(), p_projet, now())
  on conflict (user_id, projet_id) do update set vu_at = greatest(cockpit.visites.vu_at, excluded.vu_at)
  returning vu_at into v;
  return v;
end $$;

-- Restaurer une note depuis l'historique (leçon Jarvis : sans ça la trace
-- ne sert à rien).
create or replace function cockpit.restaurer_champ(p_historique bigint, p_par text)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare h cockpit.historique;
begin
  select * into h from cockpit.historique where id = p_historique;
  if h.id is null then raise exception 'entrée introuvable'; end if;
  if h.champ not in ('titre','demande','notes','resume_simple') then
    raise exception 'on ne restaure que du texte, jamais un état';
  end if;
  perform set_config('cockpit.par', coalesce(p_par, 'humain') || ' (restauration)', true);
  execute format('update cockpit.chantiers set %I = $1 where id = $2', h.champ)
    using h.ancienne, h.chantier_id;
end $$;

-- -------------------------------------------------------------------- RLS
alter table cockpit.projets       enable row level security;
alter table cockpit.admins        enable row level security;
alter table cockpit.membres       enable row level security;
alter table cockpit.sections      enable row level security;
alter table cockpit.chantiers     enable row level security;
alter table cockpit.messages      enable row level security;
alter table cockpit.activite      enable row level security;
alter table cockpit.historique    enable row level security;
alter table cockpit.supprimes     enable row level security;
alter table cockpit.ce_qui_marche enable row level security;
alter table cockpit.visites       enable row level security;
alter table cockpit.preferences   enable row level security;
alter table cockpit.passes_autonomes enable row level security;

do $pol$
declare t text;
begin
  -- Admin : tout, sur toutes les tables.
  foreach t in array array['projets','admins','membres','sections','chantiers','messages',
                           'activite','historique','supprimes','ce_qui_marche','visites',
                           'preferences','passes_autonomes']
  loop
    execute format('drop policy if exists admin_tout on cockpit.%I', t);
    execute format('create policy admin_tout on cockpit.%I for all using (cockpit.est_admin()) with check (cockpit.est_admin())', t);
  end loop;
end $pol$;

-- Utilisateur final : ses projets, les chantiers visibles, ses réponses.
drop policy if exists membre_projets on cockpit.projets;
create policy membre_projets on cockpit.projets for select using (cockpit.est_membre(id));

drop policy if exists membre_sections on cockpit.sections;
create policy membre_sections on cockpit.sections for select using (cockpit.est_membre(projet_id));

drop policy if exists membre_chantiers_lit on cockpit.chantiers;
create policy membre_chantiers_lit on cockpit.chantiers for select
  using (visible_utilisateurs and cockpit.est_membre(projet_id));
drop policy if exists membre_chantiers_cree on cockpit.chantiers;
create policy membre_chantiers_cree on cockpit.chantiers for insert
  with check (cockpit.est_membre(projet_id) and origine = 'utilisateur' and etat = 'a_trier');

drop policy if exists membre_messages_lit on cockpit.messages;
create policy membre_messages_lit on cockpit.messages for select
  using (cockpit.est_membre(projet_id) and (chantier_id is null or exists (
    select 1 from cockpit.chantiers c where c.id = chantier_id and c.visible_utilisateurs)));
drop policy if exists membre_messages_ecrit on cockpit.messages;
create policy membre_messages_ecrit on cockpit.messages for insert
  with check (cockpit.est_membre(projet_id) and auteur_type = 'utilisateur'
              and kind in ('reponse','info'));

drop policy if exists membre_activite on cockpit.activite;
create policy membre_activite on cockpit.activite for select using (cockpit.est_membre(projet_id));

drop policy if exists membre_ce_qui_marche on cockpit.ce_qui_marche;
create policy membre_ce_qui_marche on cockpit.ce_qui_marche for select using (cockpit.est_membre(projet_id));

drop policy if exists soi_visites on cockpit.visites;
create policy soi_visites on cockpit.visites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists soi_preferences on cockpit.preferences;
create policy soi_preferences on cockpit.preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Droits d'exécution : les fonctions sont security definer, donc ce sont
-- elles qui gardent la porte (certifier n'accepte qu'un chantier à vérifier…).
grant usage on schema cockpit to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema cockpit to authenticated, service_role;
grant usage, select on all sequences in schema cockpit to authenticated, service_role;
grant execute on all functions in schema cockpit to authenticated, service_role;
revoke execute on function cockpit.signaler_activite(text, uuid, text, text, int, int, text, text) from authenticated;
alter default privileges in schema cockpit grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema cockpit grant execute on functions to authenticated, service_role;

-- --------------------------------------------------------------- temps réel
alter table cockpit.chantiers replica identity full;
alter table cockpit.messages  replica identity full;
alter table cockpit.activite  replica identity full;
alter table cockpit.sections  replica identity full;
do $rt$
begin
  begin alter publication supabase_realtime add table cockpit.chantiers; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table cockpit.messages;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table cockpit.activite;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table cockpit.sections;  exception when duplicate_object then null; end;
end $rt$;
