#!/usr/bin/env node
// Non-régression « où le cockpit apparaît » (chantier dec7fb3c, 5 oct. 2026), sans toucher à la base :
//   1. scripts/analyser-depot.py sur des dépôts jetables : seuls les choix POSSIBLES sont proposés
//      (une app mobile n'a pas de menu ; sans connexion, « utilisateurs du site » n'est pas offert) ;
//   2. embed/cockpit-embed.js en data-mode : « bouton » (flottant ou lien du menu : masqué, ouvert au
//      toucher, refermé par Échap) et « page » (visible, aucun bouton).
//   node scripts/verifier-emplacement.mjs
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
let ok = true
const verifie = (n, c) => { console.log(c ? 'OK  ' : 'KO  ', n); if (!c) ok = false }

const tmp = mkdtempSync(join(tmpdir(), 'empl-'))
const depot = (nom, fichiers) => {
  const d = join(tmp, nom)
  for (const [f, t] of Object.entries(fichiers)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), t) }
  return d
}
const analyse = (d) => JSON.parse(spawnSync('python3', [join(RACINE, 'scripts/analyser-depot.py'), d], { encoding: 'utf8' }).stdout)

const flask = analyse(depot('flask', {
  'requirements.txt': 'flask\n',
  'templates/base.html': '<nav class="navbar"></nav></body>',
  'app.py': 'from flask_login import login_required\nif current_user.is_admin: pass\n',
}))
verifie('site Flask avec menu et connexion : menu/page/appli, recommandé menu', flask.options.join() === 'menu,page,appli' && flask.recommande === 'menu')
verifie('  gabarit conseillé = base.html (une balise pour toutes les pages)', flask.gabarit_conseille.endsWith('base.html'))
verifie('  connexion repérée : « utilisateurs » proposé, « equipe » recommandé', flask.acces_possibles.includes('utilisateurs') && flask.acces_recommande === 'equipe')
const statique = analyse(depot('statique', { 'index.html': '<html><body>Salut</body></html>' }))
verifie('site statique sans connexion : « utilisateurs » NON proposé, « moi » recommandé', !statique.acces_possibles.includes('utilisateurs') && statique.acces_recommande === 'moi' && statique.limites.length > 0)
const mobile = analyse(depot('mobile', { 'package.json': '{"dependencies":{"expo":"1","react-native":"1"}}' }))
verifie("app mobile : ni menu ni page, seulement l'appli", mobile.options.join() === 'appli' && mobile.type === 'mobile')
const expo = analyse(depot('expo', { 'package.json': '{"dependencies":{"expo":"1","react":"1","react-native":"1"}}', 'App.tsx': 'export default () => null' }))
verifie("appli Expo + React + App.tsx : mobile, seulement l'appli (pas de page web)", expo.type === 'mobile' && expo.options.join() === 'appli')
const multi = analyse(depot('multi', { 'package.json': '{"dependencies":{"expo":"1","react":"1","react-native":"1","react-native-web":"1"}}', 'App.tsx': 'x' }))
verifie('Expo avec react-native-web : vrai multiplateforme, menu/page proposés', multi.type === 'site' && multi.options.includes('page'))
const vide = analyse(join(tmp, 'absent'))
verifie('dossier introuvable : pas de plantage, limite dite, appli proposée', vide.options.includes('appli') && vide.limites.length > 0)
rmSync(tmp, { recursive: true, force: true })

const candidats = [join(RACINE, 'app', 'node_modules'), '/home/user/Cockpit-General/app/node_modules']
const base = candidats.find((c) => existsSync(join(c, 'playwright')))
if (!base) { console.log('KO   playwright introuvable (cd app && npm ci)'); process.exit(1) }
const { chromium } = createRequire(join(base, 'x.js'))('playwright')
const js = readFileSync(join(RACINE, 'embed/cockpit-embed.js'), 'utf8')
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
for (const variante of ['flottant', 'declencheur', 'page']) {
  const p = await b.newPage()
  await p.route('https://x.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body><a id="lien-x" href="#">Cockpit</a></body></html>' }))
  await p.route('https://bexiyvmdbxcwxasgslxp.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }))
  await p.goto('https://x.test/')
  const attrs = variante === 'flottant' ? 'data-mode="bouton"' : variante === 'declencheur' ? 'data-mode="bouton" data-declencheur="#lien-x"' : 'data-mode="page"'
  await p.evaluate(([code, a]) => {
    const s = document.createElement('script'); s.setAttribute('data-cle', 'x')
    for (const m of a.matchAll(/([\w-]+)="([^"]*)"/g)) s.setAttribute(m[1], m[2])
    s.textContent = code; document.body.appendChild(s)
  }, [js, attrs])
  const hote = () => p.evaluate(() => getComputedStyle(document.querySelector('.cockpit-embed')).display)
  if (variante === 'page') {
    verifie('page : visible tout de suite, aucun bouton', (await hote()) !== 'none' && (await p.locator('button:has-text("Demandes")').count()) === 0)
  } else {
    verifie(variante + ' : masqué au départ', (await hote()) === 'none')
    await p.click(variante === 'flottant' ? 'button:has-text("Demandes")' : '#lien-x')
    verifie(variante + ' : ouvert au toucher', (await hote()) === 'block')
    await p.keyboard.press('Escape')
    verifie(variante + ' : Échap referme', (await hote()) === 'none')
    await p.click(variante === 'flottant' ? 'button:has-text("Demandes")' : '#lien-x')
    await p.mouse.click(5, 5)
    verifie(variante + ' : toucher extérieur referme', (await hote()) === 'none')
    await p.click(variante === 'flottant' ? 'button:has-text("Demandes")' : '#lien-x')
    const avant = await p.evaluate(() => location.href)
    await p.goBack().catch(() => {})
    await p.waitForTimeout(150)
    verifie(variante + ' : retour du téléphone referme, page inchangée', (await hote()) === 'none' && (await p.evaluate(() => location.href)) === avant)
  }
  await p.close()
}
await b.close()
process.exit(ok ? 0 : 1)
