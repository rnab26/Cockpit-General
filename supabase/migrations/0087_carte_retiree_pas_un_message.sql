-- 0087 : la note « J'ai retiré la carte « … » : motif » (écrite par retirer_carte, 0070) n'est PAS un message de
-- Raphaël qui attend une réponse : la carte vient d'être fermée. Mesuré le 14 oct. sur FacePro : 5 de ces notes
-- comptaient comme « messages libres » restés ~2 h sans réponse, ce qui (1) fausse la mesure de réaction (médiane
-- 2 h 11 min alors que les vrais messages reçoivent leur réponse en 6 à 30 s) et (2) pouvait lancer un agent « Répondre »
-- en double d'une session qui avait déjà tout traité. UNE règle, comme « Doublon fusionné : ».
-- Idempotente. Reprise de la définition EN VIGUEUR en base ; seule la ligne « retiré la carte » est ajoutée.
create or replace function cockpit.est_message_libre(m cockpit.messages)
returns boolean language sql stable set search_path = cockpit, pg_temp as $$
  select m.auteur_type in ('proprietaire', 'utilisateur')
     and m.kind in ('info', 'constat', 'reponse')
     and not coalesce(m.via_session, false)
     and (m.kind <> 'constat' or m.corps like 'Ça ne marche pas : %')
     and not coalesce(m.ou_en_est, false)
     and m.corps not like 'Doublon fusionné : %'
     and m.corps not like 'J''ai retiré la carte « %'
     and not (jsonb_array_length(coalesce(m.medias, '[]'::jsonb)) > 0 and exists (
           select 1 from cockpit.messages q where q.projet_id = m.projet_id and q.chantier_id is not distinct from m.chantier_id
              and q.kind in ('question', 'action') and q.answered_at is not null
              and m.created_at between q.answered_at - interval '5 seconds' and q.answered_at + interval '2 minutes'));
$$;
