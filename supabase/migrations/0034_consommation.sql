-- 0034 — Consommation : ne jamais atteindre la limite des modèles (chantier dee9931e).
--  1. « À toi » à revoir : un élément déjà confirmé (chantiers.a_toi_revu_at, messages.confirmee_at)
--     ne revient pas avant 24 h ; la revue n'est donc pas lancée s'il n'y a que des confirmés récents
--     (elle ne se lance que si la liste est non vide). Constaté : un agent chaque heure reconfirmait les mêmes.
--  2. Frein : 2 agents par défaut pour une nouvelle chef (les projets déjà réglés gardent leur valeur).
-- Idempotente.

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
           greatest(m.created_at, coalesce(m.confirmee_at, m.created_at)) as depuis, c.pris_par, c.pris_jusqu_a, m.confirmee_at as confirme_at
      from cockpit.messages m left join cockpit.chantiers c on c.id = m.chantier_id
     where m.projet_id = p_projet and m.kind in ('question', 'action') and m.answered_at is null
       and (m.chantier_id is null or c.archived_at is null or c.etat = 'valide')
    union all
    select c.etat, c.id, c.id, c.titre,
           case c.etat when 'bloque' then coalesce(b.corps, '') else left(coalesce(c.comment_verifier, c.demande, ''), 400) end,
           greatest(case c.etat when 'a_verifier' then coalesce(greatest(c.livre_at, c.verdict_at), c.updated_at)
                               when 'bloque' then coalesce(b.created_at, c.updated_at) else c.updated_at end,
                    coalesce(c.a_toi_revu_at, '-infinity')),
           c.pris_par, c.pris_jusqu_a, c.a_toi_revu_at as confirme_at
      from cockpit.chantiers c
      left join lateral (select corps, created_at from cockpit.messages where chantier_id = c.id and kind = 'blocage' order by created_at desc limit 1) b on true
     where c.projet_id = p_projet and c.archived_at is null and c.etat in ('a_verifier', 'a_cadrer', 'bloque')
       and not (c.etat = 'a_verifier' and c.verif_demandee_at is not null)
  ), juges as (
    select e.*, case when w.t > e.depuis + interval '2 minutes' then w.t end as avance_depuis
      from elements e left join travail w on w.chantier_id = e.chantier_id
     -- Un chantier qu'une session ou un agent tient encore : c'est à elle de tenir ses éléments à jour.
     where (e.pris_par is null or e.pris_jusqu_a is null or e.pris_jusqu_a < now())
       -- Confirmé « toujours utile » depuis moins de 24 h : ne revient pas (0034, consommation).
       and (e.confirme_at is null or e.confirme_at < now() - interval '24 hours')
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

alter table cockpit.chefs alter column max_agents set default 2;
