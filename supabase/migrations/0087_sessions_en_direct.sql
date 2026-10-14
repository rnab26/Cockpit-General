-- 0087 — Sessions et cockpit branchés EN DIRECT (14 oct. 2026, chantier d5a2d13f)
--
-- Raphaël : « la coordination entre le cockpit et les sessions Claude n'est pas assez bonne, ça doit
-- être instantané […] des sessions ouvertes où les chantiers ne se créent pas, pas de barre de
-- progression […] des doublons car je réponds tantôt dans le cockpit, tantôt dans Claude ».
--
-- Causes MESURÉES (base réelle, 14 oct.) :
--  1. Tout le lien session ↔ cockpit passait par un chantier que la SESSION devait penser à ouvrir
--     (un simple rappel). Sans lui : aucune barre, aucune réponse remise, aucun fil. FacePro : une
--     session « tête entière » travaillait sans le moindre chantier visible.
--  2. Les messages écrits dans le cockpit « au niveau du projet » (ou sur un chantier que personne ne
--     tient) n'atteignaient JAMAIS une session ouverte : ils attendaient la chef / un réveil
--     (médiane 2 h 11 sur FacePro, 6 messages sur 48 h).
--  3. Répondre à une carte dans la session la laissait ouverte dans « À toi » (doublon de réponse).
--
-- Ce qui change (tout est déclenché par les hooks, rien ne dépend plus de la bonne volonté du modèle) :
--  - chantier_auto_depuis_message : un vrai message de travail dans une session ouvre (ou reprend)
--    tout seul le chantier, le réserve à la session et y recopie le message ;
--  - signaler_action_live / signaler_fin_tour : la barre montre ce que la session fait MAINTENANT ;
--  - remettre_orphelins : un message ou une réponse de carte que personne ne tient est remis à la
--    session ouverte au prochain pas de celle-ci (réclamé en base : un seul preneur).
--  - La chef et les renforts ne reprennent pas ce qu'une session a reçu depuis moins de 20 min.

alter table cockpit.chantiers add column if not exists titre_auto boolean not null default false;
alter table cockpit.activite
  add column if not exists action_live text,
  add column if not exists action_live_at timestamptz,
  add column if not exists pct_estime boolean not null default true;

-- Titre lisible tiré des mots de Raphaël (première phrase, sans politesse, 72 caractères au plus).
create or replace function cockpit.titre_depuis_message(p_texte text) returns text
language plpgsql immutable set search_path to 'cockpit', 'pg_temp' as $$
declare t text; i int;
begin
  t := btrim(regexp_replace(coalesce(p_texte, ''), '\s+', ' ', 'g'));
  t := split_part(regexp_replace(t, '([.!?…])\s', E'\\1\n', 'g'), E'\n', 1);
  for i in 1..3 loop
    t := regexp_replace(t, '^(salut|bonjour|bonsoir|hello|hey|ok|okay|d''accord|alors|donc|et|bon|écoute|ecoute|merci)[ ,!.:;-]+', '', 'i');
  end loop;
  t := regexp_replace(t, '^(peux-tu|peux tu|pourrais-tu|pourrais tu|est-ce que tu peux|tu peux|je voudrais que tu|je veux que tu|j''aimerais que tu|il faudrait que tu|il faut que tu|j''aimerais|je voudrais|je veux)[ ,]+', '', 'i');
  t := regexp_replace(t, '[ ,]*(s''il te plaît|s''il te plait|stp|svp)[ ,.!]*$', '', 'i');
  t := btrim(t, ' ,;:-.!?');
  if length(t) > 72 then t := regexp_replace(substring(t from 1 for 72), '\s+\S*$', '') || '…'; end if;
  if t = '' then t := 'Demande depuis une session'; end if;
  return upper(substring(t from 1 for 1)) || substring(t from 2);
end $$;

-- Un message qui demande du TRAVAIL (et pas « ok », « merci », une question courte).
create or replace function cockpit.message_est_du_travail(p_texte text) returns boolean
language sql immutable set search_path to 'cockpit', 'pg_temp' as $$
  select length(btrim(coalesce(p_texte, ''))) >= 35
     and cardinality(regexp_split_to_array(btrim(coalesce(p_texte, '')), '\s+')) >= 6
     and not (btrim(coalesce(p_texte, '')) ~ '\?\s*$'
              and cardinality(regexp_split_to_array(btrim(coalesce(p_texte, '')), '\s+')) < 14)
$$;

-- LE geste central : un message de Raphaël dans une session. Toujours consigné (pour le fil) ; s'il
-- demande du travail et que la session ne tient aucun chantier, un chantier est ouvert (ou un chantier
-- ouvert très ressemblant est repris : pas de doublon), réservé à la session, et le message y est déposé.
create or replace function cockpit.chantier_auto_depuis_message(p_projet text, p_session text, p_branche text, p_texte text)
returns jsonb language plpgsql security definer set search_path to 'cockpit', 'extensions', 'pg_temp' as $$
declare
  v_pid uuid; v_texte text; v_tenu record; v_titre text; v_trouve jsonb; v_cible uuid; v_etat text; v_arch timestamptz;
  v_pris text; v_jusqua timestamptz; r jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  v_texte := left(btrim(cockpit.masquer_secrets(coalesce(p_texte, ''))), 4000);
  if v_texte = '' or nullif(btrim(coalesce(p_branche, '')), '') is null or nullif(btrim(coalesce(p_session, '')), '') is null then
    return jsonb_build_object('action', 'rien');
  end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return jsonb_build_object('action', 'rien'); end if;
  perform cockpit.consigner_message_session(p_projet, p_session, p_branche, p_texte);

  select id, titre, titre_auto, created_at into v_tenu from cockpit.chantiers
   where projet_id = v_pid and pris_par = p_branche and pris_jusqu_a > now() and archived_at is null and etat = 'en_cours'
   order by updated_at desc limit 1;
  if not cockpit.message_est_du_travail(v_texte) then
    return jsonb_build_object('action', 'conversation');
  end if;
  v_titre := cockpit.titre_depuis_message(v_texte);
  -- La session tient déjà un chantier : un message qui lui RESSEMBLE (ou la suite, dans l'heure, d'un chantier
  -- qu'on vient d'ouvrir pour elle) s'y dépose ; un message sans rapport
  -- (0029 : jamais dans un fil étranger) ouvre son propre chantier.
  if v_tenu.id is not null and ((v_tenu.titre_auto and v_tenu.created_at > now() - interval '60 minutes') or exists (
       select 1 from cockpit.chantiers_proches(p_projet, v_titre || ' ' || v_texte, 8) x where x.id = v_tenu.id and x.score >= 0.25)) then
    perform cockpit.rattacher_messages_session(p_projet, p_session, v_tenu.id, null);
    return jsonb_build_object('action', 'tenu', 'id', v_tenu.id, 'titre', v_tenu.titre);
  end if;

  v_trouve := cockpit.trouver_chantier(p_projet, v_titre, v_texte);
  if not coalesce((v_trouve->>'ambigu')::boolean, false) and v_trouve->>'id' is not null then
    select etat, archived_at, pris_par, pris_jusqu_a into v_etat, v_arch, v_pris, v_jusqua
      from cockpit.chantiers where id = (v_trouve->>'id')::uuid;
    -- Un chantier OUVERT que personne d'autre ne tient : on le reprend. Un livré / certifié, un chantier
    -- tenu par une autre session vivante : jamais touché, un nouveau chantier est ouvert.
    if v_arch is null and v_etat in ('a_trier', 'a_cadrer', 'libre', 'en_cours', 'bloque', 'reporte')
       and (v_pris is null or v_jusqua is null or v_jusqua < now() or v_pris = p_branche) then
      v_cible := (v_trouve->>'id')::uuid;
    end if;
  end if;
  r := cockpit.ouvrir_ou_reprendre(p_projet, v_titre, v_texte, p_branche, v_cible, v_cible is null, null);
  if r->>'id' is null then return jsonb_build_object('action', 'rien'); end if;
  if r->>'action' = 'cree' then update cockpit.chantiers set titre_auto = true where id = (r->>'id')::uuid; end if;
  perform cockpit.rattacher_messages_session(p_projet, p_session, (r->>'id')::uuid, null);
  return r || jsonb_build_object('auto', true);
end $$;

-- Ce que la session fait MAINTENANT (hook PostToolUse) : alimente la barre du chantier qu'elle tient.
create or replace function cockpit.signaler_action_live(p_projet text, p_branche text, p_action text)
returns uuid language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare v_pid uuid; v_c uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(btrim(coalesce(p_branche, '')), '') is null then return null; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return null; end if;
  select id into v_c from cockpit.chantiers
   where projet_id = v_pid and pris_par = p_branche and pris_jusqu_a > now() and archived_at is null and etat = 'en_cours'
   order by updated_at desc limit 1;
  if v_c is null then return null; end if;
  insert into cockpit.activite (projet_id, chantier_id, session, etape, pourcentage, statut, action_live, action_live_at, pct_estime)
  values (v_pid, v_c, p_branche, 'Au travail', 0, 'en_cours', left(btrim(coalesce(p_action, '')), 200), now(), false)
  on conflict (chantier_id, session) do update
     set action_live = excluded.action_live, action_live_at = now(), updated_at = now(), statut = 'en_cours';
  -- Tant qu'elle travaille, sa réservation ne tombe pas (un long travail continu n'est jamais « libéré »).
  update cockpit.chantiers set pris_jusqu_a = now() + interval '3 hours'
   where id = v_c and pris_jusqu_a < now() + interval '2 hours';
  return v_c;
end $$;

-- Fin de tour (hook Stop) : la session a rendu la main à Raphaël, elle attend son prochain message.
create or replace function cockpit.signaler_fin_tour(p_projet text, p_branche text)
returns integer language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare n int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  update cockpit.activite a set statut = 'attente', action_live = null, updated_at = now()
   where a.session = p_branche and a.statut = 'en_cours'
     and a.chantier_id in (select c.id from cockpit.chantiers c join cockpit.projets p on p.id = c.projet_id
                            where p.slug = p_projet and c.pris_par = p_branche and c.archived_at is null);
  get diagnostics n = row_count;
  return n;
end $$;

-- Remise EN DIRECT à une session ouverte de ce que personne ne tient : messages libres de Raphaël
-- (niveau projet, ou chantier sans preneur) et réponses de cartes restées sans suite. Réclamé en
-- base (recu_at / recu_par) : une seule session le reçoit ; la chef et les renforts attendent 20 min.
create or replace function cockpit.remettre_orphelins(p_projet text, p_session text, p_branche text)
returns jsonb language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare v_pid uuid; res jsonb := '[]'::jsonb; r record; pris int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(btrim(coalesce(p_branche, '')), '') is null then return res; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return res; end if;

  for r in
    select m.id, m.chantier_id, m.corps, m.ou_en_est, c.titre, m.created_at
      from cockpit.messages_sans_reponse(v_pid, p_branche) s
      join cockpit.messages m on m.id = s.message_id
      left join cockpit.chantiers c on c.id = m.chantier_id
     where m.created_at > now() - interval '24 hours'
       -- Ce que la session TIENT déjà lui arrive par le chemin des chantiers tenus (hooks/suivi.sh) : pas deux fois.
       and not (c.id is not null and c.pris_par = p_branche and c.pris_jusqu_a > now())
     order by m.created_at limit 5
  loop
    update cockpit.messages set recu_at = now(), recu_par = left(p_branche, 120)
     where id = r.id and (recu_at is null or recu_at < now() - interval '20 minutes');
    get diagnostics pris = row_count;
    continue when pris = 0;
    if r.chantier_id is not null then perform cockpit.reserver_chantier(r.chantier_id, p_branche, 120); end if;
    res := res || jsonb_build_object('type', case when r.ou_en_est then 'ou_en_est' else 'message' end,
      'id', r.id, 'chantier_id', r.chantier_id, 'titre', r.titre, 'corps', left(r.corps, 400), 'quand', r.created_at);
  end loop;

  for r in
    select m.id, m.chantier_id, m.corps, m.reponse, m."precision", c.titre, cockpit.est_retour_carte(m) as retour,
           coalesce(m.answered_at, m.retour_at) as quand
      from cockpit.reponses_sans_suite(v_pid, p_branche) s
      join cockpit.messages m on m.id = s.message_id
      left join cockpit.chantiers c on c.id = m.chantier_id
     where coalesce(m.answered_at, m.retour_at) > now() - interval '24 hours'
       and not (c.id is not null and c.pris_par = p_branche and c.pris_jusqu_a > now())
     order by coalesce(m.answered_at, m.retour_at) limit 5
  loop
    update cockpit.messages set recu_at = now(), recu_par = left(p_branche, 120)
     where id = r.id and (recu_at is null or recu_at < now() - interval '20 minutes');
    get diagnostics pris = row_count;
    continue when pris = 0;
    if r.chantier_id is not null then perform cockpit.reserver_chantier(r.chantier_id, p_branche, 120); end if;
    res := res || jsonb_build_object('type', 'carte', 'id', r.id, 'chantier_id', r.chantier_id, 'titre', r.titre,
      'corps', left(r.corps, 200), 'reponse', r.reponse, 'precision', r."precision", 'retour', r.retour, 'quand', r.quand);
  end loop;
  return res;
end $$;

revoke all on function cockpit.titre_depuis_message(text), cockpit.message_est_du_travail(text),
  cockpit.chantier_auto_depuis_message(text, text, text, text), cockpit.signaler_action_live(text, text, text),
  cockpit.signaler_fin_tour(text, text), cockpit.remettre_orphelins(text, text, text) from public, anon, authenticated;
grant execute on function cockpit.titre_depuis_message(text), cockpit.message_est_du_travail(text),
  cockpit.chantier_auto_depuis_message(text, text, text, text), cockpit.signaler_action_live(text, text, text),
  cockpit.signaler_fin_tour(text, text), cockpit.remettre_orphelins(text, text, text) to service_role;

-- Fonctions existantes, reprises de leur définition EN VIGUEUR (jamais d'une ancienne migration) :
CREATE OR REPLACE FUNCTION cockpit.ouvrir_ou_reprendre(p_projet text, p_titre text, p_demande text, p_session text, p_id uuid DEFAULT NULL::uuid, p_nouveau boolean DEFAULT false, p_section text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'extensions', 'pg_temp'
AS $function$
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
    -- 0087 : rien de ressemblant, mais la session tient un chantier OUVERT TOUT SEUL il y a moins de 30 min :
    -- son premier --ouvrir le PRÉCISE (nouveau titre), il n'en crée pas un second. Un autre sujet : --nouveau.
    if v_cible is null and not coalesce((v_trouve->>'ambigu')::boolean, false) and p_session is not null then
      select c.id into v_cible from cockpit.chantiers c
       where c.projet_id = v_projet and c.titre_auto and c.pris_par = p_session and c.archived_at is null
         and c.created_at > now() - interval '30 minutes'
       order by c.created_at desc limit 1;
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
    update cockpit.chantiers c
       set titre = case when c.titre_auto and v_action = 'repris' then trim(p_titre) else c.titre end,
           titre_auto = false,
           demande = coalesce(c.demande, '') || entete || coalesce(nullif(trim(p_demande), ''), trim(p_titre)),
           etat = 'en_cours', archived_at = null, valide_at = null, valide_par = null,
           jalons = '{}'::jsonb,
           pris_par = case when c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now()
                             or c.pris_par = p_session or cockpit.sans_signe_de_vie(c)
                           then p_session else c.pris_par end,
           pris_jusqu_a = case when c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now()
                             or c.pris_par = p_session or cockpit.sans_signe_de_vie(c)
                           then now() + interval '3 hours' else c.pris_jusqu_a end,
           section_id = coalesce(c.section_id, v_section)
     where c.id = v_cible;
  end if;

  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, v_cible, coalesce(p_session, 'session'), 'session', 'info',
          case v_action when 'cree' then 'Chantier ouvert depuis une session : '
                        when 'rouvert' then 'Chantier ROUVERT (il était ' || case when v_archive then 'archivé' else v_etat end || ') pour une nouvelle demande : '
                        else 'Chantier repris pour une nouvelle demande : ' end
          || left(coalesce(nullif(trim(p_demande), ''), p_titre), 300));

  return jsonb_build_object('action', v_action, 'id', v_cible,
    'titre', (select titre from cockpit.chantiers where id = v_cible));
end $function$;

CREATE OR REPLACE FUNCTION cockpit.messages_sans_reponse(p_projet_id uuid DEFAULT NULL::uuid, p_branche text DEFAULT NULL::text)
 RETURNS TABLE(message_id uuid, chantier_id uuid, projet_id uuid, created_at timestamp with time zone, nombre integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  with libres as (
    select m.*, p.slug from cockpit.messages m join cockpit.projets p on p.id = m.projet_id
     where m.auteur_type in ('proprietaire', 'utilisateur') and m.kind in ('info', 'constat', 'reponse')
       and m.created_at > now() - interval '7 days' and p.actif
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else m.projet_id = p_projet_id end)
       and cockpit.est_message_libre(m)
       -- Aucune réponse écrite d'une session dans le même fil depuis.
       and not exists (select 1 from cockpit.messages s where s.projet_id = m.projet_id and s.chantier_id is not distinct from m.chantier_id
                          and s.auteur_type = 'session' and s.created_at > m.created_at)
       -- Aucun assistant ne l'a pris depuis moins de 2 h.
       and not coalesce(m.recu_par like 'agent/%' and m.recu_at > now() - interval '2 hours', false)
       -- Une session ouverte l'a reçu en direct depuis moins de 20 min (0087) : elle y répond, la chef n'en fait pas un doublon.
       and not coalesce(m.recu_at > now() - interval '20 minutes', false)
  )
  select distinct on (l.chantier_id, l.projet_id) l.id, l.chantier_id, l.projet_id, l.created_at,
         (count(*) over (partition by l.chantier_id, l.projet_id))::int
    from libres l left join cockpit.chantiers c on c.id = l.chantier_id
   where (l.chantier_id is null or (
           c.archived_at is null and c.doublon_de is null
           and not (c.verif_demandee_at is not null and l.created_at >= c.verif_demandee_at - interval '1 minute')
           -- Personne d'AUTRE ne le tient (mêmes conditions que reponses_sans_suite, 0018).
           and (c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now()
                or (p_branche is not null and c.pris_par = p_branche))
           and not exists (select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                              and t.vu_at > now() - cockpit.delai_signe(c.projet_id))
           and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                              and se.vu_at > now() - cockpit.delai_signe(c.projet_id) and se.branche is not null and se.branche = c.pris_par
                              and se.branche is distinct from p_branche)))
   order by l.chantier_id, l.projet_id, l.created_at;
$function$;

CREATE OR REPLACE FUNCTION cockpit.reponses_sans_suite(p_projet_id uuid DEFAULT NULL::uuid, p_branche text DEFAULT NULL::text)
 RETURNS TABLE(message_id uuid, chantier_id uuid, projet_id uuid, answered_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  select x.message_id, x.chantier_id, x.projet_id, x.answered_at from ((
    select distinct on (m.chantier_id) m.id as message_id, m.chantier_id, m.projet_id, coalesce(m.answered_at, m.retour_at) as answered_at
      from cockpit.messages m
      join cockpit.chantiers c on c.id = m.chantier_id
      join cockpit.projets p on p.id = c.projet_id
     where m.kind in ('question', 'action') and (m.answered_at is not null or cockpit.est_retour_carte(m)) and m.answered_by is not null
       and coalesce(m.answered_at, m.retour_at) > now() - interval '7 days'
       and coalesce(m.reponse, '') not like 'Retirée par %'
       and not coalesce(m.recu_at > now() - interval '20 minutes', false) -- remise en direct à une session ouverte (0087)
       -- Un accusé « Fait » à une carte d'action n'est jamais une demande de travail (0041).
       and not cockpit.est_accuse_action(m) and not cockpit.est_reponse_automatique(m) and not cockpit.est_accuse_carte_pr(m)
       -- Un certifié est aussi archivé (« Fini ») : sa question gardée reste reprise.
       and p.actif and (c.archived_at is null or c.etat = 'valide') and c.doublon_de is null
       -- Tous projets : jamais un projet de test ; un projet nommé : celui-là.
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else c.projet_id = p_projet_id end)
       -- Rien ne l'a suivie : ni message d'une session, ni étape, ni étape d'agent.
       and not exists (select 1 from cockpit.messages s where s.chantier_id = m.chantier_id and s.id <> m.id
                          and s.auteur_type = 'session' and s.created_at > coalesce(m.answered_at, m.retour_at))
       and not exists (select 1 from cockpit.activite a where a.chantier_id = m.chantier_id and a.updated_at > coalesce(m.answered_at, m.retour_at))
       and not exists (select 1 from cockpit.taches t where t.chantier_id = m.chantier_id and t.progres_at > coalesce(m.answered_at, m.retour_at))
       -- Personne d'AUTRE ne le tient : réservation absente, expirée ou à la branche
       -- de l'appelant ; aucun agent vivant dessus ; aucune session vivante sur la
       -- branche qui le tenait (sauf celle de l'appelant).
       and (c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now()
            or (p_branche is not null and c.pris_par = p_branche))
       and not exists (select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                          and t.vu_at > now() - cockpit.delai_signe(c.projet_id))
       and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                          and se.vu_at > now() - cockpit.delai_signe(c.projet_id) and se.branche is not null and se.branche = c.pris_par
                          and se.branche is distinct from p_branche)
     order by m.chantier_id, coalesce(m.answered_at, m.retour_at) desc)
    union all
    -- Une question SANS chantier (niveau projet) : suivie seulement si une session
    -- a écrit ensuite au niveau du projet, ou y a répondu (repond_a).
    select m.id, null::uuid, m.projet_id, coalesce(m.answered_at, m.retour_at) as answered_at
      from cockpit.messages m
      join cockpit.projets p on p.id = m.projet_id
     where m.chantier_id is null and m.kind in ('question', 'action') and (m.answered_at is not null or cockpit.est_retour_carte(m)) and m.answered_by is not null
       and coalesce(m.answered_at, m.retour_at) > now() - interval '7 days'
       and coalesce(m.reponse, '') not like 'Retirée par %'
       and not coalesce(m.recu_at > now() - interval '20 minutes', false) -- remise en direct à une session ouverte (0087)
       and not cockpit.est_accuse_action(m) and not cockpit.est_reponse_automatique(m) and not cockpit.est_accuse_carte_pr(m)
       and p.actif
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else m.projet_id = p_projet_id end)
       and not exists (select 1 from cockpit.messages s where s.id <> m.id and s.auteur_type = 'session'
                          and (s.repond_a = m.id or (s.projet_id = m.projet_id and s.chantier_id is null and s.created_at > coalesce(m.answered_at, m.retour_at))))
  ) x order by x.answered_at;
$function$;
