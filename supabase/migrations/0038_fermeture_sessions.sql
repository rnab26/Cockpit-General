-- SESSIONS QUI SE FERMENT SEULES (30 sept. 2026, chantier 27d251f8)
--
-- Raphaël : « plutôt que des sessions qui ne servent à rien et s'ouvrent toute
-- la journée à droite à gauche, dès qu'une session a fini son travail elle se
-- ferme directement ; un correctif ou une vérification repart ensuite dans une
-- nouvelle session. Éviter la pollution au maximum. »
--
-- Inventaire (30 sept.) : les renforts finis n'étaient archivés qu'au prochain
-- passage de la chef ; les sessions RELAIS (« [cockpit-relais] », table
-- ouvertures) et celles de la routine /fire ne l'étaient jamais ; un réveil
-- /fire partait même quand il n'y avait rien à servir.
-- Ce que la base porte, par projet (projets) :
--   fermeture_auto       fermer les sessions ouvertes par le cockpit une fois finies (défaut : oui)
--   fermeture_delai_min  minutes de grâce après la fin avant de fermer (défaut 10 ; 0 = tout de suite)
-- Jamais fermée : une session dont un chantier est en cours (réservation valide),
-- dont une question posée depuis son ouverture attend Raphaël, ou dont un
-- message de Raphaël n'a pas de réponse. Idempotente.

alter table cockpit.projets add column if not exists fermeture_auto boolean not null default true;
alter table cockpit.projets add column if not exists fermeture_delai_min int not null default 10;
alter table cockpit.ouvertures add column if not exists archive_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projets_fermeture_delai_valide') then
    alter table cockpit.projets add constraint projets_fermeture_delai_valide check (fermeture_delai_min between 0 and 1440);
  end if;
end $$;

-- Réglage (admin depuis l'app, service depuis chef.sh).
create or replace function cockpit.regler_fermeture(p_projet text, p_auto boolean, p_delai_min int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_delai_min is null or p_delai_min not between 0 and 1440 then raise exception 'Délai avant fermeture : de 0 à 1440 minutes.'; end if;
  update cockpit.projets set fermeture_auto = coalesce(p_auto, true), fermeture_delai_min = p_delai_min where id = pr.id;
  return jsonb_build_object('ok', true, 'auto', coalesce(p_auto, true), 'delai_min', p_delai_min);
end $$;

-- Ce que l'écran et chef.sh lisent : la règle n'est écrite qu'ici.
create or replace function cockpit.etat_fermeture(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return null; end if;
  return jsonb_build_object('auto', pr.fermeture_auto, 'delai_min', pr.fermeture_delai_min);
end $$;

-- Une session relais peut-elle être fermée ? Rien ne l'attend : aucun chantier
-- réservé en cours, aucune question posée depuis son ouverture sans réponse,
-- aucun message de Raphaël sans réponse, délai de grâce écoulé.
create or replace function cockpit.ouverture_finie(p_ouverture uuid)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce(o.session_distante is not null and o.archive_at is null and o.erreur is null
     and p.fermeture_auto
     and o.created_at < now() - make_interval(mins => p.fermeture_delai_min)
     and not exists (select 1 from cockpit.chantiers c where c.projet_id = o.projet_id and c.etat = 'en_cours' and c.pris_jusqu_a > now())
     and not exists (select 1 from cockpit.messages m where m.projet_id = o.projet_id and m.created_at >= o.created_at
                      and m.kind in ('question', 'action') and m.answered_at is null and m.auteur_type = 'session')
     and not exists (select 1 from cockpit.messages_sans_reponse(o.projet_id)), false)
  from cockpit.ouvertures o join cockpit.projets p on p.id = o.projet_id where o.id = p_ouverture;
$$;

-- La chef a archivé la session relais : on le note.
create or replace function cockpit.ouverture_archive(p_ouverture uuid)
returns boolean language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.ouvertures set archive_at = now() where id = p_ouverture and archive_at is null and cockpit.est_service() returning true;
$$;

-- Renforts à archiver : finis depuis plus que le délai de grâce (réglage du projet),
-- ou muets depuis 3 h. fermeture_auto éteint : plus rien n'est archivé tout seul.
create or replace function cockpit.renforts_a_ouvrir(p_projet text, p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null or (cockpit.projet_de_test(pr.slug) and not coalesce(p_test, false)) then
    return jsonb_build_object('ouvrir', '[]'::jsonb, 'archiver', '[]'::jsonb);
  end if;
  perform cockpit.renforts_expirer(pr.id);
  return jsonb_build_object(
    'ouvrir', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'section', coalesce(s.nom, 'Sans section'),
                 'chantiers', r.chantiers, 'agents', r.max_agents, 'slug', pr.slug, 'depot', pr.depot) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.statut = 'demande' and r.session_distante is null and cockpit.renfort_vivant(r)), '[]'::jsonb),
    'archiver', case when not pr.fermeture_auto then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'session', r.session_distante,
                 'section', coalesce(s.nom, 'Sans section'), 'statut', r.statut) order by r.created_at)
       from cockpit.renforts r left join cockpit.sections s on s.id = r.section_id
      where r.projet_id = pr.id and r.session_distante is not null and r.archive_at is null
        and ((r.statut = 'fini' and coalesce(r.fini_at, r.vu_at, r.created_at) < now() - make_interval(mins => pr.fermeture_delai_min))
             or (r.statut = 'erreur' and r.erreur like 'Plus aucun signe%'))), '[]'::jsonb) end);
end $$;

-- Les sessions relais finies d'un projet (celui de la chef elle-même).
create or replace function cockpit.ouvertures_a_fermer(p_projet text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'session', o.session_distante) order by o.created_at)
           from cockpit.ouvertures o where o.projet_id = pr.id and cockpit.ouverture_finie(o.id)), '[]'::jsonb);
end $$;

-- Relais : ajoute 'fermer' (sessions relais finies). L'ouverture reste conditionnée à du
-- travail (messages sans réponse, aucune session vivante, 1 par heure).
create or replace function cockpit.relais_a_servir(p_chef_projet text, p_test text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
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
      and not exists (select 1 from cockpit.sessions s where s.projet_id = p.id and s.fin_at is null and s.vu_at > now() - interval '30 minutes')
      and not exists (select 1 from cockpit.ouvertures o where o.projet_id = p.id and o.created_at > now() - interval '1 hour');
    v_fermer := coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'session', o.session_distante) order by o.created_at)
                 from cockpit.ouvertures o where o.projet_id = p.id and cockpit.ouverture_finie(o.id)), '[]'::jsonb);
    continue when jsonb_array_length(v_renf -> 'ouvrir') = 0 and jsonb_array_length(v_renf -> 'archiver') = 0
              and jsonb_array_length(v_fermer) = 0 and not v_ouvrir;
    r := r || jsonb_build_object('slug', p.slug, 'nom', p.nom, 'depot', p.depot, 'renforts', v_renf,
                                 'ouvrir_session', v_ouvrir, 'messages', v_msg, 'fermer', v_fermer);
  end loop;
  return r;
end $$;

-- Réveil immédiat (/fire) : une session neuve ne s'ouvre QUE s'il y a quelque chose à servir.
-- Un message ou une réponse déjà servi (rien sans réponse, rien sans suite) n'en ouvre pas.
create or replace function cockpit.rien_a_servir(p_projet_id uuid, p_raison text)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select p_raison in ('message', 'réponse')
     and not exists (select 1 from cockpit.messages_sans_reponse(p_projet_id))
     and not exists (select 1 from cockpit.reponses_sans_suite(p_projet_id));
$$;

create or replace function cockpit.reveiller_chef(p_projet_id uuid, p_chantier uuid default null, p_raison text default 'message')
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_slug text; v_cible uuid; r cockpit.reveils_immediats; v_jeton text; v_req bigint; v_cslug text;
begin
  select slug into v_slug from cockpit.projets where id = p_projet_id;
  if v_slug is null then return 'aucune_chef'; end if;
  -- Une session vivante tient le chantier : hooks/suivi.sh le lui remet (20 s), pas besoin de réveil.
  if p_chantier is not null and exists (
       select 1 from cockpit.chantiers c join cockpit.sessions s on s.projet_id = c.projet_id and s.branche = c.pris_par
        where c.id = p_chantier and c.pris_jusqu_a > now() and s.fin_at is null and s.vu_at > now() - interval '30 minutes') then
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
end $$;

revoke all on function cockpit.regler_fermeture(text, boolean, int), cockpit.etat_fermeture(text), cockpit.ouverture_finie(uuid),
  cockpit.ouverture_archive(uuid), cockpit.ouvertures_a_fermer(text), cockpit.rien_a_servir(uuid, text) from public, anon, authenticated;
grant execute on function cockpit.regler_fermeture(text, boolean, int), cockpit.etat_fermeture(text) to authenticated, service_role;
grant execute on function cockpit.ouverture_finie(uuid), cockpit.ouverture_archive(uuid), cockpit.ouvertures_a_fermer(text), cockpit.rien_a_servir(uuid, text) to service_role;
