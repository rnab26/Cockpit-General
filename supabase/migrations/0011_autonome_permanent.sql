-- Mode autonome PERMANENT et plus large (29 sept. 2026, ~02 h 40).
--
-- Raphaël : « je veux le mode autonome tout le temps […] pas que quand je dors,
-- des fois la journée je suis occupé, je regarde pas ; je veux que ça
-- travaille, surtout tant qu'il y a des chantiers pas terminés, en cours, en
-- attente, ou abandonnés par une session. Ce qui est à cadrer avec moi, ça ne
-- travaille pas. »
--   - projets.autonome_toujours : allumé sans heure de fin ;
--   - donnés à une session : les chantiers LIBRES, ceux PAS ENCORE TRIÉS (la
--     session les trie elle-même : si une décision de Raphaël est nécessaire,
--     question + « à cadrer »), et ceux EN COURS ABANDONNÉS (réservation
--     expirée ou absente, aucun signe de vie depuis 30 min). Jamais « à
--     cadrer », « bloqué », « reporté », « à vérifier ».
--   - plafond par session relevé à 20 par défaut (il reste : une session qui
--     enchaîne sans fin gonfle son contexte ; la suivante prend le relais).

alter table cockpit.projets add column if not exists autonome_toujours boolean not null default false;
alter table cockpit.projets alter column autonome_max set default 20;

create or replace function cockpit.autonome_actif(pr cockpit.projets)
returns boolean language sql stable as $$
  select pr.autonome_toujours or (pr.autonome_jusqu_a is not null and pr.autonome_jusqu_a > now());
$$;

drop function if exists cockpit.regler_autonome(text, timestamptz, int);
create or replace function cockpit.regler_autonome(p_projet text, p_jusqu_a timestamptz, p_max int default null, p_toujours boolean default false)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux admins');
  if not p_toujours and p_jusqu_a is not null and p_jusqu_a <= now() then raise exception 'l''heure de fin doit être dans le futur'; end if;
  if not p_toujours and p_jusqu_a is not null and p_jusqu_a > now() + interval '24 hours' then raise exception 'pas plus de 24 h d''affilée (ou choisis « tout le temps »)'; end if;
  update cockpit.projets
     set autonome_toujours = coalesce(p_toujours, false),
         autonome_jusqu_a = case when p_toujours then null else p_jusqu_a end,
         autonome_max = coalesce(p_max, autonome_max)
   where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  if cockpit.autonome_actif(r) then update cockpit.sessions set relances = 0 where projet_id = r.id; end if;
  return jsonb_build_object('projet', r.slug, 'toujours', r.autonome_toujours, 'jusqu_a', r.autonome_jusqu_a, 'max', r.autonome_max);
end $$;

-- Le chantier qu'une session peut prendre maintenant, sans rien réserver :
-- sert à prochain_chantier_autonome ET au compteur « N chantiers prêts ».
create or replace function cockpit.chantiers_prenables(p_projet_id uuid, p_par text default null)
returns setof cockpit.chantiers language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.doublon_de is null
     and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par)
     and (c.etat in ('libre', 'a_trier')
          or (c.etat = 'en_cours'
              -- Rien n'a bougé sur la fiche depuis 1 h (une réservation, une note,
              -- un changement d'état rafraîchissent updated_at).
              and c.updated_at < now() - interval '60 minutes'
              and not exists (
                select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
                   and a.updated_at > now() - interval '30 minutes')
              and not exists (
                select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
                   and t.vu_at > now() - interval '30 minutes')
              -- Jamais un chantier qu'une session VIVANTE du projet a tenu ou fait
              -- avancer en dernier : elle y travaille peut-être sans le signaler.
              and not exists (
                select 1 from cockpit.sessions se
                 where se.projet_id = c.projet_id and se.fin_at is null and se.vu_at > now() - interval '30 minutes'
                   and se.branche is not null
                   and (se.branche = c.pris_par
                        or se.branche = (select a.session from cockpit.activite a where a.chantier_id = c.id
                                          order by a.updated_at desc limit 1)))))
   order by (c.priorite = 'haute') desc, case c.etat when 'en_cours' then 0 when 'libre' then 1 else 2 end, c.created_at;
$$;

create or replace function cockpit.prochain_chantier_autonome(p_projet text, p_session text, p_branche text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; s cockpit.sessions; c cockpit.chantiers; par text := coalesce(nullif(p_branche, ''), 'session-autonome');
  v_etat text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null or not cockpit.autonome_actif(pr) then return null; end if;
  select * into s from cockpit.sessions where id = p_session;
  if s.id is not null and s.relances >= pr.autonome_max then return null; end if;
  select * into c from cockpit.chantiers_prenables(pr.id, par) limit 1;
  if c.id is null then return null; end if;
  v_etat := c.etat;
  if not cockpit.reserver_chantier(c.id, par, 180) then return null; end if;
  if p_session is not null then update cockpit.sessions set relances = relances + 1 where id = p_session; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (pr.id, c.id, par, 'session', 'info',
          case v_etat when 'en_cours' then 'Repris en mode autonome : il était abandonné (plus aucun signe de vie).'
                      when 'a_trier' then 'Pris en mode autonome pour être trié puis traité.'
                      else 'Pris en mode autonome.' end);
  return jsonb_build_object('id', c.id, 'titre', c.titre, 'etat_avant', v_etat,
    'demande', left(coalesce(c.demande, ''), 1500),
    'jusqu_a', case when pr.autonome_toujours then 'tout le temps'
                    else to_char(pr.autonome_jusqu_a at time zone 'Asia/Jerusalem', 'HH24:MI') end,
    'reste', pr.autonome_max - coalesce(s.relances, 0) - 1);
end $$;

revoke execute on function cockpit.autonome_actif(cockpit.projets), cockpit.regler_autonome(text, timestamptz, int, boolean),
  cockpit.chantiers_prenables(uuid, text), cockpit.prochain_chantier_autonome(text, text, text) from public, anon, authenticated;
grant execute on function cockpit.autonome_actif(cockpit.projets), cockpit.regler_autonome(text, timestamptz, int, boolean),
  cockpit.chantiers_prenables(uuid, text), cockpit.prochain_chantier_autonome(text, text, text) to service_role;
-- L'app (admin) allume/éteint ; chantiers_prenables reste réservée aux sessions
-- (security definer : l'ouvrir à authenticated montrerait les chantiers de tous
-- les projets à un simple membre). L'écran compte les prenables lui-même.
grant execute on function cockpit.regler_autonome(text, timestamptz, int, boolean) to authenticated;
