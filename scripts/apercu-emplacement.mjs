// Aperçu d'un emplacement du cockpit, en image (png), pour la carte du questionnaire.
//   node scripts/apercu-emplacement.mjs <menu|page|appli> <sortie.png> [Nom du projet]
// Une maquette, pas une capture du site : elle montre OÙ le cockpit apparaîtra
// (bouton dans le menu, page à part, appli installée) pour que le choix se fasse
// en voyant. Aucun accès réseau ; Chromium comme les autres captures du dépôt.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [mode, sortie, nom = 'Mon site'] = process.argv.slice(2)
if (!['menu', 'page', 'appli'].includes(mode) || !sortie) {
  console.error('usage : apercu-emplacement.mjs <menu|page|appli> <sortie.png> [nom]'); process.exit(2)
}
const ici = dirname(fileURLToPath(import.meta.url))
const candidats = [join(ici, '..', 'app', 'node_modules'), '/home/user/Cockpit-General/app/node_modules']
const base = candidats.find((c) => existsSync(join(c, 'playwright')))
if (!base) { console.error('playwright introuvable : cd app && npm ci'); process.exit(1) }
const { chromium } = createRequire(join(base, 'x.js'))('playwright')

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const CSS = `body{margin:0;font:15px system-ui,sans-serif;background:#eef0f4;color:#111;display:flex;justify-content:center;padding:20px}
.tel{width:330px;border:8px solid #222;border-radius:30px;background:#fff;overflow:hidden;position:relative;height:560px}
.nav{display:flex;gap:14px;align-items:center;padding:12px 14px;background:#1f2937;color:#fff;font-size:13px}.nav b{margin-right:auto}
.corps{padding:16px}.l{height:12px;background:#e5e7eb;border-radius:6px;margin:10px 0}.l.c{width:60%}
.hl{background:#f59e0b;color:#111;padding:4px 10px;border-radius:999px;font-weight:700;box-shadow:0 0 0 4px rgba(245,158,11,.35)}
.flèche{color:#b45309;font-weight:700;font-size:13px;padding:8px 14px}
.carte{margin:10px 14px;padding:12px;border-radius:12px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.18);border:2px solid #f59e0b}
.carte h4{margin:0 0 6px}.pt{display:inline-block;width:8px;height:8px;border-radius:50%;background:#dc2626;margin-right:6px}
.url{background:#f3f4f6;padding:8px 12px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb}.url b{color:#b45309}
.ecran{background:linear-gradient(#111827,#1f2937);height:100%;color:#fff}.icone{display:inline-block;width:56px;height:56px;border-radius:14px;background:#f59e0b;margin:24px 0 6px}
.cap{position:absolute;bottom:0;left:0;right:0;padding:10px 14px;background:#fffbeb;border-top:2px solid #f59e0b;font-size:13px}`
const PROJ = esc(nom)
const cartes = `<div class="carte"><h4><span class="pt"></span>Une demande à valider</h4><div class="l"></div><div class="l c"></div></div>
<div class="carte"><h4>3 chantiers en cours</h4><div class="l c"></div></div>`
const VUES = {
  menu: `<div class="nav"><b>${PROJ}</b><span>Accueil</span><span>Clients</span><span class="hl">Cockpit</span></div>
<div class="flèche">Un bouton « Cockpit » dans le menu de ton site</div>${cartes}
<div class="cap"><b>Dans le site.</b> Un toucher sur le bouton ouvre le cockpit par-dessus la page ; Échap le referme.</div>`,
  page: `<div class="url">https://<b>ton-site.fr/cockpit</b></div>
<div class="corps"><b>Cockpit de ${PROJ}</b></div>${cartes}
<div class="cap"><b>Page à part.</b> Rien dans le menu : on y va par un lien (à mettre en favori, ou à envoyer à ceux qui y ont droit).</div>`,
  appli: `<div class="ecran"><div style="padding:0 20px"><div class="icone"></div><div><b>Cockpit</b></div>
<p style="color:#9ca3af">Installé sur l'écran d'accueil du téléphone. Tous tes projets, dont ${PROJ}, au même endroit.</p></div></div>
<div class="cap"><b>Appli installable.</b> Rien n'est ajouté à ton site : on ouvre l'app du cockpit (Chrome › Installer l'appli).</div>`,
}
const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="tel">${VUES[mode]}</div>`
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 380, height: 620 }, deviceScaleFactor: 2 })
await p.setContent(html)
await p.screenshot({ path: sortie })
await b.close()
console.log('aperçu écrit :', sortie)
