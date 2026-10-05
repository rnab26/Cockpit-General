import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button.tsx'
import { useToast } from '../ui/Toast.tsx'
import { appliquerMiseAJour, reglerVersion, verifierVersion, useVersion } from '../hooks/useNouvelleVersion.ts'
import { RAPPELS_MIN, messageVerification, phraseVersion } from '../lib/version.ts'

const libelleRappel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`)

/**
 * Réglages › « Version de l'application » (5 oct. 2026, chantier c4de4baa) :
 * à jour ou non, « Vérifier maintenant », « Mettre à jour », le délai de
 * retour de la bannière écartée et la mise à jour automatique (éteinte par
 * défaut, jamais pendant une saisie). Toute la décision : lib/version.ts.
 */
export function SectionVersion() {
  const v = useVersion()
  const toast = useToast()
  const verifier = async () => {
    const m = messageVerification(await verifierVersion())
    if (m.ok) toast.succes(m.texte); else toast.erreur(m.texte)
  }
  const tient = (r: Parameters<typeof reglerVersion>[0], texte: string) => {
    if (reglerVersion(r)) toast.succes(texte)
    else toast.erreur('Réglage appliqué, mais ce navigateur ne peut pas le retenir : il sera perdu au prochain chargement.')
  }
  return (
    <section data-testid="section-version">
      <h3 className="mb-1 text-sm font-semibold">Version de l’application</h3>
      <p className="mb-2 text-xs text-texte-2" data-testid="version-etat" data-statut={v.statut}>{phraseVersion(v.etat)}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variante="secondaire" onClick={() => void verifier()} disabled={v.statut === 'verification' || v.enCours} data-testid="verifier-version">
          <RefreshCw size={16} className={v.statut === 'verification' ? 'animate-spin' : ''} aria-hidden />Vérifier maintenant
        </Button>
        {v.nouvelle ? (
          <Button onClick={() => void appliquerMiseAJour()} disabled={v.enCours} data-testid="mettre-a-jour-reglages">{v.enCours ? 'Mise à jour…' : 'Mettre à jour'}</Button>
        ) : null}
      </div>
      <p className="mb-1 mt-3 text-xs text-texte-2">Si j’écarte la bannière « Nouvelle version », elle revient après</p>
      <div className="grid grid-cols-3 gap-1.5" data-testid="version-rappel">
        {RAPPELS_MIN.map((m) => (
          <Button key={m} taille="sm" variante={v.reglages.rappelMin === m ? 'primaire' : 'secondaire'} aria-pressed={v.reglages.rappelMin === m}
            onClick={() => tient({ rappelMin: m }, `La bannière reviendra après ${libelleRappel(m)}.`)}>{libelleRappel(m)}</Button>
        ))}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={v.reglages.auto} data-testid="version-auto"
          onChange={(e) => tient({ auto: e.target.checked }, e.target.checked ? 'Mise à jour automatique activée : seulement quand tu n’écris rien.' : 'Mise à jour automatique désactivée.')} />
        <span>Mettre à jour automatiquement quand je n’écris rien<span className="block text-xs text-texte-2">Jamais pendant qu’un texte ou une pièce jointe n’est pas envoyé. Éteint par défaut.</span></span>
      </label>
    </section>
  )
}
