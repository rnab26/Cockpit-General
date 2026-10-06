import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, ChevronDown } from 'lucide-react'
import type { Projet } from '../lib/types.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { phraseFilet, detailsFilet, phraseReaction, ROLE_FILET, type EtatFiletBase, type EtatReaction } from '../lib/filet.ts'

/**
 * RÉVEIL AUTOMATIQUE (« filet de sécurité », 0044) : la base surveille toute seule (pg_cron,
 * toutes les 3 min) ; du travail attend et rien de vivant ne le traite → Claude est réveillé.
 * Premier niveau : le rôle en une phrase, UN état, l'interrupteur et, si ça bloque, le geste.
 * Tout le reste (limite par jour, délai, dernier réveil) est dans « Détails ».
 */
export function FiletSecurite({ projet, onJeton }: { projet: Projet; onJeton?: () => void }) {
  const toast = useToast()
  const [etat, setEtat] = useState<EtatFiletBase | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  const [plafond, setPlafond] = useState('')
  const [delai, setDelai] = useState('')
  const [reaction, setReaction] = useState<EtatReaction | null>(null)
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('etat_filet', { p_projet: projet.slug })
    if (error) { setErreur(messageErreur(error)); return }
    setErreur(null); setEtat(data as EtatFiletBase | null)
    const r = await supabase.rpc('etat_reaction', { p_projet: projet.slug, p_jours: 7 })
    if (!r.error) setReaction(r.data as EtatReaction | null)
  }, [projet.slug])
  useEffect(() => { void charger() }, [charger])

  const appliquer = async (args: { p_actif?: boolean; p_plafond?: number; p_delai_min?: number }, ok: string) => {
    setEnvoi(true)
    const { error } = await supabase.rpc('regler_filet', { p_projet: projet.slug, ...args })
    setEnvoi(false)
    if (error) { toast.erreur(`Réveil automatique non réglé : ${messageErreur(error)}`); return }
    toast.succes(ok); await charger()
  }

  if (erreur) return (
    <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5 text-xs" data-testid="filet-erreur">
      <p className="text-alerte">Réveil automatique indisponible : {erreur}</p>
      <Button taille="sm" className="mt-2" onClick={() => void charger()}>Réessayer</Button>
    </section>
  )
  if (!etat) return <p className="px-1 text-xs text-texte-2" role="status" data-testid="filet-chargement">Chargement du réveil automatique…</p>
  const ph = phraseFilet(etat)
  const Icone = ph.ton === 'alerte' ? ShieldAlert : ShieldCheck
  const teinte = ph.ton === 'alerte' ? 'text-alerte' : ph.ton === 'attente' ? 'text-accent' : 'text-ok'
  const test = etat.statut === 'test'
  const ouvrirDetails = () => { setDetails(true); setPlafond(String(etat.plafond)); setDelai(String(etat.delai_min)) }
  const geste = ph.action
  return (
    <section className="rounded-2xl border border-bord bg-carte px-3 py-2.5" data-testid="filet-securite" data-statut={etat.statut}>
      <h3 className="text-sm font-semibold">Réveil automatique</h3>
      <p className="text-xs leading-snug text-texte-2" data-testid="filet-role">{ROLE_FILET}</p>
      <div className="mt-2 flex items-start gap-2">
        <Icone size={16} className={`mt-0.5 shrink-0 ${teinte}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium leading-snug ${ph.ton === 'alerte' ? 'text-alerte' : ''}`} data-testid="filet-titre">{ph.titre}</p>
          {ph.detail ? <p className="text-xs leading-snug text-texte-2" data-testid="filet-detail">{ph.detail}</p> : null}
        </div>
      </div>
      {geste && !test ? (
        <div className="mt-2">
          <Button taille="sm" variante="primaire" chargement={envoi} data-testid="filet-action"
            onClick={() => {
              if (geste.code === 'jeton') { onJeton?.(); return }
              if (geste.code === 'plafond') { ouvrirDetails(); return }
              void appliquer({ p_actif: true }, 'Réveil automatique rallumé sur ce projet.')
            }}>{geste.libelle}</Button>
        </div>
      ) : null}
      {!test ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => (details ? setDetails(false) : ouvrirDetails())} aria-expanded={details} data-testid="filet-regler"
              className="inline-flex items-center gap-0.5 text-xs text-texte-2 underline-offset-2 hover:underline">
              Détails
              <ChevronDown size={14} className={`transition ${details ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {etat.statut !== 'eteint' ? (
              <Button taille="sm" variante="discret" chargement={envoi} data-testid="filet-interrupteur"
                onClick={() => void appliquer({ p_actif: !etat.projet_actif }, etat.projet_actif ? 'Réveil automatique éteint sur ce projet.' : 'Réveil automatique rallumé sur ce projet.')}>
                {etat.projet_actif ? 'Éteindre' : 'Rallumer'}
              </Button>
            ) : null}
          </div>
          {details ? (
            <div className="mt-2 space-y-2 border-t border-bord pt-2" data-testid="filet-formulaire">
              <ul className="list-disc space-y-0.5 pl-4 text-xs leading-snug text-texte-2" data-testid="filet-details">
                {detailsFilet(etat).map((l) => <li key={l}>{l}</li>)}
              </ul>
              <p className="text-xs leading-snug" data-testid="filet-reaction">
                <span className="font-medium">{phraseReaction(reaction).titre}</span>
                <span className="text-texte-2"> · {phraseReaction(reaction).detail}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-texte-2">
                  Réveil si ça attend depuis (min, 1 à 240)
                  <input value={delai} onChange={(e) => setDelai(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
                    className="h-9 w-14 rounded-lg border border-bord bg-fond px-2 text-sm text-texte" data-testid="filet-delai" />
                </label>
                <Button taille="sm" variante="primaire" chargement={envoi} disabled={delai === '' || Number(delai) < 1 || Number(delai) > 240 || Number(delai) === etat.delai_min}
                  onClick={() => void appliquer({ p_delai_min: Number(delai) }, `Réveil après ${delai} min d’attente.`)} data-testid="filet-delai-enregistrer">Enregistrer</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-texte-2">
                  Réveils par jour au plus (0 à 48)
                  <input value={plafond} onChange={(e) => setPlafond(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
                    className="h-9 w-14 rounded-lg border border-bord bg-fond px-2 text-sm text-texte" data-testid="filet-plafond" />
                </label>
                <Button taille="sm" variante="primaire" chargement={envoi} disabled={plafond === '' || Number(plafond) > 48 || Number(plafond) === etat.plafond}
                  onClick={() => void appliquer({ p_plafond: Number(plafond) }, `Limite : ${plafond} réveil(s) par jour.`)} data-testid="filet-enregistrer">Enregistrer</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
