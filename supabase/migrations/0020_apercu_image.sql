-- Images jointes par une SESSION (29 sept. 2026, chantier « Aperçu image »)
--
-- Raphaël : « quand ce n'est pas assez clair, qu'on me montre des images pour
-- que je comprenne mieux de quoi il s'agit, ou ce que je suis censé voir ».
-- Le sens Raphaël → Claude existe (0013). Le sens Claude → Raphaël :
--  - une question porte ses images dans messages.medias (colonne de 0013),
--    posée par scripts/demander.sh --image <fichier> ;
--  - un message du fil aussi (scripts/media.sh --envoyer … --image <fichier>) ;
--  - « Comment vérifier » : « voici ce que tu dois voir ». Le texte vit dans
--    chantiers.comment_verifier (0005) ; ses images, ICI, posées par
--    scripts/progression.sh --termine … --image <fichier>. Même forme que
--    messages.medias : [{chemin, nom, type, taille}].
-- Les fichiers vont dans le stockage privé `cockpit-medias` (0013), chemin
-- `<projet>/<chantier>/<uuid>-<nom>` : la lecture suit donc déjà les droits
-- du chantier (peut_lire_media). La session dépose avec service_role.

alter table cockpit.chantiers add column if not exists verifier_medias jsonb not null default '[]'::jsonb;
