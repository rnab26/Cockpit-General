-- « Je ne sais pas : vérifie pour moi » (29 sept. 2026)
--
-- Raphaël : « on me demande de vérifier, mais je ne sais pas si le résultat
-- est le bon (trop d'éléments, comparer, compter) ; c'est à Claude de
-- constater à partir de ce que je lui apporte, pas juste oui / non ».
--  - demander_verification : il colle ce qu'il a vu (texte, capture) et
--    demande à Claude de juger ; le chantier sort de « À toi » le temps que
--    Claude vérifie (la session chef lance un agent dessus) ;
--  - rendre_verdict (sessions) : Claude répond « c'est bon » ou « ça ne va
--    pas » avec ses preuves ; bon → il revient à Raphaël pour UN toucher
--    (certifier reste humain) ; pas bon → il repart en correction.
alter table cockpit.chantiers add column if not exists verif_demandee_at timestamptz;
alter table cockpit.chantiers add column if not exists verdict_ok boolean;
alter table cockpit.chantiers add column if not exists verdict_texte text;
alter table cockpit.chantiers add column if not exists verdict_at timestamptz;

create or replace function cockpit.demander_verification(p_id uuid, p_par text, p_mots text default null)
returns void language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid;
begin
  perform cockpit.exiger(cockpit.peut_agir(p_id), 'tu n''as pas accès à ce chantier');
  update cockpit.chantiers set verif_demandee_at = now(), verdict_ok = null, verdict_texte = null, verdict_at = null
   where id = p_id and etat = 'a_verifier' and archived_at is null
  returning projet_id into v_projet;
  if v_projet is null then raise exception 'ce chantier n''est pas « à vérifier »'; end if;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (v_projet, p_id, coalesce(nullif(p_par, ''), 'humain'), case when cockpit.est_admin() then 'proprietaire' else 'utilisateur' end,
          'constat', 'Je ne sais pas dire si c''est bon : vérifie pour moi.' || coalesce(E'\n\nCe que j''ai vu :\n' || nullif(trim(p_mots), ''), ''));
end $$;

create or replace function cockpit.rendre_verdict(p_id uuid, p_par text, p_ok boolean, p_texte text)
returns text language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare c cockpit.chantiers;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  if nullif(trim(p_texte), '') is null then raise exception 'dis ce que tu as constaté, preuves à l''appui'; end if;
  select * into c from cockpit.chantiers where id = p_id;
  if c.id is null then raise exception 'chantier introuvable'; end if;
  update cockpit.chantiers set verif_demandee_at = null, verdict_ok = p_ok, verdict_texte = p_texte, verdict_at = now(),
         pris_par = null, pris_jusqu_a = null
   where id = p_id;
  insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
  values (c.projet_id, p_id, coalesce(nullif(p_par, ''), 'session'), 'session', 'info',
          case when p_ok then 'Vérifié pour toi : c''est BON. ' else 'Vérifié pour toi : ça NE VA PAS. ' end || p_texte);
  if not p_ok and c.etat = 'a_verifier' then
    update cockpit.chantiers
       set demande = coalesce(demande, '') || E'\n\n--- Vérification de Claude du ' || to_char(now(), 'DD/MM/YYYY HH24:MI') || E' : ne fonctionne pas ---\n' || p_texte,
           etat = 'libre'
     where id = p_id;
    return 'repart en correction';
  end if;
  return case when p_ok then 'revient à Raphaël pour un toucher' else 'noté' end;
end $$;

revoke all on function cockpit.demander_verification(uuid, text, text), cockpit.rendre_verdict(uuid, text, boolean, text) from public, anon;
grant execute on function cockpit.demander_verification(uuid, text, text) to authenticated, service_role;
revoke execute on function cockpit.rendre_verdict(uuid, text, boolean, text) from authenticated;
grant execute on function cockpit.rendre_verdict(uuid, text, boolean, text) to service_role;
