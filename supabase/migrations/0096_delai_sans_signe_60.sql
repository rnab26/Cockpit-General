-- 0096 (16 oct. 2026). Raphaël : « le correctif bouche est resté à 5 % […] je veux que ça tourne et supprime ce réglage de
-- calcul inutile après 5 min : si en plus ça stoppe le travail, c'est une catastrophe. »
--
-- CAUSE (mesurée le 16/10) : le délai « sans signe de vie » valait 3 min (0046). Les agents d'une session de routine
-- (réveil immédiat) n'ont AUCUN hook (pas de battement : le dépôt n'est pas le dossier de la session) ; ils ne signalent
-- que quand ils appellent progression.sh, souvent à plus de 3 min d'écart (lecture, calcul long). Passé 3 min, le cockpit
-- les comptait morts : la tuile « ça avance » tombait à 0 et la réservation pouvait être libérée puis reprise par une
-- autre session en cours de route = l'« arrêt brutal ».
--
-- DÉCISION : 60 min par défaut (le réglage par projet 1 à 120 reste, Réglages du projet › Renforts (détails)). Un agent
-- réellement mort garde son chantier au plus 60 min (la réservation expire de toute façon à 3 h). Seuls les projets encore
-- à l'ancien défaut (3) passent à 60 : un délai choisi à la main n'est pas touché.
alter table cockpit.projets alter column delai_sans_signe_min set default 60;
update cockpit.projets set delai_sans_signe_min = 60 where delai_sans_signe_min = 3;

-- UNE source : le délai du projet (60 min si le projet est inconnu : même valeur que le défaut de la colonne).
create or replace function cockpit.delai_signe(p_projet uuid)
returns interval language sql stable security definer set search_path = cockpit, pg_temp as $$
  select make_interval(mins => coalesce((select delai_sans_signe_min from cockpit.projets where id = p_projet), 60));
$$;
revoke all on function cockpit.delai_signe(uuid) from public;
grant execute on function cockpit.delai_signe(uuid) to service_role;
