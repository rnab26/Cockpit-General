## Cockpit — PREMIER GESTE de la session (si aucun bloc « Cockpit » n'est dans ton contexte)

Une session ouverte sur plusieurs dépôts démarre dans `/home/user` : aucun hook ne tourne, donc le cockpit ne te voit pas et Raphaël ne voit pas ta session. Avant toute autre action, lance UNE fois :

`bash /home/user/Cockpit-General/scripts/connecter.sh --projet {{SLUG}}`

(si `/home/user/Cockpit-General` manque : `git clone -q --depth 1 https://github.com/rnab26/Cockpit-General /home/user/Cockpit-General` d'abord). Il affiche l'état du projet et rend ta session visible dans « Ça avance » ; un petit processus refait son signe de vie tant qu'elle est ouverte. Plusieurs projets dans la session : prends celui du sujet de Raphaël. Si un bloc « Cockpit » est déjà dans ton contexte, ne fais rien.
