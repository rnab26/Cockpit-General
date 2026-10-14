export const URL_EMBED: string
export const URL_APP: string
export const LIBELLES_EMPLACEMENT: Record<string, string>
export const LIBELLES_ACCES: Record<string, string>
export interface Balise { etat: 'vide' | 'appli' | 'balise'; code: string | null; emplacement: string; acces: string; consigne: string; acces_consigne: string; complete: boolean }
export function balise(p: { cle: string; emplacement?: { mode?: string; acces?: string; menu?: string } | null; declencheur?: string }): Balise
