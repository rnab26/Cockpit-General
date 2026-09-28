import { useState } from 'react'
import type { Section } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Champ, Input, Select } from '../ui/Champs.tsx'

/** Sections (admin) : créer, renommer, décrire, monter/descendre, supprimer, fusionner. */
export function Sections({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { sections, chantiers, projet, recharger } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [nouveau, setNouveau] = useState('')
  const [edition, setEdition] = useState<{ id: string; nom: string; description: string } | null>(null)
  const [fusion, setFusion] = useState<{ source: string; cible: string }>({ source: '', cible: '' })
  const [enCours, setEnCours] = useState(false)
  const nb = (s: Section) => chantiers.filter((c) => c.section_id === s.id).length

  const executer = async (fn: () => Promise<{ error: unknown }>, succes: string) => {
    setEnCours(true)
    const { error } = await fn()
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return false }
    toast.succes(succes); await recharger(); return true
  }

  const creer = () => nouveau.trim() && executer(
    () => supabase.from('sections').insert({ projet_id: projet.id, nom: nouveau.trim(), position: (sections.at(-1)?.position ?? 0) + 1 }),
    `Section « ${nouveau.trim()} » créée.`).then((ok) => { if (ok) setNouveau('') })

  const enregistrer = () => edition && executer(
    () => supabase.from('sections').update({ nom: edition.nom.trim(), description: edition.description.trim() || null }).eq('id', edition.id),
    'Section modifiée.').then((ok) => { if (ok) setEdition(null) })

  const deplacer = async (s: Section, sens: -1 | 1) => {
    const i = sections.findIndex((x) => x.id === s.id)
    const voisin = sections[i + sens]
    if (!voisin) return
    // Les positions peuvent être égales (import) : on réécrit les deux en les échangeant, distinctes.
    const pa = s.position, pb = voisin.position
    const [na, nb2] = pa === pb ? (sens < 0 ? [pb - 1, pb] : [pb + 1, pb]) : [pb, pa]
    await executer(async () => {
      const r1 = await supabase.from('sections').update({ position: na }).eq('id', s.id)
      if (r1.error) return r1
      return supabase.from('sections').update({ position: nb2 }).eq('id', voisin.id)
    }, 'Ordre modifié.')
  }

  const supprimer = async (s: Section) => {
    const n = nb(s)
    const ok = await confirmer({ titre: `Supprimer la section « ${s.nom} » ?`, danger: true, libelleOk: 'Supprimer',
      texte: n ? `Ses ${n} chantier${n > 1 ? 's' : ''} repassent « Sans section » — aucun n’est supprimé.` : 'Elle est vide.' })
    if (!ok) return
    await executer(() => supabase.from('sections').delete().eq('id', s.id), `Section « ${s.nom} » supprimée.`)
  }

  const fusionner = async () => {
    const src = sections.find((s) => s.id === fusion.source), cib = sections.find((s) => s.id === fusion.cible)
    if (!src || !cib || src.id === cib.id) { toast.erreur('Choisis deux sections différentes.'); return }
    const ok = await confirmer({ titre: `Fusionner « ${src.nom} » dans « ${cib.nom} » ?`, libelleOk: 'Fusionner',
      texte: `Les ${nb(src)} chantier${nb(src) > 1 ? 's' : ''} de « ${src.nom} » passent dans « ${cib.nom} », puis « ${src.nom} » est supprimée.` })
    if (!ok) return
    await executer(async () => {
      const r = await supabase.from('chantiers').update({ section_id: cib.id }).eq('section_id', src.id)
      if (r.error) return r
      return supabase.from('sections').delete().eq('id', src.id)
    }, 'Sections fusionnées.')
    setFusion({ source: '', cible: '' })
  }

  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre="🗂️ Sections" pied={<Button onClick={onFermer}>Fermer</Button>}>
      <div className="space-y-4">
        <ul className="space-y-2">
          {sections.map((s, i) => (
            <li key={s.id} className="rounded-xl border border-bord p-2">
              {edition?.id === s.id ? (
                <div className="space-y-2">
                  <Input value={edition.nom} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} aria-label="Nom" />
                  <Input value={edition.description} onChange={(e) => setEdition({ ...edition, description: e.target.value })} placeholder="Description (facultative)" aria-label="Description" />
                  <div className="flex justify-end gap-2"><Button taille="sm" onClick={() => setEdition(null)}>Annuler</Button><Button taille="sm" variante="primaire" chargement={enCours} onClick={enregistrer}>Enregistrer</Button></div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{s.nom} <span className="text-xs font-normal text-texte-2">· {nb(s)}</span></div>
                    {s.description ? <div className="truncate text-xs text-texte-2">{s.description}</div> : null}
                  </div>
                  <Button taille="sm" variante="discret" aria-label="Monter" disabled={i === 0 || enCours} onClick={() => deplacer(s, -1)}>↑</Button>
                  <Button taille="sm" variante="discret" aria-label="Descendre" disabled={i === sections.length - 1 || enCours} onClick={() => deplacer(s, 1)}>↓</Button>
                  <Button taille="sm" variante="discret" onClick={() => setEdition({ id: s.id, nom: s.nom, description: s.description ?? '' })}>✏️</Button>
                  <Button taille="sm" variante="discret" className="text-alerte" aria-label="Supprimer" onClick={() => supprimer(s)}>🗑️</Button>
                </div>
              )}
            </li>
          ))}
          {!sections.length ? <li className="text-sm text-texte-2">Aucune section : les chantiers sont tous « Sans section ».</li> : null}
        </ul>
        <div className="flex gap-2">
          <Input value={nouveau} onChange={(e) => setNouveau(e.target.value)} placeholder="Nouvelle section" onKeyDown={(e) => { if (e.key === 'Enter') void creer() }} />
          <Button variante="primaire" chargement={enCours} disabled={!nouveau.trim()} onClick={() => void creer()}>Créer</Button>
        </div>
        {sections.length >= 2 ? (
          <div className="rounded-xl bg-carte-2 p-3">
            <p className="mb-2 text-sm font-semibold">Fusionner deux sections</p>
            <div className="grid grid-cols-2 gap-2">
              <Champ label="Celle qui disparaît"><Select value={fusion.source} onChange={(e) => setFusion({ ...fusion, source: e.target.value })}><option value="">—</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</Select></Champ>
              <Champ label="Dans"><Select value={fusion.cible} onChange={(e) => setFusion({ ...fusion, cible: e.target.value })}><option value="">—</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}</Select></Champ>
            </div>
            <div className="mt-2 flex justify-end"><Button taille="sm" chargement={enCours} disabled={!fusion.source || !fusion.cible} onClick={fusionner}>Fusionner</Button></div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
