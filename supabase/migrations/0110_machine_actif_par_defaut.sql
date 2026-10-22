-- 0110 : le battement machine devient ALLUMÉ par défaut (22 oct. 2026).
-- Raphaël : « une session FacePro tourne quasi constamment (calculs, agents en ligne) ; ça doit se voir ». Le battement est un petit
-- processus local (scripts/machine.py) : sans jetons, un échantillon de /proc toutes les 60 s, il s'arrête seul quand rien ne tourne.
-- Il restait éteint par défaut (0104) : une session qui calcule sans parler était « en veille ». Réglable par projet (Réglages ›
-- Renforts › « Mesurer les calculs »). Idempotent.
alter table cockpit.projets alter column machine_actif set default true;
update cockpit.projets set machine_actif = true where machine_actif is not true;
