-- exec_sql dans le schéma cockpit : même mécanisme que public.exec_sql
-- (Jarvis, migration 0010), mais avec le search_path posé sur `cockpit`, pour
-- que scripts/sql.sh écrive `select * from chantiers` sans préfixe et sans
-- deuxième instruction (exec_sql enveloppe une seule instruction ; un
-- `set search_path; select …` renvoie zéro ligne sans erreur).
-- Réservée à service_role : les sessions Claude Code, jamais un navigateur.
create or replace function cockpit.exec_sql(query text)
returns jsonb language plpgsql security definer
set search_path = cockpit, public, pg_temp as $$
declare resultat jsonb;
begin
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) as t', query) into resultat;
  return jsonb_build_object('ok', true, 'rows', resultat);
exception
  when syntax_error then
    begin
      execute query;
      return jsonb_build_object('ok', true, 'rows', null, 'note', 'execute sans resultat');
    exception when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm, 'sqlstate', sqlstate);
    end;
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'sqlstate', sqlstate);
end $$;
revoke execute on function cockpit.exec_sql(text) from public, anon, authenticated;
grant execute on function cockpit.exec_sql(text) to service_role;
