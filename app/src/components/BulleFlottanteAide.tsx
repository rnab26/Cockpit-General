import { useEffect, useRef, useState } from 'react'
import { HelpCircle, Send, X, Plus } from 'lucide-react'
import type { Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'

/**
 * Bulle flottante d'aide : un bouton discret en bas à droite (ne cache aucun
 * contrôle sur téléphone). Ouvre un panneau où l'utilisateur pose des questions
 * sur le fonctionnement du cockpit. Les messages partent dans le fil du projet.
 */
export function BulleFlottanteAide() {
  const { projet, prefs } = useCockpit()
  const [ouvert, setOuvert] = useState(false)
  const [messages, setMessages] = useState<Array<Message & { de: 'claude' | 'user' }>>([])
  const [charge, setCharge] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [creationChantier, setCreationChantier] = useState(false)
  const [texte, setTexte] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const toast = useToast()

  // Lire la préférence d'activation
  const actif = Boolean(prefs[`bulle_flottante_aide_${projet.id}`])

  // Ne rien afficher si pas activé
  if (!actif) return null

  // Charger l'historique au premier ouverture
  useEffect(() => {
    if (!ouvert) return
    const charger = async () => {
      try {
        setCharge(true)
        setErreur(null)
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
        setErreur('Impossible de charger l\'historique')
      } finally {
        setCharge(false)
      }
    }
    charger()
  }, [ouvert, projet.id])

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
      setErreur(null)
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
      setErreur('Impossible d\'envoyer le message')
    } finally {
      setEnvoi(false)
    }
  }

  const creerChantierDuMessage = async (messageId: string) => {
    try {
      setCreationChantier(true)
      setErreur(null)
      const message = messages.find((m) => m.id === messageId)
      if (!message) throw new Error('Message non trouvé')

      // Créer un chantier avec le titre du message
      const titre = message.corps.substring(0, 80)
      const { error } = await supabase.rpc('ouvrir_depuis_fil', {
        p_projet_id: projet.id,
        p_titre: titre,
        p_demande: message.corps,
        p_depuis: messageId,
        p_section: null,
      })

      if (error) throw error
      toast.succes('Chantier créé')
    } catch (e) {
      console.error(e)
      setErreur('Impossible de créer le chantier')
    } finally {
      setCreationChantier(false)
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
              {erreur && (
                <div className="rounded-lg bg-orange-100 px-3 py-2 text-sm text-orange-900 dark:bg-orange-900/20 dark:text-orange-200">
                  {erreur}
                </div>
              )}
              {charge ? (
                <p className="text-center text-texte-2 py-4 text-sm">Chargement…</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-texte-2 py-4 text-sm">
                  Pose une question. Claude y répondra.
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id}>
                    <div className={`flex ${m.de === 'claude' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-xs rounded-lg px-3 py-2 text-sm ${m.de === 'claude' ? 'bg-carte text-texte' : 'bg-lien text-fond'}`}>
                        {m.corps}
                      </div>
                    </div>
                    {m.de === 'user' && (
                      <div className="flex justify-end mt-1 px-3">
                        <button
                          type="button"
                          onClick={() => creerChantierDuMessage(m.id)}
                          disabled={creationChantier}
                          className="flex items-center gap-1 text-xs text-texte-2 hover:text-lien disabled:opacity-50"
                          title="Créer un chantier à partir de ce message">
                          <Plus size={14} />
                          <span>Chantier</span>
                        </button>
                      </div>
                    )}
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
