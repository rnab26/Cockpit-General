import { createClient } from '@supabase/supabase-js'
import { fetchResilient, fournirSession } from './fetchResilient.ts'

// Clé PUBLIQUE (publishable) : elle part dans le bundle par conception, la
// sécurité est dans les politiques RLS du schéma `cockpit`.
export const SUPABASE_URL = 'https://bexiyvmdbxcwxasgslxp.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_Ju0xC27cQ1JrN4IpWFfWxQ_Ntrd4P1U'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'cockpit' },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  // Écritures gardées hors ligne, lectures servies du cache (lib/fetchResilient.ts).
  global: { fetch: fetchResilient },
})

fournirSession(async () => {
  const { data } = await supabase.auth.getSession()
  return data.session ? { token: data.session.access_token, uid: data.session.user.id } : null
})

/** Un message d'erreur lisible pour un toast, jamais un objet brut. */
export function messageErreur(e: unknown): string {
  if (!e) return 'Erreur inconnue'
  if (typeof e === 'string') return e
  const o = e as { message?: string; details?: string; hint?: string; code?: string }
  const m = o.message ?? 'Erreur inconnue'
  if (/schema cache|PGRST00[0-3]|connection timeout|upstream request timeout|504|503|502/i.test(m)) return 'Le serveur de données est surchargé ou redémarre. Le cockpit réessaie tout seul.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de réseau : la base est injoignable.'
  if (/JWT|not authenticated|401/i.test(m)) return 'Session expirée : reconnecte-toi.'
  if (/row-level security|permission denied/i.test(m)) return 'Tu n’as pas le droit de faire ça sur ce projet.'
  return m
}
