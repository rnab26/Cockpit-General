// « Comment vérifier » (migration 0005) : le texte écrit par la session qui
// livre, pour la personne qui certifie depuis son téléphone. Deux décisions
// pures, vérifiées par scripts/verifier-comment-verifier.ts :
//  - découper le texte en ÉTAPES lisibles, une par ligne, même quand la
//    session a tout écrit sur une seule ligne (« 1. Ouvre… 2. Touche… ») ;
//  - repérer les liens http(s) pour les rendre cliquables.
//
// Le module embarqué (embed/cockpit-embed.js) en porte une COPIE en JS pur
// (il n'a pas d'étape de build) ; le test exécute les deux sur les mêmes cas
// et refuse qu'elles divergent.

export interface Etape {
  /** « 1 », « 2 »… ou null pour une ligne sans numéro. */
  numero: string | null
  texte: string
}

const MARQUEUR = /(^|\s)(\d{1,2})[.)]\s+/g

/**
 * Coupe une ligne avant chaque « N. » d'une suite NUMÉROTÉE : le premier
 * marqueur compte s'il ouvre la ligne ou vaut 1, les suivants seulement s'ils
 * valent le précédent + 1. Sans cette règle, « version 2. Puis » ou « à 10. »
 * au milieu d'une phrase couperait n'importe où.
 */
function couperLigne(ligne: string): Etape[] {
  const marques: { debut: number; fin: number; n: number }[] = []
  let attendu: number | null = null
  for (const m of ligne.matchAll(MARQUEUR)) {
    const n = Number(m[2])
    const debut = (m.index ?? 0) + m[1].length
    const fin = (m.index ?? 0) + m[0].length
    if (attendu === null) {
      if (debut !== 0 && n !== 1) continue
    } else if (n !== attendu) continue
    marques.push({ debut, fin, n })
    attendu = n + 1
  }
  if (!marques.length) return [{ numero: null, texte: ligne }]
  const etapes: Etape[] = []
  const avant = ligne.slice(0, marques[0].debut).trim()
  if (avant) etapes.push({ numero: null, texte: avant })
  marques.forEach((mq, i) => {
    const texte = ligne.slice(mq.fin, i + 1 < marques.length ? marques[i + 1].debut : undefined).trim()
    etapes.push({ numero: String(mq.n), texte })
  })
  return etapes
}

/** Le texte en étapes, une par ligne affichée. Lignes vides écartées. */
export function etapesVerifier(texte: string | null | undefined): Etape[] {
  const lignes = (texte ?? '').replace(/\r\n?/g, '\n').split('\n')
  const etapes: Etape[] = []
  for (const brute of lignes) {
    const ligne = brute.replace(/[ \t]+/g, ' ').trim()
    if (!ligne) continue
    etapes.push(...couperLigne(ligne))
  }
  return etapes
}

export type Segment = { lien: false; texte: string } | { lien: true; texte: string; url: string }

const URL_RE = /https?:\/\/[^\s<>"']+/g

/**
 * Découpe un texte en morceaux texte / lien. La ponctuation finale
 * (« va sur https://x.fr. ») n'appartient pas au lien ; une parenthèse
 * fermante non ouverte dans l'adresse non plus.
 */
export function segmentsAvecLiens(texte: string): Segment[] {
  const out: Segment[] = []
  let dernier = 0
  for (const m of texte.matchAll(URL_RE)) {
    let url = m[0]
    for (;;) {
      const fin = url.slice(-1)
      if (/[.,;:!?»\]]/.test(fin)) { url = url.slice(0, -1); continue }
      if (fin === ')' && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) { url = url.slice(0, -1); continue }
      break
    }
    const debut = m.index ?? 0
    if (debut > dernier) out.push({ lien: false, texte: texte.slice(dernier, debut) })
    out.push({ lien: true, texte: url, url })
    dernier = debut + url.length
  }
  if (dernier < texte.length) out.push({ lien: false, texte: texte.slice(dernier) })
  return out
}

/** Un lien à ouvrir d'un toucher, avec un nom lisible. */
export interface LienAOuvrir { url: string; libelle: string }

/**
 * Les adresses du texte, sans doublon, dans l'ordre, chacune avec un nom clair :
 * « PR n° 12 » pour une pull request GitHub, « Aperçu » pour une image/page de
 * simulation, sinon le nom du site. Raphaël ouvre sans chercher dans le texte.
 */
export function liensAOuvrir(texte: string | null | undefined): LienAOuvrir[] {
  const vus = new Set<string>()
  const res: LienAOuvrir[] = []
  for (const s of segmentsAvecLiens(texte ?? '')) {
    if (!s.lien || vus.has(s.url)) continue
    vus.add(s.url)
    let libelle = s.url
    try {
      const u = new URL(s.url)
      const pr = u.hostname === 'github.com' ? u.pathname.match(/\/pull\/(\d+)/) : null
      libelle = pr ? `PR n° ${pr[1]}` : /\.(png|jpe?g|webp|gif)$/i.test(u.pathname) ? 'Image à voir' : u.hostname.replace(/^www\./, '')
    } catch { continue }
    res.push({ url: s.url, libelle })
  }
  return res
}

/** Le message écrit dans le fil quand la personne qui certifie demande
 *  « comment vérifier ». `kind='info'` (pas 'question') : une question
 *  finirait dans SES PROPRES « questions en attente ». */
export const QUESTION_VERIFIER = 'comment vérifier ce chantier ? (étapes, où aller, ce que je dois voir)'
export function corpsDemandeVerifier(qui: string): string {
  return `${qui} demande : ${QUESTION_VERIFIER}`
}

/** La dernière demande « comment vérifier » faite depuis la livraison (pour
 *  dire « déjà demandé il y a 5 min » au lieu d'en empiler une seconde). */
export function derniereDemandeVerifier<M extends { corps: string; created_at: string; kind: string }>(
  fil: M[], livreAt: string | null,
): M | null {
  let res: M | null = null
  for (const m of fil) {
    if (m.kind !== 'info' || !m.corps.endsWith(QUESTION_VERIFIER)) continue
    if (livreAt && Date.parse(m.created_at) < Date.parse(livreAt)) continue
    if (!res || Date.parse(m.created_at) > Date.parse(res.created_at)) res = m
  }
  return res
}
