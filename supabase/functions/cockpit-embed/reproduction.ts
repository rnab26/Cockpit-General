/**
 * reproduction.ts — ce qui permet de rejouer une demande d'utilisateur (D-05).
 *
 * POURQUOI : Raphaël (D-05, « Idées à instruire » n°1) : « à la création
 * d'une demande, capturer ce qui permet de la reproduire (réglages, entrées,
 * suite d'actions), et proposer un bouton « rejouer » ». Le module embarqué
 * (embed/cockpit-embed.js) joint à chaque demande ou correction : la page, le
 * titre, l'écran, l'appareil, la langue, l'heure, la version servie, les 20
 * dernières actions (libellés, JAMAIS une valeur saisie) et les 5 dernières
 * erreurs JavaScript. Cette fonction ne fait pas confiance au navigateur :
 * n'importe qui peut poster n'importe quoi avec la clé publique du projet.
 * Donc ici, tout est REFAIT : liste blanche des champs, types, longueurs,
 * nombre d'éléments, taille totale, et nettoyage des adresses et des textes
 * (jetons, mots de passe, e-mails) — même si le module l'a déjà fait.
 *
 * Aucune dépendance (ni Deno, ni supabase-js) : les tests purs
 * (app/scripts/verifier-reproduction.ts) l'importent depuis Node, et
 * comparent `nettoyerUrl` / `masquerSecrets` à la COPIE du module embarqué
 * (bloc `<nettoyer-url>`) sur les mêmes cas.
 */

export const REPRO_VERSION = 1
export const REPRO_MAX_ACTIONS = 20
export const REPRO_MAX_ERREURS = 5
/** Taille maximale du JSON stocké (caractères). Au-delà : on retire les plus vieilles actions. */
export const REPRO_MAX_OCTETS = 12_000

// <nettoyer-url> — même règle que le bloc du même nom dans embed/cockpit-embed.js.
/** Noms de paramètres qui portent un secret ou une donnée personnelle. */
const NOM_SECRET = /(^|[_\-.])(token|jeton|key|cle|clef|secret|password|passwd|pass|pwd|mdp|auth|authorization|code|session|sessionid|sid|jwt|signature|sig|otp|apikey|access|refresh|credential|credentials|nonce|state|email|mail|tel|phone|telephone)([_\-.]|$)/i
/** Une longue suite sans espace mêlant lettres ET chiffres (24 caractères ou plus) : un jeton, pas un mot. */
function aleatoire(mot: string): boolean {
  return mot.length >= 24 && /[0-9]/.test(mot) && /[A-Za-z]/.test(mot)
}
/** Une valeur qui ressemble à un secret : jeton JWT, e-mail, ou longue suite aléatoire.
 * Un identifiant (uuid) ou un nom lisible (« rapport-2026-09-29-clients ») reste. */
function valeurSecrete(v: string): boolean {
  if (/^eyJ[\w-]+\.[\w-]+/.test(v)) return true
  if (/[^@\s/]+@[^@\s/]+\.[a-z]{2,}/i.test(v)) return true
  return (v.match(/[A-Za-z0-9_]{24,}/g) || []).some(aleatoire)
}
function nettoyerParams(qs: string): string {
  const garde: string[] = []
  for (const morceau of qs.split('&')) {
    if (!morceau) continue
    const i = morceau.indexOf('=')
    const nom = i < 0 ? morceau : morceau.slice(0, i)
    const brute = i < 0 ? '' : morceau.slice(i + 1)
    let nomLu = nom, valeur = brute
    try { nomLu = decodeURIComponent(nom.replace(/\+/g, ' ')) } catch { /* garde tel quel */ }
    try { valeur = decodeURIComponent(brute.replace(/\+/g, ' ')) } catch { /* garde tel quel */ }
    if (NOM_SECRET.test(nomLu) || valeurSecrete(valeur)) continue
    garde.push(morceau)
  }
  return garde.join('&')
}
function nettoyerChemin(chemin: string): string {
  return chemin.split('/').map((s) => {
    let lu = s
    try { lu = decodeURIComponent(s) } catch { /* garde tel quel */ }
    return valeurSecrete(lu) ? '(retire)' : s
  }).join('/')
}
/** Une adresse sans rien de secret : ni identifiant:mot de passe, ni jeton dans
 * les paramètres, le fragment (#access_token=…) ou le chemin. `null` si ce
 * n'est pas une adresse http(s) lisible. */
export function nettoyerUrl(brut: unknown): string | null {
  if (typeof brut !== 'string' || !brut.trim()) return null
  let u: URL
  try { u = new URL(brut.trim()) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.username = ''
  u.password = ''
  const chemin = nettoyerChemin(u.pathname)
  const qs = nettoyerParams(u.search.replace(/^\?/, ''))
  let fragment = u.hash.replace(/^#/, '')
  if (fragment) {
    const q = fragment.indexOf('?')
    if (q >= 0) {
      const p = nettoyerParams(fragment.slice(q + 1))
      fragment = nettoyerChemin(fragment.slice(0, q)) + (p ? '?' + p : '')
    } else if (fragment.includes('=')) {
      fragment = nettoyerParams(fragment)
    } else {
      fragment = nettoyerChemin(fragment)
    }
  }
  let out = u.origin + chemin + (qs ? '?' + qs : '') + (fragment ? '#' + fragment : '')
  if (out.length > 500) out = u.origin + chemin
  return out.length > 500 ? u.origin : out
}
/** Un texte libre (message d'erreur, libellé) sans jeton, e-mail ni adresse secrète. */
export function masquerSecrets(texte: unknown, max: number): string {
  if (typeof texte !== 'string') return ''
  let t = texte.replace(/\s+/g, ' ').trim()
  t = t.replace(/https?:\/\/[^\s"'<>]+/g, (m) => nettoyerUrl(m) ?? '(adresse)')
  t = t.replace(/eyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, '(retire)')
  t = t.replace(/[^@\s"'<>()]+@[^@\s"'<>()]+\.[a-z]{2,}/gi, '(e-mail)')
  t = t.replace(/[A-Za-z0-9_]{24,}/g, (mot) => aleatoire(mot) ? '(retire)' : mot)
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
// </nettoyer-url>

// ------------------------------------------------------------------ bornage

export type ActionRepro = { t: string | null; type: 'page' | 'clic' | 'saisie'; quoi: string; libelle: string }
export type ErreurRepro = { t: string | null; message: string; source: string }
export type Reproduction = {
  v: number
  contexte: 'creation' | 'correction'
  page: { url: string | null; titre: string }
  ecran: { largeur: number | null; hauteur: number | null; ratio: number | null }
  appareil: { resume: string; ua: string; tactile: boolean | null }
  langue: string
  fuseau: string
  heure: string | null
  version: string | null
  actions: ActionRepro[]
  erreurs: ErreurRepro[]
  recu_at: string
}

function objet(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}
function court(v: unknown, max: number): string {
  return masquerSecrets(v, max)
}
function entier(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null
}
function date(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** La reproduction envoyée par le navigateur, bornée et nettoyée ; `null` si
 * elle est absente ou inutilisable (jamais une erreur : une demande ne doit
 * jamais échouer à cause de sa capture). */
export function bornerReproduction(brut: unknown, contexte: 'creation' | 'correction', maintenant: Date = new Date()): Reproduction | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null
  const r = brut as Record<string, unknown>
  const page = objet(r.page), ecran = objet(r.ecran), appareil = objet(r.appareil)
  const actions: ActionRepro[] = (Array.isArray(r.actions) ? r.actions : []).slice(-REPRO_MAX_ACTIONS).map((a) => {
    const o = objet(a)
    const type = o.type === 'page' || o.type === 'clic' || o.type === 'saisie' ? o.type : null
    if (!type) return null
    const libelle = type === 'page' ? (nettoyerUrl(o.libelle) ?? '') : court(o.libelle, 120)
    return { t: date(o.t), type, quoi: court(o.quoi, 30), libelle }
  }).filter((a): a is ActionRepro => a !== null && (a.libelle !== '' || a.quoi !== ''))
  const erreurs: ErreurRepro[] = (Array.isArray(r.erreurs) ? r.erreurs : []).slice(-REPRO_MAX_ERREURS).map((e) => {
    const o = objet(e)
    return { t: date(o.t), message: court(o.message, 300), source: court(o.source, 300) }
  }).filter((e) => e.message !== '')
  const tactile = typeof appareil.tactile === 'boolean' ? appareil.tactile : null
  const version = court(r.version, 64) || null
  const sortie: Reproduction = {
    v: REPRO_VERSION,
    contexte,
    page: { url: nettoyerUrl(page.url), titre: court(page.titre, 200) },
    ecran: { largeur: entier(ecran.largeur, 1, 20000), hauteur: entier(ecran.hauteur, 1, 20000), ratio: entier(ecran.ratio, 0.1, 10) },
    appareil: { resume: court(appareil.resume, 80), ua: court(appareil.ua, 300), tactile },
    langue: court(r.langue, 20),
    fuseau: court(r.fuseau, 60),
    heure: date(r.heure),
    version,
    actions,
    erreurs,
    recu_at: maintenant.toISOString(),
  }
  if (!sortie.page.url && !sortie.page.titre && !actions.length && !erreurs.length && !sortie.appareil.ua) return null
  while (JSON.stringify(sortie).length > REPRO_MAX_OCTETS && sortie.actions.length) sortie.actions.shift()
  while (JSON.stringify(sortie).length > REPRO_MAX_OCTETS && sortie.erreurs.length) sortie.erreurs.shift()
  return sortie
}
