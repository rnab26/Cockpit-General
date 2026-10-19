-- 0098 (19 oct. 2026). Raphaël : « un seul bouton, ça lance tous les chantiers » (« Tout lancer »). Constaté le 19/10 sur le
-- Trieur (un chantier de test + « Tout lancer ») : demander_renforts pose la demande, mais reveiller_chef rend « aucune_chef »
-- et ne tire RIEN : aucune session chef n'est vivante, donc cible_reveil() est nulle (0082). Le bouton ne lançait rien tant
-- qu'une session n'était pas déjà ouverte à la main.
--
-- Depuis le 16/10 la session réveillée par la routine traite elle-même les renforts en attente (chef.sh : « tu ES le renfort »,
-- PR 170) : elle n'a plus besoin d'une chef déjà vivante. DÉCISION : sans chef vivante, la routine est réveillée quand même,
-- pour toute raison sauf le filet de sécurité automatique (un réveil à vide coûterait des jetons toutes les heures) ; l'écart
-- minimum entre deux réveils (reveil_ecart_min, 5 min) limite le coût d'un clic répété.
do $$
declare d text;
begin
  d := pg_get_functiondef('cockpit.reveiller_chef(uuid,uuid,text)'::regprocedure);
  if d like '%r2.actif%' then return; end if;   -- déjà appliqué (rejouable)
  d := replace(d, E'  if v_cible is null then return ''aucune_chef''; end if;',
    E'  if v_cible is null and p_raison not like ''filet%'' then\n    v_cible := (select r2.projet_id from cockpit.reveils_immediats r2 where r2.actif limit 1);\n  end if;\n  if v_cible is null then return ''aucune_chef''; end if;');
  if d not like '%r2.actif%' then raise exception 'reveiller_chef : le point d''insertion n''a pas été trouvé'; end if;
  execute d;
end $$;
