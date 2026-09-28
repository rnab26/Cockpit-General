import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Projet } from '../lib/types.ts'
import { etatDuProjet, type ExecutionGitHub } from '../lib/deploiement.ts'

/**
 * « L'état du déploiement du site, ou s'il y a un déploiement en cours »
 * (Raphaël, 29 sept. 2026). Lu dans les exécutions GitHub Actions du dépôt du
 * projet, SANS jeton (dépôts publics) : GitHub en permet 60 par heure et par
 * adresse. D'où un cache partagé par dépôt (l'onglet « Tout » et la vue projet
 * ne font qu'une requête), un rafraîchissement toutes les 2 min SEULEMENT si
 * l'onglet est visible, et le bouton ↻.
 */
export const RAFRAICHISSEMENT_MS = 2 * 60_000

interface Etat { runs: ExecutionGitHub[] | null; erreur: string | null; chargement: boolean; at: number | null }
const VIDE: Etat = { runs: null, erreur: null, chargement: false, at: null }
const cache = new Map<string, Etat>()
const auditeurs = new Set<() => void>()
const prevenir = () => auditeurs.forEach((f) => f())

async function charger(depot: string): Promise<void> {
  const avant = cache.get(depot) ?? VIDE
  if (avant.chargement) return
  cache.set(depot, { ...avant, chargement: true }); prevenir()
  let suite: Etat
  try {
    const r = await fetch(`https://api.github.com/repos/${depot}/actions/runs?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } })
    if (r.status === 403 || r.status === 429) suite = { ...avant, chargement: false, at: Date.now(), erreur: 'GitHub limite les consultations sans compte (60 par heure) : réessaie dans quelques minutes.' }
    else if (r.status === 404) suite = { ...avant, chargement: false, at: Date.now(), erreur: `Dépôt « ${depot} » introuvable ou privé : GitHub ne le montre pas sans compte.` }
    else if (!r.ok) suite = { ...avant, chargement: false, at: Date.now(), erreur: `GitHub n’a pas répondu (erreur ${r.status}).` }
    else {
      const j = await r.json() as { workflow_runs?: ExecutionGitHub[] }
      suite = { runs: j.workflow_runs ?? [], erreur: null, chargement: false, at: Date.now() }
    }
  } catch {
    suite = { ...avant, chargement: false, at: Date.now(), erreur: 'GitHub n’a pas répondu (pas de réseau ?).' }
  }
  cache.set(depot, suite); prevenir()
}

function useEtatDepot(depot: string): Etat {
  return useSyncExternalStore((f) => { auditeurs.add(f); return () => { auditeurs.delete(f) } }, () => cache.get(depot) ?? VIDE)
}

/** Charge au montage si besoin, puis toutes les 2 min tant que l'onglet est visible. */
function useSuiviDepot(depot: string) {
  useEffect(() => {
    const siPerime = () => {
      if (document.visibilityState !== 'visible') return
      const e = cache.get(depot)
      if (!e?.at || Date.now() - e.at >= RAFRAICHISSEMENT_MS - 1000) void charger(depot)
    }
    siPerime()
    const t = window.setInterval(siPerime, RAFRAICHISSEMENT_MS)
    document.addEventListener('visibilitychange', siPerime)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', siPerime) }
  }, [depot])
}

export function EtatDeploiement({ projet, now }: { projet: Projet; now: Date }) {
  const depot = projet.depot?.trim() || null
  if (!depot) return null
  return <EtatDepot depot={depot} projet={projet} now={now} />
}

function EtatDepot({ depot, projet, now }: { depot: string; projet: Projet; now: Date }) {
  useSuiviDepot(depot)
  const e = useEtatDepot(depot)
  const [ouvert, setOuvert] = useState(false)
  const synthese = useMemo(() => (e.runs ? etatDuProjet(e.runs, 'main', now) : null), [e.runs, now])
  const couleur = synthese?.etat === 'en_cours' ? 'text-info' : synthese?.etat === 'echoue' ? 'text-alerte' : synthese?.etat === 'reussi' ? 'text-ok' : 'text-texte-2'
  return (
    <div data-testid="deploiement" data-etat={synthese?.etat ?? (e.erreur ? 'erreur' : 'chargement')} className="text-sm">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} disabled={!synthese?.lignes.length}
          className={`min-w-0 flex-1 text-left font-semibold leading-snug ${couleur}`} data-testid="deploiement-titre">
          {synthese?.enCours ? <span className="point-vivant mr-1.5 inline-block h-2 w-2 rounded-full bg-info align-middle" aria-hidden /> : null}
          {synthese ? synthese.titre : e.erreur ? `⚠️ ${e.erreur}` : 'Lecture de GitHub…'}
          {synthese?.lignes.length ? <span className="ml-1 text-xs font-normal text-texte-2">{ouvert ? '▲' : '▼'}</span> : null}
        </button>
        <button type="button" onClick={() => void charger(depot)} aria-label="Relire GitHub" title="Relire GitHub" data-testid="deploiement-relire"
          className={`shrink-0 rounded-lg px-1.5 text-texte-2 hover:bg-carte-2 ${e.chargement ? 'animate-spin' : ''}`}>↻</button>
      </div>
      {synthese && e.erreur ? <p className="text-xs text-attention">⚠️ {e.erreur} (état affiché : le dernier lu)</p> : null}
      {ouvert && synthese ? (
        <ul className="mt-1 space-y-1 border-l-2 border-bord pl-2" data-testid="deploiement-lignes">
          {synthese.lignes.map((l) => (
            <li key={l.nom} className="text-xs">
              <a href={l.lien} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2">{l.nom}</a>
              <span className="text-texte-2"> — {l.phrase} · {l.commit}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {projet.slug === 'facepro' ? <p className="text-[11px] text-texte-2">Le site FacePro est publié par Render : son déploiement n’est pas encore visible ici.</p> : null}
    </div>
  )
}
