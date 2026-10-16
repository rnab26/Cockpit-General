-- 0091 — Un message n'est pas un chantier (16 oct. 2026, chantier c2c79e7b)
--
-- Raphaël (capture de « Ça avance tout seul », FacePro) : « chaque message que je crée en discussion est
-- transcrit comme un chantier avec une progression […] ce n'est pas très logique : il vaut mieux une petite
-- pastille de notification et la discussion concernant le chantier en question. »
--
-- Cause MESURÉE (base réelle, 16 oct.) : 0087 (`chantier_auto_depuis_message`) ouvrait un chantier pour tout message
-- de session d'au moins 35 caractères et 6 mots, dès que la session n'en tenait pas un qui lui RESSEMBLAIT (trigrammes).
-- FacePro : 14 chantiers dont le titre est copié de ses mots (« Ca en es ou cest finit », « Vas-y teste toi la piste du
-- relighting… »), 4 « en cours » avec une barre, alors que le vrai chantier du sujet existait déjà
-- (« Scintillement : diagnostic gratuit puis une piste sans surcoût »). Aggravé par `signaler_action_live` qui recopiait
-- la MÊME action sur jusqu'à 3 chantiers tenus (3 barres « Au travail » pour une seule chose) et par `signaler_activite`
-- qui laissait `pct_estime = false` même quand la session signalait 35 % (le drapeau ne servait plus à rien).
--
-- Ce qui change (règle GÉNÉRALE, aucun réglage par projet) :
--  - un message tapé dans une session n'ouvre JAMAIS un chantier. Il est déposé tout de suite dans UN fil : celui du chantier
--    que la session tient (le seul, ou le plus ressemblant), sinon la discussion du projet. La session peut le DÉPLACER
--    en répondant dans un autre fil (`progression.sh --chantier <id> --point`, ou sans `--chantier` pour le projet) :
--    la première réponse explicite corrige le rangement, les suivantes copient (message à plusieurs sujets) ;
--  - le hook d'arrêt exige une réponse écrite dans le fil où le message a été rangé (`fils_du_tour_sans_reponse`) ;
--  - une session fait UNE chose à la fois : la barre d'UN chantier reste vivante (celui qu'elle fait avancer), et l'action en
--    direct est écrite sur la session elle-même (`sessions.action_live`, admin seulement) pour qu'une session SANS chantier
--    reste visible sans fausse barre. Elle n'est plus écrite dans `activite` (lisible des membres invités : une commande peut
--    porter un secret) et ses secrets sont masqués ;
--  - `signaler_activite` lève `pct_estime` quand la session donne un pourcentage ;
--  - `ranger_chantiers_nes_de_messages` : le ménage des chantiers déjà nés d'un message, en ESSAI par défaut (rien d'écrit).
--
-- Limites dites : un message très court (« ok », « vas-y ») n'est pas déposé (il reste 1 jour en attente, comme avant) ;
-- le rangement par défaut ne devine pas le sujet : seul un chantier tenu par la session est choisi (pas de recherche
-- dans tout le projet : « jamais dans un fil étranger », 0029) ; la session, qui connaît le contexte, corrige.

alter table cockpit.messages_session_attente
  add column if not exists message_id uuid,                       -- le message déposé tout de suite dans le fil par défaut
  add column if not exists confirme boolean not null default false, -- la session a répondu dans un fil : le rangement est confirmé ou corrigé
  add column if not exists au_projet boolean not null default false; -- déposé dans la discussion du projet (hors chantier)
alter table cockpit.sessions
  add column if not exists action_live text,
  add column if not exists action_live_at timestamptz;

-- Un message qui vaut d'être rangé dans un fil : pas « ok », « merci », « vas-y ».
create or replace function cockpit.message_a_ranger(p_texte text) returns boolean
language sql immutable set search_path to 'cockpit', 'pg_temp' as $$
  select length(btrim(coalesce(p_texte, ''))) >= 12
     and cardinality(regexp_split_to_array(btrim(coalesce(p_texte, '')), '\s+')) >= 3
$$;

-- Les chantiers qu'une session TIENT ou fait avancer (réservés à sa branche, ou une étape signalée il y a peu) :
-- UNE règle, lue par le rangement des messages ET par l'action en direct. Celui qu'elle a fait avancer EN DERNIER d'abord
-- (sa dernière étape ou action en direct) ; sans signe, le plus récemment créé. Jamais `chantiers.updated_at` : la prolongation
-- de la réservation le touche à chaque chantier tenu, et deux chantiers à égalité se disputaient la barre.
create or replace function cockpit.chantiers_de_la_session(p_projet_id uuid, p_branche text, p_heures numeric default 3)
returns table(id uuid, titre text, maj timestamptz)
language sql stable security definer set search_path to 'cockpit', 'pg_temp' as $$
  select c.id, c.titre,
         (select max(a.updated_at) from cockpit.activite a where a.chantier_id = c.id and a.session = p_branche) as maj
    from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.etat = 'en_cours'
     and nullif(btrim(coalesce(p_branche, '')), '') is not null
     and ((c.pris_par = p_branche and c.pris_jusqu_a > now())
          or exists (select 1 from cockpit.activite a where a.chantier_id = c.id and a.session = p_branche
                        and a.updated_at > now() - interval '1 hour' * p_heures))
   order by 3 desc nulls last, c.created_at desc
$$;

-- LE chantier « en question » pour un message tapé dans une session : celui que la session tient s'il n'y en a qu'un,
-- le plus ressemblant s'il y en a plusieurs (score d'au moins 0,25), sinon aucun (= la discussion du projet).
create or replace function cockpit.chantier_du_message(p_projet_id uuid, p_projet text, p_branche text, p_texte text)
returns uuid language plpgsql stable security definer set search_path to 'cockpit', 'pg_temp' as $$
declare n int; v uuid;
begin
  select count(*) into n from cockpit.chantiers_de_la_session(p_projet_id, p_branche, 3);
  if n = 0 then return null; end if;
  if n = 1 then select s.id into v from cockpit.chantiers_de_la_session(p_projet_id, p_branche, 3) s; return v; end if;
  select x.id into v from cockpit.chantiers_proches(p_projet, p_texte, 30) x
   where x.score >= 0.25 and x.id in (select s.id from cockpit.chantiers_de_la_session(p_projet_id, p_branche, 3) s)
   order by x.score desc limit 1;
  return v;
end $$;

-- Consigner un message (même ménage qu'avant : on garde un jour) et rendre sa ligne.
create or replace function cockpit.consigner_message_attente(p_projet text, p_session text, p_branche text, p_texte text)
returns uuid language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare v_pid uuid; v_texte text; v_id uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  v_texte := left(btrim(cockpit.masquer_secrets(p_texte)), 4000);
  if v_texte = '' or nullif(btrim(coalesce(p_branche, '')), '') is null or nullif(btrim(coalesce(p_session, '')), '') is null then return null; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return null; end if;
  delete from cockpit.messages_session_attente where created_at < now() - interval '1 day';
  insert into cockpit.messages_session_attente (projet_id, session_id, branche, texte)
  values (v_pid, p_session, p_branche, v_texte) returning id into v_id;
  return v_id;
end $$;

create or replace function cockpit.consigner_message_session(p_projet text, p_session text, p_branche text, p_texte text)
returns integer language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
begin
  return case when cockpit.consigner_message_attente(p_projet, p_session, p_branche, p_texte) is null then 0 else 1 end;
end $$;

-- Déposer un message consigné dans un fil (chantier, ou NULL = discussion du projet), sans doublon. Rend l'id du message
-- déposé, ou NULL s'il y était déjà.
create or replace function cockpit.deposer_message_id(a cockpit.messages_session_attente, p_chantier uuid)
returns uuid language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare v_id uuid;
begin
  if p_chantier is null then
    if a.au_projet then return null; end if;
  elsif p_chantier = any(a.chantiers) then return null;
  end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session, recu_at, recu_par, created_at)
  values (a.projet_id, p_chantier, 'Raphaël (session Claude)', 'proprietaire', 'info', a.texte, true, a.created_at, a.branche, a.created_at)
  returning id into v_id;
  if p_chantier is null then update cockpit.messages_session_attente set au_projet = true where id = a.id;
  else update cockpit.messages_session_attente set chantiers = chantiers || p_chantier where id = a.id;
  end if;
  return v_id;
end $$;

create or replace function cockpit.deposer_message_session(a cockpit.messages_session_attente, p_chantier uuid)
returns void language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
begin
  perform cockpit.deposer_message_id(a, p_chantier);
end $$;

-- LE geste central, même nom et même signature qu'en 0087 (les hooks de tous les projets l'appellent) : un message de
-- Raphaël tapé dans une session. Toujours consigné ; s'il vaut d'être rangé, déposé tout de suite dans UN fil. N'ouvre
-- JAMAIS de chantier. Rend `tenu` (fil d'un chantier), `projet` (discussion du projet), `conversation` (trop court) ou `rien`.
create or replace function cockpit.chantier_auto_depuis_message(p_projet text, p_session text, p_branche text, p_texte text)
returns jsonb language plpgsql security definer set search_path to 'cockpit', 'extensions', 'pg_temp' as $$
declare v_pid uuid; v_texte text; v_att uuid; a cockpit.messages_session_attente; v_cible uuid; v_msg uuid; v_titre text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  v_texte := left(btrim(cockpit.masquer_secrets(coalesce(p_texte, ''))), 4000);
  if v_texte = '' or nullif(btrim(coalesce(p_branche, '')), '') is null or nullif(btrim(coalesce(p_session, '')), '') is null then
    return jsonb_build_object('action', 'rien');
  end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return jsonb_build_object('action', 'rien'); end if;
  v_att := cockpit.consigner_message_attente(p_projet, p_session, p_branche, p_texte);
  if v_att is null then return jsonb_build_object('action', 'rien'); end if;
  if not cockpit.message_a_ranger(v_texte) then return jsonb_build_object('action', 'conversation'); end if;
  select * into a from cockpit.messages_session_attente where id = v_att;
  v_cible := cockpit.chantier_du_message(v_pid, p_projet, p_branche, v_texte);
  v_msg := cockpit.deposer_message_id(a, v_cible);
  update cockpit.messages_session_attente set message_id = v_msg where id = v_att;
  if v_cible is null then return jsonb_build_object('action', 'projet'); end if;
  select titre into v_titre from cockpit.chantiers where id = v_cible;
  return jsonb_build_object('action', 'tenu', 'id', v_cible, 'titre', v_titre);
end $$;

-- Ses messages de CE tour rattachés à un fil par la session (--ouvrir, --point). La PREMIÈRE réponse explicite corrige le
-- rangement par défaut (le message est DÉPLACÉ, jamais copié) ; les suivantes COPIENT (un message à plusieurs sujets
-- apparaît dans le fil de chacun). p_chantier NULL = la discussion du projet.
create or replace function cockpit.rattacher_messages_session(p_projet text, p_session text, p_chantier uuid, p_depuis timestamp with time zone default null)
returns integer language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare v_pid uuid; a cockpit.messages_session_attente; n int := 0; v_actuel uuid; v_trouve boolean;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(btrim(coalesce(p_session, '')), '') is null then return 0; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return 0; end if;
  if p_chantier is not null and not exists (select 1 from cockpit.chantiers where id = p_chantier and projet_id = v_pid) then return 0; end if;
  for a in select * from cockpit.messages_session_attente
            where projet_id = v_pid and session_id = p_session
              and (case when p_depuis is null then created_at > now() - interval '15 minutes' else created_at >= p_depuis end)
            order by created_at desc
            limit (case when p_depuis is null then 1 else 50 end) loop
    if a.message_id is not null and not a.confirme then
      select m.chantier_id, true into v_actuel, v_trouve from cockpit.messages m where m.id = a.message_id;
      if coalesce(v_trouve, false) then
        if v_actuel is distinct from p_chantier then
          update cockpit.messages set chantier_id = p_chantier where id = a.message_id;
          update cockpit.messages_session_attente
             set confirme = true, au_projet = (p_chantier is null),
                 chantiers = case when p_chantier is null then array_remove(chantiers, v_actuel)
                                  else array_append(array_remove(chantiers, v_actuel), p_chantier) end
           where id = a.id;
          n := n + 1;
        else
          update cockpit.messages_session_attente set confirme = true where id = a.id;
        end if;
        continue;
      end if;
    end if;
    if cockpit.deposer_message_id(a, p_chantier) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Les fils où un message de Raphaël a été rangé pendant ce tour et qui n'ont pas encore la réponse écrite de la session
-- (le hook d'arrêt la réclame une fois). NULL = la discussion du projet. Les lignes automatiques ne comptent pas.
create or replace function cockpit.fils_du_tour_sans_reponse(p_projet text, p_branche text, p_debut timestamp with time zone)
returns table(chantier_id uuid, titre text)
language sql stable security definer set search_path to 'cockpit', 'pg_temp' as $$
  select f.chantier_id, c.titre
    from (select distinct m.chantier_id, m.projet_id from cockpit.messages m join cockpit.projets p on p.id = m.projet_id
           where p.slug = p_projet and m.via_session and m.auteur_type = 'proprietaire' and m.recu_par = p_branche and m.created_at >= p_debut) f
    left join cockpit.chantiers c on c.id = f.chantier_id
   where not exists (select 1 from cockpit.messages s
                      where s.projet_id = f.projet_id and s.chantier_id is not distinct from f.chantier_id
                        and s.auteur_type = 'session' and s.created_at >= p_debut
                        and s.corps not like 'Chantier ouvert depuis une session : %' and s.corps not like 'Chantier ROUVERT %'
                        and s.corps not like 'Chantier repris pour une nouvelle demande : %')
$$;

-- Ce que la session fait MAINTENANT (hook PostToolUse). Une session fait UNE chose à la fois : l'action va sur la session elle-même
-- (`sessions.action_live`, lisible par l'admin SEULEMENT, même sans chantier) et la barre d'UN chantier reste « vivante » (celui qu'elle fait
-- avancer en dernier). Le texte de l'action (« Lance : <commande> », nom d'un fichier) n'est PLUS écrit dans `activite` : cette table est lisible
-- par les membres invités d'un projet (policy `membre_activite`), et une commande peut porter un secret. Secrets masqués avant d'écrire.
create or replace function cockpit.signaler_action_live(p_projet text, p_branche text, p_action text)
returns uuid language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare v_pid uuid; v_focus uuid; v_action text := left(btrim(cockpit.masquer_secrets(coalesce(p_action, ''))), 200);
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(btrim(coalesce(p_branche, '')), '') is null then return null; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return null; end if;
  update cockpit.sessions set action_live = v_action, action_live_at = now(), vu_at = greatest(vu_at, now())
   where projet_id = v_pid and branche = p_branche and fin_at is null;
  -- Les chantiers de cette session : ceux réservés à sa branche, ET ceux sur lesquels elle a signalé une étape il y a moins
  -- de 12 h (même règle que cockpit.sans_signe_de_vie : un chantier réservé au nom d'une AUTRE branche — copie de travail —
  -- mais suivi par cette session vivante est le sien aussi).
  select s.id into v_focus from cockpit.chantiers_de_la_session(v_pid, p_branche, 12) s limit 1;
  if v_focus is null then return null; end if;
  insert into cockpit.activite (projet_id, chantier_id, session, etape, pourcentage, statut, pct_estime)
  values (v_pid, v_focus, p_branche, 'Au travail', 0, 'en_cours', false)
  on conflict (chantier_id, session) do update set updated_at = now(), statut = 'en_cours';
  -- Tant qu'elle travaille, sa réservation ne tombe pas (un long travail continu n'est jamais « libéré »).
  update cockpit.chantiers set pris_jusqu_a = now() + interval '3 hours'
   where projet_id = v_pid and pris_par = p_branche and pris_jusqu_a < now() + interval '2 hours'
     and id in (select s.id from cockpit.chantiers_de_la_session(v_pid, p_branche, 12) s);
  return v_focus;
end $$;

-- Fin de tour (hook Stop) : la session a rendu la main à Raphaël, elle attend son prochain message.
create or replace function cockpit.signaler_fin_tour(p_projet text, p_branche text)
returns integer language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare n int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  update cockpit.sessions set action_live = null, action_live_at = null, vu_at = greatest(vu_at, now())
   where branche = p_branche and projet_id = (select id from cockpit.projets where slug = p_projet) and (action_live is not null or action_live_at is not null);
  update cockpit.activite a set statut = 'attente', action_live = null, updated_at = now()
   where a.session = p_branche and a.statut = 'en_cours'
     and a.chantier_id in (select c.id from cockpit.chantiers c join cockpit.projets p on p.id = c.projet_id
                            where p.slug = p_projet and c.archived_at is null and c.etat = 'en_cours');
  get diagnostics n = row_count;
  return n;
end $$;

-- progression.sh --etape : un pourcentage donné par la session lève le drapeau « estimé » (avant, une barre à 35 % restait
-- marquée « sans pourcentage » parce qu'elle était née d'une action en direct).
create or replace function cockpit.signaler_activite(p_projet text, p_chantier uuid, p_session text, p_etape text, p_pourcentage integer default null, p_eta integer default null, p_statut text default 'en_cours', p_detail text default null)
returns cockpit.activite language plpgsql security definer set search_path to 'cockpit', 'pg_temp' as $$
declare v_projet uuid; r cockpit.activite;
begin
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  insert into cockpit.activite (projet_id, chantier_id, session, etape, pourcentage, eta_secondes, statut, detail)
  values (v_projet, p_chantier, p_session, p_etape, coalesce(p_pourcentage, 0), p_eta, p_statut, p_detail)
  on conflict (chantier_id, session) do update
     set etape = excluded.etape,
         pourcentage = coalesce(p_pourcentage, cockpit.activite.pourcentage),
         pct_estime = cockpit.activite.pct_estime or p_pourcentage is not null,
         eta_secondes = p_eta,
         statut = excluded.statut,
         detail = coalesce(p_detail, cockpit.activite.detail),
         updated_at = now()
  returning * into r;
  return r;
end $$;

-- LE MÉNAGE des chantiers déjà nés d'un message (0087) : `titre_auto` (jamais précisé par la session), ouverts par une
-- session. En ESSAI par défaut : rien n'est écrit, la liste dit ce qui serait fait. Deux niveaux :
--   'purs'          : rien d'autre que ses mots dans le fil, aucune étape signalée, pas livré (la barre « Au travail » seule).
--   'conversations' : les purs, PLUS les chantiers que la session a « livrés » pour dire seulement « relis ma réponse dans la
--                     conversation » : état « à vérifier », aucun jalon de mise en ligne autre que « pas en ligne », aucun agent,
--                     aucune carte, aucun mot de Raphaël écrit dans le cockpit, aucun lien de vérification hors du cockpit.
-- Ce qui est « rangé » : ses messages (et les réponses de la session) reviennent dans la discussion du projet, avec le compte rendu
-- de la session ; le chantier est archivé (« Désarchiver » le rend), jamais supprimé.
-- Ce qui est « à voir » : il y a du vrai travail dessus (étape, % donné, agent, carte, mise en ligne, lien) : jamais touché, avec le
-- chantier le plus proche (« Fusionner avec… » du menu du fil) pour que Raphaël décide.
drop function if exists cockpit.ranger_chantiers_nes_de_messages(text, boolean);
create or replace function cockpit.ranger_chantiers_nes_de_messages(p_projet text, p_niveau text default 'purs', p_essai boolean default true)
returns jsonb language plpgsql security definer set search_path to 'cockpit', 'extensions', 'pg_temp' as $$
declare v_pid uuid; c record; travail boolean; pur boolean; conv boolean; proche jsonb; ranges jsonb := '[]'::jsonb; a_voir jsonb := '[]'::jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if p_niveau not in ('purs', 'conversations') then raise exception 'niveau inconnu : % (purs ou conversations)', p_niveau; end if;
  select id into v_pid from cockpit.projets where slug = p_projet;
  if v_pid is null then raise exception 'projet inconnu : %', p_projet; end if;
  for c in select ch.id, ch.titre, ch.etat, ch.jalons, ch.comment_verifier from cockpit.chantiers ch
            where ch.projet_id = v_pid and ch.titre_auto and ch.origine = 'session' and ch.archived_at is null
              and ch.etat in ('en_cours', 'libre', 'a_trier', 'a_verifier')
            order by ch.created_at loop
    -- Du travail sur le chantier, quel que soit son état : un agent, une carte, un mot écrit dans le cockpit, une mise en ligne, un lien hors du cockpit.
    travail := exists (select 1 from cockpit.taches t where t.chantier_id = c.id)
            or exists (select 1 from cockpit.messages m where m.chantier_id = c.id and (m.kind in ('question', 'action') or (m.auteur_type in ('proprietaire', 'utilisateur') and not m.via_session)))
            or exists (select 1 from jsonb_object_keys(coalesce(c.jalons, '{}'::jsonb)) k where k not in ('pas_en_ligne', 'termine'))
            or (coalesce(c.comment_verifier, '') ~ 'https?://' and coalesce(c.comment_verifier, '') !~ 'rnab26\.github\.io/Cockpit-General');
    pur := c.etat <> 'a_verifier' and not travail
       and not exists (select 1 from cockpit.activite a where a.chantier_id = c.id and (a.pourcentage > 0 or a.etape <> 'Au travail' or a.statut in ('termine', 'echec')))
       and not exists (select 1 from cockpit.messages m where m.chantier_id = c.id and not (
             (m.auteur_type = 'session' and m.kind = 'info' and (m.corps like 'Chantier ouvert depuis une session : %' or m.corps like 'Chantier repris pour une nouvelle demande : %'))
             or (m.auteur_type = 'proprietaire' and m.via_session)));
    conv := p_niveau = 'conversations' and c.etat = 'a_verifier' and not travail;
    if pur or conv then
      ranges := ranges || jsonb_build_object('id', c.id, 'titre', c.titre, 'etat', c.etat, 'genre', case when pur then 'message' else 'conversation' end);
      if not p_essai then
        -- Ses messages et les réponses de la session reviennent dans la discussion du projet, à leur heure, sans doublon et sans
        -- fausse « réponse non lue » (aucune référence à un message : la pastille ne s'allume pas).
        insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, via_session, recu_at, recu_par, created_at)
        select m.projet_id, null, m.auteur, m.auteur_type, 'info', m.corps, m.via_session, m.recu_at, m.recu_par, m.created_at
          from cockpit.messages m
         where m.chantier_id = c.id and m.kind = 'info' and m.auteur_type in ('proprietaire', 'session')
           and not (m.auteur_type = 'session' and (m.corps like 'Chantier ouvert depuis une session : %' or m.corps like 'Chantier repris pour une nouvelle demande : %'))
           and not exists (select 1 from cockpit.messages d where d.projet_id = m.projet_id and d.chantier_id is null and d.corps = m.corps and d.created_at = m.created_at);
        if conv then
          insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, created_at)
          select v_pid, null, a.session, 'session', 'info', left('Compte rendu de la session : ' || a.etape, 600), a.updated_at
            from cockpit.activite a
           where a.chantier_id = c.id and a.statut = 'termine' and a.etape <> 'Au travail'
           order by a.updated_at desc limit 1;
        end if;
        update cockpit.activite set statut = 'attente', action_live = null where chantier_id = c.id and statut = 'en_cours';
        update cockpit.chantiers set etat = 'reporte', reporte_jusqu_a = null, pris_par = null, pris_jusqu_a = null, archived_at = now() where id = c.id;
        insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
        values (v_pid, c.id, 'session', 'session', 'info', 'Rangé : ce message n''était pas un chantier. Il est dans la discussion du projet.');
      end if;
    else
      select jsonb_build_object('id', x.id, 'titre', x.titre, 'score', round(x.score::numeric, 2)) into proche
        from cockpit.chantiers_proches(p_projet, c.titre, 6) x
        join cockpit.chantiers y on y.id = x.id
       where x.id <> c.id and not x.archive and not y.titre_auto and x.score >= 0.2
       order by x.score desc limit 1;
      a_voir := a_voir || jsonb_build_object('id', c.id, 'titre', c.titre, 'etat', c.etat, 'proche', proche,
        'pourquoi', case when travail then 'il y a du vrai travail ou un lien dessus' when c.etat = 'a_verifier' and p_niveau = 'purs' then 'livré : rangé seulement au niveau « conversations »' else 'il a une étape ou un résultat' end);
    end if;
  end loop;
  return jsonb_build_object('projet', p_projet, 'niveau', p_niveau, 'essai', p_essai, 'ranges', ranges, 'a_voir', a_voir);
end $$;

revoke all on function cockpit.message_a_ranger(text), cockpit.chantiers_de_la_session(uuid, text, numeric),
  cockpit.chantier_du_message(uuid, text, text, text), cockpit.consigner_message_attente(text, text, text, text),
  cockpit.deposer_message_id(cockpit.messages_session_attente, uuid), cockpit.fils_du_tour_sans_reponse(text, text, timestamp with time zone),
  cockpit.ranger_chantiers_nes_de_messages(text, text, boolean) from public, anon, authenticated;
grant execute on function cockpit.message_a_ranger(text), cockpit.chantiers_de_la_session(uuid, text, numeric),
  cockpit.chantier_du_message(uuid, text, text, text), cockpit.consigner_message_attente(text, text, text, text),
  cockpit.deposer_message_id(cockpit.messages_session_attente, uuid), cockpit.fils_du_tour_sans_reponse(text, text, timestamp with time zone),
  cockpit.ranger_chantiers_nes_de_messages(text, text, boolean) to service_role;
