import { useMemo } from 'react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { frise, syntheseMiseEnLigne } from '../lib/jalons.ts'

const MARQUE = { fait: '✓', attente: '○', echec: '✕', info: 'ℹ' }
const COULEUR_MARQUE = { fait: 'bg-ok text-white', attente: 'border border-bord text-texte-2/60', echec: 'bg-alerte text-white', info: 'bg-info text-white' }

/**
 * La frise « ✍️ Codé → 📤 Envoyé → 🤖 Vérifié par les robots → 🌐 En ligne »
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
          <span aria-hidden className={`mt-px inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${COULEUR_MARQUE[e.etat]}`}>{MARQUE[e.etat]}</span>
          <span className={`min-w-0 flex-1 ${e.etat === 'attente' ? 'text-texte-2/70' : e.etat === 'echec' ? 'font-semibold text-alerte' : 'font-medium'}`}>
            {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{e.libelle} ↗</a> : e.libelle}
          </span>
          {e.heure ? <span className="shrink-0 text-xs tabular-nums text-texte-2">{e.heure}</span> : null}
        </li>
      ))}
    </ol>
  )
}

const TEINTE = { ok: 'border-ok/50 bg-ok/10 text-ok', attention: 'border-attention/50 bg-attention/10 text-attention', alerte: 'border-alerte/50 bg-alerte/10 text-alerte', info: 'border-info/50 bg-info/10 text-info' }

/** La phrase au-dessus de « Ça fonctionne » : peut-il vérifier maintenant ? */
export function PhraseMiseEnLigne({ chantier }: { chantier: Chantier }) {
  const { now } = useCockpit()
  const s = useMemo(() => syntheseMiseEnLigne(chantier.jalons, now), [chantier.jalons, now])
  if (!s) return null
  return <p data-testid="phrase-en-ligne" data-code={s.code} className={`rounded-lg border px-3 py-2 text-[15px] font-semibold leading-snug ${TEINTE[s.teinte]}`}>{s.texte}</p>
}
