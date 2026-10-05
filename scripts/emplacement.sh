#!/usr/bin/env bash
# Où le cockpit d'un projet apparaît, et qui l'utilise : questionnaire en cartes
# AVANT de coller quoi que ce soit dans un site (chantier dec7fb3c, 5 oct. 2026).
#
#   scripts/emplacement.sh --projet <slug> [--dossier <repo>] [--site https://…]
#       analyse le dépôt (scripts/analyser-depot.py, lecture seule), range
#       l'analyse en base et pose DEUX cartes dans « À toi » avec un aperçu image :
#       1. où il apparaît (bouton dans le menu · page à part · appli Chrome),
#       2. qui peut s'en servir (admins du site · utilisateurs connectés · lien).
#       Les choix proposés dépendent du projet ; la recommandation est marquée.
#       Relancé, il ne repose rien tant qu'une carte attend ou que c'est tranché.
#   scripts/emplacement.sh --projet <slug> --lire
#       range les réponses reçues (projets.emplacement / emplacement_acces).
#   scripts/emplacement.sh --projet <slug> --balise [--gabarit "#id du lien du menu"]
#       écrit la balise à coller, adaptée au choix (refuse tant que ce n'est pas tranché).
#   scripts/emplacement.sh --projet <slug> --etat
set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"
[ -x "$SQL" ] || SQL="$RACINE/scripts/cockpit-sql.sh"
slug="${COCKPIT_PROJET:-}"; dossier="$PWD"; site=""; mode="poser"; declencheur=""
while [ $# -gt 0 ]; do
  case "$1" in
    --projet) slug="${2:-}"; shift 2 ;;
    --dossier) dossier="${2:-}"; shift 2 ;;
    --site) site="${2:-}"; shift 2 ;;
    --lire) mode="lire"; shift ;;
    --balise) mode="balise"; shift ;;
    --etat) mode="etat"; shift ;;
    --gabarit) declencheur="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$slug" ] || { echo "--projet <slug> manque." >&2; exit 2; }
q() { printf '%s' "$1" | sed "s/'/''/g"; }
ligne=$("$SQL" "select nom, coalesce(url_site,'') as url_site, cle_embed, coalesce(emplacement->>'mode','') as mode, coalesce(emplacement->>'acces','') as acces from projets where slug = '$(q "$slug")'" | jq -c '.rows[0] // empty')
[ -n "$ligne" ] || { echo "Projet « $slug » inconnu en base." >&2; exit 1; }
nom=$(jq -r '.nom' <<<"$ligne"); empl=$(jq -r '.mode' <<<"$ligne"); acces=$(jq -r '.acces' <<<"$ligne"); cle=$(jq -r '.cle_embed' <<<"$ligne")
[ -n "$site" ] || site=$(jq -r '.url_site' <<<"$ligne")

# Libellés des choix : UN endroit, lu par la pose des cartes ET par la lecture des réponses.
# Les valeurs (menu/page/appli, moi/equipe/utilisateurs) sont celles de cockpit.emplacement_valide (0049).
lib_empl() { case "$1" in menu) echo "Bouton dans le menu du site" ;; page) echo "Page à part, avec un lien" ;; appli) echo "App Chrome, rien dans le site" ;; esac; }
lib_acces() { case "$1" in moi) echo "Moi seul" ;; equipe) echo "L'équipe du projet" ;; utilisateurs) echo "Tous les utilisateurs du site" ;; esac; }

en_attente() { # nombre de questions sans réponse dont le texte commence par $1
  "$SQL" "select count(*) as n from messages m join projets p on p.id = m.projet_id where p.slug = '$(q "$slug")' and m.kind = 'question' and m.reponse is null and m.corps like '$(q "$1")%'" | jq -r '.rows[0].n'
}
reponse_a() { # $1 début de la question, $2.. libellés possibles -> valeur répondue (la plus récente)
  "$SQL" "select reponse from messages m join projets p on p.id = m.projet_id where p.slug = '$(q "$slug")' and m.kind = 'question' and m.corps like '$(q "$1")%' and m.reponse is not null order by m.answered_at desc nulls last limit 1" | jq -r '.rows[0].reponse // ""'
}

# Range les réponses reçues : les DEUX sont nécessaires (regler_emplacement les valide ensemble).
lire() {
  local r e a ve="" va=""
  r=$(reponse_a 'Où le cockpit de')
  for e in menu page appli; do [ "$r" = "$(lib_empl $e)" ] && ve=$e; done
  r=$(reponse_a 'Qui peut utiliser le cockpit de')
  for a in moi equipe utilisateurs; do [ "$r" = "$(lib_acces $a)" ] && va=$a; done
  [ -n "$ve" ] || ve=$empl; [ -n "$va" ] || va=$acces
  if [ -n "$ve" ] && [ -n "$va" ]; then
    if [ "$ve" != "$empl" ] || [ "$va" != "$acces" ]; then
      "$SQL" "select regler_emplacement('$(q "$slug")', jsonb_build_object('mode','$ve','acces','$va'))" >/dev/null || { echo "La base a refusé cette combinaison ($ve / $va)." >&2; return 1; }
      empl=$ve; acces=$va; echo "rangé : emplacement=$ve accès=$va"
    fi
  else echo "pas encore tout répondu (emplacement ${ve:-?}, accès ${va:-?})"; fi
}

case "$mode" in
etat)
  echo "Projet $slug : emplacement=${empl:-(pas choisi)} accès=${acces:-(pas choisi)} ; cartes en attente : $(en_attente 'Où le cockpit de') + $(en_attente 'Qui peut utiliser le cockpit de')"
  exit 0 ;;
lire) lire; exit 0 ;;
balise)
  lire >/dev/null || true
  if [ -z "$empl" ] || [ -z "$acces" ]; then
    echo "Pas encore tranché (emplacement « ${empl:-?} », accès « ${acces:-?} ») : réponds aux cartes « À toi », puis relance. Rien à coller pour l'instant." >&2; exit 4
  fi
  src='<script src="https://rnab26.github.io/Cockpit-General/embed/cockpit-embed.js" data-cle="'"$cle"'" data-utilisateur="Prénom"'
  case "$empl" in
    menu) if [ -n "$declencheur" ]; then ouv=" data-mode=\"bouton\" data-declencheur=\"$declencheur\""; else ouv=' data-mode="bouton" data-libelle="Cockpit"'; fi
          echo "Emplacement : bouton dans le menu. Colle ceci dans le gabarit commun du site (juste avant </body>) :"
          echo "  $src$ouv></script>"
          [ -n "$declencheur" ] || echo "Pour ouvrir le cockpit depuis un lien PRÉCIS du menu, relance avec --gabarit \"#id-du-lien\" ; sinon un bouton flottant « Cockpit » est posé." ;;
    page) echo "Emplacement : page à part. Crée une page « /cockpit » (hors du menu) et mets-y :"
          echo "  $src data-mode=\"page\"></script>" ;;
    appli) echo "Emplacement : app Chrome. RIEN à coller dans le site : ouvre https://rnab26.github.io/Cockpit-General/ puis « Installer l'appli » (menu ⋮ de Chrome)." ;;
  esac
  case "$acces" in
    moi) echo "Accès : toi seul. Mets la balise dans une zone que toi seul vois (compte admin), ou n'utilise que l'app." ;;
    equipe) echo "Accès : l'équipe. Mets la balise dans une zone réservée aux membres (compte du site), et ajoute-les dans Réglages du projet › Membres pour l'app." ;;
    utilisateurs) echo "Accès : tous les utilisateurs du site. Mets la balise dans une zone qui exige d'être connecté et passe leur prénom dans data-utilisateur." ;;
  esac
  exit 0 ;;
esac

# --- poser le questionnaire ---
lire >/dev/null || true
if [ -n "$empl" ] && [ -n "$acces" ]; then echo "Déjà tranché : emplacement=$empl accès=$acces. Rien à poser. (--balise pour la balise.)"; exit 0; fi
# Une carte n'est posée que si elle n'a ni réponse en attente de rangement, ni question déjà ouverte.
pose_e=1; pose_a=1
[ -z "$empl" ] || pose_e=0; [ "$(en_attente 'Où le cockpit de')" -eq 0 ] || pose_e=0; [ -z "$(reponse_a 'Où le cockpit de')" ] || pose_e=0
[ -z "$acces" ] || pose_a=0; [ "$(en_attente 'Qui peut utiliser le cockpit de')" -eq 0 ] || pose_a=0; [ -z "$(reponse_a 'Qui peut utiliser le cockpit de')" ] || pose_a=0
if [ "$pose_e" = 0 ] && [ "$pose_a" = 0 ]; then echo "Le questionnaire attend déjà ta réponse dans « À toi » : rien reposé."; exit 0; fi

an=$(python3 "$RACINE/scripts/analyser-depot.py" "$dossier" ${site:+--site "$site"})
reco=$(jq -r '.recommande' <<<"$an"); reco_a=$(jq -r '.acces_recommande' <<<"$an")
echo "Analyse : $(jq -r '.type' <<<"$an"), stack : $(jq -r '.stack | join(", ")' <<<"$an"), recommandé : $reco / $reco_a"
jq -r '.limites[]? | "  limite : " + .' <<<"$an"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
imgs=(); optsE=()
if [ "$pose_e" = 1 ]; then
  for o in $(jq -r '.options[]' <<<"$an"); do
    if node "$RACINE/scripts/apercu-emplacement.mjs" "$o" "$tmp/$o.png" "$nom" >/dev/null 2>&1; then imgs+=(--image "$tmp/$o.png"); else echo "(aperçu $o non généré, carte posée sans)" >&2; fi
    aide=$(jq -r --arg o "$o" '.raisons[$o]' <<<"$an"); [ ${#aide} -le 135 ] || aide="${aide:0:132}..."
    marque=""; [ "$o" != "$reco" ] || marque="|recommande"
    optsE+=(--option "$(lib_empl "$o")|$aide$marque")
  done
  COCKPIT_PROJET="$slug" "$RACINE/scripts/demander.sh" "${imgs[@]}" "${optsE[@]}" \
    --question "Où le cockpit de $nom doit-il apparaître ?" \
    --pourquoi "Rien n'est collé dans ton site avant ta réponse. Les choix viennent de l'analyse du projet ; les aperçus montrent le résultat."
fi
if [ "$pose_a" = 1 ]; then
  optsA=()
  for a in $(jq -r '.acces_possibles[]' <<<"$an"); do
    case "$a" in
      moi) aide="Toi seul le vois : zone admin du site, ou l'app seulement." ;;
      equipe) aide="Les membres du projet (compte du site, et Réglages du projet › Membres pour l'app)." ;;
      utilisateurs) aide="Toute personne connectée au site le voit et peut écrire ses demandes (pas avec l'app)." ;;
    esac
    marque=""; [ "$a" != "$reco_a" ] || marque="|recommande"
    optsA+=(--option "$(lib_acces "$a")|$aide$marque")
  done
  COCKPIT_PROJET="$slug" "$RACINE/scripts/demander.sh" "${optsA[@]}" \
    --question "Qui peut utiliser le cockpit de $nom ?" \
    --pourquoi "Le cockpit montre les demandes et corrections du projet : il vaut mieux décider qui les voit avant de le mettre en ligne."
fi
echo "Questionnaire posé dans « À toi ». Après ta réponse : scripts/emplacement.sh --projet $slug --balise"
