-- Vérifier un chantier livré : « ça ne marche pas » sans correctif à donner (5 oct. 2026, chantier 2d21c64f)
--
-- Raphaël (30/09) : « je n'écris pas « Corriger » si ça marche peut-être ; j'écris dans le fil que ça ne
-- marche pas, je ne coche rien, et je ne sais pas si c'est pris en compte. Je ne veux ni certifier pour
-- rien, ni demander une correction si je n'ai pas de correctif à donner. Marquer ce qui ne va pas, et que
-- ce soit pris en compte (Claude vérifie), y compris quand je ne peux pas vérifier ou que je ne sais pas. »
--
-- Trois issues, toutes prises en compte, UNE seule règle (poser_verification) :
--   « Ça marche »               certifie (inchangé, humain seulement) ;
--   « Ça ne marche pas »        signaler_ne_marche_pas : mots FACULTATIFS, Claude rejoue le cas puis rend son
--                               verdict (rendre_verdict) : « ça marche de mon côté » (retour à lui, avec la
--                               preuve) ou « tu as raison » (le chantier repart en correction) ;
--   « Je ne peux pas vérifier » demander_verification (motif ne_sait_pas), comme avant.
-- Et un message TAPÉ dans le fil d'un chantier « à vérifier » vaut « ça ne marche pas » : le déclencheur
-- verif_sur_message pose la vérification (ou l'ajoute à celle en cours) et répond dans le fil.
--
-- NB : une partie de ces objets avait été appliquée à la base par une session précédente sans migration
-- versionnée (constaté le 5 oct. : colonne, contrainte, fonctions, déclencheur déjà en base). Cette
-- migration est leur trace, rejouable, et retire un doublon (message_dans_verification) posé par erreur.
alter table cockpit.chantiers add column if not exists verif_motif text;
alter table cockpit.chantiers drop constraint if exists chantiers_verif_motif_check;
alter table cockpit.chantiers add constraint chantiers_verif_motif_check check (verif_motif in ('ne_sait_pas', 'ne_marche_pas'));

-- La règle commune : pose la demande et écrit le constat dans le fil. Renvoie le projet, ou null si le
-- chantier n'est pas « à vérifier ».
create or replace function cockpit.poser_verification(p_id uuid, p_par text, p_mots text, p_motif text)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid;
begin
  update cockpit.chantiers set verif_demandee_at = now(), verif_motif = p_motif, verdict_ok = null, verdict_texte = null, verdict_at = null
   where id = p_id and etat = 'a_verifier' and archived_at is null
  returning projet_id into v_projet;
  if v_projet is null then return null; end if;
  -- « Ça ne marche pas (… » et non « Ça ne marche pas : » : ce dernier est un message libre (Corriger) qui
  -- attendrait une 2e réponse ; ici la vérification EST la réponse.
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_id, coalesce(nullif(p_par, ''), 'humain'), case when cockpit.est_admin() then 'proprietaire' else 'utilisateur' end,
          'constat',
          case when p_motif = 'ne_marche_pas'
               then 'Ça ne marche pas (je ne sais pas pourquoi) : vérifie et dis-moi ce que tu trouves.' || coalesce(E'\n\nCe que je vois :\n' || nullif(trim(p_mots), ''), '')
               else 'Je ne sais pas dire si c''est bon : vérifie pour moi.' || coalesce(E'\n\nCe que j''ai vu :\n' || nullif(trim(p_mots), ''), '') end);
  return v_projet;
end $$;

drop function if exists cockpit.demander_verification(uuid, text, text);
create or replace function cockpit.demander_verification(p_id uuid, p_par text, p_mots text default null, p_motif text default 'ne_sait_pas')
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.peut_agir(p_id), 'tu n''as pas accès à ce chantier');
  if cockpit.poser_verification(p_id, p_par, p_mots, case when p_motif = 'ne_marche_pas' then 'ne_marche_pas' else 'ne_sait_pas' end) is null then
    raise exception 'ce chantier n''est pas « à vérifier »';
  end if;
end $$;

create or replace function cockpit.signaler_ne_marche_pas(p_id uuid, p_par text, p_mots text default null)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.peut_agir(p_id), 'tu n''as pas accès à ce chantier');
  if cockpit.poser_verification(p_id, p_par, p_mots, 'ne_marche_pas') is null then
    raise exception 'ce chantier n''est pas « à vérifier »';
  end if;
end $$;

-- Un message tapé dans le fil d'un chantier « à vérifier » = « ça ne marche pas » (accusé de réception inclus).
create or replace function cockpit.verif_sur_message_libre() returns trigger
language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; v_deja boolean;
begin
  if new.chantier_id is null or not cockpit.est_message_libre(new) then return new; end if;
  -- « Demander comment vérifier » (0005) attend les étapes de la session : ce n'est pas un « ça ne marche pas ».
  if new.corps like '% demande : comment vérifier ce chantier ? (%' then return new; end if;
  select * into c from cockpit.chantiers where id = new.chantier_id;
  if c.id is null or c.etat <> 'a_verifier' or c.archived_at is not null then return new; end if;
  v_deja := c.verif_demandee_at is not null;
  if not v_deja then
    update cockpit.chantiers set verif_demandee_at = now(), verif_motif = 'ne_marche_pas', verdict_ok = null, verdict_texte = null, verdict_at = null
     where id = c.id;
  end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, repond_a)
  values (new.projet_id, new.chantier_id, 'cockpit', 'session', 'info',
          case when v_deja then 'Reçu : je l’ajoute à ma vérification.'
               else 'Reçu : je prends ça pour « ça ne marche pas ». Je vérifie et je te réponds ici ; tu n’as rien d’autre à faire.' end,
          new.id);
  return new;
end $$;
drop trigger if exists verif_sur_message on cockpit.messages;
create trigger verif_sur_message after insert on cockpit.messages
  for each row when (new.auteur_type = 'proprietaire' and new.chantier_id is not null)
  execute function cockpit.verif_sur_message_libre();

-- Doublon posé par erreur (même rôle que verif_sur_message) : retiré.
drop trigger if exists message_dans_verification on cockpit.messages;
drop function if exists cockpit.message_dans_verification();

-- Le verdict parle selon la demande : « ça marche de mon côté » / « tu as raison, ça ne marche pas ».
create or replace function cockpit.rendre_verdict(p_id uuid, p_par text, p_ok boolean, p_texte text)
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(p_texte), '') is null then raise exception 'dis ce que tu as constaté, preuves à l''appui'; end if;
  select * into c from cockpit.chantiers where id = p_id;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  update cockpit.chantiers set verif_demandee_at = null, verdict_ok = p_ok, verdict_texte = p_texte, verdict_at = now(),
         pris_par = null, pris_jusqu_a = null
   where id = p_id;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (c.projet_id, p_id, coalesce(nullif(p_par, ''), 'session'), 'session', 'info',
          case when c.verif_motif = 'ne_marche_pas'
               then case when p_ok then 'J''ai vérifié : ça marche de mon côté. ' else 'J''ai vérifié : tu as raison, ça ne marche pas. ' end
               else case when p_ok then 'Vérifié pour toi : c''est BON. ' else 'Vérifié pour toi : ça NE VA PAS. ' end end || p_texte);
  if not p_ok and c.etat = 'a_verifier' then
    update cockpit.chantiers
       set demande = coalesce(demande, '') || E'\n\n--- Vérification de Claude du ' || to_char(now(), 'DD/MM/YYYY HH24:MI') || E' : ne fonctionne pas ---\n' || p_texte,
           etat = 'libre'
     where id = p_id;
    return 'repart en correction';
  end if;
  return case when p_ok then 'revient à Raphaël pour un toucher' else 'noté' end;
end $$;

revoke all on function cockpit.poser_verification(uuid, text, text, text), cockpit.verif_sur_message_libre(),
  cockpit.demander_verification(uuid, text, text, text), cockpit.signaler_ne_marche_pas(uuid, text, text), cockpit.rendre_verdict(uuid, text, boolean, text) from public, anon;
revoke execute on function cockpit.poser_verification(uuid, text, text, text), cockpit.verif_sur_message_libre(), cockpit.rendre_verdict(uuid, text, boolean, text) from authenticated;
grant execute on function cockpit.poser_verification(uuid, text, text, text), cockpit.verif_sur_message_libre(), cockpit.rendre_verdict(uuid, text, boolean, text) to service_role;
grant execute on function cockpit.demander_verification(uuid, text, text, text), cockpit.signaler_ne_marche_pas(uuid, text, text) to authenticated, service_role;
