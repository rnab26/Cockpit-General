import { useEffect, useState } from 'react'
import type { Chantier, Etat, Priorite } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Champ, Input, Interrupteur, Select, Textarea } from '../ui/Champs.tsx'
import { ETATS, PRIORITES } from '../lib/etats.ts'

/** Modifier un chantier (admin). Chaque champ changé est tracé en base par le trigger. */
export function ModifierChantier({ chantier, onFermer }: { chantier: Chantier | null; onFermer: () => void }) {
  const { sections, recharger } = useCockpit()
  const toast = useToast()
  const [v, setV] = useState({ titre: '', demande: '', notes: '', resume_simple: '', comment_verifier: '', section_id: '', priorite: 'normale' as Priorite, etat: 'a_trier' as Etat, visible_utilisateurs: true })
  const [enCours, setEnCours] = useState(false)
  const initiales = (c: Chantier) => ({ titre: c.titre, demande: c.demande ?? '', notes: c.notes ?? '', resume_simple: c.resume_simple ?? '',
    comment_verifier: c.comment_verifier ?? '',
    section_id: c.section_id ?? '', priorite: c.priorite, etat: c.etat, visible_utilisateurs: c.visible_utilisateurs })
  useEffect(() => { if (chantier) setV(initiales(chantier)) }, [chantier])
  // Une modification pas encore enregistrée : toucher le fond ou Échap demande avant de la perdre.
  const brouillon = !!chantier && JSON.stringify(v) !== JSON.stringify(initiales(chantier))

  const enregistrer = async () => {
    if (!chantier) return
    if (!v.titre.trim()) { toast.erreur('Le titre ne peut pas être vide.'); return }
    setEnCours(true)
    const valeurs: Partial<Chantier> = {
      titre: v.titre.trim(), demande: v.demande.trim() || null, notes: v.notes.trim() || null, resume_simple: v.resume_simple.trim() || null,
      comment_verifier: v.comment_verifier.trim() || null,
      section_id: v.section_id || null, priorite: v.priorite, etat: v.etat, visible_utilisateurs: v.visible_utilisateurs,
    }
    if (v.etat === 'valide' && chantier.etat !== 'valide') { valeurs.valide_at = new Date().toISOString(); valeurs.archived_at = chantier.archived_at ?? new Date().toISOString() }
    if (v.etat !== 'valide' && chantier.etat === 'valide') { valeurs.valide_at = null; valeurs.valide_par = null; valeurs.archived_at = null }
    const { error } = await supabase.from('chantiers').update(valeurs).eq('id', chantier.id)
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes('Chantier modifié.'); onFermer(); await recharger()
  }

  return (
    <Dialog ouvert={!!chantier} onFermer={onFermer} titre="Modifier le chantier" brouillon={brouillon}
      pied={<><Button onClick={onFermer}>Annuler</Button><Button variante="primaire" chargement={enCours} onClick={enregistrer}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <Champ label="Titre"><Input value={v.titre} onChange={(e) => setV({ ...v, titre: e.target.value })} /></Champ>
        <Champ label="Demande"><Textarea rows={5} value={v.demande} onChange={(e) => setV({ ...v, demande: e.target.value })} /></Champ>
        <Champ label="Résumé en langage simple" aide="Ce qu’un utilisateur final comprendra une fois livré."><Textarea rows={2} value={v.resume_simple} onChange={(e) => setV({ ...v, resume_simple: e.target.value })} /></Champ>
        <Champ label="Comment vérifier (étapes pour Raphaël)" aide="Où aller, quoi toucher, ce qu’il doit voir. Une étape par ligne : « 1. … », « 2. … »."><Textarea rows={4} value={v.comment_verifier} onChange={(e) => setV({ ...v, comment_verifier: e.target.value })} data-testid="champ-comment-verifier" /></Champ>
        <Champ label="Notes de travail"><Textarea rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Champ>
        <div className="grid grid-cols-2 gap-3">
          <Champ label="Section">
            <Select value={v.section_id} onChange={(e) => setV({ ...v, section_id: e.target.value })}>
              <option value="">Sans section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </Select>
          </Champ>
          <Champ label="Priorité">
            <Select value={v.priorite} onChange={(e) => setV({ ...v, priorite: e.target.value as Priorite })}>{PRIORITES.map((p) => <option key={p.priorite} value={p.priorite}>{p.libelle}</option>)}</Select>
          </Champ>
        </div>
        <Champ label="État" aide={v.etat === 'valide' && chantier?.etat !== 'valide' ? 'Passer « Certifiée » à la main ne laisse pas de constat : préfère le bouton « Je certifie » sur la carte.' : undefined}>
          <Select value={v.etat} onChange={(e) => setV({ ...v, etat: e.target.value as Etat })}>{ETATS.map((e) => <option key={e.etat} value={e.etat}>{e.libelle}</option>)}</Select>
        </Champ>
        <Interrupteur actif={v.visible_utilisateurs} onChange={(b) => setV({ ...v, visible_utilisateurs: b })} label="Visible pour les utilisateurs finaux" />
      </div>
    </Dialog>
  )
}
