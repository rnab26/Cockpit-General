import type { Activite } from '../lib/types.ts'
import { etaLisible, dateRelative } from '../lib/dates.ts'
import { nomCourtSession } from '../lib/texte.ts'

/**
 * La barre d'avancement d'un chantier. Deux visages, et jamais l'un pour
 * l'autre (capture de Raphaël, 29 sept. 2026 : des barres orange à 85 % sans
 * personne derrière) :
 *  - `vive` (preuve de vie récente, presence.ts) : verte, animée, l'étape,
 *    l'ETA, la session, « il y a 2 min » ;
 *  - sinon : fine et GRISE, « dernier avancement connu : 85 % (il y a 5 h) ».
 * `legende={false}` : la barre seule (la ligne du dessus dit déjà le reste).
 */
export function Progression({ activite, vive, compact = false, legende = true, now = new Date() }: {
  activite: Activite; vive: boolean; compact?: boolean; legende?: boolean; now?: Date
}) {
  const pct = Math.max(0, Math.min(100, activite.pourcentage))
  const eta = etaLisible(activite.eta_secondes)
  const echec = activite.statut === 'echec'
  const quand = dateRelative(activite.updated_at, now)
  // 0087 : la session n'a donné AUCUN pourcentage (barre alimentée par le hook) : on n'invente pas « 0 % »,
  // on montre une barre en mouvement et ce qu'elle fait à l'instant.
  const sansPct = activite.pct_estime === false && pct === 0
  const enDirect = activite.action_live && dateRelative(activite.action_live_at ?? activite.updated_at, now) ? activite.action_live : null
  const texteLegende = enDirect ?? activite.etape
  if (vive && sansPct) {
    return (
      <div className="mt-1.5" data-testid="progression" data-vive="oui" data-sans-pct="oui">
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-ok/15" role="progressbar" aria-label="Au travail, avancement non estimé">
            <div className="barre-vive h-full w-1/3 animate-pulse rounded-full bg-ok" />
          </div>
          <span className="shrink-0 text-right text-xs font-semibold text-ok">au travail</span>
        </div>
        {legende ? (
          <div className={`mt-0.5 flex items-baseline justify-between gap-2 text-texte-2 ${compact ? 'text-xs' : 'text-sm'}`}>
            <span className="min-w-0 truncate">{texteLegende}</span>
            <span className="shrink-0 tabular-nums">{compact ? '' : `${nomCourtSession(activite.session)} · `}{quand}</span>
          </div>
        ) : null}
      </div>
    )
  }
  if (vive) {
    return (
      <div className="mt-1.5" data-testid="progression" data-vive="oui">
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-ok/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement en direct">
            <div className="barre-vive h-full rounded-full bg-ok transition-[width] duration-700" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <span className="w-11 shrink-0 text-right text-sm font-bold tabular-nums text-ok">{pct} %</span>
        </div>
        {legende ? (
          <div className={`mt-0.5 flex items-baseline justify-between gap-2 text-texte-2 ${compact ? 'text-xs' : 'text-sm'}`}>
            <span className="min-w-0 truncate">{enDirect ? `${activite.etape} · ${enDirect}` : activite.etape}</span>
            <span className="shrink-0 tabular-nums">{eta ? `reste ${eta} · ` : ''}{compact ? '' : `${nomCourtSession(activite.session)} · `}{quand}</span>
          </div>
        ) : null}
      </div>
    )
  }
  const statut = activite.statut === 'termine' ? 'terminé' : echec ? 'échec' : null
  return (
    <div className="mt-1.5" data-testid="progression" data-vive="non">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-carte-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Dernier avancement connu">
          <div className={`h-full rounded-full ${echec ? 'bg-alerte/70' : 'bg-texte-2/35'}`} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <span className={`w-11 shrink-0 text-right text-xs font-semibold tabular-nums ${echec ? 'text-alerte' : 'text-texte-2'}`}>{pct} %</span>
      </div>
      {legende ? (
        <p className={`mt-0.5 text-texte-2 ${compact ? 'line-clamp-2 text-xs' : 'text-sm'}`}>
          dernier avancement connu : {pct} %{quand ? ` (${quand})` : ''}{statut ? ` · ${statut}` : ''}{activite.etape ? ` — ${activite.etape}` : ''}
        </p>
      ) : null}
    </div>
  )
}
