-- 0093 : interrupteur par projet « Branché / En pause » (chantier 975118ca).
--
-- Raphaël (16 oct. 2026) : « dans les réglages d'un projet, un bouton Branché / En pause. En pause = aucune
-- session ni agent ne travaille sur ce projet (pas de chef, pas de renfort, pas de réveil, pas de prise de
-- chantier), mais rien n'est supprimé ni perdu ; on peut le rallumer d'un toucher. »
--
-- UNE règle : `cockpit.projet_en_pause(projet)`. Elle est lue aux points où le travail AUTOMATIQUE démarre :
--   * chantiers_prenables / verifs_prenables : plus rien n'est « prenable » (donc ni le mode autonome, ni la
--     passe de la chef, ni un renfort, ni le compte « N prêts », ni le filet) ;
--   * filet_attente : rien n'attend, donc le filet ne réveille personne ;
--   * reveiller_chef : aucun réveil immédiat (message, réponse, renfort demandé) ;
--   * renforts_auto / demander_renforts : aucun renfort ouvert, ni seul ni au bouton.
-- Les scripts (chef.sh, renfort.sh, passe.sh) et les hooks lisent la MÊME règle (`projets.en_pause`).
--
-- Ce qui n'arrive PAS : rien n'est supprimé ; un chantier déjà tenu par une session ou un agent vivant
-- n'est pas arraché (il finit, rien de nouveau ne démarre) ; une session que Raphaël ouvre lui-même et à
-- laquelle il écrit lui répond toujours (c'est lui qui demande). Les réglages du projet (autonome, filet,
-- renforts, frein) restent tels quels : le rallumage remet tout comme avant.
--
-- Les cinq fonctions existantes sont corrigées PAR LEUR DÉFINITION EN VIGUEUR (`pg_get_functiondef`), pas
-- recopiées depuis d'anciennes migrations : une copie d'avant ferait revenir un défaut déjà corrigé (0064).
-- Idempotent : une fonction qui porte déjà la garde n'est pas retouchée.

alter table cockpit.projets add column if not exists en_pause boolean not null default false;
alter table cockpit.projets add column if not exists pause_at timestamptz;
alter table cockpit.projets add column if not exists pause_par text;
alter table cockpit.projets add column if not exists pause_raison text;

create or replace function cockpit.projet_en_pause(p_projet_id uuid)
returns boolean language sql stable security definer set search_path = cockpit, pg_temp as $$
  select coalesce((select p.en_pause from cockpit.projets p where p.id = p_projet_id), false)
$$;

-- Régler : admin ou session. Rend l'état d'avant (l'écran propose « Annuler » d'un toucher).
create or replace function cockpit.regler_pause_projet(p_projet text, p_pause boolean, p_raison text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; v_avant boolean; v_par text;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  if p_pause is null then raise exception 'dis si le projet est branché ou en pause'; end if;
  select * into pr from cockpit.projets where slug = p_projet;
  if pr.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  v_avant := pr.en_pause;
  v_par := coalesce((select email from auth.users where id = auth.uid()), case when cockpit.est_service() then 'session' end);
  update cockpit.projets
     set en_pause = p_pause,
         pause_at = case when p_pause then now() else null end,
         pause_par = case when p_pause then v_par else null end,
         pause_raison = case when p_pause then nullif(left(btrim(coalesce(p_raison, '')), 200), '') else null end
   where id = pr.id;
  return jsonb_build_object('projet', p_projet, 'en_pause', p_pause, 'avant', v_avant);
end $$;

-- Remplace UNE fois, dans la définition en vigueur de `nom` (une seule fonction de ce nom), le texte `ancre` par
-- `ancre` suivi de `ajout`. Idempotent (déjà gardée = rien) ; ancre introuvable = échec bruyant, jamais un silence.
create or replace function cockpit._garde_pause(p_nom text, p_ancre text, p_ajout text)
returns text language plpgsql as $$
declare v_n int; v_oid oid; v_def text; v_pos int;
begin
  select count(*), max(p.oid) into v_n, v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cockpit' and p.proname = p_nom;
  if v_n <> 1 then raise exception '_garde_pause : % fonction(s) nommée(s) % (une attendue)', v_n, p_nom; end if;
  v_def := pg_get_functiondef(v_oid);
  if position('garde pause 0093' in v_def) > 0 then return p_nom || ' : déjà gardée'; end if;
  v_pos := position(p_ancre in v_def);
  if v_pos = 0 then raise exception '_garde_pause : ancre introuvable dans % (définition changée ?) : %', p_nom, p_ancre; end if;
  execute substr(v_def, 1, v_pos - 1 + length(p_ancre)) || p_ajout || substr(v_def, v_pos + length(p_ancre));
  return p_nom || ' : garde posée';
end $$;

select cockpit._garde_pause('chantiers_prenables',
  'where c.projet_id = p_projet_id', ' /* garde pause 0093 */ and not cockpit.projet_en_pause(p_projet_id)');
select cockpit._garde_pause('verifs_prenables',
  'where c.projet_id = p_projet_id', ' /* garde pause 0093 */ and not cockpit.projet_en_pause(p_projet_id)');
select cockpit._garde_pause('filet_attente',
  'if pr.id is null then return jsonb_build_object(''n'', 0, ''plus_ancien'', null, ''raisons'', ''[]''::jsonb); end if;',
  E'\n  /* garde pause 0093 */ if pr.en_pause then return jsonb_build_object(''n'', 0, ''plus_ancien'', null, ''raisons'', ''[]''::jsonb); end if;');
select cockpit._garde_pause('reveiller_chef',
  'if v_slug is null then return ''aucune_chef''; end if;',
  E'\n  /* garde pause 0093 */ if cockpit.projet_en_pause(p_projet_id) then return ''projet_en_pause''; end if;');
select cockpit._garde_pause('renforts_auto',
  'perform cockpit.exiger(cockpit.est_service(), ''réservé aux sessions'');',
  E'\n  /* garde pause 0093 */ if cockpit.projet_en_pause(p_projet_id) then return jsonb_build_object(''demandes'', ''[]''::jsonb, ''raison'', ''projet_en_pause''); end if;');
select cockpit._garde_pause('demander_renforts',
  'pr := cockpit.renfort_projet(p_projet);',
  E'\n  /* garde pause 0093 */ perform cockpit.exiger(not pr.en_pause, ''Projet en pause : rallume-le (Réglages du projet) avant de lancer des renforts'');');

drop function cockpit._garde_pause(text, text, text);

revoke all on function cockpit.projet_en_pause(uuid), cockpit.regler_pause_projet(text, boolean, text) from public, anon, authenticated;
grant execute on function cockpit.projet_en_pause(uuid) to service_role;
grant execute on function cockpit.regler_pause_projet(text, boolean, text) to authenticated, service_role;
