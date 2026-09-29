-- Section « Correctifs » rangée toute seule (29 sept. 2026, chantier ea21b577)
--
-- Raphaël : « ajouter une section corrective lorsque c'est des correctifs par
-- exemple visuels, de mise en page, d'ergonomie, et que ça trie
-- intelligemment ce type de chantier ». Général : tous les projets, toutes
-- les voies de création (app, session, module embarqué, reprise d'une
-- réponse), parce que la règle vit ICI, dans la base, une seule fois.
--
-- La règle (pas un devin, une liste lisible) — cockpit.est_correctif :
--   texte normalisé (minuscules, sans accents, ponctuation → espace) ;
--   V = mots d'un correctif visuel / de mise en page / d'ergonomie ;
--   G = mots d'un GROS chantier (refonte, fonctionnalité, moteur, migration…).
--   Correctif  ⇔  un V et aucun G dans le TITRE
--              OU, pour une demande d'utilisateur final (origine 'utilisateur',
--                 module embarqué) : un V et aucun G dans titre + demande.
--   Le titre porte le sujet : une demande longue qui cite « couleur » ou
--   « refonte » en passant ne décide pas (sauf un utilisateur final, qui
--   décrit ce qu'il voit en quelques mots).
-- Quand : à la CRÉATION d'un chantier sans section (trigger). Un chantier déjà
-- rangé n'est jamais déplacé ; une session corrige un mauvais tri avec
-- `scripts/chantier.sh --ranger <id> --section "<autre>"` (le trigger ne
-- rejoue pas sur une mise à jour). Les chantiers ouverts sans section
-- existants : cockpit.ranger_correctifs(slug) (service ou admin).

create or replace function cockpit.texte_normalise(p text)
returns text language sql immutable as $$
  select ' ' || trim(regexp_replace(
    lower(translate(coalesce(p, ''),
      'ÀÂÄÁÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑÝàâäáãåéèêëíìîïóòôöõúùûüçñýÿ''’',
      'aaaaaaeeeeiiiiooooouuuucnyaaaaaaeeeeiiiiooooouuuucnyy  ')),
    '[^a-z0-9]+', ' ', 'g')) || ' ';
$$;

-- Les deux listes, en expressions régulières sur le texte normalisé (mots
-- entiers : \m début de mot, \M fin de mot). Une seule source : ici.
create or replace function cockpit.mots_correctif_visuel()
returns text language sql immutable as $$
  select '\m(mise en page|mise en forme|alignement|aligne[ers]?|mal aligne[es]*|decale[es]?|decalage|marges?|espacements?|espace entre|padding'
      || '|polices?|taille du texte|taille de (la )?police|texte trop (petit|grand)|trop petit|trop grand|couleurs?|contraste'
      || '|lisible|illisible|lisibilite|deborde|debordement|depasse de l ecran|tronque[es]?|chevauche(ment)?|superpose[es]?'
      || '|responsive|mode sombre|theme (sombre|clair)|ergonomie|ergonomique|visuel(le)?s?|esthetique|design|css|style'
      || '|affichage|s affiche mal|mal affiche[es]?|icones?|emojis?|logo|orthographe|coquilles?|faute de frappe|typo|libelles?'
      || '|defilement|scroll|clignote(ment)?|centre[er]?|pixels?|sur (le )?(telephone|mobile)|mise en valeur|plus facile(ment)?|pas pratique|peu pratique'
      || '|difficile a (lire|voir|trouver|toucher|cliquer|atteindre)|hors de l ecran|cache[es]? (par|sous|derriere))\M';
$$;

create or replace function cockpit.mots_gros_chantier()
returns text language sql immutable as $$
  select '\m(refonte|fonctionnalites?|nouvelle fonction|nouveau module|nouvel ecran|nouvelle page|migrations?|moteur'
      || '|modeles?|gpu|runpod|algorithme|base de donnees|architecture|integration|automatisation|facturation|paiement)\M';
$$;

create or replace function cockpit.est_correctif(p_titre text, p_demande text, p_origine text default 'proprietaire')
returns boolean language sql immutable as $$
  select (cockpit.texte_normalise(p_titre) ~ cockpit.mots_correctif_visuel()
          and not cockpit.texte_normalise(p_titre) ~ cockpit.mots_gros_chantier())
      or (coalesce(p_origine, '') = 'utilisateur'
          and (cockpit.texte_normalise(p_titre) || cockpit.texte_normalise(p_demande)) ~ cockpit.mots_correctif_visuel()
          and not (cockpit.texte_normalise(p_titre) || cockpit.texte_normalise(p_demande)) ~ cockpit.mots_gros_chantier());
$$;

-- La section du projet, créée si besoin (même clé que ranger_chantier).
create or replace function cockpit.section_correctifs(p_projet uuid)
returns uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v uuid;
begin
  select id into v from cockpit.sections where projet_id = p_projet and cle = cockpit.cle_section('Correctifs');
  if v is not null then return v; end if;
  insert into cockpit.sections (projet_id, nom, description, position)
  values (p_projet, 'Correctifs', 'Petits correctifs visuels, de mise en page ou d''ergonomie (rangés tout seuls).',
          coalesce((select max(position) + 1 from cockpit.sections where projet_id = p_projet), 0))
  on conflict (projet_id, cle) do nothing;
  select id into v from cockpit.sections where projet_id = p_projet and cle = cockpit.cle_section('Correctifs');
  return v;
end $$;

-- À la création, toutes voies confondues. security definer : un membre qui
-- crée un chantier depuis l'app n'a pas le droit d'écrire dans sections ; la
-- fonction ne crée que la section « Correctifs » du projet du chantier.
create or replace function cockpit.ranger_correctif_a_la_creation()
returns trigger language plpgsql security definer set search_path = cockpit, pg_temp as $$
begin
  if new.section_id is null and new.doublon_de is null
     and cockpit.est_correctif(new.titre, new.demande, new.origine) then
    new.section_id := cockpit.section_correctifs(new.projet_id);
  end if;
  return new;
end $$;

drop trigger if exists chantiers_ranger_correctif on cockpit.chantiers;
create trigger chantiers_ranger_correctif before insert on cockpit.chantiers
  for each row execute function cockpit.ranger_correctif_a_la_creation();

-- Les chantiers OUVERTS et SANS section d'un projet qui sont des correctifs :
-- rangés. Rend leurs ids (pour le dire). Jamais un chantier déjà rangé.
create or replace function cockpit.ranger_correctifs(p_projet text, p_par text default 'session')
returns setof uuid language plpgsql security definer set search_path = cockpit, pg_temp as $$
declare v_projet uuid;
begin
  perform cockpit.exiger(cockpit.est_service() or cockpit.est_admin(), 'réservé aux admins');
  select id into v_projet from cockpit.projets where slug = p_projet;
  if v_projet is null then raise exception 'projet introuvable'; end if;
  if not exists (select 1 from cockpit.chantiers c
                 where c.projet_id = v_projet and c.section_id is null and c.archived_at is null
                   and c.etat not in ('valide') and cockpit.est_correctif(c.titre, c.demande, c.origine)) then
    return;
  end if;
  perform set_config('cockpit.par', coalesce(p_par, 'session'), true);
  return query
    update cockpit.chantiers c set section_id = cockpit.section_correctifs(v_projet)
     where c.projet_id = v_projet and c.section_id is null and c.archived_at is null
       and c.etat not in ('valide') and cockpit.est_correctif(c.titre, c.demande, c.origine)
    returning c.id;
end $$;

revoke all on function cockpit.section_correctifs(uuid), cockpit.ranger_correctif_a_la_creation(),
                       cockpit.ranger_correctifs(text, text) from public, anon, authenticated;
grant execute on function cockpit.section_correctifs(uuid) to service_role;
grant execute on function cockpit.ranger_correctifs(text, text) to service_role, authenticated;
grant execute on function cockpit.est_correctif(text, text, text), cockpit.texte_normalise(text),
                          cockpit.mots_correctif_visuel(), cockpit.mots_gros_chantier() to service_role, authenticated;
