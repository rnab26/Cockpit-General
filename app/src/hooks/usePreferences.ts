import { useCallback, useEffect, useRef, useState } from 'react'
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

  // Écritures sérialisées PAR CLÉ : deux gestes rapides ne lancent pas deux upsert concurrents
  // (la première requête pouvait finir après la seconde et rétablir l'ancien état). Ordre respecté, la dernière valeur gagne.
  const files = useRef(new Map<string, Promise<unknown>>())
  const poser = useCallback((cle: string, valeur: unknown): Promise<void> => {
    if (!userId) return Promise.resolve()
    setPrefs((p) => ({ ...p, [cle]: valeur }))
    const ecrire = async () => {
      const { error } = await supabase.from('preferences')
        .upsert({ user_id: userId, cle, valeur, updated_at: new Date().toISOString() }, { onConflict: 'user_id,cle' })
      if (error) throw new Error(messageErreur(error))
    }
    const suite = (files.current.get(cle) ?? Promise.resolve()).catch(() => {}).then(ecrire)
    files.current.set(cle, suite)
    return suite
  }, [userId])

  return { prefs, poser, chargees }
}
