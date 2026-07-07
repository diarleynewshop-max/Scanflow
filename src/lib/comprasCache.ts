import type { ProdutoComprar } from "@/hooks/useProdutosComprar";

// Cache IndexedDB da lista de compras (stale-while-revalidate): ao abrir, mostra a
// ultima lista salva na hora e revalida em segundo plano. Muito mais espaco e
// velocidade que localStorage para listas grandes.
const DB_NAME = "scan-newshop-compras-cache";
const STORE_NAME = "listas";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB indisponivel"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Falha ao abrir IndexedDB"));
    });
  }
  return dbPromise;
}

function runRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = action(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Falha na operacao do IndexedDB"));
      })
      .catch(reject);
  });
}

interface ComprasCacheEntry {
  produtos: ProdutoComprar[];
  updatedAt: number;
}

export async function lerComprasCache(key: string): Promise<ProdutoComprar[] | null> {
  try {
    const entry = await runRequest<ComprasCacheEntry | undefined>("readonly", (store) => store.get(key));
    return entry && Array.isArray(entry.produtos) ? entry.produtos : null;
  } catch {
    return null;
  }
}

export async function salvarComprasCache(key: string, produtos: ProdutoComprar[]): Promise<void> {
  try {
    await runRequest("readwrite", (store) => store.put({ produtos, updatedAt: Date.now() }, key));
  } catch {
    // cache e opcional
  }
}
