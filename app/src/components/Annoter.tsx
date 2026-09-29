import { useCallback, useEffect, useRef, useState } from 'react'
import { Brush, Eraser, Undo2 } from 'lucide-react'
import { useConfirmer } from '../ui/Confirm.tsx'
import { CONFIRMER_ABANDON } from '../ui/Modale.ts'
import {
  COULEURS_ANNOTATION, DESSIN_VIDE, ajouterTrait, annulerGeste, dimensionsSortie, largeurTrait, nomAnnote,
  toutEffacer, typeSortie, versImage, type Epaisseur, type Trait,
} from '../lib/annotation.ts'

/**
 * Le crayon sur une image jointe (29 sept. 2026), comme celui d'une capture
 * d'écran de téléphone : l'image en plein écran, on dessine au doigt, puis
 * « Enregistrer » rend une NOUVELLE image (le parent décide : remplacer la
 * pièce avant l'envoi, ou l'envoyer comme nouvelle pièce). « Annuler » ferme
 * sans rien changer. Un simple <canvas>, aucune librairie.
 */
export function Annoter({ nom, type, charger, onFermer, onEnregistrer }: {
  nom: string
  type: string
  /** Le fichier d'origine (local, ou téléchargé du stockage : jamais une URL d'un autre domaine, qui « salirait » le canvas). */
  charger: () => Promise<Blob>
  onFermer: () => void
  /** Renvoie null si c'est fait (le parent ferme alors), sinon le message d'erreur, affiché ici. */
  onEnregistrer: (fichier: File) => Promise<string | null>
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const toile = useRef<HTMLCanvasElement>(null)
  const image = useRef<HTMLImageElement | null>(null)
  const trait = useRef<Trait | null>(null)
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'illisible'>('chargement')
  const [dessin, setDessin] = useState(DESSIN_VIDE)
  const [couleur, setCouleur] = useState<string>(COULEURS_ANNOTATION[0].valeur)
  const [epaisseur, setEpaisseur] = useState<Epaisseur>('fin')
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  // Le parent peut passer des fonctions recréées à chaque rendu : on garde la dernière, sans rouvrir ni recharger.
  const fermer = useRef(onFermer); fermer.current = onFermer
  const source = useRef(charger); source.current = charger

  // Plein écran au-dessus de tout (y compris d'une conversation déjà ouverte en <dialog>).
  // Pas de fond à toucher (on dessine partout) ; Échap ferme, mais demande si un dessin serait perdu (ui/Modale.ts).
  const confirmer = useConfirmer()
  const aDessine = useRef(false); aDessine.current = dessin.traits.length > 0
  useEffect(() => {
    const d = dlg.current
    if (d && !d.open) d.showModal()
    const onCancel = (e: Event) => {
      e.preventDefault()
      if (!aDessine.current) { fermer.current(); return }
      void confirmer({ ...CONFIRMER_ABANDON, titre: 'Quitter sans garder le dessin ?', texte: 'Ton dessin n’est pas enregistré. Si tu quittes, il sera perdu.', libelleOk: 'Quitter sans garder' })
        .then((ok) => { if (ok) fermer.current() })
    }
    d?.addEventListener('cancel', onCancel)
    return () => { d?.removeEventListener('cancel', onCancel); if (d?.open) d.close() }
  }, [confirmer])

  useEffect(() => {
    let vivant = true, url: string | null = null
    source.current().then((blob) => {
      if (!vivant) return
      url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        if (!vivant) return
        const c = toile.current
        const { largeur, hauteur } = dimensionsSortie(img.naturalWidth, img.naturalHeight)
        if (c) { c.width = largeur; c.height = hauteur }
        image.current = img
        setEtat('pret')
      }
      img.onerror = () => { if (vivant) setEtat('illisible') }
      img.src = url
    }).catch(() => { if (vivant) setEtat('illisible') })
    return () => { vivant = false; if (url) URL.revokeObjectURL(url) }
  }, [])

  const peindre = useCallback((ctx: CanvasRenderingContext2D, t: Trait, depuis = 0) => {
    const c = ctx.canvas
    ctx.strokeStyle = t.couleur; ctx.fillStyle = t.couleur
    ctx.lineWidth = largeurTrait(t.epaisseur, c.width, c.height)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const pts = t.points
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); return }
    ctx.beginPath()
    const d = Math.max(0, depuis - 1)
    ctx.moveTo(pts[d].x, pts[d].y)
    for (let i = d + 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
  }, [])

  // Tout redessiner (image + traits) : après « annuler », « tout effacer », ou au chargement.
  useEffect(() => {
    const c = toile.current, img = image.current
    const ctx = c?.getContext('2d')
    if (!c || !img || !ctx || etat !== 'pret') return
    ctx.drawImage(img, 0, 0, c.width, c.height)
    for (const t of dessin.traits) peindre(ctx, t)
  }, [dessin, etat, peindre])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    return versImage(e.clientX, e.clientY, c.getBoundingClientRect(), c.width, c.height)
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (etat !== 'pret' || enregistrement) return
    e.currentTarget.setPointerCapture(e.pointerId)
    trait.current = { couleur, epaisseur, points: [point(e)] }
    const ctx = e.currentTarget.getContext('2d')
    if (ctx) peindre(ctx, trait.current)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = trait.current
    if (!t) return
    t.points.push(point(e))
    const ctx = e.currentTarget.getContext('2d')
    if (ctx) peindre(ctx, t, t.points.length - 1)
  }
  const onUp = () => {
    const t = trait.current
    trait.current = null
    if (t) setDessin((d) => ajouterTrait(d, t))
  }

  const enregistrer = async () => {
    const c = toile.current
    if (!c || !dessin.traits.length) return
    setEnregistrement(true); setErreur(null)
    const t = typeSortie(type)
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, t, 0.9))
    const err = blob ? await onEnregistrer(new File([blob], nomAnnote(nom, t), { type: t })) : 'l’image n’a pas pu être produite.'
    setEnregistrement(false)
    if (err) setErreur(err)
  }

  const btn = 'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-white disabled:opacity-35'
  const outil = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-35'
  return (
    <dialog ref={dlg} data-testid="annoter" aria-label={`Dessiner sur ${nom}`}
      className="m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-black p-0 text-white backdrop:bg-black">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 px-2 pt-[max(env(safe-area-inset-top),8px)] pb-2">
          <button type="button" onClick={onFermer} disabled={enregistrement} className={`${btn} hover:bg-white/10`} data-testid="annoter-annuler">Annuler</button>
          <p className="min-w-0 truncate text-sm text-white/70">{nom}</p>
          <button type="button" onClick={enregistrer} disabled={!dessin.traits.length || enregistrement || etat !== 'pret'} data-testid="annoter-enregistrer"
            className={`${btn} bg-white font-medium !text-black`}>
            {enregistrement ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" aria-hidden /> : null}
            {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        {erreur ? <p role="alert" data-testid="annoter-erreur" className="mx-3 mb-2 rounded-lg bg-red-600/90 px-3 py-2 text-sm">L’image annotée n’a pas été enregistrée : {erreur} Réessaie avec « Enregistrer ».</p> : null}
        <div className="flex min-h-0 flex-1 items-center justify-center px-2">
          {etat === 'chargement' ? <span className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" aria-label="Chargement de l’image…" /> : null}
          {etat === 'illisible' ? <p className="px-6 text-center text-sm text-white/80" data-testid="annoter-illisible">Cette image ne peut pas être ouverte ici (format non lu par ce navigateur). Rien n’a été changé.</p> : null}
          <canvas ref={toile} data-testid="annoter-toile" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            className={`max-h-full max-w-full touch-none select-none ${etat === 'pret' ? '' : 'hidden'}`} style={{ touchAction: 'none' }} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 px-2 pt-2 pb-[max(env(safe-area-inset-bottom),10px)]">
          {COULEURS_ANNOTATION.map((c) => (
            <button key={c.valeur} type="button" onClick={() => setCouleur(c.valeur)} aria-label={c.nom} aria-pressed={couleur === c.valeur} data-testid="annoter-couleur"
              className={`h-8 w-8 rounded-full border-2 ${couleur === c.valeur ? 'border-white ring-2 ring-white/50' : 'border-white/30'}`} style={{ background: c.valeur }} />
          ))}
          <span className="mx-0.5 h-6 w-px bg-white/20" aria-hidden />
          {(['fin', 'epais'] as const).map((ep) => (
            <button key={ep} type="button" onClick={() => setEpaisseur(ep)} aria-label={ep === 'fin' ? 'Trait fin' : 'Trait épais'} aria-pressed={epaisseur === ep}
              className={`${outil} ${epaisseur === ep ? 'bg-white/20' : ''}`}><Brush size={ep === 'fin' ? 14 : 20} aria-hidden /></button>
          ))}
          <span className="mx-0.5 h-6 w-px bg-white/20" aria-hidden />
          <button type="button" onClick={() => setDessin(annulerGeste)} disabled={!dessin.avant.length || enregistrement} aria-label="Annuler le dernier trait" title="Annuler le dernier trait" data-testid="annoter-defaire" className={outil}><Undo2 size={20} aria-hidden /></button>
          <button type="button" onClick={() => setDessin(toutEffacer)} disabled={!dessin.traits.length || enregistrement} aria-label="Tout effacer" title="Tout effacer" data-testid="annoter-effacer" className={outil}><Eraser size={20} aria-hidden /></button>
        </div>
      </div>
    </dialog>
  )
}
