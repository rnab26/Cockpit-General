-- « À toi de jouer » toujours à jour (29 sept. 2026)
--
-- Raphaël : « Dans tout ce qui est à toi de jouer il n'y a pas d'actualisation.
-- J'ai des requêtes d'il y a plus de 12 h qui ont déjà été répondues dans la
-- session par d'autres requêtes, donc ça se marche dessus ; je ne sais pas
-- quelles sont les plus récentes et les plus vieilles ; si entre-temps il y a
-- de nouvelles informations la requête n'est pas mise à jour, ou fusionnée si
-- nécessaire. »
--
-- 0015 ne tenait à jour que les QUESTIONS, et seulement par la session qui les
-- avait posées (souvent disparue). Ici :
--  1. chantiers.a_toi_revu_at : une session a revu cet élément de « À toi »
--     (à vérifier, à cadrer, bloqué) et l'a confirmé toujours utile
--     (demander.sh --confirmer <id du chantier>). L'app compte son âge de là.
--  2. Sans objet = retiré tout seul : un chantier certifié ou archivé ferme ses
--     questions ouvertes et les suggestions de fusion qui le citent (la
--     réponse dit pourquoi ; rien n'est supprimé).
--  3. a_toi_a_revoir(projet) : ce que la chef du projet fait revoir par un
--     agent (scripts/chef.sh) — tout élément de « À toi » qui attend depuis
--     plus de p_heures, ou que du travail a suivi sans reconfirmation (la
--     MÊME règle que l'app, lib/entonnoir.ts : aToi / avanceDepuis), avec le
--     chantier le plus proche de « À toi » pour repérer les doublons.
alter table cockpit.chantiers add column if not exists a_toi_revu_at timestamptz;

-- 2. Sans objet : retiré tout seul.
create or replace function cockpit.retirer_sans_objet()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_raison text;
begin
  if new.etat = 'valide' and old.etat is distinct from 'valide' then v_raison := 'chantier certifié';
  elsif new.archived_at is not null and old.archived_at is null then v_raison := 'chantier archivé';
  else return new; end if;
  update cockpit.messages
     set answered_at = now(), reponse = 'Retirée automatiquement : ' || v_raison || ', la question est sans objet.'
   where chantier_id = new.id and kind in ('question', 'action') and answered_at is null;
  update cockpit.messages
     set answered_at = now(), reponse = 'Sans objet : ' || v_raison || '.'
   where kind = 'fusion' and answered_at is null
     and (options->0->>'source' = new.id::text or options->0->>'cible' = new.id::text);
  return new;
end $$;
revoke all on function cockpit.retirer_sans_objet() from public, anon, authenticated;

drop trigger if exists retirer_sans_objet on cockpit.chantiers;
create trigger retirer_sans_objet after update of etat, archived_at on cockpit.chantiers
  for each row execute function cockpit.retirer_sans_objet();

-- 3. Ce qu'il faut revoir dans « À toi » d'un projet.
create or replace function cockpit.a_toi_a_revoir(p_projet uuid, p_heures int default 12)
returns jsonb language sql stable security definer set search_path = cockpit, extensions, pg_temp as $$
  with travail as (   -- le dernier travail d'une session sur chaque chantier (même règle que l'app)
    select chantier_id, max(t) as t from (
      select chantier_id, created_at as t from cockpit.messages
       where projet_id = p_projet and auteur_type = 'session' and kind not in ('question', 'action', 'fusion') and chantier_id is not null
      union all select chantier_id, updated_at from cockpit.activite where projet_id = p_projet and chantier_id is not null
      union all select chantier_id, progres_at from cockpit.taches where projet_id = p_projet and chantier_id is not null and progres_at is not null
    ) x group by chantier_id
  ), elements as (
    select 'question' as type, m.id, m.chantier_id, coalesce(c.titre, 'Question sur le projet') as titre, m.corps as texte,
           greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) as depuis, c.pris_par, c.pris_jusqu_a
      from cockpit.messages m left join cockpit.chantiers c on c.id = m.chantier_id
     where m.projet_id = p_projet and m.kind in ('question', 'action') and m.answered_at is null
       and (m.chantier_id is null or c.archived_at is null)
    union all
    select c.etat, c.id, c.id, c.titre,
           case c.etat when 'bloque' then coalesce(b.corps, '') else left(coalesce(c.comment_verifier, c.demande, ''), 400) end,
           greatest(case c.etat when 'a_verifier' then coalesce(greatest(c.livre_at, c.verdict_at), c.updated_at)
                               when 'bloque' then coalesce(b.created_at, c.updated_at) else c.updated_at end,
                    coalesce(c.a_toi_revu_at, '-infinity')),
           c.pris_par, c.pris_jusqu_a
      from cockpit.chantiers c
      left join lateral (select corps, created_at from cockpit.messages where chantier_id = c.id and kind = 'blocage' order by created_at desc limit 1) b on true
     where c.projet_id = p_projet and c.archived_at is null and c.etat in ('a_verifier', 'a_cadrer', 'bloque')
       and not (c.etat = 'a_verifier' and c.verif_demandee_at is not null)
  ), juges as (
    select e.*, case when w.t > e.depuis + interval '2 minutes' then w.t end as avance_depuis
      from elements e left join travail w on w.chantier_id = e.chantier_id
     -- Un chantier qu'une session ou un agent tient encore : c'est à elle de tenir ses éléments à jour.
     where e.pris_par is null or e.pris_jusqu_a is null or e.pris_jusqu_a < now()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', j.type, 'id', j.id, 'chantier_id', j.chantier_id, 'titre', j.titre, 'texte', left(j.texte, 400),
           'depuis', j.depuis, 'heures', round(extract(epoch from now() - j.depuis) / 3600), 'avance_depuis', j.avance_depuis,
           'proche', (select jsonb_build_object('id', o.id, 'titre', o.titre, 'score', round(o.s::numeric, 2)) from (
                        select c2.id, c2.titre, greatest(similarity(cockpit.sujet(c2.titre), cockpit.sujet(j.titre)),
                                                        similarity(cockpit.normaliser(c2.titre), cockpit.normaliser(j.titre)) - 0.15) as s
                          from cockpit.chantiers c2
                         where c2.projet_id = p_projet and c2.archived_at is null and c2.doublon_de is null
                           and c2.id is distinct from j.chantier_id and c2.etat in ('a_verifier', 'a_cadrer', 'bloque', 'en_cours', 'libre')
                         order by 3 desc limit 1) o where o.s >= 0.2))
         order by j.depuis), '[]'::jsonb)
    from juges j
   where j.depuis < now() - make_interval(hours => greatest(p_heures, 1)) or j.avance_depuis is not null;
$$;
revoke all on function cockpit.a_toi_a_revoir(uuid, int) from public, anon, authenticated;
grant execute on function cockpit.a_toi_a_revoir(uuid, int) to service_role;

-- Une revue de « À toi » au plus par heure et par projet (scripts/revue-a-toi.sh),
-- qu'elle vienne de la chef (chef.sh) ou d'une session autonome (passe.sh).
alter table cockpit.projets add column if not exists revue_a_toi_at timestamptz;
