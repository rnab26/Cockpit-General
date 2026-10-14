-- 0085 : un verdict dit dans une session arrive dans le cockpit (chantier cff4fbb9, 14 oct. 2026).
--
-- Raphaël : quand il écrit dans une session « ça marche » ou « ça ne marche pas » à propos d'un chantier
-- livré, le cockpit ne le savait pas : le chantier restait à tester. Règle gardée : SEUL LUI certifie.
-- La session recopie donc ses mots dans le fil et, pour « ça marche », pose une carte « Tu confirmes que
-- X marche ? » dans « À toi » (question à deux réponses prêtes) ; sa réponse « Oui » certifie, UN toucher.
-- Pour « ça ne marche pas » rien à confirmer : c'est la même demande que son bouton (poser_verification).
--  - messages.verdict_carte marque la carte ; UNE par chantier ouvert ;
--  - sa réponse n'est jamais « à reprendre » par la chef (est_reponse_automatique) : le déclencheur agit seul ;
--  - la carte se ferme seule si le chantier n'est plus « à vérifier » (certifié dans l'app, repris...) ;
--  - seul un ADMIN humain qui répond « Oui » certifie (une session qui répondrait n'a aucun effet).
-- Idempotent ; ne touche que le schéma cockpit ; aucun drop.
alter table cockpit.messages add column if not exists verdict_carte boolean not null default false;
create unique index if not exists messages_verdict_carte_ouverte on cockpit.messages (chantier_id)
  where verdict_carte and answered_at is null;

create or replace function cockpit.est_reponse_automatique(m cockpit.messages)
returns boolean
language sql immutable
set search_path = cockpit, pg_temp
as $$
  select (m.kind = 'action'
          and coalesce(m.reponse, '') ~ '^PR #[0-9]+ (pas prête|fusionnée ou fermée|propre|n[''’]est plus en conflit)')
      or coalesce(m.verdict_carte, false);
$$;
revoke all on function cockpit.est_reponse_automatique(cockpit.messages) from public, anon, authenticated;
grant execute on function cockpit.est_reponse_automatique(cockpit.messages) to service_role;

-- La session relaie ce que Raphaël a dit. Rend : 'carte posée' | 'carte déjà posée' | 'ne marche pas noté'.
create or replace function cockpit.relayer_verdict(p_chantier uuid, p_session text, p_ok boolean, p_mots text)
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; v_mots text; v_par text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into c from cockpit.chantiers where id = p_chantier;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  if c.etat <> 'a_verifier' or c.archived_at is not null then
    raise exception 'ce chantier n''est pas « à vérifier » (état : %) : rien à relayer', c.etat;
  end if;
  v_mots := left(btrim(cockpit.masquer_secrets(p_mots)), 1000);
  if v_mots = '' then raise exception 'recopie ses mots (le verdict tel qu''il l''a dit)'; end if;
  v_par := coalesce(nullif(p_session, ''), 'session');
  -- ses mots, tels quels, dans le fil (message de session : jamais pris pour un message libre à servir)
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session)
  values (c.projet_id, c.id, 'Raphaël (session Claude)', 'proprietaire', 'info',
          case when p_ok then 'Dit dans la session : ' else 'Dit dans la session, ça ne marche pas : ' end || v_mots, true);
  if not p_ok then
    perform cockpit.poser_verification(c.id, 'Raphaël (session Claude)', v_mots, 'ne_marche_pas');
    return 'ne marche pas noté';
  end if;
  if exists (select 1 from cockpit.messages where chantier_id = c.id and verdict_carte and answered_at is null) then
    return 'carte déjà posée';
  end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options, verdict_carte)
  values (c.projet_id, c.id, v_par, 'session', 'question',
          'Tu confirmes que « ' || left(c.titre, 80) || ' » marche ?',
          'Tu l''as dit dans la session. Seul toi certifies : un toucher suffit.',
          jsonb_build_array(
            jsonb_build_object('libelle', 'Oui, ça marche', 'aide', 'Le chantier est certifié.', 'recommande', true),
            jsonb_build_object('libelle', 'Non, ça ne marche pas', 'aide', 'Claude rejoue le cas et te répond ici.', 'recommande', false)),
          true);
  return 'carte posée';
end $$;
revoke all on function cockpit.relayer_verdict(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function cockpit.relayer_verdict(uuid, text, boolean, text) to service_role;

-- Sa réponse sur la carte : « Oui » certifie, « Non » demande la vérification. Seulement un admin humain.
create or replace function cockpit.verdict_carte_repondue() returns trigger
language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if not (new.verdict_carte and new.answered_at is not null and old.answered_at is null and new.chantier_id is not null) then return new; end if;
  if not cockpit.est_admin() or auth.uid() is null then return new; end if;
  if new.reponse like 'Oui%' then
    perform cockpit.certifier_chantier(new.chantier_id, 'Raphaël', 'Ça marche (confirmé depuis la carte, après l''avoir dit dans la session).');
  elsif new.reponse like 'Non%' then
    perform cockpit.poser_verification(new.chantier_id, 'Raphaël', 'Dit dans la session, confirmé depuis la carte.', 'ne_marche_pas');
  end if;
  return new;
end $$;
revoke all on function cockpit.verdict_carte_repondue() from public, anon, authenticated;
drop trigger if exists verdict_carte_repondue on cockpit.messages;
create trigger verdict_carte_repondue after update of answered_at on cockpit.messages
  for each row when (new.verdict_carte) execute function cockpit.verdict_carte_repondue();

-- La carte se ferme seule quand le chantier n'est plus « à vérifier » (certifié ailleurs, repris, archivé).
create or replace function cockpit.fermer_cartes_verdict() returns trigger
language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if new.etat = 'a_verifier' and new.archived_at is null then return new; end if;
  update cockpit.messages set answered_at = now(), reponse = 'Plus utile : le chantier n''est plus à vérifier.'
   where chantier_id = new.id and verdict_carte and answered_at is null;
  return new;
end $$;
revoke all on function cockpit.fermer_cartes_verdict() from public, anon, authenticated;
drop trigger if exists fermer_cartes_verdict on cockpit.chantiers;
create trigger fermer_cartes_verdict after update of etat, archived_at on cockpit.chantiers
  for each row when (old.etat = 'a_verifier') execute function cockpit.fermer_cartes_verdict();
