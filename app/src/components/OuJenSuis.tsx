import { useMemo } from 'react'
import { useCockpit } from '../contexte.ts'
import { ouJenSuis, type LigneOuJenSuis, type QuatreNombres } from '../lib/ouJenSuis.ts'
import { estFenetre, FENETRES, FENETRE_DEFAUT } from '../lib/fenetre.ts'

const COLONNES: { cle: keyof QuatreNombres; libelle: string; teinte: string }[] = [
  { cle: 'pourToi', libelle: 'pour toi', teinte: 'text-alerte' },
  { cle: 'bouge', libelle: 'bouge', teinte: 'text-attention' },
  { cle: 'dort', libelle: 'dort', teinte: 'text-texte-2' },
  { cle: 'livre', libelle: 'livré', teinte: 'text-ok' },
]

/** Quatre nombres par section. Compact : tient dans le premier écran avec le bandeau. */
export function OuJenSuis({ onOuvrirReglages }: { onOuvrirReglages: () => void }) {
  const { sections, chantiers, messages, prefs, poserFiltre } = useCockpit()
  const fenetre = estFenetre(prefs.fenetre_livre) ? prefs.fenetre_livre : FENETRE_DEFAUT
  const resume = useMemo(() => ouJenSuis(sections, chantiers, messages, fenetre), [sections, chantiers, messages, fenetre])
  const libelleFenetre = FENETRES.find((f) => f.valeur === fenetre)?.libelle.toLowerCase() ?? ''
  const nbExpirees = resume.total.expirees

  const filtrer = (l: LigneOuJenSuis | null, cle: keyof QuatreNombres) => {
    const ids = l ? l.ids[cle] : resume.lignes.flatMap((x) => x.ids[cle])
    const nom = l ? (l.section?.nom ?? 'Sans section') : 'Tout'
    poserFiltre({ libelle: `${nom} · ${COLONNES.find((c) => c.cle === cle)?.libelle ?? cle}`, ids: new Set(ids) })
  }

  return (
    <section data-testid="ou-jen-suis" className="rounded-2xl border border-bord bg-carte px-3 py-2">
      <div className="grid grid-cols-[1fr_repeat(4,2.6rem)] items-end gap-x-1 text-[11px] uppercase tracking-wide text-texte-2">
        <span className="pb-1 text-[13px] normal-case tracking-normal font-bold text-texte">Où j’en suis</span>
        {COLONNES.map((c) => <span key={c.cle} className="pb-1 text-center leading-tight">{c.libelle}</span>)}
      </div>
      {resume.lignes.map((l) => (
        <Ligne key={l.section?.id ?? 'sans'} nom={l.section?.nom ?? 'Sans section'} nombres={l.nombres} onTap={(cle) => filtrer(l, cle)} />
      ))}
      {resume.lignes.length > 1 ? <Ligne nom="Total" nombres={resume.total} total onTap={(cle) => filtrer(null, cle)} /> : null}
      {resume.lignes.length === 0 ? <p className="py-1 text-sm text-texte-2">Aucun chantier pour l’instant.</p> : null}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-texte-2">
        <button type="button" onClick={onOuvrirReglages} className="underline-offset-2 hover:underline">livré = {libelleFenetre} · changer</button>
        {nbExpirees ? (
          <button type="button" className="text-attention underline-offset-2 hover:underline"
            onClick={() => poserFiltre({ libelle: 'Réservations expirées', ids: new Set(resume.lignes.flatMap((x) => x.ids.expirees)) })}>
            ⚠️ {nbExpirees} réservation{nbExpirees > 1 ? 's' : ''} expirée{nbExpirees > 1 ? 's' : ''}
          </button>
        ) : null}
      </div>
    </section>
  )
}

function Ligne({ nom, nombres, total, onTap }: { nom: string; nombres: QuatreNombres; total?: boolean; onTap: (cle: keyof QuatreNombres) => void }) {
  return (
    <div className={`grid grid-cols-[1fr_repeat(4,2.6rem)] items-center gap-x-1 border-t border-bord/70 ${total ? 'font-bold' : ''}`}>
      <span className="truncate py-1 text-sm">{nom}</span>
      {COLONNES.map((c) => {
        const n = nombres[c.cle]
        return n ? (
          <button key={c.cle} type="button" onClick={() => onTap(c.cle)} aria-label={`${nom} : ${n} ${c.libelle}`}
            className={`h-8 rounded-lg text-center text-base font-bold tabular-nums hover:bg-carte-2 ${c.teinte}`}>{n}</button>
        ) : <span key={c.cle} className="h-8 text-center text-base leading-8 text-texte-2/40">·</span>
      })}
    </div>
  )
}
