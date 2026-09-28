-- « par » vide au lieu de « inconnu » (28-29 sept. 2026, vu par verifier-base,
-- intermittent) : sur une connexion réutilisée qui a déjà fait un set_config
-- local, current_setting('cockpit.par', true) renvoie '' et non null.
create or replace function cockpit.tracer_chantier()
returns trigger language plpgsql as $$
declare
  v_par text := coalesce(nullif(current_setting('cockpit.par', true), ''), 'inconnu');
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

create or replace function cockpit.tracer_suppression()
returns trigger language plpgsql as $$
begin
  insert into cockpit.supprimes (chantier_id, projet_id, ligne, par)
  values (old.id, old.projet_id, to_jsonb(old),
          coalesce(nullif(current_setting('cockpit.par', true), ''), 'inconnu'));
  return old;
end $$;
