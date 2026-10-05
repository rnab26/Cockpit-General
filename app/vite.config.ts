import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Le numéro de cette construction : le commit (GitHub Actions), sinon « dev ».
// UNE source : gravé dans l'app (__VERSION_APP__) ET écrit dans version.json,
// que l'app ouverte relit pour proposer « Nouvelle version » (lib/version.ts).
const VERSION = (process.env.GITHUB_SHA ?? '').slice(0, 12) || 'dev'
const DATE = new Date().toISOString()
const fichierVersion = (): Plugin => ({
  name: 'cockpit-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION, date: DATE }) })
  },
})

// Servi sous https://rnab26.github.io/Cockpit-General/ (GitHub Pages) : la base doit
// être le nom du dépôt, sinon les assets sont cherchés à la racine du domaine.
export default defineConfig({
  base: '/Cockpit-General/',
  define: { __VERSION_APP__: JSON.stringify(VERSION), __DATE_APP__: JSON.stringify(DATE) },
  plugins: [react(), tailwindcss(), fichierVersion()],
  build: { outDir: 'dist', sourcemap: false },
})
