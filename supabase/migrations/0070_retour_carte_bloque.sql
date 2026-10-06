-- 0070 — « Ça bloque » sur une carte d'action : le retour de Raphaël arrive enfin à Claude (6 oct. 2026,
-- chantier 0fec7563).
--
-- Raphaël : « cette requête (Fusionne la PR #60) apparaît constamment, j'ai beau écrire que ça bloque et
-- que la PR 60 n'existe pas, rien ne prend mon retour » (des dizaines de fois).
-- CAUSE PROUVÉE (lue dans les fonctions, rejouée sur la base) : repondre_message laisse answered_at NUL sur
-- une action dont l'état n'est pas « fait » (la carte doit rester ouverte). Or TOUT ce qui sert son retour à
-- Claude exige answered_at non nul : reponses_sans_suite (donc reprendre_reponse, la chef, le hook de
-- démarrage), le hook de suivi des sessions vivantes. « Ça bloque » + son mot étaient écrits en base et rien
-- ne les lisait jamais ; et la carte, ouverte, ne se retire que si la PR est fusionnée ou fermée.
-- Correctif (une seule règle, au même endroit) :
--  1. messages.retour_at : quand il a touché « Ça bloque » / « Pas encore » (posé par repondre_message).
--  2. est_retour_carte(m) : un retour qui demande un travail à Claude = carte d'action ouverte, « Ça bloque »
--     (ou « Pas encore » AVEC un mot ou un fichier). « Pas encore » seul reste un simple état.
--  3. reponses_sans_suite sert ces retours (date = retour_at) ; reprendre_reponse les confie à un agent et
--     dit « carte_ouverte » pour que sa consigne exige de FERMER la carte (retirer ou reposer corrigée).
--  4. retirer_carte : Raphaël peut retirer lui-même une carte qui n'a pas lieu d'être (avec son motif).
--     Une réponse « Retirée par … » n'est jamais reprise comme demande de travail.
-- Idempotent ; schéma cockpit seulement ; aucun drop de donnée.

alter table cockpit.messages add column if not exists retour_at timestamptz;

create or replace function cockpit.est_retour_carte(m cockpit.messages)
returns boolean
language sql immutable
set search_path = cockpit, pg_temp
as $$
  select m.kind = 'action'
     and m.answered_at is null
     and m.retour_at is not null
     and (m.etat = 'bloque'
          or (m.etat = 'pas_encore'
              and (nullif(btrim(coalesce(m."precision", '')), '') is not null
                   or jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0)));
$$;
revoke all on function cockpit.est_retour_carte(cockpit.messages) from public, anon, authenticated;
grant execute on function cockpit.est_retour_carte(cockpit.messages) to service_role;

create or replace function cockpit.repondre_message(p_id uuid, p_par text, p_reponse text,
                                                    p_precision text default null, p_etat text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare m cockpit.messages;
begin
  select * into m from cockpit.messages where id = p_id and kind in ('question','action');
  if m.id is null then raise exception 'message introuvable ou pas une question'; end if;
  perform cockpit.exiger(
    cockpit.est_service() or cockpit.est_admin()
    or (m.chantier_id is not null and cockpit.peut_agir(m.chantier_id))
    or (m.chantier_id is null and cockpit.est_membre(m.projet_id)),
    'tu n''as pas accès à cette question');
  update cockpit.messages
     set reponse = coalesce(p_reponse, reponse),
         precision = coalesce(p_precision, precision),
         etat = coalesce(p_etat, etat),
         answered_at = case when kind = 'action' and coalesce(p_etat, etat) <> 'fait' then answered_at else now() end,
         -- 0070 : la carte reste ouverte, mais le retour est daté : c'est ce que Claude lit.
         retour_at = case when kind = 'action' and coalesce(p_etat, etat) <> 'fait' then now() else retour_at end,
         answered_by = auth.uid()
   where id = p_id;
end $$;

create or replace function cockpit.retirer_carte(p_id uuid, p_par text, p_motif text default null)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare m cockpit.messages; v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  select * into m from cockpit.messages where id = p_id and kind in ('question','action') and answered_at is null;
  if m.id is null then raise exception 'carte introuvable ou déjà fermée'; end if;
  perform cockpit.exiger(
    cockpit.est_service() or cockpit.est_admin()
    or (m.chantier_id is not null and cockpit.peut_agir(m.chantier_id))
    or (m.chantier_id is null and cockpit.est_membre(m.projet_id)),
    'tu n''as pas accès à cette carte');
  update cockpit.messages
     set answered_at = now(), answered_by = auth.uid(),
         reponse = 'Retirée par ' || coalesce(nullif(btrim(p_par), ''), 'Raphaël') || ' : ' || coalesce(v_motif, 'cette carte n''a pas lieu d''être')
   where id = p_id;
  -- Son motif est une information pour Claude : il la lit dans le fil (et la cause de la carte à tort s'y trouve).
  if v_motif is not null then
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (m.projet_id, m.chantier_id, coalesce(nullif(btrim(p_par), ''), 'Raphaël'), 'proprietaire', 'info',
            'J''ai retiré la carte « ' || left(m.corps, 120) || ' » : ' || v_motif);
  end if;
end $$;
revoke all on function cockpit.retirer_carte(uuid, text, text) from public, anon;
grant execute on function cockpit.retirer_carte(uuid, text, text) to authenticated, service_role;

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
       and not cockpit.est_accuse_action(m) and not cockpit.est_reponse_automatique(m) and not cockpit.est_accuse_carte_pr(m)
       and p.actif
       and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else m.projet_id = p_projet_id end)
       and not exists (select 1 from cockpit.messages s where s.id <> m.id and s.auteur_type = 'session'
                          and (s.repond_a = m.id or (s.projet_id = m.projet_id and s.chantier_id is null and s.created_at > coalesce(m.answered_at, m.retour_at))))
  ) x order by x.answered_at;
$function$;

CREATE OR REPLACE FUNCTION cockpit.reprendre_reponse(p_branche text, p_projet_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
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
            and x.created_at between coalesce(m.answered_at, m.retour_at) - interval '1 minute' and coalesce(m.answered_at, m.retour_at) + interval '10 minutes'));
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
              and created_at between coalesce(m.answered_at, m.retour_at) - interval '1 minute' and coalesce(m.answered_at, m.retour_at) + interval '10 minutes'));
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
      'repondu_le', to_char(coalesce(m.answered_at, m.retour_at) at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'), 'medias', v_medias,
      -- Une réponse qui engage une dépense (GPU, crédits…) : la consigne rappelle les barrières de budget.
      'carte_ouverte', (m.answered_at is null), 'depense', v_texte ~* '(\$|€|₪|gpu|runpod|payant|dépense|depense|crédit|credit|recharg|facturé|budget)');
  end loop;
  return null;
end $function$;

revoke all on function cockpit.reponses_sans_suite(uuid, text) from public, anon, authenticated;
grant execute on function cockpit.reponses_sans_suite(uuid, text) to service_role;
revoke all on function cockpit.reprendre_reponse(text, uuid) from public, anon, authenticated;
grant execute on function cockpit.reprendre_reponse(text, uuid) to service_role;
