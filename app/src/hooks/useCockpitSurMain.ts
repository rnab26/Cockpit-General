import { useEffect, useState } from 'react'
import { lireCockpitSurMain, type CockpitSurMain } from '../lib/branchement.ts'

/**
 * « Le cockpit est-il installé sur la branche principale de ce dépôt ? » (14 oct. 2026, lib/branchement.ts) — lecture
 * ANONYME du fichier de réglages des hooks de `main` (raw.githubusercontent.com, dépôts publics), puis, seulement après un 404,
 * une seconde lecture pour savoir si le dépôt est public (un dépôt privé répond aussi 404 : on ne devine pas).
 * Une lecture par dépôt toutes les 10 minutes au plus, partagée par tous les écrans ; `null` tant qu'on n'a rien lu
 * (ou quand `depot` est nul : l'écran n'a pas à poser la question).
 */
const VALIDITE_MS = 10 * 60_000
const BRANCHE_PRINCIPALE = 'main'

const lus = new Map<string, { etat: CockpitSurMain; at: number }>()
const enCours = new Map<string, Promise<CockpitSurMain>>()

export async function lireSurMain(depot: string): Promise<CockpitSurMain> {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${depot}/${BRANCHE_PRINCIPALE}/.claude/settings.json`, { cache: 'no-store' })
    const texte = r.status === 200 ? await r.text() : null
    let depotPublic: boolean | null = null
    if (r.status === 404) {
      const api = await fetch(`https://api.github.com/repos/${depot}`, { headers: { Accept: 'application/vnd.github+json' } })
      depotPublic = api.status === 200 ? true : api.status === 404 ? false : null
    }
    return lireCockpitSurMain({ statut: r.status, texte, depotPublic })
  } catch {
    return 'inconnu'
  }
}

function lireUneFois(depot: string): Promise<CockpitSurMain> {
  const deja = enCours.get(depot)
  if (deja) return deja
  const p = lireSurMain(depot).then((etat) => { lus.set(depot, { etat, at: Date.now() }); return etat }).finally(() => { enCours.delete(depot) })
  enCours.set(depot, p)
  return p
}

export function useCockpitSurMain(depot: string | null | undefined): CockpitSurMain | null {
  const cle = depot?.trim() || null
  const [etat, setEtat] = useState<CockpitSurMain | null>(() => (cle ? lus.get(cle)?.etat ?? null : null))
  useEffect(() => {
    if (!cle) { setEtat(null); return }
    const connu = lus.get(cle)
    setEtat(connu?.etat ?? null)
    if (connu && Date.now() - connu.at < VALIDITE_MS) return
    let vivant = true
    void lireUneFois(cle).then((e) => { if (vivant) setEtat(e) })
    return () => { vivant = false }
  }, [cle])
  return etat
}
