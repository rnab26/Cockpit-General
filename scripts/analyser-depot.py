#!/usr/bin/env python3
"""Analyse un dépôt (et, si on le donne, son site) pour dire OÙ le cockpit peut vivre.

    scripts/analyser-depot.py <dossier> [--site https://…]   -> JSON sur la sortie

Lecture seule : rien n'est écrit, rien n'est exécuté. Sert au questionnaire
d'emplacement (scripts/emplacement.sh) : il ne propose que des choix possibles
pour CE projet, et recommande le plus sûr, pour éviter de planter (une app
mobile n'a pas de page web où coller une balise ; un site sans connexion ne
peut pas réserver le cockpit à ses admins).
Sortie : stack, gabarits où coller la balise, authentification et rôles repérés,
appli installable ou non, options possibles, recommandation.
"""
import json, os, re, sys, urllib.request

IGNORER = {"node_modules", "dist", "build", "venv", "__pycache__", "vendor", "coverage"}
EXT_PAGE = (".html", ".htm", ".jinja", ".jinja2", ".j2", ".njk", ".ejs", ".erb", ".twig", ".hbs", ".vue", ".svelte", ".tsx", ".jsx", ".php")
RE_MENU = re.compile(r"<nav\b|role=[\"']navigation|class=[\"'][^\"']*\b(navbar|nav-bar|sidebar|topbar|header-nav)\b|<Sidebar|<Navbar|<NavBar", re.I)
RE_AUTH = re.compile(r"login_required|current_user|useAuth|supabase\.auth|signInWith|passport|next-auth|getServerSession|/login|signin|sign_in", re.I)
RE_ROLE = re.compile(r"is_admin|isAdmin|role\s*(==|===|=|:)\s*[\"'](admin|owner|manager)|admin_required|require_admin|requireAdmin", re.I)


def lire(chemin, max_octets=200_000):
    try:
        with open(chemin, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(max_octets)
    except OSError:
        return ""


def parcourir(racine, limite=4000):
    n = 0
    for d, sous, fichiers in os.walk(racine):
        sous[:] = [s for s in sous if s not in IGNORER and not s.startswith(".")]
        for f in fichiers:
            n += 1
            if n > limite:
                return
            yield os.path.join(d, f)


def analyser(dossier, site=None):
    dossier = os.path.abspath(dossier)
    r = {"dossier": dossier, "stack": [], "gabarits_menu": [], "gabarits_pied": [], "auth": [], "roles": [],
         "appli_installable": False, "type": "inconnu", "site": site or "", "limites": []}
    if not os.path.isdir(dossier):
        r["limites"].append("dossier introuvable")
    pkg = {}
    p = os.path.join(dossier, "package.json")
    if os.path.isfile(p):
        try:
            pkg = json.loads(lire(p))
        except ValueError:
            r["limites"].append("package.json illisible")
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    for nom, etiquette in (("next", "Next.js"), ("react", "React"), ("vue", "Vue"), ("svelte", "Svelte"), ("vite", "Vite"),
                           ("express", "Express"), ("react-native", "React Native"), ("expo", "Expo"), ("electron", "Electron"),
                           ("@supabase/supabase-js", "Supabase"), ("next-auth", "next-auth"), ("@clerk/nextjs", "Clerk")):
        if nom in deps:
            r["stack"].append(etiquette)
    txt_py = lire(os.path.join(dossier, "requirements.txt")) + lire(os.path.join(dossier, "pyproject.toml"))
    for mot, etiquette in (("flask", "Flask"), ("django", "Django"), ("fastapi", "FastAPI"), ("jinja2", "Jinja")):
        if re.search(mot, txt_py, re.I):
            r["stack"].append(etiquette)
    for f, e in (("Gemfile", "Rails/Ruby"), ("composer.json", "PHP"), ("pubspec.yaml", "Flutter"),
                 ("build.gradle", "Android natif"), ("Package.swift", "iOS natif")):
        if os.path.isfile(os.path.join(dossier, f)):
            r["stack"].append(e)
    pages = 0
    for chemin in parcourir(dossier):
        rel = os.path.relpath(chemin, dossier)
        b = os.path.basename(chemin).lower()
        if b == "manifest.webmanifest":
            r["appli_installable"] = True
        if not b.endswith(EXT_PAGE + (".py", ".js", ".ts")):
            continue
        t = lire(chemin)
        if b.endswith(EXT_PAGE):
            pages += 1
            if RE_MENU.search(t) and len(r["gabarits_menu"]) < 6:
                r["gabarits_menu"].append(rel)
            if re.search(r"</body>", t, re.I) and re.search(r"base|layout|template|index|app", b) and len(r["gabarits_pied"]) < 4:
                r["gabarits_pied"].append(rel)
        if RE_AUTH.search(t) and len(r["auth"]) < 6:
            r["auth"].append(rel)
        if RE_ROLE.search(t) and len(r["roles"]) < 6:
            r["roles"].append(rel)
    r["pages"] = pages
    # Un gabarit de base (base.html, layout…) est la meilleure place : une seule balise sert toutes les pages.
    tous = r["gabarits_menu"] + r["gabarits_pied"]
    base = [g for g in tous if re.search(r"(base|layout|_app|root)\.", os.path.basename(g), re.I)]
    r["gabarit_conseille"] = (base or r["gabarits_menu"] or r["gabarits_pied"] or [""])[0]
    mobile = any(s in r["stack"] for s in ("React Native", "Expo", "Flutter", "Android natif", "iOS natif"))
    if site:
        try:
            req = urllib.request.Request(site, headers={"User-Agent": "cockpit-analyse"})
            with urllib.request.urlopen(req, timeout=10) as rep:
                html = rep.read(300_000).decode("utf-8", "ignore")
            r["site_joignable"] = True
            r["site_a_menu"] = bool(RE_MENU.search(html))
            r["site_a_connexion"] = bool(re.search(r"login|connexion|sign.?in|se connecter", html, re.I))
            r["appli_installable"] = r["appli_installable"] or bool(re.search(r"rel=[\"']manifest", html, re.I))
        except Exception as e:  # réseau : on le dit, on ne plante pas
            r["site_joignable"] = False
            r["limites"].append("site non analysé (%s)" % type(e).__name__)
    a_menu = bool(r["gabarits_menu"]) or bool(r.get("site_a_menu"))
    a_web = pages > 0 or bool(site) or any(s in r["stack"] for s in (
        "Next.js", "React", "Vue", "Svelte", "Vite", "Flask", "Django", "FastAPI", "Express", "Jinja", "PHP", "Rails/Ruby"))
    a_auth = bool(r["auth"]) or bool(r.get("site_a_connexion"))
    r["type"] = "mobile" if mobile and not a_web else ("site" if a_web else "inconnu")
    options, raisons = [], {}
    if r["type"] == "site":
        options.append("menu")
        raisons["menu"] = ("un menu repéré (%s)" % r["gabarits_menu"][0]) if r["gabarits_menu"] else (
            "menu du site repéré" if r.get("site_a_menu") else "aucun menu repéré : un bouton flottant sera posé à la place")
        options.append("page")
        raisons["page"] = "marche sur tout site : une page à part, avec un lien"
    options.append("appli")
    raisons["appli"] = "rien à toucher dans le projet : l'app du cockpit, installable sur le téléphone"
    r["options"], r["raisons"] = options, raisons
    r["recommande"] = "menu" if (r["type"] == "site" and a_menu) else ("page" if r["type"] == "site" else "appli")
    # moi = Raphaël seul ; equipe = membres du projet ; utilisateurs = tout utilisateur connecté du site
    # (sans connexion repérée sur le site, « utilisateurs » ne peut pas être appliqué : non proposé).
    r["acces_possibles"] = ["equipe", "moi", "utilisateurs"] if a_auth else ["moi", "equipe"]
    r["acces_recommande"] = "equipe" if a_auth else "moi"
    r["a_auth"] = a_auth
    if not a_auth:
        r["limites"].append("aucune connexion repérée sur le site : « utilisateurs du site » n'est pas proposé ; une page à part reste accessible à quiconque a son adresse")
    return r


if __name__ == "__main__":
    args = sys.argv[1:]
    site = None
    if "--site" in args:
        i = args.index("--site")
        site = args[i + 1]
        del args[i:i + 2]
    print(json.dumps(analyser(args[0] if args else ".", site), ensure_ascii=False, indent=2))
