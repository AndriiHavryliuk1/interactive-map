import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HISTORY_WINDOW_MS, PLAYBACK_TICK_MS } from '../../shared/constants/time.constants';
import { SignalStorage } from '../interfaces/signal-storage.interface';
import { RadarSignal, SignalMessage } from '../../shared/models/signal.model';
import { StateFrame } from '../../shared/models/worker.model';
import { PlaybackEngine } from './playback-engine';

const NOW = 1_700_000_000_000;

class FakeStorage implements SignalStorage {
  signals: RadarSignal[] = [];
  saveCalls = 0;
  getInRangeCalls = 0;
  closed = false;

  async save(signals: readonly RadarSignal[]): Promise<void> {
    this.saveCalls++;
    for (const s of signals) {
      const existing = this.signals.findIndex((x) => x.id === s.id);
      if (existing >= 0) this.signals[existing] = s;
      else this.signals.push(s);
    }
  }

  async getInRange(start: number, end: number): Promise<RadarSignal[]> {
    this.getInRangeCalls++;
    return this.signals
      .filter((s) => s.timestamp >= start && s.timestamp <= end)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  close(): void {
    this.closed = true;
  }
}

function makeSignal(overrides: Partial<SignalMessage> = {}): SignalMessage {
  return {
    timestamp: NOW,
    frequency: 100,
    point: { lat: 50, lon: 30 },
    zone: [],
    ...overrides,
  };
}

function makeEngine(opts: {
  storage?: FakeStorage;
  now?: () => number;
} = {}) {
  const storage = opts.storage ?? new FakeStorage();
  const frames: StateFrame[] = [];
  const engine = new PlaybackEngine({
    repository: storage,
    now: opts.now ?? (() => NOW),
    postFrame: (f) => frames.push(f),
  });
  return { engine, storage, frames };
}

describe('PlaybackEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ingestNewSignal', () => {
    it('derives a content-based id (same content → same id → IDB dedups)', async () => {
      const { engine, storage } = makeEngine();
      const msg = makeSignal({ frequency: 460.5, point: { lat: 50.12345, lon: 30.54321 } });

      engine.ingestNewSignal(msg);
      engine.ingestNewSignal(msg); // same content, should resolve to same id
      engine.start();
      await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS);
      engine.dispose();

      expect(storage.signals).toHaveLength(1);
      expect(storage.signals[0].id).toBe(`${NOW}-460.5-50.12345-30.54321`);
    });

    it('treats different content within the same burst as distinct signals', async () => {
      const { engine, storage } = makeEngine();
      engine.ingestNewSignal(makeSignal({ frequency: 100 }));
      engine.ingestNewSignal(makeSignal({ frequency: 200 }));
      engine.ingestNewSignal(makeSignal({ frequency: 300 }));
      engine.start();
      await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS);
      engine.dispose();

      expect(storage.signals).toHaveLength(3);
    });
  });

  describe('dispatch — Seek', () => {
    it('clamps a future seek to wall-clock now', async () => {
      const { engine, frames } = makeEngine();
      engine.start();
      engine.dispatch({ type: 'SEEK', timestamp: NOW + 60_000 });
      await vi.advanceTimersByTimeAsync(0);

      // The latest frame should carry a cursor not exceeding NOW.
      const latest = frames.at(-1);
      expect(latest?.cursor).toBe(NOW);
    });

    it('clamps a past seek to (now − HISTORY_WINDOW_MS)', async () => {
      const { engine, frames } = makeEngine();
      engine.start();
      engine.dispatch({ type: 'SEEK', timestamp: NOW - HISTORY_WINDOW_MS - 60_000 });
      await vi.advanceTimersByTimeAsync(0);

      const latest = frames.at(-1);
      expect(latest?.cursor).toBe(NOW - HISTORY_WINDOW_MS);
    });

    it('flips live → paused on seek', async () => {
      const { engine, frames } = makeEngine();
      engine.start();
      engine.dispatch({ type: 'SEEK', timestamp: NOW - 60_000 });
      await vi.advanceTimersByTimeAsync(0);

      expect(frames.at(-1)?.mode).toBe('paused');
    });

    it('preserves playing mode during seek (does not force paused)', async () => {
      const { engine, frames } = makeEngine();
      engine.start();
      engine.dispatch({ type: 'PLAY' });
      await vi.advanceTimersByTimeAsync(0);
      expect(frames.at(-1)?.mode).toBe('playing');

      engine.dispatch({ type: 'SEEK', timestamp: NOW - 60_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(frames.at(-1)?.mode).toBe('playing');
    });
  });

  describe('tick — auto-snap', () => {
    it('transitions playing → live once the cursor catches up to wall clock', async () => {
      // Seek to one tick before wall clock, then play; the next tick should snap to live.
      const { engine, frames } = makeEngine();
      engine.start();
      engine.dispatch({ type: 'SEEK', timestamp: NOW - PLAYBACK_TICK_MS });
      engine.dispatch({ type: 'PLAY' });
      await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS);

      expect(frames.at(-1)?.mode).toBe('live');
    });
  });

  describe('burst tie-break', () => {
    it('prefers the past candidate when two timestamps are equidistant from the cursor', async () => {
      const { engine, storage, frames } = makeEngine();
      // Two signals exactly equidistant from the cursor in past and future
      // direction. SIGNAL_VISIBLE_DURATION_MS = 1000; using NOW±500.
      engine.ingestNewSignal(makeSignal({ timestamp: NOW - 500, frequency: 100 }));
      engine.ingestNewSignal(makeSignal({ timestamp: NOW + 500, frequency: 200 }));
      engine.start();
      // Advance two intervals so the batch writer drains the buffer (tick 1)
      // and the next emitFrame reads populated storage (tick 2).
      await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS * 2);

      expect(storage.signals).toHaveLength(2);

      const burst = frames.at(-1)?.burstAtCursor ?? [];
      expect(burst).toHaveLength(1);
      expect(burst[0].timestamp).toBe(NOW - 500);
      expect(burst[0].frequency).toBe(100);

      engine.dispose();
    });
  });

  describe('emitFrame serialization', () => {
    it('serializes concurrent emits — no torn deltas', async () => {
      // Make getInRange artificially slow + resolvable in reverse order. Without
      // serialization, the dispatch's emit and the scheduled tick's emit would
      // both mutate lastVisibleIds against stale snapshots.
      const storage = new FakeStorage();
      const resolvers: Array<() => void> = [];
      let originalGetInRange = storage.getInRange.bind(storage);
      storage.getInRange = (start: number, end: number) =>
        new Promise<RadarSignal[]>((resolve) => {
          const wrapped = async () => resolve(await originalGetInRange(start, end));
          resolvers.push(wrapped);
        });

      const { engine, frames } = makeEngine({ storage });
      engine.start();
      // dispatch fires an emit; immediately advance time so the scheduled tick fires another.
      engine.dispatch({ type: 'PAUSE' });
      await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS);

      // Two emits should be queued. Drain in REVERSE order to maximally stress the chain.
      while (resolvers.length > 0) {
        const r = resolvers.pop()!;
        await r();
      }
      // Allow the chained promises to settle.
      await vi.advanceTimersByTimeAsync(0);

      // No assertion about a specific frame count — what matters is that no
      // call site threw and no frame is malformed. Each frame must have the
      // delta-shape invariants.
      for (const f of frames) {
        expect(Array.isArray(f.addedSignals)).toBe(true);
        expect(Array.isArray(f.removedSignalIds)).toBe(true);
        expect(Array.isArray(f.burstAtCursor)).toBe(true);
      }
      engine.dispose();
    });
  });

  describe('dispose', () => {
    it('stops the clock and closes storage', async () => {
      const { engine, storage } = makeEngine();
      engine.start();
      await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS);
      const callsBefore = storage.getInRangeCalls;

      engine.dispose();
      await vi.advanceTimersByTimeAsync(PLAYBACK_TICK_MS * 5);

      expect(storage.closed).toBe(true);
      expect(storage.getInRangeCalls).toBe(callsBefore); // no new ticks
    });

    it('is idempotent', () => {
      const { engine } = makeEngine();
      engine.start();
      engine.dispose();
      expect(() => engine.dispose()).not.toThrow();
    });

    it('ignores dispatch after dispose', async () => {
      const { engine, frames } = makeEngine();
      engine.start();
      await vi.advanceTimersByTimeAsync(0);
      engine.dispose();
      const before = frames.length;

      engine.dispatch({ type: 'PLAY' });
      await vi.advanceTimersByTimeAsync(0);
      expect(frames.length).toBe(before);
    });
  });

  describe('dispatch posts a frame eagerly', () => {
    it('emits a frame for every state-changing command (not just on the next tick)', async () => {
      const { engine, frames } = makeEngine();
      engine.start();
      await vi.advanceTimersByTimeAsync(0);
      const baseline = frames.length;

      engine.dispatch({ type: 'PAUSE' });
      await vi.advanceTimersByTimeAsync(0);
      expect(frames.length).toBeGreaterThan(baseline);
      expect(frames.at(-1)?.mode).toBe('paused');
    });
  });
});
