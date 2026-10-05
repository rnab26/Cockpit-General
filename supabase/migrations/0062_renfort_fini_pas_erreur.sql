-- Un renfort qui a LIVRÉ puis s'est tu n'est pas en erreur (chantier b8a2cd53, 05/10/2026).
-- CAUSE PROUVÉE : renforts_expirer passait en « erreur » (« Plus aucun signe de vie depuis
-- 3 h : session arrêtée ? ») tout renfort actif devenu muet, SANS regarder s'il restait du
-- travail dans sa section. Les renforts cockpit « Base et sessions » (3 chantiers) et
-- « Correctifs » (6) avaient livré (PR 63, 70, 72, 73, 74 fusionnées, chantiers « à vérifier »),
-- leur session a été archivée avant leur dernier `renfort.sh --suivant` (qui seul pose
-- « fini ») : ils sont restés « actif » puis sont passés en erreur, alors qu'il n'y avait
-- plus rien à faire. Le message disait aussi « 3 h » (le vrai seuil est delai_signe).
-- Règle UNIQUE, renfort_travail_restant : un chantier tenu par le renfort, ou un chantier
-- (ou une vérification) prenable dans sa section. Muet SANS travail restant = « fini » ;
-- muet AVEC travail restant = « erreur » honnête, qui dit combien reste à reprendre.
-- Idempotente.
create or replace function cockpit.renfort_travail_restant(r cockpit.renforts)
returns int language sql stable security definer set search_path = cockpit, pg_temp as $$
  select cockpit.renfort_en_cours(r)
       + (select count(*)::int from cockpit.chantiers_prenables(r.projet_id, r.prefixe || '/') x
           where x.section_id is not distinct from r.section_id)
       + (select count(*)::int from cockpit.verifs_prenables(r.projet_id, r.prefixe || '/') v
           where v.section_id is not distinct from r.section_id);
$$;
revoke execute on function cockpit.renfort_travail_restant(cockpit.renforts) from public;
grant execute on function cockpit.renfort_travail_restant(cockpit.renforts) to service_role, authenticated;

create or replace function cockpit.renforts_expirer(p_projet_id uuid)
returns void language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts r set
         statut = case when r.statut = 'actif' and cockpit.renfort_travail_restant(r) = 0 then 'fini' else 'erreur' end,
         fini_at = case when r.statut = 'actif' and cockpit.renfort_travail_restant(r) = 0
                        then coalesce(r.vu_at, now()) else r.fini_at end,
         erreur = case
           when r.statut = 'actif' and cockpit.renfort_travail_restant(r) = 0 then r.erreur
           else coalesce(r.erreur, case r.statut
             when 'demande' then 'Jamais ouvert : la session chef n’est pas passée en 3 h.'
             else 'Session arrêtée sans avoir fini : il reste ' || cockpit.renfort_travail_restant(r)
                  || ' chantier(s) dans la section, à reprendre.' end) end
   where r.projet_id = p_projet_id and r.statut in ('demande', 'actif') and not cockpit.renfort_vivant(r);
$$;

-- Rattrapage HONNÊTE des erreurs déjà posées par l'ancienne règle : « fini » seulement si
-- la section n'a plus rien à faire ; sinon l'erreur reste, avec son vrai message.
update cockpit.renforts r set statut = 'fini', fini_at = coalesce(r.fini_at, r.vu_at, now()), erreur = null
 where r.statut = 'erreur' and r.erreur like 'Plus aucun signe de vie depuis 3 h%'
   and r.vu_at is not null and not cockpit.renfort_vivant(r) and cockpit.renfort_travail_restant(r) = 0;
update cockpit.renforts r set erreur = 'Session arrêtée sans avoir fini : il reste ' || cockpit.renfort_travail_restant(r)
                                      || ' chantier(s) dans la section, à reprendre.'
 where r.statut = 'erreur' and r.erreur like 'Plus aucun signe de vie depuis 3 h%';
