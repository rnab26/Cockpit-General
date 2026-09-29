import { useMemo } from 'react'
import { Check, Circle, ExternalLink, Info, X } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { frise, syntheseMiseEnLigne } from '../lib/jalons.ts'

// Des marques fines, colorées seulement quand elles disent quelque chose (fait, échec).
const MARQUE = { fait: Check, attente: Circle, echec: X, info: Info }
const COULEUR_MARQUE = { fait: 'text-ok', attente: 'text-texte-2/50', echec: 'text-alerte', info: 'text-info' }

/**
 * La frise « Codé → Envoyé → Vérifié par les robots → En ligne »
 * (jalons posés par la session, migration 0007). Rien pour un ancien
 * chantier sans jalon. Étapes pas encore atteintes : grises.
 */
export function FriseMiseEnLigne({ chantier }: { chantier: Chantier }) {
  const { now } = useCockpit()
  const etapes = useMemo(() => frise(chantier.jalons, now), [chantier.jalons, now])
  if (!etapes) return null
  return (
    <ol className="space-y-1 rounded-lg border border-bord bg-carte px-3 py-2" data-testid="frise-en-ligne" aria-label="Mise en ligne">
      {etapes.map((e) => (
        <li key={e.cle} data-testid="etape-en-ligne" data-etat={e.etat} className="flex items-start gap-2 text-sm leading-snug">
          {(() => { const M = MARQUE[e.etat]; return <M size={16} strokeWidth={e.etat === 'fait' ? 2.5 : 2} aria-hidden className={`mt-px shrink-0 ${COULEUR_MARQUE[e.etat]}`} /> })()}
          <span className={`min-w-0 flex-1 ${e.etat === 'attente' ? 'text-texte-2/70' : e.etat === 'echec' ? 'font-medium text-alerte' : ''}`}>
            {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline underline-offset-2">{e.libelle}<ExternalLink size={13} aria-hidden /></a> : e.libelle}
          </span>
          {e.heure ? <span className="shrink-0 text-xs tabular-nums text-texte-2">{e.heure}</span> : null}
        </li>
      ))}
    </ol>
  )
}

// Texte coloré sur fond neutre, liseré à gauche (29 sept. : fini les pavés teintés).
const TEINTE = { ok: 'border-l-ok text-ok', attention: 'border-l-attention text-attention', alerte: 'border-l-alerte text-alerte', info: 'border-l-info text-info' }

/** La phrase au-dessus de « Ça fonctionne » : peut-il vérifier maintenant ? */
export function PhraseMiseEnLigne({ chantier }: { chantier: Chantier }) {
  const { now } = useCockpit()
  const s = useMemo(() => syntheseMiseEnLigne(chantier.jalons, now), [chantier.jalons, now])
  if (!s) return null
  return <p data-testid="phrase-en-ligne" data-code={s.code} className={`rounded-lg border border-l-4 border-bord bg-carte px-3 py-2 text-[15px] font-medium leading-snug ${TEINTE[s.teinte]}`}>{s.texte}</p>
}
