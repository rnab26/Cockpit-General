// Appli installable (src/lib/installation.ts + public/manifest.webmanifest).
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifie, bilan } from './_assert.ts'
import { etatInstallation, estIos } from '../src/lib/installation.ts'

console.log('verifier-installation')
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
verifie('déjà en appli : rien à proposer', etatInstallation({ standalone: true, invite: true, userAgent: ANDROID }) === 'installee')
verifie('Chrome a donné son invite : un toucher installe', etatInstallation({ standalone: false, invite: true, userAgent: ANDROID }) === 'possible')
verifie('Chrome sans invite : aide par le menu', etatInstallation({ standalone: false, invite: false, userAgent: ANDROID }) === 'manuel')
verifie('iPhone : aide « Sur l’écran d’accueil »', etatInstallation({ standalone: false, invite: false, userAgent: IPHONE }) === 'iphone')
verifie('iPad (se dit Mac, mais tactile) : iPhone', estIos(IPAD, 5) && !estIos(IPAD, 0))

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const m = JSON.parse(readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'))
verifie('manifeste : plein écran, départ et portée sous /Cockpit-General/', m.display === 'standalone' && m.start_url === '/Cockpit-General/' && m.scope === '/Cockpit-General/')
verifie('manifeste : icônes 192 et 512 (dont une maskable) présentes', ['192x192', '512x512'].every((s) => m.icons.some((i: { sizes: string }) => i.sizes === s))
  && m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')
  && m.icons.every((i: { src: string }) => existsSync(path.join(pub, i.src))))
const index = readFileSync(path.join(pub, '..', 'index.html'), 'utf8')
verifie('theme_color du manifeste = theme-color de index.html', index.includes(`name="theme-color" content="${m.theme_color}"`))
verifie('index.html pointe sur le manifeste', index.includes('rel="manifest" href="/Cockpit-General/manifest.webmanifest"'))
bilan('verifier-installation')
