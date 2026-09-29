#!/usr/bin/env bash
# Greffe sur un dépôt qui n'est pas à Raphaël — VOIE 2 (30 sept. 2026, chantier f31ae3ec).
#
#   scripts/cockpit-greffe.sh --branche-propre <nom> [--base <rev>] [--message "…"]
#       Fait la branche <nom> à partir de HEAD : UN commit sur <base> (défaut :
#       la branche par défaut de origin), même contenu que HEAD MOINS les
#       fichiers du cockpit (scripts/cockpit-*, .claude/hooks/cockpit-*, bloc
#       « Cockpit » du CLAUDE.md, réglages du cockpit dans .claude/settings.json).
#       Ne touche ni à la copie de travail ni à la branche courante. C'est la
#       branche à pousser pour une PR vers leur branche.
#   scripts/cockpit-greffe.sh --traces [<rev>]
#       Les traces du cockpit dans <rev> (défaut HEAD) ; rien = propre.
#
# La règle « ce qui est une trace » est UNE seule : modeles/cockpit-pre-push.sh
# --traces (la même que la garde pre-push).
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GARDE="$ICI/modeles/cockpit-pre-push.sh"
mode=""; nom=""; base=""; message=""; rev="HEAD"
while [ $# -gt 0 ]; do
  case "$1" in
    --branche-propre) mode=propre; nom="${2:-}"; shift 2 ;;
    --traces) mode=traces; [ -n "${2:-}" ] && [ "${2#--}" = "$2" ] && { rev="$2"; shift; }; shift ;;
    --base) base="${2:-}"; shift 2 ;;
    --message) message="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -f "$GARDE" ] || { echo "Règle des traces introuvable : $GARDE" >&2; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Pas dans un dépôt git." >&2; exit 2; }

if [ "$mode" = traces ]; then bash "$GARDE" --traces "$rev"; exit 0; fi
[ "$mode" = propre ] && [ -n "$nom" ] || { echo "Usage : --branche-propre <nom> [--base <rev>] [--message \"…\"] | --traces [<rev>]" >&2; exit 2; }
git check-ref-format --branch "$nom" >/dev/null 2>&1 || { echo "Nom de branche invalide : $nom" >&2; exit 2; }
git show-ref --verify --quiet "refs/heads/$nom" && { echo "La branche $nom existe déjà : choisis un autre nom (rien n'est écrasé)." >&2; exit 2; }
if [ -z "$base" ]; then
  base=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)
  for b in origin/main origin/master; do [ -n "$base" ] && break; git rev-parse -q --verify "$b" >/dev/null && base="$b"; done
fi
[ -n "$base" ] && git rev-parse -q --verify "$base^{commit}" >/dev/null || { echo "Base introuvable (${base:-aucune}) : précise --base <rev>." >&2; exit 2; }
# Squash sur la base : HEAD doit déjà contenir la base, sinon on déferait leur travail récent.
git merge-base --is-ancestor "$base" HEAD || { echo "HEAD ne contient pas $base : fusionne d'abord $base dans ta branche, puis relance." >&2; exit 2; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"
git read-tree HEAD
# 1. Fichiers du cockpit : retirés.
git ls-files -- 'scripts/cockpit-*' '.claude/hooks/cockpit-*' | while read -r f; do git rm -q --cached -- "$f"; done
# Un fichier que la base n'avait pas et que le nettoyage laisse vide : retiré aussi.
remettre() { # chemin, fichier nettoyé
  if [ ! -s "$2" ] || ! grep -q '[^[:space:]]' "$2"; then
    if ! git cat-file -e "$base:$1" 2>/dev/null; then git rm -q --cached -- "$1"; return; fi
  fi
  git update-index --cacheinfo "100644,$(git hash-object -w "$2"),$1"
}
# 2. CLAUDE.md : le bloc « Cockpit » seul (du titre au repère de fin, ou au titre ## suivant).
if git cat-file -e "HEAD:CLAUDE.md" 2>/dev/null && git show HEAD:CLAUDE.md | grep -q '^## Cockpit (rnab26/Cockpit-General)'; then
  git show HEAD:CLAUDE.md | python3 -c '
import re, sys
s = sys.stdin.read()
i = s.index("## Cockpit (rnab26/Cockpit-General)")
j = s.find("<!-- fin du bloc cockpit", i)
if j >= 0:
    j = s.find("\n", j); j = len(s) if j < 0 else j + 1
else:
    m = re.compile(r"^## ", re.M).search(s, i + 5); j = m.start() if m else len(s)
avant, apres = s[:i].rstrip("\n"), s[j:].lstrip("\n")
sys.stdout.write(avant + ("\n\n" if avant and apres else "\n" if avant else "") + apres)
' > "$tmp/CLAUDE.md"
  remettre CLAUDE.md "$tmp/CLAUDE.md"
fi
# 3. .claude/settings.json : env COCKPIT_*, hooks cockpit-*, et la reprise après
#    limite si la base ne l'avait pas.
if git cat-file -e "HEAD:.claude/settings.json" 2>/dev/null; then
  base_a_reprise=$(git show "$base:.claude/settings.json" 2>/dev/null | grep -c autoContinueAtUsageLimit || true)
  git show HEAD:.claude/settings.json | BASE_REPRISE="$base_a_reprise" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
env = d.get("env")
if isinstance(env, dict):
    for k in [k for k in env if k.startswith("COCKPIT_")]: del env[k]
    if not env: del d["env"]
hooks = d.get("hooks")
if isinstance(hooks, dict):
    for ev in list(hooks):
        garde = []
        for h in hooks[ev]:
            hs = [x for x in h.get("hooks", []) if "cockpit-" not in str(x.get("command", ""))]
            if hs: h["hooks"] = hs; garde.append(h)
        if garde: hooks[ev] = garde
        else: del hooks[ev]
    if not hooks: del d["hooks"]
if os.environ.get("BASE_REPRISE", "0") in ("", "0"): d.pop("autoContinueAtUsageLimit", None)
print(json.dumps(d, indent=2, ensure_ascii=False) if d else "")
' > "$tmp/settings.json"
  remettre .claude/settings.json "$tmp/settings.json"
fi
arbre=$(git write-tree)
unset GIT_INDEX_FILE
# Message par défaut : le dernier de SES commits (jamais une mise à jour du cockpit).
[ -n "$message" ] || message="$(git log --format=%s "$base..HEAD" | grep -vi cockpit | head -1 || true)"
[ -n "$message" ] || message="Mise à jour"
commit=$(printf '%s\n' "$message" | git commit-tree "$arbre" -p "$(git rev-parse "$base^{commit}")")
# Vérification AVANT de créer la branche : aucune trace ne doit rester.
reste=$(bash "$GARDE" --traces "$commit")
if [ -n "$reste" ]; then echo "REFUS : des traces du cockpit restent, branche non créée :" >&2; printf '%s\n' "$reste" | sed 's/^/  - /' >&2; exit 1; fi
git branch "$nom" "$commit"
echo "Branche propre : $nom ($(git rev-parse --short "$commit")), 1 commit sur $base, aucune trace du cockpit."
echo "Pousse-la (git push -u origin $nom) et ouvre la PR depuis elle. Ta branche de travail garde le cockpit."
