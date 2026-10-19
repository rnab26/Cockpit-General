-- 0101 : un message ou une réponse de Raphaël que personne n'a reçu en direct réveille le travail MÊME si une session est « vivante » (19 oct. 2026).
-- Raphaël : « mes réponses dans Mélissa n'ont pas été prises en compte parce qu'il n'y a pas de session […] ça doit se faire tout seul ».
-- CAUSE : filet_passe s'abstenait (« session_vivante ») dès qu'un renfort ou un agent avait donné signe de vie dans l'heure (délai 60 min,
-- 0096), alors que cet agent travaille sur UN chantier et ne lira jamais le message. messages_sans_reponse exclut déjà ce que
-- une session ouverte a reçu en direct (recu_at, 20 min) : ce qui reste n'a donc aucun lecteur. Le filet réveille, comme pour un projet sans session.
-- Le texte de la fonction en vigueur est repris tel quel (pg_get_functiondef). Rejouable.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('cockpit.filet_passe(text,boolean,boolean)'::regprocedure);
  if d like '%sans lecteur%' then return; end if;
  n := replace(d, 'elsif cockpit.filet_vivant(pr.id) then v_res := ''session_vivante'';',
    'elsif cockpit.filet_vivant(pr.id) and not (v_att -> ''raisons'')::text ~ ''message\(s\)|réponse\(s\)'' /* sans lecteur : 0101 */ then v_res := ''session_vivante'';');
  if n = d then raise exception 'filet_passe : motif introuvable'; end if;
  execute n;
end $$;
