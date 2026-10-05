import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'

/** Le prochain passage de la chef du projet (réveil horaire), relu toutes les 5 min. null : aucun connu. */
export function useProchainPassage(projetId: string, cle: string = ''): string | null {
  const [quand, setQuand] = useState<string | null>(null)
  useEffect(() => {
    if (!projetId) return
    let vivant = true
    const lire = async () => {
      const { data, error } = await supabase.rpc('prochain_passage_chef', { p_projet_id: projetId })
      if (vivant && !error) setQuand(typeof data === 'string' ? data : null)
    }
    void lire()
    const t = window.setInterval(lire, 5 * 60_000)
    return () => { vivant = false; window.clearInterval(t) }
  }, [projetId, cle])
  return quand
}
