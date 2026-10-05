import { RefreshCw, X } from 'lucide-react'
import { appliquerMiseAJour, ecarterBanniere, useMajAuto, useSuiviVersion, useVersion } from '../hooks/useNouvelleVersion.ts'

/**
 * Bandeau « Nouvelle version du cockpit » (30 sept. 2026) : un correctif mis
 * en ligne n'arrive pas dans une app déjà ouverte tant qu'elle ne se recharge
 * pas. « Mettre à jour » désinscrit le service worker, vide ses caches et
 * recharge en forçant le réseau. « Plus tard » l'écarte pour le délai de
 * rappel (Réglages, 1 h par défaut) puis elle revient ; au prochain lancement
 * aussi. Mise à jour automatique possible en réglage (5 oct. 2026).
 */
export function NouvelleVersion() {
  useSuiviVersion()
  useMajAuto()
  const v = useVersion()
  if (!v.banniere) return null
  return (
    <div className="fixed inset-x-0 top-[max(env(safe-area-inset-top),8px)] z-50 flex justify-center px-3" data-testid="nouvelle-version">
      <div className="flex max-w-md items-center gap-1 rounded-full border border-bord bg-carte py-1 pl-3 pr-1 text-sm shadow-lg" role="status">
        <span className="min-w-0 truncate">Nouvelle version du cockpit</span>
        <button type="button" onClick={() => void appliquerMiseAJour()} disabled={v.enCours} data-testid="mettre-a-jour"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 font-medium text-accent-fg hover:opacity-90 disabled:opacity-60">
          <RefreshCw size={14} className={v.enCours ? 'animate-spin' : ''} aria-hidden />{v.enCours ? 'Mise à jour…' : 'Mettre à jour'}
        </button>
        <button type="button" onClick={ecarterBanniere} aria-label="Plus tard" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-texte-2 hover:bg-carte-2">
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}
