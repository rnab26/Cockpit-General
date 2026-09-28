#!/usr/bin/env python3
# Le tableau de progression (appelé par progression.sh, JSON de sql.sh sur stdin).

import json, sys
rows = json.load(sys.stdin).get("rows") or []

def duree(sec):
    sec = max(int(sec or 0), 0)
    return f"{sec//3600} h {(sec%3600)//60:02d}" if sec >= 3600 else (f"{sec//60} min" if sec >= 60 else f"{sec} s")

if len(sys.argv) > 2 and sys.argv[2] == "--taches":
    # « Qui travaille » (29 sept. 2026, capture de Raphaël : « j'ai cinq agents,
    # c'est illisible […] je veux voir leur progression et combien de temps il
    # reste, en version simplifiée »). Une ligne par session, ses tâches dessous.
    if not rows:
        print("Qui travaille : aucun agent ni commande en arrière-plan en ce moment.\n"); sys.exit()
    sessions = {}
    for r in rows: sessions.setdefault(r["session"], []).append(r)
    na = sum(1 for r in rows if r["type"] == "agent" and r["statut"] == "en_cours")
    nc = sum(1 for r in rows if r["type"] != "agent" and r["statut"] == "en_cours")
    print(f"Qui travaille — {len(sessions)} session(s) · {na} agent(s) · {nc} commande(s) en cours\n")
    for sess, taches in sessions.items():
        print(f"💬 Session {sess}")
        for r in taches:
            nom = (r["description"] or r["sorte"] or "tâche")[:70]
            ico = "🤖 Agent" if r["type"] == "agent" else "⚙️  Commande"
            if r["statut"] != "en_cours":
                print(f"   ✅ {ico} : {nom} — fini il y a {duree(r['depuis_fin'])}"); continue
            ligne = f"   {ico} : {nom} — tourne depuis {duree(r['ecoule'])}"
            if r["progres"] is None:
                print(ligne + " — \033[90mavancement non signalé\033[0m")
            else:
                p = r["pourcentage"] if r["pourcentage"] is not None else 0
                reste = "durée inconnue" if r["eta_secondes"] is None else f"reste ~{duree(max(r['eta_secondes'] - r['progres'], 0))}"
                print(ligne)
                print(f"      \033[33m{'█' * (p // 5)}{'░' * (20 - p // 5)} {p:3d} %\033[0m  {r['etape'] or ''} · {reste}")
        print()
    sys.exit()

if not rows:
    print("(aucune activité en cours dans ce projet)"); sys.exit()
def eta(s):
    if s is None: return "durée inconnue"
    return f"~{s//3600}h{(s%3600)//60:02d}" if s >= 3600 else (f"~{s//60} min" if s >= 60 else f"~{s} s")
def age(a):
    return "à l instant" if a is None or a < 60 else (f"il y a {a//60} min" if a < 3600 else f"il y a {a//3600} h")
etats = {"a_trier":"à trier","a_cadrer":"à cadrer","libre":"libre","en_cours":"en cours","a_verifier":"livré, à vérifier","valide":"certifié","bloque":"bloqué","reporte":"reporté"}
print(f"\nProgression — projet {sys.argv[1]}\n")
for r in rows:
    st = r["statut"]
    p = r["pourcentage"] if r["pourcentage"] is not None else (100 if r["etat"] in ("a_verifier", "valide") else 0)
    if r["etat"] in ("a_verifier", "valide") and st != "en_cours": p = 100
    if st == "termine" or r["etat"] in ("valide", "a_verifier"): couleur = "\033[32m"
    elif st == "echec" or r["etat"] == "bloque": couleur = "\033[31m"
    elif p < 30: couleur = "\033[31m"
    else: couleur = "\033[33m"
    barre = "█" * (p // 4) + "░" * (25 - p // 4)
    titre = r["titre"][:60]
    ligne2 = " · ".join(x for x in [r.get("etape"), etats.get(r["etat"], r["etat"]),
              (eta(r["eta_secondes"]) if st == "en_cours" else None),
              (f"{r['session']} ({age(r['age'])})" if r.get("session") else None)] if x)
    print(f"{titre}\n  {couleur}{barre} {p:3d} %\033[0m  {ligne2}")
print()
