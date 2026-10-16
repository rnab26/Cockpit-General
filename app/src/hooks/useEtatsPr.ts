import { useEffect, useMemo, useState } from 'react'
import { lireJalons, prCitees, type EtatsPr } from '../lib/jalons.ts'

/**
 * « Cette PR est-elle fusionnée ? » lu sur GitHub (16 oct. 2026) : l'étape « PR #n pas encore fusionnée » écrite par
 * une session n'était jamais relue et restait affichée des jours après la fusion. Lecture anonyme (dépôts publics) ;
 * dépôt privé ou illisible = rien n'est dit (on ne devine pas). Une PR fusionnée ne change plus : gardée pour la session ;
 * une PR ouverte est relue au plus toutes les 5 minutes.
 */
const VALIDITE_OUVERTE_MS = 5 * 60_000
const lus = new Map<string, { etat: 'merged' | 'open' | 'closed'; at: number }>()
const enCours = new Map<string, Promise<void>>()

async function lire(depot: string, n: number): Promise<void> {
  const cle = `${depot}#${n}`
  const connu = lus.get(cle)
  if (connu && (connu.etat === 'merged' || Date.now() - connu.at < VALIDITE_OUVERTE_MS)) return
  const deja = enCours.get(cle)
  if (deja) return deja
  const p = (async () => {
    try {
      const r = await fetch(`https://api.github.com/repos/${depot}/pulls/${n}`, { headers: { Accept: 'application/vnd.github+json' } })
      if (r.status !== 200) return
      const o = await r.json() as { merged_at?: string | null; state?: string }
      lus.set(cle, { etat: o.merged_at ? 'merged' : o.state === 'closed' ? 'closed' : 'open', at: Date.now() })
    } catch { /* hors ligne : rien n'est dit */ }
  })().finally(() => { enCours.delete(cle) })
  enCours.set(cle, p)
  return p
}

function lecture(cle: string | null, prs: number[]): EtatsPr | undefined {
  if (!cle || !prs.length) return undefined
  const o: Record<number, 'merged' | 'open' | 'closed'> = {}
  for (const n of prs) { const c = lus.get(`${cle}#${n}`); if (c) o[n] = c.etat }
  return Object.keys(o).length ? o : undefined
}

/** Les PR citées par la raison « pas en ligne » des jalons, avec leur état lu sur GitHub (undefined tant que rien n'est lu). */
export function useEtatsPr(depot: string | null | undefined, jalons: unknown): EtatsPr | undefined {
  const raison = lireJalons(jalons).pas_en_ligne?.detail ?? null
  const prs = useMemo(() => prCitees(raison), [raison])
  const cle = depot?.trim() || null
  const [etats, setEtats] = useState<EtatsPr | undefined>(() => lecture(cle, prs))
  useEffect(() => {
    if (!cle || !prs.length) { setEtats(undefined); return }
    setEtats(lecture(cle, prs))
    let vivant = true
    void Promise.all(prs.map((n) => lire(cle, n))).then(() => { if (vivant) setEtats(lecture(cle, prs)) })
    return () => { vivant = false }
  }, [cle, prs])
  return etats
}
