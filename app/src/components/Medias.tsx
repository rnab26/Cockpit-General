import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import type { Media } from '../lib/types.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { ACCEPT_MEDIAS, BUCKET_MEDIAS, cheminMedia, genreMedia, ICONE_MEDIA, refusMedias, tailleLisible } from '../lib/medias.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'

/**
 * Médias joints à une réponse (0013). Le fichier part dans le stockage DÈS
 * qu'il est choisi (vignette + roue) : l'envoi du message est ensuite
 * immédiat, et un échec se voit sur la vignette, avec « réessayer ».
 */
interface Piece { id: string; fichier: File; apercu: string | null; etat: 'envoi' | 'ok' | 'erreur'; media: Media | null; erreur?: string }

export interface MediasAJoindre {
  pieces: Piece[]
  medias: Media[]
  enCours: boolean
  ajouter: (fichiers: File[]) => void
  retirer: (id: string) => void
  reessayer: (id: string) => void
  vider: () => void
}

export function useMediasAJoindre(projetId: string, chantierId: string | null): MediasAJoindre {
  const toast = useToast()
  const [pieces, setPieces] = useState<Piece[]>([])
  const liste = useRef<Piece[]>([])
  liste.current = pieces
  // Les aperçus locaux sont libérés quand le composant disparaît.
  useEffect(() => () => { for (const p of liste.current) if (p.apercu) URL.revokeObjectURL(p.apercu) }, [])

  const envoyer = useCallback(async (p: Piece) => {
    const chemin = cheminMedia(projetId, chantierId, p.id, p.fichier.name)
    const { error } = await supabase.storage.from(BUCKET_MEDIAS).upload(chemin, p.fichier, { contentType: p.fichier.type || undefined, upsert: false })
    setPieces((l) => l.map((x) => x.id !== p.id ? x : error
      ? { ...x, etat: 'erreur', erreur: messageErreur(error) }
      : { ...x, etat: 'ok', media: { chemin, nom: p.fichier.name, type: p.fichier.type || 'application/octet-stream', taille: p.fichier.size } }))
    if (error) toast.erreur(`« ${p.fichier.name} » n’a pas pu être envoyé : ${messageErreur(error)}`)
  }, [projetId, chantierId, toast])

  const ajouter = useCallback((fichiers: File[]) => {
    if (!fichiers.length) return
    const refus = refusMedias(fichiers, liste.current.length)
    if (refus) { toast.erreur(refus); return }
    const nouvelles: Piece[] = fichiers.map((f) => ({
      id: crypto.randomUUID(), fichier: f, etat: 'envoi', media: null,
      apercu: f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null,
    }))
    setPieces((l) => [...l, ...nouvelles])
    for (const p of nouvelles) void envoyer(p)
  }, [envoyer, toast])

  const retirer = useCallback((id: string) => {
    const p = liste.current.find((x) => x.id === id)
    if (p?.apercu) URL.revokeObjectURL(p.apercu)
    setPieces((l) => l.filter((x) => x.id !== id))
    // Seul un admin peut supprimer du stockage (0013) : pour les autres, le fichier non envoyé reste orphelin, sans lien.
    if (p?.media) void supabase.storage.from(BUCKET_MEDIAS).remove([p.media.chemin])
  }, [])

  const reessayer = useCallback((id: string) => {
    const p = liste.current.find((x) => x.id === id)
    if (!p) return
    setPieces((l) => l.map((x) => x.id === id ? { ...x, etat: 'envoi', erreur: undefined } : x))
    void envoyer(p)
  }, [envoyer])

  const vider = useCallback(() => {
    for (const p of liste.current) if (p.apercu) URL.revokeObjectURL(p.apercu)
    setPieces([])
  }, [])

  return {
    pieces, ajouter, retirer, reessayer, vider,
    medias: pieces.filter((p) => p.etat === 'ok' && p.media).map((p) => p.media!),
    enCours: pieces.some((p) => p.etat === 'envoi'),
  }
}

/** Le bouton « 📎 Photo ou fichier » et les vignettes de ce qui est joint. */
export function ChoisirMedias({ ctrl, testId = 'choisir-medias' }: { ctrl: MediasAJoindre; testId?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2" data-testid={testId}>
      {ctrl.pieces.length ? (
        <ul className="flex flex-wrap gap-2" data-testid="pieces-jointes">
          {ctrl.pieces.map((p) => (
            <li key={p.id} data-testid="piece-jointe" data-etat={p.etat} className="relative">
              <div className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border bg-carte-2 ${p.etat === 'erreur' ? 'border-alerte' : 'border-bord'}`} title={`${p.fichier.name} · ${tailleLisible(p.fichier.size)}`}>
                {p.apercu && p.fichier.type.startsWith('image/') ? <img src={p.apercu} alt={p.fichier.name} className="h-full w-full object-cover" />
                  : p.apercu ? <video src={p.apercu} muted playsInline className="h-full w-full object-cover" />
                  : <span className="px-1 text-center text-[10px] leading-tight text-texte-2">{ICONE_MEDIA[genreMedia(p.fichier.type, p.fichier.name)]}<br />{p.fichier.name.slice(0, 14)}</span>}
                {p.etat === 'envoi' ? <span className="absolute inset-0 flex items-center justify-center bg-carte/60"><span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="Envoi…" /></span> : null}
                {p.etat === 'erreur' ? (
                  <button type="button" onClick={() => ctrl.reessayer(p.id)} className="absolute inset-0 flex items-center justify-center bg-carte/80 text-[11px] font-medium text-alerte">réessayer</button>
                ) : null}
              </div>
              <button type="button" onClick={() => ctrl.retirer(p.id)} aria-label={`Retirer ${p.fichier.name}`}
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-bord bg-carte text-texte-2 shadow-sm"><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <input ref={input} type="file" multiple accept={ACCEPT_MEDIAS} className="hidden" data-testid="entree-medias"
        onChange={(e) => { ctrl.ajouter(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <button type="button" onClick={() => input.current?.click()} data-testid="ajouter-media"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-bord bg-carte px-2.5 text-sm text-texte-2 hover:bg-carte-2 hover:text-texte">
        <Paperclip size={16} aria-hidden /> Photo, vidéo ou fichier
      </button>
    </div>
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

/** Les médias d'un message : vignettes ; un toucher ouvre l'image ou la vidéo en grand, un PDF ou un fichier dans un onglet. */
export function MediasMessage({ medias, petit = false }: { medias: Media[]; petit?: boolean }) {
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
            <li key={m.chemin}>
              <button type="button" onClick={ouvrir} data-testid="media" data-genre={genre} title={`${m.nom} · ${tailleLisible(m.taille)}`}
                className={`flex ${taille} items-center justify-center overflow-hidden rounded-lg border border-bord bg-carte-2`}>
                {url && genre === 'image' ? <img src={url} alt={m.nom} loading="lazy" className="h-full w-full object-cover" />
                  : url && genre === 'video' ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  : <span className="px-1 text-center text-[10px] leading-tight text-texte-2">{ICONE_MEDIA[genre]}<br />{m.nom.slice(0, 14)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
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
