-- 0044 (30 sept. 2026, chantier 0f905af0). Raphaël : « Pourquoi attendre 30
-- minutes ? […] un cadenas de réservation automatique, posé tout de suite quand
-- la chef attribue, et repris vite si l'agent est mort. » Puis : « ZÉRO chantier
-- tenu pour rien » → défaut 3 min, borne basse 1 min.
--
-- Le délai « sans signe de vie » est UN réglage par projet (projets.
-- delai_sans_signe_min, 1 à 120, défaut 3) lu par UNE fonction (delai_signe).
-- Avant : 30 min écrites en dur dans 10 fonctions (0043 sans_signe_de_vie et
-- renfort_vivant ; 0011/0017/0018/0023/0025/0026/0031/0028/0038/0041 pour
-- « session ou agent vivant ») : elles lisent toutes delai_signe(projet).
-- Volontairement inchangés : bascule_usage (30 min de calme d'usage, autre
-- notion), les 3 h de renfort_vivant / réservation, les 2 h d'un message pris.
--
-- MESURÉ le 30/09 (lecture seule + code de hooks/suivi.sh, Claude Code 2.1) :
--  * signes de vie qui existent : (1) sessions.vu_at, posé par le hook
--    PostToolUse au RETOUR d'un outil, au plus 1 fois/min ; (2) taches.vu_at
--    des agents, qui SUIT sessions.vu_at (trigger 0015), aucun signe propre ;
--    (3) activite.updated_at et chantiers.updated_at, seulement quand l'agent
--    écrit une étape (progression.sh). Entre deux comptes rendus d'étape d'un
--    même chantier : médiane 9,8 min, 129 écarts sur 260 > 10 min, 76 > 30 min
--    (messages de session, 10 jours) : les étapes seules ne prouvent pas la vie.
--  * TROU : un outil qui dure (suite de tests, build ; plafond de l'outil Bash
--    = 10 min) ne déclenche AUCUN hook pendant qu'il tourne : un agent vivant
--    paraîtrait mort après 3 min. Réponse : hooks/suivi.sh ajoute un hook
--    PreToolUse qui lance un battement détaché (un signe toutes les 45 s tant
--    que l'outil tourne, 11 min au plus) ; brancher.sh le déclare, et le hook
--    de démarrage relance brancher --maj à chaque session : rien à faire à la
--    main. Signe de vie d'un agent vivant = au plus ~60 s d'écart (entre deux
--    outils : PostToolUse ; pendant un outil : battement 45 s).
--  * Limite connue : un long texte généré sans aucun outil (plus de 3 min
--    d'affilée) reste muet ; rare, et le délai se règle par projet.
--
-- CADENAS : la réservation est posée AU MOMENT de l'attribution, dans la même
-- transaction que le choix du chantier (prochain_chantier_autonome,
-- reprendre_reponse, reprendre_message -> reserver_chantier ; verifs par
-- reserver_chantier juste après le choix ; renfort par prochain_renfort). La
-- fiche est alors « touchée » : c'est le début des 3 min de grâce.
--
-- Idempotente, sans drop.

alter table cockpit.projets add column if not exists delai_sans_signe_min integer not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projets_delai_sans_signe_borne') then
    alter table cockpit.projets add constraint projets_delai_sans_signe_borne check (delai_sans_signe_min between 1 and 120);
  end if;
end $$;

-- UNE source : le délai du projet (3 min si le projet est inconnu : même valeur que le défaut de la colonne).
create or replace function cockpit.delai_signe(p_projet uuid)
returns interval language sql stable security definer set search_path = cockpit, pg_temp as $$
  select make_interval(mins => coalesce((select delai_sans_signe_min from cockpit.projets where id = p_projet), 3));
$$;

-- Réglage (admin depuis l'app, service depuis chef.sh --sans-signe).
create or replace function cockpit.regler_sans_signe(p_projet text, p_min int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_min is null or p_min not between 1 and 120 then raise exception 'Délai sans signe de vie : de 1 à 120 minutes.'; end if;
  update cockpit.projets set delai_sans_signe_min = p_min where id = pr.id;
  return jsonb_build_object('delai_sans_signe_min', p_min);
end $$;

-- La règle unique (0043), lisant le délai du projet du chantier.
create or replace function cockpit.sans_signe_de_vie(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  -- Le balayage touche lui-même la fiche (updated_at) en libérant : cette touche-là
  -- (à 1 s de libere_at) n'est pas un signe de vie, sinon un chantier « en cours »
  -- libéré resterait protégé le délai de plus.
  select (c.updated_at < now() - cockpit.delai_signe(c.projet_id)
          or (c.libere_at is not null and c.updated_at <= c.libere_at + interval '1 second'))
     and not exists (
       select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
          and a.updated_at > now() - cockpit.delai_signe(c.projet_id))
     and not exists (
       select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
          and t.vu_at > now() - cockpit.delai_signe(c.projet_id))
     and not exists (
       select 1 from cockpit.sessions se
        where se.projet_id = c.projet_id and se.fin_at is null and se.vu_at > now() - cockpit.delai_signe(c.projet_id)
          and se.branche is not null
          and (se.branche = c.pris_par
               or se.branche = (select a.session from cockpit.activite a where a.chantier_id = c.id
                                 order by a.updated_at desc limit 1)));
$$;

-- Les autres « vivant depuis 30 min » (même définition qu'avant, le délai en moins) :
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

CREATE OR REPLACE FUNCTION cockpit.reveiller_chef(p_projet_id uuid, p_chantier uuid DEFAULT NULL::uuid, p_raison text DEFAULT 'message'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare v_slug text; v_cible uuid; r cockpit.reveils_immediats; v_jeton text; v_req bigint; v_cslug text;
begin
  select slug into v_slug from cockpit.projets where id = p_projet_id;
  if v_slug is null then return 'aucune_chef'; end if;
  -- Une session vivante tient le chantier : hooks/suivi.sh le lui remet (20 s), pas besoin de réveil.
  if p_chantier is not null and exists (
       select 1 from cockpit.chantiers c join cockpit.sessions s on s.projet_id = c.projet_id and s.branche = c.pris_par
        where c.id = p_chantier and c.pris_jusqu_a > now() and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(p_projet_id)) then
    return 'session_tient';
  end if;
  -- 0038 : rien à servir (déjà répondu / repris) : on n'ouvre pas de session pour rien.
  if cockpit.rien_a_servir(p_projet_id, p_raison) then return 'rien_a_servir'; end if;
  -- Qui réveiller : la chef du projet si elle vit, sinon la chef relais. Un projet de test : lui seul.
  v_cible := cockpit.cible_reveil(p_projet_id);
  if v_cible is null then return 'aucune_chef'; end if;
  select * into r from cockpit.reveils_immediats where projet_id = v_cible and actif for update skip locked;
  if r.projet_id is null then return 'pas_configure'; end if;
  if r.dernier_at > now() - interval '5 minutes' then return 'trop_tot'; end if;
  select decrypted_secret into v_jeton from vault.decrypted_secrets where id = r.secret_id;
  if v_jeton is null then return 'pas_configure'; end if;
  select slug into v_cslug from cockpit.projets where id = v_cible;
  v_req := net.http_post(
    url := 'https://api.anthropic.com/v1/claude_code/routines/' || r.trigger_id || '/fire',
    body := jsonb_build_object('text', format('Raphaël vient d''écrire dans le cockpit (projet %s, %s). Lance la passe de la chef du projet %s.', v_slug, p_raison, v_cslug)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_jeton, 'anthropic-beta', 'experimental-cc-routine-2026-04-01',
                                  'anthropic-version', '2023-06-01', 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
  update cockpit.reveils_immediats set dernier_at = now(), dernier_request = v_req, dernier_raison = left(v_slug || ' · ' || p_raison, 120)
   where projet_id = v_cible;
  return 'envoye';
end $function$;

CREATE OR REPLACE FUNCTION cockpit.relais_a_servir(p_chef_projet text, p_test text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare v_chef uuid; r jsonb := '[]'::jsonb; p record; v_renf jsonb; v_msg int; v_ouvrir boolean; v_fermer jsonb;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_chef from cockpit.projets where slug = p_chef_projet;
  if p_test is null and (v_chef is null or v_chef is distinct from cockpit.chef_relais()) then return r; end if;
  for p in select * from cockpit.projets x
            where x.actif and x.id is distinct from v_chef
              and (case when p_test is null then not cockpit.projet_de_test(x.slug) else x.slug = p_test end)
              and not cockpit.chef_vivante(x.id)
            order by x.slug loop
    v_renf := cockpit.renforts_a_ouvrir(p.slug, p_test is not null);
    select count(*) into v_msg from cockpit.messages_sans_reponse(p.id);
    v_ouvrir := v_msg > 0
      and not exists (select 1 from cockpit.sessions s where s.projet_id = p.id and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(p.id))
      and not exists (select 1 from cockpit.ouvertures o where o.projet_id = p.id and o.created_at > now() - interval '1 hour');
    v_fermer := coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'session', o.session_distante) order by o.created_at)
                 from cockpit.ouvertures o where o.projet_id = p.id and cockpit.ouverture_finie(o.id)), '[]'::jsonb);
    continue when jsonb_array_length(v_renf -> 'ouvrir') = 0 and jsonb_array_length(v_renf -> 'archiver') = 0
              and jsonb_array_length(v_fermer) = 0 and not v_ouvrir;
    r := r || jsonb_build_object('slug', p.slug, 'nom', p.nom, 'depot', p.depot, 'renforts', v_renf,
                                 'ouvrir_session', v_ouvrir, 'messages', v_msg, 'fermer', v_fermer);
  end loop;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION cockpit.constater_autonome(p_projet text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
declare pr cockpit.projets; travail boolean;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet for update;
  if pr.id is null or not cockpit.autonome_actif(pr) then return 'eteint'; end if;
  travail := exists (select 1 from cockpit.chantiers_prenables(pr.id, null))
    or exists (select 1 from cockpit.chantiers c where c.projet_id = pr.id and c.archived_at is null
                 and c.etat = 'en_cours' and c.pris_par is not null and c.pris_jusqu_a > now())
    or exists (select 1 from cockpit.taches t where t.projet_id = pr.id and t.statut = 'en_cours'
                 and t.vu_at > now() - cockpit.delai_signe(pr.id));
  if travail then
    if pr.autonome_vide_depuis is not null then update cockpit.projets set autonome_vide_depuis = null where id = pr.id; end if;
    return 'travail';
  end if;
  if pr.autonome_vide_depuis is null then
    update cockpit.projets set autonome_vide_depuis = now() where id = pr.id;
    return 'vide';
  end if;
  if pr.autonome_arret_vide_h > 0 and pr.autonome_vide_depuis <= now() - make_interval(hours => pr.autonome_arret_vide_h) then
    update cockpit.projets set autonome_toujours = false, autonome_jusqu_a = null,
           autonome_vide_depuis = null, autonome_eteint_auto_at = now() where id = pr.id;
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (pr.id, null, 'cockpit', 'session', 'info',
            format('Mode autonome éteint tout seul : aucun chantier à prendre depuis %s h. Rallume-le d’un toucher quand tu en ajoutes.', pr.autonome_arret_vide_h));
    return 'eteint_auto';
  end if;
  return 'vide';
end $function$;

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
    select * into m from cockpit.messages where id = r.message_id and (recu_at is null or (recu_par like 'agent/%' and recu_at < now() - cockpit.delai_signe(r.projet_id))) for update skip locked;
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
end $function$;

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
                          and t.vu_at > now() - cockpit.delai_signe(c.projet_id))
       and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                          and se.vu_at > now() - cockpit.delai_signe(c.projet_id) and se.branche is not null and se.branche = c.pris_par
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
$function$;

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
   where m.ou_en_est and (m.recu_at is null or (m.recu_par like 'agent/%' and m.recu_at < now() - cockpit.delai_signe(c.projet_id)))
     and m.id = cockpit.ou_en_est_en_attente(m.chantier_id)
     and p.actif and c.archived_at is null and c.etat <> 'valide'
     and (case when p_projet_id is null then not cockpit.projet_de_test(p.slug) else c.projet_id = p_projet_id end)
     and not exists (select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                        and t.vu_at > now() - cockpit.delai_signe(c.projet_id))
     and not exists (select 1 from cockpit.sessions se where se.projet_id = c.projet_id and se.fin_at is null
                        and se.vu_at > now() - cockpit.delai_signe(c.projet_id) and se.branche is not null
                        and c.pris_par is not null and c.pris_jusqu_a > now() and se.branche = c.pris_par)
     and not exists (select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
                        and a.updated_at > now() - cockpit.delai_signe(c.projet_id))
   order by m.created_at;
$function$;

CREATE OR REPLACE FUNCTION cockpit.renfort_vivant(r renforts)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'cockpit', 'pg_temp'
AS $function$
  select (r.statut = 'demande' and r.created_at > now() - interval '3 hours')
      or (r.statut = 'actif' and coalesce(r.vu_at, r.created_at) > now() - interval '3 hours'
          and (coalesce(r.vu_at, r.created_at) > now() - cockpit.delai_signe(r.projet_id)
               or exists (select 1 from cockpit.chantiers c
                           where c.projet_id = r.projet_id and c.pris_par like r.prefixe || '/%'
                             and c.pris_jusqu_a > now() and c.archived_at is null
                             and not cockpit.sans_signe_de_vie(c))));
$function$;

revoke all on function cockpit.delai_signe(uuid), cockpit.regler_sans_signe(text, int) from public, anon, authenticated;
grant execute on function cockpit.delai_signe(uuid) to service_role;
grant execute on function cockpit.regler_sans_signe(text, int) to authenticated, service_role;
