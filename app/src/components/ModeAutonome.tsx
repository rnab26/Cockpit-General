import { useState } from 'react'
import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Input } from '../ui/Champs.tsx'
import { autonomeActif, chantiersPrenables, erreurReglage, estHeure, heureIsrael, prochaineHeure, HEURE_DEFAUT, MAX_MAX, MAX_MIN } from '../lib/autonome.ts'

// 0011 : elle prend aussi les chantiers pas encore triés et les en cours abandonnés ; jamais « à cadrer ».
export const AIDE_AUTONOME = 'La session enchaîne seule les chantiers LIBRES, pas encore triés ou abandonnés (jamais « à cadrer »), sans dépense, suppression ni envoi en ton nom. Ses questions t’attendront dans À toi.'

/**
 * « 🌙 Mode autonome » d'un projet (0010). Raphaël : « quand je vais dormir,
 * si la session n'a plus rien à reprendre, qu'elle poursuive sur les chantiers
 * disponibles ». Allumé jusqu'à une heure (Israël), plafonné par session.
 * Réservé à l'admin (regler_autonome le vérifie aussi).
 */
export function ModeAutonome({ projet }: { projet: Projet }) {
  const { admin, now, chantiers, activites, taches, sessions, rechargerProjets } = useGlobal()
  const toast = useToast()
  const [ouvert, setOuvert] = useState(false)
  const [heure, setHeure] = useState(HEURE_DEFAUT)
  const [toujours, setToujours] = useState(false)
  const [max, setMax] = useState(String(projet.autonome_max ?? 20))
  const [enCours, setEnCours] = useState(false)
  if (!admin) return null
  const actif = autonomeActif(projet, now)
  const prets = chantiersPrenables(chantiers, projet.id, now, activites, taches, sessions)
  const libellePrets = `${prets} chantier${prets > 1 ? 's' : ''} prêt${prets > 1 ? 's' : ''}`

  const regler = async (jusquA: Date | null, plafond: number | null, pourToujours = false) => {
    setEnCours(true)
    const { error } = await supabase.rpc('regler_autonome', { p_projet: projet.slug, p_jusqu_a: jusquA ? jusquA.toISOString() : null, p_max: plafond, p_toujours: pourToujours })
    setEnCours(false)
    if (error) { toast.erreur(`Mode autonome non réglé : ${messageErreur(error)}`); return false }
    await rechargerProjets()
    return true
  }
  const allumer = async () => {
    const n = Number(max)
    if (toujours) {
      const pb = erreurReglage(new Date(Date.now() + 3600_000), n, new Date())
      if (pb) { toast.erreur(pb); return }
      if (await regler(null, n, true)) { toast.succes(`🌙 Autonome tout le temps, au plus ${n} chantiers par session.`); setOuvert(false) }
      return
    }
    if (!estHeure(heure)) { toast.erreur('Choisis une heure de fin (HH:MM).'); return }
    const fin = prochaineHeure(heure, new Date())
    const pb = erreurReglage(fin, n, new Date())
    if (pb) { toast.erreur(pb); return }
    if (await regler(fin, n)) { toast.succes(`🌙 Autonome jusqu’à ${heureIsrael(fin)} (heure d’Israël), au plus ${n} chantiers par session.`); setOuvert(false) }
  }
  const arreter = async () => { if (await regler(null, null)) toast.succes('Mode autonome arrêté : les sessions s’arrêteront à la fin de leur tâche.') }

  if (actif) {
    return (
      <div data-testid="mode-autonome" data-actif="oui" className="flex items-center gap-2 rounded-xl border border-info/40 bg-info/8 px-2.5 py-1.5 text-sm">
        <p className="min-w-0 flex-1 leading-snug" data-testid="autonome-bandeau">
          <span className="font-semibold text-info">🌙 Autonome {projet.autonome_toujours ? 'tout le temps' : `jusqu’à ${heureIsrael(projet.autonome_jusqu_a!)}`}</span>
          <span className="text-texte-2"> — {libellePrets} · au plus {projet.autonome_max} par session</span>
        </p>
        <Button taille="sm" chargement={enCours} onClick={arreter} data-testid="autonome-arreter" className="shrink-0">Arrêter maintenant</Button>
      </div>
    )
  }
  return (
    <div data-testid="mode-autonome" data-actif="non" className="text-sm">
      {!ouvert ? (
        <button type="button" onClick={() => setOuvert(true)} data-testid="autonome-ouvrir" className="text-left font-medium text-texte-2 underline-offset-2 hover:underline">
          🌙 Travailler en autonomie…
        </button>
      ) : (
        <div className="space-y-2 rounded-xl border border-info/40 bg-info/5 p-2.5" data-testid="autonome-formulaire">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Jusqu’à quand">
            <label className="flex items-center gap-2">
              <input type="radio" name={`autonome-${projet.id}`} checked={!toujours} onChange={() => setToujours(false)} className="accent-accent" />
              <span className="shrink-0">Jusqu’à</span>
              <Input type="time" value={heure} onChange={(e) => { setHeure(e.target.value); setToujours(false) }} aria-label="Heure de fin (Israël)" className="h-9 w-28" data-testid="autonome-heure" />
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name={`autonome-${projet.id}`} checked={toujours} onChange={() => setToujours(true)} className="accent-accent" data-testid="autonome-toujours" />
              <span>tout le temps</span>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <span className="shrink-0">au plus</span>
            <Input type="number" min={MAX_MIN} max={MAX_MAX} value={max} onChange={(e) => setMax(e.target.value)} aria-label="Chantiers par session" className="h-9 w-20" data-testid="autonome-max" />
            <span>chantiers par session</span>
          </label>
          <p className="text-xs text-texte-2">{AIDE_AUTONOME} Heure d’Israël ; 24 h au plus, ou « tout le temps ». {libellePrets} maintenant.</p>
          <div className="flex justify-end gap-2">
            <Button taille="sm" onClick={() => setOuvert(false)}>Annuler</Button>
            <Button taille="sm" variante="primaire" chargement={enCours} onClick={allumer} data-testid="autonome-allumer">🌙 Allumer</Button>
          </div>
        </div>
      )}
    </div>
  )
}
