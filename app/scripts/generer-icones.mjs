// Génère les icônes de l'appli installable (public/icon-*.png) à partir d'un
// SVG : fond vert du cockpit (#0F766E, = theme-color de index.html), avion
// blanc (icône « plane » de lucide). À relancer seulement si l'icône change :
//   node app/scripts/generer-icones.mjs
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const AVION = 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'
// marge = part de l'icône laissée autour de l'avion (maskable : zone sûre de 80 %).
const svg = (taille, arrondi, marge) => {
  const zone = taille * (1 - 2 * marge), e = zone / 24
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${taille}" height="${taille}" viewBox="0 0 ${taille} ${taille}">
<rect width="${taille}" height="${taille}" rx="${taille * arrondi}" fill="#0F766E"/>
<g transform="translate(${taille * marge} ${taille * marge}) scale(${e})"><path d="${AVION}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`
}
const ICONES = [
  ['icon-192.png', 192, 0.22, 0.2],
  ['icon-512.png', 512, 0.22, 0.2],
  ['icon-maskable-512.png', 512, 0, 0.26],
  ['apple-touch-icon.png', 180, 0, 0.2],
]
const nav = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await nav.newPage()
for (const [nom, t, r, m] of ICONES) {
  await page.setViewportSize({ width: t, height: t })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t, r, m)}</body></html>`)
  await page.locator('svg').screenshot({ path: path.join(pub, nom), omitBackground: true })
  console.log('✓', nom)
}
await nav.close()
