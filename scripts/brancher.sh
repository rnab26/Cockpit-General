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
#
# DÉPÔT QUI N'EST PAS À RAPHAËL (30 sept. 2026, chantier f31ae3ec : « les 3
# options me plaisent, ça laisse le choix au client ») : --voie est alors
# OBLIGATOIRE ; sans elle, le script refuse (rien n'est écrit) et explique :
#   --voie invisible (ou --sans-trace)   rien dans leur dépôt ; tout va dans le
#       $HOME de l'environnement de Raphaël (~/.cockpit, ~/.claude/settings.json) ;
#   --voie branches (ou --branches-raphael) [--branches "claude/* …"]  les
#       fichiers du cockpit sur les branches de Raphaël seulement, garde pre-push ;
#   --voie normale                        avec leur accord : comme un dépôt à Raphaël.
# La clé service_role ne va JAMAIS dans leur dépôt ni dans un environnement
# qu'ils voient : elle reste dans l'environnement cloud de Raphaël.
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
slug=""; nom=""; depot=""; url_site=""; dossier="$PWD"; forcer=0; couleur=""; maj=0
voie=""; motifs=""; garde_seulement=0
while [ $# -gt 0 ]; do
  case "$1" in
    --projet) slug="${2:-}"; shift 2 ;;
    --nom) nom="${2:-}"; shift 2 ;;
    --depot) depot="${2:-}"; shift 2 ;;
    --site) url_site="${2:-}"; shift 2 ;;
    --couleur) couleur="${2:-}"; shift 2 ;;
    --dossier) dossier="${2:-}"; shift 2 ;;
    --forcer) forcer=1; shift ;;
    # --maj : mise à jour AUTOMATIQUE d'un projet déjà branché, lancée par le
    # hook de démarrage de chaque session (29 sept. 2026, Raphaël : « les
    # améliorations du cockpit doivent être partout, sans que j'aie à le
    # demander »). Ne touche pas à la base, n'imprime que ce qui a changé.
    --maj) maj=1; shift ;;
    --voie) voie="${2:-}"; shift 2 ;;
    --sans-trace) voie=invisible; shift ;;
    --branches-raphael) voie=branches; shift ;;
    --branches) motifs="${2:-}"; shift 2 ;;
    # --garde-seulement : voie 2, pose la garde pre-push et rien d'autre (hook de
    # démarrage, sur une branche qui n'est pas à Raphaël).
    --garde-seulement) garde_seulement=1; maj=1; shift ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done
[ -n "$slug" ] || { echo "--projet <slug> manque (minuscules, chiffres, tirets)." >&2; exit 2; }
case "$voie" in 1|invisible|sans-trace) voie=invisible ;; 2|branches) voie=branches ;; 3|normale|accord) voie=normale ;; "") ;;
  *) echo "--voie inconnue : $voie (invisible, branches ou normale)." >&2; exit 2 ;; esac
[ -d "$dossier" ] || [ "$voie" = invisible ] || { echo "Dossier introuvable : $dossier" >&2; exit 2; }
nom="${nom:-$slug}"
q() { printf '%s' "$1" | sed "s/'/''/g"; }
SQL="$ICI/scripts/sql.sh"
# owner/repo d'un dossier : UNE règle, celle du lanceur (cockpit_depot_de).
depot_de() { COCKPIT_PROJET=_ bash -c 'source "$1" && cockpit_depot_de "$2"' _ "$ICI/modeles/cockpit-lanceur.sh" "$1" 2>/dev/null || true; }
[ -n "$depot" ] || [ ! -d "$dossier" ] || depot=$(depot_de "$dossier")
depot=$(printf '%s' "$depot" | tr 'A-Z' 'a-z')
reglages_env() { # une clé de l'env du .claude/settings.json du projet
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("env",{}).get(sys.argv[2],""))' "$dossier/.claude/settings.json" "$1" 2>/dev/null || true; }
if [ -z "$voie" ]; then
  if [ "$maj" = 1 ]; then
    # Mise à jour : la voie choisie au branchement (réglages du projet, sinon config git locale).
    voie=$(reglages_env COCKPIT_VOIE); [ -n "$voie" ] || voie=$(git -C "$dossier" config --get cockpit.voie 2>/dev/null || true)
    voie="${voie:-normale}"
  else
    proprio=$(printf '%s' "${COCKPIT_PROPRIETAIRE:-rnab26}" | tr 'A-Z' 'a-z')
    if [ -n "$depot" ] && [ "${depot%%/*}" != "$proprio" ]; then
      cat >&2 <<VOIES
Le dépôt $depot n'est pas à $proprio : choisis la voie (relance avec --voie) :
  --voie invisible  rien dans leur dépôt ; le cockpit vit dans TON environnement cloud
                    (relancé par son script d'installation ; une session ailleurs ne l'a pas).
  --voie branches   les fichiers du cockpit sur tes branches seulement (--branches, défaut
                    « claude/* ») ; une garde refuse de les pousser ailleurs ;
                    PR = scripts/cockpit-greffe.sh --branche-propre <nom>.
  --voie normale    avec leur accord : comme tes dépôts, ils voient les fichiers du cockpit.
Rien n'a été écrit.
VOIES
      exit 3
    fi
    voie=normale
  fi
fi
if [ "$voie" = branches ] && [ -z "$motifs" ]; then
  motifs=$(reglages_env COCKPIT_BRANCHES); [ -n "$motifs" ] || motifs=$(git -C "$dossier" config --get cockpit.branches 2>/dev/null || true)
  motifs="${motifs:-claude/*}"
fi

# VOIE 2 : la garde pre-push, dans .git/hooks (jamais versionné, invisible dans
# leur dépôt). Si le dépôt range ses hooks ailleurs (core.hooksPath, husky…),
# rien n'est posé là-bas (ce serait une trace) : on le dit.
poser_garde() {
  git -C "$dossier" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "   garde : pas un dépôt git, non posée"; return 0; }
  git -C "$dossier" config cockpit.voie branches
  git -C "$dossier" config cockpit.branches "$motifs"
  local hp gd dest
  hp=$(git -C "$dossier" config --get core.hooksPath 2>/dev/null || true)
  if [ -n "$hp" ]; then echo "   ATTENTION garde NON posée : ce dépôt range ses hooks git dans $hp (core.hooksPath). Ne pousse que des branches propres."; return 0; fi
  gd=$(git -C "$dossier" rev-parse --path-format=absolute --git-common-dir); mkdir -p "$gd/hooks"
  dest="$gd/hooks/pre-push"
  # Le pre-push qu'ils avaient : gardé à côté et toujours joué après le nôtre.
  if [ -f "$dest" ] && ! grep -q "cockpit-pre-push" "$dest"; then
    [ -e "$gd/hooks/pre-push.avant-cockpit" ] || mv "$dest" "$gd/hooks/pre-push.avant-cockpit"
  fi
  if ! cmp -s "$ICI/modeles/cockpit-pre-push.sh" "$dest" 2>/dev/null; then
    cp "$ICI/modeles/cockpit-pre-push.sh" "$dest"; chmod +x "$dest"; echo "   garde posée : .git/hooks/pre-push (branches de Raphaël : $motifs)"
  fi
}
if [ "$garde_seulement" = 1 ]; then poser_garde; exit 0; fi

# VOIE 1 : la greffe invisible. RIEN dans le dossier du projet : tout va dans
# $COCKPIT_HOME (~/.cockpit) et les réglages UTILISATEUR de Claude Code.
if [ "$voie" = invisible ]; then
  [ -n "$depot" ] || { echo "--depot owner/repo manque (le projet se reconnaît à son dépôt)." >&2; exit 2; }
  H="${COCKPIT_HOME:-$HOME/.cockpit}"; RU="${COCKPIT_REGLAGES_UTILISATEUR:-$HOME/.claude/settings.json}"
  etat() { [ -d "$dossier" ] && git -C "$dossier" status --porcelain --untracked-files=all --ignored 2>/dev/null | md5sum; }
  avant=$(etat || true)
  if [ "$maj" = 1 ]; then exec 3>&1 1>/dev/null; fi
  echo "1. Projet « $slug » en base (greffe invisible sur $depot)"
  [ "$maj" = 1 ] || "$SQL" "insert into projets (slug, nom, depot, url_site, couleur) values ('$(q "$slug")', '$(q "$nom")', '$(q "$depot")', $( [ -n "$url_site" ] && echo "'$(q "$url_site")'" || echo null ), $( [ -n "$couleur" ] && echo "'$(q "$couleur")'" || echo null )) on conflict (slug) do update set nom = excluded.nom, depot = coalesce(excluded.depot, projets.depot), url_site = coalesce(excluded.url_site, projets.url_site), couleur = coalesce(excluded.couleur, projets.couleur)" >/dev/null
  echo "2. Commandes et hooks dans $H/bin (hors du dépôt)"
  mkdir -p "$H/bin" "$(dirname "$RU")"
  for n in lanceur sql demander progression chantier passe media chef verdict renfort reproduction greffe greffe-hook; do
    cmp -s "$ICI/modeles/cockpit-$n.sh" "$H/bin/cockpit-$n.sh" || { cp "$ICI/modeles/cockpit-$n.sh" "$H/bin/cockpit-$n.sh"; echo "   ok : $H/bin/cockpit-$n.sh"; }
    chmod +x "$H/bin/cockpit-$n.sh"
  done
  touch "$H/greffes"
  if ! awk -v d="$depot" -v s="$slug" '$1 == d && $2 == s { t = 1 } END { exit !t }' "$H/greffes"; then
    awk -v d="$depot" '$1 != d' "$H/greffes" > "$H/greffes.tmp"; printf '%s %s\n' "$depot" "$slug" >> "$H/greffes.tmp"; mv "$H/greffes.tmp" "$H/greffes"
    echo "   ok : $H/greffes ($depot → $slug)"
  fi
  echo "3. Hooks déclarés dans les réglages utilisateur ($RU)"
  [ -f "$RU" ] || echo '{}' > "$RU"
  python3 - "$RU" "$H/bin/cockpit-greffe-hook.sh" <<'PYG'
import json, sys
p, crochet = sys.argv[1], sys.argv[2]
d = json.load(open(p)); avant = json.dumps(d, sort_keys=True)
hooks = d.setdefault("hooks", {})
def declarer(ev, nom, timeout=None, matcher=None):
    cmd = f'bash "{crochet}" {nom}'
    lst = hooks.setdefault(ev, [])
    if any(x.get("command") == cmd for h in lst for x in h.get("hooks", [])): return
    x = {"type": "command", "command": cmd}
    if timeout: x["timeout"] = timeout
    e = {"hooks": [x]}
    if matcher: e["matcher"] = matcher
    lst.append(e)
declarer("SessionStart", "session-start")
declarer("UserPromptSubmit", "prompt-rappel")
for ev in ("UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "PostToolUse", "StopFailure", "SessionEnd"):
    declarer(ev, "suivi", 10, "*" if ev == "PostToolUse" else None)
declarer("Stop", "autonome", 15)
d["autoContinueAtUsageLimit"] = True
if json.dumps(d, sort_keys=True) != avant:
    json.dump(d, open(p, "w"), indent=2, ensure_ascii=False); open(p, "a").write("\n")
    print("   ok : hooks du cockpit (ils ne parlent que dans un dépôt greffé)")
else:
    print("   déjà à jour")
PYG
  apres=$(etat || true)
  if [ "$avant" != "$apres" ]; then echo "ERREUR : le dossier du projet a changé alors que la greffe est invisible. Vérifie git status dans $dossier." >&2; exit 1; fi
  if [ "$maj" = 1 ]; then exec 1>&3 3>&-; exit 0; fi
  cat <<FIN
   vérifié : aucun fichier du dépôt touché.

À FAIRE PAR RAPHAËL (une fois) — sans ça, la greffe disparaît au prochain conteneur :
  1. claude.ai/code › menu de l'environnement cloud (barre de titre d'une session) › Edit.
  2. Dans « Setup script », ajoute ces deux lignes :
     git clone -q --depth 1 https://github.com/rnab26/Cockpit-General "\$HOME/.cockpit/src" 2>/dev/null || git -C "\$HOME/.cockpit/src" pull -q
     bash "\$HOME/.cockpit/src/scripts/brancher.sh" --voie invisible --maj --projet $slug --depot $depot
  3. Garde SUPABASE_SERVICE_ROLE_KEY dans les variables de CET environnement (le tien), jamais ailleurs.
  4. Enregistre, puis ouvre une nouvelle session sur $depot : le cockpit s'y charge.

Vérifie tout de suite (cette session) : cd $dossier && CLAUDE_PROJECT_DIR=$dossier bash "$H/bin/cockpit-greffe-hook.sh" session-start </dev/null | jq -r .hookSpecificOutput.additionalContext | head -20
FIN
  exit 0
fi

if [ "$maj" = 1 ]; then exec 3>&1 1>/tmp/cockpit-brancher-$$.log; fi
echo "1. Projet « $slug » en base"
[ "$maj" = 1 ] || "$SQL" "insert into projets (slug, nom, depot, url_site, couleur) values ('$(q "$slug")', '$(q "$nom")', $( [ -n "$depot" ] && echo "'$(q "$depot")'" || echo null ), $( [ -n "$url_site" ] && echo "'$(q "$url_site")'" || echo null ), $( [ -n "$couleur" ] && echo "'$(q "$couleur")'" || echo null )) on conflict (slug) do update set nom = excluded.nom, depot = coalesce(excluded.depot, projets.depot), url_site = coalesce(excluded.url_site, projets.url_site), couleur = coalesce(excluded.couleur, projets.couleur)" >/dev/null
cle=""; [ "$maj" = 1 ] || cle=$("$SQL" "select cle_embed from projets where slug = '$(q "$slug")'" | jq -r '.rows[0].cle_embed')

copier() { # source, destination
  if [ -f "$2" ] && ! cmp -s "$1" "$2"; then
    if [ "$forcer" = 1 ]; then cp "$1" "$2"; echo "   remplacé : $2";
    else echo "   EXISTE et diffère, conservé (relance avec --forcer pour remplacer) : $2"; fi
  else cp "$1" "$2"; echo "   ok : $2"; fi
  chmod +x "$2" 2>/dev/null || true
}

echo "2. Commandes des sessions (lanceurs à jour automatique)"
# Depuis le 29 sept. 2026, on n'installe plus de COPIES figées : des lanceurs
# qui exécutent toujours la dernière version sur Cockpit-General (voir
# modeles/cockpit-lanceur.sh). Une ancienne copie posée par ce script est
# reconnue et remplacée d'office ; un fichier du projet qui n'est pas à nous
# (le scripts/sql.sh de FacePro, par exemple) n'est jamais touché.
est_a_nous() { [ -f "$1" ] && grep -qE "Content-Profile: cockpit|COCKPIT_PROJET|Cockpit-General|cockpit-lanceur" "$1"; }
poser() { # modèle, destination
  if [ -f "$2" ] && cmp -s "$1" "$2"; then echo "   déjà à jour : ${2#$dossier/}"
  elif [ ! -f "$2" ] || est_a_nous "$2" || [ "$forcer" = 1 ]; then cp "$1" "$2"; chmod +x "$2"; echo "   ok : ${2#$dossier/}"
  else echo "   EXISTE, n'est pas au cockpit, conservé (relance avec --forcer pour remplacer) : ${2#$dossier/}"; fi
}
mkdir -p "$dossier/scripts" "$dossier/.claude/hooks"
for n in lanceur sql demander progression chantier passe media chef verdict renfort reproduction greffe; do poser "$ICI/modeles/cockpit-$n.sh" "$dossier/scripts/cockpit-$n.sh"; done
# Ancienne aide de l'installation par copie : plus utilisée.
if [ -f "$dossier/scripts/cockpit-progression_tableau.py" ]; then rm -f "$dossier/scripts/cockpit-progression_tableau.py"; echo "   retiré (ancienne copie) : scripts/cockpit-progression_tableau.py"; fi
# Ancien mode : un projet SANS sql.sh recevait notre sql.sh sous son nom. Il est à nous : on le laisse
# (inoffensif) mais plus rien ne s'en sert ; on le signale.
if [ -f "$dossier/scripts/sql.sh" ] && grep -q "Content-Profile: cockpit" "$dossier/scripts/sql.sh"; then
  echo "   note : scripts/sql.sh est une ancienne copie du cockpit ; les sessions utilisent désormais scripts/cockpit-sql.sh"
fi

echo "3. Hook de démarrage"
poser "$ICI/modeles/cockpit-session-start.sh" "$dossier/.claude/hooks/cockpit-session-start.sh"
poser "$ICI/modeles/cockpit-prompt-rappel.sh" "$dossier/.claude/hooks/cockpit-prompt-rappel.sh"
poser "$ICI/modeles/cockpit-suivi.sh" "$dossier/.claude/hooks/cockpit-suivi.sh"
poser "$ICI/modeles/cockpit-autonome.sh" "$dossier/.claude/hooks/cockpit-autonome.sh"
reglages="$dossier/.claude/settings.json"
[ -f "$reglages" ] || echo '{}' > "$reglages"
python3 - "$reglages" "$slug" "$voie" "$motifs" <<'PY'
import json, sys
p, slug, voie, motifs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = json.load(open(p))
avant = json.dumps(d, sort_keys=True)
d.setdefault("env", {})["COCKPIT_PROJET"] = slug
# Voie 2 (dépôt d'autrui) : la voie et les branches de Raphaël voyagent avec les
# réglages, pour que le hook de démarrage d'un clone neuf repose la garde.
if voie == "branches":
    d["env"]["COCKPIT_VOIE"] = "branches"; d["env"]["COCKPIT_BRANCHES"] = motifs
hooks = d.setdefault("hooks", {})
ss = hooks.setdefault("SessionStart", [])
cmd = "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/cockpit-session-start.sh"
# Comparer la commande elle-même : json.dumps échappe les guillemets de
# "$CLAUDE_PROJECT_DIR", le `in` ne matchait jamais et chaque relance ajoutait
# un second hook identique (constaté sur FacePro le 28 sept.).
if not any(x.get("command") == cmd for h in ss for x in h.get("hooks", [])):
    ss.append({"hooks": [{"type": "command", "command": cmd}]})
# Rappel à CHAQUE message (29 sept. 2026) : ce qu'on lance dans une session
# arrive dans le cockpit, sans doublon (voir hooks/prompt-rappel.sh).
ups = hooks.setdefault("UserPromptSubmit", [])
cmd2 = "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/cockpit-prompt-rappel.sh"
if not any(x.get("command") == cmd2 for h in ups for x in h.get("hooks", [])):
    ups.append({"hooks": [{"type": "command", "command": cmd2}]})
# Suivi des sessions et de leurs agents (29 sept. 2026) : quelle session
# travaille, quels agents et commandes elle a lancés (voir hooks/suivi.sh).
cmd3 = "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/cockpit-suivi.sh"
for ev in ("UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "PostToolUse", "StopFailure", "SessionEnd"):
    lst = hooks.setdefault(ev, [])
    if not any(x.get("command") == cmd3 for h in lst for x in h.get("hooks", [])):
        entree = {"hooks": [{"type": "command", "command": cmd3, "timeout": 10}]}
        if ev == "PostToolUse":
            entree["matcher"] = "*"
        lst.append(entree)
# Mode autonome (29 sept. 2026) : à la fin d'une tâche, le chantier libre suivant
# si le projet est en mode autonome (voir hooks/autonome.sh). Synchrone : c'est
# sa réponse qui empêche la session de s'arrêter.
cmd4 = "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/cockpit-autonome.sh"
st = hooks.setdefault("Stop", [])
if not any(x.get("command") == cmd4 for h in st for x in h.get("hooks", [])):
    st.append({"hooks": [{"type": "command", "command": cmd4, "timeout": 15}]})
# Reprise native de la tâche en cours quand une limite d'usage se lève
# (réglage de Claude Code : « wait for the limit to reset and continue the task
# automatically »).
d["autoContinueAtUsageLimit"] = True
if json.dumps(d, sort_keys=True) == avant:
    print("   déjà à jour : .claude/settings.json")
else:
    json.dump(d, open(p, "w"), indent=2, ensure_ascii=False); open(p, "a").write("\n")
    print("   ok : .claude/settings.json (env COCKPIT_PROJET, hooks démarrage / rappel / suivi / mode autonome, reprise auto après limite)")
PY

[ "$voie" = branches ] && poser_garde

echo "4. CLAUDE.md"
claude="$dossier/CLAUDE.md"; [ -f "$claude" ] || touch "$claude"
bloc=$(sed -e "s/{{SLUG}}/$slug/g" -e "s#{{SQL}}#scripts/cockpit-sql.sh#g" "$ICI/docs/bloc-CLAUDE.md")
if grep -q "## Cockpit (rnab26/Cockpit-General)" "$claude"; then
  # Le bloc évolue avec le cockpit : on le REMPLACE, du titre jusqu'au repère de
  # fin (ou, pour un bloc d'avant le repère, jusqu'au titre ## suivant ou au
  # paragraphe propre au projet « **Ce que le cockpit ne remplace PAS »).
  # Le reste du CLAUDE.md du projet n'est jamais touché.
  BLOC="$bloc" python3 - "$claude" <<'PY2'
import os, re, sys
p = sys.argv[1]; s = open(p).read(); bloc = os.environ["BLOC"].strip("\n") + "\n"
i = s.index("## Cockpit (rnab26/Cockpit-General)")
fin = "<!-- fin du bloc cockpit"
j = s.find(fin, i)
if j >= 0:
    j = s.index("\n", j) + 1
else:
    m = re.compile(r"^(## |\*\*Ce que le cockpit ne remplace PAS)", re.M).search(s, i + 5)
    j = m.start() if m else len(s)
suite = s[j:]
nouveau = s[:i] + bloc + ("\n" + suite.lstrip("\n") if suite.strip() else "")
if nouveau != s:
    open(p, "w").write(nouveau); print("   bloc mis à jour")
else:
    print("   déjà à jour")
PY2
else
  printf '\n%s\n' "$bloc" >> "$claude"; echo "   bloc ajouté"; fi

if [ "$maj" = 1 ]; then
  # Seulement ce qui a changé, pour le hook de démarrage.
  exec 1>&3 3>&-
  grep -E "   (ok|remplacé|retiré[^:]*) :|bloc (mis à jour|ajouté)" /tmp/cockpit-brancher-$$.log | grep -v "ok : scripts/cockpit-lanceur.sh$" || true
  grep -E "   ok : scripts/cockpit-lanceur.sh$" /tmp/cockpit-brancher-$$.log || true
  rm -f /tmp/cockpit-brancher-$$.log
  exit 0
fi
cat <<FIN

5. Module embarqué — à coller dans une page du site (la clé est propre à ce projet) :
   <script src="https://rnab26.github.io/Cockpit-General/embed/cockpit-embed.js" data-cle="$cle" data-utilisateur="Prénom"></script>
   Il joint à chaque demande de quoi la rejouer (page sans jetons, appareil, version, 20 dernières
   actions par leur libellé — jamais ce qui est tapé —, erreurs JS) ; data-reproduction="non" pour rien joindre.

Terminé. Vérifie : cd $dossier && COCKPIT_PROJET=$slug bash .claude/hooks/cockpit-session-start.sh | jq -r .hookSpecificOutput.additionalContext | head -30
Le projet apparaît maintenant dans l'app : https://rnab26.github.io/Cockpit-General/
FIN
