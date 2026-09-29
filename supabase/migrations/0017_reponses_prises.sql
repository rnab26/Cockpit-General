-- Mes réponses sont toujours prises en charge, même sans session (29 sept. 2026)
--
-- Raphaël : « je réponds dans le cockpit, mais je ne sais pas si c'est pris
-- en compte et par quelle session. Logiquement tu es censé recevoir un
-- message "Raphaël a répondu" et tu lances le chantier. »
--
-- Une réponse sur un chantier TENU par une session vivante lui arrive en
-- direct (hooks/suivi.sh). Mais une réponse sur un chantier que personne ne
-- tient (à vérifier, bloqué, réservation expirée) n'était reprise par
-- personne : la session chef (scripts/chef.sh) ne regardait que les chantiers
-- prenables. Désormais :
--  - reponses_sans_suite() : les questions/actions auxquelles Raphaël a
--    répondu (pas retirées par Claude), que rien n'a suivies depuis (aucun
--    message de session, aucune étape signalée, aucune étape d'agent), sur un
--    chantier ouvert que personne ne tient ;
--  - reprendre_reponse(branche) : la session chef en prend UNE, la plus
--    ancienne : le chantier repart « en cours », réservé à la branche de
--    l'agent, un message « Claude reprend ta réponse » le dit dans le fil
--    (c'est aussi ce qui empêche de la reprendre deux fois), et la fonction
--    rend de quoi écrire la consigne de l'agent.
-- Fenêtre : les réponses des 7 derniers jours (jamais un vieux fil ressorti).
--
-- Projets de TEST (29 sept., constaté par la session chef : sa passe avait
-- réservé deux chantiers de « test-web-… » en plein parcours de
-- verifier-web.mjs) : un projet dont le slug commence par « test- » (les
-- scripts verifier-base / verifier-web les créent et les suppriment) n'est
-- JAMAIS donné par la chef — ni chantier prenable, ni « vérifie pour moi »,
-- ni réponse sans suite. Une seule règle : projet_de_test().

create or replace function cockpit.projet_de_test(p_slug text)
returns boolean language sql immutable as $$
  select coalesce(p_slug, '') like 'test-%';
$$;

create or replace function cockpit.reponses_sans_suite(p_projet_id uuid default null)
returns table (message_id uuid, chantier_id uuid, projet_id uuid, answered_at timestamptz)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select x.message_id, x.chantier_id, x.projet_id, x.answered_at from ((
    select distinct on (m.chantier_id) m.id as message_id, m.chantier_id, m.projet_id, m.answered_at
      from cockpit.messages m
      join cockpit.chantiers c on c.id = m.chantier_id
      join cockpit.projets p on p.id = c.projet_id
     where m.kind in ('question', 'action') and m.answered_at is not null
       and m.answered_at > now() - interval '7 days'
       and coalesce(m.reponse, '') not like 'Retirée par Claude%'
       and p.actif and c.archived_at is null and c.doublon_de is null and c.etat <> 'valide'
       -- Tous projets : jamais un projet de test ; un projet nommé : celui-là.
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else c.projet_id = p_projet_id end)
       -- Rien ne l'a suivie : ni message d'une session, ni étape, ni étape d'agent.
       and not exists (select 1 from cockpit.messages s where s.chantier_id = m.chantier_id and s.id <> m.id
                          and s.auteur_type = 'session' and s.created_at > m.answered_at)
       and not exists (select 1 from cockpit.activite a where a.chantier_id = m.chantier_id and a.updated_at > m.answered_at)
       and not exists (select 1 from cockpit.taches t where t.chantier_id = m.chantier_id and t.progres_at > m.answered_at)
       -- Personne ne le tient : réservation absente ou expirée, aucun agent vivant
       -- dessus, aucune session vivante sur la branche qui le tenait.
       and (c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now())
       and not exists (select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                          and t.vu_at > now() - interval '30 minutes')
       and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                          and se.vu_at > now() - interval '30 minutes' and se.branche is not null and se.branche = c.pris_par)
     order by m.chantier_id, m.answered_at desc)
    union all
    -- Une question SANS chantier (niveau projet, ex. FacePro 29/09 02:26 « module
    -- demandes → Seulement pour moi (admin) ») : suivie seulement si une session
    -- a écrit ensuite au niveau du projet, ou y a répondu (repond_a).
    select m.id, null::uuid, m.projet_id, m.answered_at
      from cockpit.messages m
      join cockpit.projets p on p.id = m.projet_id
     where m.chantier_id is null and m.kind in ('question', 'action') and m.answered_at is not null
       and m.answered_at > now() - interval '7 days'
       and coalesce(m.reponse, '') not like 'Retirée par Claude%'
       and p.actif
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else m.projet_id = p_projet_id end)
       and not exists (select 1 from cockpit.messages s where s.id <> m.id and s.auteur_type = 'session'
                          and (s.repond_a = m.id or (s.projet_id = m.projet_id and s.chantier_id is null and s.created_at > m.answered_at)))
  ) x order by x.answered_at;
$$;

create or replace function cockpit.reprendre_reponse(p_branche text, p_projet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r record; m cockpit.messages; c cockpit.chantiers; p cockpit.projets; v_etat text; v_medias int; v_texte text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(coalesce(p_branche, '')), '') is null then raise exception 'donne la branche de l''agent'; end if;
  for r in select * from cockpit.reponses_sans_suite(p_projet_id) loop
    select * into m from cockpit.messages where id = r.message_id for update skip locked;
    continue when m.id is null;
    -- Les médias partent dans un message « info » juste après la réponse (0013),
    -- au même niveau (chantier, ou projet pour une question sans chantier).
    select coalesce(sum(jsonb_array_length(x.medias)), 0)::int into v_medias from cockpit.messages x
     where x.projet_id = m.projet_id and x.chantier_id is not distinct from m.chantier_id
       and (x.id = m.id or (x.auteur_type <> 'session'
            and x.created_at between m.answered_at - interval '1 minute' and m.answered_at + interval '10 minutes'));
    if r.chantier_id is null then
      -- Question de niveau projet : elle devient un chantier (interne, réservé à
      -- l'agent), la question y est rattachée pour que le suivi soit le même.
      insert into cockpit.chantiers (projet_id, titre, demande, etat, origine, visible_utilisateurs, pris_par, pris_jusqu_a)
      values (m.projet_id, left('Suite de ta réponse : ' || m.corps, 80),
              'Question de Claude : ' || m.corps || E'\nRéponse de Raphaël : ' || coalesce(m.reponse, '') || coalesce(E'\nSa précision : ' || m.precision, ''),
              'en_cours', 'session', false, p_branche, now() + interval '180 minutes')
      returning * into c;
      update cockpit.messages set chantier_id = c.id
       where projet_id = m.projet_id and chantier_id is null
         and (id = m.id or (auteur_type <> 'session' and jsonb_array_length(medias) > 0
              and created_at between m.answered_at - interval '1 minute' and m.answered_at + interval '10 minutes'));
      v_etat := 'question de projet';
    else
      select * into c from cockpit.chantiers where id = r.chantier_id for update skip locked;
      continue when c.id is null;
      v_etat := c.etat;
      continue when not cockpit.reserver_chantier(c.id, p_branche, 180);
      update cockpit.chantiers set etat = 'en_cours' where id = c.id and etat <> 'en_cours';
    end if;
    select * into p from cockpit.projets where id = c.projet_id;
    v_texte := concat_ws(' ', m.corps, m.pourquoi, m.reponse, m.precision);
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (c.projet_id, c.id, p_branche, 'session', 'info',
            'Claude reprend ta réponse « ' || left(coalesce(m.reponse, ''), 120) || ' » : un assistant s''en occupe.');
    return jsonb_build_object('id', c.id, 'titre', c.titre, 'slug', p.slug, 'depot', p.depot, 'etat_avant', v_etat,
      'demande', left(coalesce(c.demande, ''), 1500),
      'question_id', m.id, 'question', m.corps, 'pourquoi', m.pourquoi, 'reponse', m.reponse, 'precision', m.precision,
      'repondu_le', to_char(m.answered_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), 'medias', v_medias,
      -- Une réponse qui engage une dépense (GPU, crédits…) : la consigne rappelle les barrières de budget.
      'depense', v_texte ~* '(\$|€|₪|gpu|runpod|payant|dépense|depense|crédit|credit|recharg|facturé|budget)');
  end loop;
  return null;
end $$;

revoke all on function cockpit.reponses_sans_suite(uuid), cockpit.reprendre_reponse(text, uuid), cockpit.projet_de_test(text) from public, anon, authenticated;
grant execute on function cockpit.reponses_sans_suite(uuid), cockpit.reprendre_reponse(text, uuid), cockpit.projet_de_test(text) to service_role;
