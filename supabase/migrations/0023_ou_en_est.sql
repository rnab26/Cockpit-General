-- « Où ça en est ? » : une demande qui se SUIT, jamais empilée (29 sept. 2026)
--
-- Raphaël : « en cliquant on ne voit pas vraiment de différence visuelle, à
-- part un petit message écrit en bas de la case […] fais en sorte que ça
-- reparte dans les trucs à traiter, que ça s'actualise (en cours, dans la file
-- d'attente, dans une autre session…), qu'on ne pollue pas les sessions en
-- cliquant 10 fois sur "où ça en est", et que ça ne reste pas statique. »
--
-- Avant : le bouton insérait un message « info » à chaque toucher (dix
-- touchers = dix messages remis à la session), et rien ne disait si quelqu'un
-- l'avait lu. Désormais :
--  - messages.ou_en_est : la demande est MARQUÉE (plus reconnue à son texte) ;
--    recu_at / recu_par : quand et par qui elle a été reçue (hook de suivi de
--    la session qui tient le chantier, ou assistant lancé par la chef).
--  - demander_ou_en_est(chantier, par) : l'app passe par là. Une demande déjà
--    EN ATTENTE (ni répondue ni périmée) est rendue telle quelle, rien n'est
--    écrit : un deuxième toucher, d'un autre appareil ou d'un double clic, ne
--    pollue personne. Verrou par chantier contre deux touchers simultanés.
--  - Répondue = une session a écrit sur le chantier après la demande (la
--    réponse de progression.sh --point, ou n'importe quel message). Périmée =
--    sans réponse après delai_ou_en_est() (2 h) : on peut redemander.
--    MÊME règle dans l'app : app/src/lib/ouEnEst.ts (DELAI_OU_EN_EST_MS),
--    verifier-base.mjs compare les deux.
--  - Personne ne tient le chantier → ou_en_est_sans_suite / prendre_ou_en_est :
--    la chef du projet (scripts/chef.sh) lance un assistant qui répond dans
--    le fil (progression.sh --point), comme pour reponses_sans_suite (0017).
-- Idempotente.

alter table cockpit.messages add column if not exists ou_en_est boolean not null default false;
alter table cockpit.messages add column if not exists recu_at timestamptz;
alter table cockpit.messages add column if not exists recu_par text;

-- Les demandes d'avant (reconnues à leur texte exact, celui de l'app jusqu'ici).
update cockpit.messages set ou_en_est = true
 where not ou_en_est and kind = 'info' and auteur_type <> 'session'
   and corps = 'Raphaël demande : où en est ce chantier ? Qu’est-ce qui est fait, qu’est-ce qui reste, qu’est-ce qui bloque ?';

create index if not exists messages_ou_en_est_idx on cockpit.messages (chantier_id, created_at desc) where ou_en_est;

-- Au-delà, une demande sans réponse est périmée : on peut redemander.
create or replace function cockpit.delai_ou_en_est()
returns interval language sql immutable as $$ select interval '2 hours' $$;

-- La demande EN ATTENTE d'un chantier (la dernière, ni répondue ni périmée), ou null.
create or replace function cockpit.ou_en_est_en_attente(p_chantier uuid)
returns uuid language sql stable security definer set search_path = cockpit, pg_temp as $$
  select m.id from cockpit.messages m
   where m.chantier_id = p_chantier and m.ou_en_est
     and m.created_at > now() - cockpit.delai_ou_en_est()
     and not exists (select 1 from cockpit.messages s where s.chantier_id = m.chantier_id
                        and s.auteur_type = 'session' and s.created_at > m.created_at)
   order by m.created_at desc limit 1;
$$;

create or replace function cockpit.demander_ou_en_est(p_chantier uuid, p_par text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; v_id uuid; v_par text;
begin
  perform cockpit.exiger(cockpit.peut_agir(p_chantier), 'tu n''as pas accès à ce chantier');
  select * into c from cockpit.chantiers where id = p_chantier;
  if c.id is null or c.archived_at is not null then raise exception 'chantier introuvable ou archivé'; end if;
  if c.etat = 'valide' then raise exception 'chantier déjà certifié : rien à demander'; end if;
  -- Deux touchers au même instant : le second attend le premier, puis le voit.
  perform pg_advisory_xact_lock(hashtext('ou_en_est:' || p_chantier::text));
  v_id := cockpit.ou_en_est_en_attente(p_chantier);
  if v_id is not null then return jsonb_build_object('id', v_id, 'deja', true); end if;
  v_par := coalesce(nullif(trim(coalesce(p_par, '')), ''), 'Raphaël');
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, ou_en_est)
  values (c.projet_id, c.id, v_par, case when cockpit.est_admin() or cockpit.est_service() then 'proprietaire' else 'utilisateur' end,
          'info', 'Raphaël demande : où en est ce chantier ? Qu’est-ce qui est fait, qu’est-ce qui reste, qu’est-ce qui bloque ?', true)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'deja', false);
end $$;

-- Reçue par la session qui tient le chantier (hooks/suivi.sh la lui a mise sous les yeux).
create or replace function cockpit.marquer_ou_en_est_recu(p_ids uuid[], p_par text)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare n int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  update cockpit.messages set recu_at = now(), recu_par = nullif(p_par, '')
   where id = any(p_ids) and ou_en_est and recu_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Les demandes en attente que PERSONNE ne recevra : ni session vivante sur la
-- branche qui tient le chantier, ni agent vivant dessus, ni étape signalée
-- depuis 30 min (ceux-là la reçoivent par le hook). Ni reçues, ni répondues.
create or replace function cockpit.ou_en_est_sans_suite(p_projet_id uuid default null)
returns table (message_id uuid, chantier_id uuid, projet_id uuid, created_at timestamptz)
language sql stable security definer set search_path = cockpit, pg_temp as $$
  select m.id, m.chantier_id, m.projet_id, m.created_at
    from cockpit.messages m
    join cockpit.chantiers c on c.id = m.chantier_id
    join cockpit.projets p on p.id = c.projet_id
   where m.ou_en_est and m.recu_at is null
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
$$;

-- La chef en prend UNE (la plus ancienne) : marquée reçue par la branche de
-- l'assistant (l'app affiche « Un assistant de Claude regarde »), et de quoi
-- écrire sa consigne. Le chantier n'est PAS réservé : répondre « où ça en
-- est » ne bloque le travail de personne.
create or replace function cockpit.prendre_ou_en_est(p_branche text, p_projet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r record; m cockpit.messages; c cockpit.chantiers; p cockpit.projets; a cockpit.activite;
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
    return jsonb_build_object('id', c.id, 'titre', c.titre, 'slug', p.slug, 'depot', p.depot, 'etat', c.etat,
      'pris_par', c.pris_par, 'demande', left(coalesce(c.demande, ''), 1500), 'demande_id', m.id,
      'demande_le', to_char(m.created_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'),
      'derniere_etape', case when a.id is null then null else a.etape || coalesce(' (' || a.pourcentage || ' %, ' || a.session || ', '
        || to_char(a.updated_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI') || ')', '') end);
  end loop;
  return null;
end $$;

-- La réponse d'une session (progression.sh --point) : un message du fil qui
-- répond à la demande en attente (repond_a), et la marque reçue si besoin.
create or replace function cockpit.repondre_ou_en_est(p_chantier uuid, p_auteur text, p_texte text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; v_dem uuid; v_id uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(coalesce(p_texte, '')), '') is null then raise exception 'la réponse est vide'; end if;
  select * into c from cockpit.chantiers where id = p_chantier;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  v_dem := cockpit.ou_en_est_en_attente(p_chantier);
  if v_dem is not null then
    update cockpit.messages set recu_at = coalesce(recu_at, now()), recu_par = coalesce(recu_par, nullif(p_auteur, '')) where id = v_dem;
  end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps, repond_a)
  values (c.projet_id, c.id, coalesce(nullif(p_auteur, ''), 'session'), 'session', 'info', trim(p_texte), v_dem)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'demande', v_dem);
end $$;

revoke all on function cockpit.delai_ou_en_est(), cockpit.ou_en_est_en_attente(uuid), cockpit.demander_ou_en_est(uuid, text),
  cockpit.marquer_ou_en_est_recu(uuid[], text), cockpit.ou_en_est_sans_suite(uuid), cockpit.prendre_ou_en_est(text, uuid),
  cockpit.repondre_ou_en_est(uuid, text, text) from public, anon, authenticated;
grant execute on function cockpit.demander_ou_en_est(uuid, text) to authenticated, service_role;
grant execute on function cockpit.delai_ou_en_est(), cockpit.ou_en_est_en_attente(uuid), cockpit.marquer_ou_en_est_recu(uuid[], text),
  cockpit.ou_en_est_sans_suite(uuid), cockpit.prendre_ou_en_est(text, uuid), cockpit.repondre_ou_en_est(uuid, text, text) to service_role;
