-- Chaque fil devient une vraie discussion (29 sept. 2026, chantier 450afa9e)
--
-- Raphaël : « Il y a plusieurs fois où je pose des questions du type "je n'ai
-- pas compris ta demande" et je n'ai pas de retour. Le chantier s'actualise
-- mais c'est pas clair. Tout endroit où il y a un fil de discussion possible,
-- il faut que je puisse obtenir une réponse de la session directement dedans
-- pour pouvoir poursuivre. »
--
-- Jusqu'ici, seules ses RÉPONSES aux questions étaient garanties (0017/0018),
-- et une simple étape signalée comptait comme « suite ». Un message LIBRE
-- (« Écrire à Claude », « Corriger », une remarque) n'était remis qu'à la
-- session qui tenait le chantier, sinon au démarrage d'une session — et
-- personne n'était tenu d'y répondre dans le fil.
--
-- Règle (UNE seule, pour le hook de démarrage ET la chef) :
--  - messages_sans_reponse(projet, branche) : ses messages libres (kind info /
--    constat / reponse, écrits par un humain) des 7 derniers jours qu'AUCUN
--    message de session n'a suivis dans le même fil (chantier, ou fil du projet
--    pour « Écrire à Claude » hors chantier). Une étape ne suffit PAS : il faut
--    une réponse écrite. Un fil par ligne (son plus ancien message sans réponse).
--    Pas ceux que d'autres voies servent déjà : « Ça fonctionne » (chantier
--    certifié/archivé), « vérifie pour moi » (0016, un agent rend un verdict),
--    « Où ça en est ? » (0022, ou_en_est), les pièces jointes d'une réponse à
--    une question (0017), une fusion de doublon.
--    Personne d'AUTRE ne le tient (mêmes conditions que reponses_sans_suite),
--    et aucun assistant ne l'a pris depuis moins de 2 h (recu_par/recu_at).
--  - reprendre_message(branche, projet) : la chef en prend UN fil, le plus
--    ancien ; ses messages sont marqués reçus par la branche de l'agent
--    (l'app le dit : « un assistant prépare la réponse »), le chantier est
--    réservé 60 min à l'agent SANS changer son état (répondre n'est pas
--    forcément travailler), et la fonction rend de quoi écrire la consigne.
--  - marquer_messages_recus(ids, par) : le hook de suivi marque « reçu » ce
--    qu'il remet à une session vivante (l'app : « la session l'a reçu »).
--  - chefs.reveil_minute : la minute du réveil horaire de la chef, pour que
--    l'app dise « prochain passage vers 17 h 08 » (chef.sh --reveil … --minute).
-- Idempotente.

-- Mêmes définitions que 0022 (« Où ça en est ? », autre branche) : sans effet
-- si elle est déjà passée, et elle passera sans effet après celle-ci.
alter table cockpit.messages add column if not exists ou_en_est boolean not null default false;
alter table cockpit.messages add column if not exists recu_at timestamptz;
alter table cockpit.messages add column if not exists recu_par text;
alter table cockpit.chefs add column if not exists reveil_minute int check (reveil_minute between 0 and 59);

-- Un message humain « libre » qui attend une réponse écrite de Claude. MÊME
-- règle dans l'app : app/src/lib/discussion.ts (estMessageLibre) ;
-- verifier-base.mjs §23 compare les deux sur les mêmes lignes.
create or replace function cockpit.est_message_libre(m cockpit.messages)
returns boolean language sql stable set search_path = cockpit, pg_temp as $$
  select m.auteur_type in ('proprietaire', 'utilisateur')
     and m.kind in ('info', 'constat', 'reponse')
     -- Un constat vient d'un bouton : seul « Ça ne marche pas : … » (Corriger)
     -- attend une réponse ; « Ça fonctionne » et « vérifie pour moi » sont servis ailleurs.
     and (m.kind <> 'constat' or m.corps like 'Ça ne marche pas : %')
     and not coalesce(m.ou_en_est, false)
     and m.corps not like 'Doublon fusionné : %'
     -- Les pièces jointes d'une réponse à une question (0013 : message juste après).
     and not (jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0 and exists (
           select 1 from cockpit.messages q where q.projet_id = m.projet_id and q.chantier_id is not distinct from m.chantier_id
              and q.kind in ('question', 'action') and q.answered_at is not null
              and m.created_at between q.answered_at - interval '5 seconds' and q.answered_at + interval '2 minutes'));
$$;

create or replace function cockpit.messages_sans_reponse(p_projet_id uuid default null, p_branche text default null)
returns table (message_id uuid, chantier_id uuid, projet_id uuid, created_at timestamptz, nombre int)
language sql stable security definer set search_path = cockpit, pg_temp as $$
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
                              and t.vu_at > now() - interval '30 minutes')
           and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                              and se.vu_at > now() - interval '30 minutes' and se.branche is not null and se.branche = c.pris_par
                              and se.branche is distinct from p_branche)))
   order by l.chantier_id, l.projet_id, l.created_at;
$$;

create or replace function cockpit.reprendre_message(p_branche text, p_projet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r record; c cockpit.chantiers; p cockpit.projets; v_msgs jsonb; v_contexte jsonb; v_medias int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(coalesce(p_branche, '')), '') is null then raise exception 'donne la branche de l''agent'; end if;
  for r in select * from cockpit.messages_sans_reponse(p_projet_id) order by created_at loop
    -- Un verrou par message : deux passes simultanées ne prennent pas le même fil.
    perform 1 from cockpit.messages where id = r.message_id for update skip locked;
    continue when not found;
    c := null;
    if r.chantier_id is not null then
      select * into c from cockpit.chantiers where id = r.chantier_id for update skip locked;
      continue when c.id is null;
      -- Réservé à l'agent, SANS changer l'état : répondre n'est pas forcément travailler.
      update cockpit.chantiers set pris_par = p_branche, pris_jusqu_a = now() + interval '60 minutes'
       where id = c.id and (pris_par is null or pris_jusqu_a is null or pris_jusqu_a < now() or pris_par = p_branche);
      continue when not found;
    end if;
    select * into p from cockpit.projets where id = r.projet_id;
    -- Tous ses messages sans réponse de ce fil : marqués reçus par l'agent.
    with a_prendre as (
      select m.* from cockpit.messages m
       where m.projet_id = r.projet_id and m.chantier_id is not distinct from r.chantier_id and m.created_at >= r.created_at
         and cockpit.est_message_libre(m)
         and not exists (select 1 from cockpit.messages s where s.projet_id = m.projet_id and s.chantier_id is not distinct from m.chantier_id
                            and s.auteur_type = 'session' and s.created_at > m.created_at)
    ), marques as (
      update cockpit.messages x set recu_at = now(), recu_par = p_branche from a_prendre a where x.id = a.id returning x.*
    )
    select jsonb_agg(jsonb_build_object('id', id, 'quand', to_char(created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'),
             'texte', left(corps, 1500), 'medias', jsonb_array_length(coalesce(medias, '[]'::jsonb))) order by created_at),
           coalesce(sum(jsonb_array_length(coalesce(medias, '[]'::jsonb))), 0)::int
      into v_msgs, v_medias from marques;
    continue when v_msgs is null;
    -- Les 6 messages d'avant, pour que l'agent comprenne à quoi il répond.
    select jsonb_agg(x order by x.quand) into v_contexte from (
      select to_char(m.created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI') as quand,
             case when m.auteur_type = 'session' then 'Claude' else 'Raphaël' end as qui,
             left(concat_ws(' → ', m.corps, m.reponse), 400) as texte
        from cockpit.messages m
       where m.projet_id = r.projet_id and m.chantier_id is not distinct from r.chantier_id and m.created_at < r.created_at
       order by m.created_at desc limit 6) x;
    return jsonb_build_object('id', c.id, 'titre', coalesce(c.titre, 'Fil du projet'), 'etat', c.etat,
      'demande', left(coalesce(c.demande, ''), 1500), 'slug', p.slug, 'depot', p.depot, 'projet_id', p.id,
      'messages', v_msgs, 'contexte', coalesce(v_contexte, '[]'::jsonb), 'medias', v_medias);
  end loop;
  return null;
end $$;

-- Le hook de suivi : ce qu'il vient de remettre à une session VIVANTE est « reçu ».
create or replace function cockpit.marquer_messages_recus(p_ids uuid[], p_par text)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare n int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  update cockpit.messages set recu_at = now(), recu_par = left(coalesce(nullif(p_par, ''), 'session'), 120)
   where id = any(p_ids) and recu_at is null and auteur_type in ('proprietaire', 'utilisateur');
  get diagnostics n = row_count;
  return n;
end $$;

-- Répondre dans un fil (scripts/repondre.sh) : un message de session, rattaché
-- au dernier message humain sans réponse du fil (repond_a).
create or replace function cockpit.repondre_dans_fil(p_projet text, p_chantier uuid, p_auteur text, p_texte text)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid; v_id uuid := gen_random_uuid(); v_a uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(coalesce(p_texte, '')), '') is null then raise exception 'la réponse est vide'; end if;
  if p_chantier is not null then
    select projet_id into v_projet from cockpit.chantiers where id = p_chantier;
    if v_projet is null then raise exception 'chantier introuvable'; end if;
  else
    select id into v_projet from cockpit.projets where slug = p_projet;
    if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  end if;
  select m.id into v_a from cockpit.messages m
   where m.projet_id = v_projet and m.chantier_id is not distinct from p_chantier and m.auteur_type in ('proprietaire', 'utilisateur')
   order by m.created_at desc limit 1;
  insert into cockpit.messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, repond_a)
  values (v_id, v_projet, p_chantier, coalesce(nullif(p_auteur, ''), 'session'), 'session', 'info', p_texte, v_a);
  return v_id;
end $$;

-- Le prochain passage de la chef d'un projet (réveil horaire), pour l'app.
create or replace function cockpit.prochain_passage_chef(p_projet_id uuid)
returns timestamptz language sql stable security definer set search_path = cockpit, pg_temp as $$
  select case
    when c.reveil_minute is not null then
      date_trunc('hour', now()) + make_interval(mins => c.reveil_minute)
        + case when date_trunc('hour', now()) + make_interval(mins => c.reveil_minute) <= now() then interval '1 hour' else interval '0' end
    else null end
  from cockpit.chefs c where c.projet_id = p_projet_id and c.actif and c.session_id is not null and c.reveil_trigger is not null
    and (cockpit.est_service() or cockpit.est_membre(p_projet_id));
$$;

revoke all on function cockpit.est_message_libre(cockpit.messages), cockpit.messages_sans_reponse(uuid, text),
  cockpit.reprendre_message(text, uuid), cockpit.marquer_messages_recus(uuid[], text),
  cockpit.repondre_dans_fil(text, uuid, text, text), cockpit.prochain_passage_chef(uuid) from public, anon, authenticated;
grant execute on function cockpit.est_message_libre(cockpit.messages), cockpit.messages_sans_reponse(uuid, text),
  cockpit.reprendre_message(text, uuid), cockpit.marquer_messages_recus(uuid[], text),
  cockpit.repondre_dans_fil(text, uuid, text, text) to service_role;
grant execute on function cockpit.prochain_passage_chef(uuid) to authenticated, service_role;

-- Le réveil du cockpit (trig_01VseAzWomoQETWZcXtquBpB, « 8 * * * * », lu le 29 sept.).
update cockpit.chefs set reveil_minute = 8
 where reveil_trigger = 'trig_01VseAzWomoQETWZcXtquBpB' and reveil_minute is null;
