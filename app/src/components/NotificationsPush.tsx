import { Bell, BellOff } from 'lucide-react'
import { Button } from '../ui/Button.tsx'
import { useToast } from '../ui/Toast.tsx'
import { usePush } from '../hooks/usePush.ts'
import { TEXTE_REFUSE } from '../lib/push.ts'
import { useGlobal } from '../contexte.ts'
import { useReglagesNotif } from '../hooks/useReglagesNotif.ts'
import { Interrupteur } from '../ui/Champs.tsx'
import { Chargement, Erreur } from '../ui/Etats.tsx'
import { avecProjet, avecTousProjets, avecType, projetVoulu, resume, tousLesProjetsVoulus, typeVoulu, type ReglagesNotif } from '../lib/notifications.ts'

/**
 * Section des Réglages : recevoir une notification du téléphone quand Claude
 * répond, même hors de l'appli. Un réglage par appareil ; chaque geste dit s'il
 * a réussi ou échoué (toast), et chaque état (chargement, non supporté, refusé,
 * iPhone) a son texte.
 */
export function SectionNotifications({ ouvrirAide }: { ouvrirAide: () => void }) {
  const { etat, occupe, activer, desactiver } = usePush()
  const toast = useToast()
  const { moi, projets } = useGlobal()
  const { types, reglages, etat: etatReglages, erreur, enregistrer, recharger } = useReglagesNotif(moi.user_id)
  const actifs = projets.filter((p) => p.actif)
  const ids = actifs.map((p) => p.id)
  const poser = async (suivant: ReglagesNotif, ok: string) => {
    try { await enregistrer(suivant); toast.succes(ok) } catch (e) { toast.erreur(`Réglage non enregistré : ${e instanceof Error ? e.message : 'erreur inconnue'}`) }
  }
  const lancer = async (f: () => Promise<void>, ok: string) => {
    try { await f(); toast.succes(ok) } catch (e) { toast.erreur(e instanceof Error ? e.message : 'Échec des notifications.') }
  }
  return (
    <section data-testid="notifications-push" data-etat={etat}>
      <h3 className="mb-1 text-sm font-semibold">Notifications</h3>
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
      <div className="mt-4 space-y-3" data-testid="notifications-reglages">
        <p className="text-xs text-texte-2">Choisis ce qui t’est envoyé, sur tous tes appareils abonnés. Chaque interrupteur s’enregistre tout de suite.</p>
        {etatReglages === 'chargement' ? <Chargement texte="Chargement de tes réglages…" /> : null}
        {etatReglages === 'erreur' ? <Erreur texte={`Réglages illisibles : ${erreur}`} onReessayer={recharger} /> : null}
        {etatReglages === 'ok' ? (
          <>
            {etat !== 'actif' && etat !== 'chargement' ? <p className="rounded-xl bg-carte-2 px-3 py-2 text-xs text-texte-2" data-testid="notif-appareil-non-abonne">Cet appareil n’est pas abonné : ces réglages sont enregistrés, mais rien n’arrivera ici tant que tu n’as pas activé les notifications ci-dessus.</p> : null}
            <div className="space-y-1.5" data-testid="notif-types">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-texte-2">Quoi</h4>
              {types.map((t) => t.emis ? (
                <div key={t.code} data-testid={`notif-type-${t.code}`}>
                  <Interrupteur actif={typeVoulu(t, reglages)} label={t.libelle}
                    onChange={(v) => void poser(avecType(reglages, t.code, v), `${t.libelle} : ${v ? 'activé' : 'coupé'}.`)} />
                  <p className="px-1 pt-0.5 text-xs text-texte-2">{t.aide}</p>
                </div>
              ) : (
                <div key={t.code} className="rounded-xl border border-dashed border-bord px-3 py-2 text-[15px]" data-testid={`notif-type-${t.code}`} data-bientot>
                  <div className="flex items-center justify-between gap-2"><span>{t.libelle}</span><span className="rounded-full bg-carte-2 px-2 py-0.5 text-xs text-texte-2">bientôt</span></div>
                  <p className="pt-0.5 text-xs text-texte-2">{t.aide} Pas encore envoyé par le cockpit.</p>
                </div>
              ))}
            </div>
            <div className="space-y-1.5" data-testid="notif-projets">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-texte-2">Pour quels projets</h4>
              {ids.length === 0 ? <p className="text-xs text-texte-2">Aucun projet pour l’instant : les réglages s’appliqueront à ceux que tu auras.</p> : (
                <>
                  <Interrupteur actif={tousLesProjetsVoulus(ids, reglages)} label={<strong>Tous les projets</strong>}
                    onChange={(v) => void poser(avecTousProjets(reglages, ids, v), v ? 'Tous les projets sont activés.' : 'Tous les projets sont coupés.')} />
                  {actifs.map((p) => (
                    <Interrupteur key={p.id} actif={projetVoulu(p.id, reglages)} label={p.nom}
                      onChange={(v) => void poser(avecProjet(reglages, p.id, v), `${p.nom} : ${v ? 'activé' : 'coupé'}.`)} />
                  ))}
                </>
              )}
            </div>
            <p className="text-xs font-medium" data-testid="notif-resume">{resume(types, ids, reglages)}</p>
          </>
        ) : null}
      </div>
    </section>
  )
}
