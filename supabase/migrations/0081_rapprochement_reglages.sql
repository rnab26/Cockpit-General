-- 0081 — Rapprochement GitHub : réglages par projet et interrupteur général (13 oct. 2026, suite de 0080, chantier 6f112d51).
--
-- Raphaël (13 oct.) : « ces correctifs doivent être généraux, pas liés à un seul projet : sur tous les projets actifs et futurs ».
-- Une règle qui écrit toute seule dans TOUS les projets doit (1) se régler projet par projet, sans aucune valeur arbitraire codée en dur,
-- (2) se couper d'un coup pour tous (comme la libération automatique, 0050), (3) garder ses seuils en constantes NOMMÉES et documentées.
--   - `projets.rapprochement_trace_h`     : rappeler une session qui tient un chantier sans trace depuis N heures (4 par défaut) ;
--   - `projets.rapprochement_passage_min` : chercher dans GitHub au plus toutes les N minutes (20 par défaut ; lu par le collecteur) ;
--   - `filet_reglage.rapprochement_actif` : l'interrupteur GÉNÉRAL (`regler_rapprochement(null, faux)`), comme `liberation_actif`.
-- Idempotente.

alter table cockpit.projets add column if not exists rapprochement_trace_h int not null default 4;
alter table cockpit.projets add column if not exists rapprochement_passage_min int not null default 20;
alter table cockpit.projets drop constraint if exists projets_rapprochement_trace_h_check;
alter table cockpit.projets add constraint projets_rapprochement_trace_h_check check (rapprochement_trace_h between 1 and 72);
alter table cockpit.projets drop constraint if exists projets_rapprochement_passage_min_check;
alter table cockpit.projets add constraint projets_rapprochement_passage_min_check check (rapprochement_passage_min between 5 and 1440);
alter table cockpit.filet_reglage add column if not exists rapprochement_actif boolean not null default true;

-- Un projet (`p_projet`) ou TOUS (`p_projet` nul) : allumé ou éteint. Éteint, les hooks ne passent plus ; un passage demandé à la main écrit toujours.
create or replace function cockpit.regler_rapprochement(p_projet text, p_auto boolean)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_projet is null then
    update cockpit.filet_reglage set rapprochement_actif = coalesce(p_auto, true), updated_at = now() where id = 1;
    return jsonb_build_object('global', coalesce(p_auto, true));
  end if;
  update cockpit.projets set rapprochement_auto = coalesce(p_auto, true) where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'auto', r.rapprochement_auto);
end $$;

-- Les deux délais d'un projet. Un paramètre nul = inchangé.
create or replace function cockpit.regler_rapprochement_delais(p_projet text, p_trace_h int, p_passage_min int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_trace_h is not null and p_trace_h not between 1 and 72 then raise exception 'sans trace depuis : entre 1 et 72 heures'; end if;
  if p_passage_min is not null and p_passage_min not between 5 and 1440 then raise exception 'passage au plus toutes les : entre 5 minutes et 24 heures'; end if;
  update cockpit.projets
     set rapprochement_trace_h = coalesce(p_trace_h, rapprochement_trace_h), rapprochement_passage_min = coalesce(p_passage_min, rapprochement_passage_min)
   where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'trace_h', r.rapprochement_trace_h, 'passage_min', r.rapprochement_passage_min);
end $$;

-- L'état pour l'écran : dernier passage, échec, ce qui a été fait tout seul, les deux délais et l'interrupteur général.
create or replace function cockpit.etat_rapprochement(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare p cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into p from cockpit.projets where slug = p_projet;
  if p.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('rapproche_at', p.rapproche_at, 'auto', p.rapprochement_auto, 'erreur', p.rapproche_erreur, 'erreur_at', p.rapproche_erreur_at,
    'trace_h', p.rapprochement_trace_h, 'passage_min', p.rapprochement_passage_min,
    'global', coalesce((select f.rapprochement_actif from cockpit.filet_reglage f where f.id = 1), true),
    'livres_24h', (select count(*) from cockpit.rapprochements r where r.projet_id = p.id and r.annule_at is null and r.at > now() - interval '24 hours'),
    'livres_total', (select count(*) from cockpit.rapprochements r where r.projet_id = p.id and r.annule_at is null));
end $$;

-- Le rappel précis : sans `p_heures`, le délai du PROJET (4 h par défaut). Un appel qui le donne (hooks d'avant 0081 : 4) l'emporte.
create or replace function cockpit.chantiers_tenus_sans_trace(p_projet text, p_branche text, p_heures numeric default null)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare v_h numeric;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions et aux scripts du cockpit');
  v_h := coalesce(p_heures, (select rapprochement_trace_h from cockpit.projets where slug = p_projet), 4);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ch.id, 'titre', ch.titre, 'etat', ch.etat,
             'heures', round((extract(epoch from now() - cockpit.derniere_trace(ch)) / 3600)::numeric, 1)) order by cockpit.derniere_trace(ch))
      from cockpit.chantiers ch join cockpit.projets p on p.id = ch.projet_id
     where p.slug = p_projet and ch.archived_at is null and ch.etat in ('en_cours', 'libre', 'a_trier', 'bloque')
       and nullif(p_branche, '') is not null and ch.pris_par = p_branche
       and cockpit.derniere_trace(ch) < now() - make_interval(secs => (greatest(v_h, 0.1) * 3600)::int)
       and not cockpit.attend_raphael(ch)), '[]'::jsonb);
end $$;

-- LA règle (inchangée au fond : 0080), ses seuils en constantes NOMMÉES. Mesurés sur FacePro le 13 oct. 2026 ; ne les changer qu'avec un cas de banc.
create or replace function cockpit.rapprocher_depot(p_projet text, p_faits jsonb, p_appliquer boolean default true)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare p cockpit.projets; r record; v_actions jsonb := '[]'::jsonb; v_res jsonb; v_exam int; v_tenus int; v_ok int := 0;
        v_depot text := coalesce(p_faits->>'depot', '');
        -- Tolérances (horloges de session et de GitHub qui ne tombent jamais pile) :
        c_apres_parole   constant interval := interval '30 minutes';  -- le dernier MOT du fil ne dépasse la date de fusion que de ça au plus (sinon on en a parlé APRÈS la livraison)
        c_apres_envoi    constant interval := interval '30 minutes';  -- du travail signalé plus de ça APRÈS le dernier envoi : le jalon n'était qu'une étape
        c_avant_trace    constant interval := interval '10 minutes';  -- une PR fusionnée peut précéder d'au plus ça la dernière trace de la session
        -- La règle « titre » (la plus faible, donc la plus stricte) :
        c_seuil_titre    constant real := 0.6;                        -- le titre de la PR ressemble à CE chantier au moins autant…
        c_seuil_autre    constant real := 0.5;                        -- …et à AUCUN autre chantier ouvert à ce niveau (sinon c'est ambigu : personne n'est livré)
        c_fenetre_titre  constant interval := interval '21 days';     -- fusionnée dans les 21 jours qui suivent la création du chantier
        c_avant_trace_j  constant interval := interval '1 day';       -- et pas plus d'un jour avant sa dernière trace
        c_fuseau         constant text := 'Asia/Jerusalem';           -- l'heure que Raphaël lit (celle de l'écran)
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions et aux scripts du cockpit');
  select * into p from cockpit.projets where slug = p_projet;
  if p.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  select count(*) filter (where cockpit.sans_signe_de_vie(ch) and not cockpit.attend_raphael(ch)),
         count(*) filter (where not cockpit.sans_signe_de_vie(ch))
    into v_exam, v_tenus
    from cockpit.chantiers ch
   where ch.projet_id = p.id and ch.archived_at is null and ch.etat in ('en_cours', 'libre', 'a_trier', 'bloque');
  for r in
    with c as (
      select ch.id, ch.titre, ch.etat, ch.pris_par, ch.created_at, cockpit.derniere_trace(ch) trace,
             (ch.jalons->'pousse'->>'at')::timestamptz as pousse_at, cockpit.derniere_parole(ch) as parole
        from cockpit.chantiers ch
       where ch.projet_id = p.id and ch.archived_at is null and ch.etat in ('en_cours', 'libre', 'a_trier', 'bloque')
         and cockpit.sans_signe_de_vie(ch) and not cockpit.attend_raphael(ch)
    ), f as (
      select * from jsonb_to_recordset(coalesce(p_faits->'fusions', '[]'::jsonb))
        as x(sha text, date timestamptz, sujet text, corps text, titre text, numero int, branche text, url text)
    ), pc as (
      select e.key::uuid as id, e.value->>'regle' as regle, (e.value->>'date')::timestamptz as date, e.value->>'url' as url,
             coalesce((e.value->>'n')::int, 0) as n, e.value->>'sujet' as sujet, e.value->>'sha' as sha
        from jsonb_each(coalesce(p_faits->'par_chantier', '{}'::jsonb)) e
       where e.value->>'regle' in ('jalon', 'branche')
    ), cand as (
      -- 0. le commit que la session avait elle-même signalé « envoyé » est dans main
      select c.id, 0 as prio, 'jalon'::text as regle, pc.date as quand, pc.url as url,
             format('le commit %s, que la session avait signalé comme envoyé, est dans main depuis le %s', left(pc.sha, 7),
                    to_char(pc.date at time zone c_fuseau, 'DD/MM "à" HH24:MI')) as preuve
        from c join pc on pc.id = c.id and pc.regle = 'jalon'
       where c.etat in ('en_cours', 'bloque')                                     -- un chantier « libre » a été rendu par le balayage : son jalon n'est qu'une étape
         and (c.pousse_at is null or c.trace <= c.pousse_at + c_apres_envoi)      -- aucun travail signalé APRÈS ce dernier envoi
         and pc.date >= c.parole - c_apres_parole                                 -- et personne n'a parlé du chantier après la livraison
      union all
      -- 1. le travail de code fait sur sa branche depuis la création du chantier est dans main, et aucun autre chantier ne tient cette branche
      select c.id, 1, 'branche', pc.date, pc.url,
             format('son travail (%s commit%s de code de la branche « %s ») est dans main depuis le %s', pc.n, case when pc.n > 1 then 's' else '' end,
                    c.pris_par, to_char(pc.date at time zone c_fuseau, 'DD/MM "à" HH24:MI'))
        from c join pc on pc.id = c.id and pc.regle = 'branche'
       where c.etat in ('en_cours', 'bloque') and pc.date >= c.parole - c_apres_parole
         and not exists (select 1 from cockpit.chantiers o where o.projet_id = p.id and o.id <> c.id and o.pris_par is not distinct from c.pris_par
                           and c.pris_par is not null and o.archived_at is null and o.etat in ('en_cours', 'libre', 'a_trier', 'bloque'))
      union all
      -- 1b. une PR venue de sa branche est fusionnée après sa dernière trace
      select c.id, 1, 'branche', f.date, f.url,
             format('la PR n° %s « %s » (sa branche « %s ») est fusionnée dans main le %s', f.numero, left(coalesce(f.titre, f.sujet), 90), c.pris_par,
                    to_char(f.date at time zone c_fuseau, 'DD/MM "à" HH24:MI'))
        from c join f on f.numero is not null and f.branche is not null and f.branche = c.pris_par and f.date >= c.created_at
         and f.date >= c.trace - c_avant_trace and f.date >= c.parole - c_apres_parole
      union all
      -- 2. le titre ou le message d'une PR fusionnée cite son identifiant (une simple mention dans un commit ne suffit jamais)
      select c.id, 2, 'identifiant', f.date, f.url,
             format('la PR n° %s « %s » cite ce chantier et est fusionnée dans main le %s', f.numero, left(coalesce(f.titre, f.sujet), 90),
                    to_char(f.date at time zone c_fuseau, 'DD/MM "à" HH24:MI'))
        from c join f on f.numero is not null and f.date >= c.created_at and f.date >= c.parole - c_apres_parole
         and (coalesce(f.sujet, '') || ' ' || coalesce(f.titre, '') || ' ' || coalesce(f.corps, '')) ~* ('(^|[^0-9a-f])' || left(c.id::text, 8) || '([^0-9a-f]|$)')
      union all
      -- 3. le titre d'une PR fusionnée lui ressemble presque mot pour mot, et aucun autre chantier ouvert ne lui ressemble
      select c.id, 3, 'titre', f.date, f.url,
             format('la PR n° %s « %s » ressemble à ce chantier et est fusionnée dans main le %s', f.numero, left(coalesce(f.titre, f.sujet), 90),
                    to_char(f.date at time zone c_fuseau, 'DD/MM "à" HH24:MI'))
        from c join f on f.numero is not null and f.date >= c.created_at and f.date <= c.created_at + c_fenetre_titre
         and f.date >= c.trace - c_avant_trace_j and f.date >= c.parole - c_apres_parole
       where cockpit.ressemblance_fusion(coalesce(f.titre, f.sujet), c.titre) >= c_seuil_titre
         and not exists (select 1 from c c2 where c2.id <> c.id and cockpit.ressemblance_fusion(coalesce(f.titre, f.sujet), c2.titre) >= c_seuil_autre)
    )
    select distinct on (cand.id) cand.id, c.titre, c.etat, cand.regle, cand.quand, cand.url, cand.preuve
      from cand join c on c.id = cand.id
     order by cand.id, cand.prio, cand.quand
  loop
    if p_appliquer then
      v_res := cockpit.livrer_par_fusion(r.id, r.regle, r.preuve, coalesce(r.url, case when v_depot <> '' then 'https://github.com/' || v_depot end), r.quand);
    end if;
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('chantier', r.id, 'titre', r.titre, 'etat_avant', r.etat, 'regle', r.regle,
                   'preuve', r.preuve, 'url', r.url, 'quand', r.quand, 'applique', p_appliquer and coalesce((v_res->>'ok')::boolean, false)));
    if p_appliquer and coalesce((v_res->>'ok')::boolean, false) then v_ok := v_ok + 1; end if;
  end loop;
  if p_appliquer then update cockpit.projets set rapproche_at = now(), rapproche_erreur = null, rapproche_erreur_at = null where id = p.id; end if;
  return jsonb_build_object('projet', p_projet, 'examines', v_exam, 'tenus_vivants', v_tenus, 'livres', v_ok, 'a_livrer', jsonb_array_length(v_actions), 'actions', v_actions);
end $$;

-- Droits : le réglage des délais est un geste de l'écran (admin, la garde est dans la fonction) ; le reste ne change pas.
revoke all on function cockpit.regler_rapprochement_delais(text, int, int) from public, anon;
grant execute on function cockpit.regler_rapprochement_delais(text, int, int) to authenticated, service_role;
revoke all on function cockpit.regler_rapprochement(text, boolean), cockpit.etat_rapprochement(text), cockpit.chantiers_tenus_sans_trace(text, text, numeric), cockpit.rapprocher_depot(text, jsonb, boolean) from public, anon;
grant execute on function cockpit.regler_rapprochement(text, boolean), cockpit.etat_rapprochement(text) to authenticated, service_role;
grant execute on function cockpit.chantiers_tenus_sans_trace(text, text, numeric), cockpit.rapprocher_depot(text, jsonb, boolean) to service_role;
