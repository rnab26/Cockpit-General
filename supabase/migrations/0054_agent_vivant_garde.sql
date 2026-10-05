-- 0054 (5 oct. 2026, chantier b95c96f9). Constaté le 30/09 : à chaque passage la
-- chef proposait de relancer « Écrans en attente » et « Vérifier un chantier »
-- alors que leurs agents travaillaient, et réattribuait le chantier sous un
-- nouveau nom de branche (agent/160812), écrasant la réservation de l'agent réel.
-- Cause : sans_signe_de_vie (0043/0046) jugeait « vivant » un agent seulement si
-- sa session avait battu ou sa ligne bougé depuis delai_signe (3 min). Or un agent
-- signale lui-même une étape toutes les ~10 min (progres_at) : entre deux signes
-- (et avec une session dont le hook de battement n'est pas encore propagé), son
-- chantier devenait « abandonné » -> chantiers_prenables / reserver_chantier le
-- donnaient à un autre, et le balayage de 3 min (0050) le libérait.
-- Correctif, UNE règle : un agent dont la ligne tâche est vivante (en cours, session
-- non finie, battement < delai_signe OU étape signalée < delai_signe_agent) tient
-- son chantier ; la fraîcheur de l'activité suit le même délai. Délai réglable par
-- projet (projets.delai_agent_signale_min, 20 par défaut). Et ouvrir_ou_reprendre
-- (chantier.sh --ouvrir) n'écrase plus pris_par d'un chantier tenu par un autre.
-- Idempotente ; ne touche que le schéma cockpit.

alter table cockpit.projets add column if not exists delai_agent_signale_min integer not null default 20;
do $$ begin
  alter table cockpit.projets add constraint projets_delai_agent_signale_chk check (delai_agent_signale_min between 3 and 240);
exception when duplicate_object then null; end $$;

create or replace function cockpit.delai_signe_agent(p_projet uuid)
returns interval language sql stable security definer set search_path = cockpit, pg_temp as $$
  select make_interval(mins => greatest(
    coalesce((select delai_agent_signale_min from cockpit.projets where id = p_projet), 20),
    coalesce((select delai_sans_signe_min from cockpit.projets where id = p_projet), 3)));
$$;

-- Un agent (ligne tâche liée au chantier) qui vit : en cours, session non finie, et
-- soit son battement soit sa dernière étape signalée est récent.
create or replace function cockpit.agent_tient_chantier(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select exists (
    select 1 from cockpit.taches t join cockpit.sessions se on se.id = t.session_id
     where t.chantier_id = c.id and t.statut = 'en_cours' and se.fin_at is null
       and (t.vu_at > now() - cockpit.delai_signe(c.projet_id)
            or coalesce(t.progres_at, t.demarre_at) > now() - cockpit.delai_signe_agent(c.projet_id)));
$$;

create or replace function cockpit.sans_signe_de_vie(c cockpit.chantiers)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  -- Le balayage touche lui-même la fiche (updated_at) en libérant : cette touche-là
  -- (à 1 s de libere_at) n'est pas un signe de vie, sinon un chantier « en cours »
  -- libéré resterait protégé le délai de plus.
  select (c.updated_at < now() - cockpit.delai_signe(c.projet_id)
          or (c.libere_at is not null and c.updated_at <= c.libere_at + interval '1 second'))
     and not exists (
       select 1 from cockpit.activite a where a.chantier_id = c.id and a.statut = 'en_cours'
          and a.updated_at > now() - cockpit.delai_signe_agent(c.projet_id))
     and not cockpit.agent_tient_chantier(c)
     and not exists (
       select 1 from cockpit.sessions se
        where se.projet_id = c.projet_id and se.fin_at is null and se.vu_at > now() - cockpit.delai_signe(c.projet_id)
          and se.branche is not null
          and (se.branche = c.pris_par
               or se.branche = (select a.session from cockpit.activite a where a.chantier_id = c.id
                                 order by a.updated_at desc limit 1)));
$$;

-- Même comportement qu'en 0033, sauf : un chantier TENU par un autre agent vivant
-- garde sa réservation (la demande est ajoutée, pris_par n'est pas écrasé).
create or replace function cockpit.ouvrir_ou_reprendre(
  p_projet text, p_titre text, p_demande text, p_session text,
  p_id uuid default null, p_nouveau boolean default false, p_section text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, extensions, pg_temp as $$
declare
  v_projet uuid; v_cible uuid; v_etat text; v_archive boolean; v_titre text;
  v_section uuid; v_action text; v_trouve jsonb;
  entete text := E'\n\n--- Nouvelle demande du ' || to_char(now() at time zone 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI') || ' (session ' || coalesce(p_session, '?') || E') ---\n';
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet inconnu : %', p_projet; end if;
  if nullif(trim(p_titre), '') is null then raise exception 'titre vide'; end if;
  perform set_config('cockpit.par', coalesce(p_session, 'session'), true);
  if p_section is not null then
    select id into v_section from cockpit.sections where projet_id = v_projet and cle = cockpit.cle_section(p_section);
  end if;

  if p_id is not null then
    v_cible := p_id;
  elsif not p_nouveau then
    v_trouve := cockpit.trouver_chantier(p_projet, p_titre, p_demande);
    if coalesce((v_trouve->>'ambigu')::boolean, false) then
      return jsonb_build_object('action', 'ambigu', 'candidats', v_trouve->'candidats');
    end if;
    v_cible := (v_trouve->>'id')::uuid;
  end if;

  if v_cible is null then
    insert into cockpit.chantiers (projet_id, section_id, titre, demande, etat, priorite, origine, pris_par, pris_jusqu_a)
    values (v_projet, v_section, trim(p_titre), p_demande, 'en_cours', 'normale', 'session', p_session, now() + interval '3 hours')
    returning id into v_cible;
    v_action := 'cree';
  else
    select etat, archived_at is not null, titre into v_etat, v_archive, v_titre from cockpit.chantiers where id = v_cible and projet_id = v_projet;
    if v_etat is null then raise exception 'chantier % introuvable dans le projet %', v_cible, p_projet; end if;
    v_action := case when v_archive or v_etat in ('valide', 'a_verifier') then 'rouvert' else 'repris' end;
    update cockpit.chantiers c
       set demande = coalesce(c.demande, '') || entete || coalesce(nullif(trim(p_demande), ''), trim(p_titre)),
           etat = 'en_cours', archived_at = null, valide_at = null, valide_par = null,
           jalons = '{}'::jsonb,
           pris_par = case when c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now()
                             or c.pris_par = p_session or cockpit.sans_signe_de_vie(c)
                           then p_session else c.pris_par end,
           pris_jusqu_a = case when c.pris_par is null or c.pris_jusqu_a is null or c.pris_jusqu_a < now()
                             or c.pris_par = p_session or cockpit.sans_signe_de_vie(c)
                           then now() + interval '3 hours' else c.pris_jusqu_a end,
           section_id = coalesce(c.section_id, v_section)
     where c.id = v_cible;
  end if;

  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, v_cible, coalesce(p_session, 'session'), 'session', 'info',
          case v_action when 'cree' then 'Chantier ouvert depuis une session : '
                        when 'rouvert' then 'Chantier ROUVERT (il était ' || case when v_archive then 'archivé' else v_etat end || ') pour une nouvelle demande : '
                        else 'Chantier repris pour une nouvelle demande : ' end
          || left(coalesce(nullif(trim(p_demande), ''), p_titre), 300));

  return jsonb_build_object('action', v_action, 'id', v_cible,
    'titre', (select titre from cockpit.chantiers where id = v_cible));
end $$;

revoke all on function cockpit.delai_signe_agent(uuid), cockpit.agent_tient_chantier(cockpit.chantiers), cockpit.sans_signe_de_vie(cockpit.chantiers) from public, anon, authenticated;
grant execute on function cockpit.delai_signe_agent(uuid), cockpit.agent_tient_chantier(cockpit.chantiers), cockpit.sans_signe_de_vie(cockpit.chantiers) to service_role;
