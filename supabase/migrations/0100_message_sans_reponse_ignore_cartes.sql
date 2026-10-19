-- 0100 : un message de Raphaël n'est plus « répondu » par une carte ou une ligne automatique (19 oct. 2026).
-- Raphaël : « Conversation sans nom ouverte : attend ton message » / « Claude n'a pas encore répondu » restent affichés, rien ne les prend.
-- CAUSE : messages_sans_reponse comptait comme réponse TOUT message de session posté plus tard dans le même fil : une carte
-- « Fusionne la PR… », « Pris par un renfort », « Chantier ouvert depuis une session » suffisaient à masquer son message,
-- donc ni filet de sécurité ni réveil ne le servaient. Seule une vraie réponse (info écrite par une session) compte maintenant.
-- Le texte de la fonction en vigueur est repris tel quel (pg_get_functiondef), seule la condition change. Rejouable.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('cockpit.messages_sans_reponse(uuid,text)'::regprocedure);
  if d like '%Pris par un renfort%' then return; end if;
  n := replace(d, 'and s.auteur_type = ''session'' and s.created_at > m.created_at)',
    'and s.auteur_type = ''session'' and s.created_at > m.created_at
                          and s.kind not in (''question'', ''action'', ''fusion'')
                          and s.corps not like ''Pris par un renfort%'' and s.corps not like ''Chantier ouvert depuis une session%'')');
  if n = d then raise exception 'messages_sans_reponse : motif introuvable'; end if;
  execute n;
end $$;
