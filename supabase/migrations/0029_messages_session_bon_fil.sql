-- Ce que Raphaël écrit dans une session va dans le fil du BON chantier, seulement (30 sept. 2026)
--
-- Constaté sur FacePro (chantiers 2190e53b et 064a8bfa) : ses questions sur
-- RunPod et sur un fournisseur GPU apparaissaient dans « Mise à jour des
-- chantiers » et « Prix Tête entière », sans rapport, et un rapport interne
-- d'agent (« <agent-message … ») y figurait signé « Raphaël (session
-- Claude) ». Causes (0027) :
--  1. consigner_message_session déposait le message dans CHAQUE chantier que
--     la session tenait (pris_par = sa branche) -- une session en tient souvent
--     plusieurs, dont ceux que le mode autonome lui a donnés ;
--  2. le trigger chantiers_messages_session rattachait les 15 dernières
--     minutes de messages à TOUT chantier pris ensuite par la branche -- y
--     compris par le mode autonome, à l'arrêt, sans aucun rapport ;
--  3. le filtre du hook ne connaissait pas « <agent-message » (corrigé dans
--     hooks/suivi.sh et hooks/prompt-rappel.sh).
--
-- Règle désormais : le message attend (messages_session_attente, inchangé) et
-- ne rejoint QUE les fils que la session rattache à CE message :
-- chantier.sh --ouvrir et progression.sh --point, pendant le tour ouvert par ce
-- message (hook prompt-rappel), appellent rattacher_messages_session avec le
-- début du tour. Un sujet = un fil (0028) : deux sujets dans un message -> il
-- rejoint les deux fils ; un chantier tenu mais pas concerné -> rien.
-- Idempotente.

-- 1. Plus de dépôt immédiat : on garde le message en attente, c'est tout.
create or replace function cockpit.consigner_message_session(p_projet text, p_session text, p_branche text, p_texte text)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_pid uuid; v_texte text;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  v_texte := left(btrim(cockpit.masquer_secrets(p_texte)), 4000);
  if v_texte = '' or nullif(btrim(coalesce(p_branche, '')), '') is null or nullif(btrim(coalesce(p_session, '')), '') is null then return 0; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return 0; end if;
  -- Ménage : on garde un jour, pour relire au besoin.
  delete from cockpit.messages_session_attente where created_at < now() - interval '1 day';
  insert into cockpit.messages_session_attente (projet_id, session_id, branche, texte)
  values (v_pid, p_session, p_branche, v_texte);
  return 1;
end $$;

-- 2. Plus de rattachement « au hasard » quand une branche prend un chantier.
drop trigger if exists chantiers_messages_session on cockpit.chantiers;
drop function if exists cockpit.chantiers_messages_session();

-- 3. Rattachement explicite : les messages de CETTE session écrits depuis le
--    début du tour (p_depuis), dans le fil de CE chantier (une fois chacun).
--    Sans p_depuis : son dernier message des 15 dernières minutes seulement.
create or replace function cockpit.rattacher_messages_session(p_projet text, p_session text, p_chantier uuid, p_depuis timestamptz default null)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_pid uuid; a cockpit.messages_session_attente; n int := 0;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(btrim(coalesce(p_session, '')), '') is null or p_chantier is null then return 0; end if;
  select id into v_pid from cockpit.projets where slug = p_projet and actif;
  if v_pid is null then return 0; end if;
  if not exists (select 1 from cockpit.chantiers where id = p_chantier and projet_id = v_pid) then return 0; end if;
  for a in select * from cockpit.messages_session_attente
            where projet_id = v_pid and session_id = p_session
              and not (p_chantier = any(chantiers))
              and (case when p_depuis is null then created_at > now() - interval '15 minutes'
                        else created_at >= p_depuis end)
            order by created_at desc
            limit (case when p_depuis is null then 1 else 50 end) loop
    perform cockpit.deposer_message_session(a, p_chantier);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function cockpit.rattacher_messages_session(text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function cockpit.rattacher_messages_session(text, text, uuid, timestamptz) to service_role;
