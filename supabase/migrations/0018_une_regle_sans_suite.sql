-- Une seule règle « réponse sans suite », pour le hook ET la chef (29 sept. 2026)
--
-- Doublon constaté : hooks/session-start.sh avait sa propre requête « réponses
-- que personne n'a prises », différente de reponses_sans_suite() (0017) :
-- elle filtrait answered_by, mais ne regardait ni les étapes signalées ni les
-- étapes d'agent, ni si quelqu'un tenait le chantier. Désormais le hook appelle
-- cette fonction ; les deux filtres qui lui manquaient y entrent, pour tous :
--  - SEULES les réponses de Raphaël depuis l'app (answered_by posé par
--    auth.uid()). Une réponse notée par une session (repondre_message en
--    service, answered_by null) vient de sa conversation : elle est déjà prise,
--    ni le démarrage ni la chef ne la redonnent.
--  - p_branche : la branche de l'APPELANT. Un chantier réservé à cette branche
--    n'est pas « tenu par quelqu'un d'autre » : une nouvelle session sur la
--    même branche (conversation reprise) retrouve ses réponses au démarrage,
--    même si la réservation court encore. Sans p_branche (la chef) : inchangé.
-- Idempotente : la signature change (uuid) → (uuid, text) ; l'ancienne est
-- retirée d'abord, sinon un appel à un argument serait ambigu.

drop function if exists cockpit.reponses_sans_suite(uuid);

create or replace function cockpit.reponses_sans_suite(p_projet_id uuid default null, p_branche text default null)
returns table (message_id uuid, chantier_id uuid, projet_id uuid, answered_at timestamptz)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select x.message_id, x.chantier_id, x.projet_id, x.answered_at from ((
    select distinct on (m.chantier_id) m.id as message_id, m.chantier_id, m.projet_id, m.answered_at
      from cockpit.messages m
      join cockpit.chantiers c on c.id = m.chantier_id
      join cockpit.projets p on p.id = c.projet_id
     where m.kind in ('question', 'action') and m.answered_at is not null and m.answered_by is not null
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
       -- Personne d'AUTRE ne le tient : réservation absente, expirée ou à la branche
       -- de l'appelant ; aucun agent vivant dessus ; aucune session vivante sur la
       -- branche qui le tenait (sauf celle de l'appelant).
       and (c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now()
            or (p_branche is not null and c.pris_par = p_branche))
       and not exists (select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                          and t.vu_at > now() - interval '30 minutes')
       and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                          and se.vu_at > now() - interval '30 minutes' and se.branche is not null and se.branche = c.pris_par
                          and se.branche is distinct from p_branche)
     order by m.chantier_id, m.answered_at desc)
    union all
    -- Une question SANS chantier (niveau projet) : suivie seulement si une session
    -- a écrit ensuite au niveau du projet, ou y a répondu (repond_a).
    select m.id, null::uuid, m.projet_id, m.answered_at
      from cockpit.messages m
      join cockpit.projets p on p.id = m.projet_id
     where m.chantier_id is null and m.kind in ('question', 'action') and m.answered_at is not null and m.answered_by is not null
       and m.answered_at > now() - interval '7 days'
       and coalesce(m.reponse, '') not like 'Retirée par Claude%'
       and p.actif
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else m.projet_id = p_projet_id end)
       and not exists (select 1 from cockpit.messages s where s.id <> m.id and s.auteur_type = 'session'
                          and (s.repond_a = m.id or (s.projet_id = m.projet_id and s.chantier_id is null and s.created_at > m.answered_at)))
  ) x order by x.answered_at;
$$;

revoke all on function cockpit.reponses_sans_suite(uuid, text) from public, anon, authenticated;
grant execute on function cockpit.reponses_sans_suite(uuid, text) to service_role;
