-- 0068 — Passe du chef sans perte (6 oct. 2026, chantier d48bafe7).
-- Raphaël : « je n'ai pas besoin à chaque fois d'un chat ou d'une nouvelle session pour régler ce genre de
-- correctif ; l'application doit marcher au quotidien sans interruption ». Constaté : chef.sh RÉSERVE les
-- chantiers dès qu'il les affiche ; si la session qui l'appelle perd la consigne (sortie tronquée, arrêt),
-- ils restent « en cours » pour personne et le second appel répond RIEN.
--  (1) la consigne de chaque chantier réservé par la passe est GARDÉE (passe_consignes) et relisible ;
--  (2) un chantier réservé par la passe sans agent lancé au bout de projets.passe_lancement_min (5)
--      est rendu à la file, avec son état d'avant ;
--  (3) la passe dit combien elle a réservé / relu (chef.sh) ;
--  (4) un relais ne redemande pas l'ouverture déjà faite tant que rien de neuf n'est arrivé
--      (projets.relais_reouverture_h, 6 ; 0 = comme avant : au plus une par heure).
-- Une règle chacune : passe_lancee, passe_consigne_vivante, rendre_passes_non_lancees, relais_deja_ouvert.

alter table cockpit.projets add column if not exists passe_lancement_min integer not null default 5;
alter table cockpit.projets add column if not exists relais_reouverture_h integer not null default 6;
do $$ begin
  alter table cockpit.projets add constraint projets_passe_lancement_min_ck check (passe_lancement_min between 1 and 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cockpit.projets add constraint projets_relais_reouverture_h_ck check (relais_reouverture_h between 0 and 168);
exception when duplicate_object then null; end $$;

create table if not exists cockpit.passe_consignes (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references cockpit.projets(id) on delete cascade,
  chantier_id uuid not null references cockpit.chantiers(id) on delete cascade,
  branche     text not null,
  etat_avant  text,
  titre       text,
  consigne    text not null,
  created_at  timestamptz not null default now(),
  rendu_at    timestamptz,
  unique (chantier_id, branche)
);
create index if not exists passe_consignes_projet_idx on cockpit.passe_consignes (projet_id, created_at desc);
alter table cockpit.passe_consignes enable row level security;
alter table cockpit.passe_consignes replica identity full;
drop policy if exists admin_tout on cockpit.passe_consignes;
create policy admin_tout on cockpit.passe_consignes for all
  using (cockpit.est_admin()) with check (cockpit.est_admin());

-- Garde la consigne d'un chantier que la passe vient de réserver (sessions seulement).
create or replace function cockpit.noter_consigne_passe(p_projet text, p_chantier uuid, p_branche text,
                                                         p_etat_avant text, p_titre text, p_consigne text)
returns boolean language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_p uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_p from cockpit.projets where slug = p_projet;
  if v_p is null or p_chantier is null or coalesce(p_branche, '') = '' or coalesce(p_consigne, '') = '' then return false; end if;
  insert into cockpit.passe_consignes (projet_id, chantier_id, branche, etat_avant, titre, consigne)
  values (v_p, p_chantier, p_branche, nullif(p_etat_avant, ''), p_titre, p_consigne)
  on conflict (chantier_id, branche) do update
     set consigne = excluded.consigne, titre = excluded.titre,
         etat_avant = coalesce(excluded.etat_avant, cockpit.passe_consignes.etat_avant),
         created_at = now(), rendu_at = null;
  return true;
end $$;

-- UNE règle « un agent a démarré sur cette réservation » : une ligne d'activité, une tâche, ou une session
-- à la branche réservée, postérieures à la consigne.
create or replace function cockpit.passe_lancee(pc cockpit.passe_consignes)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (select 1 from cockpit.activite a where a.chantier_id = pc.chantier_id and a.updated_at >= pc.created_at)
      or exists (select 1 from cockpit.taches t where t.chantier_id = pc.chantier_id
                  and coalesce(t.demarre_at, t.vu_at) >= pc.created_at)
      or exists (select 1 from cockpit.sessions s where s.projet_id = pc.projet_id and s.branche = pc.branche
                  and s.vu_at >= pc.created_at);
$$;

-- UNE règle « la consigne attend encore son agent » : réservée à cette branche, valide, aucun agent démarré.
create or replace function cockpit.passe_consigne_vivante(pc cockpit.passe_consignes)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select pc.rendu_at is null
     and exists (select 1 from cockpit.chantiers c where c.id = pc.chantier_id and c.archived_at is null
                  and c.pris_par = pc.branche and c.pris_jusqu_a > now())
     and not cockpit.passe_lancee(pc);
$$;

-- Les consignes à redonner à la chef (réservées, agent pas encore lancé), de ce projet.
create or replace function cockpit.consignes_passe_a_relire(p_projet text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_p uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_p from cockpit.projets where slug = p_projet;
  if v_p is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('chantier', pc.chantier_id, 'branche', pc.branche, 'titre', pc.titre,
            'consigne', pc.consigne, 'minutes', floor(extract(epoch from (now() - pc.created_at)) / 60)::int) order by pc.created_at)
          from cockpit.passe_consignes pc
         where pc.projet_id = v_p and cockpit.passe_consigne_vivante(pc)), '[]'::jsonb);
end $$;

-- Rend à la file les chantiers que la passe a réservés sans qu'aucun agent démarre dans le délai du projet.
create or replace function cockpit.rendre_passes_non_lancees(p_projet uuid)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pc cockpit.passe_consignes; pr cockpit.projets; n integer := 0;
begin
  select * into pr from cockpit.projets where id = p_projet;
  if pr.id is null then return 0; end if;
  for pc in select * from cockpit.passe_consignes x
             where x.projet_id = pr.id and x.rendu_at is null
               and x.created_at < now() - make_interval(mins => pr.passe_lancement_min) loop
    if cockpit.passe_lancee(pc) then
      update cockpit.passe_consignes set rendu_at = now() where id = pc.id;  -- un agent a pris le relais : plus rien à rendre
      continue;
    end if;
    update cockpit.chantiers c
       set pris_par = null, pris_jusqu_a = null, libere_at = now(), libere_de = pc.branche,
           libere_apres_min = greatest(1, pr.passe_lancement_min),
           etat = case when c.etat = 'en_cours' and pc.etat_avant in ('libre', 'a_trier') then pc.etat_avant else c.etat end
     where c.id = pc.chantier_id and c.pris_par = pc.branche and c.archived_at is null and c.etat <> 'valide';
    if found then
      update cockpit.messages set recu_at = null where chantier_id = pc.chantier_id and recu_par = pc.branche and recu_at is not null;
      n := n + 1;
    end if;
    update cockpit.passe_consignes set rendu_at = now() where id = pc.id;
  end loop;
  return n;
end $$;

-- Le balayage unique (corps de 0050, le seul) : d'abord rendre les réservations de la passe sans agent,
-- puis libérer les silences ; une réservation de la passe encore dans son délai n'est pas « silencieuse ».
create or replace function cockpit.liberer_silencieux_coeur(p_projet text)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; c cockpit.chantiers; n integer := 0; v_min integer;
begin
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return 0; end if;
  n := cockpit.rendre_passes_non_lancees(pr.id);
  for c in select * from cockpit.chantiers x
            where x.projet_id = pr.id and x.archived_at is null and x.pris_par is not null and x.pris_jusqu_a > now()
              and x.etat <> 'valide' and cockpit.sans_signe_de_vie(x)
              and not exists (select 1 from cockpit.passe_consignes q
                               where q.chantier_id = x.id and q.branche = x.pris_par and cockpit.passe_consigne_vivante(q)
                                 and q.created_at > now() - make_interval(mins => pr.passe_lancement_min))
            for update skip locked loop
    v_min := greatest(1, floor(extract(epoch from (now() - c.updated_at)) / 60))::int;
    update cockpit.chantiers set pris_jusqu_a = now(), libere_at = now(), libere_de = c.pris_par, libere_apres_min = v_min where id = c.id;
    update cockpit.messages set recu_at = null
     where chantier_id = c.id and recu_par = c.pris_par and recu_at is not null;
    n := n + 1;
  end loop;
  update cockpit.chantiers set pris_par = null, pris_jusqu_a = null
   where projet_id = pr.id and archived_at is null and pris_par is not null
     and pris_jusqu_a < now() and etat <> 'en_cours';
  return n;
end $$;

-- (4) Une ouverture réussie est « déjà faite » tant que rien de neuf n'est arrivé depuis (message libre ou
-- vérification de Raphaël, renfort demandé) et que relais_reouverture_h n'est pas écoulé.
create or replace function cockpit.relais_deja_ouvert(p_projet uuid)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce((
    select o.created_at > now() - make_interval(hours => p.relais_reouverture_h)
       and not exists (select 1 from cockpit.messages m where m.projet_id = p.id and m.created_at > o.created_at
                        and m.auteur_type in ('proprietaire', 'utilisateur') and not m.via_session)
       and not exists (select 1 from cockpit.chantiers c where c.projet_id = p.id and c.verif_demandee_at > o.created_at)
       and not exists (select 1 from cockpit.renforts r where r.projet_id = p.id and r.created_at > o.created_at)
      from cockpit.projets p,
           lateral (select x.created_at from cockpit.ouvertures x where x.projet_id = p.id and x.erreur is null
                     order by x.created_at desc limit 1) o
     where p.id = p_projet and p.relais_reouverture_h > 0), false);
$$;

-- relais_a_servir : définition EN VIGUEUR (0046) + la règle ci-dessus sur l'ouverture de session (les renforts demandés
-- gardent leur règle : ils restent listés tant qu'ils ne sont pas ouverts, la pause 0044 freine les échecs).
create or replace function cockpit.relais_a_servir(p_chef_projet text, p_test text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_chef uuid; r jsonb := '[]'::jsonb; p record; v_renf jsonb; v_msg int; v_ouvrir boolean; v_fermer jsonb; v_verif int; v_deja boolean;
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
    v_deja := cockpit.relais_deja_ouvert(p.id);
    select count(*) into v_msg from cockpit.messages_sans_reponse(p.id);
    select count(*) into v_verif from cockpit.verifs_prenables(p.id, null);
    v_ouvrir := (v_verif > 0 or (v_msg > 0
      and not exists (select 1 from cockpit.sessions s where s.projet_id = p.id and s.fin_at is null and s.vu_at > now() - cockpit.delai_signe(p.id))))
      and not v_deja
      and not exists (select 1 from cockpit.ouvertures o where o.projet_id = p.id and o.created_at > now() - interval '1 hour');
    v_fermer := coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'session', o.session_distante) order by o.created_at)
                 from cockpit.ouvertures o where o.projet_id = p.id and cockpit.ouverture_finie(o.id)), '[]'::jsonb);
    continue when jsonb_array_length(v_renf -> 'ouvrir') = 0 and jsonb_array_length(v_renf -> 'archiver') = 0
              and jsonb_array_length(v_fermer) = 0 and not v_ouvrir;
    r := r || jsonb_build_object('slug', p.slug, 'nom', p.nom, 'depot', p.depot, 'renforts', v_renf,
                                 'ouvrir_session', v_ouvrir, 'messages', v_msg, 'verifs', v_verif, 'fermer', v_fermer);
  end loop;
  return r;
end $$;

-- Droits : sessions (service) seulement.
revoke all on function cockpit.noter_consigne_passe(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function cockpit.passe_lancee(cockpit.passe_consignes) from public, anon, authenticated;
revoke all on function cockpit.passe_consigne_vivante(cockpit.passe_consignes) from public, anon, authenticated;
revoke all on function cockpit.consignes_passe_a_relire(text) from public, anon, authenticated;
revoke all on function cockpit.rendre_passes_non_lancees(uuid) from public, anon, authenticated;
revoke all on function cockpit.relais_deja_ouvert(uuid) from public, anon, authenticated;
revoke all on function cockpit.relais_a_servir(text, text) from public, anon, authenticated;
revoke all on function cockpit.liberer_silencieux_coeur(text) from public, anon, authenticated;
grant execute on function cockpit.noter_consigne_passe(text, uuid, text, text, text, text) to service_role;
grant execute on function cockpit.passe_lancee(cockpit.passe_consignes) to service_role;
grant execute on function cockpit.passe_consigne_vivante(cockpit.passe_consignes) to service_role;
grant execute on function cockpit.consignes_passe_a_relire(text) to service_role;
grant execute on function cockpit.rendre_passes_non_lancees(uuid) to service_role;
grant execute on function cockpit.relais_deja_ouvert(uuid) to service_role;
grant execute on function cockpit.relais_a_servir(text, text) to service_role;
grant execute on function cockpit.liberer_silencieux_coeur(text) to service_role;
