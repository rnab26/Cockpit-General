-- 0077 — messages.updated_at : l'app ne relit plus les tables ENTIÈRES (chantier 9d83828c, 7 oct. 2026).
--
-- Raphaël : « mon cockpit fonctionne mal, tout ce que je clique, c'est lent ». Mesuré : chaque action
-- (≈ 40 écrans appellent recharger()) et chaque sondage relisaient messages + tâches + chantiers en entier
-- (≈ 2,9 Mo décodés). Pour ne relire que ce qui a changé, il faut pouvoir dire « modifié depuis X » :
-- chantiers (tracer_chantier), activite, sessions et taches le disent déjà ; messages non. Une colonne
-- datée à chaque écriture (création ET modification : réponse, reçu, retour, déplacement, état de carte…).
-- Idempotente, rien n'est réécrit (les lignes existantes prennent l'heure de la migration : elles sont
-- relues une fois au premier passage, puis plus jamais tant qu'elles ne bougent pas).
alter table cockpit.messages add column if not exists updated_at timestamptz not null default now();

create or replace function cockpit.tracer_message()
returns trigger language plpgsql set search_path = cockpit, public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function cockpit.tracer_message() from public;

drop trigger if exists messages_tracer on cockpit.messages;
create trigger messages_tracer before update on cockpit.messages
  for each row execute function cockpit.tracer_message();

create index if not exists messages_updated_at_idx on cockpit.messages (updated_at);
