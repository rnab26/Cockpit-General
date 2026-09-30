-- Mode autonome : s'éteint tout seul quand il n'y a plus rien à faire (30 sept. 2026)
--
-- Chantier 79ec70d6 : « un moyen simple d'éteindre et d'allumer le travail
-- autonome d'un projet dans le cockpit, pour éviter les crédits inutiles ».
-- Un projet autonome « tout le temps » sans aucun chantier prêt réveille
-- quand même une session à chaque passage (routine horaire, hook Stop) pour
-- répondre « RIEN » : des crédits pour rien.
--
-- Règle (une seule source, appelée par passe.sh, chef.sh et hooks/autonome.sh
-- à chaque passage) : constater_autonome(slug).
--  - Il y a du travail (un chantier prenable, un chantier réservé en cours, un
--    agent qui avance) → autonome_vide_depuis repart à zéro.
--  - Rien → autonome_vide_depuis = l'heure du premier constat « rien ».
--  - Rien depuis autonome_arret_vide_h heures (réglable par projet, 0 = jamais,
--    3 h par défaut) → le mode s'éteint (autonome_eteint_auto_at), et le fil du
--    projet le dit. Le rallumer = un toucher dans l'app (regler_autonome remet
--    les compteurs à zéro).

alter table cockpit.projets add column if not exists autonome_arret_vide_h int not null default 3;
alter table cockpit.projets add column if not exists autonome_vide_depuis timestamptz;
alter table cockpit.projets add column if not exists autonome_eteint_auto_at timestamptz;
do $$ begin
  alter table cockpit.projets add constraint projets_autonome_arret_vide_h_borne check (autonome_arret_vide_h between 0 and 24);
exception when duplicate_object then null; end $$;

-- Réglage : mêmes gardes qu'avant (0011), plus le délai d'extinction. Allumer
-- ou éteindre à la main efface l'extinction automatique et le compteur.
drop function if exists cockpit.regler_autonome(text, timestamptz, int, boolean);
create or replace function cockpit.regler_autonome(p_projet text, p_jusqu_a timestamptz, p_max int default null,
  p_toujours boolean default false, p_arret_vide_h int default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare r cockpit.projets;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux admins');
  if not p_toujours and p_jusqu_a is not null and p_jusqu_a <= now() then raise exception 'l''heure de fin doit être dans le futur'; end if;
  if not p_toujours and p_jusqu_a is not null and p_jusqu_a > now() + interval '24 hours' then raise exception 'pas plus de 24 h d''affilée (ou choisis « tout le temps »)'; end if;
  if p_arret_vide_h is not null and (p_arret_vide_h < 0 or p_arret_vide_h > 24) then raise exception 'extinction automatique : entre 0 (jamais) et 24 h'; end if;
  update cockpit.projets
     set autonome_toujours = coalesce(p_toujours, false),
         autonome_jusqu_a = case when p_toujours then null else p_jusqu_a end,
         autonome_max = coalesce(p_max, autonome_max),
         autonome_arret_vide_h = coalesce(p_arret_vide_h, autonome_arret_vide_h),
         autonome_vide_depuis = null,
         autonome_eteint_auto_at = null
   where slug = p_projet returning * into r;
  if r.id is null then raise exception 'projet inconnu : %', p_projet; end if;
  if cockpit.autonome_actif(r) then update cockpit.sessions set relances = 0 where projet_id = r.id; end if;
  return jsonb_build_object('projet', r.slug, 'toujours', r.autonome_toujours, 'jusqu_a', r.autonome_jusqu_a,
    'max', r.autonome_max, 'arret_vide_h', r.autonome_arret_vide_h);
end $$;

-- Le constat d'un passage. Rend 'eteint', 'travail', 'vide' ou 'eteint_auto'.
create or replace function cockpit.constater_autonome(p_projet text)
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare pr cockpit.projets; travail boolean;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into pr from cockpit.projets where slug = p_projet for update;
  if pr.id is null or not cockpit.autonome_actif(pr) then return 'eteint'; end if;
  travail := exists (select 1 from cockpit.chantiers_prenables(pr.id, null))
    or exists (select 1 from cockpit.chantiers c where c.projet_id = pr.id and c.archived_at is null
                 and c.etat = 'en_cours' and c.pris_par is not null and c.pris_jusqu_a > now())
    or exists (select 1 from cockpit.taches t where t.projet_id = pr.id and t.statut = 'en_cours'
                 and t.vu_at > now() - interval '30 minutes');
  if travail then
    if pr.autonome_vide_depuis is not null then update cockpit.projets set autonome_vide_depuis = null where id = pr.id; end if;
    return 'travail';
  end if;
  if pr.autonome_vide_depuis is null then
    update cockpit.projets set autonome_vide_depuis = now() where id = pr.id;
    return 'vide';
  end if;
  if pr.autonome_arret_vide_h > 0 and pr.autonome_vide_depuis <= now() - make_interval(hours => pr.autonome_arret_vide_h) then
    update cockpit.projets set autonome_toujours = false, autonome_jusqu_a = null,
           autonome_vide_depuis = null, autonome_eteint_auto_at = now() where id = pr.id;
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (pr.id, null, 'cockpit', 'session', 'info',
            format('Mode autonome éteint tout seul : aucun chantier à prendre depuis %s h. Rallume-le d’un toucher quand tu en ajoutes.', pr.autonome_arret_vide_h));
    return 'eteint_auto';
  end if;
  return 'vide';
end $$;

revoke execute on function cockpit.regler_autonome(text, timestamptz, int, boolean, int), cockpit.constater_autonome(text)
  from public, anon, authenticated;
grant execute on function cockpit.regler_autonome(text, timestamptz, int, boolean, int), cockpit.constater_autonome(text) to service_role;
-- L'app (admin) allume/éteint ; le constat reste réservé aux sessions.
grant execute on function cockpit.regler_autonome(text, timestamptz, int, boolean, int) to authenticated;
