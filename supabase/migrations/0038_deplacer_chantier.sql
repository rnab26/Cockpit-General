-- 0038 — Déplacer un chantier vers un autre projet (chantier 43e45d54 ; doublon 661e179c).
--
-- Raphaël (30 sept. 2026) : un chantier écrit par erreur dans FacePro devait être
-- un correctif du cockpit, impossible de le déplacer. `deplacer_chantier` (admin ou
-- session) change le projet d'un chantier ET de tout ce qui s'y rattache : messages
-- (questions, réponses, médias), activité, « ce qui marche », assistants, passes.
-- La section est remise dans le projet cible (même nom, créée si besoin) ; la
-- réservation est libérée (une session de l'ancien projet ne doit plus le tenir) ;
-- un lien « doublon de » vers un chantier resté dans l'autre projet est coupé.
-- Une ligne « Déplacé de X vers Y » reste dans le fil (constat : sans réponse attendue).
-- Médias : les fichiers restent où ils sont (le stockage ne se renomme pas en SQL) ;
-- peut_lire_media accepte aussi un fichier cité par un message d'un chantier que
-- l'appelant peut lire (donc les membres du projet d'arrivée, plus ceux de départ).
-- Idempotente.

create or replace function cockpit.deplacer_chantier(p_id uuid, p_slug text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; v_cible cockpit.projets; v_depart text; v_nom_section text; v_section uuid; n_msg int;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into v_cible from cockpit.projets where slug = p_slug;
  if v_cible.id is null then raise exception 'projet inconnu : %', p_slug; end if;
  select * into c from cockpit.chantiers where id = p_id for update;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  if c.projet_id = v_cible.id then raise exception 'ce chantier est déjà dans « % »', v_cible.nom; end if;
  select nom into v_depart from cockpit.projets where id = c.projet_id;

  if c.section_id is not null then
    select nom into v_nom_section from cockpit.sections where id = c.section_id;
    insert into cockpit.sections (projet_id, nom, position)
    values (v_cible.id, v_nom_section, coalesce((select max(position) + 1 from cockpit.sections where projet_id = v_cible.id), 0))
    on conflict (projet_id, cle) do nothing;
    select id into v_section from cockpit.sections where projet_id = v_cible.id and cle = cockpit.cle_section(v_nom_section);
  end if;

  update cockpit.chantiers set projet_id = v_cible.id, section_id = v_section, pris_par = null, pris_jusqu_a = null,
         doublon_de = case when doublon_de in (select id from cockpit.chantiers where projet_id = v_cible.id) then doublon_de else null end
   where id = c.id;
  update cockpit.chantiers set doublon_de = null where doublon_de = c.id and projet_id <> v_cible.id;
  update cockpit.messages        set projet_id = v_cible.id where chantier_id = c.id;
  get diagnostics n_msg = row_count;
  update cockpit.activite        set projet_id = v_cible.id where chantier_id = c.id;
  update cockpit.ce_qui_marche   set projet_id = v_cible.id where chantier_id = c.id;
  update cockpit.taches          set projet_id = v_cible.id where chantier_id = c.id;
  update cockpit.passes_autonomes set projet_id = v_cible.id where chantier_id = c.id;

  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_cible.id, c.id, case when cockpit.est_service() then 'session' else 'Raphaël' end,
          case when cockpit.est_service() then 'session' else 'proprietaire' end, 'constat',
          left('Déplacé de « ' || coalesce(v_depart, '?') || ' » vers « ' || v_cible.nom || ' ».', 500));
  return jsonb_build_object('id', c.id, 'projet', v_cible.slug, 'nom', v_cible.nom, 'messages', n_msg);
end $$;

-- Un média reste lisible s'il est cité par un message d'un chantier que l'appelant peut lire (chantier déplacé).
create or replace function cockpit.peut_lire_media(p_nom text)
returns boolean language sql stable security definer
set search_path = cockpit, pg_temp as $$
  with p as (select cockpit.media_uuid(split_part(p_nom, '/', 1)) projet,
                    split_part(p_nom, '/', 2) seg)
  select cockpit.est_admin() or exists (
    select 1 from p
    where p.projet is not null and cockpit.est_membre(p.projet)
      and (p.seg = 'projet' or exists (
        select 1 from cockpit.chantiers c
        where c.id = cockpit.media_uuid(p.seg) and c.projet_id = p.projet and c.visible_utilisateurs)))
  or exists (
    select 1 from cockpit.messages m join cockpit.chantiers c on c.id = m.chantier_id
    where c.visible_utilisateurs and cockpit.est_membre(c.projet_id)
      and split_part(p_nom, '/', 1) <> c.projet_id::text
      and m.medias @> jsonb_build_array(jsonb_build_object('chemin', p_nom)));
$$;

revoke all on function cockpit.deplacer_chantier(uuid, text) from public, anon;
grant execute on function cockpit.deplacer_chantier(uuid, text) to authenticated, service_role;
