/**
 * `fetch` du client Supabase qui ne perd rien (5 oct. 2026, chantier 5b68a493).
 *
 * - ÉCRITURE (règle : lib/fileAttente.ts) : si le réseau est absent (ou le
 *   serveur en 502/503/504), elle est gardée dans IndexedDB, l'appelant reçoit
 *   une réponse de succès fabriquée, le bandeau dit « en attente », et la file
 *   repart dans l'ordre au retour du réseau (événement `online`, retour sur
 *   l'onglet, minuterie, bouton). Tant que la file n'est pas vide, les
 *   nouvelles écritures y passent aussi : l'ordre est conservé.
 * - LECTURE d'une table : la dernière réponse est gardée ; sans réseau, c'est
 *   elle qui est servie (écran de données à jour de la dernière connexion).
 * - Tout le reste (connexion, jetons) passe sans y toucher.
 */
import {
  aGarder, aMettreEnCache, apercuDe, avecIdentifiant, cibleDe, classerReponse, delaiReessai, estPanneServeur,
  reponseGardee, resumeDe, type CorpsStocke, type ElementFile,
} from './fileAttente.ts'
import * as stock from './fileAttenteStockage.ts'

export interface EtatFile {
  elements: ElementFile[]
  attente: number
  refuses: number
  horsLigne: boolean
  envoi: boolean
  /** Heure de la dernière lecture servie depuis l'appareil (hors ligne), sinon null. */
  donneesDu: number | null
  durable: boolean
}

const ecouteurs = new Set<() => void>()
let elements: ElementFile[] = []
let horsLigne = typeof navigator !== 'undefined' && navigator.onLine === false
let envoi = false
let donneesDu: number | null = null
let instantane: EtatFile = calculer()
let fournisseurSession: (() => Promise<{ token: string; uid: string } | null>) | null = null
let echecsDeSuite = 0
let minuterie: number | null = null
let charge: Promise<void> | null = null
let dernierGarde = 0
/** Une écriture vient d'être gardée (4 s) : les messages « envoyé » doivent le dire. */
export const gardeRecemment = () => Date.now() - dernierGarde < 4000

function calculer(): EtatFile {
  return {
    elements,
    attente: elements.filter((e) => e.statut === 'attente').length,
    refuses: elements.filter((e) => e.statut === 'refuse').length,
    horsLigne, envoi, donneesDu, durable: stock.durable(),
  }
}
function changer() {
  instantane = calculer()
  ecouteurs.forEach((f) => f())
  planifier()
}
export const abonner = (f: () => void) => { ecouteurs.add(f); return () => { ecouteurs.delete(f) } }
export const etatFile = () => instantane

/** À appeler une fois, après la création du client : comment obtenir le jeton courant. */
export function fournirSession(f: () => Promise<{ token: string; uid: string } | null>) {
  fournisseurSession = f
  void chargerFile().then(() => { void envoyerFile() })
}

function chargerFile(): Promise<void> {
  if (!charge) {
    charge = stock.tout<ElementFile>('file').then((l) => {
      const ids = new Set(elements.map((e) => e.id))
      elements = [...l.filter((e) => !ids.has(e.id)), ...elements].sort((a, b) => a.ajoute - b.ajoute)
      changer()
    })
  }
  return charge
}

function uidDe(entetes: Headers): string | null {
  try {
    const a = entetes.get('authorization') ?? ''
    const jwt = a.replace(/^Bearer\s+/i, '').split('.')[1]
    if (!jwt) return null
    const json = JSON.parse(atob(jwt.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }
    return json.sub ?? null
  } catch { return null }
}

async function corpsStocke(corps: BodyInit | null | undefined): Promise<CorpsStocke | null | 'illisible'> {
  if (corps == null) return null
  if (typeof corps === 'string') return { type: 'texte', v: corps }
  if (corps instanceof Blob) return { type: 'blob', v: corps }
  if (corps instanceof FormData) return { type: 'formdata', v: [...corps.entries()] as [string, string | Blob][] }
  if (corps instanceof ArrayBuffer || ArrayBuffer.isView(corps)) return { type: 'blob', v: new Blob([corps as BlobPart]) }
  if (corps instanceof URLSearchParams) return { type: 'texte', v: corps.toString() }
  return 'illisible'
}

function corpsPourEnvoi(c: CorpsStocke | null): BodyInit | undefined {
  if (!c) return undefined
  if (c.type === 'texte') return c.v
  if (c.type === 'blob') return c.v
  const f = new FormData()
  for (const [k, v] of c.v) f.append(k, v)
  return f
}

async function garder(url: string, methode: string, init: RequestInit | undefined): Promise<Response | null> {
  const entetes = new Headers(init?.headers)
  const corps = await corpsStocke(init?.body as BodyInit | null | undefined)
  if (corps === 'illisible') return null
  const genre = cibleDe(url).genre
  const c = corps
  const prefer = entetes.get('prefer') ?? ''
  const uid = uidDe(entetes)
  entetes.delete('authorization')
  const el: ElementFile = {
    id: crypto.randomUUID(), ajoute: Date.now(), uid, methode, url,
    entetes: [...entetes.entries()], corps: c, essais: 0, statut: 'attente',
    resume: resumeDe(methode, url), apercu: apercuDe(c && c.type === 'texte' ? c.v : null, genre),
  }
  elements = [...elements, el]
  dernierGarde = Date.now()
  changer()
  await stock.poser('file', el)
  changer()
  const r = reponseGardee(methode, url, c && c.type === 'texte' ? c.v : null, prefer)
  return new Response(r.corps, { status: r.status, headers: r.corps ? { 'content-type': 'application/json' } : {} })
}

async function ecrire(input: RequestInfo | URL, init0: RequestInit | undefined, url: string, methode: string): Promise<Response> {
  // L'identifiant est fixé AVANT la première tentative : si elle arrive sans que la réponse revienne,
  // le renvoi tombe sur la même clé (409 = déjà fait) au lieu de créer un doublon.
  let init = init0
  if (typeof init0?.body === 'string') {
    const corps = avecIdentifiant(url, methode, init0.body, () => crypto.randomUUID())
    if (corps !== null && corps !== init0.body) init = { ...init0, body: corps }
  }
  await chargerFile()
  const bloque = elements.some((e) => e.statut === 'attente')
  if (!bloque) {
    try {
      const r = await fetch(input, init)
      if (!estPanneServeur(r.status)) { if (horsLigne) { horsLigne = false; changer() } return r }
    } catch (e) {
      if (init?.signal?.aborted) throw e
    }
    horsLigne = true
  }
  const gardee = await garder(url, methode, init)
  if (!gardee) return fetch(input, init) // corps illisible (flux) : comportement d'origine
  changer()
  if (!bloque) planifier()
  else void envoyerFile()
  return gardee
}

async function lireAvecCache(input: RequestInfo | URL, init: RequestInit | undefined, url: string): Promise<Response> {
  const entetes = new Headers(init?.headers)
  const corpsCle = typeof init?.body === 'string' ? init.body : ''
  const cle = `${uidDe(entetes) ?? 'anon'}|${entetes.get('accept') ?? ''}|${url}|${corpsCle}`
  try {
    const r = await fetch(input, init)
    if (r.ok) {
      if (horsLigne || donneesDu) { horsLigne = false; donneesDu = null; changer() }
      void r.clone().text().then((texte) => stock.poser('cache', {
        t: Date.now(), texte, type: r.headers.get('content-type') ?? 'application/json', plage: r.headers.get('content-range'),
      }, cle))
    }
    return r
  } catch (e) {
    if (init?.signal?.aborted) throw e
    const c = await stock.lire<{ t: number; texte: string; type: string; plage: string | null }>('cache', cle)
    if (!c) { horsLigne = true; changer(); throw e }
    horsLigne = true; donneesDu = c.t; changer()
    const h: Record<string, string> = { 'content-type': c.type, 'x-cockpit-hors-ligne': String(c.t) }
    if (c.plage) h['content-range'] = c.plage
    return new Response(c.texte, { status: 200, headers: h })
  }
}

export const fetchResilient: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const methode = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
  if (typeof input === 'object' && !(input instanceof URL)) return fetch(input, init)
  if (aGarder(methode, url)) return ecrire(input, init, url, methode)
  if (aMettreEnCache(methode, url)) return lireAvecCache(input, init, url)
  return fetch(input, init)
}

/* ---------------------------------------------------------------- renvoi */

async function enregistrer(el: ElementFile) { await stock.poser('file', el) }

/** Renvoie la file dans l'ordre. S'arrête à la première panne (l'ordre compte). */
export async function envoyerFile(): Promise<void> {
  if (envoi || !fournisseurSession) return
  await chargerFile()
  if (!elements.some((e) => e.statut === 'attente')) { echecsDeSuite = 0; return }
  envoi = true; changer()
  let envoyes = 0
  try {
    const s = await fournisseurSession()
    if (!s) return
    for (const el of [...elements].sort((a, b) => a.ajoute - b.ajoute)) {
      if (el.statut !== 'attente') continue
      if (el.uid && el.uid !== s.uid) continue // écrit sous un autre compte : attend ce compte
      const entetes = new Headers(el.entetes)
      entetes.set('authorization', `Bearer ${s.token}`)
      let r: Response
      try {
        r = await fetch(el.url, { method: el.methode, headers: entetes, body: corpsPourEnvoi(el.corps) })
      } catch {
        horsLigne = true; echecsDeSuite++
        el.essais++; await enregistrer(el)
        return
      }
      const issue = classerReponse(r.status)
      if (issue === 'fait') {
        elements = elements.filter((x) => x.id !== el.id)
        await stock.retirer('file', el.id)
        envoyes++; echecsDeSuite = 0; horsLigne = false
        changer()
      } else if (issue === 'reessayer') {
        el.essais++; await enregistrer(el); echecsDeSuite++
        return
      } else {
        const texte = (await r.text().catch(() => '')).slice(0, 300)
        const maj: ElementFile = { ...el, statut: 'refuse', raison: `Refusé (${r.status}) ${texte}`.trim(), essais: el.essais + 1 }
        elements = elements.map((x) => (x.id === el.id ? maj : x))
        await enregistrer(maj)
        changer()
      }
    }
  } finally {
    envoi = false; changer()
    if (envoyes > 0) window.dispatchEvent(new CustomEvent('cockpit-file-envoyee', { detail: { n: envoyes } }))
  }
}

export async function reessayerElement(id: string) {
  const el = elements.find((e) => e.id === id)
  if (!el) return
  const maj: ElementFile = { ...el, statut: 'attente', raison: undefined }
  elements = elements.map((e) => (e.id === id ? maj : e))
  await enregistrer(maj); changer()
  void envoyerFile()
}

/** Abandon : l'appelant a déjà obtenu la confirmation de l'utilisateur. */
export async function abandonnerElement(id: string) {
  elements = elements.filter((e) => e.id !== id)
  await stock.retirer('file', id); changer()
}

export const renvoyerMaintenant = () => envoyerFile()

function planifier() {
  if (typeof window === 'undefined') return
  const aEnvoyer = elements.some((e) => e.statut === 'attente')
  if (!aEnvoyer) { if (minuterie != null) { window.clearTimeout(minuterie); minuterie = null } return }
  if (minuterie != null || envoi) return
  minuterie = window.setTimeout(() => { minuterie = null; void envoyerFile().then(planifier) }, delaiReessai(echecsDeSuite || 1))
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { horsLigne = false; changer(); void envoyerFile() })
  window.addEventListener('offline', () => { horsLigne = true; changer() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void envoyerFile() })
  void stock.demanderStockagePersistant()
}
