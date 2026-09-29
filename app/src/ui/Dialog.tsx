import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useConfirmer } from './Confirm.tsx'
import { CONFIRMER_ABANDON, useToucherLeFond } from './Modale.ts'

/**
 * Dialogue natif <dialog> : focus piégé et Échap gratuits. Sur téléphone il
 * monte du bas (feuille), sur grand écran il est centré. Toucher le fond, Échap
 * ou la croix le ferment (règle commune : ui/Modale.ts) ; avec `brouillon`
 * (une saisie non enregistrée), on demande d'abord « Quitter sans envoyer ? ».
 */
export function Dialog({ ouvert, onFermer, titre, children, pied, large, brouillon = false }: {
  ouvert: boolean; onFermer: () => void; titre: ReactNode; children: ReactNode; pied?: ReactNode; large?: boolean; brouillon?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const confirmer = useConfirmer()
  const demanderFermeture = useCallback(async () => {
    if (brouillon && !(await confirmer(CONFIRMER_ABANDON))) return
    onFermer()
  }, [brouillon, confirmer, onFermer])
  const fond = useToucherLeFond<HTMLDialogElement>(() => { void demanderFermeture() })
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (ouvert && !d.open) d.showModal()
    if (!ouvert && d.open) d.close()
  }, [ouvert])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const onCancel = (e: Event) => { e.preventDefault(); void demanderFermeture() }
    d.addEventListener('cancel', onCancel)
    return () => d.removeEventListener('cancel', onCancel)
  }, [demanderFermeture])
  return (
    <dialog ref={ref} {...fond}
      className={`m-0 w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50
        fixed inset-x-0 bottom-0 top-auto sm:inset-0 sm:m-auto sm:h-fit ${large ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}>
      {ouvert ? (
        <div className="flex max-h-[92dvh] flex-col rounded-t-2xl bg-carte text-texte shadow-2xl sm:max-h-[85vh] sm:rounded-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-bord px-4 py-3">
            <h2 className="text-base font-bold leading-tight">{titre}</h2>
            <button type="button" onClick={() => { void demanderFermeture() }} aria-label="Fermer" className="rounded-lg p-1.5 text-texte-2 hover:bg-carte-2"><X size={20} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {pied ? <div className="flex flex-wrap justify-end gap-2 border-t border-bord px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">{pied}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}
