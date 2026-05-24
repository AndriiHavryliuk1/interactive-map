import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { RadarSignal } from '../../shared/models/signal.model';
import { SignalRepository } from './signal-repository';

describe('SignalRepository', () => {
  it('opens, saves, and retrieves signals within a timestamp range', async () => {
    const repo = await SignalRepository.open('TestDB_SignalRepository');
    const signals: RadarSignal[] = [
      { id: '1', timestamp: 100, frequency: 10, point: { lat: 0, lon: 0 }, zone: [] },
      { id: '2', timestamp: 200, frequency: 20, point: { lat: 0, lon: 0 }, zone: [] },
      { id: '3', timestamp: 300, frequency: 30, point: { lat: 0, lon: 0 }, zone: [] },
    ];

    await repo.save(signals);

    const result = await repo.getInRange(150, 250);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('2');

    repo.close();
  });
});
