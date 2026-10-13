import { useCallback, useEffect, useState } from 'react'
import { GitMerge, GitPullRequestClosed, TriangleAlert } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { phraseRapprochement, ROLE_RAPPROCHEMENT, type EtatRapprochement } from '../lib/rapprochement.ts'

/**
 * « Chantiers et GitHub » (0080, 13 oct. 2026). Raphaël : « mes chantiers ne sont pas à jour » : des sessions s'arrêtaient sans dire
 * « terminé », alors que leur travail était fusionné dans GitHub. Le cockpit lit maintenant ce qui s'est passé dans git (à l'ouverture
 * d'une session) et passe « livré, à vérifier » les chantiers que plus personne ne tient et dont le travail est PROUVÉ dans main.
 * Premier niveau : le rôle en une phrase, UN état, l'interrupteur. Chaque chantier passé tout seul garde la preuve dans son fil.
 */
export function RapprochementGithub({ projet }: { projet: Projet }) {
  const toast = useToast()
  const [etat, setEtat] = useState<EtatRapprochement | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_rapprochement', { p_projet: projet.slug })
    if (error) { setErreur(messageErreur(error)); return }
    setErreur(null); setEtat(data as EtatRapprochement | null)
  }, [projet.slug])
  useEffect(() => { void charger() }, [charger])

  const regler = async (auto: boolean) => {
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_rapprochement', { p_projet: projet.slug, p_auto: auto })
    setEnvoi(false)
    if (error) { toast.erreur(`Réglage non enregistré : ${messageErreur(error)}`); return }
    toast.succes(auto ? 'Rapprochement avec GitHub rallumé sur ce projet.' : 'Rapprochement avec GitHub éteint sur ce projet.')
    await charger()
  }

  if (erreur) return (
    <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5 text-xs" data-testid="rapprochement-erreur">
      <p className="text-alerte">Chantiers et GitHub indisponible : {erreur}</p>
      <Button taille="sm" className="mt-2" onClick={() => void charger()}>Réessayer</Button>
    </section>
  )
  if (!etat) return <p className="px-1 text-xs text-texte-2" role="status" data-testid="rapprochement-chargement">Chargement de « Chantiers et GitHub »…</p>
  const ph = phraseRapprochement(etat)
  const Icone = ph.ton === 'eteint' ? GitPullRequestClosed : ph.ton === 'erreur' ? TriangleAlert : GitMerge
  const teinte = ph.ton === 'ok' ? 'text-ok' : ph.ton === 'erreur' ? 'text-alerte' : ph.ton === 'attente' ? 'text-accent' : 'text-texte-2'
  return (
    <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="rapprochement-github" data-ton={ph.ton}>
      <h3 className="text-sm font-semibold">Chantiers et GitHub</h3>
      <p className="text-xs leading-snug text-texte-2" data-testid="rapprochement-role">{ROLE_RAPPROCHEMENT}</p>
      <div className="mt-2 flex items-start gap-2">
        <Icone size={16} className={`mt-0.5 shrink-0 ${teinte}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium leading-snug ${ph.ton === 'erreur' ? 'text-alerte' : ''}`} data-testid="rapprochement-titre">{ph.titre}</p>
          <p className="text-xs leading-snug text-texte-2" data-testid="rapprochement-detail">{ph.detail}</p>
        </div>
        <Button taille="sm" variante="discret" chargement={envoi} data-testid="rapprochement-interrupteur" onClick={() => void regler(!etat.auto)}>
          {etat.auto ? 'Éteindre' : 'Rallumer'}
        </Button>
      </div>
    </section>
  )
}
