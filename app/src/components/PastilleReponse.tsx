import { useEffect } from 'react'
import { MessageCircleReply } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { PREF_LU_FILS, lireLus, nouveauLu } from '../lib/lecture.ts'
import type { Message } from '../lib/types.ts'

/**
 * « Claude a répondu » : pastille rouge visible sur la carte / la ligne du fil
 * tant que la réponse n'est pas lue (règle : lib/lecture.ts).
 */
export function PastilleReponse({ cle, className = '' }: { cle: string; className?: string }) {
  const { nonLus } = useGlobal()
  const x = nonLus.get(cle)
  if (!x) return null
  return (
    <span data-testid="pastille-reponse" data-nombre={x.n} role="status" aria-label={`${x.n} réponse${x.n > 1 ? 's' : ''} de Claude à lire`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-alerte px-2 py-0.5 text-xs font-semibold text-white ${className}`}>
      <MessageCircleReply size={13} aria-hidden />{x.n > 1 ? `${x.n} réponses` : 'Réponse'}
    </span>
  )
}

/** Ouvrir un fil = le lire : marque « lu jusqu'à » son dernier message (et à chaque message arrivé pendant qu'il est ouvert). */
export function useMarquerLu(cle: string, fil: readonly Pick<Message, 'created_at'>[], prefs: Record<string, unknown>, poser: (cle: string, valeur: unknown) => Promise<void>) {
  const lus = lireLus(prefs[PREF_LU_FILS])
  const nv = nouveauLu(fil, cle, lus)
  useEffect(() => {
    if (nv) void poser(PREF_LU_FILS, { ...lus, [cle]: nv }).catch(() => {})
  }, [nv]) // eslint-disable-line react-hooks/exhaustive-deps
}
