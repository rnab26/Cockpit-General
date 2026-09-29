import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Projet } from '../lib/types.ts'
import { etatDuProjet, phraseSite, type ExecutionGitHub, type LectureSite } from '../lib/deploiement.ts'

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

// Version servie par le site lui-même (`<url_site>/health` -> { commit }) :
// seul moyen de voir « en ligne » pour un site hors GitHub (FacePro sur Render)
// ou un dépôt privé. Même cache partagé et même rythme que GitHub.
const SITE_VIDE: LectureSite & { chargement: boolean } = { commit: null, lu: null, erreur: null, chargement: false }
const cacheSite = new Map<string, LectureSite & { chargement: boolean }>()

async function chargerSite(url: string): Promise<void> {
  const avant = cacheSite.get(url) ?? SITE_VIDE
  if (avant.chargement) return
  cacheSite.set(url, { ...avant, chargement: true }); prevenir()
  let suite: LectureSite & { chargement: boolean }
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/health`, { cache: 'no-store' })
    const j = r.ok ? await r.json() as { commit?: string } : null
    suite = j?.commit
      ? { commit: j.commit, lu: Date.now(), erreur: null, chargement: false }
      : { ...avant, chargement: false, erreur: r.ok ? 'Le site ne dit pas quelle version il sert.' : `Le site n’a pas répondu (erreur ${r.status}).` }
  } catch {
    suite = { ...avant, chargement: false, erreur: 'Site injoignable (en redémarrage ?).' }
  }
  cacheSite.set(url, suite); prevenir()
}

function useSite(url: string | null): LectureSite & { chargement: boolean } {
  const e = useSyncExternalStore((f) => { auditeurs.add(f); return () => { auditeurs.delete(f) } }, () => (url ? cacheSite.get(url) : undefined) ?? SITE_VIDE)
  useEffect(() => {
    if (!url) return
    const siPerime = () => {
      if (document.visibilityState !== 'visible') return
      const c = cacheSite.get(url)
      if (!c?.lu || Date.now() - c.lu >= RAFRAICHISSEMENT_MS - 1000) void chargerSite(url)
    }
    siPerime()
    const t = window.setInterval(siPerime, RAFRAICHISSEMENT_MS)
    document.addEventListener('visibilitychange', siPerime)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', siPerime) }
  }, [url])
  return e
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
  const urlSite = projet.url_site?.trim() || null
  const site = useSite(urlSite)
  const ligneSite = phraseSite(site, now)
  // Dépôt privé ou site hors GitHub : l'erreur GitHub n'est plus une alerte
  // quand le site dit lui-même ce qui est en ligne.
  const erreurDiscrete = !!(e.erreur && !e.runs && site.commit)
  const synthese = useMemo(() => (e.runs ? etatDuProjet(e.runs, 'main', now) : null), [e.runs, now])
  const couleur = erreurDiscrete ? 'text-ok' : synthese?.etat === 'en_cours' ? 'text-info' : synthese?.etat === 'echoue' ? 'text-alerte' : synthese?.etat === 'reussi' ? 'text-ok' : 'text-texte-2'
  return (
    <div data-testid="deploiement" data-etat={synthese?.etat ?? (erreurDiscrete ? 'site' : e.erreur ? 'erreur' : 'chargement')} className="text-sm">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} disabled={!synthese?.lignes.length}
          className={`min-w-0 flex-1 text-left font-semibold leading-snug ${couleur}`} data-testid="deploiement-titre">
          {synthese?.enCours ? <span className="point-vivant mr-1.5 inline-block h-2 w-2 rounded-full bg-info align-middle" aria-hidden /> : null}
          {synthese ? synthese.titre : erreurDiscrete ? ligneSite : e.erreur ? `⚠️ ${e.erreur}` : 'Lecture de GitHub…'}
          {synthese?.lignes.length ? <span className="ml-1 text-xs font-normal text-texte-2">{ouvert ? '▲' : '▼'}</span> : null}
        </button>
        <button type="button" onClick={() => { void charger(depot); if (urlSite) void chargerSite(urlSite) }} aria-label="Relire" title="Relire GitHub et le site" data-testid="deploiement-relire"
          className={`shrink-0 rounded-lg px-1.5 text-texte-2 hover:bg-carte-2 ${e.chargement || site.chargement ? 'animate-spin' : ''}`}>↻</button>
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
      {ligneSite && !erreurDiscrete ? <p className="text-xs text-texte-2" data-testid="deploiement-site">{ligneSite}</p> : null}
      {erreurDiscrete ? <p className="text-[11px] text-texte-2" data-testid="deploiement-site">Mise en ligne en cours : non visible ici (dépôt privé ou hébergeur hors GitHub) — seule la version servie par le site l’est.</p> : null}
    </div>
  )
}
