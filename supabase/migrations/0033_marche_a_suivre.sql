-- Marche à suivre d'une ACTION manuelle (30 sept. 2026, chantier e9a7c360
-- « Facilité les actions manuelle »)
--
-- Raphaël : « lorsqu'on demande des actions, à chaque fois il faut que j'aille
-- chercher et ce n'est pas assez précis. Il faut que Claude renvoie les liens
-- précis et les démarches précises pour faire simplement des copier-coller
-- quand il y a des démarches manuelles à faire, peu importe le type de
-- chantier et dans toutes les discussions. Et il doit fournir aussi un visuel
-- si ça peut aider. »
--
-- Une demande `kind = 'action'` (scripts/demander.sh --action) porte donc sa
-- marche à suivre, structurée pour que l'app la rende actionnable d'un pouce :
--   { "liens":  [{ "url": "https://…", "libelle": "Ouvrir les réglages" }],
--     "etapes": ["Touche « New secret »", "Colle le nom ci-dessous", …],
--     "copier": [{ "libelle": "Nom du secret", "texte": "RUNPOD_API_KEY" }] }
-- Lien exact (bouton), étapes numérotées, textes prêts à coller (bouton
-- « Copier »). Le visuel reste messages.medias (0020, --image). Les règles
-- (lien obligatoire sauf --sans-lien, 1 à 8 étapes, pas de secret) sont
-- appliquées par demander.sh AVANT toute écriture ; la base garde la forme.
-- Idempotente.

alter table cockpit.messages add column if not exists marche jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_marche_forme') then
    alter table cockpit.messages add constraint messages_marche_forme
      check (marche is null or jsonb_typeof(marche) = 'object');
  end if;
end $$;

comment on column cockpit.messages.marche is
  'Marche à suivre d''une action manuelle (0033) : {liens:[{url,libelle}], etapes:[texte], copier:[{libelle,texte}]}. Posée par demander.sh --action.';
