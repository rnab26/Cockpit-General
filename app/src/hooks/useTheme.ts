import { useCallback, useEffect, useState } from 'react'

export type Theme = 'systeme' | 'clair' | 'sombre'
const CLE = 'cockpit_theme'

function lire(): Theme {
  try { const v = localStorage.getItem(CLE); return v === 'clair' || v === 'sombre' ? v : 'systeme' } catch { return 'systeme' }
}
function appliquer(t: Theme) {
  const sombre = t === 'sombre' || (t === 'systeme' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', sombre)
}

/** Thème clair/sombre : préférence système par défaut, réglage local (un thème n'a pas à suivre le compte). */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(lire)
  useEffect(() => {
    appliquer(theme)
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => { if (theme === 'systeme') appliquer(theme) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
  const changer = useCallback((t: Theme) => {
    setTheme(t)
    try { if (t === 'systeme') localStorage.removeItem(CLE); else localStorage.setItem(CLE, t) } catch { /* stockage indisponible : le thème tient pour la session */ }
  }, [])
  return [theme, changer]
}
