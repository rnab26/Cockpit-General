import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'

const base = 'w-full rounded-xl border border-bord bg-carte px-3 text-[15px] text-texte placeholder:text-texte-2/70 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50'

export function Champ({ label, aide, children, className = '' }: { label: ReactNode; aide?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-texte-2">{label}</span>
      {children}
      {aide ? <span className="mt-1 block text-xs text-texte-2">{aide}</span> : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${base} h-11 ${props.className ?? ''}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${base} py-2 leading-relaxed ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${base} h-11 ${props.className ?? ''}`} />
}

export function Interrupteur({ actif, onChange, label }: { actif: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={actif} onClick={() => onChange(!actif)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-bord bg-carte px-3 py-2.5 text-left text-[15px]">
      <span>{label}</span>
      <span className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition ${actif ? 'bg-accent' : 'bg-bord'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${actif ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
