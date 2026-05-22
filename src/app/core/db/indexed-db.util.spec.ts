// src/app/core/db/indexed-db.util.spec.ts
import { initDB, saveSignals, getSignalsInRange } from './indexed-db.util';
import { RadarSignal } from '../../shared/models/signal.model';
import { describe, it, expect, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';

describe('IndexedDB Util', () => {
  it('should initialize, save, and retrieve signals', async () => {
    const db = await initDB('TestDB_Task2');
    const signals: RadarSignal[] = [
      { id: '1', timestamp: 100, frequency: 10, point: { lat: 0, lon: 0 }, zone: [] },
      { id: '2', timestamp: 200, frequency: 20, point: { lat: 0, lon: 0 }, zone: [] },
      { id: '3', timestamp: 300, frequency: 30, point: { lat: 0, lon: 0 }, zone: [] },
    ];
    
    await saveSignals(db, signals);
    
    const result = await getSignalsInRange(db, 150, 250);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('2');
    
    db.close();
  });
});
