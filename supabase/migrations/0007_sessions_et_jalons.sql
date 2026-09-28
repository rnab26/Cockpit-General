-- Ce qu'on lance dans une session arrive dans le cockpit, sans doublon ; et
-- « est-ce en ligne ? » se lit sur le chantier (29 sept. 2026).
--
-- Raphaël : « je lance quasiment jamais de chantier dans le cockpit […] les
-- chantiers ou correctifs que je lance dans des sessions doivent s'intégrer
-- automatiquement dans le cockpit ; qu'il détecte si c'est un cas qu'on reprend,
-- qu'il rouvre le chantier au lieu d'en ouvrir 200 les mêmes, quitte à avoir un
-- historique plus long ». Mesuré avant : 0 chantier sur 26 venait d'une session.
--
-- Et : « quand Claude a fini, j'ai du mal à savoir si c'est en ligne […] il faut
-- que quelqu'un qui ne sait pas coder comprenne, comme un enfant ». D'où les
-- JALONS d'un chantier : codé → envoyé → vérifié par les robots → en ligne.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

alter table cockpit.chantiers add column if not exists jalons jsonb not null default '{}'::jsonb;

create or replace function cockpit.normaliser(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- Le SUJET d'un titre : sans le préfixe de rubrique (« Objets — », « Tête
-- entière - »). Mesuré le 29 sept. : ce préfixe commun suffisait à monter deux
-- sujets différents à 0,38-0,48 de ressemblance, au ras du seuil de reprise.
create or replace function cockpit.sujet(p text)
returns text language sql immutable as $$
  select cockpit.normaliser(regexp_replace(coalesce(p, ''), '^[^—–:]{1,40}\s[—–:-]\s+', ''));
$$;

-- Les chantiers qui ressemblent à un texte, dans un projet, du plus proche au
-- moins proche. Les archivés et certifiés comptent (on les ROUVRE plutôt que
-- d'en recréer un) ; les doublons déjà fusionnés, non.
create or replace function cockpit.chantiers_proches(p_projet text, p_texte text, p_limite int default 5)
returns table (id uuid, titre text, etat text, archive boolean, score real)
language sql stable security definer set search_path = cockpit, extensions, pg_temp as $$
  select c.id, c.titre, c.etat, c.archived_at is not null,
         -- Le sujet décide ; le titre complet ne compte qu'avec une pénalité de
         -- 0,15, assez pour retrouver « Objets vidéo » (sans tiret) sans que le
         -- seul préfixe commun atteigne le seuil de reprise.
         greatest(similarity(cockpit.sujet(c.titre), cockpit.sujet(p_texte)),
                  word_similarity(cockpit.sujet(p_texte), cockpit.sujet(c.titre)) * 0.9,
                  similarity(cockpit.normaliser(c.titre), cockpit.normaliser(p_texte)) - 0.15)::real as score
  from cockpit.chantiers c join cockpit.projets p on p.id = c.projet_id
  where p.slug = p_projet and c.doublon_de is null
  order by score desc, c.updated_at desc
  limit greatest(p_limite, 1);
$$;

-- LE geste d'une session qui commence un travail : retrouver le chantier (et le
-- reprendre, voire le rouvrir) ou en créer un. Ne décide jamais seule entre
-- deux candidats proches : elle renvoie « ambigu » et n'écrit rien.
--   seuils : SEUIL_REPRISE = 0,45 ; écart minimal avec le 2e = 0,10.
create or replace function cockpit.ouvrir_ou_reprendre(
  p_projet text, p_titre text, p_demande text, p_session text,
  p_id uuid default null, p_nouveau boolean default false, p_section text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
declare
  v_projet uuid; v_cible uuid; v_etat text; v_archive boolean; v_titre text;
  c1 record; c2 record; v_section uuid; v_action text;
  seuil constant real := 0.45; ecart constant real := 0.10;
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
    select * into c1 from cockpit.chantiers_proches(p_projet, p_titre || ' ' || coalesce(p_demande, ''), 2) limit 1;
    select * into c2 from cockpit.chantiers_proches(p_projet, p_titre || ' ' || coalesce(p_demande, ''), 2) offset 1 limit 1;
    -- Le titre seul est souvent plus parlant que titre + demande : on garde le meilleur des deux.
    if c1.id is null or c1.score < seuil then
      select * into c1 from cockpit.chantiers_proches(p_projet, p_titre, 2) limit 1;
      select * into c2 from cockpit.chantiers_proches(p_projet, p_titre, 2) offset 1 limit 1;
    end if;
    if c1.id is not null and c1.score >= seuil then
      if c2.id is not null and c2.score >= seuil and c1.score - c2.score < ecart then
        return jsonb_build_object('action', 'ambigu', 'candidats', (
          select jsonb_agg(jsonb_build_object('id', x.id, 'titre', x.titre, 'etat', x.etat, 'archive', x.archive, 'score', round(x.score::numeric, 2)))
          from cockpit.chantiers_proches(p_projet, p_titre, 5) x where x.score >= seuil));
      end if;
      v_cible := c1.id;
    end if;
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

-- Un jalon de mise en ligne : code | pousse | ci_ok | ci_ko | en_ligne | pas_en_ligne.
-- Chaque jalon garde sa date ; `detail` porte le commit, l'adresse, ou la raison.
create or replace function cockpit.poser_jalon(p_chantier uuid, p_jalon text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare j jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_jalon not in ('code','pousse','ci_ok','ci_ko','en_ligne','pas_en_ligne') then
    raise exception 'jalon inconnu : % (code, pousse, ci_ok, ci_ko, en_ligne, pas_en_ligne)', p_jalon;
  end if;
  update cockpit.chantiers
     set jalons = (case when p_jalon = 'ci_ok' then jalons - 'ci_ko' when p_jalon = 'ci_ko' then jalons - 'ci_ok' else jalons end)
                  || jsonb_build_object(p_jalon, jsonb_build_object('at', now(), 'detail', p_detail))
   where id = p_chantier
  returning jalons into j;
  if j is null then raise exception 'chantier introuvable'; end if;
  return j;
end $$;

revoke execute on function cockpit.normaliser(text), cockpit.sujet(text), cockpit.chantiers_proches(text, text, int),
  cockpit.ouvrir_ou_reprendre(text, text, text, text, uuid, boolean, text), cockpit.poser_jalon(uuid, text, text)
  from public, anon, authenticated;
grant execute on function cockpit.normaliser(text), cockpit.sujet(text), cockpit.chantiers_proches(text, text, int),
  cockpit.ouvrir_ou_reprendre(text, text, text, text, uuid, boolean, text), cockpit.poser_jalon(uuid, text, text)
  to service_role;
-- La normalisation sert aussi à l'app (recherche) : lecture seule, sans risque.
grant execute on function cockpit.normaliser(text) to authenticated;
