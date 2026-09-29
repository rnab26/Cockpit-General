import { useCallback, useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Button } from '../ui/Button.tsx'
import { dateRelative } from '../lib/dates.ts'

interface EtatReveil {
  configure: boolean
  trigger: string | null
  chef: boolean
  dernier_at: string | null
  dernier_raison: string | null
  statut?: number | null
  erreur?: string | null
  session?: string | null
}

/**
 * RÉVEIL IMMÉDIAT (0028) : quand tu écris dans le cockpit, Claude est réveillé
 * tout de suite au lieu d'attendre son passage horaire. La base appelle le
 * déclencheur API de la routine de réveil (au plus une fois toutes les 5 min) ;
 * le jeton se crée sur claude.ai et se colle ici : il part dans le coffre de la
 * base, il ne se relit jamais. Sans jeton, rien ne change : passage horaire.
 */
export function ReveilImmediat({ projet }: { projet: Projet }) {
  const toast = useToast()
  const confirmer = useConfirmer()
  const [etat, setEtat] = useState<EtatReveil | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [adresse, setAdresse] = useState('')
  const [jeton, setJeton] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [modifier, setModifier] = useState(false)

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_reveil_immediat', { p_projet: projet.slug })
    if (error) { setErreur(messageErreur(error)); return }
    setErreur(null); setEtat(data as EtatReveil | null)
  }, [projet.slug])
  useEffect(() => { void charger() }, [charger])

  const enregistrer = async () => {
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_reveil_immediat', { p_projet: projet.slug, p_adresse: adresse, p_jeton: jeton })
    setEnvoi(false)
    if (error) { toast.erreur(`Réveil non enregistré : ${messageErreur(error)}`); return }
    setAdresse(''); setJeton(''); setModifier(false)
    toast.succes('Réveil immédiat en place : ton prochain message réveillera Claude tout de suite.')
    await charger()
  }
  const retirer = async () => {
    const ok = await confirmer({ titre: 'Retirer le réveil immédiat ?', libelleOk: 'Retirer', danger: true,
      texte: <p>Le jeton est effacé du cockpit. Claude reviendra à son passage horaire. Pense à le révoquer aussi sur claude.ai (routine → Modifier → API → Revoke).</p> })
    if (!ok) return
    const { error } = await supabase.rpc('retirer_reveil_immediat', { p_projet: projet.slug })
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes('Réveil immédiat retiré.'); await charger()
  }

  if (erreur) return <p className="text-xs text-alerte" data-testid="reveil-erreur">Réveil immédiat indisponible : {erreur}</p>
  if (!etat) return <p className="text-xs text-texte-2" role="status">Chargement du réveil…</p>
  const ok = etat.statut != null && etat.statut >= 200 && etat.statut < 300
  const now = new Date()
  return (
    <div className="space-y-1.5 rounded-xl border border-bord px-3 py-2.5" data-testid="reveil-immediat" data-configure={etat.configure ? 'oui' : 'non'}>
      <p className="flex items-center gap-1.5 text-sm font-medium"><Zap size={15} className="text-accent" aria-hidden />Réveil immédiat quand tu écris</p>
      {etat.configure ? (
        <>
          <p className="text-xs text-texte-2" data-testid="reveil-etat">
            En place (routine {etat.trigger}).{' '}
            {etat.dernier_at
              ? <>Dernier réveil {dateRelative(etat.dernier_at, now)} : {ok ? 'Claude a été réveillé.' : etat.statut ? <span className="text-alerte">refusé ({etat.statut}{etat.erreur ? ` : ${etat.erreur.slice(0, 120)}` : ''}).</span> : 'en cours…'}</>
              : 'Pas encore utilisé.'}
          </p>
          <div className="flex gap-2">
            <Button taille="sm" onClick={() => setModifier(!modifier)} data-testid="reveil-modifier">Changer le jeton</Button>
            <Button taille="sm" variante="discret" onClick={() => void retirer()} data-testid="reveil-retirer">Retirer</Button>
          </div>
        </>
      ) : (
        <p className="text-xs leading-snug text-texte-2" data-testid="reveil-etat">
          Pas en place : Claude lit tes messages à son passage horaire. Pour qu’il réponde en quelques minutes : sur{' '}
          <a className="text-accent underline" href="https://claude.ai/code/routines" target="_blank" rel="noreferrer">claude.ai/code/routines</a>,
          ouvre la routine « Réveil du chef », Modifier → Ajouter un déclencheur → API → Générer un jeton, puis colle l’adresse et le jeton ici.
        </p>
      )}
      {!etat.configure || modifier ? (
        <div className="space-y-1.5" data-testid="reveil-formulaire">
          <input value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="Adresse : https://api.anthropic.com/v1/claude_code/routines/trig_…/fire"
            className="h-10 w-full rounded-lg border border-bord bg-carte px-2 text-sm" aria-label="Adresse de la routine" data-testid="reveil-adresse" />
          <input value={jeton} onChange={(e) => setJeton(e.target.value)} placeholder="Jeton : sk-ant-…" type="password" autoComplete="off"
            className="h-10 w-full rounded-lg border border-bord bg-carte px-2 text-sm" aria-label="Jeton de la routine" data-testid="reveil-jeton" />
          <Button taille="sm" variante="primaire" chargement={envoi} disabled={!adresse.trim() || !jeton.trim()} onClick={() => void enregistrer()} data-testid="reveil-enregistrer">Enregistrer</Button>
          <p className="text-[11px] text-texte-2">Le jeton part dans le coffre de la base : il n’est plus jamais affiché. Au plus un réveil toutes les 5 minutes.</p>
        </div>
      ) : null}
    </div>
  )
}
