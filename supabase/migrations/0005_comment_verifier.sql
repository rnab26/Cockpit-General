-- « Comment vérifier » (28 sept. 2026). Raphaël : « le nom du chantier, des
-- fois on n'est pas sûr à 100 % de ce qu'on doit vérifier ». Une session qui
-- livre un chantier écrit ICI, pour lui, les gestes à faire et ce qu'il doit
-- voir : où aller, quoi toucher, le résultat attendu. progression.sh --termine
-- l'exige ; la carte « à vérifier » l'affiche en tête ; le module embarqué aussi.
alter table cockpit.chantiers add column if not exists comment_verifier text;

-- Tracé comme les autres textes (restaurable), sans toucher au trigger : on
-- redéfinit la liste des champs suivis.
create or replace function cockpit.tracer_chantier()
returns trigger language plpgsql as $$
declare
  v_par text := coalesce(current_setting('cockpit.par', true), 'inconnu');
  c text;
begin
  new.updated_at := now();
  foreach c in array array['titre','demande','notes','resume_simple','comment_verifier','etat',
                           'priorite','section_id','archived_at','visible_utilisateurs']
  loop
    if to_jsonb(old) -> c is distinct from to_jsonb(new) -> c then
      insert into cockpit.historique (chantier_id, champ, ancienne, nouvelle, par)
      values (old.id, c, to_jsonb(old) ->> c, to_jsonb(new) ->> c, v_par);
    end if;
  end loop;
  if new.etat = 'a_verifier' and old.etat is distinct from 'a_verifier' then
    new.livre_at := now();
  end if;
  return new;
end $$;

create or replace function cockpit.restaurer_champ(p_historique bigint, p_par text)
returns void language plpgsql security definer
set search_path = cockpit, pg_temp as $$
declare h cockpit.historique;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'restaurer est réservé aux admins');
  select * into h from cockpit.historique where id = p_historique;
  if h.id is null then raise exception 'entrée introuvable'; end if;
  if h.champ not in ('titre','demande','notes','resume_simple','comment_verifier') then
    raise exception 'on ne restaure que du texte, jamais un état';
  end if;
  perform set_config('cockpit.par', coalesce(p_par, 'humain') || ' (restauration)', true);
  execute format('update cockpit.chantiers set %I = $1 where id = $2', h.champ)
    using h.ancienne, h.chantier_id;
end $$;
