-- NOTIFICATIONS DE RÉPONSES (30 sept. 2026, chantier bff5a8cf)
--
-- Raphaël : « quand j'envoie un message […] je ne vois aucune notification
-- comme quoi il m'a répondu […] il faut aussi une notification push du
-- téléphone, à régler dans les paramètres, pour savoir quand on est en dehors
-- de l'application. »
--
-- Deux morceaux (le premier, la pastille « Réponse » dans l'app, ne touche pas
-- la base : préférences lu_fils / lu_depuis, lib/lecture.ts) :
--   push_config        UNE ligne : la clé publique VAPID (publique par nature)
--                      que l'app donne au navigateur pour s'abonner ;
--   push_abonnements   un abonnement par appareil (endpoint + clés du navigateur),
--                      posé et retiré par la personne elle-même (RLS : les siens) ;
--   trigger            sur une RÉPONSE de Claude (message de session avec repond_a,
--                      même règle que estReponseDeClaude) → appelle la fonction
--                      serveur `cockpit-push` par pg_net, après validation de la
--                      transaction. Jamais d'échec de l'écriture de la session à
--                      cause du push : toute erreur est avalée. Jamais pour un
--                      projet de test.
-- Le secret partagé trigger → fonction vit dans le COFFRE (vault), jamais dans
-- une table ; la clé privée VAPID n'est que dans les secrets de la fonction.
-- Mise en place (une fois) : scripts/installer-push.mjs. Idempotente.

create table if not exists cockpit.push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text not null,
  url_fonction  text not null,
  updated_at    timestamptz not null default now()
);
alter table cockpit.push_config enable row level security;
drop policy if exists admin_tout on cockpit.push_config;
create policy admin_tout on cockpit.push_config for all using (cockpit.est_admin()) with check (cockpit.est_admin());
drop policy if exists lecture_connecte on cockpit.push_config;
create policy lecture_connecte on cockpit.push_config for select to authenticated using (true);

create table if not exists cockpit.push_abonnements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint               text not null unique,
  p256dh                 text not null,
  auth                   text not null,
  appareil               text,
  created_at             timestamptz not null default now(),
  derniere_livraison_at  timestamptz,
  derniere_erreur        text
);
create index if not exists push_abonnements_user on cockpit.push_abonnements (user_id);
alter table cockpit.push_abonnements enable row level security;
alter table cockpit.push_abonnements replica identity full;
drop policy if exists admin_tout on cockpit.push_abonnements;
create policy admin_tout on cockpit.push_abonnements for all using (cockpit.est_admin()) with check (cockpit.est_admin());
drop policy if exists les_siens on cockpit.push_abonnements;
create policy les_siens on cockpit.push_abonnements for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Le déclencheur.
create or replace function cockpit.push_sur_reponse()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_url text; v_secret text;
begin
  begin
    if new.auteur_type <> 'session' or new.kind <> 'info' or new.repond_a is null then return null; end if;
    if cockpit.projet_de_test((select slug from cockpit.projets where id = new.projet_id)) then return null; end if;
    select url_fonction into v_url from cockpit.push_config where id = 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cockpit_push_secret';
    if v_url is null or v_secret is null then return null; end if;
    if not exists (select 1 from cockpit.push_abonnements) then return null; end if;
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('message_id', new.id),
      headers := jsonb_build_object('x-push-secret', v_secret, 'Content-Type', 'application/json'),
      timeout_milliseconds := 10000);
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function cockpit.push_sur_reponse() from public, anon, authenticated;
grant execute on function cockpit.push_sur_reponse() to service_role;

drop trigger if exists push_sur_reponse on cockpit.messages;
create trigger push_sur_reponse after insert on cockpit.messages
  for each row when (new.auteur_type = 'session' and new.repond_a is not null)
  execute function cockpit.push_sur_reponse();
