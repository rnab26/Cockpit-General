-- Garder la porte des fonctions d'action (28 sept. 2026).
--
-- TROUVÉ PAR scripts/verifier-base.mjs, avant toute ouverture de l'app :
-- les fonctions `security definer` du schéma ne vérifiaient pas QUI les
-- appelle. Un utilisateur d'un autre projet — et même un visiteur sans
-- compte, avec la seule clé publique — pouvait certifier, corriger, répondre,
-- fusionner, réserver ou signaler une progression sur n'importe quel chantier.
--
-- Deux causes, deux corrections :
-- 1. PostgreSQL donne EXECUTE à PUBLIC sur toute fonction créée. La 0001
--    retirait `signaler_activite` au rôle `authenticated`, mais `anon` et
--    `authenticated` l'héritaient de PUBLIC. On retire à PUBLIC, puis on
--    accorde nommément.
-- 2. Une fonction `security definer` contourne la RLS : elle doit vérifier
--    elle-même le droit de l'appelant. D'où `cockpit.peut_agir`.
--
-- Qui peut quoi (service_role = les sessions via sql.sh et la fonction
-- serveur du module embarqué, qui a déjà vérifié la clé du projet) :
--   certifier, corriger, répondre : admin, ou membre du projet sur un
--                                   chantier visible des utilisateurs
--   fusionner, restaurer, libérer   : admin
--   réserver, signaler l'activité   : sessions seulement (service_role)
--   marquer_vu                      : membre du projet
--   ajouter_membre, membres_du_projet, moi : inchangés (déjà gardés)

create or replace function cockpit.est_service()
returns boolean language sql stable as $$
  -- Le rôle du JETON, jamais current_user : dans une fonction security
  -- definer, current_user est toujours le propriétaire (postgres), et ce
  -- test répondait « oui » à n'importe qui (vu par verifier-base.mjs).
  select coalesce(auth.role(), '') = 'service_role';
$$;

-- Le droit d'agir sur un chantier : session, admin, ou membre du projet si
-- le chantier est visible des utilisateurs (un chantier interne ne se
-- certifie pas depuis le module embarqué).
create or replace function cockpit.peut_agir(p_chantier uuid)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  select cockpit.est_service() or cockpit.est_admin() or exists (
    select 1 from cockpit.chantiers c
    where c.id = p_chantier and c.visible_utilisateurs and cockpit.est_membre(c.projet_id));
$$;

create or replace function cockpit.exiger(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception '%', p_message using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------ fonctions réécrites
create or replace function cockpit.certifier_chantier(p_id uuid, p_par text, p_mots text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_titre text;
begin
  perform cockpit.exiger(cockpit.peut_agir(p_id), 'tu n''as pas accès à ce chantier');
  perform set_config('cockpit.par', coalesce(p_par, 'humain'), true);
  update cockpit.chantiers
     set etat = 'valide', valide_at = now(), valide_par = p_par,
         archived_at = coalesce(archived_at, now()),
         pris_par = null, pris_jusqu_a = null
   where id = p_id and etat = 'a_verifier'
  returning projet_id, titre into v_projet, v_titre;
  if v_projet is null then raise exception 'ce chantier n''est pas « à vérifier »'; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_id, p_par, case when cockpit.est_admin() then 'proprietaire' else 'utilisateur' end, 'constat',
          coalesce(nullif(p_mots, ''), 'Ça fonctionne, je certifie.'));
  insert into cockpit.ce_qui_marche (projet_id, chantier_id, texte, par)
  values (v_projet, p_id, v_titre || case when nullif(p_mots,'') is null then '' else ' — ' || p_mots end, p_par);
end $$;

create or replace function cockpit.corriger_chantier(p_id uuid, p_par text, p_mots text)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid;
begin
  perform cockpit.exiger(cockpit.peut_agir(p_id), 'tu n''as pas accès à ce chantier');
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
  values (v_projet, p_id, p_par, case when cockpit.est_admin() then 'proprietaire' else 'utilisateur' end,
          'constat', 'Ça ne marche pas : ' || p_mots);
end $$;

create or replace function cockpit.repondre_message(p_id uuid, p_par text, p_reponse text,
                                                    p_precision text default null, p_etat text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare m cockpit.messages;
begin
  select * into m from cockpit.messages where id = p_id and kind in ('question','action');
  if m.id is null then raise exception 'message introuvable ou pas une question'; end if;
  perform cockpit.exiger(
    cockpit.est_service() or cockpit.est_admin()
    or (m.chantier_id is not null and cockpit.peut_agir(m.chantier_id))
    or (m.chantier_id is null and cockpit.est_membre(m.projet_id)),
    'tu n''as pas accès à cette question');
  update cockpit.messages
     set reponse = coalesce(p_reponse, reponse),
         precision = coalesce(p_precision, precision),
         etat = coalesce(p_etat, etat),
         answered_at = case when kind = 'action' and coalesce(p_etat, etat) <> 'fait' then answered_at else now() end,
         answered_by = auth.uid()
   where id = p_id;
end $$;

create or replace function cockpit.fusionner_chantiers(p_source uuid, p_cible uuid, p_par text, p_note text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_titre text;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'fusionner est réservé aux admins');
  if p_source = p_cible then raise exception 'même chantier'; end if;
  if (select projet_id from cockpit.chantiers where id = p_source)
     is distinct from (select projet_id from cockpit.chantiers where id = p_cible) then
    raise exception 'les deux chantiers ne sont pas du même projet';
  end if;
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

create or replace function cockpit.restaurer_champ(p_historique bigint, p_par text)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare h cockpit.historique;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'restaurer est réservé aux admins');
  select * into h from cockpit.historique where id = p_historique;
  if h.id is null then raise exception 'entrée introuvable'; end if;
  if h.champ not in ('titre','demande','notes','resume_simple') then
    raise exception 'on ne restaure que du texte, jamais un état';
  end if;
  perform set_config('cockpit.par', coalesce(p_par, 'humain') || ' (restauration)', true);
  execute format('update cockpit.chantiers set %I = $1 where id = $2', h.champ)
    using h.ancienne, h.chantier_id;
end $$;

create or replace function cockpit.liberer_chantier(p_id uuid, p_par text)
returns boolean language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare ok boolean;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'libérer une réservation est réservé aux admins et aux sessions');
  -- L'admin libère une réservation expirée ou oubliée, quel qu'en soit l'auteur.
  update cockpit.chantiers
     set pris_par = null, pris_jusqu_a = null,
         etat = case when etat = 'en_cours' then 'libre' else etat end
   where id = p_id and (pris_par = p_par or cockpit.est_admin())
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function cockpit.marquer_vu(p_projet uuid)
returns timestamptz language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v timestamptz;
begin
  perform cockpit.exiger(auth.uid() is not null and cockpit.est_membre(p_projet), 'tu n''es pas membre de ce projet');
  insert into cockpit.visites (user_id, projet_id, vu_at) values (auth.uid(), p_projet, now())
  on conflict (user_id, projet_id) do update set vu_at = greatest(cockpit.visites.vu_at, excluded.vu_at)
  returning vu_at into v;
  return v;
end $$;

-- ------------------------------------------------------------ droits
-- Plus rien pour PUBLIC ni anon. Puis on accorde nommément.
revoke execute on all functions in schema cockpit from public, anon, authenticated;
alter default privileges in schema cockpit revoke execute on functions from public;
alter default privileges in schema cockpit revoke execute on functions from authenticated;

grant execute on all functions in schema cockpit to service_role;

-- Ce que l'app (utilisateur connecté) a le droit d'appeler. Chaque fonction
-- vérifie ensuite elle-même le droit sur le projet ou le chantier visé.
grant execute on function
  cockpit.moi(),
  cockpit.certifier_chantier(uuid, text, text),
  cockpit.corriger_chantier(uuid, text, text),
  cockpit.repondre_message(uuid, text, text, text, text),
  cockpit.fusionner_chantiers(uuid, uuid, text, text),
  cockpit.restaurer_champ(bigint, text),
  cockpit.liberer_chantier(uuid, text),
  cockpit.marquer_vu(uuid),
  cockpit.ajouter_membre(uuid, text),
  cockpit.membres_du_projet(uuid)
to authenticated;

-- Utilisées par les politiques RLS : elles doivent rester exécutables par
-- le rôle qui lit (sinon toute lecture échoue).
grant execute on function cockpit.est_admin(), cockpit.est_membre(uuid), cockpit.cle_section(text),
  cockpit.est_service(), cockpit.peut_agir(uuid), cockpit.exiger(boolean, text)
to authenticated;

-- Les triggers s'exécutent avec les droits du propriétaire de la table : ils
-- n'ont pas besoin d'EXECUTE pour l'appelant. reserver_chantier,
-- signaler_activite et exec_sql restent réservées à service_role.
