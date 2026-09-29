import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, CircleCheck, Copy, Ellipsis, History, LockOpen, Pencil, Play, SendHorizontal, Trash2 } from 'lucide-react'
import type { Chantier, Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Button } from '../ui/Button.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { infoEtat } from '../lib/etats.ts'
import { presenceDe, presenceEnMots } from '../lib/entonnoir.ts'
import { dateLongue, dateRelative } from '../lib/dates.ts'
import { nomCourtSession } from '../lib/texte.ts'
import { mediasDe, resumeMedias } from '../lib/medias.ts'
import { BlocQuestion } from './BlocQuestion.tsx'
import { BlocValidation, SignalerProbleme } from './BlocValidation.tsx'
import { BlocBloque, BlocCadrer, BlocFusion } from './BlocsAToi.tsx'
import { CommentVerifierReplie } from './CommentVerifier.tsx'
import { FriseMiseEnLigne } from './MiseEnLigne.tsx'
import { Historique } from './Historique.tsx'
import { BoutonsRelance } from './Relance.tsx'
import { Progression } from './Progression.tsx'
import { TachesDuChantier } from './QuiTravaille.tsx'
import { PointTravaille } from './Vivant.tsx'
import { IconePresence, PointProjet } from './Icones.tsx'
import { BoutonJoindre, MediasMessage, VignettesPieces, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'

/**
 * Chaque chantier s'ouvre en CONVERSATION (modèle D, choisi par Raphaël le 29
 * sept. 2026 : « vas-y fais A + D ») : une feuille plein écran sur téléphone,
 * un grand dialogue sur ordinateur. En haut le sujet et qui est dessus, au
 * milieu le fil en bulles (Claude à gauche, toi à droite), la demande en
 * premier et ce qu'il faut faire en dernier, en bas « Écrire à Claude… ».
 * On y arrive positionné sur ce qu'il y a à faire.
 *
 * `chantierId` null : les questions du PROJET (sans chantier).
 */
export interface CibleConversation { projetId: string; chantierId: string | null }

/** Le texte d'invitation de la barre du bas, selon ce qu'on attend de toi. */
const PLACEHOLDER: Record<string, string> = {
  a_cadrer: 'Ta décision : ce que tu veux, ce que tu ne veux pas…',
  bloque: 'Ta réponse : ce que tu as fait, ou ce qu’il faut faire…',
  a_verifier: 'Ce que tu as constaté, une correction…',
}

export function Conversation({ cible, onFermer }: { cible: CibleConversation; onFermer: () => void }) {
  return (
    <Feuille onFermer={onFermer}>
      {cible.chantierId ? <FilChantier chantierId={cible.chantierId} onFermer={onFermer} /> : <FilProjet onFermer={onFermer} />}
    </Feuille>
  )
}

/**
 * La feuille : un <dialog> modal (focus piégé, Échap), plein écran sur
 * téléphone. Le geste « retour » du téléphone la ferme : c'est Cockpit.tsx
 * qui pose l'entrée d'historique à l'ouverture et l'écoute.
 */
function Feuille({ onFermer, children }: { onFermer: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const fermer = useRef(onFermer)
  fermer.current = onFermer
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    const onCancel = (e: Event) => { e.preventDefault(); fermer.current() }
    d?.addEventListener('cancel', onCancel)
    return () => { d?.removeEventListener('cancel', onCancel); if (d?.open) d.close() }
  }, [])
  return (
    <dialog ref={ref} data-testid="conversation" aria-label="Conversation"
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/50 sm:m-auto sm:h-[88vh] sm:max-w-2xl">
      <div className="flex h-full flex-col overflow-hidden bg-fond text-texte sm:rounded-2xl sm:border sm:border-bord">{children}</div>
    </dialog>
  )
}

function EnTete({ titre, sousTitre, onFermer, menu }: { titre: ReactNode; sousTitre?: ReactNode; onFermer: () => void; menu?: ReactNode }) {
  const { projet } = useCockpit()
  return (
    <header className="flex items-start gap-1.5 border-b border-bord bg-carte px-2 pb-2 pt-[max(env(safe-area-inset-top),8px)]">
      <button type="button" onClick={onFermer} aria-label="Fermer la conversation" data-testid="fermer-conversation"
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
function Bulle({ cote, auteur, quand, children, testId, aFaire = false }: {
  cote: 'gauche' | 'droite'; auteur?: string; quand?: string | null; children: ReactNode; testId?: string; aFaire?: boolean
}) {
  const { now } = useCockpit()
  return (
    <div className={`flex ${cote === 'droite' ? 'justify-end' : 'justify-start'}`} data-testid={testId} data-cote={cote} data-a-faire={aFaire ? 'oui' : undefined}>
      <div className={`max-w-[88%] rounded-2xl border border-bord px-3 py-2 ${cote === 'droite' ? 'rounded-br-md bg-carte-2' : 'rounded-bl-md bg-carte'}`}>
        {auteur || quand ? (
          <p className="mb-0.5 flex items-baseline justify-between gap-3 text-[11px] text-texte-2">
            <span className="truncate">{auteur}</span>{quand ? <span className="shrink-0" title={dateLongue(quand)}>{dateRelative(quand, now)}</span> : null}
          </p>
        ) : null}
        {children}
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
const coteDe = (m: Pick<Message, 'auteur_type'>) => (m.auteur_type === 'session' ? 'gauche' : 'droite') as 'gauche' | 'droite'

/** Un message du fil, déjà traité (question répondue, info, blocage, fusion tranchée…). */
function BulleMessage({ m }: { m: Message }) {
  const { admin } = useCockpit()
  const medias = mediasDe(m)
  const titre = m.kind === 'blocage' ? 'Ce qui bloque' : m.kind === 'question' || m.kind === 'action' ? 'Question' : m.kind === 'fusion' ? 'Fusion proposée' : null
  return (
    <Bulle cote={coteDe(m)} auteur={`${auteurDe(m, admin)}${titre ? ` · ${titre.toLowerCase()}` : ''}`} quand={m.created_at} testId="bulle">
      {m.corps ? <p className="whitespace-pre-wrap text-[15px] leading-snug">{m.corps}</p> : null}
      {m.pourquoi ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-texte-2">{m.pourquoi}</p> : null}
      {m.reponse ? (
        <p className="mt-1 border-t border-bord pt-1 text-sm" data-testid="reponse-donnee">
          <span className="text-texte-2">{m.kind === 'fusion' ? 'Tranché : ' : 'Réponse : '}</span>{m.reponse}{m.precision ? ` — ${m.precision}` : ''}
        </p>
      ) : null}
      {m.kind === 'action' && m.etat && !m.reponse ? <p className="mt-1 text-sm text-texte-2">État : {m.etat === 'pas_encore' ? 'pas encore' : m.etat}</p> : null}
      {medias.length ? <div className="mt-1.5"><MediasMessage medias={medias} /></div> : null}
    </Bulle>
  )
}

/** Le fil, puis la barre du bas ; à l'ouverture, positionné sur la première chose à faire (sinon en bas). */
function Corps({ children, chantierId, placeholder }: { children: ReactNode; chantierId: string | null; placeholder: string }) {
  const corps = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = corps.current
    if (!el) return
    const cible = el.querySelector<HTMLElement>('[data-a-faire="oui"]')
    if (cible) el.scrollTop = Math.max(0, cible.offsetTop - el.offsetTop - 8)
    else el.scrollTop = el.scrollHeight
  }, [])
  return (
    <>
      <div ref={corps} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3" data-testid="fil-conversation">{children}</div>
      <Saisie chantierId={chantierId} placeholder={placeholder} onEnvoye={() => window.setTimeout(() => corps.current?.scrollTo({ top: corps.current.scrollHeight, behavior: 'smooth' }), 150)} />
    </>
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
  // La zone grandit avec le texte (jusqu'à ~5 lignes), puis défile.
  useLayoutEffect(() => { const z = zone.current; if (!z) return; z.style.height = 'auto'; z.style.height = `${Math.min(z.scrollHeight, 132)}px` }, [texte])

  const envoyer = async () => {
    if (vide) return
    if (pj.enCours) { toast.info('Un fichier est encore en cours d’envoi : un instant.'); return }
    setEnCours(true)
    const erreur = await ecrireAvecMedias({ projetId: projet.id, chantierId, par, admin, corps: texte.trim() || resumeMedias(pj.medias), medias: pj.medias })
    setEnCours(false)
    if (erreur) { toast.erreur(`Le message n’est pas parti : ${erreur}`); return }
    toast.succes('Message envoyé : Claude le lira la prochaine fois qu’il travaillera sur ce projet.')
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
      {texte.trim() ? <p className="px-2 pt-1 text-[11px] text-texte-2">Claude le lira la prochaine fois qu’il travaillera sur ce projet.</p> : null}
    </div>
  )
}

/** Le menu ⋯ d'un chantier (admin) : les gestes rares, avec confirmation avant toute suppression. */
function MenuChantier({ chantier, nMessages, onHistorique, onFermer }: { chantier: Chantier; nMessages: number; onHistorique: () => void; onFermer: () => void }) {
  const { recharger, ouvrirModifier, ouvrirDoublonDe } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ouvert) return
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOuvert(false) }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [ouvert])
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
    toast.succes(`« ${chantier.titre} » supprimé.`); onFermer(); await recharger()
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
          {!chantier.doublon_de ? item(<Copy size={17} className={ic} />, 'C’est un doublon de…', () => ouvrirDoublonDe(chantier), 'doublon-de') : null}
          {chantier.pris_par ? item(<LockOpen size={17} className={ic} />, 'Libérer la réservation', liberer, 'liberer') : null}
          {chantier.archived_at
            ? item(<ArchiveRestore size={17} className={ic} />, 'Désarchiver', () => maj({ archived_at: null }, 'Chantier désarchivé.'), 'archiver')
            : item(<Archive size={17} className={ic} />, 'Archiver', () => maj({ archived_at: new Date().toISOString() }, 'Chantier archivé.'), 'archiver')}
          {item(<Trash2 size={17} className="shrink-0" />, 'Supprimer', supprimer, 'supprimer', true)}
        </div>
      ) : null}
    </div>
  )
}

function FilChantier({ chantierId, onFermer }: { chantierId: string; onFermer: () => void }) {
  const { admin, messages, chantiers, activites, taches, enAttente, now, silenceMs, sections, recharger } = useCockpit()
  const toast = useToast()
  const [signalHistorique, setSignalHistorique] = useState(0)
  const c = chantiers.find((x) => x.id === chantierId) ?? null
  const fil = useMemo(() => messages.filter((m) => m.chantier_id === chantierId).sort((a, b) => a.created_at.localeCompare(b.created_at)), [messages, chantierId])
  const pd = useMemo(() => (c ? presenceDe(c, activites, enAttente, now, silenceMs, taches) : null), [c, activites, taches, enAttente, now, silenceMs])

  if (!c || !pd) {
    return (
      <>
        <EnTete titre="Chantier introuvable" onFermer={onFermer} />
        <div className="flex-1 p-4 text-sm text-texte-2">Ce chantier n’existe plus (supprimé ou fusionné dans un autre).</div>
      </>
    )
  }
  const { presence, activite } = pd
  const section = c.section_id ? sections.find((s) => s.id === c.section_id) : null
  const dernierBlocage = [...fil].reverse().find((m) => m.kind === 'blocage') ?? null
  const relancer = async () => {
    const { error } = await supabase.from('chantiers').update({ etat: 'libre' }).eq('id', c.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${c.titre} » relancé : il passe dans « Prêt à lancer ».`); await recharger()
  }
  const teinte = presence.code === 'travaille' ? 'text-ok' : presence.teinte === 'alerte' ? 'text-alerte' : presence.teinte === 'attention' ? 'text-attention' : presence.teinte === 'info' ? 'text-info' : 'text-texte-2'

  return (
    <>
      <EnTete titre={c.titre} onFermer={onFermer}
        sousTitre={
          <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${teinte}`} data-testid="presence-conversation" data-presence={presence.code}>
            {presence.code === 'travaille' ? <span className="point-vivant inline-block h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden /> : <IconePresence code={presence.code} taille={14} />}
            <span className="truncate">{presenceEnMots(presence, activite)}</span>
          </p>
        }
        menu={admin ? <MenuChantier chantier={c} nMessages={fil.length} onHistorique={() => setSignalHistorique((n) => n + 1)} onFermer={onFermer} /> : null} />
      <Corps chantierId={c.id} placeholder={PLACEHOLDER[presence.code] ?? 'Écrire à Claude…'}>
        {/* 1. La demande, en premier. */}
        <Bulle cote={c.origine === 'session' ? 'gauche' : 'droite'} auteur={c.origine === 'session' ? 'Claude · la demande' : c.origine === 'utilisateur' ? 'Demande d’un utilisateur' : 'La demande'} quand={c.created_at} testId="bulle-demande">
          {c.demande ? <p className="whitespace-pre-wrap text-[15px] leading-snug">{c.demande}</p> : <p className="text-sm text-texte-2">Pas de description : le titre dit tout.</p>}
          {c.resume_simple ? <p className="mt-1 text-sm text-texte-2">En clair : {c.resume_simple}</p> : null}
        </Bulle>

        {/* 2. Le fil : ce qui attend une réponse devient une bulle à remplir. */}
        {fil.map((m) => {
          if ((m.kind === 'question' || m.kind === 'action') && !m.answered_at) return <AFaire key={m.id}><BlocQuestion message={m} /></AFaire>
          if (m.kind === 'fusion' && !m.answered_at) return <AFaire key={m.id}><BlocFusion message={m} /></AFaire>
          return <BulleMessage key={m.id} m={m} />
        })}

        {/* 3. Où en est le chantier, et ce qu'on attend de toi. */}
        {c.etat === 'a_verifier' ? <AFaire><BlocValidation chantier={c} /></AFaire> : null}
        {c.etat === 'a_cadrer' ? <AFaire><BlocCadrer chantier={c} /></AFaire> : null}
        {c.etat === 'bloque' ? <AFaire><BlocBloque chantier={c} blocage={dernierBlocage} /></AFaire> : null}
        {presence.code === 'travaille' ? (
          <Bulle cote="gauche" auteur="En ce moment" testId="bulle-travail">
            <p className="flex items-center gap-1.5 text-sm"><PointTravaille />{presence.detail ?? ''}</p>
            {activite ? <Progression activite={activite} vive={presence.barreVive} compact now={now} /> : null}
            <div className="mt-1.5"><TachesDuChantier chantierId={c.id} /></div>
          </Bulle>
        ) : null}
        {(presence.code === 'personne' || presence.code === 'silencieux') && c.etat !== 'a_cadrer' ? (
          <AFaire testId="bulle-relance">
            <div className="space-y-2 rounded-2xl border border-bord bg-carte p-3">
              <p className="flex items-center gap-1.5 text-[15px] font-medium"><IconePresence code={presence.code} />{presence.code === 'silencieux' ? 'Plus de nouvelles de Claude' : 'Personne n’y travaille'}</p>
              {presence.detail ? <p className="text-sm text-texte-2" data-testid="detail-presence">{presence.detail}</p> : null}
              {activite ? <Progression activite={activite} vive={false} compact legende={false} now={now} /> : null}
              <p className="text-sm text-texte-2">Pour le faire avancer : copie la consigne et colle-la dans Claude Code, sur ce projet.</p>
              <BoutonsRelance chantier={c} />
            </div>
          </AFaire>
        ) : null}
        {c.etat === 'reporte' ? (
          <Bulle cote="gauche" auteur="Mis de côté" testId="bulle-reporte">
            <p className="text-sm">{presence.tonAction}</p>
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

        {/* 4. Le reste, en petit. */}
        {c.notes ? <Repliable titre={<span className="text-sm font-medium">Notes de travail de Claude</span>}><p className="whitespace-pre-wrap text-sm text-texte-2">{c.notes}</p></Repliable> : null}
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 pt-1 text-[11px] text-texte-2" data-testid="etat-technique">
          <span>État : {infoEtat(c.etat).libelle}</span>
          <span>{section ? `Section : ${section.nom}` : 'Sans section'}</span>
          {c.priorite !== 'normale' ? <span>Priorité {c.priorite}</span> : null}
          {c.origine === 'session' ? <span data-testid="origine-session">lancé par Claude</span> : c.origine === 'utilisateur' ? <span>demande d’un utilisateur</span> : null}
          {c.livre_at ? <span>Livré {dateRelative(c.livre_at, now)}</span> : null}
          {c.pris_par ? <span title={c.pris_par}>Réservé par {nomCourtSession(c.pris_par)}</span> : null}
          {c.archived_at ? <span>archivé</span> : null}
        </p>
        {admin ? <Historique chantierId={c.id} signal={signalHistorique} /> : null}
      </Corps>
    </>
  )
}

/** Les questions du projet qui ne portent sur aucun chantier. */
function FilProjet({ onFermer }: { onFermer: () => void }) {
  const { messages } = useCockpit()
  const fil = useMemo(() => messages.filter((m) => !m.chantier_id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [messages])
  return (
    <>
      <EnTete titre="Questions sur le projet" sousTitre={<p className="text-xs text-texte-2">Ce qui ne porte sur aucun chantier en particulier</p>} onFermer={onFermer} />
      <Corps chantierId={null} placeholder="Écrire à Claude…">
        {fil.length ? fil.map((m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at
          ? <AFaire key={m.id}><BlocQuestion message={m} /></AFaire>
          : <BulleMessage key={m.id} m={m} />) : <p className="text-sm text-texte-2">Rien pour l’instant.</p>}
      </Corps>
    </>
  )
}
