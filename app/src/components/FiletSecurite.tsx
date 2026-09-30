import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { phraseFilet, type EtatFiletBase } from '../lib/filet.ts'

/**
 * FILET DE SÉCURITÉ (0044) : la base surveille toute seule (pg_cron, toutes les 3 min) ;
 * du travail attend et rien de vivant ne le traite → elle réveille Claude par le réveil
 * immédiat. Cette ligne dit où ça en est, et règle l'interrupteur et le plafond du projet.
 */
export function FiletSecurite({ projet }: { projet: Projet }) {
  const toast = useToast()
  const [etat, setEtat] = useState<EtatFiletBase | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [regler, setRegler] = useState(false)
  const [plafond, setPlafond] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_filet', { p_projet: projet.slug })
    if (error) { setErreur(messageErreur(error)); return }
    setErreur(null); setEtat(data as EtatFiletBase | null)
  }, [projet.slug])
  useEffect(() => { void charger() }, [charger])

  const appliquer = async (args: { p_actif?: boolean; p_plafond?: number }, ok: string) => {
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_filet', { p_projet: projet.slug, ...args })
    setEnvoi(false)
    if (error) { toast.erreur(`Filet non réglé : ${messageErreur(error)}`); return }
    toast.succes(ok); await charger()
  }

  if (erreur) return <p className="rounded-2xl border border-bord bg-carte px-3 py-2 text-xs text-alerte" data-testid="filet-erreur">Filet de sécurité indisponible : {erreur}</p>
  if (!etat) return <p className="px-1 text-xs text-texte-2" role="status">Chargement du filet de sécurité…</p>
  const ph = phraseFilet(etat)
  const Icone = ph.ton === 'ok' ? ShieldCheck : ShieldAlert
  return (
    <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="filet-securite" data-statut={etat.statut}>
      <div className="flex items-start gap-2">
        <Icone size={16} className={`mt-0.5 shrink-0 ${ph.ton === 'alerte' ? 'text-alerte' : 'text-accent'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug" data-testid="filet-titre">{ph.titre}</p>
          {ph.detail ? <p className="text-xs leading-snug text-texte-2" data-testid="filet-detail">{ph.detail}</p> : null}
        </div>
        {etat.statut !== 'test' ? <Button taille="sm" variante="discret" onClick={() => { setRegler(!regler); setPlafond(String(etat.plafond)) }} data-testid="filet-regler">Régler</Button> : null}
      </div>
      {regler ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="filet-formulaire">
          <Button taille="sm" chargement={envoi} data-testid="filet-interrupteur"
            onClick={() => void appliquer({ p_actif: !etat.projet_actif }, etat.projet_actif ? 'Filet de sécurité éteint sur ce projet.' : 'Filet de sécurité rallumé sur ce projet.')}>
            {etat.projet_actif ? 'Éteindre' : 'Rallumer'}
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-texte-2">
            Réveils max par jour
            <input value={plafond} onChange={(e) => setPlafond(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              className="h-9 w-14 rounded-lg border border-bord bg-fond px-2 text-sm text-texte" data-testid="filet-plafond" />
          </label>
          <Button taille="sm" variante="primaire" chargement={envoi} disabled={plafond === '' || Number(plafond) > 48 || Number(plafond) === etat.plafond}
            onClick={() => void appliquer({ p_plafond: Number(plafond) }, `Plafond : ${plafond} réveil(s) par jour.`)} data-testid="filet-enregistrer">Enregistrer</Button>
          <p className="basis-full text-[11px] text-texte-2">0 à 48. Au plus un réveil toutes les 5 minutes, jamais si une session travaille déjà.</p>
        </div>
      ) : null}
    </section>
  )
}
