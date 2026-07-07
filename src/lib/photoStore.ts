const DB_NAME = "scan-newshop-photo-cache";
const STORE_NAME = "photos";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openPhotoDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB indisponivel neste navegador"));
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
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openPhotoDb();
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = action(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Falha na operacao do IndexedDB"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Falha na transacao do IndexedDB"));
    } catch (error) {
      reject(error);
    }
  });
}

export async function putPhotoBlob(key: string, blob: Blob): Promise<void> {
  await runRequest("readwrite", (store) => store.put(blob, key));
}

export async function getPhotoBlob(key: string): Promise<Blob | null> {
  const result = await runRequest<Blob | undefined>("readonly", (store) => store.get(key));
  return result instanceof Blob ? result : null;
}

export async function deletePhotoBlob(key: string): Promise<void> {
  await runRequest("readwrite", (store) => store.delete(key));
}
