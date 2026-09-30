-- 0043 (30 sept. 2026, chantier fb19d6a8). Raphaël : « JE NE VEUX PAS QUE LES
-- CHANTIERS SOIENT TENUS, JE VEUX QU'ILS SOIENT TRAITÉS QUAND ILS PEUVENT
-- L'ÊTRE ET N'ATTENDENT RIEN DE MA PART. »
-- Mesuré le 30/09 sur la base : 0036 ne libérait que les chantiers « en_cours ».
-- Restaient tenus sans que rien ne travaille :
--   1. un chantier libre/à vérifier réservé 60 min par un agent « Répondre » ou
--      « Point » mort (les réponses de Raphaël et ses messages, qui exigent une
--      réservation expirée, attendaient jusqu'à 60 min) ;
--   2. la section d'un renfort « vivant » 3 h après son dernier signe, même quand
--      tous ses chantiers étaient abandonnés (FacePro : 2 renforts muets depuis
--      95 et 108 min gardaient leur section) ;
--   3. un message pris par un agent mort, gardé 2 h.
-- UNE règle : « sans signe de vie » (aucune fiche modifiée, activité, agent ni
-- session vivante depuis 30 min). Elle est lue par chantier_abandonne (0036),
-- renfort_vivant et liberer_silencieux (le balayage). Idempotente.

alter table cockpit.chantiers add column if not exists libere_at timestamptz;
alter table cockpit.chantiers add column if not exists libere_de text;
alter table cockpit.chantiers add column if not exists libere_apres_min integer;

create or replace function cockpit.sans_signe_de_vie(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  -- Le balayage touche lui-même la fiche (updated_at) en libérant : cette touche-là
  -- (à 1 s de libere_at) n'est pas un signe de vie, sinon un chantier « en cours »
  -- libéré resterait protégé 30 min de plus.
  select (c.updated_at < now() - interval '30 minutes'
          or (c.libere_at is not null and c.updated_at <= c.libere_at + interval '1 second'))
     and not exists (
       select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
          and a.updated_at > now() - interval '30 minutes')
     and not exists (
       select 1 from cockpit.taches t where t.chantier_id = c.id and t.statut = 'en_cours'
          and t.vu_at > now() - interval '30 minutes')
     and not exists (
       select 1 from cockpit.sessions se
        where se.projet_id = c.projet_id and se.fin_at is null and se.vu_at > now() - interval '30 minutes'
          and se.branche is not null
          and (se.branche = c.pris_par
               or se.branche = (select a.session from cockpit.activite a where a.chantier_id = c.id
                                 order by a.updated_at desc limit 1)));
$$;

-- Même définition qu'en 0036, mais la règle vit dans sans_signe_de_vie.
create or replace function cockpit.chantier_abandonne(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.etat = 'en_cours' and cockpit.sans_signe_de_vie(c);
$$;

-- Un renfort tient sa section tant qu'il travaille : demandé depuis moins de
-- 3 h, ou actif avec un signe de vie de moins de 30 min, ou dont un chantier
-- réservé à sa branche a un signe de vie (un renfort qui code longtemps).
create or replace function cockpit.renfort_vivant(r cockpit.renforts)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select (r.statut = 'demande' and r.created_at > now() - interval '3 hours')
      or (r.statut = 'actif' and coalesce(r.vu_at, r.created_at) > now() - interval '3 hours'
          and (coalesce(r.vu_at, r.created_at) > now() - interval '30 minutes'
               or exists (select 1 from cockpit.chantiers c
                           where c.projet_id = r.projet_id and c.pris_par like r.prefixe || '/%'
                             and c.pris_jusqu_a > now() and c.archived_at is null
                             and not cockpit.sans_signe_de_vie(c))));
$$;

-- Le balayage : une réservation valide sur un chantier sans signe de vie est
-- libérée (fin = maintenant : toutes les règles « réservation expirée » la
-- voient libre), le message qu'un agent mort avait pris redevient à servir, et
-- la fiche le dit (libere_at / libere_de / libere_apres_min, lus par l'écran). Une fois par réservation (la fin passée ne se rebalaie pas).
create or replace function cockpit.liberer_silencieux(p_projet text)
returns integer language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; c cockpit.chantiers; n integer := 0; v_min integer;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return 0; end if;
  for c in select * from cockpit.chantiers x
            where x.projet_id = pr.id and x.archived_at is null and x.pris_par is not null and x.pris_jusqu_a > now()
              and x.etat <> 'valide' and cockpit.sans_signe_de_vie(x)
            for update skip locked loop
    v_min := greatest(1, floor(extract(epoch from (now() - c.updated_at)) / 60))::int;
    -- La trace va sur la fiche, PAS dans le fil : un message de session dans le fil
    -- compterait comme une réponse à Raphaël (messages_sans_reponse, reponses_sans_suite).
    update cockpit.chantiers set pris_jusqu_a = now(), libere_at = now(), libere_de = c.pris_par, libere_apres_min = v_min where id = c.id;
    update cockpit.messages set recu_at = null
     where chantier_id = c.id and recu_par = c.pris_par and recu_at is not null;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function cockpit.sans_signe_de_vie(cockpit.chantiers), cockpit.liberer_silencieux(text) from public, anon, authenticated;
grant execute on function cockpit.sans_signe_de_vie(cockpit.chantiers), cockpit.liberer_silencieux(text) to service_role;
