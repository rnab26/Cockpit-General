-- 0080 — Rapprochement GitHub → chantiers (13 oct. 2026, chantier 6f112d51).
--
-- Raphaël : « une session Claude qui bosse sur plusieurs sujets : ses chantiers doivent être créés, fusionnés et mis à jour
-- automatiquement […] mes anciens et mes nouveaux chantiers ne sont pas actualisés ni coordonnés. »
-- Mesuré sur FacePro le 13 oct. : 26 chantiers « en cours », dont au moins 10 déjà fusionnés dans GitHub, parce que la session
-- qui les tenait s'est arrêtée (ou est passée à autre chose) sans dire « terminé ». Le cockpit croyait ce que les sessions
-- DÉCLARENT ; il doit lire ce qu'elles ONT FAIT.
--
-- UNE règle (`rapprocher_depot`) : un chantier ouvert, que plus personne ne tient (`sans_signe_de_vie`), qui n'attend pas Raphaël
-- (`attend_raphael`), dont l'ACHÈVEMENT est PROUVÉ dans main, passe « livré, à vérifier » avec la preuve écrite dans son fil.
-- Les preuves d'achèvement, de la plus forte à la plus faible : 0. le commit que la session avait elle-même signalé « envoyé »
-- (jalon `pousse`) est dans main ; 1. le travail de CODE fait sur sa branche depuis la création du chantier est dans main (git, lu par
-- le collecteur), si aucun autre chantier ne tient la même branche ; 1b. une PR venue de sa branche est fusionnée après sa dernière
-- trace ; 2. le titre ou le message d'une PR fusionnée cite son identifiant ; 3. le titre d'une PR fusionnée lui ressemble presque
-- mot pour mot ET aucun autre chantier ouvert ne lui ressemble. Une simple MENTION de l'identifiant dans un commit n'est pas un
-- achèvement (mesuré : « Chantier 4ab4de0c. » au pied d'une étape d'un chantier qui continue) : elle ne suffit jamais.
-- Jamais « validé » (seul Raphaël), jamais un chantier tenu par une session ou un agent vivant (sa session reçoit un rappel précis à
-- la place), jamais un chantier qui attend sa réponse. Chaque passage est tracé (table `rapprochements`) et défaisable
-- (`annuler_rapprochement`). Idempotente.

alter table cockpit.projets add column if not exists rapproche_at timestamptz;   -- dernier passage du rapprochement (même sans rien à faire)
alter table cockpit.projets add column if not exists rapprochement_auto boolean not null default true;   -- le passage automatique des hooks (éteint : seul un passage demandé à la main écrit)
alter table cockpit.projets add column if not exists rapproche_erreur text;                 -- pourquoi le dernier passage a échoué (git injoignable…) : un échec silencieux ferait croire que rien n'est à faire
alter table cockpit.projets add column if not exists rapproche_erreur_at timestamptz;

create table if not exists cockpit.rapprochements (
  id             uuid primary key default gen_random_uuid(),
  projet_id      uuid not null references cockpit.projets(id) on delete cascade,
  chantier_id    uuid not null references cockpit.chantiers(id) on delete cascade,
  regle          text not null,
  preuve         text not null,
  url            text,
  quand          timestamptz,                  -- date de la fusion dans main
  etat_avant     text not null,
  pris_par_avant text,
  at             timestamptz not null default now(),
  annule_at      timestamptz
);
alter table cockpit.rapprochements drop constraint if exists rapprochements_regle_check;
alter table cockpit.rapprochements add constraint rapprochements_regle_check check (regle in ('jalon', 'branche', 'identifiant', 'titre', 'manuel'));
create index if not exists rapprochements_projet_idx on cockpit.rapprochements (projet_id, at desc);
create index if not exists rapprochements_chantier_idx on cockpit.rapprochements (chantier_id);
alter table cockpit.rapprochements enable row level security;
alter table cockpit.rapprochements replica identity full;
drop policy if exists admin_tout on cockpit.rapprochements;
create policy admin_tout on cockpit.rapprochements for all using (cockpit.est_admin()) with check (cockpit.est_admin());

-- La dernière trace d'une session sur un chantier : ses propres signaux (activité), sinon sa création.
-- (`updated_at` de la fiche ne convient pas : le balayage de libération la touche lui-même.)
create or replace function cockpit.derniere_trace(c cockpit.chantiers)
returns timestamptz language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce((select max(a.updated_at) from cockpit.activite a where a.chantier_id = c.id), c.created_at)
$$;

-- Le dernier MOT dit dans le fil du chantier, par qui que ce soit (la session, Raphaël, un utilisateur), hors lignes automatiques
-- (constats, fusions suggérées). Un chantier dont on a parlé APRÈS la livraison n'est pas fini : « mon verdict était faux, je te propose
-- un plan » écrit après la fusion (constaté sur FacePro, 10 oct.) interdit de le déclarer livré.
create or replace function cockpit.derniere_parole(c cockpit.chantiers)
returns timestamptz language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce((select max(m.created_at) from cockpit.messages m where m.chantier_id = c.id and m.kind not in ('constat', 'fusion')), c.created_at)
$$;

-- Une adresse n'est montrée que si elle pointe vers GitHub (le reste vient d'un script, jamais d'une saisie libre).
create or replace function cockpit.url_github(p_url text)
returns text language sql immutable set search_path = cockpit, pg_temp as $$
  select case when p_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[A-Za-z0-9_./#-]*)?$' then p_url end
$$;

-- Les questions du collecteur : quels chantiers ouverts, que personne ne tient, attendent une preuve ?
create or replace function cockpit.chantiers_a_rapprocher(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux sessions et aux scripts du cockpit');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ch.id, 'titre', ch.titre, 'etat', ch.etat, 'pris_par', ch.pris_par,
             'created_at', ch.created_at, 'derniere_trace', cockpit.derniere_trace(ch),
             'pousse', ch.jalons->'pousse'->>'detail') order by ch.created_at)
      from cockpit.chantiers ch join cockpit.projets p on p.id = ch.projet_id
     where p.slug = p_projet and ch.archived_at is null and ch.etat in ('en_cours', 'libre', 'a_trier', 'bloque')
       and cockpit.sans_signe_de_vie(ch) and not cockpit.attend_raphael(ch)), '[]'::jsonb);
end $$;

-- Passer UN chantier à « livré, à vérifier » parce que son travail est prouvé dans main. Rien d'autre : jamais « validé ».
create or replace function cockpit.livrer_par_fusion(p_chantier uuid, p_regle text, p_preuve text, p_url text, p_quand timestamptz)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers; v_slug text; v_quand timestamptz := coalesce(p_quand, now());
        v_url text := cockpit.url_github(p_url); v_preuve text := left(btrim(coalesce(p_preuve, '')), 400); r_id uuid;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions et aux scripts du cockpit');
  if p_regle not in ('jalon', 'branche', 'identifiant', 'titre', 'manuel') then raise exception 'règle inconnue : %', p_regle; end if;
  if v_preuve = '' then raise exception 'une preuve est obligatoire'; end if;
  select * into c from cockpit.chantiers where id = p_chantier for update;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  if c.archived_at is not null or c.etat not in ('en_cours', 'libre', 'a_trier', 'bloque') then
    return jsonb_build_object('ok', false, 'raison', 'pas_ouvert', 'etat', c.etat);
  end if;
  select slug into v_slug from cockpit.projets where id = c.projet_id;
  update cockpit.chantiers
     set etat = 'a_verifier', pris_par = null, pris_jusqu_a = null,
         comment_verifier = '1. Ouvre ' || coalesce(v_url, 'GitHub') || ' : c''est le travail fusionné. 2. Essaie sur le site le cas décrit dans ce chantier. 3. Touche « Ça marche » ou « Ça ne marche pas ».',
         jalons = coalesce(jalons, '{}'::jsonb) || jsonb_build_object('pousse', jsonb_build_object('at', v_quand, 'detail', left(v_preuve, 300)))
   where id = c.id;
  update cockpit.chantiers set livre_at = v_quand where id = c.id;       -- la date de livraison est celle de la fusion, pas celle du rapprochement
  perform cockpit.signaler_activite(v_slug, c.id, 'rapprochement', left('Livré (rapproché de GitHub) : ' || v_preuve, 200), 100, null, 'termine', v_url);
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (c.projet_id, c.id, 'cockpit', 'session', 'constat',
          left('Livré, d''après GitHub : ' || v_preuve || '. Si ce n''est pas le cas, touche « Ça ne marche pas » : le chantier repart en correction.', 500));
  insert into cockpit.rapprochements (projet_id, chantier_id, regle, preuve, url, quand, etat_avant, pris_par_avant)
  values (c.projet_id, c.id, p_regle, v_preuve, v_url, v_quand, c.etat, c.pris_par) returning id into r_id;
  return jsonb_build_object('ok', true, 'rapprochement', r_id, 'chantier', c.id, 'titre', c.titre, 'etat_avant', c.etat);
end $$;

-- Défaire : le chantier reprend l'état d'avant. Le fil garde les deux lignes (rien n'est effacé).
create or replace function cockpit.annuler_rapprochement(p_id uuid)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.rapprochements; c cockpit.chantiers;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into r from cockpit.rapprochements where id = p_id for update;
  if r.id is null then raise exception 'rapprochement introuvable'; end if;
  if r.annule_at is not null then return jsonb_build_object('ok', false, 'raison', 'deja_annule'); end if;
  select * into c from cockpit.chantiers where id = r.chantier_id for update;
  if c.id is not null and c.etat = 'a_verifier' and c.archived_at is null then
    update cockpit.chantiers
       set etat = r.etat_avant, pris_par = null, pris_jusqu_a = null, comment_verifier = null, livre_at = null,
           jalons = coalesce(jalons, '{}'::jsonb) - 'pousse'
     where id = c.id;
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (c.projet_id, c.id, 'cockpit', 'session', 'constat', 'Rapprochement annulé : le chantier est redevenu « ' || r.etat_avant || ' ».');
  end if;
  update cockpit.rapprochements set annule_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'chantier', r.chantier_id, 'etat', r.etat_avant);
end $$;

-- LA règle. `p_faits` (lu par scripts/rapprocher.py dans git) :
--   { "depot": "owner/repo",
--     "par_chantier": { "<id>": { "regle": "jalon" | "branche", "n": 3, "sha": "…", "date": "…", "sujet": "…", "url": "…" } },  -- preuves 0 et 1 : git
--     "fusions": [ { "sha", "date", "sujet", "corps", "titre", "numero", "branche", "url" } ] }                              -- preuves 1b, 2, 3 : les PR fusionnées
-- `p_appliquer = false` : rien n'est écrit, le résultat dit ce qui serait fait.
create or replace function cockpit.rapprocher_depot(p_projet text, p_faits jsonb, p_appliquer boolean default true)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare p cockpit.projets; r record; v_actions jsonb := '[]'::jsonb; v_res jsonb; v_exam int; v_tenus int; v_ok int := 0;
        v_depot text := coalesce(p_faits->>'depot', '');
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
                    to_char(pc.date at time zone 'Asia/Jerusalem', 'DD/MM "à" HH24:MI')) as preuve
        from c join pc on pc.id = c.id and pc.regle = 'jalon'
       where c.etat in ('en_cours', 'bloque')                                     -- un chantier « libre » a été rendu par le balayage : son jalon n'est qu'une étape
         and (c.pousse_at is null or c.trace <= c.pousse_at + interval '30 minutes')  -- aucun travail signalé APRÈS ce dernier envoi
         and pc.date >= c.parole - interval '30 minutes'                              -- et personne n'a parlé du chantier après la livraison
      union all
      -- 1. le travail de code fait sur sa branche depuis la création du chantier est dans main, et aucun autre chantier ne tient cette branche
      select c.id, 1, 'branche', pc.date, pc.url,
             format('son travail (%s commit%s de code de la branche « %s ») est dans main depuis le %s', pc.n, case when pc.n > 1 then 's' else '' end,
                    c.pris_par, to_char(pc.date at time zone 'Asia/Jerusalem', 'DD/MM "à" HH24:MI'))
        from c join pc on pc.id = c.id and pc.regle = 'branche'
       where c.etat in ('en_cours', 'bloque') and pc.date >= c.parole - interval '30 minutes'
         and not exists (select 1 from cockpit.chantiers o where o.projet_id = p.id and o.id <> c.id and o.pris_par is not distinct from c.pris_par
                           and c.pris_par is not null and o.archived_at is null and o.etat in ('en_cours', 'libre', 'a_trier', 'bloque'))
      union all
      -- 1b. une PR venue de sa branche est fusionnée après sa dernière trace
      select c.id, 1, 'branche', f.date, f.url,
             format('la PR n° %s « %s » (sa branche « %s ») est fusionnée dans main le %s', f.numero, left(coalesce(f.titre, f.sujet), 90), c.pris_par,
                    to_char(f.date at time zone 'Asia/Jerusalem', 'DD/MM "à" HH24:MI'))
        from c join f on f.numero is not null and f.branche is not null and f.branche = c.pris_par and f.date >= c.created_at
         and f.date >= c.trace - interval '10 minutes' and f.date >= c.parole - interval '30 minutes'
      union all
      -- 2. le titre ou le message d'une PR fusionnée cite son identifiant (une simple mention dans un commit ne suffit jamais)
      select c.id, 2, 'identifiant', f.date, f.url,
             format('la PR n° %s « %s » cite ce chantier et est fusionnée dans main le %s', f.numero, left(coalesce(f.titre, f.sujet), 90),
                    to_char(f.date at time zone 'Asia/Jerusalem', 'DD/MM "à" HH24:MI'))
        from c join f on f.numero is not null and f.date >= c.created_at and f.date >= c.parole - interval '30 minutes'
         and (coalesce(f.sujet, '') || ' ' || coalesce(f.titre, '') || ' ' || coalesce(f.corps, '')) ~* ('(^|[^0-9a-f])' || left(c.id::text, 8) || '([^0-9a-f]|$)')
      union all
      -- 3. le titre d'une PR fusionnée lui ressemble presque mot pour mot, et aucun autre chantier ouvert ne lui ressemble
      select c.id, 3, 'titre', f.date, f.url,
             format('la PR n° %s « %s » ressemble à ce chantier et est fusionnée dans main le %s', f.numero, left(coalesce(f.titre, f.sujet), 90),
                    to_char(f.date at time zone 'Asia/Jerusalem', 'DD/MM "à" HH24:MI'))
        from c join f on f.numero is not null and f.date >= c.created_at and f.date <= c.created_at + interval '21 days'
         and f.date >= c.trace - interval '1 day' and f.date >= c.parole - interval '30 minutes'
       where cockpit.ressemblance_fusion(coalesce(f.titre, f.sujet), c.titre) >= 0.6
         and not exists (select 1 from c c2 where c2.id <> c.id and cockpit.ressemblance_fusion(coalesce(f.titre, f.sujet), c2.titre) >= 0.5)
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

-- L'état du rapprochement, pour l'écran (admin) : dernier passage, ce qui a été fait tout seul.
create or replace function cockpit.etat_rapprochement(p_projet text)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
declare p cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  select * into p from cockpit.projets where slug = p_projet;
  if p.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('rapproche_at', p.rapproche_at, 'auto', p.rapprochement_auto, 'erreur', p.rapproche_erreur, 'erreur_at', p.rapproche_erreur_at,
    'livres_24h', (select count(*) from cockpit.rapprochements r where r.projet_id = p.id and r.annule_at is null and r.at > now() - interval '24 hours'),
    'livres_total', (select count(*) from cockpit.rapprochements r where r.projet_id = p.id and r.annule_at is null));
end $$;

-- Un passage qui ÉCHOUE (git injoignable, clone impossible…) le dit : l'écran « Chantiers et GitHub » affiche l'échec au lieu de « pas encore passé ».
-- Effacé par le prochain passage réussi.
create or replace function cockpit.noter_echec_rapprochement(p_projet text, p_message text)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions et aux scripts du cockpit');
  update cockpit.projets set rapproche_erreur = left(btrim(coalesce(nullif(btrim(p_message), ''), 'erreur inconnue')), 300), rapproche_erreur_at = now() where slug = p_projet;
  return jsonb_build_object('ok', found);
end $$;

-- Le réglage : allumé par défaut ; éteint, les hooks ne passent plus (un passage demandé à la main écrit toujours).
create or replace function cockpit.regler_rapprochement(p_projet text, p_auto boolean)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  update cockpit.projets set rapprochement_auto = coalesce(p_auto, true) where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  return jsonb_build_object('projet', p_projet, 'auto', r.rapprochement_auto);
end $$;

-- Le rappel précis pour une session VIVANTE : les chantiers qu'elle tient et sur lesquels elle n'a plus rien signalé depuis N heures.
-- (Elle seule sait s'ils sont finis : le hook le lui dit à chaque message de Raphaël, avec ce qu'il faut taper.)
create or replace function cockpit.chantiers_tenus_sans_trace(p_projet text, p_branche text, p_heures numeric default 4)
returns jsonb language plpgsql stable security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions et aux scripts du cockpit');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ch.id, 'titre', ch.titre, 'etat', ch.etat,
             'heures', round((extract(epoch from now() - cockpit.derniere_trace(ch)) / 3600)::numeric, 1)) order by cockpit.derniere_trace(ch))
      from cockpit.chantiers ch join cockpit.projets p on p.id = ch.projet_id
     where p.slug = p_projet and ch.archived_at is null and ch.etat in ('en_cours', 'libre', 'a_trier', 'bloque')
       and nullif(p_branche, '') is not null and ch.pris_par = p_branche
       and cockpit.derniere_trace(ch) < now() - make_interval(secs => (greatest(p_heures, 0.1) * 3600)::int)
       and not cockpit.attend_raphael(ch)), '[]'::jsonb);
end $$;

-- Droits : ce sont des gestes de session / de script (service_role), sauf l'état et l'annulation, lisibles par l'admin.
revoke all on function cockpit.derniere_trace(cockpit.chantiers), cockpit.derniere_parole(cockpit.chantiers), cockpit.url_github(text), cockpit.chantiers_a_rapprocher(text),
  cockpit.livrer_par_fusion(uuid, text, text, text, timestamptz), cockpit.annuler_rapprochement(uuid),
  cockpit.rapprocher_depot(text, jsonb, boolean), cockpit.etat_rapprochement(text), cockpit.regler_rapprochement(text, boolean), cockpit.chantiers_tenus_sans_trace(text, text, numeric),
  cockpit.noter_echec_rapprochement(text, text)
  from public, anon;
grant execute on function cockpit.derniere_trace(cockpit.chantiers), cockpit.derniere_parole(cockpit.chantiers), cockpit.url_github(text), cockpit.chantiers_a_rapprocher(text),
  cockpit.livrer_par_fusion(uuid, text, text, text, timestamptz), cockpit.rapprocher_depot(text, jsonb, boolean),
  cockpit.chantiers_tenus_sans_trace(text, text, numeric), cockpit.noter_echec_rapprochement(text, text) to service_role;
grant execute on function cockpit.annuler_rapprochement(uuid), cockpit.etat_rapprochement(text), cockpit.regler_rapprochement(text, boolean) to authenticated, service_role;
