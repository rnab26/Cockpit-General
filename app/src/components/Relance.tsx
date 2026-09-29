import { useMemo, useState } from 'react'
import { CircleHelp, ClipboardCopy } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { consigneClaude, derniereDemandeOuCaEnEst, MESSAGE_OU_CA_EN_EST } from '../lib/presence.ts'
import { dateRelative } from '../lib/dates.ts'

/** Copie un texte. Appelée DANS le gestionnaire du clic (exigence des navigateurs). */
async function copierTexte(texte: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texte); return true }
  } catch { /* refusé (contexte non sécurisé, permission) : repli ci-dessous */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texte; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

/**
 * Les deux gestes pour un chantier que personne ne tient : copier la consigne
 * à coller dans une session Claude du projet, ou poser « où ça en est ? »
 * dans le fil. Ses mots (29 sept.) : « je ne sais pas s'il faut que j'envoie
 * un message pour qu'une prochaine session la prenne ».
 */
export function BoutonsRelance({ chantier }: { chantier: Chantier }) {
  const { projet, messages, par, admin, now, recharger } = useCockpit()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  const [repli, setRepli] = useState<string | null>(null)
  const demande = useMemo(() => derniereDemandeOuCaEnEst(messages.filter((m) => m.chantier_id === chantier.id)), [messages, chantier.id])

  const copier = async () => {
    const texte = consigneClaude(chantier, projet.slug)
    if (await copierTexte(texte)) { setRepli(null); toast.succes(`Consigne copiée : colle-la dans une session Claude du projet ${projet.nom}.`) }
    else { setRepli(texte); toast.info('Copie automatique impossible ici : sélectionne le texte affiché et copie-le.') }
  }
  const demander = async () => {
    setEnCours(true)
    const { error } = await supabase.from('messages').insert({
      projet_id: projet.id, chantier_id: chantier.id, auteur: par,
      auteur_type: admin ? 'proprietaire' : 'utilisateur', kind: 'info', corps: MESSAGE_OU_CA_EN_EST,
    })
    setEnCours(false)
    if (error) { toast.erreur(`La question n’est pas partie : ${messageErreur(error)}`); return }
    toast.succes('Question posée dans le fil : la session qui reprendra ce chantier y répondra.')
    await recharger()
  }

  return (
    <div data-testid="relance">
      <div className="grid grid-cols-2 gap-2">
        <Button taille="sm" onClick={copier} data-testid="copier-consigne" className="h-auto! min-h-9 whitespace-normal! py-1.5 text-[13px] leading-tight"><ClipboardCopy size={15} aria-hidden />Copier la consigne</Button>
        <Button taille="sm" chargement={enCours} onClick={demander} data-testid="demander-ou-ca-en-est" className="h-auto! min-h-9 whitespace-normal! py-1.5 text-[13px] leading-tight"><CircleHelp size={15} aria-hidden />Demander où ça en est</Button>
      </div>
      {demande ? <p className="mt-1 text-xs text-texte-2" data-testid="deja-demande-ou">Demandé {dateRelative(demande.created_at, now)} — la réponse arrivera dans le fil.</p> : null}
      {repli ? (
        <textarea readOnly value={repli} rows={4} autoFocus onFocus={(e) => e.currentTarget.select()} data-testid="consigne-a-copier"
          className="mt-2 w-full rounded-xl border border-bord bg-carte-2 px-3 py-2 text-sm" aria-label="Consigne à copier" />
      ) : null}
    </div>
  )
}
