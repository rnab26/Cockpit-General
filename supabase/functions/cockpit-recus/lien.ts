/**
 * lien.ts — le PDF du lien « Download invoice » d'un mail de reçu (14 oct. 2026, chantier 72a8d0f4).
 *
 * C'est le secours de la pièce jointe : la fonction ouvre elle-même ce lien, donc UNE adresse venue d'un mail décide d'où elle va. Trois
 * garde-fous, tous prouvés hors ligne par app/scripts/verifier-recus-regle.ts avec un faux réseau :
 *   1. l'adresse de départ est `https://pay.stripe.com/invoice/…` et rien d'autre (`lienPdfAccepte`) ;
 *   2. les redirections sont suivies UNE PAR UNE (`redirect: "manual"`), 4 au plus, et chacune doit rester chez `stripe.com` en https
 *      (`hoteStripe`) : jamais un autre site, jamais un retour en http ;
 *   3. 25 secondes au total, 5 Mo au plus lus en flux (la taille annoncée ne suffit pas), aucun en-tête d'identité envoyé.
 * Ne lève jamais : la raison de l'échec est rendue. Un lien qui expire n'est pas une erreur (voir verdictPdf dans traiter.ts).
 * `ouvrir` (le vrai `fetch` par défaut) est injectable pour les tests.
 */
import { PDF_TAILLE_MAX, hoteStripe, lienPdfAccepte } from './regle.ts'
import type { LienPdf } from './traiter.ts'

export type Ouvrir = (adresse: string, options: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>

export const SAUTS_MAX = 4
export const DELAI_LIEN_MS = 25_000
const TROP_GROS = 'le PDF est trop gros (5 Mo au plus)'

/** Les premiers octets d'une réponse refusée (pour reconnaître « expired »), sans jamais lire un corps entier. */
async function debutDuCorps(r: Response, max = 200): Promise<string> {
  const lecteur = r.body?.getReader()
  if (!lecteur) return ''
  const morceaux: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await lecteur.read()
      if (done || !value) break
      morceaux.push(value)
      total += value.length
    }
  } finally {
    await lecteur.cancel().catch(() => {})
  }
  const tout = new Uint8Array(total)
  let pos = 0
  for (const m of morceaux) { tout.set(m, pos); pos += m.length }
  return new TextDecoder().decode(tout)
}

export async function pdfDuLienStripe(lien: string, ouvrir: Ouvrir = (a, o) => fetch(a, o), delaiMs = DELAI_LIEN_MS): Promise<LienPdf> {
  if (!lienPdfAccepte(lien)) return { raison: "lien du PDF inattendu (seul pay.stripe.com est accepté)" }
  const signal = AbortSignal.timeout(delaiMs)
  let adresse = lien
  try {
    for (let saut = 0; saut <= SAUTS_MAX; saut++) {
      const r = await ouvrir(adresse, { redirect: 'manual', signal, headers: { accept: 'application/pdf' } })
      if (r.status >= 300 && r.status < 400) {
        const suite = r.headers.get('location')
        await r.body?.cancel().catch(() => {})
        if (!suite) return { raison: 'redirection sans adresse' }
        if (saut === SAUTS_MAX) return { raison: 'trop de redirections' }
        adresse = new URL(suite, adresse).toString()
        if (!hoteStripe(adresse)) return { raison: 'redirection hors de Stripe refusée' }
        continue
      }
      if (r.status !== 200) {
        const debut = (await debutDuCorps(r)).slice(0, 80).toLowerCase()
        return { raison: debut.includes('expired') ? 'lien expiré' : `PDF refusé par Stripe (HTTP ${r.status})` }
      }
      if (Number(r.headers.get('content-length') ?? 0) > PDF_TAILLE_MAX) { await r.body?.cancel().catch(() => {}); return { raison: TROP_GROS } }
      const lecteur = r.body?.getReader()
      if (!lecteur) return { raison: 'réponse vide' }
      const morceaux: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await lecteur.read()
        if (done) break
        total += value.length
        if (total > PDF_TAILLE_MAX) { await lecteur.cancel().catch(() => {}); return { raison: TROP_GROS } }
        morceaux.push(value)
      }
      const octets = new Uint8Array(total)
      let pos = 0
      for (const m of morceaux) { octets.set(m, pos); pos += m.length }
      return { octets }
    }
    return { raison: 'trop de redirections' }
  } catch {
    return { raison: 'téléchargement impossible' }
  }
}
