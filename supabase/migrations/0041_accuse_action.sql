-- 0041 : répondre « Fait » à une carte d'ACTION ne lance rien (chantier ffb4bd18).
--
-- Une carte d'action (messages.marche non nul : « Fusionne la PR n… ») répondue
-- « Fait » est un accusé : elle se ferme, mais n'est JAMAIS une demande de
-- travail. Avant, reponses_sans_suite (donc la chef, reprendre_reponse et le hook
-- de démarrage) la servait : chantier « Suite de ta réponse » ou chantier
-- « a_verifier » remis en cours, agent lancé pour rien.
-- UNE règle, est_accuse_action, lue par reponses_sans_suite ; reprendre_reponse
-- boucle sur reponses_sans_suite et en hérite. Autre chose qu'un accusé (une
-- précision, un média, un texte long) : traité comme avant.
-- Idempotent ; ne touche que le schéma cockpit ; aucun drop.

create or replace function cockpit.est_accuse_action(m cockpit.messages)
returns boolean
language sql stable security definer
set search_path = cockpit, pg_temp
as $$
  select m.kind = 'action'
     and m.marche is not null and m.marche <> 'null'::jsonb
     and m.answered_at is not null
     -- Le libellé entier est un accusé (« Fait », « ok », « c'est fait »…), pas un texte.
     and regexp_replace(lower(btrim(coalesce(m.reponse, ''))), '[[:space:].!]+$', '')
         ~ '^(fait|c[''’]est fait|ok|okay|c[''’]est bon|done|terminé|termine|d[''’]accord)$'
     and nullif(btrim(coalesce(m.precision, '')), '') is null
     -- Aucun fichier joint à sa réponse (même fenêtre que reprendre_reponse).
     and not exists (
       select 1 from cockpit.messages x
        where x.projet_id = m.projet_id and x.chantier_id is not distinct from m.chantier_id
          and jsonb_array_length(coalesce(x.medias, '[]'::jsonb)) > 0
          and (x.id = m.id or (x.auteur_type <> 'session'
               and x.created_at between m.answered_at - interval '1 minute' and m.answered_at + interval '10 minutes')));
$$;
revoke all on function cockpit.est_accuse_action(cockpit.messages) from public, anon, authenticated;
grant execute on function cockpit.est_accuse_action(cockpit.messages) to service_role;

CREATE OR REPLACE FUNCTION cockpit.reponses_sans_suite(p_projet_id uuid DEFAULT NULL::uuid, p_branche text DEFAULT NULL::text)
 RETURNS TABLE(message_id uuid, chantier_id uuid, projet_id uuid, answered_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  select x.message_id, x.chantier_id, x.projet_id, x.answered_at from ((
    select distinct on (m.chantier_id) m.id as message_id, m.chantier_id, m.projet_id, m.answered_at
      from cockpit.messages m
      join cockpit.chantiers c on c.id = m.chantier_id
      join cockpit.projets p on p.id = c.projet_id
     where m.kind in ('question', 'action') and m.answered_at is not null and m.answered_by is not null
       and m.answered_at > now() - interval '7 days'
       and coalesce(m.reponse, '') not like 'Retirée par Claude%'
       -- Un accusé « Fait » à une carte d'action n'est jamais une demande de travail (0041).
       and not cockpit.est_accuse_action(m)
       -- Un certifié est aussi archivé (« Fini ») : sa question gardée reste reprise.
       and p.actif and (c.archived_at is null or c.etat = 'valide') and c.doublon_de is null
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
       and not cockpit.est_accuse_action(m)
       and p.actif
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else m.projet_id = p_projet_id end)
       and not exists (select 1 from cockpit.messages s where s.id <> m.id and s.auteur_type = 'session'
                          and (s.repond_a = m.id or (s.projet_id = m.projet_id and s.chantier_id is null and s.created_at > m.answered_at)))
  ) x order by x.answered_at;
$function$
;

revoke all on function cockpit.reponses_sans_suite(uuid, text) from public, anon, authenticated;
grant execute on function cockpit.reponses_sans_suite(uuid, text) to service_role;
