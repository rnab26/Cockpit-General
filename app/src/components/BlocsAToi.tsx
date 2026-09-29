import { useState, type ReactNode } from 'react'
import { Compass, GitMerge, LockOpen, OctagonAlert, Play } from 'lucide-react'
import type { Chantier, Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { dateRelative } from '../lib/dates.ts'

/**
 * Les bulles « à toi » d'une conversation qui ne sont ni une question ni une
 * vérification : à cadrer, bloqué, fusion proposée. Écrire passe par la barre
 * du bas de la conversation — une seule façon d'écrire à Claude.
 */

/** Admin : une fois la décision donnée ou le blocage levé, rendre le chantier « libre » pour qu'une session le prenne. */
function BoutonPretALancer({ chantier, libelle, icone }: { chantier: Chantier; libelle: string; icone: ReactNode }) {
  const { admin, recharger } = useCockpit()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  if (!admin) return null
  return (
    <Button taille="sm" chargement={enCours} data-testid="pret-a-lancer" className="h-auto! min-h-9 whitespace-normal! py-1.5 leading-tight" onClick={async () => {
      setEnCours(true)
      const { error } = await supabase.from('chantiers').update({ etat: 'libre' }).eq('id', chantier.id)
      setEnCours(false)
      if (error) { toast.erreur(messageErreur(error)); return }
      toast.succes(`« ${chantier.titre} » est prêt : il passe dans « Prêt à lancer ».`)
      await recharger()
    }}>{icone}{libelle}</Button>
  )
}

const CADRE = 'space-y-2 rounded-2xl border border-l-4 border-bord bg-carte p-3'

/** « À cadrer » : Claude attend ta décision avant de commencer. */
export function BlocCadrer({ chantier }: { chantier: Chantier }) {
  return (
    <div data-testid="bloc-cadrer" className={`${CADRE} border-l-info`}>
      <p className="flex items-center gap-1.5 text-[15px] font-medium"><Compass size={16} className="text-info" aria-hidden />Ta décision avant de coder</p>
      <p className="text-sm text-texte-2">Écris en bas ce que tu veux (et ce que tu ne veux pas). Quand c’est clair, dis que c’est prêt.</p>
      <BoutonPretALancer chantier={chantier} libelle="C’est décidé : prêt à lancer" icone={<Play size={16} aria-hidden />} />
    </div>
  )
}

/** « Bloqué » : ce qui bloque (dernier message « blocage » du fil). */
export function BlocBloque({ chantier, blocage }: { chantier: Chantier; blocage: Message | null }) {
  const { now } = useCockpit()
  return (
    <div data-testid="bloc-bloque" className={`${CADRE} border-l-alerte`}>
      <p className="flex items-center gap-1.5 text-[15px] font-medium"><OctagonAlert size={16} className="text-alerte" aria-hidden />Claude est bloqué{blocage ? <span className="text-xs font-normal text-texte-2">{dateRelative(blocage.created_at, now)}</span> : null}</p>
      {blocage ? <p className="whitespace-pre-wrap text-[15px] leading-snug">{blocage.corps}</p>
        : <p className="text-sm text-texte-2">Il n’a pas dit pourquoi : demande-le en bas.</p>}
      <p className="text-sm text-texte-2">Réponds en bas : ce que tu as fait, ou ce qu’il faut faire.</p>
      <BoutonPretALancer chantier={chantier} libelle="Débloqué : prêt à lancer" icone={<LockOpen size={16} aria-hidden />} />
    </div>
  )
}

/**
 * Claude propose de fusionner (0008) : deux chantiers qui sont le même sujet ;
 * Raphaël accepte ou refuse d'un toucher. Réversible (historique), donc pas de
 * confirmation en plus : le toast le dit.
 */
export function BlocFusion({ message }: { message: Message }) {
  const { admin, par, recharger } = useCockpit()
  const toast = useToast()
  const [enCours, setEnCours] = useState<'oui' | 'non' | null>(null)
  const fusion = message.options?.[0]
  const trancher = async (fusionner: boolean) => {
    setEnCours(fusionner ? 'oui' : 'non')
    const { error } = await supabase.rpc('trancher_fusion', { p_message: message.id, p_fusionner: fusionner, p_par: admin ? 'Raphaël' : par })
    setEnCours(null)
    if (error) { toast.erreur(`Rien n’a été fait : ${messageErreur(error)}`); return }
    toast.succes(fusionner ? 'Fusionné : tout est passé dans le chantier gardé, rien n’est perdu (historique).' : 'Gardés séparés : cette suggestion ne reviendra pas.')
    await recharger()
  }
  return (
    <div data-testid="bloc-fusion" className={`${CADRE} border-l-info`}>
      <p className="flex items-center gap-1.5 text-xs text-texte-2"><GitMerge size={14} className="text-info" aria-hidden />Claude propose de fusionner</p>
      <p className="whitespace-pre-wrap text-[15px] font-medium leading-snug">{message.corps}</p>
      {message.pourquoi ? <p className="whitespace-pre-wrap text-sm text-texte-2">{message.pourquoi}</p> : null}
      {fusion?.aide ? <p className="text-xs text-texte-2">{fusion.aide}</p> : null}
      {admin ? (
        <div className="grid grid-cols-2 gap-2">
          <Button chargement={enCours === 'oui'} disabled={!!enCours} onClick={() => trancher(true)} data-testid="fusionner" className="h-auto! min-h-10 whitespace-normal! py-1.5 leading-tight">Fusionner</Button>
          <Button chargement={enCours === 'non'} disabled={!!enCours} onClick={() => trancher(false)} data-testid="garder-separes" className="h-auto! min-h-10 whitespace-normal! py-1.5 leading-tight">Garder séparés</Button>
        </div>
      ) : <p className="text-xs text-texte-2">Raphaël décidera.</p>}
    </div>
  )
}
