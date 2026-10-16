-- 0092 : les cartes déjà traitées se retirent SEULES (16 oct. 2026, chantier fe412d83).
-- Raphaël : « les anciens chantiers ne s'actualisent pas en fonction de ce que les sessions ont avancé […] j'ai des questions d'il y a
-- 2 jours, il me semble que les tests ont déjà été effectués, qu'une session a déjà travaillé dessus […] le cockpit ne vérifie pas ce
-- qui a été fait, il ne met pas à jour automatiquement. Le but, c'est d'épurer […] pourquoi est-ce que je devrais faire une action
-- manuelle ? Perte de temps, pollution visuelle. Je veux vraiment que ce soit automatisé. »
--
-- CAUSE MESURÉE (base réelle, 16 oct.) :
--  1. La seule revue des cartes (a_toi_a_revoir + l'agent « Revoir À toi » de la chef) n'est JAMAIS passée sur FacePro, Melissa ni le
--     Trieur (projets.revue_a_toi_at nul) : elle exige une session chef vivante. Rien ne tournait donc seul.
--  2. Sa preuve « Claude a avancé » ne regarde que le chantier de la carte. Or les sessions traitent des LOTS : les 14 cartes FacePro
--     de plus de 24 h avaient 0 message et 0 étape de session sur LEUR chantier depuis qu'elles étaient posées, alors que le projet
--     avait reçu 19 à 66 livraisons et 42 à 231 mots de Raphaël (dont un accord global « jusqu'à 7 $ de GPU » dit dans la
--     conversation, jamais rattaché à chaque carte).
--
-- UNE règle (cockpit.carte_depassee), lue par UNE passe (cockpit.epuration_passe, pg_cron toutes les 3 min, sans session) :
-- une carte question/action ouverte est retirée quand, APRÈS le délai du projet (24 h, 0 = jamais ; une action : 7 fois plus), RIEN
-- ne l'a gardée vivante et que le travail a continué sans elle :
--   (a) son chantier a été livré depuis ;
--   (b) ou une session a travaillé sur ce chantier depuis, sans la confirmer ;
--   (c) ou le projet a avancé sans elle : au moins une livraison de session ET au moins un mot de Raphaël depuis qu'elle existe.
-- Jamais : une carte qu'une session confirme (--confirmer, le délai repart), qu'il a remise (restaurer_carte), dont il a écrit un
-- retour en attente (« Ça bloque »), dont le chantier est tenu par une session ou un agent VIVANT, ni dans un projet de test sauf
-- demandé. Le retrait n'efface rien : la carte garde sa raison (messages.reponse « Retirée automatiquement : … »), sa date
-- (retiree_seule_at), se remet d'un toucher, et ne pose JAMAIS answered_by (aucun réveil de chef : reveil_sur_message).
-- Idempotente.

alter table cockpit.projets add column if not exists epuration_delai_h integer not null default 24;
alter table cockpit.projets drop constraint if exists projets_epuration_delai_check;
alter table cockpit.projets add constraint projets_epuration_delai_check check (epuration_delai_h between 0 and 720);
alter table cockpit.filet_reglage add column if not exists epuration_actif boolean not null default true;
alter table cockpit.messages add column if not exists epuration_exclue boolean not null default false;
alter table cockpit.messages add column if not exists retiree_seule_at timestamptz;
create index if not exists messages_cartes_ouvertes on cockpit.messages (projet_id, created_at) where answered_at is null and kind in ('question', 'action');
create index if not exists messages_retirees_seules on cockpit.messages (projet_id, retiree_seule_at desc) where retiree_seule_at is not null;

-- La règle. Renvoie NULL tant que la carte compte, sinon la raison en mots simples (sans date : le fuseau est celui de l'écran).
create or replace function cockpit.carte_depassee(m cockpit.messages)
returns text language plpgsql stable security definer set search_path = cockpit, extensions, pg_temp as $$
declare
  pr cockpit.projets; c cockpit.chantiers;
  v_depuis timestamptz := greatest(m.created_at, coalesce(m.confirmee_at, m.created_at));   -- --confirmer fait repartir le délai
  v_apres timestamptz := m.created_at + interval '2 minutes';                                -- même grâce que l'écran (GRACE_AVANCE_MS)
  v_age text; v_n integer;
begin
  if m.answered_at is not null or m.kind not in ('question', 'action') or m.epuration_exclue or m.retour_at is not null then return null; end if;
  select * into pr from cockpit.projets where id = m.projet_id;
  if pr.id is null or pr.epuration_delai_h = 0 then return null; end if;
  -- Une action (un geste de Raphaël) attend 7 fois plus : seule une preuve forte la retire.
  if now() - v_depuis < make_interval(hours => pr.epuration_delai_h * case when m.kind = 'action' then 7 else 1 end) then return null; end if;
  v_age := case when now() - m.created_at < interval '48 hours' then round(extract(epoch from now() - m.created_at) / 3600)::int || ' h'
                else round(extract(epoch from now() - m.created_at) / 86400)::int || ' jours' end;
  if m.chantier_id is not null then
    select * into c from cockpit.chantiers where id = m.chantier_id;
    -- Une session ou un agent VIVANT tient ce chantier : c'est à elle de garder ses cartes à jour (--confirmer / --retirer).
    if c.id is not null and not cockpit.sans_signe_de_vie(c) then return null; end if;
    if c.id is not null then
      -- (a) livré depuis
      if exists (select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'termine' and a.updated_at > v_apres)
         or (c.etat in ('a_verifier', 'valide') and coalesce(c.livre_at, c.verdict_at) > v_apres) then
        return 'restée ' || v_age || ' sans réponse : le chantier a été livré depuis, elle n''a plus d''objet.';
      end if;
      -- (b) une session a travaillé sur ce chantier depuis (même preuve que « Claude a avancé depuis » de l'écran)
      if exists (select 1 from cockpit.messages x where x.chantier_id = c.id and x.auteur_type = 'session' and x.kind not in ('question', 'action', 'fusion') and x.created_at > v_apres)
         or exists (select 1 from cockpit.activite a where a.chantier_id = c.id and a.updated_at > v_apres)
         or exists (select 1 from cockpit.taches t where t.chantier_id = c.id and t.progres_at > v_apres) then
        return 'restée ' || v_age || ' sans réponse : le travail a continué sur ce chantier sans elle.';
      end if;
    end if;
  end if;
  -- (c) le projet a avancé sans elle : les sessions traitent des lots, le travail se fait souvent sous un AUTRE chantier,
  -- et un accord dit dans la conversation n'est pas rattaché à chaque carte.
  select count(*) into v_n from cockpit.activite a where a.projet_id = m.projet_id and a.statut = 'termine' and a.updated_at > v_apres;
  if v_n > 0 and exists (
       select 1 from cockpit.messages x
        where x.projet_id = m.projet_id and x.auteur_type = 'proprietaire' and x.kind in ('info', 'constat', 'reponse')
          and x.corps not like 'J''ai retiré la carte « %' and x.corps not like 'Doublon fusionné : %' and x.created_at > v_apres) then
    return 'restée ' || v_age || ' sans réponse pendant que le projet avançait (' || v_n || ' livraison' || case when v_n > 1 then 's' else '' end || ' depuis).';
  end if;
  return null;
end $$;

-- La passe (pg_cron). Une ligne par carte retirée. p_essai : dit ce qui serait retiré, n'écrit rien. Une erreur ne casse pas pg_cron.
create or replace function cockpit.epuration_passe(p_slug text default null, p_essai boolean default false, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
declare pr record; m cockpit.messages; v_raison text; v_out jsonb := '[]'::jsonb; v_gardees integer := 0;
begin
  if not coalesce((select epuration_actif from cockpit.filet_reglage where id = 1), true) then
    return jsonb_build_object('essai', p_essai, 'global', false, 'retirees', '[]'::jsonb, 'gardees', 0);
  end if;
  for pr in select * from cockpit.projets p where p.actif and p.epuration_delai_h > 0 and (p_slug is null or p.slug = p_slug) order by p.slug loop
    if cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false) then continue; end if;
    for m in select * from cockpit.messages x
              where x.projet_id = pr.id and x.answered_at is null and x.kind in ('question', 'action')
                and not x.epuration_exclue and x.retour_at is null
                and x.created_at < now() - make_interval(hours => pr.epuration_delai_h)
              order by x.created_at for update skip locked loop
      v_raison := cockpit.carte_depassee(m);
      if v_raison is null then v_gardees := v_gardees + 1; continue; end if;
      v_out := v_out || jsonb_build_object('id', m.id, 'projet', pr.slug, 'chantier_id', m.chantier_id, 'kind', m.kind,
                                          'heures', round(extract(epoch from now() - m.created_at) / 3600), 'raison', v_raison);
      if not p_essai then
        -- JAMAIS answered_by : ce n'est pas une réponse de Raphaël (aucun réveil de chef, jamais « à reprendre »).
        update cockpit.messages set answered_at = now(), reponse = 'Retirée automatiquement : ' || v_raison, retiree_seule_at = now()
         where id = m.id and answered_at is null;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('essai', p_essai, 'global', true, 'retirees', v_out, 'gardees', v_gardees);
exception when others then
  return jsonb_build_object('erreur', left(sqlerrm, 200));
end $$;

-- Il remet une carte retirée seule : elle redevient ouverte, ne sera plus jamais retirée seule, et son âge repart d'aujourd'hui.
create or replace function cockpit.restaurer_carte(p_id uuid)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare m cockpit.messages;
begin
  select * into m from cockpit.messages where id = p_id and retiree_seule_at is not null and answered_at is not null;
  if m.id is null then raise exception 'carte introuvable, ou pas retirée toute seule'; end if;
  perform cockpit.exiger(
    cockpit.est_service() or cockpit.est_admin()
    or (m.chantier_id is not null and cockpit.peut_agir(m.chantier_id))
    or (m.chantier_id is null and cockpit.est_membre(m.projet_id)),
    'tu n''as pas accès à cette carte');
  update cockpit.messages
     set answered_at = null, answered_by = null, reponse = null, retiree_seule_at = null, epuration_exclue = true, confirmee_at = now()
   where id = p_id;
end $$;

-- Réglages : par projet (slug + heures, 0 = jamais) ou global (slug nul + p_actif).
create or replace function cockpit.regler_epuration(p_projet text default null, p_heures integer default null, p_actif boolean default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_projet is null then
    if p_actif is null then raise exception 'dis si la fermeture automatique est allumée ou éteinte'; end if;
    update cockpit.filet_reglage set epuration_actif = p_actif, updated_at = now() where id = 1;
    begin
      perform cron.alter_job(j.jobid, active := p_actif) from cron.job j where j.jobname = 'cockpit-epuration';
    exception when others then null;
    end;
    return jsonb_build_object('global', p_actif);
  end if;
  if p_heures is null or p_heures < 0 or p_heures > 720 then raise exception 'délai en heures : de 0 (jamais) à 720'; end if;
  update cockpit.projets set epuration_delai_h = p_heures where slug = p_projet;
  if not found then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'heures', p_heures);
end $$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron non installable ici (%) : les cartes dépassées ne se retireront pas seules', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cockpit-epuration') then
      perform cron.unschedule('cockpit-epuration');
    end if;
    perform cron.schedule('cockpit-epuration', '*/3 * * * *', 'select cockpit.epuration_passe()');
  end if;
end $$;

revoke all on function cockpit.carte_depassee(cockpit.messages), cockpit.epuration_passe(text, boolean, boolean),
  cockpit.restaurer_carte(uuid), cockpit.regler_epuration(text, integer, boolean) from public, anon, authenticated;
grant execute on function cockpit.carte_depassee(cockpit.messages), cockpit.epuration_passe(text, boolean, boolean) to service_role;
grant execute on function cockpit.restaurer_carte(uuid), cockpit.regler_epuration(text, integer, boolean) to authenticated, service_role;
