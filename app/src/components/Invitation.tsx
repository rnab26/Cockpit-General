import { useEffect, useRef, useState } from 'react'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { jetonEnAttente, oublierInvitation, LIBELLE_ROLE } from '../lib/invitation.ts'

type Info = { projet?: string; role?: string; valide: boolean; raison?: string }

/** Sur l'écran de connexion : dit à quoi la personne est invitée, avant même qu'elle ait un compte. */
export function BandeauInvitation() {
  const [info, setInfo] = useState<Info | null>(null)
  const jeton = jetonEnAttente()
  useEffect(() => {
    if (!jeton) return
    void supabase.rpc('invitation_info', { p_jeton: jeton }).then(({ data }) => { if (data) setInfo(data as Info) })
  }, [jeton])
  if (!jeton || !info) return null
  return info.valide ? (
    <div role="status" data-testid="bandeau-invitation" className="mb-4 rounded-xl border border-bord bg-carte-2 p-3 text-sm">
      Tu es invité sur <b>{info.projet}</b> ({LIBELLE_ROLE[info.role ?? ''] ?? info.role}). Connecte-toi ou crée ton compte : l’accès s’ouvre tout seul ensuite.
    </div>
  ) : (
    <div role="alert" data-testid="bandeau-invitation" className="mb-4 rounded-xl border border-alerte p-3 text-sm text-alerte">
      Cette invitation est {info.raison ?? 'invalide'}. Demande à Raphaël de t’en envoyer une nouvelle.
    </div>
  )
}

/** Une fois connecté : accepte l'invitation gardée sur l'appareil, dit le résultat, recharge le profil. */
export function AccepteInvitation({ recharger }: { recharger: () => Promise<void> }) {
  const toast = useToast()
  const fait = useRef(false)
  useEffect(() => {
    const jeton = jetonEnAttente()
    if (!jeton || fait.current) return
    fait.current = true
    void supabase.rpc('accepter_invitation', { p_jeton: jeton }).then(async ({ data, error }) => {
      oublierInvitation()
      if (error) { toast.erreur(`Invitation : ${messageErreur(error)}`); return }
      const r = data as { projet: string; role: string }
      toast.succes(`Tu as accès à « ${r.projet} » (${LIBELLE_ROLE[r.role] ?? r.role}).`)
      await recharger()
    })
  }, [recharger, toast])
  return null
}
