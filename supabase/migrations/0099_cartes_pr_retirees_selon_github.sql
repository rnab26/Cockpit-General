-- 0099 : une carte « Fusionne la PR #n » se retire SEULE dès que GitHub dit la PR fusionnée ou fermée (19 oct. 2026).
-- Raphaël : « les cartes sur FacePro ne sont pas du tout d'actualité, ça me pollue l'écran […] faut que ce soit coordonné en instantané ».
-- CAUSE MESURÉE : la PR #92 de FacePro est fermée (non fusionnée) depuis 14:54, sa carte restait ouverte : le seul qui retirait une carte
-- de PR était la passe d'une session chef vivante (chef.sh, toutes les 30 min au mieux). Rien ne tournait sans session.
-- Les dépôts du cockpit sont publics : la base les interroge elle-même (pg_net, lecture anonyme de l'API GitHub), toutes les 2 min,
-- sans session. Un échec (limite de GitHub, réseau) ne retire RIEN : la carte reste et on réessaie. Jamais answered_by (pas une réponse).
-- Idempotente.

create table if not exists cockpit.pr_sondes (
  request_id bigint primary key,
  message_id uuid not null references cockpit.messages(id) on delete cascade,
  lance_at timestamptz not null default now()
);
alter table cockpit.pr_sondes enable row level security;

create or replace function cockpit.pr_cartes_passe()
returns jsonb language plpgsql security definer set search_path = cockpit, extensions, net, pg_temp as $$
declare
  s record; m record; r record; v_etat text; v_retirees integer := 0; v_lancees integer := 0;
begin
  -- 1. Lire les réponses arrivées.
  for s in select * from cockpit.pr_sondes loop
    select * into r from net._http_response where id = s.request_id;
    if r.id is null then
      if s.lance_at < now() - interval '10 minutes' then delete from cockpit.pr_sondes where request_id = s.request_id; end if;
      continue;
    end if;
    if r.status_code = 200 then
      begin
        v_etat := case when (r.content::jsonb ->> 'merged_at') is not null then 'fusionnée'
                       when (r.content::jsonb ->> 'state') = 'closed' then 'fermée sans être fusionnée' else null end;
      exception when others then v_etat := null; end;
      if v_etat is not null then
        update cockpit.messages set answered_at = now(), retiree_seule_at = now(),
               reponse = 'Retirée automatiquement : la PR est ' || v_etat || ' sur GitHub, il n''y a plus rien à fusionner.'
         where id = s.message_id and answered_at is null;
        if found then v_retirees := v_retirees + 1; end if;
      end if;
    end if;
    delete from cockpit.pr_sondes where request_id = s.request_id;
  end loop;
  -- 2. Interroger GitHub pour chaque carte de PR encore ouverte (hors projets de test).
  for m in
    select x.id, p.depot, substring(x.corps from '#([0-9]+) ') as n
      from cockpit.messages x join cockpit.projets p on p.id = x.projet_id
     where x.kind = 'action' and x.answered_at is null and x.corps like 'Fusionne la PR #%'
       and p.depot ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' and not cockpit.projet_de_test(p.slug)
       and not exists (select 1 from cockpit.pr_sondes q where q.message_id = x.id)
     limit 30
  loop
    continue when m.n is null;
    insert into cockpit.pr_sondes (request_id, message_id)
    values (net.http_get(url := 'https://api.github.com/repos/' || m.depot || '/pulls/' || m.n,
                         headers := '{"User-Agent":"cockpit-general","Accept":"application/vnd.github+json"}'::jsonb), m.id);
    v_lancees := v_lancees + 1;
  end loop;
  return jsonb_build_object('retirees', v_retirees, 'sondees', v_lancees);
exception when others then
  return jsonb_build_object('erreur', left(sqlerrm, 200));
end $$;

revoke all on function cockpit.pr_cartes_passe() from public, anon, authenticated;
grant execute on function cockpit.pr_cartes_passe() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cockpit-cartes-pr') then perform cron.unschedule('cockpit-cartes-pr'); end if;
    perform cron.schedule('cockpit-cartes-pr', '*/2 * * * *', 'select cockpit.pr_cartes_passe()');
  end if;
end $$;
