#!/usr/bin/env bash
# Signaler la progression EN DIRECT d'une session sur un chantier — et la voir
# tout de suite, ici même, sous la forme des barres que Raphaël demande.
#
#   scripts/progression.sh --chantier "Écran central" --etape "Bacs et cartes" --pct 40 --eta 25m
#   scripts/progression.sh --chantier 6f2c… --etape "Build vert, parcours navigateur" --pct 90
#   scripts/progression.sh --chantier "Écran central" --termine "Livré" \
#       --verifier "1. Ouvre le cockpit, projet X. 2. Touche « … ». 3. Tu dois voir …"
#   scripts/progression.sh --chantier "Écran central" --echec "Le build casse sur X"
#   scripts/progression.sh                       # affiche seulement le tableau du projet
#
# POURQUOI (décision D-07, 28 sept. 2026). Raphaël : « un suivi en live par
# tâche avec l'action en cours, une barre de progression et le temps estimé »,
# « exactement la même chose dans la session concernée, c'est le plus fiable,
# sans que j'aie à demander un visuel de progression comme je le fais souvent
# sur FacePro ». Ce script est ce visuel : une ligne dans `cockpit.activite`
# (ce que l'app dessine, en temps réel), et le même tableau imprimé dans la
# session, à chaque appel. Une session l'appelle à chaque étape notable —
# pas à chaque message — et TOUJOURS en terminant (--termine ou --echec) :
# une barre figée à 60 % depuis deux heures est pire que pas de barre.
#
# ÉTAPES DE MISE EN LIGNE (Raphaël, 29 sept. : « j'ai du mal à savoir si c'est
# en ligne […] comme un enfant ») — pose-les au moment où elles arrivent :
#   --jalon code                          le code est écrit et testé chez toi
#   --jalon pousse   --detail <commit>    envoyé sur GitHub (branche ou main)
#   --jalon ci-ok | ci-ko                 les vérifications automatiques de GitHub
#   --jalon en-ligne --detail <adresse>   la version EN LIGNE sert ce code (vérifié)
#   --jalon pas-en-ligne --detail <raison> rien à mettre en ligne, ou il faut un
#                                          geste de Raphaël (installer l'APK…)
# --termine exige « en-ligne » ou « pas-en-ligne » (déjà posé, ou donné sur la
# même ligne avec --en-ligne "<adresse>" / --pas-en-ligne "<raison>").
#
# --verifier est OBLIGATOIRE avec --termine (Raphaël, 28 sept. 2026 : « le nom
# du chantier, des fois on n'est pas sûr à 100 % de ce qu'on doit vérifier »).
# Écris-le pour lui, sans jargon, en étapes numérotées : où aller (lien ou
# écran), quoi faire (le geste exact), ce qu'il doit voir si ça marche. Il
# s'affiche en tête de la carte orange « à vérifier », dans l'app et le module.
#
# --eta : durée restante estimée (« 25m », « 1h30 », « 90s »), seulement si tu
# la connais vraiment ; sinon omets-la, l'app affiche « durée inconnue ».
# Jamais 0 pour dire « je ne sais pas ».
#
# AGENTS (29 sept. 2026, Raphaël : « j'ai cinq agents, c'est illisible, pas
# possible de voir leur progression ni combien de temps il reste ») : un agent
# lancé par une session signale SA ligne, sans toucher à celle de la session :
#   scripts/progression.sh --agent "<description exacte donnée à son lancement>" \
#       --chantier <id> --etape "Mesure des 12 clips" --pct 40 --eta 10m
#   scripts/progression.sh --agent "<même description>" --termine "Fini : …"
# La tâche elle-même (qu'elle existe, depuis quand elle tourne) est déjà suivie
# toute seule par le hook de suivi ; ceci n'ajoute que ce qui ne se devine pas.
#
# --chantier accepte l'id, ou un morceau du titre (unique dans le projet).
# Le projet vient de COCKPIT_PROJET (posé par brancher.sh dans
# .claude/settings.json → env), ou de --projet. La session est le nom de la
# branche git (ce que Raphaël voit dans « Prise par … »).

set -euo pipefail
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL="$RACINE/scripts/sql.sh"

projet="${COCKPIT_PROJET:-}"
chantier=""; etape=""; pct=""; eta=""; statut="en_cours"; detail=""; verifier=""; jalon=""; en_ligne=""; pas_en_ligne=""; agent=""
session="${COCKPIT_SESSION:-$(git -C "$PWD" symbolic-ref --short -q HEAD 2>/dev/null || echo session)}"

while [ $# -gt 0 ]; do
  case "$1" in
    --projet)   projet="${2:-}"; shift 2 ;;
    --chantier) chantier="${2:-}"; shift 2 ;;
    --etape)    etape="${2:-}"; shift 2 ;;
    --pct)      pct="${2:-}"; shift 2 ;;
    --eta)      eta="${2:-}"; shift 2 ;;
    --detail)   detail="${2:-}"; shift 2 ;;
    --verifier) verifier="${2:-}"; shift 2 ;;
    --jalon)    jalon="${2:-}"; shift 2 ;;
    --en-ligne) en_ligne="${2:-}"; shift 2 ;;
    --pas-en-ligne) pas_en_ligne="${2:-}"; shift 2 ;;
    --session)  session="${2:-}"; shift 2 ;;
    --agent)    agent="${2:-}"; shift 2 ;;
    --attente)  statut="attente"; etape="${2:-$etape}"; shift 2 ;;
    --termine)  statut="termine"; etape="${2:-Terminé}"; pct=100; shift 2 ;;
    --echec)    statut="echec"; etape="${2:-Échec}"; shift 2 ;;
    -h|--help)  sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done

if [ "$statut" = "termine" ] && [ -n "$chantier" ] && [ -z "$agent" ] && [ -z "${verifier//[[:space:]]/}" ]; then
  echo "--verifier manque : dis à Raphaël comment vérifier (où aller, quoi faire, ce qu'il doit voir), en étapes numérotées." >&2
  exit 2
fi

if [ -z "$projet" ]; then
  echo "Projet inconnu : pose COCKPIT_PROJET (brancher.sh le fait) ou passe --projet <slug>." >&2
  exit 2
fi

# « 25m », « 1h30 », « 90s », « 2h » → secondes. Vide → null.
eta_secondes="null"
if [ -n "$eta" ]; then
  eta_secondes=$(python3 - "$eta" <<'PY'
import re, sys
s = sys.argv[1].strip().lower().replace(' ', '')
m = re.fullmatch(r'(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s)?', s)
if not m or not any(m.groups()):
    m2 = re.fullmatch(r'(\d+)', s)
    if not m2: sys.exit("eta illisible : " + s)
    print(int(m2.group(1)) * 60); sys.exit(0)
h, mn, sec = (int(x) if x else 0 for x in m.groups())
print(h * 3600 + mn * 60 + sec)
PY
  )
fi

q() { printf '%s' "$1" | sed "s/'/''/g"; }

if [ -n "$agent" ]; then
  [ -n "$etape" ] || { echo "--etape manque (ou --termine / --echec)." >&2; exit 2; }
  cid_sql="null"
  if [ -n "$chantier" ]; then
    cid=$("$SQL" "select c.id from chantiers c join projets p on p.id = c.projet_id where p.slug = '$(q "$projet")' and (c.id::text = '$(q "$chantier")' or (length('$(q "$chantier")') >= 8 and c.id::text like '$(q "$chantier")' || '%') or c.titre ilike '%' || '$(q "$chantier")' || '%') order by (c.id::text = '$(q "$chantier")') desc, c.archived_at nulls first limit 1" | jq -r '.rows[0].id // empty')
    [ -n "$cid" ] && cid_sql="'$cid'::uuid"
  fi
  pct_sql="null"; [ -n "$pct" ] && pct_sql="$pct"
  r=$("$SQL" "select progression_tache('$(q "$projet")', '$(q "$agent")', '$(q "$etape")', $pct_sql, $eta_secondes, $cid_sql, '$statut', $( [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && echo "'$(q "$CLAUDE_CODE_SESSION_ID")'" || echo null )) as id" | jq -r '.rows[0].id // empty')
  if [ -z "$r" ] || [ "$r" = "null" ]; then
    echo "Aucune tâche « $agent » dans le projet $projet (pas encore vue par le hook de suivi ?). Ta ligne n'a pas été écrite ; réessaie à la prochaine étape." >&2; exit 1
  fi
  echo "Agent « $agent » : ${etape}${pct:+ — $pct %}${eta:+ — reste ~$eta}"
  exit 0
fi

if [ -n "$chantier" ]; then
  if [ -z "$etape" ] && [ -z "$jalon" ] && [ -z "$en_ligne" ] && [ -z "$pas_en_ligne" ]; then echo "--etape manque (ou --jalon, --termine / --echec / --attente)." >&2; exit 2; fi
  # Résolution du chantier : id exact, sinon morceau de titre UNIQUE.
  resol=$("$SQL" "select c.id, c.titre from chantiers c join projets p on p.id = c.projet_id where p.slug = '$(q "$projet")' and c.archived_at is null and (c.id::text = '$(q "$chantier")' or (length('$(q "$chantier")') >= 8 and c.id::text like '$(q "$chantier")' || '%') or c.titre ilike '%' || '$(q "$chantier")' || '%') order by (c.id::text = '$(q "$chantier")') desc limit 3" | jq -c '.rows // []')
  n=$(printf '%s' "$resol" | jq 'length')
  if [ "$n" -eq 0 ]; then echo "Aucun chantier ne correspond à « $chantier » dans le projet $projet." >&2; exit 1; fi
  if [ "$n" -gt 1 ] && [ "$(printf '%s' "$resol" | jq -r '.[0].id')" != "$chantier" ]; then
    echo "Plusieurs chantiers correspondent, précise :" >&2; printf '%s' "$resol" | jq -r '.[] | "  \(.id)  \(.titre)"' >&2; exit 1
  fi
  id=$(printf '%s' "$resol" | jq -r '.[0].id')
  # Jalons de mise en ligne (fonction cockpit.poser_jalon).
  poser() { "$SQL" "select poser_jalon('$id'::uuid, '$1', $( [ -n "${2:-}" ] && echo "'$(q "$2")'" || echo null ))" >/dev/null; }
  if [ -n "$jalon" ]; then
    case "$jalon" in code|pousse|ci-ok|ci-ko|en-ligne|pas-en-ligne) poser "${jalon//-/_}" "$detail" ;;
      *) echo "--jalon inconnu : $jalon (code, pousse, ci-ok, ci-ko, en-ligne, pas-en-ligne)" >&2; exit 2 ;; esac
  fi
  [ -n "$en_ligne" ] && poser en_ligne "$en_ligne"
  [ -n "$pas_en_ligne" ] && poser pas_en_ligne "$pas_en_ligne"
  if [ "$statut" = "termine" ]; then
    j=$("$SQL" "select (jalons ? 'en_ligne' or jalons ? 'pas_en_ligne') as ok from chantiers where id = '$id'" | jq -r '.rows[0].ok')
    if [ "$j" != "true" ]; then
      echo "Avant --termine : dis si c'est EN LIGNE (--en-ligne \"<adresse vérifiée>\") ou pourquoi ça ne l'est pas (--pas-en-ligne \"<raison>\"). Raphaël ne peut vérifier que ce qui est en ligne." >&2
      exit 2
    fi
  fi
  if [ -z "$etape" ]; then
    case "$jalon" in code) etape="Code écrit et testé" ;; pousse) etape="Envoyé sur GitHub" ;; ci-ok) etape="Vérifications automatiques réussies" ;;
      ci-ko) etape="Vérifications automatiques en échec, correction en cours" ;; en-ligne) etape="En ligne" ;; pas-en-ligne) etape="Rien à mettre en ligne : ${detail}" ;; *) etape="Étape de mise en ligne" ;; esac
  fi
  pct_sql="null"; [ -n "$pct" ] && pct_sql="$pct"
  detail_sql="null"; [ -n "$detail" ] && detail_sql="'$(q "$detail")'"
  "$SQL" "select pourcentage, statut from signaler_activite('$(q "$projet")', '$id'::uuid, '$(q "$session")', '$(q "$etape")', $pct_sql, $eta_secondes, '$statut', $detail_sql)" >/dev/null
  # Une session qui termine ou échoue rend aussi le chantier lisible dans la colonne etat.
  if [ "$statut" = "termine" ]; then
    "$SQL" "update chantiers set etat = case when etat in ('en_cours','libre','a_trier') then 'a_verifier' else etat end, comment_verifier = '$(q "$verifier")', pris_par = null, pris_jusqu_a = null where id = '$id'" >/dev/null
  fi
fi

# Le tableau, comme le visuel FacePro : une ligne par chantier actif du projet.
"$SQL" "select c.titre, c.etat, a.etape, a.pourcentage, a.eta_secondes, a.statut, a.session, extract(epoch from now() - a.updated_at)::int as age from chantiers c join projets p on p.id = c.projet_id left join lateral (select * from activite a where a.chantier_id = c.id order by updated_at desc limit 1) a on true where p.slug = '$(q "$projet")' and c.archived_at is null and (a.id is not null or c.etat in ('en_cours','a_verifier','bloque')) order by (a.statut = 'en_cours') desc nulls last, a.updated_at desc nulls last, c.created_at" \
| python3 "$RACINE/scripts/progression_tableau.py" "$projet"

# Qui travaille : les sessions du projet et leurs agents / commandes en arrière-plan.
"$SQL" "select coalesce(se.sujet, se.branche, left(se.id, 8)) as session, t.type, t.description, t.sorte, t.statut, t.etape, t.pourcentage, t.eta_secondes, extract(epoch from now() - t.demarre_at)::int as ecoule, extract(epoch from now() - t.progres_at)::int as progres, extract(epoch from now() - t.fini_at)::int as depuis_fin from taches t join sessions se on se.id = t.session_id join projets p on p.id = t.projet_id where p.slug = '$(q "$projet")' and ((t.statut = 'en_cours' and t.vu_at > now() - interval '12 hours') or t.fini_at > now() - interval '10 minutes') order by se.vu_at desc, t.statut = 'en_cours' desc, t.demarre_at" \
| python3 "$RACINE/scripts/progression_tableau.py" "$projet" --taches
