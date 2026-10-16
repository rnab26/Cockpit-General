-- 0097 — Une réservation EXPIRÉE sur un chantier « en cours » se libère toute seule (16 oct. 2026).
-- Raphaël : « de l'automatisation, rien de manuel ». Le balayage ne nettoyait une réservation expirée
-- que si le chantier n'était PAS « en cours » : un chantier en cours dont la session s'est arrêtée
-- restait bloqué pour toujours, avec « n réservations expirées : à libérer » à l'écran.
-- Règle ajoutée : réservation expirée + même règle « sans signe de vie » (sans_signe_de_vie, une seule
-- source) -> le chantier redevient « libre », comme liberer_chantier. Corps repris de la définition en
-- vigueur ; seul le bloc « NOUVEAU » est ajouté.
create or replace function cockpit.liberer_silencieux_coeur(p_projet text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'cockpit', 'pg_temp'
as $function$
declare pr cockpit.projets; c cockpit.chantiers; n integer := 0; v_min integer;
begin
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then return 0; end if;
  n := cockpit.rendre_passes_non_lancees(pr.id);
  for c in select * from cockpit.chantiers x
            where x.projet_id = pr.id and x.archived_at is null and x.pris_par is not null and x.pris_jusqu_a > now()
              and x.etat <> 'valide' and cockpit.sans_signe_de_vie(x)
              and not exists (select 1 from cockpit.passe_consignes q
                               where q.chantier_id = x.id and q.branche = x.pris_par and cockpit.passe_consigne_vivante(q)
                                 and q.created_at > now() - make_interval(mins => pr.passe_lancement_min))
            for update skip locked loop
    v_min := greatest(1, floor(extract(epoch from (now() - c.updated_at)) / 60))::int;
    update cockpit.chantiers set pris_jusqu_a = now(), libere_at = now(), libere_de = c.pris_par, libere_apres_min = v_min where id = c.id;
    update cockpit.messages set recu_at = null
     where chantier_id = c.id and recu_par = c.pris_par and recu_at is not null;
    n := n + 1;
  end loop;
  -- NOUVEAU : réservation expirée sur un chantier « en cours » sans signe de vie -> libre.
  for c in select * from cockpit.chantiers x
            where x.projet_id = pr.id and x.archived_at is null and x.pris_par is not null and x.pris_jusqu_a < now()
              and x.etat = 'en_cours' and cockpit.sans_signe_de_vie(x)
            for update skip locked loop
    v_min := greatest(1, floor(extract(epoch from (now() - c.updated_at)) / 60))::int;
    -- Déjà libéré par la boucle ci-dessus (réservation mise à « maintenant ») : on garde SA trace (qui, depuis combien).
    update cockpit.chantiers set pris_par = null, pris_jusqu_a = null, etat = 'libre',
           libere_at = case when c.libere_at >= c.pris_jusqu_a - interval '1 minute' then c.libere_at else now() end,
           libere_de = case when c.libere_at >= c.pris_jusqu_a - interval '1 minute' then c.libere_de else c.pris_par end,
           libere_apres_min = case when c.libere_at >= c.pris_jusqu_a - interval '1 minute' then c.libere_apres_min else v_min end
     where id = c.id;
    update cockpit.messages set recu_at = null
     where chantier_id = c.id and recu_par = c.pris_par and recu_at is not null;
    n := n + 1;
  end loop;
  update cockpit.chantiers set pris_par = null, pris_jusqu_a = null
   where projet_id = pr.id and archived_at is null and pris_par is not null
     and pris_jusqu_a < now() and etat <> 'en_cours';
  return n;
end $function$;
