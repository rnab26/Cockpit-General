#!/usr/bin/env bash
# Une PR à fusionner = UNE carte « À toi » avec le lien exact et les 2 gestes.
#
#   scripts/pr-a-fusionner.sh <n> [--titre "…"] [--projet <slug>]   pose la carte (ou rien si elle existe)
#   scripts/pr-a-fusionner.sh <n> --fermee                          retire la carte (PR fusionnée ou fermée)
#   scripts/pr-a-fusionner.sh <n> --etat open|closed|merged         l'état est donné (tests, ou déjà connu de l'appelant)
#   scripts/pr-a-fusionner.sh <n> --merge-state clean|dirty|… [--ci ok|echec|cours]   propreté donnée (tests)
#
# Raphaël (30 sept. 2026) : « je n'ai aucune notification dans le cockpit pour
# savoir quand merger quelque chose ». Une seule règle, pour tous les projets :
#  - clé = numéro de PR : la question commence par « Fusionne la PR #<n> : » ;
#    appeler deux fois ne pose qu'UNE carte, et une carte déjà répondue par
#    Raphaël n'est pas reposée ;
#  - la carte disparaît (répondue « PR fusionnée ou fermée ») quand la PR l'est ;
#  - sans --etat, l'état vient de l'API GitHub (GITHUB_TOKEN si dépôt privé) ;
#    état inconnu : on pose (l'appelant vient d'ouvrir la PR), on ne retire rien.
#  - PROPRE SEULEMENT (30 sept. 2026, chantier 6ef35b6e ; Raphaël : « à chaque fois
#    il y a des conflits […] envoie-moi les PR une fois les conflits réglés ») :
#    la carte n'est posée que si GitHub dit mergeable_state = clean (ou unstable /
#    blocked SANS échec ni CI en cours). Conflit (dirty), en retard sur main
#    (behind), brouillon, CI en échec ou en cours, calcul en cours (unknown) :
#    pas de carte, le script dit pourquoi (sortie « PAS PRÊTE : … », code 0) ; une
#    carte déjà posée pour une PR devenue non propre est retirée (réponse « PR #n
#    pas prête », qui n'empêche pas de la reposer quand la PR redevient propre).
#    Propreté inconnue (API injoignable) : on pose, comme pour l'état.
# Appelé par : tout agent qui ouvre une PR (consignes de chef.sh / renfort.sh),
# et la passe de chef.sh, qui réconcilie avec la liste des PR ouvertes.
set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"; DEM="$RACINE/scripts/demander.sh"   # chemins absolus : marche aussi depuis le cache d'un projet branché
q() { printf '%s' "$1" | sed "s/'/''/g"; }

projet="${COCKPIT_PROJET:-}"; n=""; fermee=0; etat=""; titre=""; mstate=""; ci=""
while [ $# -gt 0 ]; do
  case "$1" in
    --projet) projet="${2:-}"; shift 2 ;;
    --titre)  titre="${2:-}"; shift 2 ;;
    --etat)   etat="${2:-}"; shift 2 ;;
    --fermee) fermee=1; shift ;;
    --merge-state) mstate="${2:-}"; shift 2 ;;
    --ci)     ci="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,31p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "Argument inconnu : $1" >&2; exit 2 ;;
    *) n="$1"; shift ;;
  esac
done
[[ "$n" =~ ^[0-9]+$ ]] || { echo "Usage : $0 <numéro de PR> [--fermee] [--etat open|closed|merged] [--titre \"…\"]" >&2; exit 2; }
case "$etat" in ""|open|closed|merged) ;; *) echo "--etat : open, closed ou merged." >&2; exit 2 ;; esac
case "$ci" in ""|ok|echec|cours) ;; *) echo "--ci : ok, echec ou cours." >&2; exit 2 ;; esac
[ -n "$projet" ] || { echo "Projet inconnu : COCKPIT_PROJET ou --projet <slug>." >&2; exit 2; }

ligne=$("$SQL" "select id, depot from projets where slug = '$(q "$projet")'" | jq -c '.rows[0] // empty')
[ -n "$ligne" ] || { echo "Projet « $projet » inconnu en base." >&2; exit 1; }
pid=$(printf '%s' "$ligne" | jq -r '.id'); depot=$(printf '%s' "$ligne" | jq -r '.depot // empty')
[ -n "$depot" ] || { echo "Le projet « $projet » n'a pas de dépôt en base : lien de PR impossible." >&2; exit 1; }

[ "$fermee" = "1" ] && etat="closed"
auth=(); [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
info="{}"
if [ -z "$etat" ] || { [ -z "$mstate" ] && [ "$fermee" != "1" ] && [ "$etat" = "open" ]; }; then   # l'état réel, un appel léger (échec = inconnu)
  info=$(curl -fsS --max-time 10 ${auth[@]+"${auth[@]}"} -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$depot/pulls/$n" 2>/dev/null || echo "{}")
  if [ -z "$etat" ]; then
    if [ "$(printf '%s' "$info" | jq -r '.merged // false')" = "true" ]; then etat=merged
    else etat=$(printf '%s' "$info" | jq -r '.state // ""'); fi
  fi
  [ -n "$titre" ] || titre=$(printf '%s' "$info" | jq -r '.title // ""')
  [ -n "$mstate" ] || mstate=$(printf '%s' "$info" | jq -r 'if .draft == true then "draft" else (.mergeable_state // "") end')
fi

cle="Fusionne la PR #$n :"; pre="PR #$n pas prête"
existe=$("$SQL" "select count(*) filter (where answered_at is null) as ouvertes, count(*) filter (where reponse is null or reponse not like '$(q "$pre")%') as toutes from messages where projet_id = '$pid' and kind = 'action' and left(corps, ${#cle}) = '$(q "$cle")'" | jq -c '.rows[0]')
ouvertes=$(printf '%s' "$existe" | jq -r '.ouvertes'); toutes=$(printf '%s' "$existe" | jq -r '.toutes')

if [ "$etat" = "closed" ] || [ "$etat" = "merged" ]; then
  if [ "$ouvertes" != "0" ]; then
    "$SQL" "update messages set answered_at = now(), reponse = 'PR #$n fusionnée ou fermée : carte retirée.' where projet_id = '$pid' and kind = 'action' and answered_at is null and left(corps, ${#cle}) = '$(q "$cle")'" >/dev/null \
      || { echo "La base a refusé le retrait de la carte PR #$n." >&2; exit 1; }
    echo "Carte PR #$n retirée (PR $etat)."
  else echo "PR #$n $etat : aucune carte à retirer."; fi
  exit 0
fi

# Propreté : que dit GitHub ? (ci : ok|echec|cours, donné ou lu sur les vérifications du dernier commit)
pas_prete=""
if [ "$etat" = "open" ] || [ -z "$etat" ]; then
  case "$mstate" in
    dirty)   pas_prete="en conflit avec main : un agent doit fusionner main dans la branche" ;;
    behind)  pas_prete="en retard sur main : à mettre à jour (merge de main) avant" ;;
    draft)   pas_prete="brouillon" ;;
    unknown) pas_prete="GitHub calcule encore l'état de la PR : réessayer dans une minute" ;;
    clean|"") ;;
    *)  # unstable, blocked, has_hooks… : seule la CI tranche
      if [ -z "$ci" ]; then
        sha=$(printf '%s' "$info" | jq -r '.head.sha // empty')
        if [ -n "$sha" ]; then
          runs=$(curl -fsS --max-time 10 ${auth[@]+"${auth[@]}"} -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$depot/commits/$sha/check-runs?per_page=100" 2>/dev/null || echo "")
          if [ -n "$runs" ]; then
            if [ "$(printf '%s' "$runs" | jq '[.check_runs[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled")] | length')" != "0" ]; then ci=echec
            elif [ "$(printf '%s' "$runs" | jq '[.check_runs[] | select(.status != "completed")] | length')" != "0" ]; then ci=cours
            else ci=ok; fi
          fi
        fi
      fi
      case "$ci" in
        echec) pas_prete="CI en échec" ;;
        cours) pas_prete="CI en cours" ;;
      esac ;;
  esac
fi
if [ -n "$pas_prete" ]; then
  if [ "$ouvertes" != "0" ]; then
    "$SQL" "update messages set answered_at = now(), reponse = 'PR #$n pas prête ($(q "$pas_prete")) : carte retirée, elle reviendra quand la PR sera propre.' where projet_id = '$pid' and kind = 'action' and answered_at is null and left(corps, ${#cle}) = '$(q "$cle")'" >/dev/null \
      || { echo "La base a refusé le retrait de la carte PR #$n." >&2; exit 1; }
    echo "PAS PRÊTE : PR #$n $pas_prete. Carte retirée."
  else echo "PAS PRÊTE : PR #$n $pas_prete. Pas de carte."; fi
  exit 0
fi

if [ "$toutes" != "0" ]; then echo "PR #$n : carte déjà posée ($ouvertes ouverte, $toutes au total), rien à faire."; exit 0; fi

question="$cle ${titre:-prête à valider}"
[ ${#question} -le 140 ] || question="${question:0:137}..."
COCKPIT_PROJET="$projet" "$DEM" --action --question "$question" \
  --pourquoi "La plateforme refuse la fusion par une session : seul ton toucher la fait. Le travail est fini et vérifié." \
  --lien "https://github.com/$depot/pull/$n|Ouvrir la PR #$n" \
  --etape "Touche « Merge pull request »" \
  --etape "Touche « Confirm merge »" >/dev/null || { echo "La carte de la PR #$n n'a pas pu être posée." >&2; exit 1; }
echo "Carte PR #$n posée dans « À toi »."
