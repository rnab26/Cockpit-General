import { useEffect, useRef, useState } from 'react'
import { HelpCircle, Send } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { VUE_TOUT } from '../hooks/useDonnees.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { ecrireAvecMedias } from './Medias.tsx'
import { bulleActive, filDeLaBulle, projetDeLaBulle } from '../lib/bulleAide.ts'

/**
 * Bulle flottante d'aide (allumée par défaut ; l'extinction est dans « Réglages
 * du projet »). Un message tapé ici est un message LIBRE du fil du projet (comme
 * « Écrire à Claude sur ce projet ») : une session y répond (progression.sh
 * --point) et la réponse s'affiche ici en direct, car la bulle lit les mêmes
 * messages que l'app (canal temps réel de useDonnees), pas une copie chargée
 * une fois. Vue « Tout » : le projet cockpit (règle : lib/bulleAide.ts).
 */
export function BulleFlottanteAide() {
  const g = useGlobal()
  const toast = useToast()
  const [ouvert, setOuvert] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [texte, setTexte] = useState('')
  const fin = useRef<HTMLDivElement>(null)

  const projet = projetDeLaBulle(g.vue === VUE_TOUT ? null : g.vue, g.projets, g.messages)
  const fil = projet ? filDeLaBulle(g.messages, projet.id) : []
  useEffect(() => { if (ouvert) fin.current?.scrollIntoView({ block: 'end' }) }, [ouvert, fil.length])
  // Sa question attend une réponse : la bulle ouverte relit toutes les 10 s (le direct l'apporte déjà s'il est
  // actif ; ceci couvre le direct coupé, sans recharger l'app en continu quand rien n'est attendu).
  const attend = fil.length > 0 && fil[fil.length - 1].auteur_type !== 'session'
  const recharger = g.recharger
  useEffect(() => {
    if (!ouvert || !attend) return
    const t = window.setInterval(() => { void recharger() }, 10_000)
    return () => window.clearInterval(t)
  }, [ouvert, attend, recharger])

  if (!projet || !bulleActive(g.prefs, projet.id)) return null

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault()
    const corps = texte.trim()
    if (!corps || envoi) return
    setEnvoi(true)
    const erreur = await ecrireAvecMedias({ projetId: projet.id, chantierId: null, par: g.par, admin: g.admin, corps, medias: [] })
    setEnvoi(false)
    if (erreur) { toast.erreur(`Le message n’est pas parti : ${erreur}`); return }
    setTexte('')
    toast.succes('Message envoyé : Claude te répondra ici.')
    await g.recharger()
  }

  return (
    <>
      {/* À droite, au-dessus de la barre système et du bas de page : ne cache aucun bouton. */}
      {!ouvert && (
        <button type="button" onClick={() => setOuvert(true)} aria-label="Ouvrir l’aide" data-testid="bulle-aide-bouton" title={`Aide · ${projet.nom}`}
          style={{ bottom: 'calc(max(var(--nav-h, 0px), env(safe-area-inset-bottom)) + 76px)', right: 'calc(env(safe-area-inset-right) + 12px)' }}
          className="fixed z-30 flex h-11 w-11 items-center justify-center rounded-full border border-bord bg-carte text-texte shadow-lg hover:bg-carte-2 focus:outline-none focus:ring-2 focus:ring-accent/40">
          <HelpCircle size={22} />
        </button>
      )}
      {ouvert ? <Dialog ouvert onFermer={() => setOuvert(false)} titre={`Aide · ${projet.nom}`} brouillon={!!texte.trim()}
        pied={
          <form onSubmit={envoyer} className="flex w-full items-end gap-2">
            <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={2} placeholder="Pose ta question…" aria-label="Ta question" disabled={envoi} data-testid="bulle-aide-saisie"
              className="min-h-10 flex-1 resize-none rounded-2xl border border-bord bg-fond px-3 py-2 text-[15px] text-texte focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50" />
            <button type="submit" disabled={envoi || !texte.trim()} aria-label="Envoyer" data-testid="bulle-aide-envoyer" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"><Send size={17} /></button>
          </form>
        }>
        <div data-testid="bulle-aide-panneau" className="min-h-[30dvh] space-y-2">
          {fil.length === 0 ? <p className="py-6 text-center text-sm text-texte-2" data-testid="bulle-aide-vide">Pose une question sur le cockpit ou sur ce projet. Claude te répond ici.</p> : fil.map((m) => (
            <div key={m.id} className={`flex ${m.auteur_type === 'session' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[15px] ${m.auteur_type === 'session' ? 'bg-carte-2 text-texte' : 'bg-accent text-white'}`} data-testid="bulle-aide-message">{m.corps}</div>
            </div>
          ))}
          {attend ? <p className="text-center text-xs text-texte-2" data-testid="bulle-aide-attente">Claude n’a pas encore répondu : la réponse arrivera ici.</p> : null}
          <div ref={fin} />
        </div>
      </Dialog> : null}
    </>
  )
}
