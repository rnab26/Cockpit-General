-- « Où ça en est ? » + son message dans le même fil : UN seul assistant (30 sept. 2026)
--
-- Chantier 73fddb87. Constaté en base le 30 sept. à 00:50 : Raphaël a touché
-- « Corriger » puis « Où ça en est ? » sur le même chantier ; la même passe de
-- la chef a donné la demande à un assistant « Point » (prendre_ou_en_est,
-- agent/point-640655) ET son message à un assistant « Répondre »
-- (reprendre_message, agent/message-753430) : deux agents pour UN fil, deux
-- réponses possibles.
--
-- Règle : le premier qui prend le fil prend TOUT ce qui y attend une réponse.
--  - prendre_ou_en_est marque aussi reçus (par sa branche) les messages libres
--    du chantier encore sans réponse, et les rend dans 'messages' : sa réponse
--    (progression.sh --point) couvre les deux. messages_sans_reponse ne les
--    redonne plus (recu_par agent/…, moins de 2 h).
--  - reprendre_message marque reçue (par sa branche) la demande « où ça en
--    est » en attente du chantier et le dit ('ou_en_est') : sa réponse --point
--    y répond (repondre_ou_en_est). ou_en_est_sans_suite ne la redonne plus
--    (recu_at posé).
-- Idempotente.

create or replace function cockpit.prendre_ou_en_est(p_branche text, p_projet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r record; m cockpit.messages; c cockpit.chantiers; p cockpit.projets; a cockpit.activite; v_msgs jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(coalesce(p_branche, '')), '') is null then raise exception 'donne la branche de l''agent'; end if;
  for r in select * from cockpit.ou_en_est_sans_suite(p_projet_id) loop
    select * into m from cockpit.messages where id = r.message_id and recu_at is null for update skip locked;
    continue when m.id is null;
    update cockpit.messages set recu_at = now(), recu_par = p_branche where id = m.id;
    select * into c from cockpit.chantiers where id = m.chantier_id;
    select * into p from cockpit.projets where id = c.projet_id;
    select * into a from cockpit.activite where chantier_id = c.id order by updated_at desc limit 1;
    -- Ses messages libres du même fil, sans réponse et que personne n'a pris : à cet assistant aussi.
    with a_prendre as (
      select x.* from cockpit.messages x
       where x.chantier_id = c.id and x.created_at > now() - interval '7 days'
         and cockpit.est_message_libre(x)
         and not coalesce(x.recu_par like 'agent/%' and x.recu_at > now() - interval '2 hours', false)
         and not exists (select 1 from cockpit.messages s where s.chantier_id = x.chantier_id
                            and s.auteur_type = 'session' and s.created_at > x.created_at)
    ), marques as (
      update cockpit.messages x set recu_at = now(), recu_par = p_branche from a_prendre y where x.id = y.id returning x.*
    )
    select jsonb_agg(jsonb_build_object('quand', to_char(created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'),
             'texte', left(corps, 1500)) order by created_at) into v_msgs from marques;
    return jsonb_build_object('id', c.id, 'titre', c.titre, 'slug', p.slug, 'depot', p.depot, 'etat', c.etat,
      'pris_par', c.pris_par, 'demande', left(coalesce(c.demande, ''), 1500), 'demande_id', m.id,
      'demande_le', to_char(m.created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'),
      'messages', coalesce(v_msgs, '[]'::jsonb),
      'derniere_etape', case when a.id is null then null else a.etape || coalesce(' (' || a.pourcentage || ' %, ' || a.session || ', '
        || to_char(a.updated_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI') || ')', '') end);
  end loop;
  return null;
end $$;

create or replace function cockpit.reprendre_message(p_branche text, p_projet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r record; c cockpit.chantiers; p cockpit.projets; v_msgs jsonb; v_contexte jsonb; v_medias int; v_oe uuid;
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
    -- Sa demande « où ça en est ? » en attente sur ce fil : la même réponse la couvre (0032).
    v_oe := null;
    if c.id is not null then
      update cockpit.messages set recu_at = now(), recu_par = p_branche
       where id = cockpit.ou_en_est_en_attente(c.id) and recu_at is null
      returning id into v_oe;
    end if;
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
      'messages', v_msgs, 'contexte', coalesce(v_contexte, '[]'::jsonb), 'medias', v_medias, 'ou_en_est', v_oe is not null);
  end loop;
  return null;
end $$;

revoke all on function cockpit.prendre_ou_en_est(text, uuid), cockpit.reprendre_message(text, uuid) from public, anon, authenticated;
grant execute on function cockpit.prendre_ou_en_est(text, uuid), cockpit.reprendre_message(text, uuid) to service_role;
