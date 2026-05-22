// src/app/core/db/indexed-db.util.ts
import { RadarSignal } from '../../shared/models/signal.model';

export function initDB(dbName: string = 'InteractiveMapDB'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('signals')) {
        const store = db.createObjectStore('signals', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
}

export function saveSignals(db: IDBDatabase, signals: RadarSignal[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('signals', 'readwrite');
    const store = transaction.objectStore('signals');

    for (const signal of signals) {
      store.put(signal);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject((event.target as IDBTransaction).error);
  });
}

export function getSignalsInRange(db: IDBDatabase, start: number, end: number): Promise<RadarSignal[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('signals', 'readonly');
    const store = transaction.objectStore('signals');
    const index = store.index('timestamp');
    const range = IDBKeyRange.bound(start, end);
    const request = index.getAll(range);

    request.onsuccess = (event) => resolve((event.target as IDBRequest<RadarSignal[]>).result);
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}
