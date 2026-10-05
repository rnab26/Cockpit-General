-- 0060 — Créer un chantier proche d'un autre : compléter ou fusionner (chantier 69f1650e + doublon 7e4e615a).
--
-- Raphaël : « Quand je crée un chantier avec un titre similaire, ça me montre ce qui existe déjà mais ne
-- propose pas de le fusionner ou d'actualiser […] est-ce que la fusion récupère précisément la demande des
-- DEUX chantiers (pas une au hasard) ? Pour éviter deux cents chantiers qui se ressemblent. »
--
-- PREUVE (banc jetable, 5 oct. 2026) : fusionner_chantiers (0004) gardait bien les DEUX demandes (cible, puis
-- source), mais (1) le séparateur écrivait « \n » en toutes lettres : le second littéral n'avait pas son E'…' ;
-- (2) une demande vide donnait un séparateur sans rien dessous, sans le dire ; (3) refusionner un doublon déjà
-- fusionné ajoutait sa demande une seconde fois. Corrigés ici : demande cible intacte, puis un séparateur
-- lisible + la demande de la source (ou « (aucune demande écrite) »), jamais deux fois.
--
--  - chantiers_proches_creation(projet, titre, limite) : LA règle de la création = ressemblance_fusion (0042) et le seuil
--    du projet (fusion_seuil), chantiers OUVERTS du même projet. L'app ne recalcule rien (plus de Jaccard).
--  - completer_chantier(cible, titre, demande, par) : « Compléter celui-ci » = ajoute les mots tapés à la demande
--    du chantier existant (sans créer de chantier) + une ligne dans son fil.
-- Idempotente.

create or replace function cockpit.fusionner_chantiers(p_source uuid, p_cible uuid, p_par text, p_note text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_titre text; v_demande text;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'fusionner est réservé aux admins');
  if p_source = p_cible then raise exception 'même chantier'; end if;
  if (select projet_id from cockpit.chantiers where id = p_source)
     is distinct from (select projet_id from cockpit.chantiers where id = p_cible) then
    raise exception 'les deux chantiers ne sont pas du même projet';
  end if;
  if exists (select 1 from cockpit.chantiers where id = p_source and doublon_de is not null) then
    raise exception 'ce chantier est déjà fusionné dans un autre';
  end if;
  perform set_config('cockpit.par', coalesce(p_par, 'humain'), true);
  select projet_id, titre, nullif(btrim(demande), '') into v_projet, v_titre, v_demande from cockpit.chantiers where id = p_source;
  update cockpit.messages set chantier_id = p_cible where chantier_id = p_source;
  update cockpit.chantiers
     set demande = coalesce(nullif(btrim(demande), '') || E'\n\n', '')
                   || E'--- Fusion du doublon « ' || v_titre || E' » ---\n'
                   || coalesce(v_demande, '(aucune demande écrite)')
                   || case when nullif(p_note, '') is null then '' else E'\nNote : ' || p_note end
   where id = p_cible;
  update cockpit.chantiers
     set doublon_de = p_cible, archived_at = now(), pris_par = null, pris_jusqu_a = null
   where id = p_source;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_cible, p_par, 'proprietaire', 'info',
          'Doublon fusionné : « ' || v_titre || ' »' || coalesce(' — ' || p_note, ''));
end $$;

-- Les chantiers ouverts du projet qui ressemblent au titre tapé (même règle et même seuil que la fusion suggérée).
create or replace function cockpit.chantiers_proches_creation(p_projet uuid, p_titre text, p_limite int default 3)
returns table (id uuid, titre text, etat text, score real)
language plpgsql stable security definer set search_path = cockpit, extensions, pg_temp as $$
declare v_seuil real;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin() or cockpit.est_membre(p_projet), 'tu n''es pas membre de ce projet');
  select fusion_seuil into v_seuil from cockpit.projets where projets.id = p_projet;
  if v_seuil is null then return; end if;
  return query
    select o.id, o.titre, o.etat::text, cockpit.ressemblance_fusion(p_titre, o.titre) as sc
    from cockpit.chantiers o
    where o.projet_id = p_projet and o.archived_at is null and o.doublon_de is null and o.etat <> 'valide'
      and cockpit.ressemblance_fusion(p_titre, o.titre) >= v_seuil
    order by sc desc, o.created_at asc
    limit greatest(1, least(coalesce(p_limite, 3), 10));
end $$;

-- « Compléter celui-ci » : les mots tapés rejoignent la demande du chantier existant.
create or replace function cockpit.completer_chantier(p_cible uuid, p_titre text, p_demande text, p_par text)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_titre text; v_texte text;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'compléter est réservé aux admins');
  select projet_id, titre into v_projet, v_titre from cockpit.chantiers
   where id = p_cible and archived_at is null and doublon_de is null and etat <> 'valide';
  if v_projet is null then raise exception 'ce chantier n''est plus ouvert'; end if;
  v_texte := nullif(btrim(coalesce(p_demande, '')), '');
  if nullif(btrim(coalesce(p_titre, '')), '') is null and v_texte is null then raise exception 'rien à ajouter'; end if;
  perform set_config('cockpit.par', coalesce(p_par, 'humain'), true);
  update cockpit.chantiers
     set demande = coalesce(nullif(btrim(demande), '') || E'\n\n', '')
                   || E'--- Complément du ' || to_char(now() at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI') || E' : « ' || coalesce(nullif(btrim(p_titre), ''), v_titre) || E' » ---\n'
                   || coalesce(v_texte, '(titre seul)')
   where id = p_cible;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_cible, p_par, 'proprietaire', 'info',
          'Complété depuis une nouvelle demande : « ' || coalesce(nullif(btrim(p_titre), ''), v_titre) || ' »' || coalesce(E'\n' || v_texte, ''));
end $$;

revoke all on function cockpit.fusionner_chantiers(uuid, uuid, text, text), cockpit.chantiers_proches_creation(uuid, text, int),
  cockpit.completer_chantier(uuid, text, text, text) from public, anon;
grant execute on function cockpit.fusionner_chantiers(uuid, uuid, text, text), cockpit.chantiers_proches_creation(uuid, text, int),
  cockpit.completer_chantier(uuid, text, text, text) to authenticated, service_role;
