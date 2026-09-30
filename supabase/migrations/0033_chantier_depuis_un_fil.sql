-- Un chantier né dans le fil d'un autre : créé, rangé, relié (30 sept. 2026)
--
-- Chantier 7b85b3bd. Raphaël : « dans le fil d'une discussion […] on remarque
-- qu'il y a un chantier nécessaire […] plutôt que de quitter ce chat et de
-- créer un nouveau chantier manuellement […] que la session Claude comprenne
-- qu'il faut créer le chantier et l'attribuer là où c'est nécessaire ».
--
-- Ce qui existait (0028) : l'agent « Répondre » ouvrait un chantier par sujet
-- avec ouvrir_ou_reprendre. Trois manques, constatés dans le code :
--  1. le chantier créé partait « en cours », RÉSERVÉ à l'agent qui répondait
--     (3 h) alors que personne ne le faisait : ni prenable, ni dans « Prêt à
--     lancer » ; et un chantier existant ressemblant était arraché à celui qui
--     le tenait (etat, jalons, pris_par écrasés) ;
--  2. rien ne le rangeait (seulement les correctifs visuels, 0021) ;
--  3. aucun lien entre les deux fils : la réponse disait « c'est parti
--     ailleurs » sans qu'on puisse y aller.
--
-- Ici :
--  - messages.chantier_lie : le fil vers lequel un message renvoie (l'app en
--    fait un bouton « Ouvrir le fil »).
--  - trouver_chantier : LA règle « ce chantier existe déjà ? », sortie de
--    ouvrir_ou_reprendre (même seuil, même écart) pour servir aux deux.
--  - ouvrir_depuis_fil(source, titre, demande, auteur, id, nouveau, réponse,
--    section, projet) — source null = la « Discussion du projet » :
--      * rien ne ressemble (ou seulement un chantier livré, certifié ou
--        archivé : on ne le rouvre pas, règle de 0026) → chantier CRÉÉ « libre » (Prêt à
--        lancer ; pris par le mode autonome ou la chef), non réservé ; rangé
--        dans la section donnée, sinon dans « Correctifs » par le trigger de
--        0021 si c'en est un, sinon dans la section du fil d'où il vient ;
--      * un chantier vivant ressemble → sa demande est COMPLÉTÉE, rien d'autre
--        ne change (ni état, ni réservation) ;
--      * deux ressemblent autant → 'ambigu', rien n'est écrit ;
--      * dans le nouveau fil : « Ajouté depuis le fil « … » » (lien retour) ;
--      * dans le fil d'origine : la RÉPONSE (repondre_dans_fil, donc elle
--        compte comme réponse à son message), avec le lien vers le nouveau.
-- Idempotente.

alter table cockpit.messages add column if not exists chantier_lie uuid references cockpit.chantiers(id) on delete set null;

create or replace function cockpit.trouver_chantier(p_projet text, p_titre text, p_demande text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, extensions, pg_temp as $$
declare c1 record; c2 record;
  seuil constant real := 0.45; ecart constant real := 0.10;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into c1 from cockpit.chantiers_proches(p_projet, p_titre || ' ' || coalesce(p_demande, ''), 2) limit 1;
  select * into c2 from cockpit.chantiers_proches(p_projet, p_titre || ' ' || coalesce(p_demande, ''), 2) offset 1 limit 1;
  -- Le titre seul est souvent plus parlant que titre + demande : on garde le meilleur des deux.
  if c1.id is null or c1.score < seuil then
    select * into c1 from cockpit.chantiers_proches(p_projet, p_titre, 2) limit 1;
    select * into c2 from cockpit.chantiers_proches(p_projet, p_titre, 2) offset 1 limit 1;
  end if;
  if c1.id is null or c1.score < seuil then return jsonb_build_object('id', null); end if;
  if c2.id is not null and c2.score >= seuil and c1.score - c2.score < ecart then
    return jsonb_build_object('ambigu', true, 'candidats', (
      select jsonb_agg(jsonb_build_object('id', x.id, 'titre', x.titre, 'etat', x.etat, 'archive', x.archive, 'score', round(x.score::numeric, 2)))
      from cockpit.chantiers_proches(p_projet, p_titre, 5) x where x.score >= seuil));
  end if;
  return jsonb_build_object('id', c1.id);
end $$;

-- Même comportement qu'en 0007 ; seule la recherche passe par trouver_chantier.
create or replace function cockpit.ouvrir_ou_reprendre(
  p_projet text, p_titre text, p_demande text, p_session text,
  p_id uuid default null, p_nouveau boolean default false, p_section text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
declare
  v_projet uuid; v_cible uuid; v_etat text; v_archive boolean; v_titre text;
  v_section uuid; v_action text; v_trouve jsonb;
  entete text := E'\n\n--- Nouvelle demande du ' || to_char(now() at time zone 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI') || ' (session ' || coalesce(p_session, '?') || E') ---\n';
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  if nullif(trim(p_titre), '') is null then raise exception 'titre vide'; end if;
  perform set_config('cockpit.par', coalesce(p_session, 'session'), true);
  if p_section is not null then
    select id into v_section from cockpit.sections where projet_id = v_projet and cle = cockpit.cle_section(p_section);
  end if;

  if p_id is not null then
    v_cible := p_id;
  elsif not p_nouveau then
    v_trouve := cockpit.trouver_chantier(p_projet, p_titre, p_demande);
    if coalesce((v_trouve->>'ambigu')::boolean, false) then
      return jsonb_build_object('action', 'ambigu', 'candidats', v_trouve->'candidats');
    end if;
    v_cible := (v_trouve->>'id')::uuid;
  end if;

  if v_cible is null then
    insert into cockpit.chantiers (projet_id, section_id, titre, demande, etat, priorite, origine, pris_par, pris_jusqu_a)
    values (v_projet, v_section, trim(p_titre), p_demande, 'en_cours', 'normale', 'session', p_session, now() + interval '3 hours')
    returning id into v_cible;
    v_action := 'cree';
  else
    select etat, archived_at is not null, titre into v_etat, v_archive, v_titre from cockpit.chantiers where id = v_cible and projet_id = v_projet;
    if v_etat is null then raise exception 'chantier % introuvable dans le projet %', v_cible, p_projet; end if;
    v_action := case when v_archive or v_etat in ('valide', 'a_verifier') then 'rouvert' else 'repris' end;
    update cockpit.chantiers
       set demande = coalesce(demande, '') || entete || coalesce(nullif(trim(p_demande), ''), trim(p_titre)),
           etat = 'en_cours', archived_at = null, valide_at = null, valide_par = null,
           jalons = '{}'::jsonb,
           pris_par = p_session, pris_jusqu_a = now() + interval '3 hours',
           section_id = coalesce(section_id, v_section)
     where id = v_cible;
  end if;

  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, v_cible, coalesce(p_session, 'session'), 'session', 'info',
          case v_action when 'cree' then 'Chantier ouvert depuis une session : '
                        when 'rouvert' then 'Chantier ROUVERT (il était ' || case when v_archive then 'archivé' else v_etat end || ') pour une nouvelle demande : '
                        else 'Chantier repris pour une nouvelle demande : ' end
          || left(coalesce(nullif(trim(p_demande), ''), p_titre), 300));

  return jsonb_build_object('action', v_action, 'id', v_cible,
    'titre', (select titre from cockpit.chantiers where id = v_cible));
end $$;

-- p_source : le chantier dont le fil a porté le message ; null = la « Discussion
-- du projet » (p_projet obligatoire alors).
create or replace function cockpit.ouvrir_depuis_fil(
  p_source uuid, p_titre text, p_demande text, p_auteur text,
  p_id uuid default null, p_nouveau boolean default false, p_reponse text default null,
  p_section text default null, p_projet text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
declare
  src cockpit.chantiers; v_projet uuid; v_slug text; v_fil text; v_trouve jsonb; v_cible uuid; v_action text;
  cib cockpit.chantiers; v_section text; v_reponse text; v_msg uuid;
  v_auteur text := coalesce(nullif(p_auteur, ''), 'session');
  v_demande text := coalesce(nullif(trim(p_demande), ''), trim(p_titre));
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(coalesce(p_titre, '')), '') is null then raise exception 'titre vide'; end if;
  if p_source is not null then
    select * into src from cockpit.chantiers where id = p_source;
    if src.id is null then raise exception 'fil d''origine introuvable : %', p_source; end if;
    v_projet := src.projet_id;
    select slug into v_slug from cockpit.projets where id = v_projet;
    v_fil := 'le fil « ' || src.titre || ' »';
  else
    select id, slug into v_projet, v_slug from cockpit.projets where slug = p_projet;
    if v_projet is null then raise exception 'projet inconnu : %', coalesce(p_projet, '(aucun)'); end if;
    v_fil := 'la discussion du projet';
  end if;
  perform set_config('cockpit.par', v_auteur, true);

  if p_id is not null then
    v_cible := p_id;
  elsif not p_nouveau then
    v_trouve := cockpit.trouver_chantier(v_slug, p_titre, p_demande);
    if coalesce((v_trouve->>'ambigu')::boolean, false) then
      return jsonb_build_object('action', 'ambigu', 'candidats', v_trouve->'candidats');
    end if;
    v_cible := (v_trouve->>'id')::uuid;
  end if;
  if p_source is not null and v_cible = p_source then
    raise exception 'ce sujet ressemble au chantier de ce fil : réponds dans le fil, ou relance avec --nouveau si c''est un autre sujet';
  end if;

  if v_cible is not null then
    select * into cib from cockpit.chantiers where id = v_cible and projet_id = v_projet;
    if cib.id is null then raise exception 'chantier % introuvable dans le projet %', v_cible, v_slug; end if;
    -- Un chantier livré, certifié ou archivé n'est pas rouvert (0026) : c'est un nouveau sujet.
    if cib.archived_at is not null or cib.etat in ('valide', 'a_verifier') then
      if p_id is not null then raise exception 'ce chantier est terminé : relance sans --id pour en créer un neuf'; end if;
      v_cible := null;
    end if;
  end if;

  if v_cible is null then
    -- Section nulle à l'insertion : le trigger de 0021 range les correctifs ; sinon celle du fil d'origine.
    insert into cockpit.chantiers (projet_id, titre, demande, etat, priorite, origine)
    values (v_projet, trim(p_titre), v_demande, 'libre', 'normale', 'session')
    returning id into v_cible;
    if nullif(trim(coalesce(p_section, '')), '') is not null then
      perform cockpit.ranger_chantier(v_cible, p_section, v_auteur);
    elsif src.section_id is not null then
      update cockpit.chantiers set section_id = src.section_id where id = v_cible and section_id is null;
    end if;
    v_action := 'cree';
  else
    -- Compléter, sans rien arracher : ni état, ni réservation, ni jalons.
    update cockpit.chantiers
       set demande = coalesce(demande, '') || E'\n\n--- Ajouté depuis ' || v_fil || ', le '
                     || to_char(now() at time zone 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI') || E' ---\n' || v_demande
     where id = v_cible;
    v_action := 'complete';
  end if;
  select * into cib from cockpit.chantiers where id = v_cible;
  select nom into v_section from cockpit.sections where id = cib.section_id;

  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, chantier_lie)
  values (v_projet, v_cible, v_auteur, 'session', 'info',
          case v_action when 'cree' then 'Chantier ouvert depuis ' else 'Demande ajoutée depuis ' end
          || v_fil || ' : ' || left(v_demande, 300), p_source);

  v_reponse := coalesce(nullif(trim(coalesce(p_reponse, '')), ''),
    case v_action when 'cree' then 'C’est noté : nouveau chantier « ' || cib.titre || ' »'
                              || coalesce(', rangé dans « ' || v_section || ' »', '') || ', prêt à lancer.'
                  else 'C’est noté : ajouté au chantier « ' || cib.titre || ' », qui existait déjà.' end);
  v_msg := cockpit.repondre_dans_fil(v_slug, p_source, v_auteur, v_reponse);
  update cockpit.messages set chantier_lie = v_cible where id = v_msg;

  return jsonb_build_object('action', v_action, 'id', v_cible, 'titre', cib.titre, 'etat', cib.etat,
                            'section', v_section, 'message', v_msg);
end $$;

revoke all on function cockpit.trouver_chantier(text, text, text),
  cockpit.ouvrir_depuis_fil(uuid, text, text, text, uuid, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function cockpit.trouver_chantier(text, text, text),
  cockpit.ouvrir_depuis_fil(uuid, text, text, text, uuid, boolean, text, text, text)
  to service_role;
