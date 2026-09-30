-- 0046 — « Je ne sais pas : vérifie pour moi » ne reste plus sans retour (30 sept. 2026, chantier b4937471).
-- Raphaël : « des fois j'ai demandé à Claude de vérifier quelque chose et je n'ai jamais de retour ».
-- Cause prouvée sur les 2 demandes en base :
--   FacePro (00:39) : un renfort vivant sur SA section (renfort_vivant, 3 h) l'excluait de verifs_prenables pour
--     tous les autres ; ce renfort passait le code d'abord (faits = 0 à 14:20), un renfort précédent l'avait pris
--     puis était mort sans verdict ; et sans chef vivante, relais_a_servir ne comptait que les messages libres.
--   cockpit (14:00) : servie (réservée à agent/verif-…) : pas un défaut, mais rien ne le disait à l'écran.
-- UNE règle : une vérification est priorité sur le code ; la section d'un renfort ne la garde que
-- delai_verif_renfort_min() (10 min), au-delà tout le monde peut la prendre ; un chantier certifié n'en a jamais.
-- Le relais ouvre une session pour elle (relais_a_servir.verifs). Idempotent, aucun drop.

create or replace function cockpit.delai_verif_renfort_min() returns int language sql immutable as $$ select 10 $$;

create or replace function cockpit.verifs_prenables(p_projet_id uuid, p_par text default null)
returns setof cockpit.chantiers language sql stable security definer set search_path = cockpit, pg_temp as $$
  select c.* from cockpit.chantiers c
   where c.projet_id = p_projet_id and c.archived_at is null and c.verif_demandee_at is not null
     and c.etat <> 'valide'
     and (c.pris_par is null or c.pris_jusqu_a < now() or c.pris_par = p_par)
     and not exists (
       select 1 from cockpit.renforts r
        where r.projet_id = c.projet_id and cockpit.renfort_vivant(r)
          and r.section_id is not distinct from c.section_id
          and c.verif_demandee_at > now() - make_interval(mins => cockpit.delai_verif_renfort_min())
          and coalesce(p_par, '') not like r.prefixe || '/%')
   order by c.verif_demandee_at;
$$;

create or replace function cockpit.prochain_renfort(p_renfort uuid)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare rf cockpit.renforts; c cockpit.chantiers; br text; pr cockpit.projets; places int; en_cours int;
  donnes jsonb := '[]'::jsonb; v_etat text; v_verif boolean;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select * into rf from cockpit.renforts where id = p_renfort for update;
  if rf.id is null or rf.statut not in ('demande', 'actif') then
    return jsonb_build_object('etat', 'fini', 'chantiers', donnes, 'en_cours', 0, 'raison', 'renfort fermé');
  end if;
  select * into pr from cockpit.projets where id = rf.projet_id;
  en_cours := cockpit.renfort_en_cours(rf);
  places := rf.max_agents - en_cours;
  while places > 0 loop
    -- 0046 : « Vérifie pour moi » PASSE AVANT le code (une vérification est courte et Raphaël l'attend).
    select v.* into c from cockpit.verifs_prenables(rf.projet_id, rf.prefixe || '/') v
     where v.section_id is not distinct from rf.section_id limit 1;
    v_verif := c.id is not null;
    if c.id is null then
      select x.* into c from cockpit.chantiers_prenables(rf.projet_id, rf.prefixe || '/') x
       where x.section_id is not distinct from rf.section_id limit 1;
    end if;
    exit when c.id is null;
    v_etat := c.etat;
    br := rf.prefixe || '/' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    exit when not cockpit.reserver_chantier(c.id, br, case when v_verif then 60 else 180 end);
    insert into cockpit.messages (projet_id, chantier_id, auteur, auteur_type, kind, corps)
    values (rf.projet_id, c.id, br, 'session', 'info',
            case when v_verif then 'Un renfort vérifie pour toi (session à part, même section).'
                 else 'Pris par un renfort (session à part, même section).' end);
    donnes := donnes || jsonb_build_object('id', c.id, 'titre', c.titre, 'etat_avant', v_etat, 'branche', br,
      'verif', v_verif, 'comment', c.comment_verifier,
      'apporte', case when v_verif then (select string_agg(m.corps, chr(10) || '---' || chr(10) order by m.created_at)
                   from cockpit.messages m where m.chantier_id = c.id and m.auteur_type in ('proprietaire', 'utilisateur')
                    and m.created_at >= c.verif_demandee_at - interval '1 minute') end,
      'demande', left(coalesce(c.demande, ''), 1500));
    places := places - 1;
    c := null;
  end loop;
  update cockpit.renforts set faits = faits + jsonb_array_length(donnes), vu_at = now(), statut = 'actif' where id = rf.id;
  if jsonb_array_length(donnes) = 0 and en_cours = 0 then
    update cockpit.renforts set statut = 'fini', fini_at = now() where id = rf.id;
    return jsonb_build_object('etat', 'fini', 'chantiers', donnes, 'en_cours', 0, 'slug', pr.slug, 'depot', pr.depot);
  end if;
  return jsonb_build_object('etat', case when jsonb_array_length(donnes) > 0 then 'chantiers' else 'attends' end,
    'chantiers', donnes, 'en_cours', en_cours, 'max_agents', rf.max_agents, 'slug', pr.slug, 'depot', pr.depot);
end $$;

-- Relais : ajoute 'verifs'.
create or replace function cockpit.relais_a_servir(p_chef_projet text, p_test text default null)
returns jsonb language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_chef uuid; r jsonb := '[]'::jsonb; p record; v_renf jsonb; v_msg int; v_ouvrir boolean; v_fermer jsonb; v_verif int;
begin
  perform cockpit.exiger(cockpit.est_service(), 'réservé aux sessions');
  select id into v_chef from cockpit.projets where slug = p_chef_projet;
  if p_test is null and (v_chef is null or v_chef is distinct from cockpit.chef_relais()) then return r; end if;
  for p in select * from cockpit.projets x
            where x.actif and x.id is distinct from v_chef
              and (case when p_test is null then not cockpit.projet_de_test(x.slug) else x.slug = p_test end)
              and not cockpit.chef_vivante(x.id)
            order by x.slug loop
    v_renf := cockpit.renforts_a_ouvrir(p.slug, p_test is not null);
    select count(*) into v_msg from cockpit.messages_sans_reponse(p.id);
    select count(*) into v_verif from cockpit.verifs_prenables(p.id, null);
    -- 0046 : une vérification en attente ouvre aussi une session (même plafond : 1 par heure) ; une session
    -- vivante ne l'en dispense pas (elle ne sert que ses messages), un message sans réponse si.
    v_ouvrir := (v_verif > 0 or (v_msg > 0
      and not exists (select 1 from cockpit.sessions s where s.projet_id = p.id and s.fin_at is null and s.vu_at > now() - interval '30 minutes')))
      and not exists (select 1 from cockpit.ouvertures o where o.projet_id = p.id and o.created_at > now() - interval '1 hour');
    v_fermer := coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'session', o.session_distante) order by o.created_at)
                 from cockpit.ouvertures o where o.projet_id = p.id and cockpit.ouverture_finie(o.id)), '[]'::jsonb);
    continue when jsonb_array_length(v_renf -> 'ouvrir') = 0 and jsonb_array_length(v_renf -> 'archiver') = 0
              and jsonb_array_length(v_fermer) = 0 and not v_ouvrir;
    r := r || jsonb_build_object('slug', p.slug, 'nom', p.nom, 'depot', p.depot, 'renforts', v_renf,
                                 'ouvrir_session', v_ouvrir, 'messages', v_msg, 'verifs', v_verif, 'fermer', v_fermer);
  end loop;
  return r;
end $$;
