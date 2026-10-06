import { useEffect, useRef, useState } from 'react'
import { CloudOff, HelpCircle, Mic, MicOff, Reply, Send, X } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { PastilleReponse, useMarquerLu } from './PastilleReponse.tsx'
import { cleFil } from '../lib/lecture.ts'
import { VUE_TOUT } from '../hooks/useDonnees.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { TexteLong } from '../ui/TexteLong.tsx'
import { phraseMessageEnAttente } from '../lib/fileAttente.ts'
import { BoutonJoindre, MediasMessage, VignettesPieces, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'
import { aCiter, auteurDe, avecCitation, bulleActive, cartesAFaire, citationDe, constructeurVoix, notifsChat, filDeLaBulle, messageVoix, projetDeLaBulle, sujetDe, VOIX_NON_SUPPORTEE } from '../lib/bulleAide.ts'
import { mediasDe, resumeMedias } from '../lib/medias.ts'
import { heureLisible } from '../lib/dates.ts'
import type { Message } from '../lib/types.ts'
import { aToi } from '../lib/entonnoir.ts'
import { AvecProjet } from './AvecProjet.tsx'
import { BlocQuestion } from './BlocQuestion.tsx'
import { BlocValidation } from './BlocValidation.tsx'
import { BlocCadrer, BlocFusion } from './BlocsAToi.tsx'

/**
 * Bulle flottante d'aide (allumée par défaut ; l'extinction est dans « Réglages
 * du projet »). Rôle : poser une question sur le cockpit ou le projet, demander
 * où ça en est, dire une idée. Un message tapé ici (ou dicté, avec photos et
 * fichiers) est un message LIBRE du fil du projet : une session y répond
 * (progression.sh --point) et la réponse s'affiche ici en direct ; la chef le
 * range en chantier si besoin. Chaque message dit qui et à quelle heure ; on peut
 * répondre à une phrase précise de Claude (citation). Vue « Tout » : le projet
 * cockpit (règle : lib/bulleAide.ts).
 */
type Voix = { start: () => void; stop: () => void; abort: () => void; lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null }

export function BulleFlottanteAide({ projetOuvertId, onFermer, sansBouton = false }: { projetOuvertId?: string | null; onFermer?: () => void; sansBouton?: boolean } = {}) {
  const g = useGlobal()
  const toast = useToast()
  const [ouvertLocal, setOuvertLocal] = useState(false)
  // Piloté par la barre du bas (liste des discussions) ou, sans barre, par le bouton flottant.
  const pilote = projetOuvertId !== undefined
  const ouvert = pilote ? projetOuvertId !== null : ouvertLocal
  const setOuvert = (v: boolean) => { if (pilote) { if (!v) onFermer?.() } else setOuvertLocal(v) }
  const [envoi, setEnvoi] = useState(false)
  const [texte, setTexte] = useState('')
  const [citation, setCitation] = useState<string | null>(null)
  const [ecoute, setEcoute] = useState(false)
  const fin = useRef<HTMLDivElement>(null)
  const zone = useRef<HTMLTextAreaElement>(null)
  const voix = useRef<Voix | null>(null)
  const Reco = typeof window !== 'undefined' ? constructeurVoix(window) : null

  const projet = projetDeLaBulle(pilote ? (projetOuvertId ?? (g.vue === VUE_TOUT ? null : g.vue)) : g.vue === VUE_TOUT ? null : g.vue, g.projets, g.messages)
  const pj = useMediasAJoindre(projet?.id ?? '', null)
  const fil = projet ? filDeLaBulle(g.messages, projet.id) : []
  // Bulle ouverte = fil lu ; fermée, la pastille « Réponse » reste sur le bouton tant qu'une réponse n'est pas lue.
  useMarquerLu(projet ? cleFil(projet.id, null) : '', ouvert && projet ? fil : [], g.prefs, g.poser)
  useEffect(() => { if (ouvert) fin.current?.scrollIntoView({ block: 'end' }) }, [ouvert, fil.length])
  // Sa question attend une réponse : la bulle ouverte relit toutes les 10 s (le direct l'apporte déjà s'il est
  // actif ; ceci couvre le direct coupé, sans recharger l'app en continu quand rien n'est attendu).
  const attend = fil.length > 0 && fil[fil.length - 1].auteur_type !== 'session'
  const recharger = g.recharger
  useEffect(() => {
    if (!ouvert || !attend) return
    const t = window.setInterval(() => { void recharger(true) }, 10_000)
    return () => window.clearInterval(t)
  }, [ouvert, attend, recharger])
  // Fermer la bulle coupe le micro.
  useEffect(() => { if (!ouvert) { voix.current?.abort(); setEcoute(false) } }, [ouvert])
  useEffect(() => () => { voix.current?.abort() }, [])

  if (!projet || !bulleActive(g.prefs, projet.id)) return null

  const vide = !texte.trim() && !pj.medias.length

  const dicter = () => {
    if (!Reco) { toast.erreur(VOIX_NON_SUPPORTEE); return }
    if (ecoute) { voix.current?.stop(); return }
    const r = new (Reco as unknown as new () => Voix)()
    r.lang = 'fr-FR'; r.interimResults = true; r.continuous = false
    const base = texte && !/\s$/.test(texte) ? `${texte} ` : texte
    r.onresult = (e) => {
      let dit = ''
      for (let i = 0; i < e.results.length; i++) dit += e.results[i][0].transcript
      setTexte(base + dit)
    }
    r.onerror = (e) => { const m = messageVoix(String(e?.error ?? 'inconnue')); if (m) toast.erreur(m) }
    r.onend = () => { setEcoute(false); voix.current = null; zone.current?.focus() }
    try { r.start(); voix.current = r; setEcoute(true) } catch { toast.erreur('Le micro n’a pas pu démarrer : réessaie.') }
  }

  const repondreA = (corps: string, selection: string) => {
    setCitation(aCiter(selection, corps))
    window.setTimeout(() => zone.current?.focus(), 0)
  }

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (vide || envoi) return
    if (pj.enCours) { toast.info('Un fichier est encore en cours d’envoi : un instant.'); return }
    voix.current?.stop()
    setEnvoi(true)
    const corps = avecCitation(citation, texte.trim() || resumeMedias(pj.medias))
    const erreur = await ecrireAvecMedias({ projetId: projet.id, chantierId: null, par: g.par, admin: g.admin, corps, medias: pj.medias })
    setEnvoi(false)
    if (erreur) { toast.erreur(`Le message n’est pas parti : ${erreur}`); return }
    setTexte(''); setCitation(null); pj.vider()
    toast.succes('Message envoyé : Claude te répondra ici.')
    await g.recharger(true)
  }

  return (
    <>
      {/* À droite, au-dessus de la barre système et du bas de page : ne cache aucun bouton. */}
      {!ouvert && !sansBouton && (
        <button type="button" onClick={() => setOuvert(true)} aria-label="Ouvrir l’aide" data-testid="bulle-aide-bouton" title={`Aide · ${projet.nom}`}
          style={{ bottom: 'calc(max(var(--nav-h, 0px), env(safe-area-inset-bottom)) + 76px)', right: 'calc(env(safe-area-inset-right) + 12px)' }}
          className="fixed z-30 flex h-11 w-11 items-center justify-center rounded-full border border-bord bg-carte text-texte shadow-lg hover:bg-carte-2 focus:outline-none focus:ring-2 focus:ring-accent/40">
          <HelpCircle size={22} />
          {projet ? <PastilleReponse cle={cleFil(projet.id, null)} className="absolute -right-1 -top-2 !px-1.5" /> : null}
        </button>
      )}
      {ouvert ? <Dialog ouvert onFermer={() => setOuvert(false)} titre={`Aide · ${projet.nom}`} brouillon={!vide || !!citation}
        pied={
          <form onSubmit={envoyer} className="w-full space-y-2">
            {citation ? (
              <div data-testid="bulle-aide-citation" className="flex items-start gap-2 rounded-xl border-l-4 border-accent bg-carte-2 px-3 py-1.5 text-sm">
                <p className="min-w-0 flex-1 break-words text-texte-2"><span className="font-medium text-texte">Tu réponds à Claude : </span>{citation}</p>
                <button type="button" onClick={() => setCitation(null)} aria-label="Ne plus citer" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-texte-2 hover:bg-carte"><X size={15} /></button>
              </div>
            ) : null}
            {pj.pieces.length ? <VignettesPieces ctrl={pj} /> : null}
            <div className="flex items-end gap-1">
              <BoutonJoindre ctrl={pj} icone />
              <button type="button" onClick={dicter} data-testid="bulle-aide-micro" aria-pressed={ecoute} data-voix={Reco ? (ecoute ? 'ecoute' : 'pret') : 'non-supporte'}
                aria-label={ecoute ? 'Arrêter la dictée' : Reco ? 'Dicter ton message' : 'Dictée vocale indisponible'}
                title={Reco ? 'Dicter ton message' : VOIX_NON_SUPPORTEE}
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ecoute ? 'animate-pulse bg-alerte text-white' : Reco ? 'text-texte-2 hover:bg-carte-2 hover:text-texte' : 'text-texte-2/40'}`}>
                {Reco ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
              </button>
              <textarea ref={zone} value={texte} onChange={(e) => setTexte(e.target.value)} rows={2} placeholder={ecoute ? 'Je t’écoute…' : 'Pose ta question…'} aria-label="Ta question" disabled={envoi} data-testid="bulle-aide-saisie"
                className="min-h-10 flex-1 resize-none rounded-2xl border border-bord bg-fond px-3 py-2 text-[15px] text-texte focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50" />
              <button type="submit" disabled={envoi || vide || pj.enCours} aria-label="Envoyer" data-testid="bulle-aide-envoyer" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40">
                {envoi || pj.enCours ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Send size={17} />}
              </button>
            </div>
            {!Reco ? <p className="px-1 text-[11px] text-texte-2" data-testid="bulle-aide-voix-non">Dictée vocale indisponible ici : utilise Chrome, Safari ou le micro du clavier.</p> : null}
          </form>
        }>
        <div data-testid="bulle-aide-panneau" className="min-h-[30dvh] space-y-2">
          <p className="rounded-xl bg-carte-2 px-3 py-2 text-xs text-texte-2" data-testid="bulle-aide-role">
            <b className="text-texte">À quoi sert cette bulle :</b> poser une question sur le cockpit ou sur {projet.nom}, demander où ça en est, dire une idée ou un problème. Claude répond ici, en quelques minutes ; ton message est rangé en chantier si besoin. Tu peux dicter, joindre une photo ou un fichier, et répondre à une phrase précise de Claude.
          </p>
          {fil.length === 0 ? (
            <div className="py-4 text-center" data-testid="bulle-aide-vide">
              <p className="text-sm text-texte-2">Rien pour l’instant. Pose une question sur le cockpit ou sur ce projet : Claude te répond ici.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {['Où ça en est sur ce projet ?', 'Qu’est-ce qui attend ma réponse ?'].map((s) => (
                  <button key={s} type="button" onClick={() => { setTexte(s); zone.current?.focus() }} data-testid="bulle-aide-suggestion"
                    className="min-h-9 rounded-full border border-bord bg-carte px-3 text-sm text-texte hover:bg-carte-2">{s}</button>
                ))}
              </div>
            </div>
          ) : fil.map((m) => <MessageBulle key={m.id} m={m} admin={g.admin} now={g.now} onRepondre={repondreA} />)}
          {attend ? <p className="text-center text-xs text-texte-2" data-testid="bulle-aide-attente">Claude n’a pas encore répondu : la réponse arrivera ici.</p> : null}
          <AFaireIci projetId={projet.id} />
          <div ref={fin} />
        </div>
      </Dialog> : null}
    </>
  )
}

/** Un message : nom + heure sur chaque bulle, sujet en gras, citation en encart, pièces jointes, « Répondre » sur ceux de Claude. */
function MessageBulle({ m, admin, now, onRepondre }: { m: Message; admin: boolean; now: Date; onRepondre: (corps: string, selection: string) => void }) {
  const claude = m.auteur_type === 'session'
  const ref = useRef<HTMLDivElement>(null)
  const { citation, reste: sansCitation } = citationDe(m.corps)
  const { sujet, reste } = sujetDe(sansCitation)
  const medias = mediasDe(m)
  // La sélection est lue AVANT que le toucher du bouton ne la défasse.
  const selection = () => {
    const s = window.getSelection()
    return s && ref.current && s.anchorNode && ref.current.contains(s.anchorNode) ? s.toString() : ''
  }
  return (
    <div className={`flex ${claude ? 'justify-start' : 'justify-end'}`} data-testid="bulle-aide-ligne" data-cote={claude ? 'gauche' : 'droite'}>
      <div ref={ref} className={`max-w-[85%] rounded-2xl px-3 py-2 text-[15px] ${claude ? 'rounded-bl-md bg-carte-2 text-texte' : 'rounded-br-md bg-accent text-white'}`} data-testid="bulle-aide-message">
        <p className={`mb-0.5 flex items-baseline justify-between gap-3 text-[11px] ${claude ? 'text-texte-2' : 'text-white/80'}`} data-testid="bulle-aide-entete">
          <span className="truncate font-semibold" data-testid="bulle-aide-auteur">{auteurDe(m, admin)}</span>
          <span className="shrink-0" data-testid="bulle-aide-heure">{heureLisible(m.created_at, now)}</span>
        </p>
        {sujet ? <p className="font-bold" data-testid="bulle-aide-sujet">{sujet}</p> : null}
        {citation ? <p className={`mb-1 rounded-lg border-l-4 px-2 py-1 text-sm ${claude ? 'border-accent bg-carte' : 'border-white/70 bg-white/15'}`} data-testid="bulle-aide-citee">{citation}</p> : null}
        {reste ? (claude ? <TexteLong texte={reste} /> : <p className="whitespace-pre-wrap">{reste}</p>) : null}
        {medias.length ? <div className="mt-1.5"><MediasMessage medias={medias} petit /></div> : null}
        {m.en_attente_envoi ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-white/90" data-testid="message-en-attente" role="status">
            <CloudOff size={12} aria-hidden />{phraseMessageEnAttente(m)}
          </p>
        ) : null}
        {claude ? (
          <button type="button" data-testid="bulle-aide-repondre" onPointerDownCapture={(e) => { (e.currentTarget as HTMLElement).dataset.sel = selection() }}
            onClick={(e) => onRepondre(m.corps, (e.currentTarget as HTMLElement).dataset.sel || selection())}
            className="mt-1 -mb-0.5 inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs font-medium text-accent hover:bg-carte">
            <Reply size={14} aria-hidden />Répondre
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * « Discussions » (barre du bas, à côté de la loupe) : un chat par projet, le plus récemment actif en haut,
 * pastille « Réponse » quand Claude a répondu et que ce n'est pas lu. Toucher une ligne ouvre le chat du projet.
 */
export function ListeDiscussions({ ouvert, onFermer, onChoisir }: { ouvert: boolean; onFermer: () => void; onChoisir: (projetId: string) => void }) {
  const g = useGlobal()
  const [filtre, setFiltre] = useState('')
  if (!ouvert) return null
  const lignes = g.projets
    .filter((p) => bulleActive(g.prefs, p.id))
    .map((p) => { const fil = filDeLaBulle(g.messages, p.id); return { p, dernier: fil.length ? fil[fil.length - 1] : null, notifs: notifsChat(g.nonLus, p.id, cartesAFaire(aToi(g.chantiers, g.messages, p.id, g.activites, g.taches))) } })
    .sort((a, b) => Number(b.notifs.total > 0) - Number(a.notifs.total > 0) || (b.dernier?.created_at ?? '').localeCompare(a.dernier?.created_at ?? '') || a.p.nom.localeCompare(b.p.nom))
  const q = filtre.trim().toLowerCase()
  const vues = q ? lignes.filter((l) => l.p.nom.toLowerCase().includes(q)) : lignes
  return (
    <Dialog ouvert onFermer={onFermer} titre="Discussions">
      <div data-testid="discussions-liste" className="min-h-[30dvh] space-y-2">
        {lignes.length > 6 ? (
          <input type="search" value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Chercher un projet…" aria-label="Chercher un projet" data-testid="discussions-filtre"
            className="h-10 w-full rounded-xl border border-bord bg-fond px-3 text-[15px] text-texte focus:outline-none focus:ring-2 focus:ring-accent/40" />
        ) : null}
        {g.projets.length === 0 ? (
          <p className="py-6 text-center text-sm text-texte-2" data-testid="discussions-vide">Aucun projet pour l’instant : il n’y a pas encore de discussion.</p>
        ) : lignes.length === 0 ? (
          <p className="py-6 text-center text-sm text-texte-2" data-testid="discussions-vide">Les discussions sont éteintes sur tous les projets (case « Bulle d’aide sur ce projet » dans Réglages du projet).</p>
        ) : vues.length === 0 ? (
          <p className="py-6 text-center text-sm text-texte-2" data-testid="discussions-aucun">Aucun projet ne s’appelle « {filtre} ».</p>
        ) : vues.map(({ p, dernier, notifs }) => {
          const { sujet, reste } = sujetDe(citationDe(dernier?.corps ?? null).reste)
          const apercu = dernier ? `${dernier.auteur_type === 'session' ? 'Claude' : 'Toi'} : ${(sujet ?? reste ?? '').replace(/\s+/g, ' ').trim() || (mediasDe(dernier).length ? resumeMedias(mediasDe(dernier)) : '…')}` : 'Pas encore de message'
          return (
            <button key={p.id} type="button" onClick={() => onChoisir(p.id)} data-testid="discussion-ligne" data-projet={p.slug}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-bord bg-carte px-3 py-2 text-left hover:bg-carte-2 active:bg-carte-2">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-carte-2 text-base font-semibold text-accent" aria-hidden>{p.nom.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold text-texte">{p.nom}</span>
                  {dernier ? <span className="shrink-0 text-[11px] text-texte-2">{heureLisible(dernier.created_at, g.now)}</span> : null}
                </span>
                <span className="block truncate text-sm text-texte-2" data-testid="discussion-apercu">{apercu}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {notifs.reponses ? <span data-testid="discussion-pastille" data-nombre={notifs.reponses} aria-label={`${notifs.reponses} réponse${notifs.reponses > 1 ? 's' : ''} de Claude à lire`} className="min-w-5 rounded-full bg-alerte px-1.5 text-center text-xs font-bold leading-5 text-white">{notifs.reponses}</span> : null}
                {notifs.aFaire ? <span data-testid="discussion-a-faire" data-nombre={notifs.aFaire} aria-label={`${notifs.aFaire} chose${notifs.aFaire > 1 ? 's' : ''} à faire dans ce chat`} className="rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{notifs.aFaire} à faire</span> : null}
              </span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}

/**
 * Ce que Claude attend de toi sur ce projet, répondable ICI (Raphaël, 6 oct. : « autant me faire faire
 * directement ce qu'il y a à faire dans son message, plutôt que je quitte la discussion »). Mêmes cartes
 * et même règle que « À toi de jouer » (`aToi`) : question, action, vérification, cadrage, fusion.
 * En dernier dans la discussion, comme les cartes d'un fil ; rien d'affiché quand il n'y a rien à faire.
 */
function AFaireIci({ projetId }: { projetId: string }) {
  const g = useGlobal()
  const liste = cartesAFaire(aToi(g.chantiers, g.messages, projetId, g.activites, g.taches))
  if (!liste.length) return null
  return (
    <section className="space-y-2 border-t border-bord pt-2" data-testid="bulle-a-faire" aria-label="À faire ici">
      <p className="text-xs font-semibold text-accent">À faire ici ({liste.length})</p>
      <AvecProjet projetId={projetId}>
        {liste.map((e) => (
          <div key={e.cle} data-testid="bulle-a-faire-carte" data-type={e.type}>
            {e.type === 'a_verifier' ? <BlocValidation chantier={e.chantier!} />
              : e.type === 'a_cadrer' ? <BlocCadrer chantier={e.chantier!} />
              : e.type === 'fusion' ? <BlocFusion message={e.message!} />
              : <>{e.chantier ? <p className="mb-0.5 text-[11px] text-texte-2">Chantier : {e.chantier.titre}</p> : null}<BlocQuestion message={e.message!} /></>}
          </div>
        ))}
      </AvecProjet>
    </section>
  )
}
