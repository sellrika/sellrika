// @ts-nocheck pos: upstream is type-checked in its own repo; this app's stricter tsconfig (noUncheckedIndexedAccess, no DOM.Iterable) is not its target
/**
 * IndexedDB-backed model cache.
 *
 * The Cache API that transformers.js uses by default only exists in secure
 * contexts, so a page served over plain http (a LAN or tailnet address during
 * development) re-downloads the model on every visit. IndexedDB works in both
 * contexts, so this adapter implements the two methods transformers.js needs
 * from a cache, `match` and `put`, on top of it.
 *
 * Files are stored in chunks so a 200 MB model never becomes a single record,
 * and writes happen in the background so inference is never held up by disk.
 */

const DB_NAME = 'bg0-model-cache'
const STORE = 'files'
const DB_VERSION = 1
const CHUNK_BYTES = 16 * 1024 * 1024

interface FileMeta {
  headers: [string, string][]
  size: number
  chunks: number
}

export interface ModelCache {
  match(request: RequestInfo | URL): Promise<Response | undefined>
  put(request: RequestInfo | URL, response: Response): Promise<void>
}

function keyOf(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request
  if (request instanceof URL) return request.href
  return request.url
}

function metaKey(key: string) {
  return `${key}#meta`
}

function chunkKey(key: string, index: number) {
  return `${key}#${index}`
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) {
        open.result.createObjectStore(STORE)
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () =>
      reject(open.error ?? new Error('IndexedDB unavailable'))
    open.onblocked = () => reject(new Error('IndexedDB is blocked'))
  })
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () =>
      reject(operation.error ?? new Error('IndexedDB request failed'))
  })
}

function settle(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export function createIndexedDbCache(): ModelCache {
  let database: Promise<IDBDatabase> | undefined
  const db = () => {
    if (!database) database = openDatabase()
    return database
  }
  const pendingWrites = new Set<string>()

  async function write(
    key: string,
    body: ArrayBuffer,
    headers: [string, string][],
  ) {
    const chunks = Math.max(1, Math.ceil(body.byteLength / CHUNK_BYTES))
    const connection = await db()
    for (let index = 0; index < chunks; index += 1) {
      const transaction = connection.transaction(STORE, 'readwrite')
      const slice = body.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)
      transaction.objectStore(STORE).put(slice, chunkKey(key, index))
      await settle(transaction)
    }
    const meta: FileMeta = { headers, size: body.byteLength, chunks }
    const transaction = connection.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(meta, metaKey(key))
    await settle(transaction)
  }

  return {
    async match(input) {
      const key = keyOf(input)
      if (pendingWrites.has(key)) return undefined
      try {
        const connection = await db()
        const store = connection
          .transaction(STORE, 'readonly')
          .objectStore(STORE)
        const meta = await request<FileMeta | undefined>(
          store.get(metaKey(key)),
        )
        if (!meta) return undefined
        const parts: ArrayBuffer[] = []
        for (let index = 0; index < meta.chunks; index += 1) {
          const chunkStore = connection
            .transaction(STORE, 'readonly')
            .objectStore(STORE)
          const chunk = await request<ArrayBuffer | undefined>(
            chunkStore.get(chunkKey(key, index)),
          )
          if (!chunk) return undefined
          parts.push(chunk)
        }
        const headers = new Headers(meta.headers)
        headers.set('content-length', String(meta.size))
        return new Response(new Blob(parts), { headers })
      } catch {
        return undefined
      }
    },
    async put(input, response) {
      const key = keyOf(input)
      const body = await response.arrayBuffer()
      const headers: [string, string][] = []
      for (const [name, value] of response.headers) {
        if (name.toLowerCase() !== 'content-length') headers.push([name, value])
      }
      // Do not block model loading on the disk write. A failed write only
      // means the next visit downloads again.
      pendingWrites.add(key)
      void write(key, body, headers)
        .catch((error) => {
          console.warn('BG0 could not cache the model locally:', error)
        })
        .finally(() => pendingWrites.delete(key))
    },
  }
}

export async function clearIndexedDbCache(): Promise<void> {
  if (!isIndexedDbAvailable()) return
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}
