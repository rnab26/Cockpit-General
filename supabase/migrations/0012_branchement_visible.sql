-- « Est-ce que ce projet est VRAIMENT branché, et à jour ? » (29 sept. 2026)
--
-- Raphaël : « sur FacePro, je n'arrive pas à voir si c'est branché réellement
-- […] s'il prend réellement les demandes de mes sessions ; les améliorations du
-- cockpit doivent être partout, et j'ai pas l'impression que c'est le cas ».
--   - branchement_vu_at : dernier démarrage de session qui a exécuté le hook du
--     cockpit dans ce projet (preuve qu'il est branché côté sessions) ;
--   - branchement_maj / branchement_maj_at : ce que la mise à jour automatique
--     du démarrage a changé dans le dépôt du projet (null = déjà à jour) ;
--   - embed_vu_at : dernier appel du module embarqué depuis le site du projet
--     (preuve qu'il est branché côté site ; posé par la fonction cockpit-embed).
alter table cockpit.projets add column if not exists branchement_vu_at timestamptz;
alter table cockpit.projets add column if not exists branchement_maj text;
alter table cockpit.projets add column if not exists branchement_maj_at timestamptz;
alter table cockpit.projets add column if not exists embed_vu_at timestamptz;
