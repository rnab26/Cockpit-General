import { useCallback, useEffect, useRef, useState } from 'react'
import { File, FileText, Film, Image, Mic, Paperclip, PenLine, X, type LucideIcon } from 'lucide-react'
import type { Media } from '../lib/types.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { ACCEPT_MEDIAS, BUCKET_MEDIAS, cheminMedia, genreMedia, refusMedias, type GenreMedia, tailleLisible } from '../lib/medias.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Annoter } from './Annoter.tsx'

/**
 * Médias joints à une réponse (0013). Le fichier part dans le stockage DÈS
 * qu'il est choisi (vignette + roue) : l'envoi du message est ensuite
 * immédiat, et un échec se voit sur la vignette, avec « réessayer ».
 *
 * Mode `differe` (création d'un chantier, 29 sept. 2026) : le chantier n'a
 * pas encore d'id, donc pas de dossier où déposer. Les fichiers restent sur
 * l'appareil (« attente », crayon possible) jusqu'à `envoyerTout(id)`, appelé
 * juste après la création ; un échec garde le fichier, avec « réessayer ».
 */
interface Piece { id: string; fichier: File; apercu: string | null; etat: 'attente' | 'envoi' | 'ok' | 'erreur'; media: Media | null; erreur?: string }

export interface MediasAJoindre {
  pieces: Piece[]
  medias: Media[]
  enCours: boolean
  ajouter: (fichiers: File[]) => void
  retirer: (id: string) => void
  reessayer: (id: string) => void
  /** Le crayon : l'image annotée remplace la pièce (déposée d'abord ; l'ancienne n'est retirée qu'ensuite). null = fait, sinon l'erreur. */
  remplacer: (id: string, fichier: File) => Promise<string | null>
  vider: () => void
  /** Mode différé : dépose tout ce qui n'est pas encore parti dans le dossier de ce chantier. `ids` / `medias` : ce qui est déposé (avant ou maintenant). */
  envoyerTout: (chantierId: string) => Promise<{ ids: string[]; medias: Media[]; echecs: number }>
  /** Retire des vignettes des pièces envoyées dans un message (sans toucher au stockage). */
  oublier: (ids: string[]) => void
}

/** Dépose un fichier dans le stockage privé : le média, ou l'erreur lisible. */
export async function deposerMedia(projetId: string, chantierId: string | null, id: string, fichier: File): Promise<{ media: Media } | { erreur: string }> {
  const chemin = cheminMedia(projetId, chantierId, id, fichier.name)
  const { error } = await supabase.storage.from(BUCKET_MEDIAS).upload(chemin, fichier, { contentType: fichier.type || undefined, upsert: false })
  if (error) return { erreur: messageErreur(error) }
  return { media: { chemin, nom: fichier.name, type: fichier.type || 'application/octet-stream', taille: fichier.size } }
}

export function useMediasAJoindre(projetId: string, chantierId: string | null, { differe = false }: { differe?: boolean } = {}): MediasAJoindre {
  const toast = useToast()
  const [pieces, setPieces] = useState<Piece[]>([])
  const liste = useRef<Piece[]>([])
  liste.current = pieces
  // Le dossier de dépôt : le chantier donné ; en différé, celui que fixe `envoyerTout` (null = on garde sur l'appareil).
  const cible = useRef<string | null>(chantierId)
  if (!differe) cible.current = chantierId
  const garder = () => differe && !cible.current
  // Les aperçus locaux sont libérés quand le composant disparaît.
  useEffect(() => () => { for (const p of liste.current) if (p.apercu) URL.revokeObjectURL(p.apercu) }, [])

  const envoyer = useCallback(async (p: Piece, avecToast = true) => {
    const r = await deposerMedia(projetId, cible.current, p.id, p.fichier)
    setPieces((l) => l.map((x) => x.id !== p.id ? x : 'erreur' in r
      ? { ...x, etat: 'erreur', erreur: r.erreur }
      : { ...x, etat: 'ok', media: r.media }))
    if ('erreur' in r && avecToast) toast.erreur(`« ${p.fichier.name} » n’a pas pu être envoyé : ${r.erreur}`)
    return r
  }, [projetId, toast])

  const ajouter = useCallback((fichiers: File[]) => {
    if (!fichiers.length) return
    const refus = refusMedias(fichiers, liste.current.length)
    if (refus) { toast.erreur(refus); return }
    const local = garder()
    const nouvelles: Piece[] = fichiers.map((f) => ({
      id: crypto.randomUUID(), fichier: f, etat: local ? 'attente' : 'envoi', media: null,
      apercu: f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null,
    }))
    setPieces((l) => [...l, ...nouvelles])
    if (!local) for (const p of nouvelles) void envoyer(p)
  }, [envoyer, toast]) // eslint-disable-line react-hooks/exhaustive-deps

  const retirer = useCallback((id: string) => {
    const p = liste.current.find((x) => x.id === id)
    if (p?.apercu) URL.revokeObjectURL(p.apercu)
    setPieces((l) => l.filter((x) => x.id !== id))
    // Seul un admin peut supprimer du stockage (0013) : pour les autres, le fichier non envoyé reste orphelin, sans lien.
    if (p?.media) void supabase.storage.from(BUCKET_MEDIAS).remove([p.media.chemin])
  }, [])

  const reessayer = useCallback((id: string) => {
    const p = liste.current.find((x) => x.id === id)
    if (!p || garder()) return
    setPieces((l) => l.map((x) => x.id === id ? { ...x, etat: 'envoi', erreur: undefined } : x))
    void envoyer(p)
  }, [envoyer])

  const remplacer = useCallback(async (id: string, fichier: File) => {
    const ancienne = liste.current.find((x) => x.id === id)
    if (!ancienne) return 'la pièce n’est plus là.'
    if (garder() || ancienne.etat === 'attente') {
      // Rien n'est encore parti : l'image annotée remplace l'originale sur l'appareil.
      const locale: Piece = { id: crypto.randomUUID(), fichier, etat: 'attente', media: null, apercu: URL.createObjectURL(fichier) }
      if (ancienne.apercu) URL.revokeObjectURL(ancienne.apercu)
      setPieces((l) => l.map((x) => x.id === id ? locale : x))
      return null
    }
    const nouvelle: Piece = { id: crypto.randomUUID(), fichier, etat: 'ok', media: null, apercu: null }
    const r = await deposerMedia(projetId, cible.current, nouvelle.id, fichier)
    if ('erreur' in r) return r.erreur
    nouvelle.media = r.media
    nouvelle.apercu = URL.createObjectURL(fichier)
    if (ancienne.apercu) URL.revokeObjectURL(ancienne.apercu)
    setPieces((l) => l.map((x) => x.id === id ? nouvelle : x))
    // L'originale n'est plus jointe : retirée du stockage (admin seulement, comme « retirer »).
    if (ancienne.media) void supabase.storage.from(BUCKET_MEDIAS).remove([ancienne.media.chemin])
    return null
  }, [projetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const vider = useCallback(() => {
    for (const p of liste.current) if (p.apercu) URL.revokeObjectURL(p.apercu)
    setPieces([])
    // Différé : la prochaine création repart sans dossier (sinon ses pièces iraient chez le chantier précédent).
    if (differe) cible.current = null
  }, [differe])

  const envoyerTout = useCallback(async (id: string) => {
    cible.current = id
    const deja = liste.current.filter((p) => p.etat === 'ok' && p.media)
    const aEnvoyer = liste.current.filter((p) => p.etat === 'attente' || p.etat === 'erreur')
    setPieces((l) => l.map((x) => aEnvoyer.some((a) => a.id === x.id) ? { ...x, etat: 'envoi', erreur: undefined } : x))
    const res = await Promise.all(aEnvoyer.map(async (p) => ({ p, r: await envoyer(p, false) })) /* un seul message d’échec : celui de l’appelant */)
    const ok = [...deja.map((p) => ({ id: p.id, media: p.media! })), ...res.flatMap(({ p, r }) => 'media' in r ? [{ id: p.id, media: r.media }] : [])]
    return { ids: ok.map((o) => o.id), medias: ok.map((o) => o.media), echecs: res.filter(({ r }) => 'erreur' in r).length }
  }, [envoyer])

  const oublier = useCallback((ids: string[]) => {
    for (const p of liste.current) if (ids.includes(p.id) && p.apercu) URL.revokeObjectURL(p.apercu)
    setPieces((l) => l.filter((x) => !ids.includes(x.id)))
  }, [])

  return {
    pieces, ajouter, retirer, reessayer, remplacer, vider, envoyerTout, oublier,
    medias: pieces.filter((p) => p.etat === 'ok' && p.media).map((p) => p.media!),
    enCours: pieces.some((p) => p.etat === 'envoi'),
  }
}

/** L'icône d'un genre de fichier (des logos, pas des emojis : 29 sept. 2026). */
const ICONE_MEDIA: Record<GenreMedia, LucideIcon> = { image: Image, video: Film, audio: Mic, pdf: FileText, fichier: File }
function IconeMedia({ genre }: { genre: GenreMedia }) {
  const I = ICONE_MEDIA[genre]
  return <I size={18} aria-hidden className="mx-auto mb-0.5 text-texte-2" />
}

/** Le bouton « Joindre » (trombone) et les vignettes de ce qui est joint. */
export function ChoisirMedias({ ctrl, testId = 'choisir-medias' }: { ctrl: MediasAJoindre; testId?: string }) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <VignettesPieces ctrl={ctrl} />
      <BoutonJoindre ctrl={ctrl} />
    </div>
  )
}

/** Les vignettes de ce qui est joint (envoi en cours, erreur avec « réessayer », retirer). */
export function VignettesPieces({ ctrl }: { ctrl: MediasAJoindre }) {
  const toast = useToast()
  const [annotee, setAnnotee] = useState<Piece | null>(null)
  return (
    <>
      {ctrl.pieces.length ? (
        <ul className="flex flex-wrap gap-2" data-testid="pieces-jointes">
          {ctrl.pieces.map((p) => (
            <li key={p.id} data-testid="piece-jointe" data-etat={p.etat} className="relative">
              <div className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border bg-carte-2 ${p.etat === 'erreur' ? 'border-alerte' : 'border-bord'}`} title={`${p.fichier.name} · ${tailleLisible(p.fichier.size)}`}>
                {p.apercu && p.fichier.type.startsWith('image/') ? <img src={p.apercu} alt={p.fichier.name} className="h-full w-full object-cover" />
                  : p.apercu ? <video src={p.apercu} muted playsInline className="h-full w-full object-cover" />
                  : <span className="px-1 text-center text-[10px] leading-tight text-texte-2"><IconeMedia genre={genreMedia(p.fichier.type, p.fichier.name)} />{p.fichier.name.slice(0, 14)}</span>}
                {p.etat === 'envoi' ? <span className="absolute inset-0 flex items-center justify-center bg-carte/60"><span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="Envoi…" /></span> : null}
                {p.etat === 'erreur' ? (
                  <button type="button" onClick={() => ctrl.reessayer(p.id)} className="absolute inset-0 flex items-center justify-center bg-carte/80 text-[11px] font-medium text-alerte">réessayer</button>
                ) : null}
              </div>
              <button type="button" onClick={() => ctrl.retirer(p.id)} aria-label={`Retirer ${p.fichier.name}`}
                className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-bord bg-carte text-texte-2 shadow-sm"><X size={14} /></button>
              {(p.etat === 'ok' || p.etat === 'attente') && genreMedia(p.fichier.type, p.fichier.name) === 'image' ? <BoutonCrayon nom={p.fichier.name} onClick={() => setAnnotee(p)} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {annotee ? (
        <Annoter nom={annotee.fichier.name} type={annotee.fichier.type} charger={() => Promise.resolve(annotee.fichier)}
          onFermer={() => setAnnotee(null)}
          onEnregistrer={async (f) => {
            const err = await ctrl.remplacer(annotee.id, f)
            if (!err) { setAnnotee(null); toast.succes('Image annotée : elle remplace la pièce jointe.') }
            return err
          }} />
      ) : null}
    </>
  )
}

/** Le crayon, en haut à droite d'une image jointe : ouvre l'image pour dessiner dessus. */
function BoutonCrayon({ nom, onClick }: { nom: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Dessiner sur ${nom}`} title="Dessiner dessus" data-testid="crayon-media"
      className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-bord bg-carte text-texte shadow-sm"><PenLine size={14} aria-hidden /></button>
  )
}

/** « Joindre » : ouvre le choix de fichiers. `icone` : le trombone seul (barre de saisie d'une conversation). */
export function BoutonJoindre({ ctrl, icone = false }: { ctrl: MediasAJoindre; icone?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={input} type="file" multiple accept={ACCEPT_MEDIAS} className="hidden" data-testid="entree-medias"
        onChange={(e) => { ctrl.ajouter(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <button type="button" onClick={() => input.current?.click()} data-testid="ajouter-media"
        title="Joindre une photo, une vidéo ou un fichier" aria-label="Joindre une photo, une vidéo ou un fichier"
        className={icone
          ? 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-texte-2 hover:bg-carte-2 hover:text-texte'
          : 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-bord bg-carte px-2.5 text-sm text-texte-2 hover:bg-carte-2 hover:text-texte'}>
        <Paperclip size={icone ? 18 : 16} aria-hidden />{icone ? null : ' Joindre'}
      </button>
    </>
  )
}

// Liens signés (le stockage est privé) : une heure, gardés en mémoire pour ne pas les redemander à chaque rendu.
const DUREE_LIEN_S = 3600
const liens = new Map<string, { url: string; expire: number }>()
async function liensSignes(chemins: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const manquants = chemins.filter((c) => { const l = liens.get(c); return !l || l.expire < now + 60_000 })
  if (manquants.length) {
    const { data } = await supabase.storage.from(BUCKET_MEDIAS).createSignedUrls(manquants, DUREE_LIEN_S)
    for (const d of data ?? []) if (d.path && d.signedUrl) liens.set(d.path, { url: d.signedUrl, expire: now + DUREE_LIEN_S * 1000 })
  }
  return new Map(chemins.flatMap((c) => liens.has(c) ? [[c, liens.get(c)!.url] as const] : []))
}

/**
 * Les médias d'un message : vignettes ; un toucher ouvre l'image ou la vidéo en grand, un PDF ou un fichier dans un onglet.
 * `onAnnote` (images jointes par Raphaël) : un crayon sur chaque image ; l'image annotée part comme une NOUVELLE pièce.
 */
export function MediasMessage({ medias, petit = false, onAnnote }: { medias: Media[]; petit?: boolean; onAnnote?: (fichier: File) => Promise<string | null> }) {
  const [annotee, setAnnotee] = useState<Media | null>(null)
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [erreur, setErreur] = useState(false)
  const [grand, setGrand] = useState<Media | null>(null)
  const cle = medias.map((m) => m.chemin).join('|')
  useEffect(() => {
    if (!medias.length) return
    let vivant = true
    liensSignes(medias.map((m) => m.chemin)).then((u) => { if (vivant) { setUrls(u); setErreur(u.size < medias.length) } }).catch(() => { if (vivant) setErreur(true) })
    return () => { vivant = false }
  }, [cle]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!medias.length) return null
  const taille = petit ? 'h-12 w-12' : 'h-20 w-20'
  return (
    <>
      <ul className="flex flex-wrap gap-2" data-testid="medias-message">
        {medias.map((m) => {
          const url = urls.get(m.chemin)
          const genre = genreMedia(m.type, m.nom)
          const ouvrir = () => { if (!url) return; if (genre === 'image' || genre === 'video') setGrand(m); else window.open(url, '_blank', 'noopener') }
          return (
            <li key={m.chemin} className="relative">
              <button type="button" onClick={ouvrir} data-testid="media" data-genre={genre} title={`${m.nom} · ${tailleLisible(m.taille)}`}
                className={`flex ${taille} items-center justify-center overflow-hidden rounded-lg border border-bord bg-carte-2`}>
                {url && genre === 'image' ? <img src={url} alt={m.nom} loading="lazy" className="h-full w-full object-cover" />
                  : url && genre === 'video' ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  : <span className="px-1 text-center text-[10px] leading-tight text-texte-2"><IconeMedia genre={genre} />{m.nom.slice(0, 14)}</span>}
              </button>
              {onAnnote && url && genre === 'image' ? <BoutonCrayon nom={m.nom} onClick={() => setAnnotee(m)} /> : null}
            </li>
          )
        })}
      </ul>
      {annotee && onAnnote ? (
        <Annoter nom={annotee.nom} type={annotee.type} onFermer={() => setAnnotee(null)}
          charger={async () => {
            const { data, error } = await supabase.storage.from(BUCKET_MEDIAS).download(annotee.chemin)
            if (error || !data) throw error ?? new Error('illisible')
            return data
          }}
          onEnregistrer={async (f) => { const err = await onAnnote(f); if (!err) setAnnotee(null); return err }} />
      ) : null}
      {erreur ? <p className="text-xs text-texte-2">Certains fichiers ne sont pas lisibles (droits ou fichier supprimé).</p> : null}
      <Dialog ouvert={!!grand} onFermer={() => setGrand(null)} titre={grand?.nom ?? ''} large>
        {grand && urls.get(grand.chemin) ? (
          genreMedia(grand.type, grand.nom) === 'video'
            ? <video src={urls.get(grand.chemin)} controls playsInline autoPlay className="max-h-[70dvh] w-full rounded-lg bg-black" />
            : <img src={urls.get(grand.chemin)} alt={grand.nom} className="mx-auto max-h-[70dvh] rounded-lg" />
        ) : null}
        {grand ? <a href={urls.get(grand.chemin)} target="_blank" rel="noopener" className="mt-2 block text-sm text-accent">Ouvrir dans un onglet · {tailleLisible(grand.taille)}</a> : null}
      </Dialog>
    </>
  )
}

/**
 * Écrit dans le fil d'un chantier (ou du projet) un message qui porte des
 * médias : la même ligne sert à « Écrire à Claude », et aux pièces jointes
 * d'une réponse, d'une correction ou d'un constat (les RPC de réponse ne
 * portent pas de fichiers : les médias arrivent juste en dessous, dans le fil).
 */
export async function ecrireAvecMedias(o: { projetId: string; chantierId: string | null; par: string; admin: boolean; corps: string; medias: Media[] }): Promise<string | null> {
  const { error } = await supabase.from('messages').insert({
    projet_id: o.projetId, chantier_id: o.chantierId, auteur: o.par,
    auteur_type: o.admin ? 'proprietaire' : 'utilisateur', kind: 'info', corps: o.corps, medias: o.medias,
  })
  return error ? messageErreur(error) : null
}
