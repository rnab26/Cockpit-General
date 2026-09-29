// « Pour reproduire » (D-05) : ce que le module embarqué a capturé quand un
// utilisateur a envoyé une demande ou une correction (colonne
// chantiers.reproduction, écrite par la fonction serveur cockpit-embed après
// tri et bornage : supabase/functions/cockpit-embed/reproduction.ts), lu en
// mots simples pour la fiche du chantier. Décisions pures, vérifiées par
// scripts/verifier-reproduction.ts.
//
// Le bouton « Rejouer » ouvre la page d'origine (adresse déjà nettoyée de
// ses jetons). Rejouer les clics tout seul et le « test synthétique » ne sont
// PAS faits (v1) : les étapes sont écrites pour qu'un humain ou une session
// les refasse.

export interface EtapeRepro { quand: string | null; texte: string }

export interface VueReproduction {
  /** « Lors de la demande » ou « Lors de la correction ». */
  moment: string
  pageTitre: string
  /** Adresse nettoyée, http(s) seulement ; null s'il n'y en a pas (pas de bouton « Rejouer »). */
  url: string | null
  /** « iPhone · Safari 17 — écran 390 × 844 ». */
  appareil: string
  langue: string
  heure: string | null
  version: string | null
  etapes: EtapeRepro[]
  erreurs: string[]
}

function objet(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}
function chaine(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Une adresse qu'on peut ouvrir sans risque : http(s) seulement (jamais javascript:, data:…). */
export function urlOuvrable(v: unknown): string | null {
  const s = chaine(v)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch { return null }
}

/** Le chemin d'une adresse de la même origine que la page (« /clients?tri=date »), sinon l'adresse entière. */
function cheminLisible(url: string, origine: string | null): string {
  try {
    const u = new URL(url)
    return origine && u.origin === origine ? (u.pathname + u.search + u.hash) || '/' : url
  } catch { return url }
}

/** Une action du journal en une phrase (« Touche le bouton « Exporter » »). */
export function actionEnMots(a: { type?: unknown; quoi?: unknown; libelle?: unknown }, origine: string | null = null): string | null {
  const libelle = chaine(a.libelle)
  const quoi = chaine(a.quoi)
  if (a.type === 'page') return libelle ? `Ouvre la page ${cheminLisible(libelle, origine)}` : null
  if (a.type === 'saisie') return `Remplit le champ « ${libelle || 'sans nom'} »`
  if (a.type !== 'clic') return null
  const l = libelle ? ` « ${libelle} »` : ''
  switch (quoi) {
    case 'lien': return `Touche le lien${l}`
    case 'case': return `Coche ou décoche${l || ' une case'}`
    case 'champ': return `Touche le champ${l}`
    case 'onglet': return `Ouvre l'onglet${l}`
    default: return `Touche le bouton${l}`
  }
}

/** La reproduction d'un chantier, prête à afficher ; null s'il n'y en a pas (ou si elle est illisible). */
export function lireReproduction(v: unknown): VueReproduction | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  const page = objet(r.page), ecran = objet(r.ecran), appareil = objet(r.appareil)
  const url = urlOuvrable(page.url)
  let origine: string | null = null
  try { origine = url ? new URL(url).origin : null } catch { origine = null }
  const etapes: EtapeRepro[] = []
  for (const a of Array.isArray(r.actions) ? r.actions : []) {
    const o = objet(a)
    const texte = actionEnMots(o, origine)
    if (!texte) continue
    // Deux fois la même phrase d'affilée (double toucher) : une seule étape.
    if (etapes.length && etapes[etapes.length - 1].texte === texte) continue
    etapes.push({ quand: chaine(o.t) || null, texte })
  }
  const erreurs = (Array.isArray(r.erreurs) ? r.erreurs : [])
    .map((e) => chaine(objet(e).message)).filter(Boolean)
  const largeur = typeof ecran.largeur === 'number' ? ecran.largeur : null
  const hauteur = typeof ecran.hauteur === 'number' ? ecran.hauteur : null
  const resume = chaine(appareil.resume)
  const appareilTexte = [resume, largeur && hauteur ? `écran ${Math.round(largeur)} × ${Math.round(hauteur)}` : '']
    .filter(Boolean).join(' — ')
  const vue: VueReproduction = {
    moment: r.contexte === 'correction' ? 'Lors de la correction' : 'Lors de la demande',
    pageTitre: chaine(page.titre),
    url,
    appareil: appareilTexte,
    langue: chaine(r.langue),
    heure: chaine(r.heure) || chaine(r.recu_at) || null,
    version: chaine(r.version) || null,
    etapes,
    erreurs,
  }
  if (!vue.url && !vue.pageTitre && !vue.appareil && !etapes.length && !erreurs.length) return null
  return vue
}
