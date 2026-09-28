import type { Activite } from '../lib/types.ts'
import { teinteProgression } from '../lib/etats.ts'
import { etaLisible, dateRelative } from '../lib/dates.ts'
import { nomCourtSession } from '../lib/texte.ts'

const COULEUR = { ok: 'bg-ok', attention: 'bg-attention', alerte: 'bg-alerte' }
const TEXTE = { ok: 'text-ok', attention: 'text-attention', alerte: 'text-alerte' }

/**
 * La barre du visuel FacePro : pleine largeur, pourcentage coloré à droite,
 * l'étape en sous-titre, l'ETA et la session en petit.
 */
export function Progression({ activite, compact = false, now = new Date() }: { activite: Activite; compact?: boolean; now?: Date }) {
  const teinte = teinteProgression(activite.pourcentage, activite.statut)
  const eta = etaLisible(activite.eta_secondes)
  const statutTexte = activite.statut === 'termine' ? 'terminé' : activite.statut === 'echec' ? 'échec' : activite.statut === 'attente' ? 'en attente' : null
  return (
    <div className="mt-1.5" data-testid="progression">
      <div className="flex items-center gap-2">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-carte-2" role="progressbar" aria-valuenow={activite.pourcentage} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-[width] duration-700 ${COULEUR[teinte]} ${activite.statut === 'en_cours' ? 'pulse' : ''}`} style={{ width: `${Math.max(2, Math.min(100, activite.pourcentage))}%` }} />
        </div>
        <span className={`w-12 shrink-0 text-right text-sm font-bold tabular-nums ${TEXTE[teinte]}`}>{activite.pourcentage} %</span>
      </div>
      <div className={`mt-0.5 flex items-baseline justify-between gap-2 text-texte-2 ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className="min-w-0 truncate">{activite.etape}{statutTexte ? ` · ${statutTexte}` : ''}</span>
        <span className="shrink-0 tabular-nums">{eta && activite.statut === 'en_cours' ? `${eta} · ` : ''}{nomCourtSession(activite.session)} · {dateRelative(activite.updated_at, now)}</span>
      </div>
    </div>
  )
}
