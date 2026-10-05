import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { preparerInstallation } from './hooks/useInstallation.ts'
import { preparerVue } from './hooks/useVue.ts'

preparerInstallation()
preparerVue()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
