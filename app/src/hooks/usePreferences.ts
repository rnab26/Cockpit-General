import { useCallback, useEffect, useState } from 'react'
import { supabase, messageErreur } from '../lib/supabase.ts'

export type Preferences = Record<string, unknown>

/**
 * Préférences par personne (table cockpit.preferences) : fenêtre « livré »,
 * paires de doublons ignorées… Jamais une valeur en dur dans l'app.
 */
export function usePreferences(userId: string | null) {
  const [prefs, setPrefs] = useState<Preferences>({})
  const [chargees, setChargees] = useState(false)

  useEffect(() => {
    if (!userId) return
    let vivant = true
    // Filtre sur SOI : un admin voit aussi les préférences des autres (politique admin_tout),
    // et sans filtre le tri de Raphaël s'appliquait au compte de test (et inversement).
    supabase.from('preferences').select('cle, valeur').eq('user_id', userId).then(({ data }) => {
      if (!vivant || !data) { setChargees(true); return }
      setPrefs(Object.fromEntries(data.map((r: { cle: string; valeur: unknown }) => [r.cle, r.valeur])))
      setChargees(true)
    })
    return () => { vivant = false }
  }, [userId])

  const poser = useCallback(async (cle: string, valeur: unknown) => {
    if (!userId) return
    setPrefs((p) => ({ ...p, [cle]: valeur }))
    const { error } = await supabase.from('preferences')
      .upsert({ user_id: userId, cle, valeur, updated_at: new Date().toISOString() }, { onConflict: 'user_id,cle' })
    if (error) throw new Error(messageErreur(error))
  }, [userId])

  return { prefs, poser, chargees }
}
