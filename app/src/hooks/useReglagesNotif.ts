import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { lireReglages, REGLAGES_VIDES, type ReglagesNotif, type TypeNotif } from '../lib/notifications.ts'

/** Types et projets voulus, par personne (table notif_reglages, ses lignes seulement : RLS). */
export function useReglagesNotif(userId: string | null) {
  const [types, setTypes] = useState<TypeNotif[]>([])
  const [reglages, setReglages] = useState<ReglagesNotif>(REGLAGES_VIDES)
  const [etat, setEtat] = useState<'chargement' | 'ok' | 'erreur'>('chargement')
  const [erreur, setErreur] = useState('')
  const [essai, setEssai] = useState(0)
  const file = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!userId) return
    let vivant = true
    setEtat('chargement')
    void (async () => {
      const [t, r] = await Promise.all([
        supabase.from('notif_types').select('code, libelle, aide, defaut, emis, ordre').order('ordre'),
        supabase.from('notif_reglages').select('types, projets_coupes').eq('user_id', userId).maybeSingle(),
      ])
      if (!vivant) return
      if (t.error || r.error) { setErreur(messageErreur((t.error ?? r.error)!)); setEtat('erreur'); return }
      setTypes((t.data ?? []) as TypeNotif[])
      setReglages(lireReglages(r.data))
      setEtat('ok')
    })()
    return () => { vivant = false }
  }, [userId, essai])

  /** Pose le nouveau réglage ; l'écran suit tout de suite, et revient en arrière si la base refuse (l'erreur est levée). */
  const enregistrer = useCallback(async (suivant: ReglagesNotif) => {
    if (!userId) return
    const avant = reglages
    setReglages(suivant)
    const ecrire = async () => {
      const { error } = await supabase.from('notif_reglages')
        .upsert({ user_id: userId, types: suivant.types, projets_coupes: suivant.projets_coupes, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (error) { setReglages(avant); throw new Error(messageErreur(error)) }
    }
    const suite = file.current.catch(() => {}).then(ecrire)
    file.current = suite
    await suite
  }, [userId, reglages])

  return { types, reglages, etat, erreur, enregistrer, recharger: () => setEssai((n) => n + 1) }
}
