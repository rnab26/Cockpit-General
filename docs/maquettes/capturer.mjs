// Capture des maquettes au format téléphone : node docs/maquettes/capturer.mjs <dossier>
import { chromium } from '/home/user/Cockpit-General/app/node_modules/playwright/index.mjs'
import path from 'node:path'
const ici = path.dirname(new URL(import.meta.url).pathname)
const dest = process.argv[2] ?? ici
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
for (const f of ['a-tableau-de-bord', 'b-par-projet', 'c-onglets', 'd-messagerie']) {
  await p.goto(`file://${ici}/${f}.html`); await p.waitForTimeout(200)
  await p.screenshot({ path: `${dest}/${f}.png`, fullPage: true })
}
await b.close()
