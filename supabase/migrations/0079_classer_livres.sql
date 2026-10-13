-- 0079 — « Classer sans test » : les chantiers livrés qu'on ne teste pas ne s'empilent plus (13 oct. 2026)
--
-- Raphaël : « des fois je ne traite pas sur le cockpit, donc ce n'est pas traité si je ne le fais pas à la main sur le
-- cockpit alors que j'ai avancé sur la session Claude. » Mesuré le 13 oct. : 56 chantiers livrés attendaient un test
-- (35 FacePro, 21 cockpit), certains depuis plus d'une semaine, et gonflaient « pour toi » à 69.
-- Un test que personne ne fait ne doit pas peser sur l'écran pour toujours, et Raphaël ne doit pas devoir les clore un par un.
--
-- Deux gestes, JAMAIS « certifié » (seul Raphaël pose « valide » : rien ici ne le fait) :
--  1. archiver_livres(ids, motif) : classer sans test les chantiers choisis (admin ou session). Le chantier garde son état
--     « à vérifier » et part aux archives (« Désarchiver » le rend, rien n'est supprimé) ; une ligne dans son fil dit
--     qui l'a classé, et pourquoi.
--  2. projets.livres_classes_apres_j (vide = jamais, c'est le défaut) : UNE règle, livre_sans_retour(c, jours), lue par
--     classer_livres_anciens() — job pg_cron horaire — qui classe seule ce qui est livré depuis plus de N jours sans un
--     mot de Raphaël ni d'un utilisateur, sans question ouverte, sans « vérifie pour moi » en cours.
-- Réglage : l'écran « À tester » de l'accueil, ou regler_classement_livres(projet, jours). Jamais sur un projet de test.
-- Idempotente.

alter table cockpit.projets add column if not exists livres_classes_apres_j int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projets_livres_classes_apres_j_check') then
    alter table cockpit.projets add constraint projets_livres_classes_apres_j_check
      check (livres_classes_apres_j is null or livres_classes_apres_j between 1 and 90);
  end if;
end $$;

-- La règle : livré (« à vérifier »), pas archivé, aucune vérification demandée à Claude, livré depuis au moins `p_jours`
-- jours, aucun mot de Raphaël ni d'un utilisateur dans le fil depuis la livraison, aucune question ou action ouverte.
create or replace function cockpit.livre_sans_retour(c cockpit.chantiers, p_jours int)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.etat = 'a_verifier' and c.archived_at is null and c.verif_demandee_at is null
     and coalesce(c.livre_at, c.updated_at) <= now() - make_interval(days => p_jours)
     and not exists (select 1 from cockpit.messages m
                      where m.chantier_id = c.id and m.auteur_type in ('proprietaire', 'utilisateur')
                        and m.kind not in ('constat') and m.created_at > coalesce(c.livre_at, c.updated_at))
     and not cockpit.attend_raphael(c);
$$;

-- Le geste manuel (« Classer sans test », bouton de l'écran) : admin du cockpit ou session.
create or replace function cockpit.archiver_livres(p_ids uuid[], p_motif text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; n int := 0; v_service boolean := cockpit.est_service();
begin
  perform cockpit.exiger(cockpit.est_admin() or v_service, 'réservé à l''admin du cockpit');
  for c in select * from cockpit.chantiers where id = any (coalesce(p_ids, '{}'::uuid[])) and etat = 'a_verifier' and archived_at is null for update loop
    update cockpit.chantiers set archived_at = now() where id = c.id;
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (c.projet_id, c.id, case when v_service then 'session' else 'Raphaël' end, case when v_service then 'session' else 'proprietaire' end, 'constat',
            left('Classé sans test' || coalesce(' : ' || nullif(trim(p_motif), ''), '') || '. « Désarchiver » le rouvre.', 500));
    n := n + 1;
  end loop;
  return jsonb_build_object('classes', n);
end $$;

-- Le geste automatique : pour chaque projet qui a un délai (livres_classes_apres_j), classe ce que livre_sans_retour désigne.
-- `p_projet` (un seul projet) et `p_test` (un projet de test) ne servent qu'aux bancs ; le job appelle sans argument.
drop function if exists cockpit.classer_livres_anciens();
create or replace function cockpit.classer_livres_anciens(p_projet text default null, p_test boolean default false)
returns int language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare p record; c cockpit.chantiers; n int := 0;
begin
  for p in select id, livres_classes_apres_j as j from cockpit.projets
            where livres_classes_apres_j is not null and (p_projet is null or slug = p_projet)
              and (coalesce(p_test, false) or not cockpit.projet_de_test(slug)) loop
    for c in select ch.* from cockpit.chantiers ch where ch.projet_id = p.id and cockpit.livre_sans_retour(ch, p.j) for update loop
      update cockpit.chantiers set archived_at = now() where id = c.id;
      insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
      values (c.projet_id, c.id, 'cockpit', 'session', 'constat',
              left('Classé automatiquement : livré depuis plus de ' || p.j || ' jour' || case when p.j > 1 then 's' else '' end
                   || ', sans un mot de ta part (réglage de l''écran « À tester »). « Désarchiver » le rouvre.', 500));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- Le réglage : un nombre de jours (1 à 90) ou vide (= jamais).
create or replace function cockpit.regler_classement_livres(p_projet text, p_jours int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_jours is not null and (p_jours < 1 or p_jours > 90) then raise exception 'de 1 à 90 jours, ou vide pour « jamais »'; end if;
  update cockpit.projets set livres_classes_apres_j = p_jours where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'livres_classes_apres_j', r.livres_classes_apres_j);
end $$;

-- Droits : la règle et le job ne sont pas des portes ouvertes ; les deux gestes sont réservés aux admins et aux sessions.
revoke all on function cockpit.livre_sans_retour(cockpit.chantiers, int), cockpit.classer_livres_anciens(text, boolean),
  cockpit.archiver_livres(uuid[], text), cockpit.regler_classement_livres(text, int) from public, anon;
grant execute on function cockpit.livre_sans_retour(cockpit.chantiers, int), cockpit.classer_livres_anciens(text, boolean) to service_role;
grant execute on function cockpit.archiver_livres(uuid[], text), cockpit.regler_classement_livres(text, int) to authenticated, service_role;

-- Le job : toutes les heures (à la 17e minute, pour ne pas tomber avec les autres), jamais plus.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron non installable ici (%) : le classement automatique ne tournera pas seul', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cockpit-livres-classes') then
      perform cron.unschedule('cockpit-livres-classes');
    end if;
    perform cron.schedule('cockpit-livres-classes', '17 * * * *', 'select cockpit.classer_livres_anciens()');
  end if;
end $$;
