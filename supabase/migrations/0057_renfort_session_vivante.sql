-- Renfort vivant déclaré muet à tort (chantier 2bf7d90c, 05/10/2026).
-- CAUSE PROUVÉE : renfort_vivant ne lisait que renforts.vu_at (posé seulement par
-- renfort.sh --suivant) et les chantiers réservés à sa branche. Un renfort dont la
-- SESSION travaillait (hooks Pre/PostToolUse → sessions.vu_at, ex. 16:16 pour une
-- session dont renforts.vu_at restait à 15:50) était donc « mort » après le délai
-- (3 min) et renforts_expirer le passait en « erreur » ; la chef disait « muet
-- depuis 3 h : archive_session… » (libellé de chef.sh, faux : le vrai seuil est
-- delai_signe). La session du renfort (id de hook, uuid) n'était liée à rien :
-- renforts.session_distante est l'id cloud « session_… », autre identifiant.
-- Correctif : renfort.sh --suivant lie sa session (CLAUDE_CODE_SESSION_ID = id des
-- hooks) ; UNE règle, renfort_vivant, regarde aussi cette session. Idempotente.
alter table cockpit.renforts add column if not exists session_hook text;

create or replace function cockpit.renfort_lier(p_renfort uuid, p_session text)
returns boolean language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts set session_hook = nullif(trim(p_session), '')
   where id = p_renfort and statut in ('demande', 'actif') and cockpit.est_service() returning true;
$$;
revoke execute on function cockpit.renfort_lier(uuid, text) from public;
grant execute on function cockpit.renfort_lier(uuid, text) to service_role;

create or replace function cockpit.renfort_vivant(r cockpit.renforts)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select (r.statut = 'demande' and cockpit.renfort_demande_depuis(r) > now() - interval '3 hours')
      or (r.statut = 'actif'
          and (exists (select 1 from cockpit.sessions s
                        where s.id = r.session_hook and s.fin_at is null
                          and s.vu_at > now() - cockpit.delai_signe(r.projet_id))
               or (coalesce(r.vu_at, r.created_at) > now() - interval '3 hours'
                   and (coalesce(r.vu_at, r.created_at) > now() - cockpit.delai_signe(r.projet_id)
                        or exists (select 1 from cockpit.chantiers c
                                    where c.projet_id = r.projet_id and c.pris_par like r.prefixe || '/%'
                                      and c.pris_jusqu_a > now() and c.archived_at is null
                                      and not cockpit.sans_signe_de_vie(c))))));
$$;
