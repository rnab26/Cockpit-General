import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Dialogue natif <dialog> : focus piégé et Échap gratuits. Sur téléphone il
 * monte du bas (feuille), sur grand écran il est centré.
 */
export function Dialog({ ouvert, onFermer, titre, children, pied, large }: {
  ouvert: boolean; onFermer: () => void; titre: ReactNode; children: ReactNode; pied?: ReactNode; large?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (ouvert && !d.open) d.showModal()
    if (!ouvert && d.open) d.close()
  }, [ouvert])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const onCancel = (e: Event) => { e.preventDefault(); onFermer() }
    d.addEventListener('cancel', onCancel)
    return () => d.removeEventListener('cancel', onCancel)
  }, [onFermer])
  return (
    <dialog ref={ref}
      onClick={(e) => { if (e.target === e.currentTarget) onFermer() }}
      className={`m-0 w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50
        fixed inset-x-0 bottom-0 top-auto sm:inset-0 sm:m-auto sm:h-fit ${large ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}>
      {ouvert ? (
        <div className="flex max-h-[92dvh] flex-col rounded-t-2xl bg-carte text-texte shadow-2xl sm:max-h-[85vh] sm:rounded-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-bord px-4 py-3">
            <h2 className="text-base font-bold leading-tight">{titre}</h2>
            <button type="button" onClick={onFermer} aria-label="Fermer" className="rounded-lg p-1.5 text-texte-2 hover:bg-carte-2"><X size={20} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {pied ? <div className="flex flex-wrap justify-end gap-2 border-t border-bord px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">{pied}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}
