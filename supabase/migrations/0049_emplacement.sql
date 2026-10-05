-- Où vit le cockpit d'un projet, et qui l'utilise (5 oct. 2026, chantier dec7fb3c)
-- Raphaël : « quand on branche un cockpit on ne sait pas où il va apparaître ni
-- où il va vivre ». Le choix se pose en cartes AVANT le déploiement
-- (scripts/emplacement.sh) et se range ici, par projet, dans UNE colonne jsonb :
--   mode   : menu (bouton dans le menu du site) | page (page à part, lien extérieur)
--            | appli (l'app installable du cockpit, rien dans le site)
--   acces  : moi (réservé à Raphaël) | equipe (membres du projet) | utilisateurs
--            (les utilisateurs connectés du site) ; l'appli n'est jamais ouverte
--            aux utilisateurs du site (ils n'ont pas de compte du cockpit)
--   menu   : sélecteur du lien du menu qui ouvre le cockpit (optionnel)
--   libelle, page : texte du bouton, chemin de la page (optionnels)
-- Ces objets avaient été posés en base par un passage précédent de ce chantier,
-- sans être versionnés : cette migration les reprend à l'identique (rejouable).
alter table cockpit.projets add column if not exists emplacement jsonb;

create or replace function cockpit.emplacement_valide(p jsonb)
returns text language plpgsql immutable set search_path = cockpit, pg_temp as $$
declare m text := p->>'mode'; a text := p->>'acces'; sel text := p->>'menu'; lib text := p->>'libelle';
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'emplacement attendu'; end if;
  if m is null or m not in ('menu', 'page', 'appli') then return 'mode : menu, page ou appli'; end if;
  if a is null or a not in ('moi', 'equipe', 'utilisateurs') then return 'accès : moi, equipe ou utilisateurs'; end if;
  if m = 'appli' and a = 'utilisateurs' then return 'l''appli est réservée aux membres du projet, pas aux utilisateurs du site'; end if;
  if nullif(trim(sel), '') is not null and (length(sel) > 200 or sel ~ '[<>{}]') then return 'sélecteur du menu invalide'; end if;
  if nullif(trim(lib), '') is not null and (length(lib) > 40 or lib ~ '[<>]') then return 'libellé : 40 caractères, sans balise'; end if;
  if nullif(trim(p->>'page'), '') is not null and (length(p->>'page') > 200 or trim(p->>'page') !~ '^/') then return 'page : un chemin commençant par /'; end if;
  return null;
end $$;

create or replace function cockpit.regler_emplacement(p_slug text, p_emplacement jsonb)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pb text; propre jsonb;
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  pb := cockpit.emplacement_valide(p_emplacement);
  if pb is not null then raise exception '%', pb; end if;
  propre := jsonb_strip_nulls(jsonb_build_object(
    'mode', p_emplacement->>'mode', 'acces', p_emplacement->>'acces',
    'menu', nullif(trim(p_emplacement->>'menu'), ''), 'libelle', nullif(trim(p_emplacement->>'libelle'), ''),
    'page', nullif(trim(p_emplacement->>'page'), ''), 'decide_at', now()));
  update cockpit.projets set emplacement = propre where slug = p_slug;
  if not found then raise exception 'projet inconnu : %', p_slug; end if;
end $$;

create or replace function cockpit.effacer_emplacement(p_slug text)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  perform cockpit.exiger(cockpit.est_admin() or cockpit.est_service(), 'réservé à l''admin du cockpit');
  update cockpit.projets set emplacement = null where slug = p_slug;
  if not found then raise exception 'projet inconnu : %', p_slug; end if;
end $$;

revoke all on function cockpit.emplacement_valide(jsonb), cockpit.regler_emplacement(text, jsonb), cockpit.effacer_emplacement(text) from public, anon;
grant execute on function cockpit.emplacement_valide(jsonb), cockpit.regler_emplacement(text, jsonb), cockpit.effacer_emplacement(text) to authenticated, service_role;
