-- Certifier ne fait plus disparaître une question ouverte (29 sept. 2026)
--
-- Constaté : Raphaël a certifié « Chaque fil de chantier devient une vraie
-- discussion » (450afa9e) ; sa question encore ouverte « Quand tu écris dans un
-- fil, je réveille Claude tout de suite ? » (876ad67b) a été fermée seule par le
-- trigger retirer_sans_objet (0022) : elle portait sur une décision FUTURE, pas
-- sur ce qu'il venait de certifier. Sa décision était perdue.
--
-- Désormais :
--  1. Certifier ne ferme plus une question ou action ouverte : elle reste dans
--     « À toi », rattachée au chantier certifié (l'app la lui montre d'abord
--     quand il touche « Ça marche » : il répond, ou « Certifier quand même »).
--     Les fusions proposées qui citent le chantier sont toujours « sans objet ».
--     Archiver (abandonner le sujet) ferme toujours questions et fusions.
--     Attention : certifier_chantier pose aussi archived_at (« Fini ») ; les
--     règles qui écartaient les chantiers archivés (reponses_sans_suite,
--     a_toi_a_revoir, et aToi dans l'app) gardent donc ceux qui sont certifiés.
--  2. Une réponse à une question d'un chantier CERTIFIÉ est reprise comme une
--     question de projet : reponses_sans_suite ne l'écarte plus, et
--     reprendre_reponse ouvre un chantier « Suite de ta réponse : … » (interne,
--     réservé à l'agent) où la question et ses pièces sont déplacées, sans
--     jamais rouvrir le chantier certifié ; son fil dit où ça continue.
-- Idempotente (create or replace).

-- 1. Sans objet : les fusions toujours ; les questions seulement à l'archivage.
create or replace function cockpit.retirer_sans_objet()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_raison text; v_archive boolean := false;
begin
  -- certifier_chantier pose AUSSI archived_at (le certifié passe dans « Fini ») :
  -- la certification se teste d'abord, sinon elle serait prise pour un archivage.
  if new.etat = 'valide' and old.etat is distinct from 'valide' then v_raison := 'chantier certifié';
  elsif new.archived_at is not null and old.archived_at is null then v_raison := 'chantier archivé'; v_archive := true;
  else return new; end if;
  -- Une question ouverte peut porter sur la suite (une décision à venir) :
  -- certifier ne la ferme plus. Archiver (le sujet est abandonné) si.
  if v_archive then
    update cockpit.messages
       set answered_at = now(), reponse = 'Retirée automatiquement : ' || v_raison || ', la question est sans objet.'
     where chantier_id = new.id and kind in ('question', 'action') and answered_at is null;
  end if;
  update cockpit.messages
     set answered_at = now(), reponse = 'Sans objet : ' || v_raison || '.'
   where kind = 'fusion' and answered_at is null
     and (options->0->>'source' = new.id::text or options->0->>'cible' = new.id::text);
  return new;
end $$;
revoke all on function cockpit.retirer_sans_objet() from public, anon, authenticated;

drop trigger if exists retirer_sans_objet on cockpit.chantiers;
create trigger retirer_sans_objet after update of etat, archived_at on cockpit.chantiers
  for each row execute function cockpit.retirer_sans_objet();

-- 2a. La même règle que 0018, sauf : un chantier certifié ne rend plus sa réponse invisible.
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
       and p.actif
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else m.projet_id = p_projet_id end)
       and not exists (select 1 from cockpit.messages s where s.id <> m.id and s.auteur_type = 'session'
                          and (s.repond_a = m.id or (s.projet_id = m.projet_id and s.chantier_id is null and s.created_at > m.answered_at)))
  ) x order by x.answered_at;
$$;
revoke all on function cockpit.reponses_sans_suite(uuid, text) from public, anon, authenticated;
grant execute on function cockpit.reponses_sans_suite(uuid, text) to service_role;

-- 2b. Reprise : un chantier certifié n'est jamais rouvert, la suite part dans un chantier neuf.
create or replace function cockpit.reprendre_reponse(p_branche text, p_projet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r record; m cockpit.messages; c cockpit.chantiers; origine cockpit.chantiers; p cockpit.projets;
        v_etat text; v_medias int; v_texte text;
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
    origine := null;
    if r.chantier_id is not null then
      select * into origine from cockpit.chantiers where id = r.chantier_id;
      if origine.etat <> 'valide' then origine := null; end if;
    end if;
    if r.chantier_id is null or origine.id is not null then
      -- Question de niveau projet, ou d'un chantier CERTIFIÉ (jamais rouvert) :
      -- elle devient un chantier (interne, réservé à l'agent), la question et ses
      -- pièces y sont rattachées pour que le suivi soit le même.
      insert into cockpit.chantiers (projet_id, titre, demande, etat, origine, visible_utilisateurs, pris_par, pris_jusqu_a)
      values (m.projet_id, left('Suite de ta réponse : ' || m.corps, 80),
              coalesce('Sur le chantier certifié « ' || origine.titre || E' »\n', '')
              || 'Question de Claude : ' || m.corps || E'\nRéponse de Raphaël : ' || coalesce(m.reponse, '') || coalesce(E'\nSa précision : ' || m.precision, ''),
              'en_cours', 'session', false, p_branche, now() + interval '180 minutes')
      returning * into c;
      update cockpit.messages set chantier_id = c.id
       where projet_id = m.projet_id and chantier_id is not distinct from m.chantier_id
         and (id = m.id or (auteur_type <> 'session' and jsonb_array_length(medias) > 0
              and created_at between m.answered_at - interval '1 minute' and m.answered_at + interval '10 minutes'));
      if origine.id is not null then
        insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
        values (origine.projet_id, origine.id, p_branche, 'session', 'info',
                'Ta réponse « ' || left(coalesce(m.reponse, ''), 120) || ' » continue dans le chantier « ' || c.titre || ' ».');
        v_etat := 'question d''un chantier certifié';
      else
        v_etat := 'question de projet';
      end if;
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
revoke all on function cockpit.reprendre_reponse(text, uuid) from public, anon, authenticated;
grant execute on function cockpit.reprendre_reponse(text, uuid) to service_role;

-- 3. « À toi » à revoir (0022) : une question gardée sur un certifié (archivé « Fini ») y reste.
create or replace function cockpit.a_toi_a_revoir(p_projet uuid, p_heures int default 12)
returns jsonb language sql stable security definer set search_path = cockpit, extensions, pg_temp as $$
  with travail as (   -- le dernier travail d'une session sur chaque chantier (même règle que l'app)
    select chantier_id, max(t) as t from (
      select chantier_id, created_at as t from cockpit.messages
       where projet_id = p_projet and auteur_type = 'session' and kind not in ('question', 'action', 'fusion') and chantier_id is not null
      union all select chantier_id, updated_at from cockpit.activite where projet_id = p_projet and chantier_id is not null
      union all select chantier_id, progres_at from cockpit.taches where projet_id = p_projet and chantier_id is not null and progres_at is not null
    ) x group by chantier_id
  ), elements as (
    select 'question' as type, m.id, m.chantier_id, coalesce(c.titre, 'Question sur le projet') as titre, m.corps as texte,
           greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) as depuis, c.pris_par, c.pris_jusqu_a
      from cockpit.messages m left join cockpit.chantiers c on c.id = m.chantier_id
     where m.projet_id = p_projet and m.kind in ('question', 'action') and m.answered_at is null
       and (m.chantier_id is null or c.archived_at is null or c.etat = 'valide')
    union all
    select c.etat, c.id, c.id, c.titre,
           case c.etat when 'bloque' then coalesce(b.corps, '') else left(coalesce(c.comment_verifier, c.demande, ''), 400) end,
           greatest(case c.etat when 'a_verifier' then coalesce(greatest(c.livre_at, c.verdict_at), c.updated_at)
                               when 'bloque' then coalesce(b.created_at, c.updated_at) else c.updated_at end,
                    coalesce(c.a_toi_revu_at, '-infinity')),
           c.pris_par, c.pris_jusqu_a
      from cockpit.chantiers c
      left join lateral (select corps, created_at from cockpit.messages where chantier_id = c.id and kind = 'blocage' order by created_at desc limit 1) b on true
     where c.projet_id = p_projet and c.archived_at is null and c.etat in ('a_verifier', 'a_cadrer', 'bloque')
       and not (c.etat = 'a_verifier' and c.verif_demandee_at is not null)
  ), juges as (
    select e.*, case when w.t > e.depuis + interval '2 minutes' then w.t end as avance_depuis
      from elements e left join travail w on w.chantier_id = e.chantier_id
     -- Un chantier qu'une session ou un agent tient encore : c'est à elle de tenir ses éléments à jour.
     where e.pris_par is null or e.pris_jusqu_a is null or e.pris_jusqu_a < now()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', j.type, 'id', j.id, 'chantier_id', j.chantier_id, 'titre', j.titre, 'texte', left(j.texte, 400),
           'depuis', j.depuis, 'heures', round(extract(epoch from now() - j.depuis) / 3600), 'avance_depuis', j.avance_depuis,
           'proche', (select jsonb_build_object('id', o.id, 'titre', o.titre, 'score', round(o.s::numeric, 2)) from (
                        select c2.id, c2.titre, greatest(similarity(cockpit.sujet(c2.titre), cockpit.sujet(j.titre)),
                                                        similarity(cockpit.normaliser(c2.titre), cockpit.normaliser(j.titre)) - 0.15) as s
                          from cockpit.chantiers c2
                         where c2.projet_id = p_projet and c2.archived_at is null and c2.doublon_de is null
                           and c2.id is distinct from j.chantier_id and c2.etat in ('a_verifier', 'a_cadrer', 'bloque', 'en_cours', 'libre')
                         order by 3 desc limit 1) o where o.s >= 0.2))
         order by j.depuis), '[]'::jsonb)
    from juges j
   where j.depuis < now() - make_interval(hours => greatest(p_heures, 1)) or j.avance_depuis is not null;
$$;
revoke all on function cockpit.a_toi_a_revoir(uuid, int) from public, anon, authenticated;
grant execute on function cockpit.a_toi_a_revoir(uuid, int) to service_role;
