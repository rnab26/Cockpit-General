#!/usr/bin/env bash
# Brancher le cockpit sur un projet, en une commande, quel que soit son stack.
#
#   /chemin/vers/cockpit/scripts/brancher.sh --projet facepro --nom "FacePro" \
#       --depot rnab26/Facepro --dossier /home/user/Facepro
#
# Ce que ça fait (idempotent, relançable) :
#   1. crée le projet en base s'il n'existe pas (schéma cockpit, table projets) ;
#   2. copie dans <dossier>/scripts : sql.sh, demander.sh, progression.sh (+ tableau) ;
#      si le projet a DÉJÀ un scripts/sql.sh (Jarvis, Trieur, FacePro, Mélissa),
#      il est conservé et le nôtre s'appelle cockpit-sql.sh — les autres scripts
#      s'appuient alors dessus ;
#   3. copie le hook de démarrage dans <dossier>/.claude/hooks/cockpit-session-start.sh
#      et le déclare dans <dossier>/.claude/settings.json (SessionStart + env COCKPIT_PROJET) ;
#   4. ajoute le bloc « Cockpit » au CLAUDE.md du projet s'il n'y est pas ;
#   5. imprime la balise <script> du module embarqué (avec la clé du projet) à
#      coller dans le site, et ce qu'il reste à faire (rien côté secrets si
#      SUPABASE_SERVICE_ROLE_KEY est déjà dans l'environnement cloud).
# Rien n'est écrasé sans être lu : un fichier existant différent est signalé,
# pas remplacé (sauf --forcer).
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
slug=""; nom=""; depot=""; url_site=""; dossier="$PWD"; forcer=0; couleur=""
while [ $# -gt 0 ]; do
  case "$1" in
    --projet) slug="${2:-}"; shift 2 ;;
    --nom) nom="${2:-}"; shift 2 ;;
    --depot) depot="${2:-}"; shift 2 ;;
    --site) url_site="${2:-}"; shift 2 ;;
    --couleur) couleur="${2:-}"; shift 2 ;;
    --dossier) dossier="${2:-}"; shift 2 ;;
    --forcer) forcer=1; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$slug" ] || { echo "--projet <slug> manque (minuscules, chiffres, tirets)." >&2; exit 2; }
[ -d "$dossier" ] || { echo "Dossier introuvable : $dossier" >&2; exit 2; }
nom="${nom:-$slug}"
q() { printf '%s' "$1" | sed "s/'/''/g"; }
SQL="$ICI/scripts/sql.sh"

echo "1. Projet « $slug » en base"
"$SQL" "insert into projets (slug, nom, depot, url_site, couleur) values ('$(q "$slug")', '$(q "$nom")', $( [ -n "$depot" ] && echo "'$(q "$depot")'" || echo null ), $( [ -n "$url_site" ] && echo "'$(q "$url_site")'" || echo null ), $( [ -n "$couleur" ] && echo "'$(q "$couleur")'" || echo null )) on conflict (slug) do update set nom = excluded.nom, depot = coalesce(excluded.depot, projets.depot), url_site = coalesce(excluded.url_site, projets.url_site), couleur = coalesce(excluded.couleur, projets.couleur)" >/dev/null
cle=$("$SQL" "select cle_embed from projets where slug = '$(q "$slug")'" | jq -r '.rows[0].cle_embed')

copier() { # source, destination
  if [ -f "$2" ] && ! cmp -s "$1" "$2"; then
    if [ "$forcer" = 1 ]; then cp "$1" "$2"; echo "   remplacé : $2";
    else echo "   EXISTE et diffère, conservé (relance avec --forcer pour remplacer) : $2"; fi
  else cp "$1" "$2"; echo "   ok : $2"; fi
  chmod +x "$2" 2>/dev/null || true
}

echo "2. Scripts"
mkdir -p "$dossier/scripts"
sqlcible="$dossier/scripts/sql.sh"
if [ -f "$sqlcible" ] && ! grep -q "Content-Profile: cockpit" "$sqlcible"; then
  echo "   le projet a déjà son scripts/sql.sh (autre base) : le nôtre devient scripts/cockpit-sql.sh"
  sqlcible="$dossier/scripts/cockpit-sql.sh"
fi
copier "$ICI/scripts/sql.sh" "$sqlcible"
for f in demander.sh progression.sh progression_tableau.py; do
  # progression.sh appelle son aide python par son chemin : renommée cockpit-…,
  # elle doit l'être aussi dans l'appel (défaut trouvé sur FacePro le 28 sept. :
  # « can't open file scripts/progression_tableau.py »).
  tmp=$(mktemp); sed -e "s#SQL=\"\$RACINE/scripts/sql.sh\"#SQL=\"\$RACINE/scripts/$(basename "$sqlcible")\"#" -e 's#scripts/progression_tableau.py#scripts/cockpit-progression_tableau.py#' "$ICI/scripts/$f" > "$tmp"
  copier "$tmp" "$dossier/scripts/cockpit-$f"; rm -f "$tmp"
done

echo "3. Hook de démarrage"
mkdir -p "$dossier/.claude/hooks"
tmp=$(mktemp); sed -e "s#SQL=\"\$RACINE/scripts/sql.sh\"#SQL=\"\$RACINE/scripts/$(basename "$sqlcible")\"#" -e "s#SQL_CMD=\"scripts/sql.sh\"#SQL_CMD=\"scripts/$(basename "$sqlcible")\"#" -e 's#PROG_CMD="scripts/progression.sh"#PROG_CMD="scripts/cockpit-progression.sh"#' -e 's#DEM_CMD="scripts/demander.sh"#DEM_CMD="scripts/cockpit-demander.sh"#' "$ICI/hooks/session-start.sh" > "$tmp"
copier "$tmp" "$dossier/.claude/hooks/cockpit-session-start.sh"; rm -f "$tmp"
reglages="$dossier/.claude/settings.json"
[ -f "$reglages" ] || echo '{}' > "$reglages"
python3 - "$reglages" "$slug" <<'PY'
import json, sys
p, slug = sys.argv[1], sys.argv[2]
d = json.load(open(p))
d.setdefault("env", {})["COCKPIT_PROJET"] = slug
hooks = d.setdefault("hooks", {})
ss = hooks.setdefault("SessionStart", [])
cmd = "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/cockpit-session-start.sh"
# Comparer la commande elle-même : json.dumps échappe les guillemets de
# "$CLAUDE_PROJECT_DIR", le `in` ne matchait jamais et chaque relance ajoutait
# un second hook identique (constaté sur FacePro le 28 sept.).
if not any(x.get("command") == cmd for h in ss for x in h.get("hooks", [])):
    ss.append({"hooks": [{"type": "command", "command": cmd}]})
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False); open(p, "a").write("\n")
print("   ok : .claude/settings.json (env COCKPIT_PROJET + hook SessionStart)")
PY

echo "4. CLAUDE.md"
claude="$dossier/CLAUDE.md"; [ -f "$claude" ] || touch "$claude"
if grep -q "## Cockpit (rnab26/Cockpit-General)" "$claude"; then echo "   déjà présent"; else
  sed -e "s/{{SLUG}}/$slug/g" -e "s#{{SQL}}#scripts/$(basename "$sqlcible")#g" "$ICI/docs/bloc-CLAUDE.md" >> "$claude"; echo "   bloc ajouté"; fi

cat <<FIN

5. Module embarqué — à coller dans une page du site (la clé est propre à ce projet) :
   <script src="https://rnab26.github.io/Cockpit-General/embed/cockpit-embed.js" data-cle="$cle" data-utilisateur="Prénom"></script>

Terminé. Vérifie : cd $dossier && COCKPIT_PROJET=$slug bash .claude/hooks/cockpit-session-start.sh | jq -r .hookSpecificOutput.additionalContext | head -30
Le projet apparaît maintenant dans l'app : https://rnab26.github.io/Cockpit-General/
FIN
