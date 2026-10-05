import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Ban, CalendarClock, CheckCheck, ChevronDown, CircleCheck, CirclePause, Clock, Copy, Ellipsis, FolderInput, History, LockOpen, MessageSquare, Pencil, Play, Reply, SendHorizontal, Trash2 } from 'lucide-react'
import type { Chantier, Message } from '../lib/types.ts'
import { useCockpit, useGlobal } from '../contexte.ts'
import { useMarquerLu } from './PastilleReponse.tsx'
import { cleFil } from '../lib/lecture.ts'
import { projetsCibles, texteConfirmationDeplacement } from '../lib/deplacer.ts'
import { Select } from '../ui/Champs.tsx'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useProchainPassage } from '../hooks/useProchainPassage.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { CONFIRMER_ABANDON, aUnBrouillon, useMenuQuiSeFerme, useToucherLeFond } from '../ui/Modale.ts'
import { Button } from '../ui/Button.tsx'
import { TexteLong } from '../ui/TexteLong.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { infoEtat } from '../lib/etats.ts'
import { presenceDe, presenceEnMots } from '../lib/entonnoir.ts'
import { dateLongue, dateRelative } from '../lib/dates.ts'
import { situationSilence, phraseLiberee, DELAI_ABANDON_MIN } from '../lib/silence.ts'
import { phraseAttente, projetAutonome } from '../lib/enAttente.ts'
import { nomCourtSession } from '../lib/texte.ts'
import { mediasDe, resumeMedias } from '../lib/medias.ts'
import { attenteReponse, derniereAction, filLie, ordreDuFil, separerChat, type AttenteReponse } from '../lib/discussion.ts'
import { CHOIX_REPORT, dateDeReport, dateSaisie, texteReporte } from '../lib/reporter.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { BlocQuestion } from './BlocQuestion.tsx'
import { BlocValidation, SignalerProbleme } from './BlocValidation.tsx'
import { BlocBloque, BlocCadrer, BlocFusion } from './BlocsAToi.tsx'
import { CommentVerifierReplie } from './CommentVerifier.tsx'
import { PourReproduire } from './PourReproduire.tsx'
import { FriseMiseEnLigne } from './MiseEnLigne.tsx'
import { Historique } from './Historique.tsx'
import { BoutonsRelance } from './Relance.tsx'
import { chantierTenu, etatOuEnEst } from '../lib/ouEnEst.ts'
import { Progression } from './Progression.tsx'
import { TachesDuChantier } from './QuiTravaille.tsx'
import { PointTravaille } from './Vivant.tsx'
import { IconePresence, PointProjet } from './Icones.tsx'
import { BoutonJoindre, MediasMessage, VignettesPieces, deposerMedia, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'

/**
 * Chaque chantier s'ouvre en CONVERSATION (modèle D, choisi par Raphaël le 29
 * sept. 2026 : « vas-y fais A + D ») : une feuille plein écran sur téléphone,
 * un grand dialogue sur ordinateur. En haut le sujet et qui est dessus, au
 * milieu le fil en bulles (Claude à gauche, toi à droite), en bas « Écrire à
 * Claude… ».
 * Comme une discussion WhatsApp (Raphaël, 29 sept. : « que le dernier artefact
 * où je dois choisir des cartes se mette toujours en dernier, après ma question
 * et une fois que Claude a répondu ») : chronologique, le plus récent en bas,
 * on arrive EN BAS ; ce qui attend ton choix (question, fusion, vérification)
 * est toujours tout en bas ; après ton message, « réponse en attente » dit
 * qui va te répondre et quand (lib/discussion.ts).
 *
 * `chantierId` null : les questions du PROJET (sans chantier).
 */
export interface CibleConversation { projetId: string; chantierId: string | null }

/** Le texte d'invitation de la barre du bas, selon ce qu'on attend de toi. */
const PLACEHOLDER: Record<string, string> = {
  a_cadrer: 'Ta décision : ce que tu veux, ce que tu ne veux pas…',
  bloque: 'Ta réponse : ce que tu as fait, ou ce qu’il faut faire…',
  a_verifier: 'Écris ce qui ne va pas : Claude vérifie (rien à cocher)…',
}

export function Conversation({ cible, onFermer, onRetour }: { cible: CibleConversation; onFermer: () => void; onRetour: () => void }) {
  return (
    <Feuille onFermer={onFermer} onRetour={onRetour}>
      {cible.chantierId ? <FilChantier chantierId={cible.chantierId} /> : <FilProjet />}
    </Feuille>
  )
}

/**
 * Fermer la conversation. `demander` : les gestes « je quitte » (flèche, fond,
 * zone libre du fil, Échap, retour) — si un texte ou un fichier n'est pas
 * envoyé, on demande d'abord. `forcer` : après une suppression, sans question.
 */
interface Fermeture { demander: () => void; forcer: () => void }
const FermetureCtx = createContext<Fermeture>({ demander: () => {}, forcer: () => {} })

/** Un toucher sur une zone LIBRE du fil (entre et à côté des bulles, sous la dernière) ferme aussi. */
const estZoneLibre = (cible: EventTarget) => cible instanceof HTMLElement && cible.dataset.zoneLibre === 'oui'

/**
 * La feuille : un <dialog> modal (focus piégé, Échap). Sur téléphone elle
 * monte du bas et laisse voir une bande du fond en haut : toucher le fond la
 * ferme (règle commune, ui/Modale.ts). Le geste « retour » du téléphone la
 * ferme aussi : Cockpit.tsx pose l'entrée d'historique à l'ouverture, la
 * feuille écoute le retour — et, s'il reste un brouillon, remet l'entrée et
 * demande avant de quitter.
 */
function Feuille({ onFermer, onRetour, children }: { onFermer: () => void; onRetour: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const confirmer = useConfirmer()
  const rappels = useRef({ onFermer, onRetour })
  rappels.current = { onFermer, onRetour }
  const sansQuestion = useRef(false)
  const question = useRef(false)
  const fermeture = useMemo<Fermeture>(() => {
    const forcer = () => { sansQuestion.current = true; rappels.current.onFermer() }
    return {
      forcer,
      demander: () => {
        if (question.current) return
        if (!aUnBrouillon(ref.current)) { forcer(); return }
        question.current = true
        void confirmer(CONFIRMER_ABANDON).then((ok) => { question.current = false; if (ok) forcer() })
      },
    }
  }, [confirmer])
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    const onCancel = (e: Event) => { e.preventDefault(); fermeture.demander() }
    d?.addEventListener('cancel', onCancel)
    return () => { d?.removeEventListener('cancel', onCancel); if (d?.open) d.close() }
  }, [fermeture])
  useEffect(() => {
    const surRetour = () => {
      if (sansQuestion.current || !aUnBrouillon(ref.current)) { rappels.current.onRetour(); return }
      // Un brouillon : on remet la conversation dans l'historique, puis on demande.
      history.pushState({ conversation: true }, '', location.href)
      if (question.current) return
      question.current = true
      void confirmer(CONFIRMER_ABANDON).then((ok) => { question.current = false; if (ok) { sansQuestion.current = true; history.back() } })
    }
    window.addEventListener('popstate', surRetour)
    return () => window.removeEventListener('popstate', surRetour)
  }, [confirmer])
  const fond = useToucherLeFond<HTMLDialogElement>(fermeture.demander, (c, z) => c === z || estZoneLibre(c))
  return (
    <dialog ref={ref} data-testid="conversation" aria-label="Conversation" {...fond}
      className="fixed inset-x-0 bottom-0 top-auto m-0 h-[calc(100dvh-2.75rem)] max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50 sm:inset-0 sm:m-auto sm:h-[88vh] sm:max-w-2xl">
      <FermetureCtx.Provider value={fermeture}>
        <div className="flex h-full flex-col overflow-hidden rounded-t-2xl bg-fond text-texte sm:rounded-2xl sm:border sm:border-bord">{children}</div>
      </FermetureCtx.Provider>
    </dialog>
  )
}

function EnTete({ titre, sousTitre, menu }: { titre: ReactNode; sousTitre?: ReactNode; menu?: ReactNode }) {
  const { projet } = useCockpit()
  const fermeture = useContext(FermetureCtx)
  return (
    <header className="flex items-start gap-1.5 border-b border-bord bg-carte px-2 pb-2 pt-2">
      <button type="button" onClick={fermeture.demander} aria-label="Fermer la conversation" data-testid="fermer-conversation"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-texte-2 hover:bg-carte-2 hover:text-texte"><ArrowLeft size={20} /></button>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="flex items-center gap-1.5 text-xs text-texte-2"><PointProjet couleur={projet.couleur} /><span className="truncate">{projet.nom}</span></p>
        <h2 className="line-clamp-2 text-[15px] font-medium leading-snug" data-testid="titre-conversation">{titre}</h2>
        {sousTitre}
      </div>
      {menu}
    </header>
  )
}

/** Une bulle du fil : Claude à gauche (fond carte), toi à droite (fond neutre plus soutenu). Jamais de pavé teinté. */
function Bulle({ cote, auteur, quand, children, testId, aFaire = false, sujet, repondre = false }: {
  cote: 'gauche' | 'droite'; auteur?: string; quand?: string | null; children: ReactNode; testId?: string; aFaire?: boolean; sujet?: string | null; repondre?: boolean
}) {
  const { now } = useCockpit()
  return (
    <div className={`flex ${cote === 'droite' ? 'justify-end' : 'justify-start'}`} data-zone-libre="oui" data-testid={testId} data-cote={cote} data-a-faire={aFaire ? 'oui' : undefined}>
      <div className={`max-w-[88%] rounded-2xl border border-bord px-3 py-2 ${cote === 'droite' ? 'rounded-br-md bg-carte-2' : 'rounded-bl-md bg-carte'}`}>
        {auteur || quand ? (
          <p className="mb-0.5 flex items-baseline justify-between gap-3 text-[11px] text-texte-2">
            <span className="truncate">
              <span className={`font-semibold ${cote === 'droite' ? 'text-blue-600 dark:text-blue-400' : 'text-orange-600 dark:text-orange-400'}`}>{auteur}</span>
              {sujet ? <strong className="text-texte"> · {sujet}</strong> : null}
            </span>{quand ? <span className="shrink-0" title={dateLongue(quand)}>{dateRelative(quand, now)}</span> : null}
          </p>
        ) : null}
        {children}
        {repondre ? (
          <button type="button" data-testid="repondre-bulle" onClick={() => window.dispatchEvent(new CustomEvent('cockpit:repondre', { detail: { sujet: sujet ?? null } }))}
            className="mt-1.5 -mb-0.5 inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs font-medium text-accent hover:bg-carte-2">
            <Reply size={14} aria-hidden />Répondre
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Un bloc « à faire » (question, vérification, décision…) : pleine largeur à gauche, repéré pour l'ouverture. */
function AFaire({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="max-w-[96%]" data-a-faire="oui" data-testid={testId}>{children}</div>
}

const auteurDe = (m: Pick<Message, 'auteur_type' | 'auteur'>, admin: boolean) =>
  m.auteur_type === 'session' ? 'Claude' : m.auteur_type === 'proprietaire' ? (admin ? 'Toi' : 'Raphaël') : m.auteur
/** « Sujet : … » en tête d'un message : extrait pour l'afficher en gras sur la ligne de l'expéditeur. */
const sujetDe = (corps: string | null) => {
  const r = corps?.match(/^\s*Sujet\s*:\s*([^\n.]{1,80}?)\s*(?:\.\s*|\n|$)/i)
  return r ? { sujet: r[1], reste: corps!.slice(r[0].length) } : { sujet: null, reste: corps }
}
const coteDe = (m: Pick<Message, 'auteur_type'>) => (m.auteur_type === 'session' ? 'gauche' : 'droite') as 'gauche' | 'droite'

/** Un message du fil, déjà traité (question répondue, info, blocage, fusion tranchée…). */
function BulleMessage({ m }: { m: Message }) {
  const { admin, par, projet, recharger, chantiers, ouvrirChantier } = useCockpit()
  const toast = useToast()
  const medias = mediasDe(m)
  const lie = filLie(m, chantiers)
  // Le crayon sur une image que Raphaël a déjà envoyée : l'image annotée part dans le même fil, comme une nouvelle pièce.
  const annoter = async (f: File) => {
    const r = await deposerMedia(projet.id, m.chantier_id, crypto.randomUUID(), f)
    if ('erreur' in r) return r.erreur
    const err = await ecrireAvecMedias({ projetId: projet.id, chantierId: m.chantier_id, par, admin, corps: `Image annotée : ${f.name}`, medias: [r.media] })
    if (err) return err
    toast.succes('Image annotée envoyée : Claude la verra dans le fil.')
    await recharger()
    return null
  }
  const { sujet, reste } = sujetDe(m.corps)
  const titre = m.kind === 'blocage' ? 'Ce qui bloque' : m.kind === 'question' || m.kind === 'action' ? 'Question' : m.kind === 'fusion' ? 'Fusion proposée' : m.via_session ? 'Dans la session Claude' : null
  return (
    <Bulle cote={coteDe(m)} auteur={`${auteurDe(m, admin)}${titre ? ` · ${titre.toLowerCase()}` : ''}`} quand={m.created_at} testId="bulle" sujet={sujet} repondre={m.auteur_type === 'session'}>
      {reste ? <TexteLong texte={reste} /> : null}
      {m.pourquoi ? <TexteLong texte={m.pourquoi} petit /> : null}
      {m.reponse ? (
        <p className="mt-1 border-t border-bord pt-1 text-sm" data-testid="reponse-donnee">
          <span className="text-texte-2">{m.kind === 'fusion' ? 'Tranché : ' : 'Réponse : '}</span>{m.reponse}{m.precision ? ` — ${m.precision}` : ''}
        </p>
      ) : null}
      {m.kind === 'action' && m.etat && !m.reponse ? <p className="mt-1 text-sm text-texte-2">État : {m.etat === 'pas_encore' ? 'pas encore' : m.etat}</p> : null}
      {medias.length ? <div className="mt-1.5"><MediasMessage medias={medias} onAnnote={m.auteur_type === 'session' ? undefined : annoter} /></div> : null}
      {lie ? (
        <button type="button" onClick={() => ouvrirChantier(lie.id)} data-testid="ouvrir-fil-lie"
          className="mt-1.5 flex min-h-10 w-full items-center gap-2 rounded-xl border border-bord bg-carte-2 px-3 py-2 text-left text-sm hover:border-texte-2">
          <MessageSquare size={16} className="shrink-0 text-texte-2" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{lie.titre}</span>
            <span className="block text-xs text-texte-2">Ouvrir ce fil · {infoEtat(lie.etat).court}</span>
          </span>
        </button>
      ) : null}
    </Bulle>
  )
}

/**
 * Le fil, puis la barre du bas. Comme une discussion : on arrive EN BAS (le
 * dernier échange, puis ce qui attend ton choix). Si ce qui est à faire est
 * plus haut que l'écran, on s'arrête sur son début pour qu'il se lise.
 * `cle` change à chaque nouveau message : si on était en bas, on y reste.
 */
function Corps({ children, actions, nbActions = 0, faites = [], chantierId, placeholder, cle }: { children: ReactNode; actions?: ReactNode; nbActions?: number; faites?: Message[]; chantierId: string | null; placeholder: string; cle: string }) {
  const corps = useRef<HTMLDivElement>(null)
  const enBas = useRef(true)
  const allerEnBas = (doux = false) => {
    const el = corps.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: doux ? 'smooth' : 'auto' })
  }
  useEffect(() => {
    // Après l'ouverture de la feuille (showModal passe après ce rendu) : une image plus tard.
    const r = requestAnimationFrame(() => allerEnBas())
    return () => cancelAnimationFrame(r)
  }, [])
  const premier = useRef(true)
  useEffect(() => {
    if (premier.current) { premier.current = false; return }
    if (enBas.current) { const r = requestAnimationFrame(() => allerEnBas(true)); return () => cancelAnimationFrame(r) }
  }, [cle])
  const surDefilement = () => { const el = corps.current; if (el) enBas.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160 }
  return (
    <>
      <div ref={corps} onScroll={surDefilement} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-3 py-3" data-zone-libre="oui" data-testid="fil-conversation">{children}</div>
      <ZoneActions nb={nbActions} faites={faites}>{actions}</ZoneActions>
      <Saisie chantierId={chantierId} placeholder={placeholder} onEnvoye={() => { enBas.current = true; window.setTimeout(() => allerEnBas(true), 150) }} />
    </>
  )
}

/**
 * Le champ d'action (Raphaël, 5 oct. 2026 : « les PR dans le même chat que le chat normal, ça pollue […] un petit
 * champ d'action en dessous, le chat avec Claude au-dessus, il y a que les actions que c'est moi qui dois faire »).
 * Tout ce qui attend un geste de sa part (fusionner une PR, répondre à une carte, certifier, décider) vit ICI,
 * entre le chat et la barre d'écriture : le chat ne contient que la discussion, et reste visible quand on agit.
 * Repliable ; les actions déjà faites sont rangées dans un repli, pas dans le chat.
 */
function ZoneActions({ nb, faites, children }: { nb: number; faites: Message[]; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(true)
  if (!nb && !faites.length) return null
  return (
    <section className="shrink-0 border-t border-bord bg-carte-2" data-testid="zone-actions" data-nb={nb} aria-label="Ce que tu dois faire">
      <button type="button" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} data-testid="zone-actions-titre"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs text-white ${nb ? 'bg-attention' : 'bg-ok'}`}>{nb}</span>
        <span className="flex-1">{nb ? (nb > 1 ? 'À faire de ton côté' : 'À faire de ton côté') : 'Rien à faire de ton côté'}</span>
        <ChevronDown size={16} className={`text-texte-2 transition-transform ${ouvert ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {ouvert ? (
        <div className="max-h-[42dvh] space-y-2.5 overflow-y-auto overscroll-contain px-3 pb-3" data-testid="zone-actions-contenu">
          {children}
          {faites.length ? (
            <Repliable titre={<span className="text-sm text-texte-2">Actions déjà faites ({faites.length})</span>}>
              <div className="space-y-2">{faites.map((m) => <BulleMessage key={m.id} m={m} />)}</div>
            </Repliable>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** Après ton message, tant que Claude n'a pas répondu dans le fil : qui va répondre, et quand. */
function BulleAttente({ attente }: { attente: AttenteReponse }) {
  const { now } = useCockpit()
  const recu = attente.etat === 'prise' || attente.etat === 'recue'
  return (
    <div className="flex justify-start" data-zone-libre="oui" data-testid="attente-reponse" data-etat={attente.etat}>
      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-dashed border-bord bg-carte px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {recu ? <CheckCheck size={16} className="shrink-0 text-ok" aria-hidden /> : <Clock size={16} className="shrink-0 text-texte-2" aria-hidden />}
          {attente.titre}
          {attente.etat === 'prise' || attente.etat === 'recue' || attente.etat === 'session'
            ? <span className="flex gap-0.5 pl-0.5" aria-hidden><span className="point-vivant h-1.5 w-1.5 rounded-full bg-texte-2" /><span className="point-vivant h-1.5 w-1.5 rounded-full bg-texte-2 [animation-delay:150ms]" /><span className="point-vivant h-1.5 w-1.5 rounded-full bg-texte-2 [animation-delay:300ms]" /></span>
            : null}
        </p>
        <p className="mt-0.5 text-sm text-texte-2" data-testid="attente-detail">{attente.detail}</p>
        <p className="mt-0.5 text-[11px] text-texte-2">{attente.nombre > 1 ? `${attente.nombre} messages sans réponse, ` : ''}envoyé {dateRelative(attente.depuis, now)}</p>
      </div>
    </div>
  )
}

/**
 * La barre du bas : trombone, « Écrire à Claude… », envoyer. Écrit un message
 * `info` dans le fil (propriétaire si admin), photos et fichiers compris
 * (0013) — la seule façon d'écrire à Claude dans l'app.
 */
function Saisie({ chantierId, placeholder, onEnvoye }: { chantierId: string | null; placeholder: string; onEnvoye: () => void }) {
  const { par, admin, projet, recharger } = useCockpit()
  const toast = useToast()
  const [texte, setTexte] = useState('')
  const [enCours, setEnCours] = useState(false)
  const pj = useMediasAJoindre(projet.id, chantierId)
  const zone = useRef<HTMLTextAreaElement>(null)
  const vide = !texte.trim() && !pj.medias.length
  // « Répondre » sous un message de Claude : le curseur va dans la zone, avec le sujet rappelé si elle est vide.
  useEffect(() => {
    const ecoute = (e: Event) => {
      const sujet = (e as CustomEvent<{ sujet: string | null }>).detail?.sujet
      if (sujet) setTexte((t) => (t.trim() ? t : `Re : ${sujet}\n`))
      window.setTimeout(() => { const z = zone.current; if (z) { z.focus(); z.setSelectionRange(z.value.length, z.value.length) } }, 0)
    }
    window.addEventListener('cockpit:repondre', ecoute)
    return () => window.removeEventListener('cockpit:repondre', ecoute)
  }, [])
  // La zone grandit avec le texte (jusqu'à ~5 lignes), puis défile.
  useLayoutEffect(() => { const z = zone.current; if (!z) return; z.style.height = 'auto'; z.style.height = `${Math.min(z.scrollHeight, 132)}px` }, [texte])

  const envoyer = async () => {
    if (vide) return
    if (pj.enCours) { toast.info('Un fichier est encore en cours d’envoi : un instant.'); return }
    setEnCours(true)
    const erreur = await ecrireAvecMedias({ projetId: projet.id, chantierId, par, admin, corps: texte.trim() || resumeMedias(pj.medias), medias: pj.medias })
    setEnCours(false)
    if (erreur) { toast.erreur(`Le message n’est pas parti : ${erreur}`); return }
    toast.succes('Message envoyé : Claude te répondra ici, dans ce fil.')
    setTexte('')
    pj.vider()
    await recharger()
    onEnvoye()
  }

  return (
    <div data-testid="ecrire-a-claude" className="border-t border-bord bg-carte px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)]">
      {pj.pieces.length ? <div className="px-1 pb-2"><VignettesPieces ctrl={pj} /></div> : null}
      <div className="flex items-end gap-1">
        <BoutonJoindre ctrl={pj} icone />
        <textarea ref={zone} rows={1} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={placeholder} aria-label="Écrire à Claude"
          className="min-h-10 flex-1 resize-none rounded-2xl border border-bord bg-fond px-3 py-2 text-[15px] leading-snug text-texte placeholder:text-texte-2/70 focus:outline-none focus:ring-2 focus:ring-accent/40" />
        <button type="button" onClick={envoyer} disabled={vide || enCours || pj.enCours} aria-label="Envoyer" data-testid="envoyer-message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition disabled:opacity-35">
          {enCours || pj.enCours ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <SendHorizontal size={18} />}
        </button>
      </div>
      {texte.trim() ? <p className="px-2 pt-1 text-[11px] text-texte-2">Claude te répondra ici, dans ce fil.</p> : null}
    </div>
  )
}

/** Le menu ⋯ d'un chantier (admin) : les gestes rares, avec confirmation avant toute suppression. */
function MenuChantier({ chantier, nMessages, onHistorique }: { chantier: Chantier; nMessages: number; onHistorique: () => void }) {
  const { recharger, ouvrirModifier, ouvrirDoublonDe } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const fermeture = useContext(FermetureCtx)
  const [ouvert, setOuvert] = useState(false)
  const [reporter, setReporter] = useState(false)
  const [deplacer, setDeplacer] = useState(false)
  const global = useGlobal()
  const ref = useRef<HTMLDivElement>(null)
  useMenuQuiSeFerme(ouvert, ref, () => setOuvert(false))
  // Mettre de côté / reporter / abandonner (0028) : une fonction de la base, une ligne dans le fil.
  const deCote = async (jusqua: Date | null) => {
    const { error } = await supabase.rpc('mettre_de_cote', { p_id: chantier.id, p_jusqu_a: jusqua ? jusqua.toISOString() : null, p_raison: null })
    if (error) { toast.erreur(messageErreur(error)); return false }
    toast.succes(jusqua ? `Reporté au ${jusqua.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} : il reviendra tout seul dans « Prêt à lancer ».` : 'Mis de côté. « Relancer maintenant » le rouvre.')
    await recharger(); return true
  }
  const abandonner = async () => {
    const ok = await confirmer({ titre: 'Abandonner ce chantier ?', libelleOk: 'Abandonner',
      texte: <p>« <b>{chantier.titre}</b> » est archivé, avec une ligne « Abandonné » dans son fil. Rien n’est supprimé : « Désarchiver » le rend.</p> })
    if (!ok) return
    const { error } = await supabase.rpc('abandonner_chantier', { p_id: chantier.id, p_raison: null })
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${chantier.titre} » abandonné (archivé).`); await recharger()
  }
  const maj = async (valeurs: Partial<Chantier>, succes: string) => {
    const { error } = await supabase.from('chantiers').update(valeurs).eq('id', chantier.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(succes); await recharger()
  }
  const liberer = async () => {
    const { data, error } = await supabase.rpc('liberer_chantier', { p_id: chantier.id, p_par: chantier.pris_par })
    if (error || !data) { toast.erreur(error ? messageErreur(error) : 'La réservation n’a pas pu être libérée.'); return }
    toast.succes('Réservation libérée : le chantier redevient libre.'); await recharger()
  }
  const supprimer = async () => {
    const ok = await confirmer({ titre: 'Supprimer ce chantier ?', danger: true, libelleOk: 'Supprimer',
      texte: <><p>« <b>{chantier.titre}</b> » et ses {nMessages} message{nMessages > 1 ? 's' : ''} seront supprimés.</p><p className="mt-1 text-xs">Une trace reste en base (table supprimés), mais il ne sera plus dans le cockpit. Préfère « Archiver » si tu veux le retrouver.</p></> })
    if (!ok) return
    const { error } = await supabase.from('chantiers').delete().eq('id', chantier.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${chantier.titre} » supprimé.`); fermeture.forcer(); await recharger()
  }
  const deplacerVers = async (slug: string) => {
    const cible = global.projets.find((p) => p.slug === slug)
    const depart = global.projets.find((p) => p.id === chantier.projet_id)
    if (!cible) { toast.erreur('Choisis le projet où le déplacer.'); return false }
    const section = global.sections.find((s) => s.id === chantier.section_id)?.nom ?? null
    const ok = await confirmer({ titre: 'Déplacer ce chantier ?', libelleOk: 'Déplacer',
      texte: <p>{texteConfirmationDeplacement(chantier.titre, depart?.nom ?? '?', cible.nom, nMessages, section)}</p> })
    if (!ok) return false
    const { error } = await supabase.rpc('deplacer_chantier', { p_id: chantier.id, p_slug: slug })
    if (error) { toast.erreur(messageErreur(error)); return false }
    toast.succes(`« ${chantier.titre} » déplacé dans « ${cible.nom} ».`); fermeture.forcer(); await recharger(); return true
  }
  const item = (icone: ReactNode, libelle: string, action: () => void, testId?: string, danger = false) => (
    <button type="button" role="menuitem" data-testid={testId} onClick={() => { setOuvert(false); action() }}
      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[15px] hover:bg-carte-2 ${danger ? 'text-alerte' : ''}`}>{icone}{libelle}</button>
  )
  const ic = 'shrink-0 text-texte-2'
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOuvert(!ouvert)} aria-label="Plus d’actions" aria-haspopup="menu" aria-expanded={ouvert} data-testid="menu-chantier"
        className="flex h-10 w-10 items-center justify-center rounded-full text-texte-2 hover:bg-carte-2 hover:text-texte"><Ellipsis size={20} /></button>
      {ouvert ? (
        <div role="menu" className="absolute right-0 top-11 z-10 w-60 overflow-hidden rounded-xl border border-bord bg-carte py-1 shadow-xl" data-testid="actions-admin">
          {item(<Pencil size={17} className={ic} />, 'Modifier', () => ouvrirModifier(chantier), 'modifier')}
          {item(<History size={17} className={ic} />, 'Historique', onHistorique, 'ouvrir-historique')}
          {!chantier.doublon_de ? item(<Copy size={17} className={ic} />, 'Fusionner avec…', () => ouvrirDoublonDe(chantier), 'doublon-de') : null}
          {chantier.pris_par ? item(<LockOpen size={17} className={ic} />, 'Libérer la réservation', liberer, 'liberer') : null}
          {chantier.etat !== 'reporte' || chantier.reporte_jusqu_a ? item(<CirclePause size={17} className={ic} />, 'Mettre de côté', () => void deCote(null), 'mettre-de-cote') : null}
          {item(<CalendarClock size={17} className={ic} />, chantier.reporte_jusqu_a ? 'Changer la date de report…' : 'Reporter…', () => setReporter(true), 'reporter')}
          {item(<FolderInput size={17} className={ic} />, 'Déplacer vers un autre projet…', () => setDeplacer(true), 'deplacer')}
          {!chantier.archived_at ? item(<Ban size={17} className={ic} />, 'Abandonner', () => void abandonner(), 'abandonner') : null}
          {chantier.archived_at
            ? item(<ArchiveRestore size={17} className={ic} />, 'Désarchiver', () => maj({ archived_at: null }, 'Chantier désarchivé.'), 'archiver')
            : item(<Archive size={17} className={ic} />, 'Archiver', () => maj({ archived_at: new Date().toISOString() }, 'Chantier archivé.'), 'archiver')}
          {item(<Trash2 size={17} className="shrink-0" />, 'Supprimer', supprimer, 'supprimer', true)}
        </div>
      ) : null}
      <DialogueDeplacer ouvert={deplacer} projetId={chantier.projet_id} onFermer={() => setDeplacer(false)} onChoisir={async (slug) => { if (await deplacerVers(slug)) setDeplacer(false) }} />
      <DialogueReporter ouvert={reporter} onFermer={() => setReporter(false)} onChoisir={async (d) => { if (await deCote(d)) setReporter(false) }} />
    </div>
  )
}

/** « Reporter… » : quatre choix d'un toucher, ou une date. Il revient tout seul ce jour-là. */
function DialogueDeplacer({ ouvert, projetId, onFermer, onChoisir }: { ouvert: boolean; projetId: string; onFermer: () => void; onChoisir: (slug: string) => Promise<void> }) {
  const { projets } = useGlobal()
  const cibles = useMemo(() => projetsCibles(projets, projetId), [projets, projetId])
  const [slug, setSlug] = useState('')
  const [envoi, setEnvoi] = useState(false)
  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre="Déplacer vers quel projet ?">
      <div className="space-y-3" data-testid="dialogue-deplacer">
        {cibles.length === 0 ? <p className="text-sm text-texte-2" data-testid="deplacer-vide">Il n’y a aucun autre projet où le déplacer.</p> : (
          <>
            <p className="text-sm text-texte-2">Le chantier, son fil, ses questions et ses pièces jointes changent de projet. Rien n’est supprimé.</p>
            <Select value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Projet d’arrivée" data-testid="deplacer-projet">
              <option value="">Choisir un projet…</option>
              {cibles.map((p) => <option key={p.id} value={p.slug}>{p.nom}</option>)}
            </Select>
            <Button variante="primaire" pleine disabled={!slug || envoi} chargement={envoi} data-testid="deplacer-valider"
              onClick={async () => { setEnvoi(true); await onChoisir(slug); setEnvoi(false) }}>Déplacer</Button>
          </>
        )}
      </div>
    </Dialog>
  )
}

function DialogueReporter({ ouvert, onFermer, onChoisir }: { ouvert: boolean; onFermer: () => void; onChoisir: (d: Date) => Promise<void> }) {
  const [saisie, setSaisie] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const now = new Date()
  const dSaisie = saisie ? dateSaisie(saisie, now) : null
  const choisir = async (d: Date) => { setEnvoi(true); await onChoisir(d); setEnvoi(false) }
  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre="Reporter à quand ?">
      <div className="space-y-2" data-testid="dialogue-reporter">
        <p className="text-sm text-texte-2">Ce jour-là, il revient tout seul dans « Prêt à lancer ». D’ici là, personne ne le prend.</p>
        <div className="grid grid-cols-2 gap-2">
          {CHOIX_REPORT.map((c) => (
            <Button key={c.cle} disabled={envoi} onClick={() => void choisir(dateDeReport(c.jours, now))} data-testid={`reporter-${c.cle}`}>{c.libelle}</Button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="text-texte-2">Ou une date :</span>
          <input type="date" value={saisie} onChange={(e) => setSaisie(e.target.value)} data-testid="reporter-date"
            className="mt-1 h-10 w-full rounded-lg border border-bord bg-carte px-2 text-[15px]" />
        </label>
        {saisie && !dSaisie ? <p className="text-xs text-alerte">Une date à venir, dans l’année.</p> : null}
        <Button variante="primaire" pleine disabled={!dSaisie || envoi} chargement={envoi} onClick={() => dSaisie && void choisir(dSaisie)} data-testid="reporter-valider">Reporter à cette date</Button>
      </div>
    </Dialog>
  )
}

function FilChantier({ chantierId }: { chantierId: string }) {
  const { admin, messages, chantiers, activites, taches, enAttente, now, silenceMs, sections, recharger, prefs, poser } = useCockpit()
  const { projets } = useGlobal()
  const toast = useToast()
  const [signalHistorique, setSignalHistorique] = useState(0)
  // « Ça marche » avec une question ouverte : ses cartes s'affichent dans le bloc de validation, pas deux fois.
  const [questionsDansValidation, setQuestionsDansValidation] = useState(false)
  const c = chantiers.find((x) => x.id === chantierId) ?? null
  const fil = useMemo(() => messages.filter((m) => m.chantier_id === chantierId).sort((a, b) => a.created_at.localeCompare(b.created_at)), [messages, chantierId])
  const pd = useMemo(() => (c ? presenceDe(c, activites, enAttente, now, silenceMs, taches) : null), [c, activites, taches, enAttente, now, silenceMs])
  const cle = `${fil.length}:${fil.at(-1)?.id ?? ''}:${fil.at(-1)?.answered_at ?? ''}:${fil.at(-1)?.recu_at ?? ''}`
  useMarquerLu(chantierId, fil, prefs, poser)
  const prochainPassage = useProchainPassage(c?.projet_id ?? '', cle)

  if (!c || !pd) {
    return (
      <>
        <EnTete titre="Chantier introuvable" />
        <div className="flex-1 p-4 text-sm text-texte-2">Ce chantier n’existe plus (supprimé ou fusionné dans un autre).</div>
      </>
    )
  }
  const { presence, activite } = pd
  // « Où ça en est ? » en attente : le bloc suit la DEMANDE, pas la barre grise d'une livraison passée.
  const tenus = (id: string) => chantierTenu(id, activites, taches, now, silenceMs)
  const demandeEnCours = !!etatOuEnEst(c, messages, tenus(c.id), now, tenus)?.enAttente
  const silence = presence.code === 'silencieux' && c.etat !== 'a_cadrer' ? situationSilence(c, activite, { now, prochainPassage, demandeEnCours, abandonMin: projets.find((p) => p.id === c.projet_id)?.delai_sans_signe_min }) : null
  const projetDuFil = projets.find((p) => p.id === c.projet_id)
  // Personne dessus (ni réservation) : ce qui va se passer, quand, et si Raphaël a un geste (src/lib/enAttente.ts).
  const phraseSansPersonne = presence.code === 'personne' && c.etat !== 'a_cadrer'
    ? phraseAttente(c, activite, { now, abandonMin: projetDuFil?.delai_sans_signe_min ?? DELAI_ABANDON_MIN, prochainPassage, autonome: projetAutonome(projetDuFil, now) })
    : null
  const { historique: histo, aChoisir } = ordreDuFil(fil)
  const { chat: historique, faites } = separerChat(histo)
  const cartes = aChoisir.filter((m) => m.kind === 'fusion' || !(questionsDansValidation && c.etat === 'a_verifier'))
  const nbActions = cartes.length + (c.etat === 'a_verifier' || c.etat === 'a_cadrer' || c.etat === 'bloque' ? 1 : 0)
  const sessionTient = presence.code === 'travaille' || (!!c.pris_par && !!c.pris_jusqu_a && Date.parse(c.pris_jusqu_a) > now.getTime())
  const attente = attenteReponse(fil, { maintenant: now.getTime(), sessionTient, prochainPassage })
  const section = c.section_id ? sections.find((s) => s.id === c.section_id) : null
  const derniere = derniereAction(c.id, messages, activites, taches)
  const dernierBlocage = [...fil].reverse().find((m) => m.kind === 'blocage') ?? null
  const relancer = async () => {
    const { error } = await supabase.from('chantiers').update({ etat: 'libre', reporte_jusqu_a: null, archived_at: null }).eq('id', c.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${c.titre} » relancé : il passe dans « Prêt à lancer ».`); await recharger()
  }
  const teinte = presence.code === 'travaille' ? 'text-ok' : presence.teinte === 'alerte' ? 'text-alerte' : presence.teinte === 'attention' ? 'text-attention' : presence.teinte === 'info' ? 'text-info' : 'text-texte-2'

  return (
    <>
      <EnTete titre={c.titre}
        sousTitre={
          <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${teinte}`} data-testid="presence-conversation" data-presence={presence.code}>
            {presence.code === 'travaille' ? <span className="point-vivant inline-block h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden /> : <IconePresence code={presence.code} taille={14} />}
            <span className="truncate">{presenceEnMots(presence, activite)}</span>
          </p>
        }
        menu={admin ? <MenuChantier chantier={c} nMessages={fil.length} onHistorique={() => setSignalHistorique((n) => n + 1)} /> : null} />
      <Corps chantierId={c.id} placeholder={PLACEHOLDER[presence.code] ?? 'Écrire à Claude…'} cle={cle} nbActions={nbActions} faites={faites}
        actions={<>
          {c.etat === 'a_verifier' ? <AFaire><BlocValidation chantier={c} onQuestionsAffichees={setQuestionsDansValidation} /></AFaire> : null}
          {c.etat === 'a_cadrer' ? <AFaire><BlocCadrer chantier={c} /></AFaire> : null}
          {c.etat === 'bloque' ? <AFaire><BlocBloque chantier={c} blocage={dernierBlocage} /></AFaire> : null}
          {cartes.map((m) => m.kind === 'fusion'
            ? <AFaire key={m.id}><BlocFusion message={m} /></AFaire>
            : <AFaire key={m.id}><BlocQuestion message={m} /></AFaire>)}
        </>}>
        {/* 0. En tête du fil, en petit : l'état, les notes, l'historique (comme les infos d'une discussion). */}
        <div className="space-y-1.5" data-testid="infos-chantier">
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 text-[11px] text-texte-2" data-testid="etat-technique">
            <span>État : {infoEtat(c.etat).libelle}</span>
            <span>{section ? `Section : ${section.nom}` : 'Sans section'}</span>
            {c.priorite !== 'normale' ? <span>Priorité {c.priorite}</span> : null}
            {c.origine === 'session' ? <span data-testid="origine-session">lancé par Claude</span> : c.origine === 'utilisateur' ? <span>demande d’un utilisateur</span> : null}
            {c.livre_at ? <span>Livré {dateRelative(c.livre_at, now)}</span> : null}
            {c.pris_par ? <span title={c.pris_par}>Réservé par {nomCourtSession(c.pris_par)}</span> : null}
            {c.archived_at ? <span>archivé</span> : null}
          </p>
          {derniere ? (
            <p className="px-1 text-xs text-texte-2" data-testid="derniere-action"><span className="font-medium text-texte">Dernière action :</span> {derniere.texte} · {dateRelative(derniere.quand, now)}</p>
          ) : <p className="px-1 text-xs text-texte-2" data-testid="derniere-action">Dernière action : aucune trace de Claude sur ce chantier.</p>}
          {c.notes ? <Repliable titre={<span className="text-sm font-medium">Notes de travail de Claude</span>}><p className="whitespace-pre-wrap text-sm text-texte-2">{c.notes}</p></Repliable> : null}
          <PourReproduire chantier={c} />
          {admin ? <Historique chantierId={c.id} signal={signalHistorique} /> : null}
        </div>

        {/* 1. La demande, puis la discussion, dans l'ordre : le plus récent en bas. */}
        <Bulle cote={c.origine === 'session' ? 'gauche' : 'droite'} auteur={c.origine === 'session' ? 'Claude · la demande' : c.origine === 'utilisateur' ? 'Demande d’un utilisateur' : 'La demande'} quand={c.created_at} testId="bulle-demande">
          {c.demande ? <TexteLong texte={c.demande} /> : <p className="text-sm text-texte-2">Pas de description : le titre dit tout.</p>}
          {c.resume_simple ? <p className="mt-1 text-sm text-texte-2">En clair : {c.resume_simple}</p> : null}
        </Bulle>
        {historique.map((m) => <BulleMessage key={m.id} m={m} />)}

        {/* 2. Où en est le chantier. */}
        {presence.code === 'travaille' ? (
          <Bulle cote="gauche" auteur="En ce moment" testId="bulle-travail">
            <p className="flex items-center gap-1.5 text-sm"><PointTravaille />{presence.detail ?? ''}</p>
            {activite ? <Progression activite={activite} vive={presence.barreVive} compact now={now} /> : null}
            <div className="mt-1.5"><TachesDuChantier chantierId={c.id} /></div>
          </Bulle>
        ) : null}
        {c.etat === 'reporte' ? (
          <Bulle cote="gauche" auteur={c.archived_at ? 'Abandonné' : c.reporte_jusqu_a ? 'Reporté' : 'Mis de côté'} testId="bulle-reporte">
            <p className="text-sm" data-testid="texte-reporte">{texteReporte(c, now) ?? presence.tonAction}</p>
            {admin ? <Button taille="sm" className="mt-2" onClick={relancer} data-testid="relancer-maintenant"><Play size={15} aria-hidden />Relancer maintenant</Button> : null}
          </Bulle>
        ) : null}
        {c.etat === 'valide' ? (
          <Bulle cote="gauche" auteur="Fini" testId="bulle-certifie">
            <p className="flex items-center gap-1.5 text-sm"><CircleCheck size={16} className="text-ok" aria-hidden />Certifié{c.valide_par ? ` par ${c.valide_par}` : ''}{c.valide_at ? ` ${dateRelative(c.valide_at, now)}` : ''}</p>
            <div className="mt-1.5 space-y-2"><CommentVerifierReplie chantier={c} /><SignalerProbleme chantier={c} /></div>
          </Bulle>
        ) : null}
        {c.etat !== 'a_verifier' ? <FriseMiseEnLigne chantier={c} /> : null}
        {(presence.code === 'personne' || presence.code === 'silencieux') && c.etat !== 'a_cadrer' ? (
          <AFaire testId="bulle-relance">
            <div className="space-y-2 rounded-2xl border border-bord bg-carte p-3">
              {demandeEnCours ? (
                <p className="flex items-center gap-1.5 text-[15px] font-medium text-info" data-testid="titre-ou-en-est"><span className="point-vivant inline-block h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />Tu as demandé où ça en est</p>
              ) : (<>
                <p className="flex items-center gap-1.5 text-[15px] font-medium"><IconePresence code={presence.code} />{presence.code === 'silencieux' ? 'Plus de nouvelles de Claude' : 'Personne n’y travaille'}</p>
                {silence ? null : presence.detail ? <p className="text-sm text-texte-2" data-testid="detail-presence">{presence.detail}</p> : null}
                {activite && activite.pourcentage > 0 ? <Progression activite={activite} vive={false} compact legende={false} now={now} /> : null}
                {silence ? null : phraseSansPersonne ? (
                  <div className="space-y-1 text-sm" data-testid="situation-personne" data-geste={phraseSansPersonne.aFaire ? 'relancer' : 'rien'}>
                    <p className="text-texte-2" data-testid="personne-quoi">{phraseSansPersonne.quoi}</p>
                    <p className={`font-medium ${phraseSansPersonne.aFaire ? 'text-attention' : 'text-ok'}`} data-testid="personne-geste">{phraseSansPersonne.suite}{phraseSansPersonne.aFaire ? '' : ' Rien à faire de ton côté.'}</p>
                  </div>
                ) : null}
              </>)}
              {silence ? (
                <div data-testid="situation-silence" data-geste={silence.geste} className="space-y-1 text-sm">
                  {demandeEnCours ? null : <p className="text-texte-2" data-testid="silence-quoi">{silence.ceQuiSePasse}</p>}
                  <p className={`font-medium ${silence.geste === 'relancer' ? 'text-attention' : 'text-ok'}`} data-testid="silence-geste">{silence.consigne}</p>
                </div>
              ) : null}
              {silence && silence.geste !== 'relancer' ? (
                <Repliable titre={<span className="text-sm text-texte-2">Je ne veux pas attendre : relancer maintenant</span>}>
                  <p className="mb-1.5 text-xs text-texte-2">Utile seulement si tu es pressé. « Copier la consigne » te donne un texte à coller dans Claude Code sur ce projet ; « Demander où ça en est » fait répondre Claude ici.</p>
                  <BoutonsRelance chantier={c} />
                </Repliable>
              ) : <BoutonsRelance chantier={c} />}
            </div>
          </AFaire>
        ) : null}

        {/* 0041 : une réservation sans signe de vie a été libérée : qui, depuis quand, repris seul. */}
        {!c.archived_at && phraseLiberee(c, { now, prochainPassage }) ? (
          <p className="rounded-2xl border border-bord bg-carte p-3 text-sm text-texte-2" data-testid="chantier-libere">{phraseLiberee(c, { now, prochainPassage })}</p>
        ) : null}

        {/* 3. Ton dernier message attend sa réponse : qui va répondre, et quand. */}
        {attente ? <BulleAttente attente={attente} /> : null}

        {/* 4. Ce qui attend un geste de ta part n'est PAS dans le chat : il est dans le champ d'action, en dessous (ZoneActions). */}
      </Corps>
    </>
  )
}

/** Les questions du projet qui ne portent sur aucun chantier. */
function FilProjet() {
  const { messages, projet, now, prefs, poser } = useCockpit()
  const fil = useMemo(() => messages.filter((m) => !m.chantier_id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [messages])
  const cle = `${fil.length}:${fil.at(-1)?.id ?? ''}:${fil.at(-1)?.answered_at ?? ''}:${fil.at(-1)?.recu_at ?? ''}`
  useMarquerLu(cleFil(projet.id, null), fil, prefs, poser)
  const prochainPassage = useProchainPassage(projet.id, cle)
  const { historique: histo, aChoisir } = ordreDuFil(fil)
  const { chat: historique, faites } = separerChat(histo)
  const attente = attenteReponse(fil, { maintenant: now.getTime(), sessionTient: false, prochainPassage })
  return (
    <>
      <EnTete titre="Discussion du projet" sousTitre={<p className="text-xs text-texte-2">Écris ce que tu veux, même plusieurs sujets : Claude ouvre un fil par sujet et te répond dans chacun</p>} />
      <Corps chantierId={null} placeholder="Écrire à Claude…" cle={cle} nbActions={aChoisir.length} faites={faites}
        actions={aChoisir.map((m) => m.kind === 'fusion'
          ? <AFaire key={m.id}><BlocFusion message={m} /></AFaire>
          : <AFaire key={m.id}><BlocQuestion message={m} /></AFaire>)}>
        {fil.length ? null : <p className="text-sm text-texte-2" data-testid="fil-projet-vide">Rien pour l’instant. Écris en bas : une idée, un problème, plusieurs sujets à la fois.</p>}
        {historique.map((m) => <BulleMessage key={m.id} m={m} />)}
        {attente ? <BulleAttente attente={attente} /> : null}
      </Corps>
    </>
  )
}
