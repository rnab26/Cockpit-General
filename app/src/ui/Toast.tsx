import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface Toast { id: number; texte: string; type: 'succes' | 'erreur' | 'info'; action?: { libelle: string; onClick: () => void }; duree: number }
interface Api {
  succes: (texte: string) => void
  erreur: (texte: string) => void
  info: (texte: string) => void
  avecAction: (texte: string, action: { libelle: string; onClick: () => void }, dureeMs?: number) => void
}
const Ctx = createContext<Api>({ succes() {}, erreur() {}, info() {}, avecAction() {} })
export function useToast() { return useContext(Ctx) }

const STYLE = { succes: 'border-ok/40', erreur: 'border-alerte/60', info: 'border-info/40' }
const ICONE = { succes: '✅', erreur: '⚠️', info: 'ℹ️' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [liste, setListe] = useState<Toast[]>([])
  const compteur = useRef(0)
  const retirer = useCallback((id: number) => setListe((l) => l.filter((t) => t.id !== id)), [])
  const pousser = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++compteur.current
    setListe((l) => [...l.slice(-3), { ...t, id }])
    window.setTimeout(() => retirer(id), t.duree)
  }, [retirer])
  // La zone des toasts vit dans la « top layer » (popover manuel), réaffichée à
  // chaque changement : sinon un dialogue modal ouvert (Doublons, Sections…)
  // la recouvre, et sur téléphone la feuille du bas cache exactement l'endroit
  // où le toast s'affiche — l'action réussit sans qu'on le voie (trouvé par
  // verifier-web.mjs, 28 sept. 2026). Navigateur sans popover : div fixe, comme avant.
  const zone = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const z = zone.current
    if (!z || typeof z.showPopover !== 'function') return
    try {
      if (z.matches(':popover-open')) z.hidePopover()
      if (liste.length) z.showPopover()
    } catch { /* popover non géré : la zone reste un simple div fixe */ }
  }, [liste])
  const api: Api = {
    succes: (texte) => pousser({ texte, type: 'succes', duree: 3500 }),
    erreur: (texte) => pousser({ texte, type: 'erreur', duree: 7000 }),
    info: (texte) => pousser({ texte, type: 'info', duree: 4000 }),
    avecAction: (texte, action, dureeMs = 8000) => pousser({ texte, type: 'succes', action, duree: dureeMs }),
  }
  return (
    <Ctx.Provider value={api}>
      {children}
      <div ref={zone} popover="manual" className="pointer-events-none fixed inset-x-0 top-auto bottom-[max(env(safe-area-inset-bottom),12px)] z-[60] m-0 flex h-auto w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent px-3 py-0 text-texte" role="status" aria-live="polite">
        {liste.map((t) => (
          <div key={t.id} className={`toast-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border bg-carte px-3 py-2.5 text-[15px] shadow-xl ${STYLE[t.type]}`}>
            <span aria-hidden>{ICONE[t.type]}</span>
            <span className="flex-1">{t.texte}</span>
            {t.action ? (
              <button type="button" className="rounded-lg bg-accent px-2.5 py-1 text-sm font-semibold text-accent-fg"
                onClick={() => { t.action?.onClick(); retirer(t.id) }}>{t.action.libelle}</button>
            ) : null}
            <button type="button" aria-label="Fermer" className="text-texte-2" onClick={() => retirer(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
