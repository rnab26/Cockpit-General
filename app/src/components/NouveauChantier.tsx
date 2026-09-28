import { useMemo, useState } from 'react'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Champ, Input, Select, Textarea } from '../ui/Champs.tsx'
import { ETATS, PRIORITES, infoEtat } from '../lib/etats.ts'
import { titresProches } from '../lib/doublons.ts'
import type { Etat, Priorite } from '../lib/types.ts'

/** Créer un chantier. Un utilisateur non admin crée une demande « à trier » (la RLS l'impose). */
export function NouveauChantier({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { admin, projet, sections, chantiers, recharger, moi } = useCockpit()
  const toast = useToast()
  const [titre, setTitre] = useState('')
  const [demande, setDemande] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [priorite, setPriorite] = useState<Priorite>('normale')
  const [etat, setEtat] = useState<Etat>('a_trier')
  const [enCours, setEnCours] = useState(false)
  const proches = useMemo(() => titresProches(titre, chantiers).slice(0, 3), [titre, chantiers])

  const reinitialiser = () => { setTitre(''); setDemande(''); setSectionId(''); setPriorite('normale'); setEtat('a_trier') }
  const creer = async () => {
    if (!titre.trim()) { toast.erreur('Donne un titre.'); return }
    setEnCours(true)
    const { error } = await supabase.from('chantiers').insert({
      projet_id: projet.id, titre: titre.trim(), demande: demande.trim() || null,
      section_id: sectionId || null, priorite,
      etat: admin ? etat : 'a_trier', origine: admin ? 'proprietaire' : 'utilisateur', created_by: moi.user_id,
    })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(admin ? `Chantier « ${titre.trim()} » créé.` : 'Demande envoyée : elle apparaît « Pas encore examinée ».')
    reinitialiser(); onFermer(); await recharger()
  }

  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre={admin ? '+ Nouveau chantier' : '+ Nouvelle demande'}
      pied={<><Button onClick={onFermer}>Annuler</Button><Button variante="primaire" chargement={enCours} onClick={creer} data-testid="creer-chantier">Créer</Button></>}>
      <div className="space-y-3">
        <Champ label="Titre"><Input autoFocus value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="En une phrase : ce qu’il faut faire" data-testid="titre" /></Champ>
        {proches.length ? (
          <div className="rounded-xl border border-attention/50 bg-attention/8 px-3 py-2 text-sm" data-testid="ca-existe-deja">
            <p className="font-semibold text-attention">⚠️ Ça existe déjà, peut-être :</p>
            <ul className="mt-1 space-y-0.5">
              {proches.map((p) => <li key={p.id}>• {p.titre} <span className="text-texte-2">({infoEtat(p.etat).libelle}{p.archived_at ? ', archivé' : ''})</span></li>)}
            </ul>
            <p className="mt-1 text-xs text-texte-2">Tu peux créer quand même.</p>
          </div>
        ) : null}
        <Champ label="Demande" aide="Tes mots : ce que tu veux, ce qui ne va pas, comment le reproduire.">
          <Textarea rows={4} value={demande} onChange={(e) => setDemande(e.target.value)} data-testid="demande" />
        </Champ>
        <div className="grid grid-cols-2 gap-3">
          <Champ label="Section">
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Sans section</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </Select>
          </Champ>
          <Champ label="Priorité">
            <Select value={priorite} onChange={(e) => setPriorite(e.target.value as Priorite)}>
              {PRIORITES.map((p) => <option key={p.priorite} value={p.priorite}>{p.libelle}</option>)}
            </Select>
          </Champ>
        </div>
        {admin ? (
          <Champ label="État de départ">
            <Select value={etat} onChange={(e) => setEtat(e.target.value as Etat)}>
              {ETATS.filter((e) => e.etat !== 'valide').map((e) => <option key={e.etat} value={e.etat}>{e.libelle}</option>)}
            </Select>
          </Champ>
        ) : <p className="text-xs text-texte-2">Ta demande arrive « ⏳ Pas encore examinée » ; Raphaël la trie, une session la prend, et tu certifies quand c’est livré.</p>}
      </div>
    </Dialog>
  )
}
