import { useEffect, useState, useSyncExternalStore } from 'react'
import { CloudOff, RefreshCw, TriangleAlert, ChevronUp, ChevronDown } from 'lucide-react'
import { abandonnerElement, abonner, etatFile, plusAncienAttente, reessayerElement, renvoyerMaintenant } from '../lib/fetchResilient.ts'
import { CLE_DELAI_PANNEAU, delaiPanneauDe, niveauAffichage, phraseBandeau } from '../lib/fileAttente.ts'
import { copierTexte } from '../lib/copier.ts'
import { Button } from '../ui/Button.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { useToast } from '../ui/Toast.tsx'

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/**
 * Bandeau « hors ligne / en attente » (5 oct. 2026, chantier 5b68a493).
 * Il dit, sans qu'on le cherche : ce qui est gardé sur l'appareil et pas encore
 * parti, ce que le serveur a refusé (jamais jeté en silence : copier, réessayer,
 * abandonner après confirmation), et que les données affichées sont celles de la
 * dernière connexion. Rien quand tout est parti et que le réseau est là.
 */
export function BandeauFileAttente() {
  const e = useSyncExternalStore(abonner, etatFile, etatFile)
  const toast = useToast()
  const confirmer = useConfirmer()
  const [ouvert, setOuvert] = useState(false)

  useEffect(() => {
    const f = (ev: Event) => {
      const n = (ev as CustomEvent<{ n: number }>).detail?.n ?? 0
      if (n > 0) toast.succes(n === 1 ? '1 élément en attente a été envoyé.' : `${n} éléments en attente ont été envoyés.`)
    }
    window.addEventListener('cockpit-file-envoyee', f)
    return () => window.removeEventListener('cockpit-file-envoyee', f)
  }, [toast])

  // Le panneau n'arrive qu'après le délai (réglable) : on repasse chaque seconde tant qu'une écriture attend.
  const [, rebattre] = useState(0)
  useEffect(() => {
    if (e.attente === 0) return
    const t = window.setInterval(() => rebattre((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [e.attente])
  let delaiS = delaiPanneauDe(null)
  try { delaiS = delaiPanneauDe(localStorage.getItem(CLE_DELAI_PANNEAU)) } catch { /* défaut */ }
  const niveau = niveauAffichage({ attente: e.attente, refuses: e.refuses, horsLigne: e.horsLigne, plusAncienAttente: plusAncienAttente(), maintenant: Date.now(), delaiS })
  if (niveau === 'rien') return null
  if (niveau === 'voyant') {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),4px)] z-40 flex justify-center" data-testid="voyant-hors-ligne">
        <span className="inline-flex items-center gap-1 rounded-full border border-bord bg-carte/90 px-2 py-0.5 text-[11px] text-texte-2 shadow" role="status">
          <CloudOff size={12} aria-hidden /> Hors ligne
        </span>
      </div>
    )
  }
  const p = phraseBandeau({ attente: e.attente, refuses: e.refuses, horsLigne: e.horsLigne, envoi: e.envoi })
  if (!p) return null
  const couleur = p.niveau === 'erreur' ? 'border-alerte/60' : p.niveau === 'attention' ? 'border-attention/60' : 'border-info/40'
  const Icone = p.niveau === 'erreur' ? TriangleAlert : e.horsLigne ? CloudOff : RefreshCw

  const copier = async (texte: string) => { if (await copierTexte(texte)) toast.succes('Copié.'); else toast.erreur('Copie impossible.') }

  return (
    <div className="fixed inset-x-0 top-[max(env(safe-area-inset-top),8px)] z-40 flex justify-center px-3" data-testid="bandeau-file-attente">
      <div className={`w-full max-w-lg rounded-xl border ${couleur} bg-carte p-2 text-sm shadow-lg`} role="status">
        <div className="flex items-start gap-2">
          <Icone size={18} className={`mt-0.5 shrink-0 ${p.niveau === 'erreur' ? 'text-alerte' : p.niveau === 'attention' ? 'text-attention' : 'text-info'} ${e.envoi ? 'animate-spin' : ''}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p data-testid="bandeau-texte">{p.texte}</p>
            {e.attente > 0 ? <p className="text-xs text-texte-2">Ne vide pas les données du site avant l’envoi.</p> : null}
            {e.donneesDu ? <p className="text-xs text-texte-2">Données de {heure(e.donneesDu)}.</p> : null}
            {!e.durable && e.attente > 0 ? <p className="text-xs text-alerte">Ce navigateur ne garde pas la file après fermeture : garde cet onglet ouvert jusqu’à l’envoi.</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {e.attente > 0 && !e.envoi ? <Button taille="sm" variante="secondaire" onClick={() => { void renvoyerMaintenant() }} data-testid="renvoyer-maintenant">Envoyer</Button> : null}
            {e.elements.length > 0 ? (
              <button type="button" aria-label={ouvert ? 'Masquer le détail' : 'Voir le détail'} onClick={() => setOuvert(!ouvert)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-texte-2 hover:bg-carte-2">
                {ouvert ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
              </button>
            ) : null}
          </div>
        </div>
        {ouvert && e.elements.length > 0 ? (
          <ul className="mt-2 max-h-[40dvh] space-y-2 overflow-y-auto border-t border-bord pt-2" data-testid="liste-file-attente">
            {e.elements.map((el) => (
              <li key={el.id} className="rounded-lg bg-carte-2 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{el.resume}</span>
                  <span className="shrink-0 text-xs text-texte-2">{heure(el.ajoute)}</span>
                </div>
                {el.apercu ? <p className="mt-1 line-clamp-3 break-words text-xs text-texte-2">{el.apercu}</p> : null}
                <p className={`mt-1 text-xs ${el.statut === 'refuse' ? 'text-alerte' : 'text-texte-2'}`}>
                  {el.statut === 'refuse' ? (el.raison ?? 'Refusé par le serveur.') : el.essais > 0 ? `En attente du réseau (${el.essais} essai${el.essais > 1 ? 's' : ''}).` : 'En attente d’envoi.'}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button taille="sm" variante="discret" onClick={() => { void copier(el.apercu || el.resume) }}>Copier</Button>
                  {el.statut === 'refuse' ? <Button taille="sm" variante="secondaire" onClick={() => { void reessayerElement(el.id) }}>Réessayer</Button> : null}
                  <Button taille="sm" variante="danger" onClick={async () => {
                    if (!(await confirmer({ titre: 'Abandonner cet envoi ?', texte: 'Il est effacé de cet appareil et ne sera jamais envoyé. Copie-le d’abord si tu veux le garder.', libelleOk: 'Abandonner', danger: true }))) return
                    await abandonnerElement(el.id)
                    toast.info('Envoi abandonné.')
                  }}>Abandonner</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
