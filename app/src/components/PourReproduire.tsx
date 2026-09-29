import { useMemo } from 'react'
import { ExternalLink, Repeat } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'
import { Repliable } from '../ui/Repliable.tsx'
import { lireReproduction } from '../lib/reproduction.ts'
import { dateLongue } from '../lib/dates.ts'

/**
 * « Pour reproduire » (D-05) : ce que le site a capturé quand l'utilisateur a
 * envoyé sa demande (page, appareil, version, ses dernières actions, les
 * erreurs de la page), replié, en mots simples, avec « Rejouer » qui rouvre la
 * page d'origine dans un nouvel onglet. Rien s'il n'y a pas de capture.
 */
export function PourReproduire({ chantier }: { chantier: Chantier }) {
  const vue = useMemo(() => lireReproduction(chantier.reproduction), [chantier.reproduction])
  if (!vue) return null
  const ligne = (etiquette: string, valeur: string | null | undefined, testId?: string) => valeur
    ? <p className="text-sm" data-testid={testId}><span className="text-texte-2">{etiquette} : </span><span className="break-words">{valeur}</span></p>
    : null
  return (
    <Repliable testId="pour-reproduire" titre={<span className="flex items-center gap-1.5 text-sm font-medium"><Repeat size={16} className="text-texte-2" aria-hidden />Pour reproduire</span>}>
      <div className="space-y-1">
        <p className="text-xs text-texte-2">{vue.moment}{vue.heure ? `, ${dateLongue(vue.heure)}` : ''}</p>
        {ligne('Page', vue.pageTitre || vue.url, 'repro-page')}
        {vue.pageTitre && vue.url ? <p className="break-all text-xs text-texte-2">{vue.url}</p> : null}
        {ligne('Appareil', vue.appareil, 'repro-appareil')}
        {ligne('Langue', vue.langue)}
        {ligne('Version du site', vue.version ?? 'inconnue (le site n’expose pas /health)', 'repro-version')}
        {vue.etapes.length ? (
          <div className="pt-1">
            <p className="text-xs font-medium text-texte-2">Ce qu’il a fait juste avant :</p>
            <ol className="mt-1 space-y-1 text-sm" data-testid="repro-etapes">
              {vue.etapes.map((e, i) => (
                <li key={i} className="flex gap-2" data-testid="repro-etape">
                  <span className="w-5 shrink-0 text-right font-bold text-accent">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">{e.texte}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : <p className="text-sm text-texte-2">Aucune action notée avant la demande.</p>}
        {vue.erreurs.length ? (
          <div className="pt-1" data-testid="repro-erreurs">
            <p className="text-xs font-medium text-alerte">Erreurs de la page ({vue.erreurs.length}) :</p>
            <ul className="mt-1 space-y-1">
              {vue.erreurs.map((e, i) => <li key={i} className="break-words rounded-lg bg-carte-2 px-2 py-1 font-mono text-xs">{e}</li>)}
            </ul>
          </div>
        ) : null}
        {vue.url ? (<>
          <a href={vue.url} target="_blank" rel="noopener noreferrer" data-testid="rejouer"
            className="mt-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-bord bg-carte px-3.5 text-[15px] font-medium text-texte hover:bg-carte-2">
            <ExternalLink size={16} aria-hidden />Rejouer : ouvrir la page
          </a>
          <p className="text-xs text-texte-2">Ouvre la page d’origine ; refais ensuite les étapes ci-dessus.</p>
        </>) : null}
      </div>
    </Repliable>
  )
}
