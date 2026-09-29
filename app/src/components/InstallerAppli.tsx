import { Download } from 'lucide-react'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { useToast } from '../ui/Toast.tsx'
import { useInstallation } from '../hooks/useInstallation.ts'
import { TEXTE_INSTALLATION } from '../lib/installation.ts'

/**
 * « Installer l'appli » : sur Chrome, un toucher ouvre la vraie fenêtre
 * d'installation ; ailleurs (iPhone, invite pas prête), la marche à suivre.
 * Utilisé par le menu ⋯ (via useLancerInstallation) et par les Réglages.
 */
export function useLancerInstallation(ouvrirAide: () => void) {
  const { etat, installer } = useInstallation()
  const toast = useToast()
  const lancer = async () => {
    if (etat !== 'possible') { ouvrirAide(); return }
    try {
      const r = await installer()
      if (r === 'acceptee') toast.succes('Appli installée : elle est sur ton écran d’accueil.')
      else if (r === 'refusee') toast.info('Installation annulée. Tu peux la relancer depuis le menu ⋯.')
      else ouvrirAide()
    } catch (e) { toast.erreur(`Installation impossible : ${(e as Error).message}`) }
  }
  return { etat, lancer }
}

export function AideInstallation({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { etat } = useInstallation()
  const etapes = etat === 'iphone' ? TEXTE_INSTALLATION.iphone : TEXTE_INSTALLATION.manuel
  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre="Installer l’appli" pied={<Button onClick={onFermer}>Fermer</Button>}>
      {etat === 'installee' ? (
        <p className="text-sm" data-testid="aide-installation">Le cockpit est déjà installé : ouvre-le depuis son icône sur l’écran d’accueil.</p>
      ) : (
        <div className="space-y-3 text-sm" data-testid="aide-installation">
          <p className="text-texte-2">Le cockpit s’ouvrira comme une appli, en plein écran, depuis son icône.</p>
          <ol className="list-decimal space-y-1.5 pl-5">{etapes.map((t) => <li key={t}>{t}</li>)}</ol>
        </div>
      )}
    </Dialog>
  )
}

/** Section des Réglages : l'état, et le bouton. */
export function SectionInstallation({ ouvrirAide }: { ouvrirAide: () => void }) {
  const { etat, lancer } = useLancerInstallation(ouvrirAide)
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Appli sur le téléphone</h3>
      {etat === 'installee' ? (
        <p className="text-xs text-texte-2" data-testid="installation-etat">Installée : tu l’utilises en ce moment.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-texte-2">Une icône sur l’écran d’accueil, le cockpit en plein écran, sans la barre du navigateur.</p>
          <Button pleine variante="secondaire" onClick={() => void lancer()} data-testid="installer-appli-reglages"><Download size={16} aria-hidden />Installer l’appli</Button>
        </>
      )}
    </section>
  )
}
