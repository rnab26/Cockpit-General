import { Bell, BellOff } from 'lucide-react'
import { Button } from '../ui/Button.tsx'
import { useToast } from '../ui/Toast.tsx'
import { usePush } from '../hooks/usePush.ts'
import { TEXTE_REFUSE } from '../lib/push.ts'

/**
 * Section des Réglages : recevoir une notification du téléphone quand Claude
 * répond, même hors de l'appli. Un réglage par appareil ; chaque geste dit s'il
 * a réussi ou échoué (toast), et chaque état (chargement, non supporté, refusé,
 * iPhone) a son texte.
 */
export function SectionNotifications({ ouvrirAide }: { ouvrirAide: () => void }) {
  const { etat, occupe, activer, desactiver } = usePush()
  const toast = useToast()
  const lancer = async (f: () => Promise<void>, ok: string) => {
    try { await f(); toast.succes(ok) } catch (e) { toast.erreur(e instanceof Error ? e.message : 'Échec des notifications.') }
  }
  return (
    <section data-testid="notifications-push" data-etat={etat}>
      <h3 className="mb-1 text-sm font-semibold">Notifications de réponses</h3>
      {etat === 'chargement' ? <p className="text-xs text-texte-2">Vérification…</p> : null}
      {etat === 'actif' ? (
        <>
          <p className="mb-2 text-xs text-texte-2">Activées sur cet appareil : tu es prévenu dès que Claude répond, même si l’appli est fermée. Dans l’appli, une pastille rouge « Réponse » marque le fil.</p>
          <Button pleine variante="secondaire" disabled={occupe} onClick={() => void lancer(desactiver, 'Notifications coupées sur cet appareil.')} data-testid="push-desactiver"><BellOff size={16} aria-hidden />Couper sur cet appareil</Button>
        </>
      ) : null}
      {etat === 'inactif' ? (
        <>
          <p className="mb-2 text-xs text-texte-2">Une bannière sur ce téléphone quand Claude répond, même si l’appli est fermée. Réglage propre à chaque appareil.</p>
          <Button pleine variante="secondaire" disabled={occupe} onClick={() => void lancer(activer, 'Notifications activées sur cet appareil.')} data-testid="push-activer"><Bell size={16} aria-hidden />Activer sur cet appareil</Button>
        </>
      ) : null}
      {etat === 'refuse' ? (
        <div className="text-xs text-texte-2" data-testid="push-refuse">
          <p className="mb-1">Les notifications sont bloquées pour ce site. Pour les rouvrir :</p>
          <ol className="list-decimal space-y-0.5 pl-5">{TEXTE_REFUSE.map((t) => <li key={t}>{t}</li>)}</ol>
        </div>
      ) : null}
      {etat === 'ios_installer' ? (
        <>
          <p className="mb-2 text-xs text-texte-2">Sur iPhone, les notifications ne marchent que dans l’appli posée sur l’écran d’accueil. Installe-la d’abord, puis reviens ici.</p>
          <Button pleine variante="secondaire" onClick={ouvrirAide}>Comment installer l’appli</Button>
        </>
      ) : null}
      {etat === 'non_supporte' ? <p className="text-xs text-texte-2">Ce navigateur ne gère pas les notifications. Essaie Chrome (Android, ordinateur) ou l’appli installée (iPhone).</p> : null}
      {etat === 'non_configure' ? <p className="text-xs text-texte-2">Le serveur n’est pas encore prêt pour les notifications.</p> : null}
    </section>
  )
}
