import { Moon } from 'lucide-react'
import { useState } from 'react'
import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Input } from '../ui/Champs.tsx'
import {
  autonomeActif, chantiersPrenables, erreurReglage, estHeure, etatAutonome, heureIsrael, prochaineHeure, texteArretVide, travailEnCours,
  ARRET_VIDE_CHOIX, ARRET_VIDE_DEFAUT, HEURE_DEFAUT, MAX_MAX, MAX_MIN,
} from '../lib/autonome.ts'

// 0011 : elle prend aussi les chantiers pas encore triés et les en cours abandonnés ; jamais « à cadrer ».
export const AIDE_AUTONOME = 'La session enchaîne seule les chantiers LIBRES, pas encore triés ou abandonnés (jamais « à cadrer »), sans dépense, suppression ni envoi en ton nom. Ses questions t’attendront dans À toi.'

/** Un interrupteur (rôle « switch ») : un toucher allume ou éteint. */
function Interrupteur({ allume, enCours, onBasculer, libelle }: { allume: boolean; enCours: boolean; onBasculer: () => void; libelle: string }) {
  return (
    <button type="button" role="switch" aria-checked={allume} aria-label={libelle} disabled={enCours} onClick={onBasculer}
      data-testid="autonome-interrupteur"
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition disabled:opacity-60 ${allume ? 'border-info bg-info' : 'border-bord bg-carte-2'}`}>
      <span aria-hidden className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${allume ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

/**
 * « 🌙 Mode autonome » d'un projet (0010, 0011, 0031). Un interrupteur : un
 * toucher allume (« tout le temps », avec le plafond et l'extinction
 * automatique du projet) ou éteint. « Régler… » : jusqu'à une heure, plafond
 * par session, extinction automatique. Alerte quand il tourne sans rien à
 * prendre ; dit quand il s'est éteint tout seul (chantier 79ec70d6 : « pour
 * éviter les crédits inutiles »). Réservé à l'admin (regler_autonome le vérifie aussi).
 */
export function ModeAutonome({ projet }: { projet: Projet }) {
  const { admin, now, chantiers, activites, taches, sessions, rechargerProjets, prenables } = useGlobal()
  const toast = useToast()
  const [ouvert, setOuvert] = useState(false)
  const [heure, setHeure] = useState(HEURE_DEFAUT)
  const [toujours, setToujours] = useState(false)
  const [max, setMax] = useState(String(projet.autonome_max ?? 20))
  const [arret, setArret] = useState(String(projet.autonome_arret_vide_h ?? ARRET_VIDE_DEFAUT))
  const [enCours, setEnCours] = useState(false)
  if (!admin) return null
  const actif = autonomeActif(projet, now)
  // La base fait foi (0065) ; la copie locale ne sert que tant qu'elle n'a pas répondu.
  const prets = prenables?.get(projet.id) ?? chantiersPrenables(chantiers, projet.id, now, activites, taches, sessions)
  const etat = etatAutonome(projet, prets, travailEnCours(chantiers, taches, projet.id, now), now)
  const arretH = projet.autonome_arret_vide_h ?? ARRET_VIDE_DEFAUT
  const libellePrets = `${prets} chantier${prets > 1 ? 's' : ''} prêt${prets > 1 ? 's' : ''}`

  const regler = async (jusquA: Date | null, plafond: number | null, pourToujours = false, arretVide: number | null = null) => {
    setEnCours(true)
    const { error } = await supabase.rpc('regler_autonome', {
      p_projet: projet.slug, p_jusqu_a: jusquA ? jusquA.toISOString() : null, p_max: plafond, p_toujours: pourToujours, p_arret_vide_h: arretVide,
    })
    setEnCours(false)
    if (error) { toast.erreur(`Mode autonome non réglé : ${messageErreur(error)}`); return false }
    await rechargerProjets()
    return true
  }
  const allumerDunToucher = async () => {
    if (await regler(null, null, true)) toast.succes(`Autonome tout le temps, au plus ${projet.autonome_max} chantiers par session ; il ${texteArretVide(arretH)}.`)
  }
  const arreter = async () => { if (await regler(null, null)) toast.succes('Mode autonome arrêté : les sessions s’arrêteront à la fin de leur tâche.') }
  const enregistrer = async () => {
    const n = Number(max)
    const a = Number(arret)
    if (toujours) {
      const pb = erreurReglage(new Date(Date.now() + 3600_000), n, new Date())
      if (pb) { toast.erreur(pb); return }
      if (await regler(null, n, true, a)) { toast.succes(`Autonome tout le temps, au plus ${n} chantiers par session ; il ${texteArretVide(a)}.`); setOuvert(false) }
      return
    }
    if (!estHeure(heure)) { toast.erreur('Choisis une heure de fin (HH:MM).'); return }
    const fin = prochaineHeure(heure, new Date())
    const pb = erreurReglage(fin, n, new Date())
    if (pb) { toast.erreur(pb); return }
    if (await regler(fin, n, false, a)) { toast.succes(`Autonome jusqu’à ${heureIsrael(fin)} (heure d’Israël), au plus ${n} chantiers par session ; il ${texteArretVide(a)}.`); setOuvert(false) }
  }
  const ouvrirReglage = () => {
    setToujours(actif ? !!projet.autonome_toujours : false)
    setMax(String(projet.autonome_max ?? 20)); setArret(String(arretH)); setOuvert(true)
  }

  return (
    <div data-testid="mode-autonome" data-actif={actif ? 'oui' : 'non'} data-alerte={etat.alerte ? 'oui' : 'non'} className="space-y-1.5 text-sm">
      <div className="flex items-center gap-2.5">
        <Moon size={16} aria-hidden className={`shrink-0 ${actif ? (etat.alerte ? 'text-attention' : 'text-info') : 'text-texte-2'}`} />
        <div className="min-w-0 flex-1 leading-snug" data-testid="autonome-bandeau">
          <p className={`font-medium ${actif ? 'text-info' : 'text-texte'}`}>{etat.libelle}</p>
          <p className="text-xs text-texte-2">
            {actif ? `${libellePrets} · au plus ${projet.autonome_max} par session · ${texteArretVide(arretH)}` : 'Un toucher : Claude enchaîne seul les chantiers prêts.'}
            {' '}
            <button type="button" onClick={ouvrirReglage} data-testid={actif ? 'autonome-changer' : 'autonome-ouvrir'}
              className="font-medium text-info underline-offset-2 hover:underline">Régler…</button>
          </p>
        </div>
        <Interrupteur allume={actif} enCours={enCours} libelle={actif ? 'Éteindre le mode autonome' : 'Allumer le mode autonome'}
          onBasculer={() => void (actif ? arreter() : allumerDunToucher())} />
      </div>
      {etat.alerte ? <p className="rounded-lg border border-attention/40 px-2.5 py-1.5 text-xs text-attention" data-testid="autonome-alerte">{etat.alerte}</p> : null}
      {etat.note ? <p className="text-xs text-texte-2" data-testid="autonome-note">{etat.note}</p> : null}
      {ouvert ? (
        <div className="space-y-2 rounded-xl border border-bord bg-carte p-2.5" data-testid="autonome-formulaire">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Jusqu’à quand">
            <label className="flex items-center gap-2">
              <input type="radio" name={`autonome-${projet.id}`} checked={!toujours} onChange={() => setToujours(false)} className="accent-accent" data-testid="autonome-jusqua" />
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
          <label className="flex flex-wrap items-center gap-2">
            <span className="shrink-0">S’éteint seul sans rien à prendre depuis</span>
            <select value={arret} onChange={(e) => setArret(e.target.value)} aria-label="Extinction automatique" data-testid="autonome-arret"
              className="h-9 rounded-lg border border-bord bg-carte px-2">
              {ARRET_VIDE_CHOIX.map((h) => <option key={h} value={String(h)}>{h ? `${h} h` : 'jamais'}</option>)}
            </select>
          </label>
          <p className="text-xs text-texte-2">{AIDE_AUTONOME} Heure d’Israël ; 24 h au plus, ou « tout le temps ». {libellePrets} maintenant.</p>
          <div className="flex justify-end gap-2">
            <Button taille="sm" onClick={() => setOuvert(false)}>Annuler</Button>
            <Button taille="sm" variante="primaire" chargement={enCours} onClick={enregistrer} data-testid="autonome-allumer"><Moon size={15} aria-hidden />{actif ? 'Enregistrer' : 'Allumer'}</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
