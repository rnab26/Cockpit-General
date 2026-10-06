import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

/**
 * « N chantiers prêts » de chaque projet, LUS en base (cockpit.etat_prenables, 0065) : la règle
 * des chantiers prenables vit à un seul endroit. Admin seulement. `null` tant qu'on n'a rien reçu
 * (ou sans réseau et sans cache) : l'écran retombe alors sur sa copie locale (lib/autonome.ts).
 * Relu à chaque rechargement des données et toutes les minutes.
 */
export function usePrenables(admin: boolean, signal: unknown): Map<string, number> | null {
  const [m, setM] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!admin) return
    let vivant = true
    const lire = async () => {
      try {
        const { data, error } = await supabase.rpc('etat_prenables')
        if (!vivant || error || !Array.isArray(data)) return
        setM(new Map((data as { projet_id: string; n: number }[]).map((r) => [r.projet_id, Number(r.n)])))
      } catch { /* garde la dernière valeur */ }
    }
    void lire()
    const t = window.setInterval(() => { void lire() }, 60_000)
    return () => { vivant = false; window.clearInterval(t) }
  }, [admin, signal])
  return admin ? m : null
}
