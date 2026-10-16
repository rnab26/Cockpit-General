import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Rocket } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { enPause } from '../lib/pause.ts'
import type { EtatRenforts, ResultatDemande } from '../lib/renforts.ts'
import { decisionToutLancer, messageApresLancer, type EntreeLancer, type ResultatLancer } from '../lib/toutLancer.ts'

const SONDAGE_MS = 30_000

/**
 * L'UNIQUE bouton de l'écran principal (16 oct. 2026) : « Tout lancer ». Dans la vue d'un projet il lance ce projet ; dans
 * « Tout », chaque projet actif où quelque chose attend. Mêmes appels serveur que l'ancien « Lancer des renforts »
 * (etat_renforts, demander_renforts) : la logique reste côté base. Le détail (liste, relance, réglages, historique) est dans
 * Réglages du projet › « Renforts (détails) ». Admin seulement (la base le vérifie aussi).
 */
export function ToutLancer({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const toast = useToast()
  const projets = useMemo(
    () => g.projets.filter((p) => p.actif && (projetId ? p.id === projetId : true)),
    [g.projets, projetId],
  )
  const cle = projets.map((p) => p.slug).join(',')
  const [etats, setEtats] = useState<Record<string, { etat: EtatRenforts | null; erreur: string | null }>>({})
  const [envoi, setEnvoi] = useState(false)
  const [dernier, setDernier] = useState<{ ok: boolean; texte: string; reessayer: boolean } | null>(null)
  const vivant = useRef(true)

  const charger = useCallback(async () => {
    const slugs = cle ? cle.split(',') : []
    const lus = await Promise.all(slugs.map(async (slug) => {
      const { data, error } = await supabase.rpc('etat_renforts', { p_projet: slug })
      return [slug, error ? { etat: null, erreur: messageErreur(error) } : { etat: (data as EtatRenforts | null), erreur: null }] as const
    }))
    if (!vivant.current) return
    setEtats(Object.fromEntries(lus))
  }, [cle])

  useEffect(() => {
    vivant.current = true
    void charger()
    const t = window.setInterval(() => { if (!document.hidden) void charger() }, SONDAGE_MS)
    return () => { vivant.current = false; window.clearInterval(t) }
  }, [charger])
  // Relu un peu après qu'un chantier de ces projets a bougé (nombre + dernière modification), et à chaque « Actualiser ».
  const signature = useMemo(() => {
    const ids = new Set(projets.map((p) => p.id))
    let n = 0, max = ''
    for (const c of g.chantiers) if (ids.has(c.projet_id)) { n++; if (c.updated_at > max) max = c.updated_at }
    return `${n}:${max}:${g.passagesComplets}`
  }, [g.chantiers, g.passagesComplets, projets])
  const premiere = useRef(true)
  useEffect(() => {
    if (premiere.current) { premiere.current = false; return }
    const t = window.setTimeout(() => void charger(), 1500)
    return () => window.clearTimeout(t)
  }, [signature, charger])

  const entrees: EntreeLancer[] = projets.map((p) => ({
    slug: p.slug, nom: p.nom, enPause: enPause(p), etat: etats[p.slug]?.etat ?? null, erreur: etats[p.slug]?.erreur ?? null,
  }))
  // Un projet supprimé pendant l'affichage : la base répond null, on ne le compte pas.
  const visibles = entrees.filter((e) => e.etat || e.erreur || !(e.slug in etats))
  const d = decisionToutLancer(visibles)

  const lancer = async () => {
    setEnvoi(true)
    const rs: ResultatLancer[] = []
    for (const slug of d.aLancer) {
      const e = visibles.find((x) => x.slug === slug)!
      const { data, error } = await supabase.rpc('demander_renforts', { p_projet: slug })
      rs.push({
        nom: e.nom, resultat: error ? null : (data as ResultatDemande), erreur: error ? messageErreur(error) : null,
        sansChef: !e.etat?.chef && !e.etat?.relais,
      })
    }
    setEnvoi(false)
    const m = messageApresLancer(rs, new Date())
    setDernier(m)
    if (m.ok) toast.succes(m.texte); else toast.erreur(m.texte)
    await charger()
  }

  // Rien à lancer (ni erreur à réessayer, ni résultat à lire) : aucun bloc à l'écran (16 oct. 2026, Raphaël : « tout le superflu à la poubelle »).
  if (!g.admin || !projets.length || (!d.actif && !d.enErreur && !dernier)) return null
  return (
    <section aria-label="Tout lancer" data-testid="tout-lancer" data-etat={d.enErreur ? 'erreur' : d.chargement ? 'chargement' : d.actif ? 'pret' : 'rien'}
      className="rounded-2xl border-2 border-accent bg-carte px-3 py-3">
      <Button variante="primaire" taille="lg" pleine chargement={envoi} disabled={!d.actif} onClick={() => void lancer()} data-testid="tout-lancer-bouton">
        <Rocket size={18} aria-hidden />Tout lancer
      </Button>
      <p className="mt-2 text-sm leading-snug" role="status" data-testid="tout-lancer-ligne">{d.ligne}</p>
      {!d.actif && d.raison && !d.enErreur && !d.chargement && !d.raison.startsWith('Rien n’attend') ? <p className="mt-0.5 text-xs leading-snug text-texte-2" data-testid="tout-lancer-raison">{d.raison}</p> : null}
      {d.enErreur ? <Button taille="sm" className="mt-2" onClick={() => void charger()} data-testid="tout-lancer-reessayer">Réessayer</Button> : null}
      {dernier ? (
        <div className={`mt-1.5 text-xs leading-snug ${dernier.ok ? 'text-ok' : 'text-alerte'}`} role="status" data-testid="tout-lancer-resultat">
          <p>{dernier.texte}</p>
          {dernier.reessayer && d.actif ? <Button taille="sm" className="mt-1.5" onClick={() => void lancer()} data-testid="tout-lancer-reessayer-lancement">Réessayer</Button> : null}
        </div>
      ) : null}
    </section>
  )
}
