-- Questions et assistants toujours à jour (29 sept. 2026)
--
-- Raphaël : « je ne sais pas si les questions sont à jour, toujours
-- d'actualité, sachant que ça a déjà avancé ; je vois des agents dans ma
-- session et rien dans le cockpit ; je ne veux pas répondre à des choses déjà
-- faites, déjà répondues ou en cours ».
--
--  - messages.confirmee_at : la session qui a posé la question la confirme
--    « toujours d'actualité » après avoir avancé (demander.sh --confirmer) ;
--    une question dépassée, elle la RETIRE (demander.sh --retirer), et elle
--    quitte « À toi ». L'app marque « Claude a avancé depuis » une question
--    que du travail a suivie sans confirmation.
--  - Un assistant (tâche en cours) vit tant que SA session donne signe de vie :
--    Claude Code ne donne la liste des tâches qu'à la fin d'un tour (Stop) ; entre
--    deux, un agent qui ne signale pas d'étape passait pour arrêté (FacePro,
--    29 sept. : 1 agent au travail depuis 53 min, « personne » dans le cockpit).
--    La fin d'un tour corrige toujours (ce qui n'est plus listé passe « terminé »).
alter table cockpit.messages add column if not exists confirmee_at timestamptz;

create or replace function cockpit.taches_vivent_avec_session()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if new.vu_at is distinct from old.vu_at and new.fin_at is null then
    update cockpit.taches set vu_at = new.vu_at
     where session_id = new.id and statut = 'en_cours' and vu_at < new.vu_at - interval '30 seconds';
  end if;
  return new;
end $$;
revoke all on function cockpit.taches_vivent_avec_session() from public, anon, authenticated;

drop trigger if exists taches_vivent_avec_session on cockpit.sessions;
create trigger taches_vivent_avec_session after update of vu_at on cockpit.sessions
  for each row execute function cockpit.taches_vivent_avec_session();
