// Arbeitskopie und Dateizugriff im IndexedDB des Browsers. Bleibt auf diesem Gerät, wird nie übertragen.
const DB = 'oe-rechnung', STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((res, rej) => {
      const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE))
      t.oncomplete = () => res(req.result)
      t.onerror = t.onabort = () => rej(t.error)
    })
  } finally { db.close() }
}
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try { return (await tx('readonly', (s) => s.get(key))) as T | undefined } catch { return undefined }
}
export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try { await tx('readwrite', (s) => s.put(value, key)); return true } catch { return false }
}
export async function idbDel(key: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(key)) } catch { /* egal */ }
}
