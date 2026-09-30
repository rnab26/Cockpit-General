import { useEffect, useRef, useState } from 'react'
import { HelpCircle, Send, X } from 'lucide-react'
import type { Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'

/**
 * Bulle flottante d'aide : un bouton discret en bas à droite (ne cache aucun
 * contrôle sur téléphone). Ouvre un panneau où l'utilisateur pose des questions
 * sur le fonctionnement du cockpit. Les messages partent dans le fil du projet.
 */
export function BulleFlottanteAide({ actif }: { actif?: boolean }) {
  const { projet } = useCockpit()
  const [ouvert, setOuvert] = useState(false)
  const [messages, setMessages] = useState<Array<Message & { de: 'claude' | 'user' }>>([])
  const [charge, setCharge] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [texte, setTexte] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const toast = useToast()

  // Ne rien afficher si pas activé
  if (!actif) return null

  // Charger l'historique au premier ouverture
  useEffect(() => {
    if (!ouvert) return
    const charger = async () => {
      try {
        setCharge(true)
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('projet_id', projet.id)
          .is('chantier_id', null)
          .in('kind', ['info', 'constat', 'reponse'])
          .order('created_at', { ascending: true })
          .limit(50)

        if (error) throw error
        setMessages(
          (data || []).map((m: any) => ({
            ...m,
            de: m.auteur_type === 'session' ? ('claude' as const) : ('user' as const),
          }))
        )
      } catch (e) {
        console.error(e)
        toast.erreur('Impossible de charger l\'historique')
      } finally {
        setCharge(false)
      }
    }
    charger()
  }, [ouvert, projet.id, toast])

  // Scroller en bas
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!texte.trim() || envoi) return

    try {
      setEnvoi(true)
      const { error } = await supabase.from('messages').insert({
        projet_id: projet.id,
        chantier_id: null,
        auteur: 'utilisateur',
        auteur_type: 'proprietaire',
        kind: 'info',
        corps: texte.trim(),
      })

      if (error) throw error
      setTexte('')
      toast.succes('Message envoyé')

      // Recharger
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('projet_id', projet.id)
        .is('chantier_id', null)
        .in('kind', ['info', 'constat', 'reponse'])
        .order('created_at', { ascending: true })
        .limit(50)

      setMessages(
        (data || []).map((m: any) => ({
          ...m,
          de: m.auteur_type === 'session' ? ('claude' as const) : ('user' as const),
        }))
      )
    } catch (e) {
      console.error(e)
      toast.erreur('Impossible d\'envoyer le message')
    } finally {
      setEnvoi(false)
    }
  }

  const fermer = () => {
    setOuvert(false)
  }

  return (
    <>
      {/* Bouton flottant discret */}
      {!ouvert && (
        <button
          type="button"
          onClick={() => setOuvert(true)}
          aria-label="Ouvrir l'aide"
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-carte text-texte shadow-lg hover:bg-carte-2 focus:outline-none focus:ring-2 focus:ring-lien sm:bottom-6 sm:right-6"
          title="Aide sur le cockpit">
          <HelpCircle size={24} />
        </button>
      )}

      {/* Panneau */}
      {ouvert && (
        <dialog
          ref={dialogRef}
          open
          onClick={() => {
            if (dialogRef.current?.lastChild === (document.activeElement as any)?.parentElement) fermer()
          }}
          className="fixed inset-x-0 bottom-0 top-auto m-0 h-[calc(100dvh-2.75rem)] max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50 sm:inset-0 sm:m-auto sm:h-[72vh] sm:max-w-md">
          <div className="flex h-full flex-col overflow-hidden rounded-t-2xl bg-fond text-texte sm:rounded-2xl sm:border sm:border-bord">
            {/* En-tête */}
            <header className="flex items-center justify-between gap-2 border-b border-bord bg-carte px-3 py-2">
              <div className="flex items-center gap-2">
                <HelpCircle size={20} className="text-texte-2" />
                <h2 className="text-[15px] font-medium">Aide</h2>
              </div>
              <button
                type="button"
                onClick={fermer}
                aria-label="Fermer"
                className="flex h-8 w-8 items-center justify-center rounded-full text-texte-2 hover:bg-carte-2">
                <X size={18} />
              </button>
            </header>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto space-y-2 px-3 py-2">
              {charge ? (
                <p className="text-center text-texte-2 py-4 text-sm">Chargement…</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-texte-2 py-4 text-sm">
                  Pose une question. Claude y répondra.
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.de === 'claude' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-xs rounded-lg px-3 py-2 text-sm ${m.de === 'claude' ? 'bg-carte text-texte' : 'bg-lien text-fond'}`}>
                      {m.corps}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Saisie */}
            <form onSubmit={envoyer} className="border-t border-bord bg-carte px-3 py-2">
              <div className="flex gap-2">
                <textarea
                  value={texte}
                  onChange={(e) => setTexte(e.target.value)}
                  placeholder="Pose ta question…"
                  disabled={envoi}
                  rows={1}
                  className="flex-1 rounded border border-bord bg-fond px-2 py-1.5 text-sm text-texte placeholder:text-texte-2 focus:outline-none focus:ring-1 focus:ring-lien disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={envoi || !texte.trim()}
                  className="px-2 py-1.5 rounded text-texte hover:bg-carte-2 disabled:opacity-50">
                  {envoi ? '…' : <Send size={16} />}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </>
  )
}
