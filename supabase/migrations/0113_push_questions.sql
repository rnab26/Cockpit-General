-- Notification téléphone quand une question ou une action « À toi » est posée
-- (23 oct. 2026, Raphaël : « je ne reçois les notifications que quand je suis
-- activement sur l'application »). Jusqu'ici seul le type « reponse » partait
-- (migration 0039/0052) ; « a_toi » existait au catalogue avec emis = false.
-- Même mécanisme que push_sur_reponse : le trigger appelle la fonction cockpit-push
-- avec l'id du message, la fonction relit le texte en base et choisit les
-- destinataires par notif_destinataires (réglages de chacun, projet non coupé).
-- Idempotente (rejouable). Ne touche que le schéma cockpit.

create or replace function cockpit.push_sur_question()
returns trigger
language plpgsql
security definer
set search_path = cockpit, pg_temp
as $$
declare v_url text; v_secret text;
begin
  begin
    if new.auteur_type <> 'session' or new.kind not in ('question', 'action') or new.answered_at is not null then return null; end if;
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

revoke all on function cockpit.push_sur_question() from public;

drop trigger if exists push_sur_question on cockpit.messages;
create trigger push_sur_question
  after insert on cockpit.messages
  for each row
  when (new.auteur_type = 'session' and new.kind in ('question', 'action'))
  execute function cockpit.push_sur_question();

update cockpit.notif_types set emis = true where code = 'a_toi';
