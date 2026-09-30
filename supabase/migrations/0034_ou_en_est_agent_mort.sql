-- Une demande « où ça en est ? » prise par un assistant qui meurt (contexte saturé, conteneur arrêté)
-- restait « reçue » pour toujours : la chef répondait RIEN et Raphaël devait relancer à la main.
-- Désormais : reçue par une branche agent/… depuis plus de 30 min sans réponse = de nouveau à servir.
CREATE OR REPLACE FUNCTION cockpit.ou_en_est_sans_suite(p_projet_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(message_id uuid, chantier_id uuid, projet_id uuid, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  select m.id, m.chantier_id, m.projet_id, m.created_at
    from cockpit.messages m
    join cockpit.chantiers c on c.id = m.chantier_id
    join cockpit.projets p on p.id = c.projet_id
   where m.ou_en_est and (m.recu_at is null or (m.recu_par like 'agent/%' and m.recu_at < now() - interval '30 minutes'))
     and m.id = cockpit.ou_en_est_en_attente(m.chantier_id)
     and p.actif and c.archived_at is null and c.etat <> 'valide'
     and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else c.projet_id = p_projet_id end)
     and not exists (select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                        and t.vu_at > now() - interval '30 minutes')
     and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                        and se.vu_at > now() - interval '30 minutes' and se.branche is not null
                        and c.pris_par is not null and c.pris_jusqu_a > now() and se.branche = c.pris_par)
     and not exists (select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
                        and a.updated_at > now() - interval '30 minutes')
   order by m.created_at;
$function$

;
CREATE OR REPLACE FUNCTION cockpit.prendre_ou_en_est(p_branche text, p_projet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare r record; m cockpit.messages; c cockpit.chantiers; p cockpit.projets; a cockpit.activite; v_msgs jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(coalesce(p_branche, '')), '') is null then raise exception 'donne la branche de l''agent'; end if;
  for r in select * from cockpit.ou_en_est_sans_suite(p_projet_id) loop
    select * into m from cockpit.messages where id = r.message_id and (recu_at is null or (recu_par like 'agent/%' and recu_at < now() - interval '30 minutes')) for update skip locked;
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
end $function$

;
