-- 0071 — Réactivité : action, réaction, sans relancer à la main (chantier 30492b22).
-- Raphaël (6 oct.) : « les chantiers à lancer ne se lancent pas tout seuls ; la boucle de vérification n'est pas
-- assez fréquente ; on n'a plus l'effet instantané ». Causes prouvées : une session réveillée voyait une chef
-- « vivante » et ne servait que ce qui attend Raphaël (chef.sh, corrigé) ; le filet attendait 10 min.
-- 1. filet_delai_min : défaut 3 min (les projets restés à 10, valeur d'origine jamais choisie, passent à 3) ; réglable dans l'écran.
-- 2. etat_reaction(projet, jours) : UNE règle de mesure du délai entre un message de Raphaël et la première
--    réponse d'une session, lue par l'écran (aucun calcul côté app).
-- Idempotente. Ne touche que le schéma cockpit.

alter table cockpit.projets alter column filet_delai_min set default 3;
update cockpit.projets set filet_delai_min = 3 where filet_delai_min = 10;

create or replace function cockpit.etat_reaction(p_projet text, p_jours int default 7)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare v_pid uuid; v_j int := greatest(1, least(coalesce(p_jours, 7), 90)); v record;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select id into v_pid from cockpit.projets where slug = p_projet;
  if v_pid is null then return null; end if;
  with msgs as (
    select m.id, m.created_at,
           (select min(rp.created_at) from cockpit.messages rp
             where rp.projet_id = m.projet_id and rp.auteur_type = 'session' and rp.created_at > m.created_at
               and (rp.repond_a = m.id or (rp.repond_a is null and rp.chantier_id is not distinct from m.chantier_id))) as repondu_at
      from cockpit.messages m
     where m.projet_id = v_pid and m.created_at > now() - make_interval(days => v_j) and cockpit.est_message_libre(m)
  ), d as (select extract(epoch from (repondu_at - created_at))::numeric as s, created_at, repondu_at from msgs where repondu_at is not null)
  select (select count(*) from msgs) as n, (select count(*) from d) as repondus,
         (select count(*) from msgs where repondu_at is null and created_at < now() - interval '2 minutes') as sans_reponse,
         (select percentile_cont(0.5) within group (order by s) from d) as mediane,
         (select percentile_cont(0.9) within group (order by s) from d) as p90,
         (select max(s) from d) as pire,
         (select s from d order by created_at desc limit 1) as dernier,
         (select min(created_at) from msgs where repondu_at is null and created_at < now() - interval '2 minutes') as plus_ancien_sans_reponse
    into v;
  return jsonb_build_object('jours', v_j, 'messages', v.n, 'repondus', v.repondus, 'sans_reponse', v.sans_reponse,
    'mediane_s', round(v.mediane), 'p90_s', round(v.p90), 'pire_s', round(v.pire), 'dernier_s', round(v.dernier),
    'plus_ancien_sans_reponse', v.plus_ancien_sans_reponse);
end $$;
revoke all on function cockpit.etat_reaction(text, int) from public, anon, authenticated;
grant execute on function cockpit.etat_reaction(text, int) to authenticated, service_role;
