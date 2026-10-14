import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, History, KeyRound, PlugZap, ShieldOff, TriangleAlert } from 'lucide-react'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { copierTexte } from '../lib/copier.ts'
import { dateRelative } from '../lib/dates.ts'
import {
  APRES_INSTALLATION, CLE_IMPORT_RE, ETAPES, RATTRAPAGE, departAReculer, etatGoogle, programmeAvecCle, serviceALecteur, versionDuProgramme,
  type CleImport, type CopieDemandee,
} from '../lib/recusGoogle.ts'
import { jourLisible, type Service } from '../lib/depenses.ts'
import PROGRAMME from '../google/recus-claude/Code.gs?raw'
import REGLAGES from '../google/recus-claude/appsscript.json?raw'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'

/** La version du programme livrée avec cette version de l'app (« const VERSION = 1; » dans Code.gs). */
const VERSION_LIVREE = versionDuProgramme(PROGRAMME) ?? 1
const SONDAGE_MS = 4_000

const STYLE: Record<string, string> = {
  aucune: 'border-bord text-texte-2', branche: 'border-bord text-texte-2',
  attente: 'border-attention/40 bg-attention/10 text-attention', perime: 'border-attention/40 bg-attention/10 text-attention',
}

/**
 * La ligne « Reçus par e-mail » de la carte du prestataire Claude (0087, chantier 72a8d0f4). Raphaël : « Programme dans ton compte
 * Google » : un petit programme de SON compte lit ses reçus Anthropic (lecture seule) et les range ici, avec le PDF de chaque facture.
 * Le dernier passage et ses échecs restent dits par la ligne « Import automatique » (battement) ; celle-ci dit la clé et le dernier appel.
 */
export function LigneGoogle({ service, cle, now, erreur, onGerer }: { service: Service; cle: CleImport | null; now: Date; erreur: string | null; onGerer: () => void }) {
  if (!serviceALecteur(service.nom)) return null
  const e = etatGoogle(cle, VERSION_LIVREE, now)
  return (
    <div className={`mt-2 rounded-xl border px-2.5 py-1.5 text-xs ${STYLE[e.niveau]}`} data-testid="import-google" data-niveau={e.niveau}>
      <div className="flex items-start gap-1.5">
        {e.niveau === 'branche' ? <PlugZap size={14} className="mt-0.5 shrink-0" aria-hidden /> : e.niveau === 'aucune' ? <KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden /> : <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />}
        <span className="font-medium">{e.titre}</span>
      </div>
      {e.detail ? <p className="mt-0.5 pl-5">{e.detail}</p> : null}
      {erreur ? <p className="mt-0.5 pl-5 text-alerte" role="alert">{erreur}</p> : null}
      <div className="mt-1.5 pl-5">
        <Button taille="sm" variante={cle ? 'secondaire' : 'primaire'} onClick={onGerer} data-testid="import-google-gerer">{cle ? 'Gérer' : 'Brancher mon compte Google'}</Button>
      </div>
    </div>
  )
}

/**
 * L'assistant d'installation : UNE étape à la fois, un lien exact, un texte prêt à coller. La clé n'existe en clair que dans cette fenêtre
 * (la base n'en garde que l'empreinte) : si elle est perdue, on en crée une autre et l'ancienne s'arrête.
 */
export function AssistantGoogle({ service, cle, now, plusAncienneFacture, onFermer, onChange }: { service: Service; cle: CleImport | null; now: Date; plusAncienneFacture: string | null; onFermer: () => void; onChange: () => void }) {
  const toast = useToast()
  const confirmer = useConfirmer()
  const [cleClair, setCleClair] = useState<string | null>(null)
  const [recommencer, setRecommencer] = useState(false)
  const [etape, setEtape] = useState(0)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [copie, setCopie] = useState<CopieDemandee | null>(null)

  // Le programme a appelé AVEC la clé créée ici (pas une ancienne : ses 4 derniers caractères la reconnaissent).
  const contact = !!cleClair && !!cle && cle.fin === cleClair.slice(-4) && !!cle.derniere_utilisation_at
  const programme = useMemo(() => (cleClair ? programmeAvecCle(PROGRAMME, cleClair) : ''), [cleClair])
  // Tant que le programme n'a pas appelé, l'écran relit lui-même (le temps réel peut manquer : réseau, navigateur).
  const relire = useRef(onChange)
  relire.current = onChange
  useEffect(() => {
    if (!cleClair || contact) return
    const t = window.setInterval(() => relire.current(), SONDAGE_MS)
    return () => window.clearInterval(t)
  }, [cleClair, contact])

  const creer = async () => {
    setEnCours(true); setErreur(null)
    const { data, error } = await supabase.rpc('creer_cle_import', { p_service: service.id })
    setEnCours(false)
    if (error || typeof data !== 'string' || !CLE_IMPORT_RE.test(data)) {
      const m = error ? messageErreur(error) : 'Le serveur a répondu autre chose qu’une clé. Réessaie.'
      setErreur(m); toast.erreur(m); return
    }
    // Réussite = l'écran passe à l'étape 2 (visible) : pas de toast en plus, il masquerait les consignes sur un téléphone.
    setCleClair(data); setEtape(1); setRecommencer(false); onChange()
  }
  const revoquer = async () => {
    if (!cle) return
    if (!(await confirmer({ titre: 'Révoquer la clé ?', texte: 'Le programme de ton compte Google s’arrête : ses prochains passages seront refusés. Les factures déjà rangées ne bougent pas.', libelleOk: 'Révoquer', danger: true }))) return
    setEnCours(true)
    const { error } = await supabase.rpc('revoquer_cle_import', { p_cle: cle.id })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    setCleClair(null); setEtape(0)
    toast.succes('Clé révoquée. Le programme ne peut plus rien ranger.'); onChange()
  }
  const copier = async (quoi: CopieDemandee) => {
    const ok = await copierTexte(quoi === 'programme' ? programme : REGLAGES)
    if (!ok) { toast.erreur('La copie a échoué. Ouvre « Afficher le texte » juste en dessous et copie-le à la main.'); return }
    // Réussite = le bouton passe à « Copié » (visible, sous le doigt) : pas de toast en plus.
    setCopie(quoi); window.setTimeout(() => setCopie((c) => (c === quoi ? null : c)), 2500)
  }
  const reculerA = departAReculer(service.import_depuis, plusAncienneFacture)
  const [recule, setRecule] = useState(false)
  const reculer = async () => {
    if (!reculerA) return
    setRecule(true)
    const { error } = await supabase.from('services').update({ import_depuis: reculerA }).eq('id', service.id)
    setRecule(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(RATTRAPAGE.fait(jourLisible(reculerA) ?? reculerA)); onChange()
  }
  const fermer = async () => {
    if (cleClair && !contact && !(await confirmer({ titre: 'Fermer sans terminer ?', texte: 'La clé ne s’affichera plus. Pour reprendre, tu en crées une autre et l’ancienne s’arrête.', libelleOk: 'Fermer' }))) return
    onFermer()
  }

  const assistant = !!cleClair
  const e = ETAPES[assistant ? etape : 0]
  const dernier = assistant && etape === ETAPES.length - 1
  return (
    <Dialog ouvert onFermer={() => { void fermer() }} titre={assistant ? `Étape ${etape + 1} sur ${ETAPES.length} · ${e.titre}` : 'Reçus Claude : programme dans ton compte Google'}
      pied={assistant ? (
        <>
          <Button onClick={() => setEtape(Math.max(1, etape - 1))} disabled={etape <= 1} data-testid="google-precedent"><ChevronLeft size={16} />Précédent</Button>
          {dernier ? <Button variante="primaire" onClick={onFermer} disabled={!contact} data-testid="google-terminer">Terminer</Button>
            : <Button variante="primaire" onClick={() => setEtape(etape + 1)} data-testid="google-suivant">Suivant<ChevronRight size={16} /></Button>}
        </>
      ) : <Button onClick={onFermer}>Fermer</Button>}>
      <div className="space-y-3" data-testid="assistant-google" data-etape={assistant ? e.id : cle ? 'gestion' : 'cle'}>
        {!assistant ? (
          <>
            {cle && !recommencer ? (
              <div className="space-y-3" data-testid="google-gestion">
                <p className="text-sm">Un programme de ton compte Google est branché sur <b>{service.nom}</b>.</p>
                <ul className="space-y-1 text-sm text-texte-2">
                  <li>Clé se terminant par <b>…{cle.fin}</b>, créée {new Date(cle.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.</li>
                  <li>{cle.derniere_utilisation_at ? <>Le programme a appelé le cockpit <b>{dateRelative(cle.derniere_utilisation_at, now)}</b>.</> : 'Le programme n’a pas encore appelé le cockpit.'}</li>
                  {cle.programme_version ? <li>Version du programme : {cle.programme_version}{cle.programme_version < VERSION_LIVREE ? ` (la version ${VERSION_LIVREE} est disponible)` : ' (à jour)'}.</li> : null}
                </ul>
                <p className="text-sm text-texte-2">La clé ne peut pas être affichée de nouveau. Pour recopier le programme, ou s’il est périmé, crée une nouvelle clé : l’ancienne s’arrête.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variante="primaire" onClick={() => setRecommencer(true)} data-testid="google-remplacer"><KeyRound size={16} />Nouvelle clé et nouveau programme</Button>
                  <Button variante="danger" chargement={enCours} onClick={() => void revoquer()} data-testid="google-revoquer"><ShieldOff size={16} />Révoquer la clé</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3" data-testid="google-cle">
                <p className="text-sm">Un petit programme de <b>ton compte Google</b> lit chaque semaine tes mails de reçu d’Anthropic et les range dans Coûts, avec le PDF de chaque facture.</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-texte-2">
                  <li>Gratuit, aucune IA ne lit ta boîte mail.</li>
                  <li>Lecture seule : Google lui-même interdit au programme d’envoyer ou de supprimer un mail.</li>
                  <li>Il ne lit que les mails d’Anthropic. Il ne parle qu’à Gmail et à ton cockpit.</li>
                  <li>Tu l’installes une seule fois (10 à 15 minutes), puis plus rien à faire.</li>
                </ul>
                <p className="text-sm">{ETAPES[0].consignes.join(' ')}</p>
                {erreur ? <p className="text-sm text-alerte" role="alert">{erreur}</p> : null}
                <Button variante="primaire" taille="lg" pleine chargement={enCours} onClick={() => void creer()} data-testid="google-creer-cle"><KeyRound size={18} />{cle ? 'Créer une nouvelle clé' : 'Créer ma clé'}</Button>
              </div>
            )}
          </>
        ) : (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-[15px]">
              {e.consignes.map((c) => <li key={c}>{c}</li>)}
            </ol>
            {e.lien ? (
              <a className="flex h-12 items-center justify-center gap-2 rounded-xl border border-accent bg-accent px-4 text-base font-semibold text-accent-fg" href={e.lien.url} target="_blank" rel="noopener noreferrer" data-testid="google-lien"><ExternalLink size={18} />{e.lien.libelle}</a>
            ) : null}
            {e.copier ? (
              <div className="space-y-2">
                <Button variante="primaire" taille="lg" pleine onClick={() => void copier(e.copier!.quoi)} data-testid={`google-copier-${e.copier.quoi}`}>
                  {copie === e.copier.quoi ? <Check size={18} /> : <Copy size={18} />}{copie === e.copier.quoi ? 'Copié' : e.copier.libelle}
                </Button>
                <details className="text-sm">
                  <summary className="cursor-pointer text-texte-2">Si la copie ne marche pas : afficher le texte</summary>
                  <textarea readOnly rows={8} value={e.copier.quoi === 'programme' ? programme : REGLAGES} onFocus={(ev) => ev.currentTarget.select()}
                    className="mt-2 w-full rounded-xl border border-bord bg-carte-2 p-2 font-mono text-xs" aria-label={e.copier.libelle} />
                </details>
              </div>
            ) : null}
            {e.id === 'verifier' ? (
              contact ? (
                <div className="space-y-3" data-testid="google-contact-ok">
                  <p className="flex items-start gap-2 rounded-xl border border-ok/60 px-3 py-2 text-sm text-ok" role="status"><Check size={18} className="mt-0.5 shrink-0" aria-hidden /><span><b>Le programme a bien appelé le cockpit.</b> L’installation est finie.</span></p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">{APRES_INSTALLATION.map((t) => <li key={t}>{t}</li>)}</ul>
                  {reculerA ? (
                    <div className="space-y-2 rounded-xl border border-bord px-3 py-2" data-testid="google-rattrapage">
                      <p className="text-sm font-medium">{RATTRAPAGE.titre(jourLisible(reculerA) ?? reculerA)}</p>
                      <p className="text-sm text-texte-2">{RATTRAPAGE.explication}</p>
                      <Button variante="secondaire" chargement={recule} onClick={() => void reculer()} data-testid="google-reculer" className="h-auto! min-h-10 whitespace-normal! py-1.5 text-left leading-tight"><History size={16} className="shrink-0" />{RATTRAPAGE.bouton}</Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2" data-testid="google-attente">
                  <p className="flex items-center gap-2 rounded-xl border border-bord px-3 py-2 text-sm text-texte-2" role="status"><span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />J’attends le premier appel du programme…</p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-texte-2">Rien ne se passe ?</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-texte-2">
                      <li>Lis le journal en bas de l’éditeur Google : il dit pourquoi (autorisation refusée, clé incorrecte…).</li>
                      <li>« Cette clé a été remplacée ou révoquée » : tu as recopié un ancien programme. Reprends à l’étape « Colle le programme ».</li>
                      <li>« Gmail a répondu 403 » : relance « installer » et accepte la lecture de tes mails.</li>
                    </ul>
                  </details>
                </div>
              )
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  )
}
