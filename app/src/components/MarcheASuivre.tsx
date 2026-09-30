import { useState } from 'react'
import { Check, ClipboardCopy, ExternalLink } from 'lucide-react'
import { useToast } from '../ui/Toast.tsx'
import { copierTexte } from '../lib/copier.ts'
import { domaineDe, type MarcheASuivre as Marche } from '../lib/marche.ts'

/**
 * La marche à suivre d'une action manuelle (0033, chantier e9a7c360) :
 * Raphaël, 30 sept. 2026 : « des liens précis et les démarches précises pour
 * faire simplement des copier-coller ». Dans l'ordre où il agit : le bouton
 * vers la page EXACTE (nouvel onglet, domaine affiché), les gestes numérotés,
 * puis chaque texte à coller avec son bouton « Copier » (qui dit s'il a
 * réussi). La capture, s'il y en a une, est déjà affichée au-dessus.
 */
export function MarcheASuivre({ marche }: { marche: Marche }) {
  const toast = useToast()
  const [copie, setCopie] = useState<number | null>(null)
  const copier = async (i: number) => {
    const c = marche.copier[i]
    if (await copierTexte(c.texte)) { setCopie(i); toast.succes(`« ${c.libelle} » copié : colle-le où l’étape le dit.`) }
    else toast.erreur('Copie impossible ici : appuie longuement sur le texte pour le sélectionner.')
  }
  return (
    <div data-testid="marche-a-suivre" className="mt-3 flex flex-col gap-3">
      {marche.liens.length ? (
        <div className="flex flex-col gap-2">
          {marche.liens.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" data-testid="marche-lien"
              className="flex min-h-12 items-center gap-2 rounded-xl border border-accent/60 bg-accent/5 px-3 py-2 text-accent hover:bg-accent/10">
              <ExternalLink size={18} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{l.libelle}</span>
                <span className="block truncate text-xs text-texte-2">{domaineDe(l.url)}</span>
              </span>
            </a>
          ))}
        </div>
      ) : null}
      {marche.etapes.length ? (
        <ol data-testid="marche-etapes" className="flex flex-col gap-1.5">
          {marche.etapes.map((e, i) => (
            <li key={i} className="flex gap-2 text-[15px] leading-snug">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-carte-2 text-xs font-semibold text-texte-2">{i + 1}</span>
              <span className="min-w-0 break-words">{e}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {marche.copier.map((c, i) => (
        <div key={i} data-testid="marche-copier" className="rounded-xl border border-bord bg-carte-2 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-texte-2">{c.libelle}</span>
            <button type="button" onClick={() => void copier(i)} data-testid="marche-copier-bouton"
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-bord bg-carte px-2.5 text-sm font-medium hover:bg-carte-2 active:scale-[.98]">
              {copie === i ? <Check size={15} aria-hidden className="text-ok" /> : <ClipboardCopy size={15} aria-hidden />}
              {copie === i ? 'Copié' : 'Copier'}
            </button>
          </div>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-snug select-all">{c.texte}</pre>
        </div>
      ))}
    </div>
  )
}
