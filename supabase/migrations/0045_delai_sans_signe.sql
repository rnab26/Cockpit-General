-- 0045 (30 sept. 2026, chantier 0f905af0). Raphaël : « Pourquoi attendre 30
-- minutes ? […] un cadenas de réservation automatique, posé tout de suite quand
-- la chef attribue, et repris vite si l'agent est mort. » Puis : « ZÉRO chantier
-- tenu pour rien » → défaut 3 min, borne basse 1 min.
--
-- Le délai « sans signe de vie » est UN réglage par projet (projets.
-- delai_sans_signe_min, 1 à 120, défaut 3) lu par UNE fonction (delai_signe).
-- Avant : 30 min écrites en dur dans 10 fonctions (0043 sans_signe_de_vie et
-- renfort_vivant ; 0011/0017/0018/0023/0025/0026/0031/0028/0038/0041 pour
-- « session ou agent vivant ») : elles lisent toutes delai_signe(projet).
-- Volontairement inchangés : bascule_usage (30 min de calme d'usage, autre
-- notion), les 3 h de renfort_vivant / réservation, les 2 h d'un message pris.
--
-- MESURÉ le 30/09 (lecture seule + code de hooks/suivi.sh, Claude Code 2.1) :
--  * signes de vie qui existent : (1) sessions.vu_at, posé par le hook
--    PostToolUse au RETOUR d'un outil, au plus 1 fois/min ; (2) taches.vu_at
--    des agents, qui SUIT sessions.vu_at (trigger 0015), aucun signe propre ;
--    (3) activite.updated_at et chantiers.updated_at, seulement quand l'agent
--    écrit une étape (progression.sh). Entre deux comptes rendus d'étape d'un
--    même chantier : médiane 9,8 min, 129 écarts sur 260 > 10 min, 76 > 30 min
--    (messages de session, 10 jours) : les étapes seules ne prouvent pas la vie.
--  * TROU : un outil qui dure (suite de tests, build ; plafond de l'outil Bash
--    = 10 min) ne déclenche AUCUN hook pendant qu'il tourne : un agent vivant
--    paraîtrait mort après 3 min. Réponse : hooks/suivi.sh ajoute un hook
--    PreToolUse qui lance un battement détaché (un signe toutes les 45 s tant
--    que l'outil tourne, 11 min au plus) ; brancher.sh le déclare, et le hook
--    de démarrage relance brancher --maj à chaque session : rien à faire à la
--    main. Signe de vie d'un agent vivant = au plus ~60 s d'écart (entre deux
--    outils : PostToolUse ; pendant un outil : battement 45 s).
--  * Limite connue : un long texte généré sans aucun outil (plus de 3 min
--    d'affilée) reste muet ; rare, et le délai se règle par projet.
--
-- CADENAS : la réservation est posée AU MOMENT de l'attribution, dans la même
-- transaction que le choix du chantier (prochain_chantier_autonome,
-- reprendre_reponse, reprendre_message -> reserver_chantier ; verifs par
-- reserver_chantier juste après le choix ; renfort par prochain_renfort). La
-- fiche est alors « touchée » : c'est le début des 3 min de grâce.
--
-- COMMENT c'est posé : un bloc DO relit la définition EN VIGUEUR de chaque règle
-- (pg_get_functiondef) et y remplace « now() - interval '30 minutes' » par
-- « now() - cockpit.delai_signe(<projet>) » : il s'applique à la version actuelle,
-- même si d'autres migrations (0044_*, en cours ailleurs) ont retouché ces
-- fonctions ; rejouable (rien à faire s'il ne reste aucun « 30 minutes »). Numéro
-- 0045 : il doit passer APRÈS toute migration qui redéfinirait l'une d'elles. Une
-- future migration qui les redéfinit doit lire delai_signe (verifier-base §38
-- rougit sinon).
--
-- Idempotente, sans drop.

alter table cockpit.projets add column if not exists delai_sans_signe_min integer not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projets_delai_sans_signe_borne') then
    alter table cockpit.projets add constraint projets_delai_sans_signe_borne check (delai_sans_signe_min between 1 and 120);
  end if;
end $$;

-- UNE source : le délai du projet (3 min si le projet est inconnu : même valeur que le défaut de la colonne).
create or replace function cockpit.delai_signe(p_projet uuid)
returns interval language sql stable security definer set search_path = cockpit, pg_temp as $$
  select make_interval(mins => coalesce((select delai_sans_signe_min from cockpit.projets where id = p_projet), 3));
$$;

-- Réglage (admin depuis l'app, service depuis chef.sh --sans-signe).
create or replace function cockpit.regler_sans_signe(p_projet text, p_min int)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets;
begin
  pr := cockpit.renfort_projet(p_projet);
  if p_min is null or p_min not between 1 and 120 then raise exception 'Délai sans signe de vie : de 1 à 120 minutes.'; end if;
  update cockpit.projets set delai_sans_signe_min = p_min where id = pr.id;
  return jsonb_build_object('delai_sans_signe_min', p_min);
end $$;

-- Les règles « sans signe de vie / vivant depuis N min » : (fonction, expression du projet dans son corps).
do $$
declare r record; def text; nv text; ancien text := 'now() - interval ''30 minutes''';
begin
  for r in
    select p.oid, p.proname, x.expr
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'cockpit'
      join (values
        ('sans_signe_de_vie', 'c.projet_id'), ('renfort_vivant', 'r.projet_id'),
        ('messages_sans_reponse', 'c.projet_id'), ('reponses_sans_suite', 'c.projet_id'),
        ('ou_en_est_sans_suite', 'c.projet_id'), ('prendre_ou_en_est', 'r.projet_id'),
        ('constater_autonome', 'pr.id'), ('reveiller_chef', 'p_projet_id'),
        ('relais_a_servir', 'p.id'), ('filet_vivant', 'p_projet_id')
      ) as x(nom, expr) on x.nom = p.proname
  loop
    def := pg_get_functiondef(r.oid);
    continue when position(ancien in def) = 0;
    nv := replace(def, ancien, 'now() - cockpit.delai_signe(' || r.expr || ')');
    execute nv;
  end loop;
end $$;

revoke all on function cockpit.delai_signe(uuid), cockpit.regler_sans_signe(text, int) from public, anon, authenticated;
grant execute on function cockpit.delai_signe(uuid) to service_role;
grant execute on function cockpit.regler_sans_signe(text, int) to authenticated, service_role;
