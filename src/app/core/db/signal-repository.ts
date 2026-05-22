import { RadarSignal } from '../../shared/models/signal.model';

import {
  DB_NAME_DEFAULT,
  DB_VERSION,
  SIGNALS_INDEX_TIMESTAMP,
  SIGNALS_KEY_PATH,
  STORE_SIGNALS,
} from '../constants/db.constants';
import { SignalStorage } from '../interfaces/signal-storage.interface';

export class SignalRepository implements SignalStorage {
  private constructor(private readonly db: IDBDatabase) {}

  static open(dbName: string = DB_NAME_DEFAULT): Promise<SignalRepository> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_SIGNALS)) {
          const store = db.createObjectStore(STORE_SIGNALS, {
            keyPath: SIGNALS_KEY_PATH,
          });
          store.createIndex(SIGNALS_INDEX_TIMESTAMP, SIGNALS_INDEX_TIMESTAMP, {
            unique: false,
          });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(new SignalRepository(db));
      };
      request.onerror = (event) =>
        reject((event.target as IDBOpenDBRequest).error);
    });
  }

  save(signals: readonly RadarSignal[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_SIGNALS, 'readwrite');
      const store = transaction.objectStore(STORE_SIGNALS);

      for (const signal of signals) {
        store.put(signal);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = (event) =>
        reject((event.target as IDBTransaction).error);
    });
  }

  getInRange(start: number, end: number): Promise<RadarSignal[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_SIGNALS, 'readonly');
      const store = transaction.objectStore(STORE_SIGNALS);
      const index = store.index(SIGNALS_INDEX_TIMESTAMP);
      const range = IDBKeyRange.bound(start, end);
      const request = index.getAll(range);

      request.onsuccess = (event) =>
        resolve((event.target as IDBRequest<RadarSignal[]>).result);
      request.onerror = (event) =>
        reject((event.target as IDBRequest).error);
    });
  }

  close(): void {
    this.db.close();
  }
}
