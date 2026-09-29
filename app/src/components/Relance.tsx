import { useMemo, useState } from 'react'
import { Check, CircleHelp, ClipboardCopy, Hourglass } from 'lucide-react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { consigneClaude } from '../lib/presence.ts'
import { chantierTenu, etapesOuEnEst, etatOuEnEst, type EtatOuEnEst } from '../lib/ouEnEst.ts'
import { extrait } from '../lib/texte.ts'

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
  const { projet, messages, activites, taches, par, now, silenceMs, recharger } = useCockpit()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  const [repli, setRepli] = useState<string | null>(null)
  // Où en est sa dernière demande, recalculé à chaque message qui arrive en direct (0022).
  const etat = useMemo(() => {
    const tenus = (id: string) => chantierTenu(id, activites, taches, now, silenceMs)
    return etatOuEnEst(chantier, messages, tenus(chantier.id), now, tenus)
  }, [chantier, messages, activites, taches, now, silenceMs])

  const copier = async () => {
    const texte = consigneClaude(chantier, projet.slug)
    if (await copierTexte(texte)) { setRepli(null); toast.succes(`Consigne copiée : colle-la dans une session Claude du projet ${projet.nom}.`) }
    else { setRepli(texte); toast.info('Copie automatique impossible ici : sélectionne le texte affiché et copie-le.') }
  }
  const demander = async () => {
    // Une demande déjà en attente : rien ne repart (la base le refuse aussi, 0022).
    if (enCours || etat?.enAttente) return
    setEnCours(true)
    const { data, error } = await supabase.rpc('demander_ou_en_est', { p_chantier: chantier.id, p_par: par })
    if (error) { setEnCours(false); toast.erreur(`La demande n’est pas partie : ${messageErreur(error)}`); return }
    await recharger()
    setEnCours(false)
    if ((data as { deja?: boolean } | null)?.deja) toast.info('Déjà demandé : on attend sa réponse, rien n’est renvoyé.')
    else toast.succes('Demande envoyée : suis-la ici, elle se met à jour toute seule.')
  }
  const attente = !!etat?.enAttente

  return (
    <div data-testid="relance">
      <div className="grid grid-cols-2 gap-2">
        <Button taille="sm" onClick={copier} data-testid="copier-consigne" className="h-auto! min-h-9 whitespace-normal! py-1.5 text-[13px] leading-tight"><ClipboardCopy size={15} aria-hidden />Copier la consigne</Button>
        <Button taille="sm" chargement={enCours} disabled={attente} onClick={demander} data-testid="demander-ou-ca-en-est" data-attente={attente ? 'oui' : 'non'}
          aria-label={attente ? 'Demande en cours : on attend sa réponse' : undefined}
          className="h-auto! min-h-9 whitespace-normal! py-1.5 text-[13px] leading-tight">
          {attente ? <Hourglass size={15} aria-hidden /> : <CircleHelp size={15} aria-hidden />}
          {attente ? 'Demande en cours' : etat ? 'Redemander où ça en est' : 'Demander où ça en est'}
        </Button>
      </div>
      {etat ? <SuiviOuEnEst etat={etat} /> : null}
      {repli ? (
        <textarea readOnly value={repli} rows={4} autoFocus onFocus={(e) => e.currentTarget.select()} data-testid="consigne-a-copier"
          className="mt-2 w-full rounded-xl border border-bord bg-carte-2 px-3 py-2 text-sm" aria-label="Consigne à copier" />
      ) : null}
    </div>
  )
}

/**
 * Où en est sa demande « Où ça en est ? » : une frise de trois étapes
 * (Envoyée → Reçue / En file / Assistant → Réponse) et une phrase, qui
 * bougent toutes seules à chaque message reçu en direct.
 */
export function SuiviOuEnEst({ etat, compact = false }: { etat: EtatOuEnEst; compact?: boolean }) {
  const etapes = etapesOuEnEst(etat)
  const fini = etat.code === 'repondue'
  const teinte = fini ? 'text-ok' : etat.code === 'sans_reponse' ? 'text-attention' : 'text-info'
  return (
    <div className={compact ? '' : 'mt-2'} data-testid="etat-ou-en-est" data-code={etat.code} data-position={etat.position ?? ''}>
      {compact ? null : (
        <ol className="flex items-center gap-1 text-[11px] text-texte-2" aria-label="Où en est ta demande">
          {etapes.map((e, i) => {
            const n = i + 1
            // Atteinte : coche ; « sans réponse » : point d'attention ; la suivante, si on attend : point qui pulse.
            const ko = etat.code === 'sans_reponse' && n === 2
            const fait = n <= etat.etape && !ko
            const ici = etat.enAttente && n === etat.etape + 1
            return (
              <li key={e} className="flex min-w-0 items-center gap-1" data-etape={fait ? 'faite' : ici ? 'en-cours' : ko ? 'ko' : 'a-venir'}>
                {i ? <span className={`h-px w-3 shrink-0 ${n <= etat.etape ? 'bg-texte-2/60' : 'bg-bord'}`} aria-hidden /> : null}
                <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${fait ? 'border-ok bg-ok/10 text-ok' : ko ? 'border-attention text-attention' : ici ? 'border-info text-info' : 'border-bord'}`} aria-hidden>
                  {fait ? <Check size={10} /> : ko ? <span className="text-[10px] font-bold leading-none">!</span> : ici ? <span className="point-vivant h-1.5 w-1.5 rounded-full bg-current" /> : null}
                </span>
                <span className={`truncate ${fait ? 'text-texte' : ko ? 'text-attention' : ici ? 'text-info' : ''}`} aria-current={ici ? 'step' : undefined}>{e}</span>
              </li>
            )
          })}
        </ol>
      )}
      <p className={`${compact ? '' : 'mt-1'} text-xs leading-snug ${teinte}`} data-testid="libelle-ou-en-est">{etat.libelle}</p>
      {fini && etat.reponse && !compact ? <p className="mt-0.5 text-xs leading-snug text-texte-2" data-testid="reponse-ou-en-est">« {extrait(etat.reponse.corps, 160)} »</p> : null}
    </div>
  )
}
