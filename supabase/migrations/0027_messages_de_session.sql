-- Ce que Raphaël écrit dans une SESSION arrive dans le fil du chantier (29 sept. 2026)
--
-- Raphaël (chantier FacePro 2190e53b) : « Les messages que j'envoie dans une
-- session claude pour des chantiers que j'ouvre ne sont pas importés dans le
-- chat du chantier en question du cockpit, du coup ça manque de clarté, on
-- s'y perd sur le contexte. »
--
-- Jusqu'ici, le fil d'un chantier ouvert depuis une session ne portait que la
-- demande RÉSUMÉE par Claude (chantier.sh --demande, bulle « Claude · la
-- demande ») et les étapes de Claude : ses propres mots, et toutes ses
-- relances dans la session, manquaient.
--
-- Règle :
--  - consigner_message_session(projet, session, branche, texte) : appelée par
--    le hook de suivi (UserPromptSubmit) pour chaque VRAI message de Raphaël
--    (ni notification, ni réveil, ni consigne de renfort : filtré par le hook).
--    Le message est déposé, tel quel (secrets évidents masqués), dans le fil de
--    chaque chantier que la session tient (pris_par = sa branche), et gardé
--    15 min en attente : si la session prend un chantier juste après (cas
--    normal : il demande, Claude ouvre le chantier), le trigger
--    chantiers_messages_session le rattache à ce chantier aussi, à l'heure où il
--    a été écrit.
--  - messages.via_session = true marque ces messages. Ils sont DÉJÀ lus par la
--    session et Claude y a répondu dans la session : ce ne sont PAS des
--    « messages libres » qui attendent une réponse dans le fil
--    (est_message_libre les exclut, même règle dans l'app : discussion.ts), et
--    le hook ne les remet jamais à la session comme « il t'écrit ».
-- Idempotente.

alter table cockpit.messages add column if not exists via_session boolean not null default false;

create table if not exists cockpit.messages_session_attente (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references cockpit.projets (id) on delete cascade,
  session_id  text not null,
  branche     text not null,
  texte       text not null,
  chantiers   uuid[] not null default '{}',   -- fils où il a déjà été déposé
  created_at  timestamptz not null default now()
);
create index if not exists messages_session_attente_idx on cockpit.messages_session_attente (projet_id, branche, created_at desc);
alter table cockpit.messages_session_attente enable row level security;
drop policy if exists admin_tout on cockpit.messages_session_attente;
create policy admin_tout on cockpit.messages_session_attente for all to authenticated using (cockpit.est_admin()) with check (cockpit.est_admin());

-- Même définition que 0025, plus : un message venu d'une session n'attend rien.
-- MÊME règle dans l'app : app/src/lib/discussion.ts (estMessageLibre) ;
-- verifier-base.mjs §26 et §28 comparent les deux sur les mêmes lignes.
create or replace function cockpit.est_message_libre(m cockpit.messages)
returns boolean language sql stable set search_path = cockpit, pg_temp as $$
  select m.auteur_type in ('proprietaire', 'utilisateur')
     and m.kind in ('info', 'constat', 'reponse')
     and not coalesce(m.via_session, false)
     -- Un constat vient d'un bouton : seul « Ça ne marche pas : … » (Corriger)
     -- attend une réponse ; « Ça fonctionne » et « vérifie pour moi » sont servis ailleurs.
     and (m.kind <> 'constat' or m.corps like 'Ça ne marche pas : %')
     and not coalesce(m.ou_en_est, false)
     and m.corps not like 'Doublon fusionné : %'
     -- Les pièces jointes d'une réponse à une question (0013 : message juste après).
     and not (jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0 and exists (
           select 1 from cockpit.messages q where q.projet_id = m.projet_id and q.chantier_id is not distinct from m.chantier_id
              and q.kind in ('question', 'action') and q.answered_at is not null
              and m.created_at between q.answered_at - interval '5 seconds' and q.answered_at + interval '2 minutes'));
$$;

-- Les secrets évidents (clés d'API, jetons, JWT) ne partent jamais dans la base,
-- même collés par erreur dans une session.
create or replace function cockpit.masquer_secrets(p_texte text)
returns text language sql immutable set search_path = cockpit, pg_temp as $$
  select regexp_replace(regexp_replace(regexp_replace(coalesce(p_texte, ''),
    '\m(sk|pk|rk|ghp|gho|ghs|ghu|github_pat|glpat|xox[abpr]|sb_secret|AKIA)[-_A-Za-z0-9]{12,}', '[secret masqué]', 'g'),
    '\meyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', '[secret masqué]', 'g'),
    '(Bearer|Authorization:)\s+[A-Za-z0-9._~+/=-]{16,}', '\1 [secret masqué]', 'gi');
$$;

-- Dépose une ligne en attente dans le fil d'un chantier (une seule fois par fil).
create or replace function cockpit.deposer_message_session(a cockpit.messages_session_attente, p_chantier uuid)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if p_chantier = any(a.chantiers) then return; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session, recu_at, recu_par, created_at)
  values (a.projet_id, p_chantier, 'Raphaël (session Claude)', 'proprietaire', 'info', a.texte, true, a.created_at, a.branche, a.created_at);
  update cockpit.messages_session_attente set chantiers = chantiers || p_chantier where id = a.id;
end $$;

create or replace function cockpit.consigner_message_session(p_projet text, p_session text, p_branche text, p_texte text)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_pid uuid; v_texte text; a cockpit.messages_session_attente; c record; n int := 0;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  v_texte := left(btrim(cockpit.masquer_secrets(p_texte)), 4000);
  if v_texte = '' or nullif(btrim(coalesce(p_branche, '')), '') is null or nullif(btrim(coalesce(p_session, '')), '') is null then return 0; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return 0; end if;
  -- Ménage : l'attente ne sert que 15 min (on garde un jour, pour relire au besoin).
  delete from cockpit.messages_session_attente where created_at < now() - interval '1 day';
  insert into cockpit.messages_session_attente (projet_id, session_id, branche, texte)
  values (v_pid, p_session, p_branche, v_texte) returning * into a;
  for c in select id from cockpit.chantiers
            where projet_id = v_pid and pris_par = p_branche and pris_jusqu_a > now()
              and archived_at is null and doublon_de is null loop
    perform cockpit.deposer_message_session(a, c.id);
    select * into a from cockpit.messages_session_attente where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- La session prend un chantier (ouvrir_ou_reprendre, reserver_chantier…) : ses
-- messages des 15 dernières minutes le rejoignent. Toutes voies, sans toucher
-- à ces fonctions.
create or replace function cockpit.chantiers_messages_session()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare a cockpit.messages_session_attente;
begin
  if new.pris_par is null or new.archived_at is not null or new.doublon_de is not null then return null; end if;
  if tg_op = 'UPDATE' and old.pris_par is not distinct from new.pris_par then return null; end if;
  for a in select * from cockpit.messages_session_attente
            where projet_id = new.projet_id and branche = new.pris_par and created_at > now() - interval '15 minutes'
            order by created_at loop
    perform cockpit.deposer_message_session(a, new.id);
  end loop;
  return null;
end $$;

drop trigger if exists chantiers_messages_session on cockpit.chantiers;
create trigger chantiers_messages_session after insert or update of pris_par on cockpit.chantiers
  for each row execute function cockpit.chantiers_messages_session();

revoke all on function cockpit.masquer_secrets(text), cockpit.deposer_message_session(cockpit.messages_session_attente, uuid),
  cockpit.consigner_message_session(text, text, text, text), cockpit.chantiers_messages_session() from public, anon, authenticated;
grant execute on function cockpit.masquer_secrets(text), cockpit.deposer_message_session(cockpit.messages_session_attente, uuid),
  cockpit.consigner_message_session(text, text, text, text) to service_role;

-- Interne : ce qu'il écrit dans ses sessions n'est jamais lu par un utilisateur
-- final (membre du projet). Même filtre dans la fonction cockpit-embed
-- (supabase/functions/cockpit-embed/index.ts, actionEtat). L'admin lit tout
-- par sa propre politique.
drop policy if exists membre_messages_lit on cockpit.messages;
create policy membre_messages_lit on cockpit.messages for select
  using (cockpit.est_membre(projet_id) and not via_session and (chantier_id is null or exists (
    select 1 from cockpit.chantiers c where c.id = chantier_id and c.visible_utilisateurs)));
