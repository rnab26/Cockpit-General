import { useState } from 'react'
import { Copy, ExternalLink, Link2, Link2Off } from 'lucide-react'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { copierTexte } from '../lib/copier.ts'
import { scriptRecus, MANIFESTE_RECUS } from '../lib/scriptRecus.ts'
import { dateRelative } from '../lib/dates.ts'
import type { Service } from '../lib/depenses.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'

/** Un fournisseur dont le cockpit sait lire les reçus (aujourd'hui : Anthropic = « Claude »). */
export const lisiblePar = (nom: string) => /claude|anthropic/i.test(nom)

/**
 * Brancher la lecture automatique des reçus Claude (chantier 72a8d0f4) : un petit programme dans le compte Google de
 * Raphaël (Google Apps Script) lit ses mails de reçus Anthropic en lecture seule et les envoie au cockpit chaque semaine.
 * La clé n'est montrée qu'à la demande, jamais gardée à l'écran après la fermeture.
 */
export function BrancherRecus({ service, now, onChange }: { service: Service; now: Date; onChange: () => void }) {
  const toast = useToast()
  const confirmer = useConfirmer()
  const [ouvert, setOuvert] = useState(false)
  const [cle, setCle] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const branche = !!service.import_cle_at

  const fermer = () => { setOuvert(false); setCle(null) }
  const preparer = async () => {
    if (branche && !(await confirmer({ titre: 'Remplacer la clé ?', texte: 'Le programme déjà posé dans ton compte Google cessera de marcher. Tu devras coller le nouveau texte.', libelleOk: 'Remplacer', danger: true }))) return
    setEnCours(true)
    const { data, error } = await supabase.rpc('brancher_import_recus', { p_service: service.id })
    setEnCours(false)
    if (error || typeof data !== 'string' || !data) { toast.erreur(error ? messageErreur(error) : 'Impossible de préparer le programme (pas de réseau ?). Réessaie.'); return }
    setCle(data); onChange()
  }
  const debrancher = async () => {
    if (!(await confirmer({ titre: 'Débrancher la lecture automatique ?', texte: 'Le programme de ton compte Google ne pourra plus rien ajouter. Tes factures déjà dans Coûts restent.', libelleOk: 'Débrancher', danger: true }))) return
    setEnCours(true)
    const { error } = await supabase.rpc('debrancher_import_recus', { p_service: service.id })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    setCle(null); toast.succes('Lecture automatique débranchée.'); onChange(); setOuvert(false)
  }
  const copier = async (texte: string, quoi: string) => {
    if (await copierTexte(texte)) toast.succes(`${quoi} copié.`)
    else toast.erreur('Copie impossible : appuie longuement sur le texte pour le copier à la main.')
  }

  return (
    <>
      <Button taille="sm" onClick={() => setOuvert(true)} data-testid="brancher-recus">
        {branche ? <Link2 size={14} aria-hidden /> : <Link2Off size={14} aria-hidden />}
        {branche ? 'Lecture des reçus : branchée' : 'Brancher la lecture des reçus'}
      </Button>
      {ouvert ? (
        <Dialog ouvert onFermer={fermer} titre="Reçus Claude, tout seuls" large
          pied={<>
            {branche ? <Button variante="danger" chargement={enCours} onClick={() => void debrancher()}>Débrancher</Button> : null}
            <Button onClick={fermer}>Fermer</Button>
          </>}>
          <div className="space-y-3 text-sm" data-testid="brancher-recus-dialogue">
            <p>Un petit programme, posé <b>une seule fois</b> dans ton compte Google, lit tes mails de reçus Anthropic chaque dimanche matin et les range dans Coûts, avec leur PDF. Il peut <b>seulement lire</b> tes mails : ni écrire, ni envoyer, ni supprimer. Gratuit, sans IA.</p>
            {branche && !cle ? (
              <p className="rounded-xl border border-bord px-2.5 py-1.5" data-testid="recus-branche">Branché {dateRelative(service.import_cle_at, now)}. Si tu l’as perdu ou changé de compte Google, prépare un nouveau programme : l’ancien cessera de marcher.</p>
            ) : null}
            {!cle ? (
              <Button variante="primaire" chargement={enCours} onClick={() => void preparer()} data-testid="preparer-recus">{branche ? 'Préparer un nouveau programme' : 'Préparer le programme'}</Button>
            ) : (
              <ol className="list-decimal space-y-3 pl-5" data-testid="recus-etapes">
                <li>Ouvre <a className="font-medium underline" href="https://script.google.com/create" target="_blank" rel="noopener noreferrer">script.google.com/create <ExternalLink size={12} className="inline" aria-hidden /></a> avec ton compte Google (celui qui reçoit les reçus). Un nouveau projet s’ouvre.</li>
                <li>À gauche, touche l’engrenage « Paramètres du projet » (« Project Settings »). Coche « Afficher le fichier manifeste « appsscript.json » dans l’éditeur ».</li>
                <li>Reviens à gauche sur « Éditeur » (« Editor »), ouvre le fichier <b>appsscript.json</b>, efface tout son contenu, puis colle ceci :
                  <div className="mt-1"><Button taille="sm" onClick={() => void copier(MANIFESTE_RECUS, 'Fichier appsscript.json')} data-testid="copier-manifeste"><Copy size={14} aria-hidden />Copier appsscript.json</Button></div></li>
                <li>Ouvre le fichier <b>Code.gs</b>, efface tout son contenu, colle ceci, puis touche l’icône disquette « Enregistrer » :
                  <div className="mt-1"><Button taille="sm" variante="primaire" onClick={() => void copier(scriptRecus(cle), 'Programme')} data-testid="copier-programme"><Copy size={14} aria-hidden />Copier le programme</Button></div>
                  <p className="mt-1 text-xs text-texte-2">Ce texte contient ta clé personnelle : ne le montre à personne.</p></li>
                <li>En haut, dans la liste des fonctions, choisis <b>installer</b>, puis touche « Exécuter » (« Run »).</li>
                <li>Google demande une autorisation : touche « Examiner les autorisations », choisis ton compte, puis « Paramètres avancés » › « Accéder à Sans titre (non sécurisé) » › « Autoriser ». Il doit demander seulement : lire tes e-mails, se connecter à un service externe, gérer ses déclencheurs. S’il demande d’<i>envoyer</i> ou de <i>supprimer</i> des mails, refuse et reviens à l’étape 3.</li>
                <li>Reviens ici dans Coûts : la carte Claude doit dire « passé à l’instant ». Ensuite, rien à faire : le programme repasse chaque dimanche matin.</li>
              </ol>
            )}
          </div>
        </Dialog>
      ) : null}
    </>
  )
}
