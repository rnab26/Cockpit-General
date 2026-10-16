-- Un renfort demandé qui n'a plus rien à faire se ferme « fini », sans l'erreur « Jamais ouvert »
-- (chantier 4b0ea892, 14/10/2026). Constaté le 13/10 : la passe de la chef a créé un renfort « Paquet de 2 »
-- pour 2 vérifications qu'elle venait de réserver à ses propres agents ; verdicts rendus, plus rien à faire, mais
-- renforts_expirer ne regardait le travail restant (0062) que pour un renfort ACTIF : une demande jamais ouverte
-- devenait une erreur rouge au bout de 3 h. Règle UNIQUE, renfort_travail_restant, maintenant pour les deux statuts :
-- demande ou actif, expiré SANS travail restant = « fini » ; AVEC travail restant = erreur honnête.
-- (L'autre moitié est dans scripts/chef.sh : renforts_a_ouvrir est appelé APRÈS la réservation des agents.)
-- Idempotente. Reprend la définition en vigueur (0062).
create or replace function cockpit.renforts_expirer(p_projet_id uuid)
returns void language sql security definer set search_path = cockpit, pg_temp as $$
  update cockpit.renforts r set
         statut = case when cockpit.renfort_travail_restant(r) = 0 then 'fini' else 'erreur' end,
         fini_at = case when cockpit.renfort_travail_restant(r) = 0
                        then coalesce(r.vu_at, now()) else r.fini_at end,
         erreur = case
           when cockpit.renfort_travail_restant(r) = 0 then r.erreur
           else coalesce(r.erreur, case r.statut
             when 'demande' then 'Jamais ouvert : la session chef n’est pas passée en 3 h.'
             else 'Session arrêtée sans avoir fini : il reste ' || cockpit.renfort_travail_restant(r)
                  || ' chantier(s) dans la section, à reprendre.' end) end
   where r.projet_id = p_projet_id and r.statut in ('demande', 'actif') and not cockpit.renfort_vivant(r);
$$;

-- Rattrapage honnête : une erreur « Jamais ouvert » dont le lot n'a plus rien à faire n'est pas une erreur.
-- Statut seulement, rien n'est supprimé ; une section/un paquet qui garde du travail reste en erreur.
update cockpit.renforts r set statut = 'fini', fini_at = coalesce(r.fini_at, r.erreur_at, now()), erreur = null
 where r.statut = 'erreur' and r.session_distante is null and r.erreur like 'Jamais ouvert%'
   and r.efface_at is null and cockpit.renfort_travail_restant(r) = 0;
