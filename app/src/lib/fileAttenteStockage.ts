/**
 * Stockage durable de la file d'attente et du cache de lecture : IndexedDB
 * (garde aussi les fichiers joints). Si IndexedDB est refusé (fenêtre privée,
 * accès bloqué), repli en mémoire : la file marche tant que l'onglet vit, et
 * le bandeau le dit (`durable() === false`).
 */
const NOM = 'cockpit-hors-ligne'
const FILE = 'file'
const CACHE = 'cache'

let ouverture: Promise<IDBDatabase | null> | null = null
const memoire = { [FILE]: new Map<string, unknown>(), [CACHE]: new Map<string, unknown>() }
let durableOk = true

function ouvrir(): Promise<IDBDatabase | null> {
  if (ouverture) return ouverture
  ouverture = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { durableOk = false; resolve(null); return }
      const r = indexedDB.open(NOM, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        if (!db.objectStoreNames.contains(FILE)) db.createObjectStore(FILE, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE)
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => { durableOk = false; resolve(null) }
      r.onblocked = () => { durableOk = false; resolve(null) }
    } catch { durableOk = false; resolve(null) }
  })
  return ouverture
}

export const durable = () => durableOk

function requete<T>(db: IDBDatabase, magasin: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(magasin, mode)
      const r = f(t.objectStore(magasin))
      t.oncomplete = () => resolve(r.result as T)
      t.onerror = () => { durableOk = false; resolve(undefined) }
      t.onabort = () => { durableOk = false; resolve(undefined) }
    } catch { durableOk = false; resolve(undefined) }
  })
}

export async function poser(magasin: 'file' | 'cache', valeur: unknown, cle?: string): Promise<boolean> {
  const db = await ouvrir()
  const k = magasin === FILE ? (valeur as { id: string }).id : (cle as string)
  memoire[magasin].set(k, valeur)
  if (!db) return false
  const r = await requete(db, magasin, 'readwrite', (s) => (magasin === FILE ? s.put(valeur) : s.put(valeur, cle)))
  return r !== undefined
}

export async function lire<T>(magasin: 'file' | 'cache', cle: string): Promise<T | undefined> {
  const db = await ouvrir()
  if (db) {
    const r = await requete<T>(db, magasin, 'readonly', (s) => s.get(cle))
    if (r !== undefined) return r
  }
  return memoire[magasin].get(cle) as T | undefined
}

export async function tout<T>(magasin: 'file' | 'cache'): Promise<T[]> {
  const db = await ouvrir()
  if (db) {
    const r = await requete<T[]>(db, magasin, 'readonly', (s) => s.getAll())
    if (r) return r
  }
  return [...memoire[magasin].values()] as T[]
}

export async function retirer(magasin: 'file' | 'cache', cle: string): Promise<void> {
  memoire[magasin].delete(cle)
  const db = await ouvrir()
  if (db) await requete(db, magasin, 'readwrite', (s) => s.delete(cle))
}

/** Demande au navigateur de ne pas effacer ces données quand l'espace manque. */
export async function demanderStockagePersistant(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    }
  } catch { /* ignoré : le bandeau avertit */ }
  return false
}
