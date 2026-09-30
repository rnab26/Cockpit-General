import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Badge.tsx'
import { Textarea, Champ } from '../ui/Champs.tsx'
import { Vide } from '../ui/Etats.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { pairesDoublons } from '../lib/doublons.ts'
import { candidatsFusion, texteConfirmationFusion } from '../lib/fusion.ts'
import { infoEtat } from '../lib/etats.ts'
import { extrait } from '../lib/texte.ts'

const CLE_PREF = 'doublons_ignores'

/**
 * Vue Doublons : les paires de titres proches, CÔTE À CÔTE, fusion validée à
 * la main avec une note (D-06). « Pas un doublon » est mémorisé.
 */
export function Doublons({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { chantiers, sections, par, prefs, poser, recharger } = useCockpit()
  const toast = useToast()
  const ignorees = useMemo(() => new Set(Array.isArray(prefs[CLE_PREF]) ? (prefs[CLE_PREF] as string[]) : []), [prefs])
  const ouverts = useMemo(() => chantiers.filter((c) => !c.archived_at && c.etat !== 'valide'), [chantiers])
  const paires = useMemo(() => pairesDoublons(ouverts, ignorees), [ouverts, ignorees])
  const [garder, setGarder] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [enCours, setEnCours] = useState<string | null>(null)
  const nomSection = (c: Chantier) => sections.find((s) => s.id === c.section_id)?.nom ?? 'Sans section'

  const fusionner = async (cle: string, a: Chantier, b: Chantier) => {
    const cibleId = garder[cle] ?? a.id
    const cible = cibleId === a.id ? a : b, source = cibleId === a.id ? b : a
    setEnCours(cle)
    const { error } = await supabase.rpc('fusionner_chantiers', { p_source: source.id, p_cible: cible.id, p_par: par, p_note: notes[cle]?.trim() || null })
    setEnCours(null)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${source.titre} » fusionné dans « ${cible.titre} ».`); await recharger()
  }
  const ignorer = async (cle: string) => {
    try { await poser(CLE_PREF, [...ignorees, cle]); toast.succes('Noté : cette paire ne sera plus proposée.') }
    catch (e) { toast.erreur((e as Error).message) }
  }

  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre={`Doublons${paires.length ? ` (${paires.length})` : ''}`} large pied={<Button onClick={onFermer}>Fermer</Button>}>
      {!paires.length ? <Vide titre="Aucun doublon repéré" texte={ignorees.size ? `${ignorees.size} paire${ignorees.size > 1 ? 's' : ''} marquée${ignorees.size > 1 ? 's' : ''} « pas un doublon ».` : 'Les titres des chantiers ouverts ne se ressemblent pas.'} /> : (
        <div className="space-y-4">
          {paires.map(({ a, b, score, cle }) => {
            const choix = garder[cle] ?? a.id
            return (
              <div key={cle} className="rounded-2xl border border-bord p-3" data-testid="paire-doublon">
                <p className="mb-2 text-xs text-texte-2">Ressemblance {Math.round(score * 100)} % · coche celui qu’on garde</p>
                <div className="grid grid-cols-2 gap-2">
                  {[a, b].map((c) => (
                    <button key={c.id} type="button" onClick={() => setGarder({ ...garder, [cle]: c.id })}
                      className={`rounded-xl border-2 p-2 text-left text-sm ${choix === c.id ? 'border-accent bg-accent/8' : 'border-bord'}`}>
                      <div className="mb-1 flex items-center gap-1 text-xs font-semibold">{choix === c.id ? <><Check size={14} className="text-ok" aria-hidden />On garde</> : 'Fusionné dedans'}</div>
                      <div className="font-semibold leading-snug">{c.titre}</div>
                      <div className="mt-1"><Badge teinte={infoEtat(c.etat).teinte}>{infoEtat(c.etat).libelle}</Badge></div>
                      <div className="mt-1 text-xs text-texte-2">{nomSection(c)} · {c.priorite}</div>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-texte-2">{extrait(c.demande, 220) || '(pas de demande)'}</p>
                    </button>
                  ))}
                </div>
                <Textarea className="mt-2" rows={2} value={notes[cle] ?? ''} onChange={(e) => setNotes({ ...notes, [cle]: e.target.value })} placeholder="Note sur la fusion (facultative)" />
                <div className="mt-2 flex justify-end gap-2">
                  <Button taille="sm" onClick={() => ignorer(cle)}>Pas un doublon</Button>
                  <Button taille="sm" variante="primaire" chargement={enCours === cle} onClick={() => fusionner(cle, a, b)}>Fusionner</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}

/** « Fusionner avec… » (menu ⋯ du fil) : chercher le chantier à garder, confirmer, fusionner. Même fonction de base que la carte « Fusionner ». */
export function DoublonDe({ source, onFermer }: { source: Chantier | null; onFermer: () => void }) {
  const { chantiers, messages, par, recharger } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [cible, setCible] = useState('')
  const [recherche, setRecherche] = useState('')
  const [note, setNote] = useState('')
  const [enCours, setEnCours] = useState(false)
  const candidats = useMemo(() => (source ? candidatsFusion(chantiers, source, recherche) : []), [chantiers, source, recherche])
  const tous = useMemo(() => (source ? candidatsFusion(chantiers, source) : []), [chantiers, source])
  const fermer = () => { setCible(''); setRecherche(''); setNote(''); onFermer() }
  const fusionner = async () => {
    const gardee = chantiers.find((c) => c.id === cible)
    if (!source || !gardee) { toast.erreur('Choisis le chantier à garder.'); return }
    const n = messages.filter((m) => m.chantier_id === source.id).length
    const ok = await confirmer({ titre: 'Fusionner ces deux chantiers ?', libelleOk: 'Fusionner',
      texte: <p>{texteConfirmationFusion(source.titre, gardee.titre, n)}</p> })
    if (!ok) return
    setEnCours(true)
    const { error } = await supabase.rpc('fusionner_chantiers', { p_source: source.id, p_cible: gardee.id, p_par: par, p_note: note.trim() || null })
    setEnCours(false)
    if (error) { toast.erreur(`Fusion impossible : ${messageErreur(error)}`); return }
    toast.succes(`« ${source.titre} » fusionné dans « ${gardee.titre} ».`); fermer(); await recharger()
  }
  return (
    <Dialog ouvert={!!source} onFermer={fermer} titre="Fusionner avec…" brouillon={!!note.trim()}
      pied={<><Button onClick={fermer}>Annuler</Button><Button variante="primaire" chargement={enCours} disabled={!cible} onClick={fusionner} data-testid="fusion-valider">Fusionner</Button></>}>
      <div data-testid="dialogue-fusion">
        <p className="mb-3 text-sm text-texte-2">« <b>{source?.titre}</b> » sera archivé comme doublon ; sa demande et ses messages rejoignent le chantier que tu gardes.</p>
        {!tous.length ? <p className="text-sm text-texte-2" data-testid="fusion-vide">Aucun autre chantier ouvert dans ce projet.</p> : (
          <>
            <Champ label="Chantier à garder">
              <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un chantier…" aria-label="Chercher un chantier" data-testid="fusion-recherche"
                className="w-full rounded-xl border border-bord bg-carte px-3 py-2.5 text-[15px]" />
            </Champ>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto" data-testid="fusion-liste">
              {!candidats.length ? <li className="px-1 py-2 text-sm text-texte-2" data-testid="fusion-aucun">Aucun chantier ne correspond à « {recherche} ».</li> : candidats.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setCible(c.id)} aria-pressed={cible === c.id} data-testid="fusion-choix"
                    className={`flex w-full items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm ${cible === c.id ? 'border-accent bg-accent/8' : 'border-bord'}`}>
                    {cible === c.id ? <Check size={15} className="shrink-0 text-ok" aria-hidden /> : null}<span className="font-medium leading-snug">{c.titre}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Champ label="Note (facultative)" className="mt-3"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
          </>
        )}
      </div>
    </Dialog>
  )
}
