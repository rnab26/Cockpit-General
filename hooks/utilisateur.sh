#!/usr/bin/env bash
# Hook UTILISATEUR du cockpit : branche tout seul une session ouverte sur PLUSIEURS dépôts (19 oct. 2026).
#
# Raphaël : « j'ai une session FacePro qui tourne et ça ne s'affiche pas dans Ça avance ». Cause PROUVÉE le 13 oct. :
# une session ouverte sur plusieurs dépôts démarre dans /home/user ; les hooks d'un projet (.claude/settings.json du dépôt)
# ne se chargent que si la session démarre DANS ce dépôt. Aucun hook ne tourne : pas d'état dans le contexte, pas de
# session dans l'app, pas de réponses en direct. Seul `scripts/connecter.sh` y remédiait, à la main.
#
# Ce script est déclaré dans les réglages UTILISATEUR de Claude Code (dotfiles .claude/settings.json, voir
# docs/hook-utilisateur.md), qui se chargent quel que soit le dossier de départ. Il :
#   - se tait si la session a déjà les hooks d'un projet (COCKPIT_PROJET posé) : jamais de doublon ;
#   - cherche dans /home/user (et les dossiers ajoutés) UN dépôt branché (.claude/settings.json avec COCKPIT_PROJET) ;
#   - rejoue les hooks que ce dépôt déclare pour l'événement reçu, avec CLAUDE_PROJECT_DIR et COCKPIT_PROJET posés : les
#     MÊMES hooks que dans une session démarrée dans le dépôt (état, session visible, rappels, réponses en direct) ;
#   - plusieurs dépôts branchés : il ne devine pas (une session déclarée dans le mauvais projet est pire que pas
#     déclarée) ; il le dit une fois au démarrage et donne la commande `connecter.sh --projet <slug>`.
#
# Ne fait JAMAIS échouer ni ralentir une session (sortie 0 toujours). Réglage : COCKPIT_UTILISATEUR=off l'éteint.
# Banc : scripts/verifier-utilisateur.mjs.
set -uo pipefail
[ "${COCKPIT_UTILISATEUR:-}" = off ] && exit 0
# La session a déjà les hooks d'un projet (voie normale ou greffe) : on ne double rien.
[ -z "${COCKPIT_PROJET:-}" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
entree=$(cat 2>/dev/null || true)
[ -n "$entree" ] || exit 0
ev=$(printf '%s' "$entree" | jq -r '.hook_event_name // empty' 2>/dev/null)
[ -n "$ev" ] || exit 0

# Un dépôt « branché » : son .claude/settings.json porte env.COCKPIT_PROJET et des hooks.
slug_de() { jq -r '.env.COCKPIT_PROJET // empty' "$1/.claude/settings.json" 2>/dev/null; }
RACINE_SESSION="${CLAUDE_PROJECT_DIR:-$PWD}"
if [ -n "$(slug_de "$RACINE_SESSION")" ]; then exit 0; fi   # démarrée dans un projet branché : ses hooks tournent déjà
candidats=()
for d in "$RACINE_SESSION"/*/ "${COCKPIT_RACINE_DEPOTS:-/home/user}"/*/; do
  d="${d%/}"; [ -d "$d" ] || continue
  case " ${candidats[*]:-} " in *" $d "*) continue ;; esac
  [ -n "$(slug_de "$d")" ] && candidats+=("$d")
done
[ "${#candidats[@]}" -gt 0 ] || exit 0

emettre_contexte() { # texte → additionalContext de l'événement courant
  jq -n --arg t "$1" --arg e "$ev" '{hookSpecificOutput: {hookEventName: $e, additionalContext: $t}}'
}
DEPOT=""
if [ "${#candidats[@]}" -eq 1 ]; then
  DEPOT="${candidats[0]}"
else
  # Plusieurs dépôts branchés (cas réel : l'environnement de Raphaël les clone TOUS, sur des branches claude/…
  # identiques : le disque ne dit pas quel est le sujet). Le choix d'une session est gardé (une fois choisi, il tient)
  # et se fait sur des SIGNES, jamais au hasard : (1) le choix déjà gardé, ou posé par `connecter.sh --projet` ;
  # (2) le dossier courant ou le fichier touché est dans UN dépôt ; (3) le message de Raphaël nomme UN seul projet.
  sid=$(printf '%s' "$entree" | jq -r '.session_id // empty' 2>/dev/null)
  GARDE="${COCKPIT_HOME:-$HOME/.cockpit}/sessions/${sid:-sans-session}.depot"
  if [ -n "$sid" ] && [ -f "$GARDE" ]; then
    d=$(head -n1 "$GARDE"); for c in "${candidats[@]}"; do [ "$c" = "$d" ] && DEPOT="$c"; done
  fi
  if [ -z "$DEPOT" ]; then
    chemins=$(printf '%s' "$entree" | jq -r '[.cwd, .tool_input.file_path, .tool_input.path, .tool_input.notebook_path] | map(select(type == "string")) | .[]' 2>/dev/null)
    trouves=(); for c in "${candidats[@]}"; do
      while IFS= read -r p; do case "$p" in "$c"|"$c"/*) trouves+=("$c"); break ;; esac; done <<<"$chemins"
    done
    if [ "${#trouves[@]}" -eq 0 ] && [ "$ev" = UserPromptSubmit ]; then
      texte=$(printf '%s' "$entree" | jq -r '.prompt // empty' 2>/dev/null | tr 'A-Z' 'a-z')
      for c in "${candidats[@]}"; do
        for mot in "$(slug_de "$c")" "$(basename "$c")"; do
          mot=$(printf '%s' "$mot" | tr 'A-Z' 'a-z'); [ "${#mot}" -ge 4 ] || continue
          if printf '%s' "$texte" | grep -qiE "(^|[^a-z0-9])$(printf '%s' "$mot" | sed 's/[^a-z0-9]/./g')([^a-z0-9]|$)"; then trouves+=("$c"); break; fi
        done
      done
    fi
    [ "${#trouves[@]}" -eq 1 ] && DEPOT="${trouves[0]}"
    if [ -n "$DEPOT" ] && [ -n "$sid" ]; then mkdir -p "$(dirname "$GARDE")" 2>/dev/null && printf '%s\n' "$DEPOT" >"$GARDE" 2>/dev/null; fi
  fi
  if [ -z "$DEPOT" ]; then
    # Pas encore de signe : on le dit UNE fois, au démarrage ; le premier signe (dossier, fichier, nom du projet) branche.
    if [ "$ev" = SessionStart ]; then
      liste=""; conn=""; for d in "${candidats[@]}"; do liste="$liste $(slug_de "$d") ($d);"; [ -f "$d/scripts/connecter.sh" ] && conn="$d/scripts/connecter.sh"; done
      emettre_contexte "Cockpit : session ouverte sur plusieurs dépôts branchés (${liste%;}). Elle se branchera toute seule dès que tu touches un fichier d'un de ces dépôts ou que Raphaël nomme le projet. Si tu sais déjà le projet : bash ${conn:-<Cockpit-General>/scripts/connecter.sh} --projet <slug> --depot <dossier> ; sans cela Raphaël ne la voit pas dans « Ça avance »."
    fi
    exit 0
  fi
fi
PROJET=$(slug_de "$DEPOT")
export CLAUDE_PROJECT_DIR="$DEPOT" COCKPIT_PROJET="$PROJET"
# Les autres variables du réglage du dépôt (env) : comme si la session y était née.
while IFS=$'\t' read -r k v; do [ -n "$k" ] && export "$k=$v"; done < <(jq -r '.env // {} | to_entries[] | [.key, (.value|tostring)] | @tsv' "$DEPOT/.claude/settings.json" 2>/dev/null)

# Les commandes que le dépôt déclare pour cet événement (matcher : * ou vide, sinon regex sur le nom de l'outil).
outil=$(printf '%s' "$entree" | jq -r '.tool_name // empty' 2>/dev/null)
mapfile -t cmds < <(jq -r --arg e "$ev" --arg o "$outil" '
  (.hooks[$e] // [])[] | select((.matcher // "*") as $m | ($m == "*" or $m == "" or ($o | test("^(" + $m + ")$")))) |
  .hooks[]? | select(.type == "command") | [(.timeout // 15 | tostring), .command] | @tsv' "$DEPOT/.claude/settings.json" 2>/dev/null)
[ "${#cmds[@]}" -gt 0 ] || exit 0

ctx=""; bloc=""
for ligne in "${cmds[@]}"; do
  to="${ligne%%$'\t'*}"; cmd="${ligne#*$'\t'}"
  sortie=$(printf '%s' "$entree" | timeout "$to" bash -c "$cmd" 2>/dev/null || true)
  [ -n "$sortie" ] || continue
  c=$(printf '%s' "$sortie" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
  [ -z "$c" ] || ctx="${ctx:+$ctx

}$c"
  if [ -z "$bloc" ] && [ "$(printf '%s' "$sortie" | jq -r '.decision // empty' 2>/dev/null)" = block ]; then bloc="$sortie"; fi
done
if [ -n "$bloc" ]; then printf '%s\n' "$bloc"; exit 0; fi
[ -z "$ctx" ] || emettre_contexte "$ctx"
exit 0
