import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog.tsx'
import { Button } from './Button.tsx'

export interface OptionsConfirm {
  titre: string
  texte?: ReactNode
  libelleOk?: string
  libelleAnnuler?: string
  danger?: boolean
}

const Ctx = createContext<(o: OptionsConfirm) => Promise<boolean>>(() => Promise.resolve(false))

/** confirmer({ titre, texte }) → Promise<boolean>. Jamais confirm() natif. */
export function useConfirmer() { return useContext(Ctx) }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<OptionsConfirm | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)
  const confirmer = useCallback((o: OptionsConfirm) => new Promise<boolean>((resolve) => { resolveRef.current = resolve; setOpts(o) }), [])
  const repondre = (v: boolean) => { resolveRef.current?.(v); resolveRef.current = null; setOpts(null) }
  return (
    <Ctx.Provider value={confirmer}>
      {children}
      <Dialog ouvert={!!opts} onFermer={() => repondre(false)} titre={opts?.titre ?? ''}
        pied={<>
          <Button onClick={() => repondre(false)}>{opts?.libelleAnnuler ?? 'Annuler'}</Button>
          <Button variante={opts?.danger ? 'danger' : 'primaire'} onClick={() => repondre(true)} autoFocus>{opts?.libelleOk ?? 'Confirmer'}</Button>
        </>}>
        <div className="text-[15px] leading-relaxed text-texte-2">{opts?.texte}</div>
      </Dialog>
    </Ctx.Provider>
  )
}
