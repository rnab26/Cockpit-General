import { ExternalLink } from 'lucide-react'
import { liensDuTexte, segmentsAvecLiens } from '../lib/commentVerifier.ts'

/** Un texte dont les adresses http(s) deviennent des liens (nouvel onglet). */
export function TexteAvecLiens({ texte }: { texte: string }) {
  return <>{segmentsAvecLiens(texte).map((s, i) => s.lien
    ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-accent underline underline-offset-2">{s.texte}</a>
    : <span key={i}>{s.texte}</span>)}</>
}

/**
 * Les adresses à ouvrir, en gros boutons (nouvel onglet, domaine affiché : on voit où on va avant de toucher).
 * `deja` = adresses déjà proposées ailleurs sur la carte (la marche à suivre) : jamais deux fois le même bouton.
 */
export function LiensAOuvrir({ textes, deja = [], testId = 'liens-a-ouvrir' }: { textes: readonly (string | null | undefined)[]; deja?: readonly string[]; testId?: string }) {
  const liens = liensDuTexte(textes).filter((l) => !deja.includes(l.url))
  if (!liens.length) return null
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid={testId}>
      {liens.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" data-testid="lien-a-ouvrir"
          className="flex min-h-12 items-center gap-2 rounded-xl border border-accent/60 bg-accent/5 px-3 py-2 text-accent hover:bg-accent/10">
          <ExternalLink size={18} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Ouvrir {l.domaine}</span>
            <span className="block truncate text-xs text-texte-2">{l.url}</span>
          </span>
        </a>
      ))}
    </div>
  )
}
