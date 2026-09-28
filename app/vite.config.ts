import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Servi sous https://rnab26.github.io/Cockpit-General/ (GitHub Pages) : la base doit
// être le nom du dépôt, sinon les assets sont cherchés à la racine du domaine.
export default defineConfig({
  base: '/Cockpit-General/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
})
